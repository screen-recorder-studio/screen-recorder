// @ts-nocheck

// Chrome 扩展 Service Worker

// 引入 offscreen 管理工具
import { ensureOffscreenDocument, sendToOffscreen } from '../lib/utils/offscreen-manager'


// 添加 lab 功能：每个标签页的状态管理
const tabStates = new Map(); // tabId -> { mode: 'element'|'region', selecting: boolean, recording: boolean, uiSelectedMode?: 'area'|'element'|'camera'|'tab'|'window'|'screen' }

// 能力探测：计算某个标签页是否允许内容脚本（用于隐藏元素/区域录制）
async function computeCapabilities(tabId) {
  let url = ''
  try {
    const tab = await chrome.tabs.get(tabId)
    url = tab?.url || ''
  } catch (e) {
    // ignore
  }

  const result = {
    contentScriptAvailable: false,
    reason: 'unknown',
    url
  }

  if (!url) {
    return result
  }

  const lower = url.toLowerCase()

  // 1) 静态禁区：chrome://、chrome-extension://、edge://、about:*、Chrome Web Store
  const isForbiddenScheme = lower.startsWith('chrome://') || lower.startsWith('chrome-extension://') || lower.startsWith('edge://') || lower.startsWith('about:')
  const isWebStore = lower.startsWith('https://chrome.google.com/webstore') || lower.includes('chrome.google.com/webstore')
  if (isForbiddenScheme || isWebStore) {
    result.reason = 'forbidden_url'
    return result
  }

  // 2) file:// 需要“允许访问文件URL”权限
  if (lower.startsWith('file://')) {
    const allowed = await new Promise((resolve) => {
      try {
        if (chrome.extension?.isAllowedFileSchemeAccess) {
          chrome.extension.isAllowedFileSchemeAccess(resolve)
        } else {
          resolve(false)
        }
      } catch {
        resolve(false)
      }
    })
    if (!allowed) {
      result.reason = 'no_file_access'
      return result
    }
  }

  // 3) 兜底：尝试轻量 executeScript 检查注入能力
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => true })
    return { contentScriptAvailable: true, url }
  } catch (e) {
    result.reason = 'runtime_denied'
    return result
  }
}

// 辅助：带能力信息广播当前 tab 状态
async function broadcastStateWithCapabilities(tabId) {
  // Ensure state exists
  if (!tabStates.has(tabId)) tabStates.set(tabId, { mode: 'element', selecting: false, recording: false, uiSelectedMode: 'area' })
  const state = tabStates.get(tabId)
  const capabilities = await computeCapabilities(tabId)
  broadcastToTab(tabId, { type: 'STATE_UPDATE', state: { ...state, capabilities } })
}

// 扩展安装时的初始化
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: '/welcome.html' });
  }
  // 设置默认配置
  chrome.storage.local.set({
    settings: {
      videoQuality: 'medium',
      audioEnabled: true,
      autoDownload: true,
      filenameTemplate: 'screen-recording-{timestamp}',
      maxDuration: 3600, // 1小时
      preferredSources: ['screen', 'window', 'tab']
    }
  })

  // 明确关闭“点击图标自动打开 Side Panel”的行为（Chrome 116+）
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    }
  } catch (e) {
    console.warn('setPanelBehavior(false) failed', e);
  }
})

// Control window management - open control page when clicking extension icon
let controlWinId: number | null = null;

chrome.action.onClicked.addListener(async () => {
  // If control window exists, focus it
  if (controlWinId !== null) {
    try {
      await chrome.windows.update(controlWinId, { focused: true });
      return;
    } catch {
      // Window no longer exists
      controlWinId = null;
    }
  }

  // Open new control window
  const controlWidth = 360;
  const controlHeight = 470;

  try {
    const current = await chrome.windows.getCurrent();
    let left: number | undefined;
    let top: number | undefined;

    if (current && typeof current.left === 'number' && typeof current.top === 'number') {
      left = current.left + Math.max(0, Math.round(((current.width || controlWidth) - controlWidth) / 2));
      top = current.top + Math.max(0, Math.round(((current.height || controlHeight) - controlHeight) / 2));
    }

    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('control.html'),
      type: 'popup',
      width: controlWidth,
      height: controlHeight,
      left,
      top,
      focused: true
    });

    if (win?.id) {
      controlWinId = win.id;
    }
  } catch (e) {
    console.error('Failed to open control window:', e);
  }
});

