// Chrome 扩展 Service Worker
console.log('Screen Recorder Extension Service Worker loaded')

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
  console.log('Received message:', message.action, message)

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

// 错误处理
self.addEventListener('error', (event) => {
  console.error('Service Worker error:', event.error)
})

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker unhandled rejection:', event.reason)
})