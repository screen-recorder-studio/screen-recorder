let countdownWinId = null;

chrome.action.onClicked.addListener(() => {
  if (countdownWinId) {
    chrome.windows.update(countdownWinId, { focused: true }, () => {
      if (chrome.runtime.lastError) countdownWinId = null;
    });
    return;
  }
  const popupWidth = 260;
  const popupHeight = 180;
  chrome.windows.getCurrent(current => {
    let left, top;
    if (current && typeof current.left === 'number' && typeof current.top === 'number') {
      left = current.left + Math.max(0, Math.round((current.width - popupWidth) / 2));
      top = current.top + Math.max(0, Math.round((current.height - popupHeight) / 2));
    }
    chrome.windows.create({
      url: chrome.runtime.getURL('countdown.html'),
      type: 'popup',
      width: popupWidth,
      height: popupHeight,
      left,
      top,
      focused: true
    }, win => {
      if (win && win.id) countdownWinId = win.id;
    });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'closeCountdown' && countdownWinId) {
    chrome.windows.remove(countdownWinId, () => { countdownWinId = null; });
  }
});

chrome.windows.onRemoved.addListener(id => { if (id === countdownWinId) countdownWinId = null; });