// Clean up control window ID when window is closed
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === controlWinId) {
    controlWinId = null;
  }
});

// 处理来自 sidepanel 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages explicitly targeted to the offscreen document to avoid echo/loops
  if (message?.target === 'offscreen-doc') {
    return false;
  }


  // 处理 lab 功能的消息类型
  if (message.type) {
    const tabId = sender.tab?.id ?? message.tabId;
    const globalTypes = new Set(['REQUEST_START_RECORDING','REQUEST_STOP_RECORDING','REQUEST_RECORDING_STATE','REQUEST_TOGGLE_PAUSE','OFFSCREEN_START_RECORDING','OFFSCREEN_STOP_RECORDING','REQUEST_OFFSCREEN_PING','GET_RECORDING_STATE','RECORDING_COMPLETE','OPFS_RECORDING_READY','STREAM_START','STREAM_META','STREAM_END','STREAM_ERROR','BADGE_TICK']);
    let state: any;
    if (!globalTypes.has(message.type)) {
      if (!tabId) return;
      // Ensure state for tab-scoped features
      if (!tabStates.has(tabId)) tabStates.set(tabId, { mode: 'element', selecting: false, recording: false, uiSelectedMode: 'area' });
      state = tabStates.get(tabId);
    }
    switch (message.type) {
      case 'GET_STATE':
        (async () => {
          const capabilities = await computeCapabilities(tabId);
          try { sendResponse({ ok: true, state: { ...state, capabilities } }); } catch (e) {}
        })();
        return true;

      case 'SET_MODE':
        state.mode = message.mode === 'region' ? 'region' : 'element';
        broadcastStateWithCapabilities(tabId);
        try { sendResponse({ ok: true, state }); } catch (e) {}
        return true;

      case 'SET_SELECTED_MODE': {
        // Persist popup's selected mode for this tab (used to restore UI on reopen)
        state.uiSelectedMode = (message.uiMode === 'element' || message.uiMode === 'area' || message.uiMode === 'camera' || message.uiMode === 'tab' || message.uiMode === 'window' || message.uiMode === 'screen')
          ? message.uiMode
          : (state.uiSelectedMode || 'area');
        // If switching to element/area, keep legacy state.mode in sync (region vs element)
        if (message.uiMode === 'area') state.mode = 'region';
        if (message.uiMode === 'element') state.mode = 'element';
        broadcastStateWithCapabilities(tabId);
        try { sendResponse({ ok: true, state }); } catch (e) {}
        return true;
      }


      case 'ENTER_SELECTION':
        state.selecting = true;
        ensureContentInjected(tabId).then(() => {
          chrome.tabs.sendMessage(tabId, { type: 'ENTER_SELECTION', mode: state.mode });
        });
        broadcastStateWithCapabilities(tabId);
        try { sendResponse({ ok: true, state }); } catch (e) {}
        return true;

      case 'EXIT_SELECTION':
        state.selecting = false;
        chrome.tabs.sendMessage(tabId, { type: 'EXIT_SELECTION' });
        broadcastStateWithCapabilities(tabId);
        try { sendResponse({ ok: true, state }); } catch (e) {}
        return true;

      case 'START_CAPTURE':
        state.recording = true;
        ensureContentInjected(tabId).then(async () => {
          let c = (typeof message.countdown === 'number') ? message.countdown : undefined;
          if (!(typeof c === 'number' && c >= 1 && c <= 5)) {
            try {
              const stored = await new Promise<any>(res => chrome.storage.local.get(['settings'], r => res(r)));
              const v = stored?.settings?.countdownSeconds;
              if (typeof v === 'number' && v >= 1 && v <= 5) c = v;
            } catch {}
          }
          if (!(typeof c === 'number' && c >= 1 && c <= 5)) c = 3;
          // Countdown should open only after user grants capture permission (stream ready)
          // So we do NOT open countdown here; content will trigger via STREAM_META once stream is available
          chrome.tabs.sendMessage(tabId, { type: 'START_CAPTURE', countdown: c });
        });
        broadcastStateWithCapabilities(tabId);
        try { sendResponse({ ok: true, state }); } catch (e) {}
        return true;

      case 'STOP_CAPTURE':
        state.recording = false;
        chrome.tabs.sendMessage(tabId, { type: 'STOP_CAPTURE' });
        broadcastStateWithCapabilities(tabId);
        try { sendResponse({ ok: true, state }); } catch (e) {}
        return true;

      case 'CLEAR_SELECTION':
        chrome.tabs.sendMessage(tabId, { type: 'CLEAR_SELECTION' });
        broadcastStateWithCapabilities(tabId);
        try { sendResponse({ ok: true, state }); } catch (e) {}
        return true;

      case 'DOWNLOAD_VIDEO':
        chrome.tabs.sendMessage(tabId, { type: 'DOWNLOAD_VIDEO' });
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;

      case 'CONTENT_REPORT': {
        // 合并 Capabilities：保留 computeCapabilities 的结果（含 contentScriptAvailable），再叠加内容脚本上报的能力位
        (async () => {
          try {
            const partial = message.partial || {}
            let mergedCaps = undefined
            if (partial.capabilities) {
              const base = await computeCapabilities(tabId)
              mergedCaps = { ...base, ...partial.capabilities }
            }
            const nextState = mergedCaps ? { ...state, ...partial, capabilities: mergedCaps } : { ...state, ...partial }
            broadcastToTab(tabId, { type: 'STATE_UPDATE', state: nextState })
            try { sendResponse({ ok: true }) } catch {}
          } catch (e) {
            console.warn('[Background] CONTENT_REPORT handling error', e)
            try { sendResponse({ ok: false }) } catch {}
          }
        })();
        return true;
      }

      case 'ELEMENT_RECORDING_COMPLETE':
        // 处理元素录制完成，传递数据给主系统
        handleElementRecordingComplete(message, sendResponse);
        return true;

      case 'RECORDING_COMPLETE': {
        // Treat as a stop event when it originates from offscreen
        try { currentRecording.isRecording = false; currentRecording.isPaused = false } catch {}
        try { void stopBadgeTimer() } catch {}
        try {
          const p = chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { recording: false } })
          if (p && typeof p.catch === 'function') p.catch(() => {})
        } catch (e) {
          console.warn('[stop-share] background: failed to broadcast STATE_UPDATE for RECORDING_COMPLETE', e)
        }
        try { sendResponse({ ok: true }) } catch (e) {}
        return true;
      }

      case 'OPFS_RECORDING_READY': {
        try {
          const id = message?.id
          const doOpen = () => {
            try { currentRecording.isRecording = false; currentRecording.isPaused = false } catch {}
            try { void stopBadgeTimer() } catch {}
            try {
              const p = chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { recording: false } })
              if (p && typeof p.catch === 'function') p.catch(() => {})
            } catch {}
            const targetUrl = chrome.runtime.getURL(`studio.html?id=${encodeURIComponent(id)}`)
            chrome.tabs.create({ url: targetUrl }, () => {
              const err = chrome.runtime.lastError
              if (err) console.error('[Background] Failed to open Studio tab:', err.message)
            })
          }

          if (currentRecording && currentRecording.isRecording) {
            setTimeout(() => {
              try {
                if (currentRecording && currentRecording.isRecording) {
                  try { sendResponse({ ok: true, skipped: true, reason: 'active_recording' }) } catch {}
                } else {
                  doOpen();
                  try { sendResponse({ ok: true, delayed: true }) } catch {}
                }
              } catch (e) {
                console.warn('[Background] delayed OPFS_RECORDING_READY handling error', e)
                try { sendResponse({ ok: false, error: (e && e.message) || String(e) }) } catch {}
              }
            }, 600)
            return true;
          }

          doOpen();
          try { sendResponse({ ok: true }) } catch (e) {}
        } catch (e) {
          console.warn('[Background] OPFS_RECORDING_READY handling error', e)
          try { sendResponse({ ok: false, error: (e && e.message) || String(e) }) } catch (_) {}
        }
        return true;
      }
      // Stream signaling from content via sendMessage (no Port)
      case 'STREAM_START': {
        // Dual-path handling: tab-scoped (content pipeline) vs global (offscreen pipeline)
        try { currentRecording.isRecording = true; currentRecording.isPaused = false } catch {}
        try { void updateBadgeFromElapsed(0) } catch {}
        if (tabId) {
          try { state.recording = true } catch {}
          broadcastToTab(tabId, { ...message, tabId });
          void broadcastStateWithCapabilities(tabId);
        } else {
          // Fan-out a generic state update for popup listeners
          try { chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { recording: true } }).catch(() => {}) } catch {}
        }
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
      }
      case 'STREAM_META': {
        // Handle preparing countdown for badge, and pause/resume meta
        const meta = message?.meta || {}
        if (meta && meta.preparing && typeof meta.countdown === 'number') {
          // Broadcast STREAM_META to control page for inline countdown
          // Control page will handle countdown display and send COUNTDOWN_DONE when finished
          try {
            chrome.runtime.sendMessage({
              type: 'STREAM_META',
              meta: { preparing: true, countdown: meta.countdown, mode: meta.mode }
            }).catch(() => {})
          } catch {}
          try { sendResponse({ ok: true }) } catch {}
          return true;
        }
        if (meta && typeof meta.paused === 'boolean') {
          try { currentRecording.isPaused = !!meta.paused } catch {}
          // Badge elapsed time is now driven by BADGE_TICK messages from producers; no local timer adjustments
        }
        if (tabId) {
          broadcastToTab(tabId, { ...message, tabId });
        } else {
          try { chrome.runtime.sendMessage({ ...message }).catch(() => {}) } catch {}
        }
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
      }
      case 'BADGE_TICK': {
        const elapsed = typeof message?.elapsedMs === 'number'
          ? message.elapsedMs
          : (typeof message?.elapsed === 'number' ? message.elapsed : null);
        if (typeof elapsed === 'number' && elapsed >= 0) {
          void updateBadgeFromElapsed(elapsed);
        }
        try { sendResponse({ ok: true }) } catch (e) {}
        return true;
      }
      case 'STREAM_END_REQUEST': {
        broadcastToTab(tabId, { ...message, tabId });
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
      }
      case 'STREAM_END': {
        try { currentRecording.isRecording = false; currentRecording.isPaused = false } catch {}
        disableTabAnnotation()
        currentRecording.tabId = null
        currentRecording.mode = null
        try { void stopBadgeTimer() } catch {}
        if (tabId) {
          try { state.recording = false } catch {}
          broadcastToTab(tabId, { ...message, tabId });
          void broadcastStateWithCapabilities(tabId);
        } else {
          try { chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { recording: false } }).catch(() => {}) } catch {}
        }
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
      }
      case 'STREAM_ERROR': {
        try { currentRecording.isRecording = false; currentRecording.isPaused = false } catch {}
        disableTabAnnotation()
        currentRecording.tabId = null
        currentRecording.mode = null
        try { void stopBadgeTimer() } catch {}
        if (tabId) {
          try { state.recording = false } catch {}
          broadcastToTab(tabId, { ...message, tabId });
          void broadcastStateWithCapabilities(tabId);
        } else {
          try { chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { recording: false } }).catch(() => {}) } catch {}
        }
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
      }
      case 'REQUEST_START_RECORDING':
      case 'OFFSCREEN_START_RECORDING': {
        (async () => {
          const raw = message?.payload?.options ?? message?.payload
          // Inject countdown from storage if missing / invalid
          let c = raw?.countdown
          if (!(typeof c === 'number' && c >=1 && c <=5)) {
            try {
              const stored = await new Promise<any>(res => chrome.storage.local.get(['settings'], r => res(r)));
              const v = stored?.settings?.countdownSeconds;
              if (typeof v === 'number' && v >=1 && v <=5) c = v; else c = 3;
            } catch { c = 3 }
          }
          raw.countdown = c;
          // Countdown should open only after user grants capture permission (stream ready)
          // Offscreen will trigger via STREAM_META once stream is available
          await startRecordingViaOffscreen(raw)
          try { sendResponse({ ok: true }) } catch (e) {}
        })()
        return true;
      }
      case 'REQUEST_STOP_RECORDING': {
        // Only handle stop requests from popup, not OFFSCREEN_STOP_RECORDING
        // OFFSCREEN_STOP_RECORDING is sent TO offscreen, not FROM it
        (async () => {
          await stopRecordingViaOffscreen()
          try { sendResponse({ ok: true }) } catch (e) {}
        })()
        return true;
      }
      case 'REQUEST_OFFSCREEN_PING': {
        (async () => {
          await ensureOffscreenDocument({ url: 'offscreen.html', reasons: ['DISPLAY_MEDIA','WORKERS','BLOBS'] })
          await sendToOffscreen({ target: 'offscreen-doc', type: 'OFFSCREEN_PING', when: Date.now() })
          try { sendResponse({ ok: true }) } catch (e) {}
        })()
        return true;
      }

      case 'REQUEST_RECORDING_STATE':
      case 'GET_RECORDING_STATE': {
        try { sendResponse({ ok: true, state: currentRecording }) } catch (e) {}
        return true;
      }

      case 'REQUEST_TOGGLE_PAUSE': {
        (async () => {
          try {
            // Control offscreen recording pause for Tab/Window/Screen modes
            const newPaused = !currentRecording.isPaused
            await ensureOffscreenDocument({ url: 'offscreen.html', reasons: ['DISPLAY_MEDIA','WORKERS','BLOBS'] })
            await sendToOffscreen({ target: 'offscreen-doc', type: 'OFFSCREEN_TOGGLE_PAUSE', payload: { paused: newPaused } })
            currentRecording.isPaused = newPaused
            try { sendResponse({ ok: true, paused: newPaused }) } catch (e) {}
          } catch (e) {
            try { sendResponse({ ok: false, error: String(e) }) } catch (_) {}
          }
        })()
        return true;
      }

      default:
        break;
    }
  }

  // 处理原有的消息类型
  switch (message.action) {
    case 'requestScreenCapture':
      handleScreenCaptureRequest(message, sendResponse)
      return true // 保持消息通道开放

    case 'startRecording':
      handleStartRecording(message, sendResponse)
      return true

    case 'stopRecording':
      handleStopRecording(message, sendResponse)
      return true

    case 'saveRecording':
      handleSaveRecording(message, sendResponse)
      return true

    case 'getSettings':
      handleGetSettings(sendResponse)
      return true

    case 'updateSettings':
      handleUpdateSettings(message, sendResponse)
      return true

    case 'openSidePanel':
      handleOpenSidePanel(message, sendResponse)
      return true

    // 来自offscreen document的消息
    case 'recordingComplete':
      break

    case 'recordingError':
      console.error('Recording error from offscreen:', message.error)
      break

    default:
      console.warn('Unknown message action:', message.action)
      sendResponse({ error: 'Unknown action' })
  }
})
// Legacy Port-based streaming removed; using sendMessage (STREAM_*) instead.


