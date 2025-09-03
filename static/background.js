// Chrome 扩展 Service Worker
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id })
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'requestScreenCapture') {
    const sources = message.sources || ['screen', 'window', 'tab']
    
    const requestId = chrome.desktopCapture.chooseDesktopMedia(
      sources,
      (streamId, options) => {
        sendResponse({ 
          streamId, 
          canRequestAudioTrack: options.canRequestAudioTrack 
        })
      }
    )
    
    // 处理取消情况
    if (!requestId) {
      sendResponse({ error: 'DESKTOP_CAPTURE_CANCELLED' })
    }
    
    return true // 保持消息通道开放
  }
})