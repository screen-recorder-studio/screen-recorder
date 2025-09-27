chrome.action.onClicked.addListener(() => {
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
    });
  });
});
