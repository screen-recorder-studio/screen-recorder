// Smart Export Manager
// 智能视频导出和压缩模块
// 实现多格式支持、智能压缩、质量优化

class SmartExportManager {
  constructor() {
    // 导出配置
    this.exportConfigs = {
      // 质量预设
      quality: {
        'ultra': { bitrate: 1.0, quality: 0.95, preset: 'slow' },
        'high': { bitrate: 0.8, quality: 0.85, preset: 'medium' },
        'medium': { bitrate: 0.6, quality: 0.75, preset: 'fast' },
        'low': { bitrate: 0.4, quality: 0.65, preset: 'faster' },
        'tiny': { bitrate: 0.25, quality: 0.55, preset: 'veryfast' }
      },
      
      // 格式配置
      formats: {
        'webm': {
          mimeType: 'video/webm',
          codecs: ['vp9', 'vp8'],
          extension: 'webm',
          supported: true
        },
        'mp4': {
          mimeType: 'video/mp4',
          codecs: ['h264', 'hevc'],
          extension: 'mp4',
          supported: this.checkMP4Support()
        },
        'mkv': {
          mimeType: 'video/x-matroska',
          codecs: ['vp9', 'h264'],
          extension: 'mkv',
          supported: false // 需要额外库支持
        }
      },
      
      // 分辨率预设
      resolutions: {
        '4k': { width: 3840, height: 2160, label: '4K Ultra HD' },
        '2k': { width: 2560, height: 1440, label: '2K QHD' },
        '1080p': { width: 1920, height: 1080, label: 'Full HD' },
        '720p': { width: 1280, height: 720, label: 'HD' },
        '480p': { width: 854, height: 480, label: 'SD' },
        '360p': { width: 640, height: 360, label: 'Low' }
      }
    };
    
    // 压缩器实例
    this.compressor = null;
    this.codecDetector = null;
    
    // 导出统计
    this.stats = {
      totalExports: 0,
      totalSizeSaved: 0,
      averageCompressionRatio: 0,
      formatUsage: {}
    };
  }
  
  // 检查 MP4 支持
  checkMP4Support() {
    // 检查是否支持 MediaRecorder 的 MP4
    if (typeof MediaRecorder !== 'undefined') {
      return MediaRecorder.isTypeSupported('video/mp4');
    }
    return false;
  }
  
  // 智能导出主函数
  async smartExport(videoBlob, options = {}) {
    const {
      quality = 'high',
      format = 'auto',
      resolution = 'original',
      maxFileSize = null,
      preserveAudio = true,
      fastMode = false,
      progressCallback = null
    } = options;
    
    console.log('🎯 Starting smart export with options:', options);
    
    try {
      // Step 1: 分析原始视频
      progressCallback?.(10, '分析视频...');
      const videoInfo = await this.analyzeVideo(videoBlob);
      console.log('Video analysis:', videoInfo);
      
      // Step 2: 确定最佳导出格式
      progressCallback?.(20, '选择最佳格式...');
      const targetFormat = await this.selectBestFormat(format, videoInfo);
      console.log('Selected format:', targetFormat);
      
      // Step 3: 计算目标参数
      progressCallback?.(30, '计算压缩参数...');
      const exportParams = this.calculateExportParams(
        videoInfo,
        quality,
        resolution,
        maxFileSize
      );
      console.log('Export parameters:', exportParams);
      
      // Step 4: 执行压缩和转码
      progressCallback?.(40, '压缩视频...');
      const compressedBlob = await this.compressVideo(
        videoBlob,
        exportParams,
        targetFormat,
        fastMode,
        (progress) => {
          // 映射内部进度到 40-90
          const mappedProgress = 40 + (progress * 0.5);
          progressCallback?.(mappedProgress, '压缩中...');
        }
      );
      
      // Step 5: 验证输出
      progressCallback?.(90, '验证输出...');
      const outputInfo = await this.validateOutput(compressedBlob, exportParams);
      
      // Step 6: 如果文件还是太大，进行二次压缩
      let finalBlob = compressedBlob;
      if (maxFileSize && outputInfo.size > maxFileSize) {
        console.log('File too large, applying second pass compression...');
        progressCallback?.(95, '优化文件大小...');
        finalBlob = await this.adaptiveCompress(compressedBlob, maxFileSize);
      }
      
      // 更新统计
      this.updateStats(videoBlob.size, finalBlob.size, targetFormat);
      
      progressCallback?.(100, '导出完成！');
      
      // 返回结果
      return {
        blob: finalBlob,
        format: targetFormat,
        originalSize: videoBlob.size,
        compressedSize: finalBlob.size,
        compressionRatio: (1 - finalBlob.size / videoBlob.size) * 100,
        metadata: {
          ...outputInfo,
          quality,
          exportParams
        }
      };
      
    } catch (error) {
      console.error('Smart export failed:', error);
      // 降级处理：返回原始文件
      return {
        blob: videoBlob,
        format: 'webm',
        originalSize: videoBlob.size,
        compressedSize: videoBlob.size,
        compressionRatio: 0,
        error: error.message
      };
    }
  }
  