// lab 功能：广播消息到标签页
function broadcastToTab(tabId, payload) {
  try {
    const p = chrome.runtime.sendMessage({ ...payload, tabId })
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch (_) {}
}



// 处理元素录制完成，传递数据给主系统
function handleElementRecordingComplete(message, sendResponse) {
  try {

    // 验证数据完整性
    if (!message.data?.encodedChunks || message.data.encodedChunks.length === 0) {
      console.error('❌ [Background] No encoded chunks received');
      sendResponse({ success: false, error: 'No encoded chunks' });
      return;
    }

    // 准备传递给主系统的数据
    const transferData = {
      type: 'ELEMENT_RECORDING_DATA',
      encodedChunks: message.data.encodedChunks,
      metadata: {
        ...message.data.metadata,
        transferTime: Date.now(),
        source: 'element-recording'
      }
    };

    // 广播给所有监听的组件（包括 sidepanel）
    chrome.runtime.sendMessage(transferData).catch((error) => {
      console.warn('❌ [Background] Failed to broadcast to sidepanel:', error);
    });

    // 尝试直接通知 sidepanel
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        // 通知 sidepanel 有新的录制数据
        broadcastToTab(tabs[0].id, {
          type: 'ELEMENT_RECORDING_READY',
          data: transferData
        });
      }
    });

    sendResponse({ success: true, message: 'Data transferred to main system' });

  } catch (error) {
    console.error('❌ [Background] Error handling element recording complete:', error);
    sendResponse({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
}

// lab 功能：确保 Content Script 已注入
async function ensureContentInjected(tabId) {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__mcp_injected === true,
    });
    const already = injected?.[0]?.result === true;
    if (already) return;
  } catch (e) {
    // continue to inject
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['overlay.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (e) {
    console.warn('ensureContentInjected error', e);
  }
}

