// Export Worker - 处理视频多格式导出
// 支持 WebM, MP4 (Mediabunny), GIF 格式转换
// 🚨 注意：MP4 导出已迁移到主线程的 Mediabunny 方案

self.importScripts = self.importScripts || (() => {});

// 导出任务状态
const ExportState = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error'
};

// 导出器主类
class VideoExportWorker {
  constructor() {
    this.state = ExportState.IDLE;
    this.currentTask = null;
    this.mp4boxLoaded = false;
    this.gifJsLoaded = false;
  }

  // 初始化必要的库
  async initLibraries(format) {
    try {
      if (format === 'mp4' && !this.mp4boxLoaded) {
        // 动态加载 mp4box.js
        try {
          self.importScripts('../libs/mp4box.all.js');
          this.mp4boxLoaded = true;
          console.log('MP4Box.js loaded successfully');
        } catch (loadError) {
          console.warn('Failed to load MP4Box.js:', loadError);
          console.warn('Will use fallback method for MP4');
          this.mp4boxLoaded = false;
        }
      }
      
      if (format === 'gif' && !this.gifJsLoaded) {
        // GIF 编码将在主线程使用 gif.js
        // Worker 只负责帧提取
        this.gifJsLoaded = true;
        console.log('Ready for GIF frame extraction');
      }
    } catch (error) {
      console.error('Failed to load libraries:', error);
      // 不要抛出错误，继续使用备用方案
      console.warn('Will use fallback methods');
    }
  }

  // 处理导出任务
  async processExport(data) {
    const { blob, format, options } = data;
    
    this.state = ExportState.PROCESSING;
    this.sendProgress(0, `开始${format.toUpperCase()}导出...`);
    
    try {
      // 初始化所需库
      await this.initLibraries(format);
      
      let result;
      switch (format) {
        case 'webm':
          result = await this.exportWebM(blob, options);
          break;
        case 'mp4':
          result = await this.exportMP4(blob, options);
          break;
        case 'gif':
          result = await this.prepareGIFFrames(blob, options);
          break;
        default:
          throw new Error(`不支持的格式: ${format}`);
      }
      
      this.state = ExportState.COMPLETED;
      this.sendProgress(100, '导出完成！');
      return result;
      
    } catch (error) {
      this.state = ExportState.ERROR;
      console.error('Export failed:', error);
      throw error;
    }
  }

  // WebM 导出（可能包含压缩）
  async exportWebM(blob, options) {
    console.log('Processing WebM export with options:', options);
    
    // 如果不需要压缩，直接返回
    if (!options.compress) {
      return { blob, format: 'webm', compressed: false };
    }
    
    // WebM 压缩逻辑
    this.sendProgress(20, '分析视频...');
    const videoInfo = await this.analyzeVideo(blob);
    
    this.sendProgress(40, '压缩视频...');
    const compressedBlob = await this.compressWebM(blob, videoInfo, options);
    
    this.sendProgress(80, '优化完成...');
    
    return {
      blob: compressedBlob,
      format: 'webm',
      compressed: true,
      originalSize: blob.size,
      compressedSize: compressedBlob.size,
      compression: ((1 - compressedBlob.size / blob.size) * 100).toFixed(1)
    };
  }

  // MP4 导出（已废弃 - 重定向到主线程）
  async exportMP4(blob, options) {
    console.warn('🚨 Worker MP4 导出已废弃，请使用主线程的 Mediabunny 方案');

    this.sendProgress(10, '重定向到主线程...');

    // 返回指示需要在主线程处理的结果
    return {
      blob: blob,
      format: 'webm',
      method: 'redirect-to-main-thread',
      warning: 'MP4 导出已迁移到主线程的 Mediabunny 方案，请使用 FormatExportManager.exportMP4WithMediabunny()',
      needsMainThreadProcessing: true,
      redirectReason: 'MP4 processing moved to Mediabunny in main thread'
    };
  }

  // 使用 WebCodecs 导出 MP4（已废弃）
  async exportMP4WithWebCodecs(blob, options) {
    console.warn('🚨 exportMP4WithWebCodecs 已废弃，请使用主线程的 Mediabunny 方案');
    throw new Error('MP4 WebCodecs 导出已迁移到主线程 Mediabunny 方案');
  }

