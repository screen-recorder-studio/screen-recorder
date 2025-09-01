// Background Processor Module
// 处理视频背景合成和处理

class BackgroundProcessor {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.videoElement = null;
    this.isProcessing = false;
  }
  
  // 应用背景到视频
  async applyBackground(videoBlob, backgroundConfig, progressCallback) {
    try {
      this.isProcessing = true;
      console.log('Starting background processing...', backgroundConfig);
      
      // 验证输入参数
      if (!videoBlob || !backgroundConfig) {
        throw new Error('缺少必要的处理参数');
      }
      
      // 验证背景配置
      this.validateBackgroundConfig(backgroundConfig);
      
      if (progressCallback) progressCallback(20, '加载视频...');
      
      // 创建视频元素
      const videoElement = await this.createVideoElement(videoBlob);
      this.videoElement = videoElement;
      
      if (progressCallback) progressCallback(40, '分析视频信息...');
      
      // 获取视频尺寸信息
      const videoInfo = this.getVideoInfo(videoElement);
      console.log('Video info:', videoInfo);
      
      if (progressCallback) progressCallback(50, '创建合成画布...');
      
      // 创建合成画布
      const { canvas, ctx, layout } = this.createCompositeCanvas(backgroundConfig, videoInfo);
      this.canvas = canvas;
      this.ctx = ctx;
      
      if (progressCallback) progressCallback(60, '开始处理视频...');
      
      // 处理视频并生成新的视频文件
      const processedVideoBlob = await this.processVideoWithCanvas(
        videoElement, 
        canvas,
        ctx,
        layout,
        backgroundConfig,
        progressCallback
      );
      
      if (progressCallback) progressCallback(95, '完成处理...');
      
      console.log('Background processing completed');
      return processedVideoBlob;
      
    } catch (error) {
      console.error('Background processing failed:', error);
      throw error;
    } finally {
      this.cleanup();
      this.isProcessing = false;
    }
  }
  
  // 创建视频元素
  async createVideoElement(videoBlob) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous'; // 添加跨域支持
      
      // 添加更多事件监听以跟踪加载过程
      video.onloadstart = () => {
        console.log('Video load started');
      };
      
      video.onloadeddata = () => {
        console.log('Video data loaded, readyState:', video.readyState);
      };
      
      video.oncanplay = () => {
        console.log('Video can play, readyState:', video.readyState);
      };
      
      video.oncanplaythrough = () => {
        console.log('Video can play through, readyState:', video.readyState);
      };
      
      video.onloadedmetadata = () => {
        console.log('Video metadata loaded:', {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          readyState: video.readyState,
          seekable: video.seekable?.length > 0 ? 
            `${video.seekable.start(0)}-${video.seekable.end(0)}` : 'none'
        });
        
        // 等待视频完全准备好
        if (video.readyState >= 3) { // HAVE_FUTURE_DATA
          resolve(video);
        } else {
          video.oncanplay = () => {
            console.log('Video ready to play after metadata');
            resolve(video);
          };
        }
      };
      
      video.onerror = (error) => {
        console.error('Video loading error:', error);
        reject(new Error('视频加载失败'));
      };
      
      // 设置视频源
      const videoUrl = URL.createObjectURL(videoBlob);
      video.src = videoUrl;
      
      // 清理URL的定时器
      setTimeout(() => {
        URL.revokeObjectURL(videoUrl);
      }, 10000);
    });
  }
  
  // 获取视频信息
  getVideoInfo(videoElement) {
    return {
      width: videoElement.videoWidth,
      height: videoElement.videoHeight,
      duration: videoElement.duration,
      aspectRatio: videoElement.videoWidth / videoElement.videoHeight
    };
  }
  
  // 创建合成画布
  createCompositeCanvas(backgroundConfig, videoInfo) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // 计算输出尺寸，基于原视频尺寸加上padding
    const padding = backgroundConfig.padding;
    const outputWidth = videoInfo.width + padding * 2;
    const outputHeight = videoInfo.height + padding * 2;
    
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    
    // 计算视频在画布中的位置（居中）
    const videoLayout = {
      x: padding,
      y: padding,
      width: videoInfo.width,
      height: videoInfo.height
    };
    
    console.log('Composite canvas created:', {
      canvasWidth: outputWidth,
      canvasHeight: outputHeight,
      videoLayout,
      backgroundColor: backgroundConfig.color
    });
    
    return { canvas, ctx, layout: videoLayout };
  }
  
  // 使用Canvas处理视频（实时渲染模式）
  async processVideoWithCanvas(videoElement, canvas, ctx, layout, backgroundConfig, progressCallback) {
    try {
      console.log('Starting video processing with background...');
      
      // 获取支持的MIME类型
      const mimeType = this.getSupportedMimeType();
      
      // 创建MediaRecorder来录制合成后的视频
      const stream = canvas.captureStream(30); // 30 FPS
      console.log('Canvas stream created:', {
        active: stream.active,
        tracks: stream.getTracks().length
      });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2500000 // 2.5 Mbps
      });
      
      const recordedChunks = [];
      
      // 设置MediaRecorder事件
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
          console.log('Chunk received:', event.data.size, 'bytes');
        }
      };
      
      // 创建Promise来等待录制完成
      const recordingPromise = new Promise((resolve, reject) => {
        mediaRecorder.onstop = () => {
          console.log('MediaRecorder stopped, creating blob...');
          try {
            const processedBlob = new Blob(recordedChunks, {
              type: mimeType
            });
            console.log('Processed video created, size:', processedBlob.size, 'bytes');
            resolve(processedBlob);
          } catch (error) {
            reject(error);
          }
        };
        
        mediaRecorder.onerror = (event) => {
          console.error('MediaRecorder error:', event.error);
          reject(event.error);
        };
      });
      
      // 开始录制
      console.log('Starting MediaRecorder...');
      mediaRecorder.start(100); // 100ms chunks
      
      // 播放视频并实时渲染到画布
      await this.playAndRenderVideo(
        videoElement,
        canvas,
        ctx,
        layout,
        backgroundConfig,
        progressCallback
      );
      
      // 停止录制
      console.log('Stopping MediaRecorder...');
      mediaRecorder.stop();
      
      // 等待录制完成并返回结果
      return await recordingPromise;
      
    } catch (error) {
      console.error('Canvas video processing error:', error);
      throw error;
    }
  }
  
  // 播放并渲染视频到画布
  async playAndRenderVideo(videoElement, canvas, ctx, layout, backgroundConfig, progressCallback) {
    return new Promise((resolve, reject) => {
      let frameCount = 0;
      const fps = 30;
      const duration = videoElement.duration;
      let animationId = null;
      
      console.log('Starting video playback and rendering, duration:', duration);
      
      // 渲染函数
      const renderFrame = () => {
        try {
          // 清除画布
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // 绘制背景
          ctx.fillStyle = backgroundConfig.color;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // 绘制视频帧
          if (videoElement.readyState >= 2) {
            ctx.drawImage(
              videoElement,
              layout.x,
              layout.y,
              layout.width,
              layout.height
            );
          }
          
          frameCount++;
          
          // 更新进度
          if (progressCallback && frameCount % 30 === 0) {
            const currentTime = videoElement.currentTime;
            if (isFinite(duration) && duration > 0) {
              const progress = Math.min(90, 60 + (currentTime / duration) * 30);
              progressCallback(progress, `处理中... ${Math.floor(currentTime)}/${Math.floor(duration)}秒`);
            } else {
              progressCallback(70, `处理中... ${Math.floor(currentTime)}秒`);
            }
          }
          
          // 检查是否完成
          if (videoElement.ended) {
            console.log('Video playback ended, frames rendered:', frameCount);
            if (animationId) {
              cancelAnimationFrame(animationId);
            }
            setTimeout(resolve, 100); // 给一点时间确保最后的数据被录制
            return;
          }
          
          // 继续下一帧
          animationId = requestAnimationFrame(renderFrame);
          
        } catch (error) {
          console.error('Frame rendering error:', error);
          if (animationId) {
            cancelAnimationFrame(animationId);
          }
          reject(error);
        }
      };
      
      // 设置视频事件监听
      videoElement.onended = () => {
        console.log('Video ended event triggered');
      };
      
      videoElement.onerror = (error) => {
        console.error('Video playback error:', error);
        reject(new Error('视频播放失败'));
      };
      
      // 开始播放视频
      console.log('Starting video playback...');
      videoElement.currentTime = 0;
      videoElement.play().then(() => {
        console.log('Video playback started');
        renderFrame();
      }).catch((error) => {
        console.error('Failed to play video:', error);
        // 尝试静音播放
        videoElement.muted = true;
        videoElement.play().then(() => {
          console.log('Video playback started (muted)');
          renderFrame();
        }).catch((mutedError) => {
          reject(new Error('视频无法播放: ' + mutedError.message));
        });
      });
      
      // 设置超时保护
      const timeoutDuration = isFinite(duration) && duration > 0
        ? Math.max(30000, duration * 1000 * 2) // 视频时长的2倍
        : 300000; // 5分钟
        
      setTimeout(() => {
        if (!videoElement.ended && frameCount === 0) {
          if (animationId) {
            cancelAnimationFrame(animationId);
          }
          reject(new Error('视频处理超时'));
        }
      }, timeoutDuration);
    });
  }
  
  // 渲染视频与背景的合成
  async renderVideoWithBackground(videoElement, canvas, ctx, layout, backgroundConfig, progressCallback) {
    return new Promise((resolve, reject) => {
      let frameCount = 0;
      let totalDuration = videoElement.duration;
      
      // 处理duration为Infinity的情况（流式录制的WebM常见）
      if (!isFinite(totalDuration) || totalDuration <= 0) {
        console.warn('Video duration is not finite:', totalDuration);
        // 尝试使用默认值或通过seekable范围获取
        if (videoElement.seekable && videoElement.seekable.length > 0) {
          totalDuration = videoElement.seekable.end(videoElement.seekable.length - 1);
          console.log('Using seekable duration:', totalDuration);
        } else {
          // 使用一个合理的默认值，或者让视频播放到结束
          totalDuration = 0; // 标记为未知时长
          console.log('Duration unknown, will process until video ends');
        }
      }
      
      const fps = 30;
      const totalFrames = totalDuration > 0 ? Math.ceil(totalDuration * fps) : 0;
      
      console.log('Starting video rendering:', {
        duration: totalDuration,
        totalFrames: totalFrames || 'unknown',
        layout: layout
      });
      
      const renderFrame = () => {
        try {
          // 清除画布
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // 绘制背景
          ctx.fillStyle = backgroundConfig.color;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // 绘制视频帧
          if (videoElement.readyState >= 2) { // HAVE_CURRENT_DATA
            ctx.drawImage(
              videoElement,
              layout.x,
              layout.y,
              layout.width,
              layout.height
            );
          } else {
            // 如果视频还没准备好，记录状态
            if (frameCount % 30 === 0) {
              console.log('Video not ready, readyState:', videoElement.readyState, 
                         'currentTime:', videoElement.currentTime,
                         'paused:', videoElement.paused);
            }
          }
          
          frameCount++;
          
          // 更新进度
          if (progressCallback && frameCount % 30 === 0) { // 每秒更新一次进度
            if (totalFrames > 0) {
              const progress = Math.min(90, 60 + (frameCount / totalFrames) * 30);
              progressCallback(progress, `处理视频帧 ${frameCount}/${totalFrames}`);
            } else {
              // 未知总帧数时，基于时间显示进度
              const seconds = Math.floor(frameCount / fps);
              progressCallback(70, `处理中... ${seconds}秒`);
            }
          }
          
          // 检查是否完成
          if (videoElement.ended) {
            console.log('Video rendering completed, frames rendered:', frameCount);
            resolve();
            return;
          }
          
          // 如果有有效的duration，检查是否超过duration
          if (totalDuration > 0 && videoElement.currentTime >= totalDuration) {
            console.log('Video duration reached, frames rendered:', frameCount);
            resolve();
            return;
          }
          
          // 继续下一帧
          requestAnimationFrame(renderFrame);
          
        } catch (error) {
          console.error('Frame rendering error:', error);
          reject(error);
        }
      };
      
      // 设置视频事件监听
      videoElement.onended = () => {
        console.log('Video playback ended');
        setTimeout(resolve, 500); // 给一点时间确保最后的帧被处理
      };
      
      videoElement.onerror = (error) => {
        console.error('Video playback error:', error);
        reject(new Error('视频播放失败'));
      };
      
      // 开始播放视频
      console.log('Attempting to play video...');
      console.log('Video readyState:', videoElement.readyState);
      console.log('Video paused:', videoElement.paused);
      console.log('Video ended:', videoElement.ended);
      
      videoElement.currentTime = 0;
      
      // 确保视频可以播放
      const playPromise = videoElement.play();
      
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log('Video playback started successfully');
          console.log('Starting frame rendering...');
          renderFrame();
        }).catch((error) => {
          console.error('Video playback failed:', error);
          
          // 如果播放失败，尝试静音播放
          videoElement.muted = true;
          videoElement.play().then(() => {
            console.log('Video playback started with muted audio');
            renderFrame();
          }).catch((mutedError) => {
            console.error('Even muted playback failed:', mutedError);
            reject(new Error('视频无法播放: ' + mutedError.message));
          });
        });
      } else {
        console.error('Play promise is undefined');
        reject(new Error('视频播放失败'));
      }
      
      // 设置超时保护
      const timeoutDuration = totalDuration > 0 
        ? Math.max(30000, totalDuration * 1000 + 10000) // 基于视频长度的动态超时
        : 300000; // 未知时长时，使用5分钟超时
        
      setTimeout(() => {
        if (frameCount === 0) {
          reject(new Error('视频处理超时'));
        }
      }, timeoutDuration);
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
        console.log('Using MIME type for background processing:', type);
        return type;
      }
    }
    
    console.warn('No supported MIME type found for background processing, using default');
    return 'video/webm';
  }
  
  // 获取处理进度
  getProcessingProgress() {
    // 这是一个简化的进度计算
    // 实际应用中可以基于已处理的帧数来计算
    return this.isProcessing ? 50 : 100;
  }
  
  // 验证背景配置
  validateBackgroundConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('无效的背景配置');
    }
    
    if (!config.color || typeof config.color !== 'string') {
      throw new Error('背景颜色配置无效');
    }
    
    if (!config.color.match(/^#[0-9A-Fa-f]{6}$/)) {
      throw new Error('背景颜色格式无效');
    }
    
    if (typeof config.padding !== 'number' || config.padding < 0) {
      throw new Error('内边距配置无效');
    }
    
    return true;
  }
  
  // 清理资源
  cleanup() {
    try {
      if (this.canvas) {
        this.canvas = null;
      }
      
      if (this.ctx) {
        this.ctx = null;
      }
      
      if (this.videoElement) {
        this.videoElement.pause();
        this.videoElement.src = '';
        this.videoElement = null;
      }
      
      console.log('BackgroundProcessor cleanup completed');
      
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

// 导出BackgroundProcessor类
window.BackgroundProcessor = BackgroundProcessor;