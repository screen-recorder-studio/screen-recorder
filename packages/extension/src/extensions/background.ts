// @ts-nocheck

// Chrome 扩展 Service Worker

// 引入 offscreen 管理工具
import { ensureOffscreenDocument, sendToOffscreen } from '../lib/utils/offscreen-manager'
import { OwnedDownloadTracker } from '../lib/downloads/owned-download-tracker'
import { isJourneyEventInput, type JourneyEventInput } from '../lib/observability/journey-events'
import { createJourneyRecorder } from '../lib/observability/journey-recorder'
import { RecordingCoordinator } from '../lib/recording/recording-coordinator'
import { createRecordingCountdownSurface } from '../lib/recording/recording-countdown-surface'
import { createRecordingSessionStore } from '../lib/recording/recording-session-store'
import {
  normalizeRecordingCountdown,
  persistRecordingCountdownSetting
} from '../lib/recording/recording-startup'
import { requestTabCaptureStreamId, resolveTabCaptureTargetId } from '../lib/recording/tab-capture'

const journeyRecorder = createJourneyRecorder(chrome.storage.session as any)
const ownedDownloadTracker = new OwnedDownloadTracker(chrome.storage.session as any)
const recordingSessionStore = createRecordingSessionStore(chrome.storage.session as any)
const recordingCoordinator = new RecordingCoordinator(recordingSessionStore)
const recordingCountdownSurface = createRecordingCountdownSurface({
  driver: {
    create: (data) => chrome.windows.create(data),
    remove: (windowId) => chrome.windows.remove(windowId)
  },
  getUrl: (path) => chrome.runtime.getURL(path)
})

let recordingCountdownHost: {
  operationId: string
  bounds: { left?: number; top?: number; width?: number; height?: number } | null
} | null = null

async function rememberRecordingCountdownHost(operationId: string) {
  let bounds = null
  try {
    const host = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
    bounds = {
      left: host.left,
      top: host.top,
      width: host.width,
      height: host.height
    }
  } catch {}
  recordingCountdownHost = { operationId, bounds }
}

function countdownHostBounds(operationId: string | null) {
  return operationId && recordingCountdownHost?.operationId === operationId
    ? recordingCountdownHost.bounds
    : null
}

async function hideRecordingCountdownSurface(operationId?: string | null) {
  await recordingCountdownSurface.hide(operationId)
  if (!operationId || recordingCountdownHost?.operationId === operationId) recordingCountdownHost = null
}

function recordJourneyEvent(input: JourneyEventInput) {
  void journeyRecorder.record(input).catch((error) => {
    console.warn('[JourneyObserver] Failed to persist event', error)
  })
}

function observeRuntimeJourney(message: any): JourneyEventInput | null {
  const mode = message?.payload?.options?.mode ?? message?.payload?.mode ?? message?.mode
  switch (message?.type) {
    case 'STREAM_START':
      return {
        name: 'recording.started',
        context: 'background',
        attributes: {
          mode: message?.mode,
          width: message?.metadata?.width,
          height: message?.metadata?.height,
          fps: message?.metadata?.framerate
        }
      }
    case 'STREAM_META':
      if (typeof message?.meta?.paused === 'boolean') {
        return {
          name: message.meta.paused ? 'recording.paused' : 'recording.resumed',
          context: 'background'
        }
      }
      return null
    case 'STREAM_ERROR':
      return {
        name: 'recording.failed',
        context: 'background',
        attributes: { outcome: 'failure', errorCode: message?.code || 'RECORDING_FAILED' }
      }
    default:
      return null
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === 'journey-observer') {
    if (message.type === 'JOURNEY_EVENT') {
      if (!isJourneyEventInput(message.event)) {
        try { sendResponse({ ok: false, error: 'INVALID_JOURNEY_EVENT' }) } catch {}
        return false
      }
      journeyRecorder.record(message.event)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, error: 'JOURNEY_STORAGE_FAILED' }))
      return true
    }
    if (message.type === 'GET_JOURNEY_EVENTS') {
      journeyRecorder.read()
        .then((state) => sendResponse({ ok: true, state }))
        .catch(() => sendResponse({ ok: false, error: 'JOURNEY_STORAGE_FAILED' }))
      return true
    }
    if (message.type === 'CLEAR_JOURNEY_EVENTS') {
      journeyRecorder.clear()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, error: 'JOURNEY_STORAGE_FAILED' }))
      return true
    }
    return false
  }

  const observed = observeRuntimeJourney(message)
  if (observed) recordJourneyEvent(observed)
  return false
})

