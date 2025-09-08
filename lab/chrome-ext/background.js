// background.js - service worker for routing messages and managing per-tab state

const tabStates = new Map(); // tabId -> { mode: 'element'|'region', selecting: boolean, recording: boolean }

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MVP] extension installed');
  // 自动在点击扩展图标时打开 Side Panel（Chrome 116+）
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (e) {
    console.warn('setPanelBehavior failed', e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? msg.tabId;
  if (!tabId) return;

  // Ensure state
  if (!tabStates.has(tabId)) tabStates.set(tabId, { mode: 'element', selecting: false, recording: false });
  const state = tabStates.get(tabId);

  switch (msg.type) {
    case 'GET_STATE':
      sendResponse({ ok: true, state });
      return true;

    case 'SET_MODE':
      state.mode = msg.mode === 'region' ? 'region' : 'element';
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

    case 'CONTENT_REPORT':
      // pass-through updates to side panel
      broadcastToTab(tabId, { type: 'STATE_UPDATE', state: { ...state, ...msg.partial } });
      return true;

    default:
      break;
  }
});

function broadcastToTab(tabId, payload) {
  chrome.runtime.sendMessage({ ...payload, tabId });
}

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