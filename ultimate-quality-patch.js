// 终极视频质量优化补丁
// 目标：达到专业级录制质量

// ============================================
// 1. 提升比特率到专业级别
// ============================================

// videoRecorder.js - line 55-60
const getOptimalBitrate = (width, height) => {
  const pixels = width * height;
  
  // 超高质量比特率计算（基于像素数）
  // 4K: 40-50 Mbps
  // 2K: 25-30 Mbps  
  // FHD: 15-20 Mbps
  
  if (pixels >= 3840 * 2160) {
    return 50000000; // 50 Mbps for 4K
  } else if (pixels >= 2560 * 1440) {
    return 30000000; // 30 Mbps for 2K
  } else if (pixels >= 1920 * 1080) {
    return 20000000; // 20 Mbps for FHD
  } else {
    return 15000000; // 15 Mbps minimum
  }
};

// 在 startTabRecording 方法中使用动态比特率
const stream = await this.requestScreenCapture();
const videoTrack = stream.getVideoTracks()[0];
const settings = videoTrack.getSettings();
const optimalBitrate = getOptimalBitrate(settings.width, settings.height);

const options = {
  mimeType: this.getSupportedMimeType(),
  videoBitsPerSecond: optimalBitrate,
  audioBitsPerSecond: 192000 // 提升音频质量到 192 kbps
};

// ============================================
// 2. 优化 Canvas 渲染质量
// ============================================

// backgroundProcessor.js - createCompositeCanvas 方法
createCompositeCanvas(backgroundConfig, videoInfo) {
  const canvas = document.createElement('canvas');
  
  // 使用最高质量的 Canvas 上下文
  const ctx = canvas.getContext('2d', { 
    alpha: false,
    desynchronized: true,
    colorSpace: 'srgb', // 确保颜色空间一致
    willReadFrequently: false // 优化性能
  });
  
  // 设置最高质量渲染
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // 添加抗锯齿设置
  ctx.filter = 'none'; // 避免默认滤镜
  ctx.globalCompositeOperation = 'source-over';
  
  // 提升 Canvas 分辨率（设备像素比）
  const dpr = window.devicePixelRatio || 1;
  
  // 如果设备支持高 DPI，相应提升 Canvas 分辨率
  if (dpr > 1 && videoInfo.width * dpr <= 7680) { // 限制最大 8K
    canvas.width = outputWidth * dpr;
    canvas.height = outputHeight * dpr;
    ctx.scale(dpr, dpr);
    
    // 样式尺寸保持不变
    canvas.style.width = outputWidth + 'px';
    canvas.style.height = outputHeight + 'px';
  } else {
    canvas.width = outputWidth;
    canvas.height = outputHeight;
  }
  
  // ... rest of the code
}

// ============================================
// 3. 提升帧率到 60 FPS（如果硬件支持）
// ============================================

// backgroundProcessor.js - processVideoWithCanvas 方法
async processVideoWithCanvas(videoElement, canvas, ctx, layout, backgroundConfig, progressCallback) {
  // 检测系统性能
  const isHighPerformance = navigator.hardwareConcurrency >= 8;
  const targetFPS = isHighPerformance ? 60 : 30;
  
  // 创建高帧率流
  const stream = canvas.captureStream(targetFPS);
  
  // 动态调整编码比特率（帧率越高，比特率应该越高）
  const baseBitrate = 15000000; // 15 Mbps base
  const frameRateMultiplier = targetFPS / 30; // 60fps = 2x, 30fps = 1x
  const adjustedBitrate = Math.round(baseBitrate * frameRateMultiplier);
  
  const recorderOptions = {
    mimeType: this.getSupportedMimeType(),
    videoBitsPerSecond: adjustedBitrate,
    audioBitsPerSecond: 192000
  };
  
  // ... rest of the code
}

// ============================================
// 4. 使用更高效的编码器（VP9 优先）
// ============================================

getSupportedMimeType() {
  const types = [
    // VP9 提供最佳压缩效率和质量
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    // H.264 硬件加速（如果可用）
    'video/mp4;codecs=h264',
    // VP8 作为后备
    'video/webm;codecs=vp8,opus', 
    'video/webm;codecs=vp8',
    // 默认
    'video/webm'
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log('Using high-quality codec:', type);
      
      // 为不同编码器调整参数
      if (type.includes('vp9')) {
        // VP9 特殊优化
        return type + ',level-id=1';
      }
      return type;
    }
  }
  
  return 'video/webm';
}

// ============================================
// 5. 优化视频捕获约束
// ============================================