  // 备用方法：返回原始文件
  async exportMP4Fallback(blob, options) {
    console.warn('MP4 conversion not available, returning original WebM');
    
    this.sendProgress(50, '⚠️ 无法转换为 MP4');
    this.sendProgress(100, '保留 WebM 格式');
    
    return {
      blob: blob,
      format: 'webm',
      method: 'fallback',
      warning: '无法在浏览器中转换为 MP4 格式',
      needsTranscoding: true
    };
  }

  // 准备 GIF 帧数据
  async prepareGIFFrames(blob, options) {
    console.log('Preparing GIF frames with options:', options);
    
    const {
      width = 480,
      height = 270,
      fps = 10,
      maxDuration = 30 // 最长30秒
    } = options;
    
    this.sendProgress(10, '分析视频...');
    
    // 分析视频信息
    const videoInfo = await this.analyzeVideo(blob);
    const duration = Math.min(videoInfo.duration, maxDuration);
    const frameInterval = 1000 / fps; // 毫秒
    const totalFrames = Math.floor(duration * fps);
    
    this.sendProgress(20, `准备提取${totalFrames}帧...`);
    
    // 创建离屏 canvas
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // 提取帧数据
    const frames = [];
    const frameStep = duration / totalFrames;
    
    // 注意：实际帧提取需要在主线程完成（使用 video 元素）
    // Worker 只负责准备参数和压缩
    
    return {
      format: 'gif',
      frameConfig: {
        width,
        height,
        fps,
        duration,
        totalFrames,
        frameInterval
      },
      // 返回配置，实际的帧提取将在主线程完成
      needsMainThread: true
    };
  }

  // 分析视频信息
  async analyzeVideo(blob) {
    // 在 Worker 中无法直接使用 video 元素
    // 返回基本信息，详细分析需要在主线程
    return {
      size: blob.size,
      type: blob.type,
      // 这些信息需要从主线程传递
      duration: 0,
      width: 0,
      height: 0
    };
  }

  // WebM 压缩
  async compressWebM(blob, videoInfo, options) {
    const { quality = 'medium' } = options;
    
    // 质量预设
    const qualityPresets = {
      high: { bitrate: 0.8, quality: 0.9 },
      medium: { bitrate: 0.5, quality: 0.7 },
      low: { bitrate: 0.3, quality: 0.5 }
    };
    
    const preset = qualityPresets[quality];
    
    // 这里简化处理，实际需要更复杂的压缩逻辑
    // 可以使用 WebCodecs 重新编码或其他压缩算法
    
    // 暂时返回原始 blob
    // TODO: 实现实际的压缩逻辑
    return blob;
  }

  // 创建 MP4 容器
  createMP4Container() {
    if (typeof MP4Box === 'undefined') {
      console.error('MP4Box not available');
      return new ArrayBuffer(0);
    }
    
    const mp4boxFile = MP4Box.createFile();
    
    // 添加视频轨道
    mp4boxFile.addTrack({
      timescale: 1000,
      width: 1920,
      height: 1080,
      nb_samples: 0,
      codec: 'avc1.42001E',
      description: null,
      language: 'und'
    });
    
    // TODO: 完整的容器创建逻辑
    
    return mp4boxFile.getBuffer();
  }

  // 发送进度消息
  sendProgress(percent, message) {
    self.postMessage({
      type: 'progress',
      data: {
        percent,
        message,
        timestamp: Date.now()
      }
    });
  }

  // 发送错误消息
  sendError(error) {
    self.postMessage({
      type: 'error',
      data: {
        message: error.message,
        stack: error.stack,
        timestamp: Date.now()
      }
    });
  }
}

// Worker 实例
const exportWorker = new VideoExportWorker();

// 处理主线程消息
self.onmessage = async (event) => {
  const { type, data } = event.data;
  
  console.log('Export worker received message:', type);
  
  try {
    switch (type) {
      case 'export':
        const result = await exportWorker.processExport(data);
        self.postMessage({
          type: 'export-complete',
          data: result
        });
        break;
        
      case 'analyze':
        const info = await exportWorker.analyzeVideo(data.blob);
        self.postMessage({
          type: 'analyze-complete',
          data: info
        });
        break;
        
      case 'cancel':
        exportWorker.state = ExportState.IDLE;
        self.postMessage({
          type: 'cancelled',
          data: { timestamp: Date.now() }
        });
        break;
        
      default:
        console.warn('Unknown message type:', type);
    }
  } catch (error) {
    console.error('Worker error:', error);
    exportWorker.sendError(error);
  }
};

// Worker 初始化完成
console.log('Export Worker initialized');
self.postMessage({
  type: 'ready',
  data: { timestamp: Date.now() }
});