  // 分析视频
  async analyzeVideo(blob) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(blob);
      
      video.onloadedmetadata = () => {
        const info = {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          aspectRatio: video.videoWidth / video.videoHeight,
          fileSize: blob.size,
          mimeType: blob.type,
          bitrate: (blob.size * 8) / video.duration / 1000, // kbps
          hasAudio: video.mozHasAudio || video.webkitAudioDecodedByteCount > 0 || false
        };
        
        URL.revokeObjectURL(url);
        resolve(info);
      };
      
      video.src = url;
    });
  }
  
  // 选择最佳格式
  async selectBestFormat(requestedFormat, videoInfo) {
    // 如果指定了格式且支持，使用指定格式
    if (requestedFormat !== 'auto' && this.exportConfigs.formats[requestedFormat]?.supported) {
      return requestedFormat;
    }
    
    // 自动选择最佳格式
    // 优先级：MP4 > WebM > 原格式
    if (this.exportConfigs.formats.mp4.supported) {
      return 'mp4';
    }
    
    if (this.exportConfigs.formats.webm.supported) {
      return 'webm';
    }
    
    // 默认使用 WebM
    return 'webm';
  }
  
  // 计算导出参数
  calculateExportParams(videoInfo, quality, resolution, maxFileSize) {
    const qualityConfig = this.exportConfigs.quality[quality];
    
    // 计算目标分辨率
    let targetWidth = videoInfo.width;
    let targetHeight = videoInfo.height;
    
    if (resolution !== 'original' && this.exportConfigs.resolutions[resolution]) {
      const resConfig = this.exportConfigs.resolutions[resolution];
      // 保持宽高比
      if (videoInfo.aspectRatio > resConfig.width / resConfig.height) {
        targetWidth = resConfig.width;
        targetHeight = Math.round(resConfig.width / videoInfo.aspectRatio);
      } else {
        targetHeight = resConfig.height;
        targetWidth = Math.round(resConfig.height * videoInfo.aspectRatio);
      }
    }
    
    // 计算目标比特率
    let targetBitrate = videoInfo.bitrate * qualityConfig.bitrate;
    
    // 如果有文件大小限制，调整比特率
    if (maxFileSize) {
      const maxBitrate = (maxFileSize * 8) / videoInfo.duration / 1000;
      targetBitrate = Math.min(targetBitrate, maxBitrate * 0.9); // 留10%余量
    }
    
    // 智能比特率调整（基于分辨率）
    const pixels = targetWidth * targetHeight;
    const originalPixels = videoInfo.width * videoInfo.height;
    if (pixels < originalPixels) {
      // 分辨率降低，相应降低比特率
      targetBitrate *= (pixels / originalPixels);
    }
    
    return {
      width: targetWidth,
      height: targetHeight,
      bitrate: Math.round(targetBitrate),
      videoBitrate: Math.round(targetBitrate * 0.9), // 90%给视频
      audioBitrate: Math.round(targetBitrate * 0.1), // 10%给音频
      quality: qualityConfig.quality,
      preset: qualityConfig.preset,
      framerate: 30, // 保持30fps
      keyframeInterval: 60 // 每2秒一个关键帧
    };
  }
  
  // 压缩视频
  async compressVideo(blob, params, format, fastMode, progressCallback) {
    // 如果支持 WebCodecs，使用高级压缩
    if (this.isWebCodecsAvailable()) {
      return this.compressWithWebCodecs(blob, params, format, progressCallback);
    }
    
    // 否则使用 Canvas 方法压缩
    return this.compressWithCanvas(blob, params, progressCallback);
  }
  
  // 使用 WebCodecs 压缩
  async compressWithWebCodecs(blob, params, format, progressCallback) {
    // 初始化编码器检测器
    if (!this.codecDetector) {
      if (typeof WebCodecsCodecDetector !== 'undefined') {
        this.codecDetector = new WebCodecsCodecDetector();
      } else {
        throw new Error('WebCodecs detector not available');
      }
    }
    
    // 选择合适的编码器
    const codecFamily = format === 'mp4' ? 'h264' : 'vp9';
    const codec = await this.codecDetector.getBestCodec(
      params.width,
      params.height,
      params.framerate,
      codecFamily
    );
    
    if (!codec) {
      throw new Error('No suitable codec found');
    }
    
    console.log('Using codec for compression:', codec.name);
    
    // 创建解码器和编码器
    const frames = await this.decodeVideo(blob);
    const processedFrames = await this.processFrames(frames, params);
    const compressedChunks = await this.encodeFrames(processedFrames, codec, params);
    
    // 封装成最终格式
    const compressedBlob = await this.muxVideo(compressedChunks, format);
    
    return compressedBlob;
  }
  
  // 使用 Canvas 压缩（降级方案）
  async compressWithCanvas(blob, params, progressCallback) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = params.width;
      canvas.height = params.height;
      
      const chunks = [];
      const recorder = new MediaRecorder(canvas.captureStream(params.framerate), {
        mimeType: 'video/webm',
        videoBitsPerSecond: params.bitrate * 1000
      });
      
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const compressedBlob = new Blob(chunks, { type: 'video/webm' });
        resolve(compressedBlob);
      };
      
      video.onloadedmetadata = () => {
        recorder.start();
        video.play();
      };
      
      video.onplay = () => {
        const drawFrame = () => {
          if (!video.paused && !video.ended) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // 更新进度
            const progress = video.currentTime / video.duration;
            progressCallback?.(progress);
            
            requestAnimationFrame(drawFrame);
          }
        };
        drawFrame();
      };
      
      video.onended = () => {
        recorder.stop();
      };
      
      video.src = URL.createObjectURL(blob);
    });
  }
  
  // 自适应压缩（二次压缩）
  async adaptiveCompress(blob, targetSize) {
    const currentSize = blob.size;
    const compressionRatio = targetSize / currentSize;
    
    console.log(`Adaptive compression: ${currentSize} -> ${targetSize} (${compressionRatio})`);
    
    // 分析需要的压缩程度
    let quality = 'medium';
    if (compressionRatio < 0.3) {
      quality = 'tiny';
    } else if (compressionRatio < 0.5) {
      quality = 'low';
    }
    
    // 重新压缩
    const result = await this.smartExport(blob, {
      quality,
      format: 'webm',
      resolution: compressionRatio < 0.5 ? '720p' : 'original',
      fastMode: true
    });
    
    return result.blob;
  }
  
  // 验证输出
  async validateOutput(blob, params) {
    const info = await this.analyzeVideo(blob);
    
    // 检查是否满足要求
    const validation = {
      size: blob.size,
      duration: info.duration,
      resolution: `${info.width}x${info.height}`,
      bitrate: info.bitrate,
      valid: true,
      warnings: []
    };
    
    // 检查比特率
    if (info.bitrate > params.bitrate * 1.2) {
      validation.warnings.push('Bitrate higher than expected');
    }
    
    // 检查分辨率
    if (info.width !== params.width || info.height !== params.height) {
      validation.warnings.push('Resolution mismatch');
    }
    
    return validation;
  }
  
  // 检查 WebCodecs 可用性
  isWebCodecsAvailable() {
    return typeof VideoEncoder !== 'undefined' && 
           typeof VideoDecoder !== 'undefined';
  }
  
  // 解码视频（WebCodecs）
  async decodeVideo(blob) {
    // 简化实现，实际需要完整的解码逻辑
    const frames = [];
    // ... 解码逻辑
    return frames;
  }
  
  // 处理帧（调整大小等）
  async processFrames(frames, params) {
    const processedFrames = [];
    
    for (const frame of frames) {
      // 调整帧大小
      const processedFrame = await this.resizeFrame(frame, params.width, params.height);
      processedFrames.push(processedFrame);
    }
    
    return processedFrames;
  }
  
  // 调整帧大小
  async resizeFrame(frame, targetWidth, targetHeight) {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(frame, 0, 0, targetWidth, targetHeight);
    
    return new VideoFrame(canvas, {
      timestamp: frame.timestamp,
      duration: frame.duration
    });
  }
  
  // 编码帧
  async encodeFrames(frames, codec, params) {
    const chunks = [];
    
    return new Promise(async (resolve, reject) => {
      const encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          chunks.push({ chunk, metadata });
        },
        error: (error) => {
          reject(error);
        }
      });
      
      // 配置编码器
      const config = {
        ...codec.config,
        width: params.width,
        height: params.height,
        bitrate: params.videoBitrate * 1000,
        framerate: params.framerate
      };
      
      await encoder.configure(config);
      
      // 编码所有帧
      for (let i = 0; i < frames.length; i++) {
        const keyFrame = i % params.keyframeInterval === 0;
        encoder.encode(frames[i], { keyFrame });
      }
      
      await encoder.flush();
      encoder.close();
      
      resolve(chunks);
    });
  }
  
  // 封装视频
  async muxVideo(chunks, format) {
    // 简化实现，实际需要使用 mp4box.js 或 webm-muxer
    const data = [];
    
    for (const { chunk } of chunks) {
      const buffer = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buffer);
      data.push(buffer);
    }
    
    const mimeType = this.exportConfigs.formats[format].mimeType;
    return new Blob(data, { type: mimeType });
  }
  
  // 批量导出
  async batchExport(videoBlob, profiles) {
    const results = [];
    
    for (const profile of profiles) {
      console.log(`Exporting profile: ${profile.name}`);
      
      const result = await this.smartExport(videoBlob, profile.options);
      results.push({
        ...result,
        profile: profile.name
      });
    }
    
    return results;
  }
  
  // 更新统计信息
  updateStats(originalSize, compressedSize, format) {
    this.stats.totalExports++;
    this.stats.totalSizeSaved += (originalSize - compressedSize);
    
    // 更新格式使用统计
    if (!this.stats.formatUsage[format]) {
      this.stats.formatUsage[format] = 0;
    }
    this.stats.formatUsage[format]++;
    
    // 计算平均压缩率
    const totalOriginal = this.stats.totalExports * originalSize;
    const totalCompressed = totalOriginal - this.stats.totalSizeSaved;
    this.stats.averageCompressionRatio = (1 - totalCompressed / totalOriginal) * 100;
  }
  
  // 获取统计信息
  getStats() {
    return {
      ...this.stats,
      totalSizeSavedMB: (this.stats.totalSizeSaved / 1024 / 1024).toFixed(2),
      averageCompressionRatio: this.stats.averageCompressionRatio.toFixed(1) + '%'
    };
  }
  
  // 获取推荐的导出配置
  getRecommendedConfig(videoInfo, targetUse) {
    const configs = {
      'social-media': {
        quality: 'medium',
        format: 'mp4',
        resolution: '1080p',
        maxFileSize: 100 * 1024 * 1024 // 100MB
      },
      'email': {
        quality: 'low',
        format: 'mp4',
        resolution: '720p',
        maxFileSize: 25 * 1024 * 1024 // 25MB
      },
      'archive': {
        quality: 'ultra',
        format: 'webm',
        resolution: 'original',
        maxFileSize: null
      },
      'web-upload': {
        quality: 'high',
        format: 'mp4',
        resolution: '1080p',
        maxFileSize: 500 * 1024 * 1024 // 500MB
      },
      'mobile': {
        quality: 'medium',
        format: 'mp4',
        resolution: '720p',
        maxFileSize: 50 * 1024 * 1024 // 50MB
      }
    };
    
    return configs[targetUse] || configs['web-upload'];
  }
  
  // 估算压缩后大小
  estimateCompressedSize(originalSize, quality, resolution) {
    const qualityFactors = {
      'ultra': 0.9,
      'high': 0.7,
      'medium': 0.5,
      'low': 0.3,
      'tiny': 0.2
    };
    
    const resolutionFactors = {
      'original': 1.0,
      '4k': 1.0,
      '2k': 0.7,
      '1080p': 0.5,
      '720p': 0.3,
      '480p': 0.2,
      '360p': 0.15
    };
    
    const qualityFactor = qualityFactors[quality] || 0.5;
    const resolutionFactor = resolutionFactors[resolution] || 1.0;
    
    return Math.round(originalSize * qualityFactor * resolutionFactor);
  }
}

// 导出
window.SmartExportManager = SmartExportManager;