const OFFSCREEN_REASONS = ['DISPLAY_MEDIA', 'USER_MEDIA', 'WORKERS', 'BLOBS']
const OFFSCREEN_ENSURE_TIMEOUT_MS = 10_000
const OFFSCREEN_START_TIMEOUT_MS = 45_000
const OFFSCREEN_CONTROL_TIMEOUT_MS = 10_000
const OFFSCREEN_PING_TIMEOUT_MS = 5_000

function getErrorMessage(error, fallback = 'Unknown error') {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}

function createErrorWithCode(message, code) {
  const error = new Error(message)
  if (code) error.code = code
  return error
}

function toErrorResponse(error) {
  const message = getErrorMessage(error)
  const code = typeof error?.code === 'string' && error.code.trim() ? error.code : undefined
  return code ? { ok: false, error: message, code } : { ok: false, error: message }
}


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

// Control window management
let controlWinId: number | null = null;
let controlWindowPromise: Promise<void> | null = null;

/**
 * Open or focus the Control window.  Reusable by:
 *  – OPEN_CONTROL_WINDOW message (from Launcher / Studio empty state)
 *  – chrome.action.onClicked fallback (if popup is not set)
 *
 * Uses a Promise-based mutex to prevent concurrent calls from creating
 * duplicate windows (e.g. rapid Action clicks or service-worker wake-up races).
 */
async function openOrFocusControlWindow(): Promise<void> {
  if (controlWindowPromise) {
    await controlWindowPromise;
    return;
  }
  controlWindowPromise = _openOrFocusControlWindowImpl();
  try {
    await controlWindowPromise;
  } finally {
    controlWindowPromise = null;
  }
}

async function _openOrFocusControlWindowImpl(): Promise<void> {
  // If control window exists, focus it
  if (controlWinId !== null) {
    try {
      await chrome.windows.update(controlWinId, { focused: true });
      return;
    } catch {
      controlWinId = null;
    }
  }

  // Recover from service worker restart: find any existing control.html popup windows
  try {
    const controlUrl = chrome.runtime.getURL('control.html');
    const allWindows = await chrome.windows.getAll({ populate: true });
    for (const win of allWindows) {
      if (win.type === 'popup' && win.tabs?.some(tab => tab.url?.startsWith(controlUrl))) {
        controlWinId = win.id!;
        await chrome.windows.update(controlWinId, { focused: true });
        return;
      }
    }
  } catch {
    // Window recovery failed, will create new window
  }

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
      focused: true,
    });

    if (win?.id) {
      controlWinId = win.id;
    }
  } catch (e) {
    console.error('Failed to open control window:', e);
  }
}

/**
 * Close ALL control.html popup windows (handles stale windows from prior sessions).
 */
async function closeAllControlWindows(): Promise<void> {
  const controlUrl = chrome.runtime.getURL('control.html');
  try {
    const allWindows = await chrome.windows.getAll({ populate: true });
    for (const win of allWindows) {
      if (win.type === 'popup' && win.id !== null && win.id !== undefined && win.tabs?.some(tab => tab.url?.startsWith(controlUrl))) {
        try { await chrome.windows.remove(win.id); } catch {}
      }
    }
  } catch {}
  controlWinId = null;
}

// Fallback: if manifest does not specify default_popup, keep action click working
chrome.action.onClicked.addListener(() => openOrFocusControlWindow());

// Clean up control window ID when window is closed
chrome.windows.onRemoved.addListener((windowId) => {
  recordingCountdownSurface.windowRemoved(windowId)
  if (windowId === controlWinId) {
    controlWinId = null;
  }
});

