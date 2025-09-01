// Background Processor Module
// 处理视频背景合成和处理

class BackgroundProcessor {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.videoElement = null;
    this.isProcessing = false;
    this.worker = null;
    this.initWorker();
  }
  
  // 初始化 Web Worker
  initWorker() {
    try {
      this.worker = new Worker('popup/videoProcessor.worker.js');
      console.log('Video processor worker initialized');
      
      // 设置 Worker 消息处理
      this.worker.onmessage = (e) => {
        this.handleWorkerMessage(e.data);
      };
      
      this.worker.onerror = (error) => {
        console.error('Worker error:', error);
        this.workerCallback && this.workerCallback(null, error);
      };
    } catch (error) {
      console.error('Failed to initialize worker:', error);
      // 回退到主线程处理
      this.worker = null;
    }
  }
  
  // 处理 Worker 消息
  handleWorkerMessage(data) {
    const { type, progress, message, blob, error, imageData, dimensions } = data;
    
    switch (type) {
      case 'progress':
        if (this.progressCallback) {
          this.progressCallback(progress, message);
        }
        break;
        
      case 'complete':
        if (this.workerCallback) {
          this.workerCallback(blob, null);
        }
        break;
        
      case 'error':
        if (this.workerCallback) {
          this.workerCallback(null, new Error(error));
        }
        break;
        
      case 'preview':
        if (this.previewCallback) {
          this.previewCallback(imageData, dimensions);
        }
        break;
        
      default:
        console.log('Unknown worker message type:', type);
    }
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
      
      // 直接使用主线程处理，跳过Worker（Worker实现不完整）
      console.log('Using main thread processing');
      
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
  
  // 使用 Worker 处理视频
  async processWithWorker(videoBlob, backgroundConfig, progressCallback) {
    return new Promise(async (resolve, reject) => {
      try {
        // 保存回调
        this.progressCallback = progressCallback;
        this.workerCallback = (blob, error) => {
          if (error) {
            reject(error);
          } else {
            resolve(blob);
          }
          // 清理回调
          this.progressCallback = null;
          this.workerCallback = null;
        };
        
        // 获取视频信息
        const videoElement = await this.createVideoElement(videoBlob);
        const videoInfo = this.getVideoInfo(videoElement);
        
        // 准备配置
        const config = {
          ...backgroundConfig,
          videoWidth: videoInfo.width,
          videoHeight: videoInfo.height,
          duration: videoInfo.duration
        };
        
        // 发送消息给 Worker
        this.worker.postMessage({
          action: 'processVideo',
          data: {
            videoBlob: videoBlob,
            config: config
          }
        });
        
        console.log('Video processing delegated to worker');
        
        // 清理临时视频元素
        this.videoElement = null;
        URL.revokeObjectURL(videoElement.src);
        
      } catch (error) {
        console.error('Worker processing failed:', error);
        reject(error);
      }
    });
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
    const ctx = canvas.getContext('2d', { 
      alpha: false,  // 不需要透明度，提高性能
      desynchronized: true,  // 减少延迟
      colorSpace: 'srgb',  // 确保颜色空间一致
      willReadFrequently: false  // 优化性能
    });
    
    // 设置最高质量渲染
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'none';  // 避免默认滤镜
    ctx.globalCompositeOperation = 'source-over';
    
    // 计算输出尺寸
    let outputWidth, outputHeight;
    const padding = backgroundConfig.padding || 60;
    
    // 根据outputRatio设置计算输出尺寸
    if (backgroundConfig.outputRatio === 'custom') {
      // 使用自定义尺寸
      outputWidth = backgroundConfig.customWidth || 1920;
      outputHeight = backgroundConfig.customHeight || 1080;
    } else {
      // 使用预定义比例 - 根据源视频动态调整以保持高质量
      // 确保所有比例都有足够的分辨率
      const sourceWidth = videoInfo.width;
      const sourceHeight = videoInfo.height;
      
      // 检测是否为高分辨率视频（4K 或更高）
      const is4K = sourceWidth >= 3840 || sourceHeight >= 2160;
      const is2K = sourceWidth >= 2560 || sourceHeight >= 1440;
      
      // 动态计算基础尺寸
      let baseWidth, baseHeight;
      if (is4K) {
        baseWidth = 3840;
        baseHeight = 2160;
      } else if (is2K) {
        baseWidth = 2560;
        baseHeight = 1440;
      } else {
        baseWidth = 1920;
        baseHeight = 1080;
      }
      
      // 保证不小于源视频尺寸
      baseWidth = Math.max(baseWidth, sourceWidth);
      baseHeight = Math.max(baseHeight, sourceHeight);
      
      const ratios = {
        '16:9': { 
          w: Math.max(baseWidth, 1920), 
          h: Math.max(Math.round(baseWidth * 9 / 16), 1080) 
        },
        '1:1': { 
          w: Math.max(baseWidth, baseHeight), 
          h: Math.max(baseWidth, baseHeight) 
        },
        '9:16': { 
          w: Math.max(Math.round(baseHeight * 9 / 16), 1080), 
          h: Math.max(baseHeight, 1920) 
        },
        '4:5': { 
          w: Math.max(Math.round(baseHeight * 4 / 5), 1080), 
          h: Math.max(baseHeight, 1350) 
        }
      };
      
      const ratio = ratios[backgroundConfig.outputRatio] || ratios['16:9'];
      outputWidth = ratio.w;
      outputHeight = ratio.h;
    }
    
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    
    // 计算视频在画布中的位置和大小
    // 考虑padding后的可用空间
    const availableWidth = outputWidth - padding * 2;
    const availableHeight = outputHeight - padding * 2;
    
    // 计算视频缩放以适应可用空间（保持纵横比）
    const videoAspectRatio = videoInfo.width / videoInfo.height;
    const targetAspectRatio = availableWidth / availableHeight;
    
    let videoWidth, videoHeight, videoX, videoY;
    
    if (videoAspectRatio > targetAspectRatio) {
      // 视频更宽，以宽度为准
      videoWidth = availableWidth;
      videoHeight = availableWidth / videoAspectRatio;
      videoX = padding;
      videoY = padding + (availableHeight - videoHeight) / 2;
    } else {
      // 视频更高，以高度为准
      videoHeight = availableHeight;
      videoWidth = availableHeight * videoAspectRatio;
      videoX = padding + (availableWidth - videoWidth) / 2;
      videoY = padding;
    }
    
    // 创建视频布局对象
    const videoLayout = {
      x: videoX,
      y: videoY,
      width: videoWidth,
      height: videoHeight
    };
    
    console.log('Composite canvas created:', {
      outputRatio: backgroundConfig.outputRatio,
      canvasSize: { width: outputWidth, height: outputHeight },
      videoOriginalSize: { width: videoInfo.width, height: videoInfo.height },
      videoLayout,
      padding: padding,
      backgroundColor: backgroundConfig.color
    });
    
    return { canvas, ctx, layout: videoLayout };
  }
  
  // 使用Canvas处理视频（实时渲染模式）
  async processVideoWithCanvas(videoElement, canvas, ctx, layout, backgroundConfig, progressCallback) {
    try {
      console.log('Starting video processing with background...');
      console.log('Video element state:', {
        duration: videoElement.duration,
        readyState: videoElement.readyState,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight
      });
      
      // 获取支持的MIME类型
      const mimeType = this.getSupportedMimeType();
      
      // 创建MediaRecorder来录制合成后的视频
      // 检测系统性能以决定帧率
      const isHighPerformance = navigator.hardwareConcurrency >= 8;
      const targetFPS = isHighPerformance ? 60 : 30;  // 高性能系统使用60FPS
      const stream = canvas.captureStream(targetFPS);
      console.log('Canvas stream created:', {
        active: stream.active,
        tracks: stream.getTracks().length,
        trackSettings: stream.getVideoTracks()[0]?.getSettings()
      });
      
      // 使用高质量编码参数 - 根据Canvas分辨率和帧率动态调整
      const canvasPixels = canvas.width * canvas.height;
      let videoBitrate;
      if (canvasPixels >= 3840 * 2160) {
        videoBitrate = targetFPS === 60 ? 60000000 : 40000000;  // 4K: 40-60 Mbps
      } else if (canvasPixels >= 2560 * 1440) {
        videoBitrate = targetFPS === 60 ? 40000000 : 25000000;  // 2K: 25-40 Mbps
      } else if (canvasPixels >= 1920 * 1080) {
        videoBitrate = targetFPS === 60 ? 25000000 : 20000000;  // FHD: 20-25 Mbps
      } else {
        videoBitrate = 15000000;  // 最低15 Mbps
      }
      
      console.log('Background processor bitrate:', {
        canvasSize: `${canvas.width}x${canvas.height}`,
        targetFPS: targetFPS,
        bitrate: `${videoBitrate / 1000000} Mbps`
      });
      
      const recorderOptions = {
        mimeType: mimeType,
        videoBitsPerSecond: videoBitrate,
        // 提升音频比特率
        audioBitsPerSecond: 192000
      };
      
      // 尝试创建MediaRecorder
      let mediaRecorder;
      try {
        console.log('Creating MediaRecorder with options:', recorderOptions);
        mediaRecorder = new MediaRecorder(stream, recorderOptions);
      } catch (err) {
        console.warn('Failed with options, trying without options:', err);
        // 如果失败，尝试不带选项
        mediaRecorder = new MediaRecorder(stream);
      }
      
      const recordedChunks = [];
      
      // 设置MediaRecorder事件
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
          console.log('Chunk received:', event.data.size, 'bytes, total chunks:', recordedChunks.length);
        } else {
          console.warn('Empty data chunk received');
        }
      };
      
      // 创建Promise来等待录制完成
      const recordingPromise = new Promise((resolve, reject) => {
        mediaRecorder.onstop = () => {
          console.log('MediaRecorder stopped, creating blob from', recordedChunks.length, 'chunks');
          
          // 验证是否有数据
          if (recordedChunks.length === 0) {
            reject(new Error('没有录制到任何数据'));
            return;
          }
          
          try {
            // 计算总大小
            const totalSize = recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
            console.log('Total chunks size:', totalSize, 'bytes');
            
            if (totalSize === 0) {
              reject(new Error('录制的数据为空'));
              return;
            }
            
            const processedBlob = new Blob(recordedChunks, {
              type: mimeType
            });
            
            console.log('Processed video created:', {
              size: processedBlob.size,
              type: processedBlob.type,
              chunks: recordedChunks.length
            });
            
            // 验证生成的Blob
            if (processedBlob.size === 0) {
              reject(new Error('生成的视频文件为空'));
              return;
            }
            
            resolve(processedBlob);
          } catch (error) {
            console.error('Error creating blob:', error);
            reject(error);
          }
        };
        
        mediaRecorder.onerror = (event) => {
          console.error('MediaRecorder error:', event.error);
          reject(event.error);
        };
      });
      
      // 开始录制
      console.log('Starting MediaRecorder with state:', mediaRecorder.state);
      
      // 不指定时间间隔，让MediaRecorder自己决定
      try {
        mediaRecorder.start();
        console.log('MediaRecorder started successfully');
      } catch (err) {
        console.error('Failed to start MediaRecorder:', err);
        throw new Error('无法启动视频录制器: ' + err.message);
      }
      
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
      console.log('Stopping MediaRecorder, current state:', mediaRecorder.state);
      
      // 确保MediaRecorder仍在录制状态
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        console.log('MediaRecorder stop called');
      } else {
        console.warn('MediaRecorder was not recording, state:', mediaRecorder.state);
      }
      
      // 等待录制完成并返回结果
      const result = await recordingPromise;
      console.log('Recording promise resolved, result size:', result.size);
      return result;
      
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
            // 给更多时间确保最后的数据被录制
            setTimeout(resolve, 500);
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
        ? Math.max(60000, duration * 1000 * 3) // 视频时长的3倍，最少1分钟
        : 300000; // 5分钟
        
      const timeoutId = setTimeout(() => {
        if (!videoElement.ended) {
          console.warn('Video processing timeout, frameCount:', frameCount);
          if (animationId) {
            cancelAnimationFrame(animationId);
          }
          // 如果已经渲染了一些帧，仍然尝试解决
          if (frameCount > 0) {
            console.log('Timeout but frames were rendered, resolving anyway');
            setTimeout(resolve, 1000);
          } else {
            reject(new Error('视频处理超时'));
          }
        }
      }, timeoutDuration);
      
      // 在resolve时清除超时
      const originalResolve = resolve;
      resolve = (...args) => {
        clearTimeout(timeoutId);
        originalResolve(...args);
      };
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
  
  // 获取支持的MIME类型 - 优先使用高效编码器
  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',  // VP9 + Opus：最佳质量
      'video/webm;codecs=vp9',       // VP9：高效压缩
      'video/webm;codecs=vp8,opus',  // VP8 + Opus
      'video/webm;codecs=vp8',       // VP8：兼容性好
      'video/webm',                  // 默认WebM
      'video/mp4;codecs=h264',       // H.264：硬件加速
      'video/mp4'                    // 默认MP4
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