// 处理屏幕捕获请求
async function handleScreenCaptureRequest(message, sendResponse) {
  try {
    const sources = message.sources || ['screen', 'window', 'tab']

    // 获取当前活动标签页
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const currentTab = tabs[0]

    if (!currentTab) {
      console.error('No active tab found')
      sendResponse({
        success: false,
        error: 'NO_ACTIVE_TAB'
      })
      return
    }



    const requestId = chrome.desktopCapture.chooseDesktopMedia(
      sources,
      currentTab, // 添加目标标签页参数
      (streamId, options) => {

        if (streamId) {
          sendResponse({
            success: true,
            streamId,
            canRequestAudioTrack: options?.canRequestAudioTrack || false
          })
        } else {
          sendResponse({
            success: false,
            error: 'DESKTOP_CAPTURE_CANCELLED'
          })
        }
      }
    )


    // 处理请求失败情况
    if (!requestId) {
      console.error('Failed to initiate desktop capture request')
      sendResponse({
        success: false,
        error: 'DESKTOP_CAPTURE_FAILED'
      })
    }

  } catch (error) {
    console.error('Error in handleScreenCaptureRequest:', error)
    sendResponse({
      success: false,
      error: 'DESKTOP_CAPTURE_ERROR',
      details: error.message
    })
  }
}