// 处理来自 sidepanel 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages explicitly targeted to another extension context to avoid echo/loops
  if (message?.target === 'offscreen-doc' || message?.target === 'journey-observer' || message?.target === 'recording-ui') {
    return false;
  }


  // 处理 lab 功能的消息类型
  if (message.type) {
    const tabId = sender.tab?.id ?? message.tabId;
    const globalTypes = new Set(['REQUEST_START_RECORDING','REQUEST_STOP_RECORDING','REQUEST_RECORDING_STATE','REQUEST_RECORDING_SESSION','REQUEST_TOGGLE_PAUSE','SET_RECORDING_COUNTDOWN','OFFSCREEN_START_RECORDING','OFFSCREEN_STOP_RECORDING','REQUEST_OFFSCREEN_PING','GET_RECORDING_STATE','RECORDING_COMPLETE','OPFS_RECORDING_READY','STREAM_START','STREAM_META','STREAM_END','STREAM_ERROR','BADGE_TICK','OPEN_CONTROL_WINDOW','OPEN_DRIVE','OPEN_LATEST_RECORDING']);
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
          if (!(typeof c === 'number' && c >= 0 && c <= 5)) {
            try {
              const stored = await new Promise<any>(res => chrome.storage.local.get(['settings'], r => res(r)));
              const v = stored?.settings?.countdownSeconds;
              if (typeof v === 'number' && v >= 0 && v <= 5) c = v;
            } catch {}
          }
          c = normalizeRecordingCountdown(c)
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
        const operationId = operationIdFromMessage(message) || currentRecording.operationId
        void hideRecordingCountdownSurface(operationId)
        void markRecordingFinalizing(operationId).catch((error) => {
          console.warn('[RecordingSession] Failed to enter finalizing state', error)
        })
        try {
          currentRecording.isRecording = false
          currentRecording.isPaused = false
          currentRecording.startTime = null
          currentRecording.elapsedMs = 0
        } catch {}
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
          const operationId = operationIdFromMessage(message) || currentRecording.operationId
          if (operationId) {
            void publishRecordingTransition(recordingCoordinator.finalized(operationId))
              .then(() => {
                if (currentRecording.operationId === operationId) currentRecording.operationId = null
              })
              .catch((error) => console.warn('[RecordingSession] Failed to finalize session', error))
          }
          const doOpen = () => {
            try {
              currentRecording.isRecording = false
              currentRecording.isPaused = false
              currentRecording.startTime = null
              currentRecording.elapsedMs = 0
            } catch {}
            try { void stopBadgeTimer() } catch {}
            try {
              const p = chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { recording: false } })
              if (p && typeof p.catch === 'function') p.catch(() => {})
            } catch {}
            // Close all control windows when recording completes to avoid stale windows
            void closeAllControlWindows()
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
        const operationId = operationIdFromMessage(message) || currentRecording.operationId
        void hideRecordingCountdownSurface(operationId)
        try {
          currentRecording.isRecording = true
          currentRecording.isPaused = false
          currentRecording.operationId = operationId
          currentRecording.startTime = typeof message?.metadata?.startTime === 'number' && message.metadata.startTime > 0
            ? message.metadata.startTime
            : typeof currentRecording.startTime === 'number' && currentRecording.startTime > 0
            ? currentRecording.startTime
            : Date.now()
          currentRecording.elapsedMs = 0
        } catch {}
        if (operationId) {
          void publishRecordingTransition(recordingCoordinator.streamStarted(operationId))
            .catch((error) => console.warn('[RecordingSession] Failed to mark stream started', error))
        }
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
        const operationId = operationIdFromMessage(message) || currentRecording.operationId
        if (meta && meta.preparing && typeof meta.countdown === 'number') {
          ;(async () => {
            try {
              if (operationId) {
                await publishRecordingTransition(recordingCoordinator.countdownChanged(operationId, meta.countdown))
              }

              // Action popups close when the system picker takes focus. Screen
              // and Window capture therefore use a short-lived independent
              // surface. The final zero tick waits for the window to close
              // before the capture owner crosses the formal frame boundary.
              if (operationId) {
                if (meta.countdown > 0) {
                  await recordingCountdownSurface.show({
                    operationId,
                    mode: meta.mode,
                    remaining: meta.countdown,
                    hostBounds: countdownHostBounds(operationId)
                  })
                } else {
                  await hideRecordingCountdownSurface(operationId)
                }
              } else if (meta.countdown <= 0) {
                await hideRecordingCountdownSurface()
              }

              // Keep the control page and countdown view synchronized. The
              // capture owner remains the only countdown clock.
              try {
                chrome.runtime.sendMessage({
                  target: 'recording-ui',
                  type: 'STREAM_META',
                  operationId,
                  meta: { preparing: true, countdown: meta.countdown, mode: meta.mode }
                }).catch(() => {})
              } catch {}
              try { sendResponse({ ok: true }) } catch {}
            } catch (error) {
              console.warn('[RecordingSession] Failed to present countdown', error)
              try { sendResponse({ ok: false, error: String(error) }) } catch {}
            }
          })()
          return true;
        }
        if (meta && typeof meta.paused === 'boolean') {
          try { currentRecording.isPaused = !!meta.paused } catch {}
          if (operationId) {
            void publishRecordingTransition(recordingCoordinator.pauseChanged(
              operationId,
              !!meta.paused,
              currentRecording.elapsedMs
            )).catch((error) => console.warn('[RecordingSession] Failed to update pause state', error))
          }
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
          try { currentRecording.elapsedMs = elapsed } catch {}
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
        const operationId = operationIdFromMessage(message) || currentRecording.operationId
        void hideRecordingCountdownSurface(operationId)
        void markRecordingFinalizing(operationId).catch((error) => {
          console.warn('[RecordingSession] Failed to handle stream end', error)
        })
        try {
          currentRecording.isRecording = false
          currentRecording.isPaused = false
          currentRecording.startTime = null
          currentRecording.elapsedMs = 0
        } catch {}
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
        const operationId = operationIdFromMessage(message) || currentRecording.operationId
        void hideRecordingCountdownSurface(operationId)
        const errorCode = typeof message?.code === 'string' && message.code.trim()
          ? message.code
          : 'RECORDING_FAILED'
        void markRecordingFailed(operationId, errorCode).catch((error) => {
          console.warn('[RecordingSession] Failed to persist recording error', error)
        })
        try {
          currentRecording.isRecording = false
          currentRecording.isPaused = false
          currentRecording.startTime = null
          currentRecording.elapsedMs = 0
        } catch {}
        disableTabAnnotation()
        currentRecording.tabId = null
        currentRecording.mode = null
        currentRecording.operationId = operationId
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
          const raw = (message?.payload?.options && typeof message.payload.options === 'object')
            ? { ...message.payload.options }
            : (message?.payload && typeof message.payload === 'object')
              ? { ...message.payload }
              : {}
          let acceptedOperationId: string | null = null
          try {
            // Inject countdown from storage if missing / invalid
            let c = raw?.countdown
            if (!(typeof c === 'number' && c >= 0 && c <= 5)) {
              try {
                const stored = await new Promise<any>(res => chrome.storage.local.get(['settings'], r => res(r)));
                const v = stored?.settings?.countdownSeconds;
                if (typeof v === 'number' && v >= 0 && v <= 5) c = v; else c = 3;
              } catch { c = 3 }
            }
            raw.countdown = normalizeRecordingCountdown(c)
            const mode = (raw?.mode === 'tab' || raw?.mode === 'window' || raw?.mode === 'screen')
              ? raw.mode
              : 'screen'
            const started = await recordingCoordinator.requestStart(mode)
            if (!started.accepted || !started.state.operationId) {
              try {
                sendResponse({
                  ok: false,
                  error: 'A recording is already in progress',
                  code: 'RECORDING_BUSY',
                  state: started.state
                })
              } catch {}
              return
            }
            const operationId = started.state.operationId
            acceptedOperationId = operationId
            broadcastRecordingSession(started.state)
            recordJourneyEvent({ name: 'recording.requested', context: 'background', attributes: { mode } })
            // Countdown should open only after user grants capture permission (stream ready)
            // Offscreen will trigger via STREAM_META once stream is available
            await startRecordingViaOffscreen(raw, operationId)
            const state = await recordingCoordinator.getState()
            try { sendResponse({ ok: true, state }) } catch (e) {}
          } catch (e) {
            const operationId = acceptedOperationId
            if (operationId) {
              const code = typeof e?.code === 'string' && e.code.trim() ? e.code : 'RECORDING_FAILED'
              await markRecordingFailed(operationId, code).catch(() => null)
            }
            try { sendResponse(toErrorResponse(e)) } catch (_) {}
          }
        })()
        return true;
      }
      case 'SET_RECORDING_COUNTDOWN': {
        persistRecordingCountdownSetting({
          get: (keys) => chrome.storage.local.get(keys),
          set: (value) => chrome.storage.local.set(value)
        }, message?.value)
          .then((countdownSeconds) => sendResponse({ ok: true, countdownSeconds }))
          .catch(() => sendResponse({ ok: false, error: 'COUNTDOWN_STORAGE_FAILED' }))
        return true
      }
      case 'REQUEST_STOP_RECORDING': {
        // Only handle stop requests from popup, not OFFSCREEN_STOP_RECORDING
        // OFFSCREEN_STOP_RECORDING is sent TO offscreen, not FROM it
        (async () => {
          try {
            const state = await recordingCoordinator.getState()
            if (!state.operationId) {
              try { sendResponse({ ok: false, error: 'No active recording', code: 'NO_ACTIVE_RECORDING', state }) } catch {}
              return
            }
            const stopping = await publishRecordingTransition(recordingCoordinator.stopRequested(
              state.operationId,
              currentRecording.elapsedMs || state.elapsedMs
            ))
            if (!stopping.accepted) {
              try { sendResponse({ ok: false, error: 'Recording cannot be stopped in its current state', code: 'INVALID_RECORDING_STATE', state: stopping.state }) } catch {}
              return
            }
            await hideRecordingCountdownSurface(state.operationId)
            recordJourneyEvent({ name: 'recording.stop_requested', context: 'background' })
            await stopRecordingViaOffscreen()
            try { sendResponse({ ok: true, state: await recordingCoordinator.getState() }) } catch (e) {}
          } catch (e) {
            try { sendResponse(toErrorResponse(e)) } catch (_) {}
          }
        })()
        return true;
      }
      case 'REQUEST_OFFSCREEN_PING': {
        (async () => {
          try {
            const resp = await sendToOffscreen(
              { target: 'offscreen-doc', type: 'OFFSCREEN_PING', when: Date.now() },
              { url: 'offscreen.html', reasons: OFFSCREEN_REASONS, timeoutMs: OFFSCREEN_ENSURE_TIMEOUT_MS, messageTimeoutMs: OFFSCREEN_PING_TIMEOUT_MS }
            )
            if (resp?.ok !== true) {
              throw createErrorWithCode(resp?.error || 'Offscreen ping failed', resp?.code)
            }
            try { sendResponse({ ok: true }) } catch (e) {}
          } catch (e) {
            try { sendResponse(toErrorResponse(e)) } catch (_) {}
          }
        })()
        return true;
      }

      case 'REQUEST_RECORDING_STATE':
      case 'GET_RECORDING_STATE': {
        (async () => {
          try {
            const session = await recordingCoordinator.getState()
            sendResponse({ ok: true, state: legacyStateFromSession(session), session })
          } catch (e) {
            sendResponse(toErrorResponse(e))
          }
        })()
        return true;
      }

      case 'REQUEST_RECORDING_SESSION': {
        (async () => {
          try { sendResponse({ ok: true, state: await recordingCoordinator.getState() }) }
          catch (e) { sendResponse(toErrorResponse(e)) }
        })()
        return true;
      }

      case 'REQUEST_TOGGLE_PAUSE': {
        (async () => {
          try {
            const session = await recordingCoordinator.getState()
            if (!session.operationId || (session.phase !== 'recording' && session.phase !== 'paused')) {
              try { sendResponse({ ok: false, error: 'No recording can be paused', code: 'INVALID_RECORDING_STATE', state: session }) } catch {}
              return
            }
            // Control offscreen recording pause for Tab/Window/Screen modes
            const newPaused = session.phase !== 'paused'
            const resp = await sendToOffscreen(
              { target: 'offscreen-doc', type: 'OFFSCREEN_TOGGLE_PAUSE', payload: { paused: newPaused, operationId: session.operationId } },
              { url: 'offscreen.html', reasons: OFFSCREEN_REASONS, timeoutMs: OFFSCREEN_ENSURE_TIMEOUT_MS, messageTimeoutMs: OFFSCREEN_CONTROL_TIMEOUT_MS }
            )
            if (resp?.ok !== true) {
              throw createErrorWithCode(resp?.error || 'Failed to toggle pause', resp?.code)
            }
            currentRecording.isPaused = newPaused
            const transition = await publishRecordingTransition(recordingCoordinator.pauseChanged(
              session.operationId,
              newPaused,
              currentRecording.elapsedMs || session.elapsedMs
            ))
            try { sendResponse({ ok: true, paused: newPaused, state: transition.state }) } catch (e) {}
          } catch (e) {
            try { sendResponse(toErrorResponse(e)) } catch (_) {}
          }
        })()
        return true;
      }

      // ---- Launcher / entry messages ----
      case 'OPEN_CONTROL_WINDOW': {
        (async () => {
          try {
            await openOrFocusControlWindow()
            try { sendResponse({ ok: true }) } catch {}
          } catch (e) {
            try { sendResponse({ ok: false, error: String(e) }) } catch {}
          }
        })()
        return true;
      }

      case 'OPEN_DRIVE': {
        (async () => {
          try {
            const driveUrl = chrome.runtime.getURL('drive.html')
            await chrome.tabs.create({ url: driveUrl })
            try { sendResponse({ ok: true }) } catch {}
          } catch (e) {
            try { sendResponse({ ok: false, error: String(e) }) } catch {}
          }
        })()
        return true;
      }

      case 'OPEN_LATEST_RECORDING': {
        // Open Studio with the latest recording, or empty Studio if none exists.
        // The actual "latest recording" resolution is done by Studio itself –
        // background just opens studio.html (without id) and lets Studio perform
        // the OPFS lookup in its own page context where OPFS is fully available.
        (async () => {
          try {
            const studioUrl = chrome.runtime.getURL('studio.html')
            await chrome.tabs.create({ url: studioUrl })
            try { sendResponse({ ok: true }) } catch {}
          } catch (e) {
            try { sendResponse({ ok: false, error: String(e) }) } catch {}
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
        void ownedDownloadTracker.trackStarted(downloadId)
          .then((event) => {
            if (event) recordJourneyEvent(event)
          })
          .catch((error) => {
            console.warn('[JourneyObserver] Failed to track owned download', error)
          })
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

// 仅处理本扩展创建的下载终态，避免把浏览器中的其他下载计入旅程
chrome.downloads.onChanged.addListener((downloadDelta) => {
  void ownedDownloadTracker.observeChange(downloadDelta)
    .then((event) => {
      if (!event) return
      recordJourneyEvent(event)

      if (event.name === 'download.completed') {
        // 保留现有 UI 通知；没有打开接收页面时忽略错误
        void chrome.runtime.sendMessage({
          action: 'downloadComplete',
          downloadId: downloadDelta.id
        }).catch(() => {})
      }
    })
    .catch((error) => {
      console.warn('[JourneyObserver] Failed to observe owned download', error)
    })
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
  elapsedMs: 0,
  tabId: null as number | null,
  mode: null as string | null,
  operationId: null as string | null
}

function broadcastRecordingSession(state) {
  try {
    const response = chrome.runtime.sendMessage({
      target: 'recording-ui',
      type: 'RECORDING_SESSION_UPDATED',
      state
    })
    if (response && typeof response.catch === 'function') response.catch(() => {})
  } catch {}
}

async function publishRecordingTransition(transitionPromise) {
  const result = await transitionPromise
  if (result?.accepted) broadcastRecordingSession(result.state)
  return result
}

function operationIdFromMessage(message): string | null {
  return typeof message?.operationId === 'string' && message.operationId.trim()
    ? message.operationId
    : null
}

async function markRecordingFinalizing(operationId: string | null) {
  if (!operationId) return null
  const current = await recordingCoordinator.getState()
  if (current.operationId !== operationId) return null
  if (current.phase === 'requesting' || current.phase === 'countdown' || current.phase === 'recording' || current.phase === 'paused') {
    await publishRecordingTransition(recordingCoordinator.stopRequested(operationId, currentRecording.elapsedMs || current.elapsedMs))
  }
  return publishRecordingTransition(recordingCoordinator.finalizingStarted(operationId))
}

async function markRecordingFailed(operationId: string | null, errorCode: string) {
  if (!operationId) return null
  return publishRecordingTransition(recordingCoordinator.failed(operationId, errorCode || 'RECORDING_FAILED'))
}

function legacyStateFromSession(session) {
  const isRecording = session.phase === 'recording' || session.phase === 'paused' || session.phase === 'stopping' || session.phase === 'finalizing'
  const isPaused = session.phase === 'paused'
  const runningElapsed = session.phase === 'recording'
    ? session.elapsedMs + Math.max(0, Date.now() - session.updatedAt)
    : session.elapsedMs
  return {
    ...currentRecording,
    isRecording,
    isPaused,
    mode: session.mode,
    operationId: session.operationId,
    elapsedMs: Math.max(currentRecording.elapsedMs || 0, runningElapsed),
    startTime: isRecording && !isPaused
      ? Date.now() - Math.max(currentRecording.elapsedMs || 0, runningElapsed)
      : currentRecording.startTime,
    session
  }
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
async function startRecordingViaOffscreen(options, operationId: string) {
  try {
    const mode = (options?.mode === 'tab' || options?.mode === 'window' || options?.mode === 'screen') ? options.mode : 'screen'
    const normalizedOptions = {
      mode,
      video: options?.video ?? true,
      audio: options?.audio ?? false,
      countdown: normalizeRecordingCountdown(options?.countdown),
      operationId
    }

    if ((mode === 'screen' || mode === 'window') && normalizedOptions.countdown > 0) {
      await rememberRecordingCountdownHost(operationId)
    } else {
      recordingCountdownHost = null
    }

    let targetTabId: number | null = null
    if (mode === 'tab') {
      const invokingTabId = resolveTabCaptureTargetId(options?.targetTabId, null)
      const fallbackTabId = invokingTabId == null ? await resolveTargetTabId() : null
      targetTabId = resolveTabCaptureTargetId(invokingTabId, fallbackTabId)
    }

    // Persist the accepted operation before offscreen can emit STREAM_META or
    // STREAM_START. Never overwrite this object after awaiting offscreen: the
    // stream-start fact may arrive before the request response.
    currentRecording = {
      isRecording: false,
      isPaused: false,
      streamId: 'offscreen',
      startTime: null,
      elapsedMs: 0,
      tabId: targetTabId,
      mode,
      operationId
    }

    let tabStreamId: string | undefined
    if (mode === 'tab') {
      // Chrome's supported MV3 path is: ensure the offscreen consumer, obtain a
      // one-time tabCapture id in the service worker, then consume it
      // immediately with getUserMedia in the offscreen document.
      const ensured = await ensureOffscreenDocument({
        url: 'offscreen.html',
        reasons: OFFSCREEN_REASONS,
        timeoutMs: OFFSCREEN_ENSURE_TIMEOUT_MS
      })
      if (!ensured.success) {
        throw createErrorWithCode(ensured.error || 'Failed to prepare background recording', 'OFFSCREEN_UNAVAILABLE')
      }
      tabStreamId = await requestTabCaptureStreamId(chrome.tabCapture, targetTabId)
    }

    const resp = await sendToOffscreen(
      {
        target: 'offscreen-doc',
        type: 'OFFSCREEN_START_RECORDING',
        payload: {
          options: normalizedOptions,
          ...(tabStreamId ? { streamId: tabStreamId } : {})
        },
        operationId
      },
      { url: 'offscreen.html', reasons: OFFSCREEN_REASONS, timeoutMs: OFFSCREEN_ENSURE_TIMEOUT_MS, messageTimeoutMs: OFFSCREEN_START_TIMEOUT_MS }
    )
    if (resp?.ok !== true) {
      throw createErrorWithCode(resp?.error || 'Failed to start recording', resp?.code)
    }
    try { await chrome.action.setBadgeBackgroundColor({ color: '#fb8c00' }) } catch {}
    try { await chrome.action.setBadgeText({ text: '' }) } catch {}
    if (mode === 'tab' && targetTabId != null) {
      await enableTabAnnotation(targetTabId)
    }
  } catch (e) {
    await hideRecordingCountdownSurface(operationId).catch(() => {})
    if (typeof e?.code === 'string' && e.code.startsWith('TAB_CAPTURE_')) {
      const cause = e?.cause
      console.warn('[TabCapture] Failed to acquire current-tab stream id', {
        code: e.code,
        causeName: typeof cause?.name === 'string' ? cause.name : undefined,
        causeMessage: getErrorMessage(cause, 'No browser diagnostic was provided')
      })
    }
    // keep state unchanged on failure
    throw e
  }
}

async function stopRecordingViaOffscreen() {
  const resp = await sendToOffscreen(
    { target: 'offscreen-doc', type: 'OFFSCREEN_STOP_RECORDING', operationId: currentRecording.operationId },
    { url: 'offscreen.html', reasons: OFFSCREEN_REASONS, timeoutMs: OFFSCREEN_ENSURE_TIMEOUT_MS, messageTimeoutMs: OFFSCREEN_CONTROL_TIMEOUT_MS }
  )
  if (resp?.ok !== true) {
    throw createErrorWithCode(resp?.error || 'Failed to stop recording', resp?.code)
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
      elapsedMs: 0,
      tabId: message.tabId ?? null,
      mode: null,
      operationId: null
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
      elapsedMs: 0,
      tabId: null,
      mode: null,
      operationId: null
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
