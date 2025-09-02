// Format Export Manager
// 管理多格式导出功能，协调 Worker 和 UI

class FormatExportManager {
  constructor() {
    this.worker = null;
    this.currentExport = null;
    this.supportedFormats = {
      webm: {
        name: 'WebM',
        icon: '🎬',
        description: '原始格式，最佳质量',
        supported: true
      },
      mp4: {
        name: 'MP4',
        icon: '📹',
        description: '专业 MP4 格式，兼容性极佳',
        supported: this.checkMediabunnySupport()
      },
      gif: {
        name: 'GIF',
        icon: '🎞️',
        description: '动图格式，易于分享',
        supported: true
      }
    };

    this.initWorker();
    this.gifEncoder = null;

    // 初始化 Mediabunny MP4 导出器
    this.mediabunnyExporter = null;
    this.mediabunnyInitialized = false;

    // 使用新的加载器或监听事件
    if (window.mediabunnyLoader) {
      // 使用加载器
      window.mediabunnyLoader.waitForLoad().then(() => {
        this.initMediabunnyExporter();
      }).catch((error) => {
        console.warn('⚠️ Mediabunny 加载失败，MP4 导出将不可用:', error);
      });
    } else {
      // 备用方案：监听事件
      window.addEventListener('mediabunnyLoaded', () => {
        this.initMediabunnyExporter();
      });

      // 如果已经加载，立即初始化
      if (typeof window.Mediabunny !== 'undefined') {
        setTimeout(() => {
          this.initMediabunnyExporter();
        }, 100);
      }
    }
  }

  // 初始化 Mediabunny MP4 导出器
  async initMediabunnyExporter() {
    try {
      console.log('🔄 开始初始化 Mediabunny MP4 导出器...');

      if (typeof window.Mediabunny === 'undefined') {
        console.warn('⚠️ Mediabunny 库尚未加载，等待中...');
        return;
      }

      if (!window.MediabunnyMp4Exporter) {
        console.warn('⚠️ MediabunnyMp4Exporter 类未找到');
        return;
      }

      this.mediabunnyExporter = new MediabunnyMp4Exporter();

      try {
        await this.mediabunnyExporter.initialize();
        console.log('✅ Mediabunny MP4 导出器已启用');

        // 更新 MP4 支持状态
        this.supportedFormats.mp4.supported = true;
        this.supportedFormats.mp4.description = '🚀 专业 MP4 格式，Mediabunny 驱动';
        this.mediabunnyInitialized = true;

      } catch (error) {
        console.warn('⚠️ Mediabunny 初始化失败:', error);
        this.mediabunnyExporter = null;
        this.supportedFormats.mp4.supported = false;
        this.supportedFormats.mp4.description = 'MP4 格式暂不可用';
      }
    } catch (error) {
      console.error('❌ Mediabunny 初始化过程出错:', error);
    }
  }

  // 检查 Mediabunny 支持
  checkMediabunnySupport() {
    return typeof window.Mediabunny !== 'undefined';
  }