// 处理录制保存
function handleSaveRecording(message, sendResponse) {
  try {
    const { filename, url } = message

    // 直接使用传入的 blob URL 进行下载
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError)
        sendResponse({
          success: false,
          error: 'DOWNLOAD_FAILED',
          details: chrome.runtime.lastError.message
        })
      } else {
        sendResponse({
          success: true,
          downloadId
        })
      }
    })

  } catch (error) {
    console.error('Error in handleSaveRecording:', error)
    sendResponse({
      success: false,
      error: 'SAVE_ERROR',
      details: error.message
    })
  }
}

// 获取用户设置
function handleGetSettings(sendResponse) {
  chrome.storage.local.get(['settings'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to get settings:', chrome.runtime.lastError)
      sendResponse({
        success: false,
        error: 'STORAGE_ERROR'
      })
    } else {
      sendResponse({
        success: true,
        settings: result.settings || {}
      })
    }
  })
}

// 更新用户设置
function handleUpdateSettings(message, sendResponse) {
  const { settings } = message

  chrome.storage.local.set({ settings }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to update settings:', chrome.runtime.lastError)
      sendResponse({
        success: false,
        error: 'STORAGE_ERROR'
      })
    } else {
      sendResponse({
        success: true
      })
    }
  })
}

// 打开 sidepanel
function handleOpenSidePanel(message, sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    try {
      if (tabs[0]?.id) {
        await chrome.sidePanel.open({ tabId: tabs[0].id })
        sendResponse({ success: true })
      } else {
        sendResponse({
          success: false,
          error: 'NO_ACTIVE_TAB'
        })
      }
    } catch (error) {
      console.error('Failed to open sidepanel:', error)
      sendResponse({
        success: false,
        error: 'SIDEPANEL_ERROR',
        details: error.message
      })
    }
  })
}