// videoRecorder.js - requestScreenCapture 方法
async requestScreenCapture() {
  const response = await this.requestPermissionFromBackground();
  
  if (response.success && response.streamId) {
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: response.streamId,
          // 移除分辨率限制，让系统使用最高可用分辨率
          googHighBitrate: true, // Chrome 特定：请求高比特率
          googVeryHighBitrate: true // Chrome 特定：请求超高比特率
        }
      }
    };
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // 尝试应用额外的质量约束
    const videoTrack = stream.getVideoTracks()[0];
    const capabilities = videoTrack.getCapabilities();
    
    // 应用最高可能的设置
    await videoTrack.applyConstraints({
      width: { ideal: capabilities.width?.max || 3840 },
      height: { ideal: capabilities.height?.max || 2160 },
      frameRate: { ideal: capabilities.frameRate?.max || 60 },
      resizeMode: 'none' // 防止自动缩放
    }).catch(err => {
      console.log('Could not apply max constraints, using current settings');
    });
    
    return stream;
  }
}

// ============================================
// 6. 智能质量预设系统
// ============================================

class QualityPresets {
  static ULTRA = {
    name: '超高质量 (4K)',
    resolution: { width: 3840, height: 2160 },
    bitrate: 50000000, // 50 Mbps
    frameRate: 60,
    codec: 'vp9'
  };
  
  static HIGH = {
    name: '高质量 (2K)', 
    resolution: { width: 2560, height: 1440 },
    bitrate: 25000000, // 25 Mbps
    frameRate: 30,
    codec: 'vp9'
  };
  
  static STANDARD = {
    name: '标准质量 (FHD)',
    resolution: { width: 1920, height: 1080 },
    bitrate: 15000000, // 15 Mbps
    frameRate: 30,
    codec: 'vp8'
  };
  
  static BALANCED = {
    name: '平衡模式',
    resolution: { width: 1920, height: 1080 },
    bitrate: 10000000, // 10 Mbps
    frameRate: 30,
    codec: 'vp8'
  };
  
  static getOptimalPreset(sourceWidth, sourceHeight, performanceScore) {
    const sourcePixels = sourceWidth * sourceHeight;
    
    // 根据源分辨率和性能选择预设
    if (sourcePixels >= 3840 * 2160 && performanceScore >= 80) {
      return this.ULTRA;
    } else if (sourcePixels >= 2560 * 1440 && performanceScore >= 60) {
      return this.HIGH;
    } else if (performanceScore >= 40) {
      return this.STANDARD;
    } else {
      return this.BALANCED;
    }
  }
  
  static calculatePerformanceScore() {
    // 简单的性能评分
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4; // GB
    const connection = navigator.connection?.effectiveType || '4g';
    
    let score = 0;
    
    // CPU 核心数（最高 40 分）
    score += Math.min(cores * 5, 40);
    
    // 内存（最高 30 分）
    score += Math.min(memory * 5, 30);
    
    // 网络（最高 30 分）
    const networkScores = { 'slow-2g': 5, '2g': 10, '3g': 20, '4g': 30 };
    score += networkScores[connection] || 30;
    
    return score;
  }
}

// ============================================
// 7. 实时质量监控和自适应
// ============================================

class QualityMonitor {
  constructor() {
    this.frameDrops = 0;
    this.lastFrameTime = 0;
    this.qualityHistory = [];
  }
  
  monitorFrame(timestamp) {
    if (this.lastFrameTime > 0) {
      const frameDuration = timestamp - this.lastFrameTime;
      const expectedDuration = 1000 / 30; // 30 FPS expected
      
      if (frameDuration > expectedDuration * 1.5) {
        this.frameDrops++;
        console.warn(`Frame drop detected: ${frameDuration.toFixed(2)}ms`);
      }
    }
    
    this.lastFrameTime = timestamp;
    
    // 每 100 帧评估一次质量
    if (this.qualityHistory.length >= 100) {
      this.evaluateQuality();
      this.qualityHistory = [];
    }
  }
  
  evaluateQuality() {
    const dropRate = this.frameDrops / 100;
    
    if (dropRate > 0.1) {
      console.warn(`High frame drop rate: ${(dropRate * 100).toFixed(1)}%`);
      // 建议降低质量设置
      return 'decrease';
    } else if (dropRate < 0.02) {
      // 可以尝试提高质量
      return 'increase';
    }
    
    return 'maintain';
  }
}

// ============================================
// 8. 实施步骤
// ============================================

/*
立即实施：

1. 更新 videoRecorder.js:
   - 第 55-60 行：使用动态比特率
   - 第 82-169 行：优化捕获约束

2. 更新 backgroundProcessor.js:
   - 第 256-335 行：优化 Canvas 创建
   - 第 361-366 行：提升编码比特率
   - 第 353 行：考虑 60 FPS

3. 测试不同场景:
   - 文字密集的网页
   - 动画和视频内容
   - 高 DPI 显示器

预期提升：
- 文字清晰度：提升 50-100%
- 动画流畅度：30 FPS → 60 FPS
- 色彩准确度：更好的颜色空间处理
- 文件大小：增加 30-50%（可接受）
*/