  // 初始化 Worker
  initWorker() {
    try {
      this.worker = new Worker('popup/export.worker.js');

      this.worker.onmessage = (event) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.error('Export worker error:', error);
        this.handleExportError(error);
      };

      console.log('Export worker initialized');
    } catch (error) {
      console.error('Failed to initialize export worker:', error);
    }
  }

  // 检查 MP4 支持（已废弃，使用 checkMediabunnySupport）
  checkMP4Support() {
    // 🚨 已废弃：旧的 Canvas 转码方法
    console.warn('⚠️ checkMP4Support 已废弃，请使用 checkMediabunnySupport');
    return this.checkMediabunnySupport();
  }

  // 导出视频
  async exportVideo(blob, format, options = {}) {
    if (!this.supportedFormats[format]?.supported) {
      throw new Error(`格式 ${format} 不支持`);
    }

    console.log(`Starting ${format} export with options:`, options);

    this.currentExport = {
      format,
      startTime: Date.now(),
      blob,
      options
    };

    try {
      // MP4 使用 Mediabunny 专业转换
      if (format === 'mp4') {
        return await this.exportMP4WithMediabunny(blob, options);
      }

      // GIF 需要特殊处理（主线程 + Worker 协作）
      if (format === 'gif') {
        return await this.exportGIF(blob, options);
      }

      // WebM 可以在 Worker 中处理
      return await this.exportInWorker(blob, format, options);

    } catch (error) {
      console.error(`Export failed for ${format}:`, error);
      throw error;
    }
  }

  // 使用重写的 Mediabunny 导出 MP4 - 与"应用并下载"保持一致的流程
  async exportMP4WithMediabunny(blob, options = {}) {
    console.log('🚀 Starting Mediabunny MP4 export with editing effects, options:', options);

    // 检查 Mediabunny 导出器是否可用
    if (!this.mediabunnyExporter) {
      throw new Error('Mediabunny MP4 导出器未初始化');
    }

    try {
      // 设置进度回调
      const progressCallback = (percent, message) => {
        this.onExportProgress?.(percent * 100, message || `转换中... ${(percent * 100).toFixed(0)}%`);
      };

      // 执行编辑后视频的 MP4 导出 - 与"应用并下载"保持一致的前置流程
      const result = await this.mediabunnyExporter.exportToMp4(blob, {
        quality: options.quality || 'high',
        backgroundConfig: options.backgroundConfig, // 传递完整的编辑配置
        frameRate: options.frameRate || 30,
        progressCallback
      });

      // 格式化返回结果
      const exportResult = {
        blob: result.blob,
        format: 'mp4',
        method: 'mediabunny-with-editing',
        originalSize: result.originalSize,
        outputSize: result.finalSize,
        compressionRatio: `${result.compression.toFixed(1)}%`,
        success: true,
        quality: options.quality || 'high',
        editingApplied: !!options.backgroundConfig
      };

      console.log('✅ Mediabunny MP4 export with editing completed:', exportResult);

      return exportResult;

    } catch (error) {
      console.error('❌ Mediabunny MP4 export failed:', error);

      // 如果 Mediabunny 失败，尝试降级到MediaRecorder方法
      console.warn('⚠️ 降级到 MediaRecorder 方法');
      return await this.exportMP4WithMediaRecorderFallback(blob, options);
    }
  }

  // MediaRecorder 降级方法
  async exportMP4WithMediaRecorderFallback(blob, options = {}) {
    console.log('🔄 Using MediaRecorder MP4 fallback method');

    try {
      // 创建视频元素
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;

      // 加载视频
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        video.src = URL.createObjectURL(blob);
      });

      // 创建Canvas
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');

      // 设置进度回调
      const progressCallback = (percent, message) => {
        this.onExportProgress?.(percent, `降级录制: ${message || `${percent.toFixed(0)}%`}`);
      };

      // 使用MediaRecorder录制
      const stream = canvas.captureStream(30);
      const chunks = [];

      // 选择最佳MIME类型
      let mimeType = 'video/mp4;codecs=h264';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2500000
      });

      const recordingPromise = new Promise((resolve, reject) => {
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const resultBlob = new Blob(chunks, { type: 'video/mp4' });
          resolve(resultBlob);
        };

        mediaRecorder.onerror = reject;
      });

      // 开始录制
      mediaRecorder.start();
      progressCallback(10, '开始录制...');

      // 播放视频并渲染到Canvas
      video.currentTime = 0;
      await video.play();

      const renderLoop = () => {
        if (!video.ended) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const progress = 10 + (video.currentTime / video.duration) * 80;
          progressCallback(progress, `录制中... ${Math.floor(video.currentTime)}/${Math.floor(video.duration)}秒`);
          requestAnimationFrame(renderLoop);
        } else {
          mediaRecorder.stop();
          progressCallback(90, '完成录制...');
        }
      };

      renderLoop();

      // 等待录制完成
      const resultBlob = await recordingPromise;
      progressCallback(100, '降级导出完成');

      // 清理
      URL.revokeObjectURL(video.src);

      return {
        blob: resultBlob,
        format: 'mp4',
        method: 'mediarecorder-fallback',
        originalSize: blob.size,
        outputSize: resultBlob.size,
        compressionRatio: ((1 - resultBlob.size / blob.size) * 100).toFixed(1) + '%',
        success: true,
        warning: '使用了降级录制方法，质量可能受影响'
      };

    } catch (error) {
      console.error('MediaRecorder 降级方法失败:', error);
      throw new Error(`降级MP4导出失败: ${error.message}`);
    }
  }

  // 在 Worker 中导出
  exportInWorker(blob, format, options) {
    return new Promise((resolve, reject) => {
      // 设置消息处理器
      const messageHandler = (event) => {
        const { type, data } = event.data;

        if (type === 'export-complete') {
          this.worker.removeEventListener('message', messageHandler);
          resolve(data);
        } else if (type === 'error') {
          this.worker.removeEventListener('message', messageHandler);
          reject(new Error(data.message));
        }
      };

      this.worker.addEventListener('message', messageHandler);

      // 发送导出任务到 Worker
      this.worker.postMessage({
        type: 'export',
        data: { blob, format, options }
      });
    });
  }

  // 导出 GIF（需要主线程协作）
  async exportGIF(blob, options) {
    const {
      width = 480,
      height = 270,
      fps = 10,
      quality = 10,
      maxDuration = 30
    } = options;
    
    console.log('Starting GIF export with settings:', { width, height, fps, quality });
    
    // 创建视频元素用于帧提取
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = width;
    canvas.height = height;
    
    // 加载 GIF 编码器
    if (!this.gifEncoder) {
      await this.loadGIFEncoder();
    }
    
    // 初始化 GIF 编码器
    const gif = new window.GIF({
      workers: 2,
      quality: quality,
      width: width,
      height: height,
      workerScript: 'libs/gif.worker.js'
    });
    
    return new Promise((resolve, reject) => {
      // 设置视频源
      video.src = URL.createObjectURL(blob);
      video.muted = true;
      
      video.onloadedmetadata = async () => {
        const duration = Math.min(video.duration, maxDuration);
        const frameInterval = 1 / fps;
        const totalFrames = Math.floor(duration * fps);
        
        console.log(`Extracting ${totalFrames} frames from ${duration}s video`);
        
        // 进度回调
        const onProgress = (percent) => {
          this.onExportProgress?.(percent, `提取帧 ${Math.floor(percent)}%`);
        };
        
        // 提取帧
        for (let i = 0; i < totalFrames; i++) {
          video.currentTime = i * frameInterval;
          
          await new Promise((resolve) => {
            video.onseeked = () => {
              // 绘制当前帧到 canvas
              ctx.drawImage(video, 0, 0, width, height);
              
              // 添加帧到 GIF
              gif.addFrame(ctx, {
                copy: true,
                delay: frameInterval * 1000
              });
              
              onProgress((i / totalFrames) * 80); // 0-80% 用于帧提取
              resolve();
            };
          });
        }
        
        // 渲染 GIF
        gif.on('finished', (gifBlob) => {
          URL.revokeObjectURL(video.src);
          console.log('GIF export completed, size:', gifBlob.size);
          
          resolve({
            blob: gifBlob,
            format: 'gif',
            originalSize: blob.size,
            exportedSize: gifBlob.size,
            frameCount: totalFrames,
            settings: { width, height, fps, quality }
          });
        });
        
        gif.on('progress', (p) => {
          this.onExportProgress?.(80 + p * 20, '生成GIF...'); // 80-100% 用于渲染
        });
        
        console.log('Starting GIF render...');
        gif.render();
      };
      
      video.onerror = (error) => {
        URL.revokeObjectURL(video.src);
        console.error('Video loading error:', error);
        reject(new Error('Failed to load video for GIF conversion'));
      };
    });
  }

  // 加载 GIF 编码器
  async loadGIFEncoder() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'libs/gif.min.js';
      script.onload = () => {
        console.log('GIF.js loaded successfully');
        resolve();
      };
      script.onerror = (error) => {
        console.error('Failed to load GIF.js:', error);
        reject(new Error('Failed to load GIF encoder library'));
      };
      document.head.appendChild(script);
    });
  }

  // 处理 Worker 消息
  handleWorkerMessage(message) {
    const { type, data } = message;
    
    switch (type) {
      case 'ready':
        console.log('Export worker ready');
        break;
        
      case 'progress':
        this.onExportProgress?.(data.percent, data.message);
        break;
        
      case 'export-complete':
        this.handleExportComplete(data);
        break;
        
      case 'error':
        this.handleExportError(new Error(data.message));
        break;
        
      default:
        console.log('Worker message:', type, data);
    }
  }

  // 处理导出完成
  handleExportComplete(result) {
    const duration = Date.now() - this.currentExport.startTime;
    console.log(`Export completed in ${duration}ms:`, result);
    
    this.onExportComplete?.(result);
    this.currentExport = null;
  }

  // 处理导出错误
  handleExportError(error) {
    console.error('Export error:', error);
    this.onExportError?.(error);
    this.currentExport = null;
  }

  // 取消当前导出
  cancelExport() {
    if (this.worker && this.currentExport) {
      this.worker.postMessage({ type: 'cancel' });
      this.currentExport = null;
    }
  }

  // 获取文件大小预估
  estimateFileSize(originalSize, format, options) {
    const estimates = {
      webm: {
        high: 1.0,
        medium: 0.6,
        low: 0.3
      },
      mp4: {
        high: 0.9,
        medium: 0.6,
        low: 0.4
      },
      gif: {
        '480': 1.5,
        '360': 1.0,
        '240': 0.6
      }
    };
    
    const quality = options.quality || 'medium';
    const multiplier = estimates[format]?.[quality] || 1.0;
    
    return Math.round(originalSize * multiplier);
  }

  // 生成导出文件名
  generateFileName(format) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const extension = this.supportedFormats[format]?.name?.toLowerCase() || format;
    return `recording-${timestamp}.${extension}`;
  }

  // 清理资源
  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.currentExport = null;
  }
}

// 导出为全局变量
window.FormatExportManager = FormatExportManager;