// 监听下载完成事件
chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (downloadDelta.state && downloadDelta.state.current === 'complete') {

    // 可以在这里通知 sidepanel 下载完成
    chrome.runtime.sendMessage({
      action: 'downloadComplete',
      downloadId: downloadDelta.id
    }).catch(() => {
      // 忽略错误，可能 sidepanel 未打开
    })
  }
})



// 处理扩展启动
chrome.runtime.onStartup.addListener(async () => {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    }
  } catch (e) {
    console.warn('setPanelBehavior(false) onStartup failed', e);
  }
})


// 全局录制状态
let currentRecording = {
  isRecording: false,
  isPaused: false,
  streamId: null,
  startTime: null,
  tabId: null as number | null,
  mode: null as string | null
}

let annotationTabId: number | null = null;

// --- Badge timer for recording duration on action button ---
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  // Keep text short for badge: prefer m:ss under 10m, else mm or h+
  if (h >= 1) return `${h}h`
  if (m >= 10) return `${m}m`
  return `${m}:${s.toString().padStart(2,'0')}`
}

async function updateBadgeFromElapsed(ms: number) {
  const safeMs = (typeof ms === 'number' && isFinite(ms) && ms >= 0) ? ms : 0
  const text = formatElapsed(safeMs)
  try { await chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' }) } catch {}
  try { await chrome.action.setBadgeText({ text }) } catch {}
}

async function stopBadgeTimer() {
  try { await chrome.action.setBadgeText({ text: '' }) } catch {}
}

async function enableTabAnnotation(tabId: number | null) {
  if (tabId == null) return;
  annotationTabId = tabId;
  try {
    await ensureContentInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { type: 'ENABLE_TAB_ANNOTATION' });
  } catch (e) {
    console.warn('[Background] failed to enable tab annotation', e);
  }
}

