// Background Service Worker for SaaS Video Recorder
// 处理扩展的后台逻辑和权限管理

// 录制状态管理
let recordingState = {
  isRecording: false,
  startTime: null,
  timerInterval: null
};

// 扩展安装时的初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('SaaS Video Recorder extension installed');
  // 设置初始badge
  chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
});

// 处理来自popup的消息
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case 'requestScreenCapture':
      handleScreenCaptureRequest(sendResponse);
      return true; // 保持消息通道开放以进行异步响应

    case 'startRecording':
      startRecordingTimer();
      sendResponse({ success: true });
      break;

    case 'stopRecording':
      stopRecordingTimer();
      sendResponse({ success: true });
      break;

    case 'downloadVideo':
      handleVideoDownload(request.data, sendResponse);
      return true;

    default:
      console.warn('Unknown action:', request.action);
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

// 处理屏幕录制权限请求
async function handleScreenCaptureRequest(sendResponse) {
  try {
    console.log('Requesting screen capture permission...');

    // 获取当前活动标签页
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    if (!currentTab) {
      throw new Error('无法获取当前标签页信息');
    }

    console.log('Current tab:', currentTab.id, currentTab.url);

    // 请求屏幕录制权限
    // 重要：必须保持popup窗口打开，否则权限对话框会立即关闭
    const streamId = await new Promise((resolve, reject) => {
      // 使用chrome.desktopCapture.chooseDesktopMedia
      // 第一个参数是媒体源类型数组
      // 第二个参数是targetTab（可选）
      // 第三个参数是回调函数
      chrome.desktopCapture.chooseDesktopMedia(
        ['screen', 'window', 'tab'], // 提供所有选项
        currentTab, // 目标标签页
        (streamId) => {
          if (chrome.runtime.lastError) {
            console.error('desktopCapture error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (streamId) {
            console.log('Screen capture permission granted, streamId:', streamId);
            resolve(streamId);
          } else {
            console.log('User cancelled screen capture request');
            reject(new Error('用户取消了屏幕录制权限请求'));
          }
        }
      );
    });

    // 保存streamId供后续使用（如果storage API可用）
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ currentStreamId: streamId }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to save streamId:', chrome.runtime.lastError);
        }
      });
    } else {
      console.warn('chrome.storage.local is not available');
    }
    
    sendResponse({ success: true, streamId });

  } catch (error) {
    console.error('Screen capture request failed:', error);
    sendResponse({
      success: false,
      error: error.message || '屏幕录制权限请求失败'
    });
  }
}

// 开始录制计时器
function startRecordingTimer() {
  console.log('Starting recording timer');
  recordingState.isRecording = true;
  recordingState.startTime = Date.now();
  
  // 立即显示REC标记
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
  
  // 清除之前的计时器（如果有）
  if (recordingState.timerInterval) {
    clearInterval(recordingState.timerInterval);
  }
  
  // 每秒更新badge显示录制时间
  recordingState.timerInterval = setInterval(() => {
    if (recordingState.isRecording && recordingState.startTime) {
      const elapsed = Math.floor((Date.now() - recordingState.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      
      // 格式化时间显示
      let badgeText = '';
      if (minutes > 0) {
        badgeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      } else {
        badgeText = `${seconds}s`;
      }
      
      chrome.action.setBadgeText({ text: badgeText });
    }
  }, 1000);
}

// 停止录制计时器
function stopRecordingTimer() {
  console.log('Stopping recording timer');
  recordingState.isRecording = false;
  recordingState.startTime = null;
  
  // 清除计时器
  if (recordingState.timerInterval) {
    clearInterval(recordingState.timerInterval);
    recordingState.timerInterval = null;
  }
  
  // 清除badge
  chrome.action.setBadgeText({ text: '' });
}

// 处理视频文件下载
async function handleVideoDownload(videoData, sendResponse) {
  try {
    const { blobUrl, filename } = videoData;
    
    if (!blobUrl || !filename) {
      throw new Error('缺少必要的下载参数');
    }

    console.log('Starting download:', filename);

    // 触发下载
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: filename,
      saveAs: false
    });

    console.log('Download started with ID:', downloadId);
    sendResponse({ success: true, downloadId });
    
  } catch (error) {
    console.error('Video download failed:', error);
    sendResponse({ 
      success: false, 
      error: error.message || '下载失败'
    });
  }
}
