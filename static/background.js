// Chrome 扩展 Service Worker
console.log('Screen Recorder Extension Service Worker loaded')

// 添加 lab 功能：每个标签页的状态管理
const tabStates = new Map(); // tabId -> { mode: 'element'|'region', selecting: boolean, recording: boolean }

// 扩展安装时的初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details.reason)

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

  // 自动在点击扩展图标时打开 Side Panel（Chrome 116+）
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (e) {
    console.warn('setPanelBehavior failed', e);
  }
})

// 扩展图标点击事件 - 打开 sidepanel
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id })
      console.log('Sidepanel opened for tab:', tab.id)
    }
  } catch (error) {
    console.error('Failed to open sidepanel:', error)
  }
})

// 处理来自 sidepanel 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message.action || message.type, message)

  // 处理 lab 功能的消息类型
  if (message.type) {
    const tabId = sender.tab?.id ?? message.tabId;
    if (!tabId) return;

    // Ensure state
    if (!tabStates.has(tabId)) tabStates.set(tabId, { mode: 'element', selecting: false, recording: false });
    const state = tabStates.get(tabId);

    switch (message.type) {
      case 'GET_STATE':
        sendResponse({ ok: true, state });
        return true;

      case 'SET_MODE':
        state.mode = message.mode === 'region' ? 'region' : 'element';
        broadcastToTab(tabId, { type: 'STATE_UPDATE', state });
        return true;

      case 'ENTER_SELECTION':
        state.selecting = true;
        ensureContentInjected(tabId).then(() => {
          chrome.tabs.sendMessage(tabId, { type: 'ENTER_SELECTION', mode: state.mode });
        });
        broadcastToTab(tabId, { type: 'STATE_UPDATE', state });
        return true;

      case 'EXIT_SELECTION':
        state.selecting = false;
        chrome.tabs.sendMessage(tabId, { type: 'EXIT_SELECTION' });
        broadcastToTab(tabId, { type: 'STATE_UPDATE', state });
        return true;

      case 'START_CAPTURE':
        state.recording = true;
        ensureContentInjected(tabId).then(() => {
          chrome.tabs.sendMessage(tabId, { type: 'START_CAPTURE' });
        });
        broadcastToTab(tabId, { type: 'STATE_UPDATE', state });
        return true;

      case 'STOP_CAPTURE':
        state.recording = false;
        chrome.tabs.sendMessage(tabId, { type: 'STOP_CAPTURE' });
        broadcastToTab(tabId, { type: 'STATE_UPDATE', state });
        return true;

      case 'CLEAR_SELECTION':
        chrome.tabs.sendMessage(tabId, { type: 'CLEAR_SELECTION' });
        broadcastToTab(tabId, { type: 'STATE_UPDATE', state });
        return true;

      case 'DOWNLOAD_VIDEO':
        chrome.tabs.sendMessage(tabId, { type: 'DOWNLOAD_VIDEO' });
        return true;

      case 'CONTENT_REPORT':
        // pass-through updates to side panel
        broadcastToTab(tabId, { type: 'STATE_UPDATE', state: { ...state, ...message.partial } });
        return true;

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
      console.log('Recording completed with', message.chunksCount, 'chunks')
      break

    case 'recordingError':
      console.error('Recording error from offscreen:', message.error)
      break

    default:
      console.warn('Unknown message action:', message.action)
      sendResponse({ error: 'Unknown action' })
  }
})

// lab 功能：广播消息到标签页
function broadcastToTab(tabId, payload) {
  chrome.runtime.sendMessage({ ...payload, tabId });
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
    console.log('Requesting desktop capture with sources:', sources)

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

    console.log('Current tab:', currentTab.id, currentTab.url)

    console.log('Calling chrome.desktopCapture.chooseDesktopMedia...')

    const requestId = chrome.desktopCapture.chooseDesktopMedia(
      sources,
      currentTab, // 添加目标标签页参数
      (streamId, options) => {
        console.log('Desktop capture callback called:', { streamId, options })

        if (streamId) {
          console.log('Desktop capture granted:', streamId)
          sendResponse({
            success: true,
            streamId,
            canRequestAudioTrack: options?.canRequestAudioTrack || false
          })
        } else {
          console.log('Desktop capture cancelled by user')
          sendResponse({
            success: false,
            error: 'DESKTOP_CAPTURE_CANCELLED'
          })
        }
      }
    )

    console.log('chooseDesktopMedia returned requestId:', requestId)
    
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
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('Download failed:', chrome.runtime.lastError)
        sendResponse({ 
          success: false,
          error: 'DOWNLOAD_FAILED',
          details: chrome.runtime.lastError.message 
        })
      } else {
        console.log('Download started:', downloadId)
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
      console.log('Settings updated:', settings)
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
    console.log('Download completed:', downloadDelta.id)
    
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
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension startup')
})

// Offscreen document 管理
// async function ensureOffscreenDocument() {
//   try {
//     // 检查是否已有offscreen document
//     const existingContexts = await chrome.runtime.getContexts({
//       contextTypes: ['OFFSCREEN_DOCUMENT'],
//       documentUrls: [chrome.runtime.getURL('offscreen.html')]
//     })

//     if (existingContexts.length > 0) {
//       console.log('Offscreen document already exists')
//       return
//     }

//     // 创建offscreen document
//     await chrome.offscreen.createDocument({
//       url: 'offscreen.html',
//       reasons: ['USER_MEDIA'],
//       justification: 'Screen recording requires getUserMedia access'
//     })

//     console.log('Offscreen document created')
//   } catch (error) {
//     console.error('Failed to create offscreen document:', error)
//     throw error
//   }
// }

// 全局录制状态
let currentRecording = {
  isRecording: false,
  streamId: null,
  startTime: null
}

// 处理录制开始 - 简化版本，直接返回streamId
async function handleStartRecording(message, sendResponse) {
  try {
    console.log('Starting recording with streamId:', message.streamId)

    // 保存录制状态
    currentRecording = {
      isRecording: true,
      streamId: message.streamId,
      startTime: Date.now()
    }

    console.log('Recording state saved:', currentRecording)

    // 直接返回成功，让sidepanel处理实际的录制
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
    console.log('Stopping recording')

    // 重置录制状态
    currentRecording = {
      isRecording: false,
      streamId: null,
      startTime: null
    }

    console.log('Recording state reset')

    // 返回成功，让sidepanel处理实际的停止逻辑
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

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    // reset selecting/recording on navigation
    const st = tabStates.get(tabId);
    if (st) {
      st.selecting = false;
      st.recording = false;
      broadcastToTab(tabId, { type: 'STATE_UPDATE', state: st });
    }
  }
});

// 兼容：如果浏览器版本不支持 setPanelBehavior，则手动在点击图标时打开 Side Panel
if (chrome.action && chrome.sidePanel) {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      if (chrome.sidePanel.setOptions && tab?.id) {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
      }
      if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
    } catch (e) {
      console.warn('Open sidepanel failed', e);
    }
  });
}

// 错误处理
self.addEventListener('error', (event) => {
  console.error('Service Worker error:', event.error)
})

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker unhandled rejection:', event.reason)
})