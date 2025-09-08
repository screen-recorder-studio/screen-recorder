// sidepanel.js

const enterSelBtn = document.getElementById('enterSel');
const exitSelBtn = document.getElementById('exitSel');
const startCapBtn = document.getElementById('startCap');
const stopCapBtn = document.getElementById('stopCap');
const clearSelBtn = document.getElementById('clearSel');
const apiStatusEl = document.getElementById('apiStatus');
const selInfoEl = document.getElementById('selInfo');
const recStatusEl = document.getElementById('recStatus');

const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
const hasExt = (typeof chrome !== 'undefined' && chrome?.runtime && chrome?.tabs);

function getActiveTabId() {
  if (!hasExt) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id);
    });
  });
}

function updateApiStatus() {
  if (!hasExt) {
    apiStatusEl.textContent = '预览模式：无 Chrome 扩展 API 环境';
    return;
  }
  const caps = window.__mcp_caps;
  if (!caps) {
    apiStatusEl.textContent = '等待页面脚本报告能力...';
    return;
  }
  const parts = [];
  parts.push(`getDisplayMedia: ${caps.getDisplayMedia ? '✓' : '×'}`);
  parts.push(`RestrictionTarget: ${caps.restrictionTarget ? '✓' : '×'}`);
  parts.push(`CropTarget: ${caps.cropTarget ? '✓' : '×'}`);
  apiStatusEl.textContent = parts.join(' | ');
}

async function sendToBackground(type, extra = {}) {
  if (!hasExt) return;
  const tabId = await getActiveTabId();
  return chrome.runtime.sendMessage({ type, tabId, ...extra });
}

async function init() {
  updateApiStatus();
  if (!hasExt) {
    setUIState({ mode: 'element', selecting: false, recording: false });
    setModeInputs('element');
    return;
  }
  const tabId = await getActiveTabId();
  chrome.runtime.sendMessage({ type: 'GET_STATE', tabId }, (resp) => {
    const st = resp?.state || { mode: 'element', selecting: false, recording: false };
    setUIState(st);
    setModeInputs(st.mode);
  });
}

function setModeInputs(mode) {
  modeInputs.forEach((i) => i.checked = (i.value === mode));
}

function setUIState(state) {
  selInfoEl.textContent = state.selectedDesc ? `已选：${state.selectedDesc}` : '未选择';
  recStatusEl.textContent = state.recording ? '录制中' : '未录制';
  startCapBtn.disabled = !!state.recording;
  stopCapBtn.disabled = !state.recording;
}

modeInputs.forEach((input) => {
  input.addEventListener('change', async () => {
    await sendToBackground('SET_MODE', { mode: input.value });
  });
});

enterSelBtn.addEventListener('click', async () => {
  await sendToBackground('ENTER_SELECTION');
});
exitSelBtn.addEventListener('click', async () => {
  await sendToBackground('EXIT_SELECTION');
});
startCapBtn.addEventListener('click', async () => {
  await sendToBackground('START_CAPTURE');
});
stopCapBtn.addEventListener('click', async () => {
  await sendToBackground('STOP_CAPTURE');
});
clearSelBtn.addEventListener('click', async () => {
  await sendToBackground('CLEAR_SELECTION');
});

if (hasExt) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_UPDATE') {
      const st = msg.state || {};
      if (st.capabilities) {
        window.__mcp_caps = st.capabilities;
        updateApiStatus();
      }
      setUIState(st);
      if (st.mode) setModeInputs(st.mode);
    }
  });
}

init();