function disableTabAnnotation() {
  if (annotationTabId == null) return;
  try { chrome.tabs.sendMessage(annotationTabId, { type: 'DISABLE_TAB_ANNOTATION' }); } catch {}
  annotationTabId = null;
}

// Handle COUNTDOWN_DONE from control page - broadcast to offscreen
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'COUNTDOWN_DONE') {
    // Inline countdown in control page - just broadcast to offscreen
    try {
      chrome.runtime.sendMessage({
        type: 'COUNTDOWN_DONE_BROADCAST',
        ts: Date.now(),
        afterClose: true
      })
    } catch {}
  }
});

// Helper to resolve the most likely target tab for annotation (active tab in a normal window)
async function resolveTargetTabId(): Promise<number | null> {
  try {
    // 1. If current window is normal (e.g. Side Panel or just a tab page), use its active tab
    const currentWin = await chrome.windows.getCurrent().catch(() => null);
    if (currentWin && currentWin.type === 'normal') {
      const tabs = await chrome.tabs.query({ active: true, windowId: currentWin.id });
      if (tabs?.[0]?.id) return tabs[0].id;
    }

    // 2. Otherwise (Control Window, Popup), find the last focused NORMAL window
    // This handles the case where user clicks "Start" in a separate Control Window
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
    if (win && win.id) {
       const tabs = await chrome.tabs.query({ active: true, windowId: win.id });
       if (tabs?.[0]?.id) return tabs[0].id;
    }
  } catch (e) {
    console.warn('[Background] resolveTargetTabId failed', e);
  }
  return null;
}

// Unified start/stop helpers for Offscreen recording
async function startRecordingViaOffscreen(options) {
  try {
    const mode = (options?.mode === 'tab' || options?.mode === 'window' || options?.mode === 'screen') ? options.mode : 'screen'
    const normalizedOptions = {
      mode,
      video: options?.video ?? true,
      audio: options?.audio ?? false,
      countdown: (typeof options?.countdown === 'number' && options.countdown >=1 && options.countdown <=5) ? options.countdown : 3
    }

    let targetTabId: number | null = null
    if (mode === 'tab') {
      targetTabId = await resolveTargetTabId();
    }

    await ensureOffscreenDocument({ url: 'offscreen.html', reasons: ['DISPLAY_MEDIA','WORKERS','BLOBS'] })
    await sendToOffscreen({ target: 'offscreen-doc', type: 'OFFSCREEN_START_RECORDING', payload: { options: normalizedOptions } })
    // Enter preparing phase: will flip to active on STREAM_START
    currentRecording = { isRecording: false, isPaused: false, streamId: 'offscreen', startTime: null, tabId: targetTabId, mode }
    try { await chrome.action.setBadgeBackgroundColor({ color: '#fb8c00' }) } catch {}
    try { await chrome.action.setBadgeText({ text: '' }) } catch {}
    if (mode === 'tab' && targetTabId != null) {
      await enableTabAnnotation(targetTabId)
    }
  } catch (e) {
    // keep state unchanged on failure
    throw e
  }
}

