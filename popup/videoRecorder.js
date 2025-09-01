// Video Recorder Module
// 处理屏幕录制逻辑

class VideoRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.stream = null;
    this.isInitialized = false;
  }
  
  // 初始化录制器
  async initialize() {
    try {
      if (this.isInitialized) {
        return;
      }
      
      // 检查浏览器支持
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('浏览器不支持屏幕录制功能');
      }
      
      if (!window.MediaRecorder) {
        throw new Error('浏览器不支持MediaRecorder API');
      }
      
      this.isInitialized = true;
      console.log('VideoRecorder initialized successfully');
      
    } catch (error) {
      console.error('VideoRecorder initialization failed:', error);
      throw error;
    }
  }
  
  // 请求屏幕录制权限并开始录制
  async startTabRecording() {
    try {
      await this.initialize();
      
      // 请求屏幕录制权限
      console.log('=== Starting screen capture request ===');
      this.stream = await this.requestScreenCapture();
      console.log('=== Screen capture request completed ===');
      
      if (!this.stream) {
        throw new Error('无法获取屏幕录制流');
      }
      
      // 验证流是否有效
      this.validateStream(this.stream);
      
      // 设置录制选项
      const options = {
        mimeType: this.getSupportedMimeType(),
        videoBitsPerSecond: 2500000 // 2.5 Mbps
      };
      
      // 创建MediaRecorder实例
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.recordedChunks = [];
      
      // 设置事件监听器
      this.setupMediaRecorderEvents();
      
      // 开始录制并等待录制真正开始
      await this.startMediaRecorder();
      
      console.log('Screen recording started successfully');
      
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.cleanup();
      throw error;
    }
  }
  
  // 请求屏幕录制权限
  async requestScreenCapture() {
    try {
      // 首先尝试通过background script获取权限
      const response = await this.requestPermissionFromBackground();
      
      if (response.success && response.streamId) {
        console.log('StreamId received:', response.streamId);
        
        // Chrome扩展需要特殊的约束格式
        // 注意：mandatory格式在新版Chrome中已弃用，但在扩展中仍需要
        const constraints = {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: response.streamId
            }
          }
        };
        
        console.log('Requesting media stream with constraints:', constraints);
        
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('Got media stream successfully:', stream);
          console.log('Stream ID:', stream.id);
          console.log('Stream active:', stream.active);
          console.log('Video tracks:', stream.getVideoTracks().length);
          return stream;
        } catch (mediaError) {
          console.error('getUserMedia failed with mandatory constraints:', mediaError);
          console.error('Error name:', mediaError.name);
          console.error('Error message:', mediaError.message);
          console.error('Error stack:', mediaError.stack);
          
          // 尝试备用约束格式
          console.log('Trying alternative constraints format...');
          const altConstraints = {
            audio: false,
            video: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: response.streamId
            }
          };
          
          console.log('Alternative constraints:', altConstraints);
          
          try {
            const stream = await navigator.mediaDevices.getUserMedia(altConstraints);
            console.log('Got media stream with alternative constraints:', stream);
            console.log('Stream active:', stream.active);
            console.log('Video tracks:', stream.getVideoTracks().length);
            return stream;
          } catch (altError) {
            console.error('Alternative constraints also failed:', altError);
            console.error('Alt error name:', altError.name);
            console.error('Alt error message:', altError.message);
            
            // 尝试最简单的约束
            console.log('Trying simplest constraints...');
            const simpleConstraints = {
              video: {
                chromeMediaSourceId: response.streamId
              }
            };
            console.log('Simple constraints:', simpleConstraints);
            
            const stream = await navigator.mediaDevices.getUserMedia(simpleConstraints);
            console.log('Got media stream with simple constraints:', stream);
            return stream;
          }
        }
      } else {
        throw new Error(response.error || '权限请求失败');
      }
      
    } catch (error) {
      console.error('Screen capture request failed:', error);
      throw new Error('屏幕录制权限请求失败: ' + error.message);
    }
  }
  
  // 通过background script请求权限
  async requestPermissionFromBackground() {
    return new Promise((resolve) => {
      console.log('Sending screen capture request to background script...');
      
      chrome.runtime.sendMessage(
        { action: 'requestScreenCapture' },
        (response) => {
          console.log('Background script response:', response);
          
          if (chrome.runtime.lastError) {
            console.error('Chrome runtime error:', chrome.runtime.lastError);
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          
          resolve(response || { success: false, error: '无响应' });
        }
      );
    });
  }
  
  // 获取支持的MIME类型
  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('Using MIME type:', type);
        return type;
      }
    }
    
    console.warn('No supported MIME type found, using default');
    return 'video/webm';
  }
  
  // 设置MediaRecorder事件监听器
  setupMediaRecorderEvents() {
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
        console.log('Recorded chunk:', event.data.size, 'bytes');
      }
    };
    
    this.mediaRecorder.onstart = () => {
      console.log('MediaRecorder onstart event fired');
      console.log('MediaRecorder state:', this.mediaRecorder.state);
      console.log('Stream active:', this.stream ? this.stream.active : 'no stream');
      
      // 通知UI录制已开始
      if (window.popupController) {
        console.log('Notifying popup controller that recording started');
        // 确保UI更新不会被遗漏
        setTimeout(() => {
          window.popupController.onRecordingStarted();
        }, 0);
      }
    };
    
    this.mediaRecorder.onstop = () => {
      console.log('MediaRecorder stopped');
    };
    
    this.mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
      // 通知UI录制出错
      if (window.popupController) {
        window.popupController.handleError('录制过程中发生错误: ' + event.error.message, event.error);
      }
    };
    
    // 监听流结束事件（用户可能手动停止了屏幕共享）
    if (this.stream) {
      console.log('Setting up stream event listeners...');
      this.stream.getVideoTracks().forEach((track, index) => {
        console.log(`Video track ${index}:`, track.label, track.readyState);
        
        track.onended = () => {
          console.log('Screen sharing ended by user');
          this.handleStreamEnded();
        };
        
        track.onmute = () => {
          console.log('Video track muted');
        };
        
        track.onunmute = () => {
          console.log('Video track unmuted');
        };
      });
    }
  }
  
  // 处理流结束事件
  handleStreamEnded() {
    console.log('Stream ended, MediaRecorder state:', this.mediaRecorder?.state);
    console.log('Recorded chunks count:', this.recordedChunks?.length || 0);
    
    // 如果MediaRecorder还在录制，先停止它
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      console.log('Stopping MediaRecorder due to stream end');
      this.mediaRecorder.stop();
    }
    
    // 通知UI录制已结束（用户手动停止了屏幕共享）
    if (window.popupController) {
      // 延迟一下，确保MediaRecorder的onstop事件已经触发
      setTimeout(() => {
        window.popupController.handleRecordingEnded();
      }, 100);
    }
  }
  
  // 停止录制并返回视频数据
  async stopRecording() {
    try {
      if (!this.mediaRecorder) {
        throw new Error('录制器未初始化');
      }
      
      // 如果录制器已经是inactive状态（例如用户点击了Stop Share）
      // 但我们有录制的数据，就直接返回这些数据
      if (this.mediaRecorder.state === 'inactive') {
        if (this.recordedChunks && this.recordedChunks.length > 0) {
          console.log('MediaRecorder already stopped, but we have recorded data');
          const videoBlob = new Blob(this.recordedChunks, {
            type: this.getSupportedMimeType()
          });
          console.log('Returning existing recording, size:', videoBlob.size, 'bytes');
          return videoBlob;
        } else {
          throw new Error('录制器未在录制状态且没有可用的录制数据');
        }
      }
      
      // 正常停止录制
      return new Promise((resolve, reject) => {
        this.mediaRecorder.onstop = () => {
          try {
            // 创建视频Blob
            const videoBlob = new Blob(this.recordedChunks, {
              type: this.getSupportedMimeType()
            });
            
            console.log('Recording completed, video size:', videoBlob.size, 'bytes');
            resolve(videoBlob);
            
          } catch (error) {
            reject(error);
          }
        };
        
        this.mediaRecorder.stop();
      });
      
    } catch (error) {
      console.error('Failed to stop recording:', error);
      throw error;
    }
  }
  
  // 获取录制状态
  getRecordingState() {
    return this.mediaRecorder ? this.mediaRecorder.state : 'inactive';
  }
  
  // 启动MediaRecorder并等待开始
  async startMediaRecorder() {
    return new Promise((resolve, reject) => {
      let isResolved = false;
      
      // 修改现有的onstart事件处理器
      const originalOnStart = this.mediaRecorder.onstart;
      this.mediaRecorder.onstart = (event) => {
        console.log('MediaRecorder started successfully');
        
        // 调用原始的onstart处理器
        if (originalOnStart) {
          originalOnStart(event);
        }
        
        // 只resolve一次
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      };
      
      // 修改现有的onerror事件处理器
      const originalOnError = this.mediaRecorder.onerror;
      this.mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder start failed:', event.error);
        
        // 调用原始的onerror处理器
        if (originalOnError) {
          originalOnError(event);
        }
        
        // 只reject一次
        if (!isResolved) {
          isResolved = true;
          reject(new Error('MediaRecorder启动失败: ' + event.error.message));
        }
      };
      
      // 设置超时
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          reject(new Error('MediaRecorder启动超时'));
        }
      }, 5000);
      
      // 清除超时
      const clearTimeoutAndResolve = (...args) => {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          resolve(...args);
        }
      };
      
      const clearTimeoutAndReject = (...args) => {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(...args);
        }
      };
      
      try {
        console.log('Calling MediaRecorder.start()...');
        console.log('MediaRecorder state before start:', this.mediaRecorder.state);
        console.log('Stream active:', this.stream.active);
        console.log('Video tracks:', this.stream.getVideoTracks().length);
        
      // 开始录制
      this.mediaRecorder.start(1000); // 每秒收集一次数据
      console.log('MediaRecorder.start() called successfully');
      console.log('MediaRecorder state after start:', this.mediaRecorder.state);
      
      // 立即通知UI更新，不等待onstart事件
      console.log('Immediately notifying UI about recording start');
      if (window.popupController) {
        window.popupController.onRecordingStarted();
      }
      
      // 设置短暂延迟后resolve
      setTimeout(() => {
        console.log('Resolving startMediaRecorder promise');
        clearTimeoutAndResolve();
      }, 100);
      
    } catch (error) {
      console.error('MediaRecorder.start() threw error:', error);
      clearTimeoutAndReject(new Error('MediaRecorder.start()调用失败: ' + error.message));
    }
    });
  }
  
  // 验证媒体流
  validateStream(stream) {
    console.log('Validating media stream...');
    
    if (!stream) {
      throw new Error('媒体流为空');
    }
    
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    
    console.log('Stream info:', {
      id: stream.id,
      active: stream.active,
      videoTracks: videoTracks.length,
      audioTracks: audioTracks.length
    });
    
    if (videoTracks.length === 0) {
      throw new Error('媒体流中没有视频轨道');
    }
    
    videoTracks.forEach((track, index) => {
      console.log(`Video track ${index}:`, {
        id: track.id,
        kind: track.kind,
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      });
      
      if (track.readyState !== 'live') {
        console.warn(`Video track ${index} is not live:`, track.readyState);
      }
    });
    
    console.log('Stream validation completed');
  }
  
  // 获取录制时长
  getRecordingDuration() {
    if (!this.recordedChunks.length) {
      return 0;
    }
    
    // 估算录制时长（基于数据块数量）
    return this.recordedChunks.length * 1000; // 每秒一个数据块
  }
  
  // 清理资源
  cleanup() {
    try {
      // 停止MediaRecorder
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
      
      // 停止媒体流
      if (this.stream) {
        this.stream.getTracks().forEach(track => {
          track.stop();
        });
        this.stream = null;
      }
      
      // 清理数据
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.isInitialized = false;
      
      console.log('VideoRecorder cleanup completed');
      
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

// 导出VideoRecorder类
window.VideoRecorder = VideoRecorder;