async function stopRecordingViaOffscreen() {
  try {
    await ensureOffscreenDocument({ url: 'offscreen.html', reasons: ['DISPLAY_MEDIA','WORKERS','BLOBS'] })
    await sendToOffscreen({ target: 'offscreen-doc', type: 'OFFSCREEN_STOP_RECORDING' })
  } finally {
    disableTabAnnotation()
    currentRecording = { isRecording: false, isPaused: false, streamId: null, startTime: null, tabId: null, mode: null }
    try { await stopBadgeTimer() } catch (e) { /* optional badge clear failure */ }
  }
}

// 处理录制开始 - 简化版本，直接返回streamId
async function handleStartRecording(message, sendResponse) {
  try {

    // 保存录制状态
    currentRecording = {
      isRecording: true,
      isPaused: false,
      streamId: message.streamId,
      startTime: Date.now(),
      tabId: message.tabId ?? null,
      mode: null
    }


    // 确保 Offscreen 存在并通知开始录制（骨架版）
    try {
      await ensureOffscreenDocument({ url: 'offscreen.html', reasons: ['DISPLAY_MEDIA','WORKERS','BLOBS'] })
      await sendToOffscreen({ target: 'offscreen-doc', type: 'OFFSCREEN_START_RECORDING', payload: { streamId: message.streamId } })
    } catch (e) {
      console.warn('Failed to ensure offscreen or send START to offscreen', e)
    }

    // 返回成功（骨架版由 offscreen 侧处理实际录制）
    sendResponse({
      success: true,
      message: 'Recording started',
      streamId: message.streamId
    })

  } catch (error) {
    console.error('Failed to start recording:', error)
    sendResponse({
      success: false,
      error: error.message
    })
  }
}

// 处理录制停止
async function handleStopRecording(message, sendResponse) {
  try {

    // 重置录制状态
    currentRecording = {
      isRecording: false,
      isPaused: false,
      streamId: null,
      startTime: null,
      tabId: null,
      mode: null
    }


    // 通知 Offscreen 停止录制（骨架版）
    try {
      await ensureOffscreenDocument({ url: 'offscreen.html', reasons: ['DISPLAY_MEDIA','WORKERS','BLOBS'] })
      await sendToOffscreen({ target: 'offscreen-doc', type: 'OFFSCREEN_STOP_RECORDING' })
    } catch (e) {
      console.warn('Failed to ensure offscreen or send STOP to offscreen', e)
    }

    // 返回成功（骨架版由 offscreen 侧处理实际停止）
    sendResponse({
      success: true,
      message: 'Recording stopped'
    })

  } catch (error) {
    console.error('Failed to stop recording:', error)
    sendResponse({
      success: false,
      error: error.message
    })
  }
}

// lab 功能：标签页状态管理
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// 当用户切换活动标签页时，重新广播包含能力信息的状态
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    if (activeInfo?.tabId != null) {
      await broadcastStateWithCapabilities(activeInfo.tabId)
    }
  } catch (e) {
    // ignore
  }
})


chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    // reset selecting/recording on navigation
    const st = tabStates.get(tabId);
    if (st) {
      st.selecting = false;
      st.recording = false;
      broadcastStateWithCapabilities(tabId);
    }
  }
});

// 错误处理
self.addEventListener('error', (event) => {
  console.error('Service Worker error:', event.error)
})

self.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event?.reason as any;
    const msg = (reason && (reason.message || String(reason))) || '';
    if (typeof msg === 'string' && msg.includes('Could not establish connection. Receiving end does not exist.')) {
      // During page refresh or when no receiver is present, ignore benign sendMessage errors
      try { if (typeof event.preventDefault === 'function') event.preventDefault(); } catch {}
      return;
    }
  } catch {}
  console.error('Service Worker unhandled rejection:', event.reason)
})
