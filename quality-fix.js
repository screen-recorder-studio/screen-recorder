// 视频质量优化补丁
// 解决方案：修复分辨率捕获和提升编码质量

// ============================================
// 1. 修复 videoRecorder.js - 确保高分辨率捕获
// ============================================

// 在 videoRecorder.js 的 requestScreenCapture 方法中修改约束逻辑：

async requestScreenCapture() {
  try {
    const response = await this.requestPermissionFromBackground();
    
    if (response.success && response.streamId) {
      console.log('StreamId received:', response.streamId);
      
      // 使用现代约束格式，更好的兼容性
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
        
        // 获取实际的视频轨道设置
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        console.log('Actual capture resolution:', {
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate
        });
        
        // 如果分辨率太低，尝试应用约束
        if (settings.width < 1920 || settings.height < 1080) {
          console.log('Resolution too low, applying constraints...');
          
          // 应用高分辨率约束到轨道
          await videoTrack.applyConstraints({
            width: { ideal: 1920, min: 1920 },
            height: { ideal: 1080, min: 1080 },
            frameRate: { ideal: 30 }
          }).catch(err => {
            console.warn('Could not apply high resolution constraints:', err);
            // 继续使用当前分辨率
          });
          
          // 重新获取设置以确认
          const newSettings = videoTrack.getSettings();
          console.log('Resolution after constraints:', {
            width: newSettings.width,
            height: newSettings.height
          });
        }
        
        return stream;
        
      } catch (mediaError) {
        console.error('getUserMedia failed:', mediaError);
        throw mediaError;
      }
    }
  } catch (error) {
    console.error('Screen capture request failed:', error);
    throw new Error('屏幕录制权限请求失败: ' + error.message);
  }
}

// ============================================
// 2. 修复 backgroundProcessor.js - 动态Canvas尺寸
// ============================================

// 在 createCompositeCanvas 方法中，根据源视频动态设置画布尺寸：

createCompositeCanvas(backgroundConfig, videoInfo) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { 
    alpha: false,
    desynchronized: true
  });
  
  // 设置高质量渲染
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // 计算输出尺寸 - 基于源视频分辨率
  let outputWidth, outputHeight;
  const padding = backgroundConfig.padding || 60;
  
  if (backgroundConfig.outputRatio === 'custom') {
    outputWidth = backgroundConfig.customWidth || videoInfo.width + padding * 2;
    outputHeight = backgroundConfig.customHeight || videoInfo.height + padding * 2;
  } else {
    // 根据源视频大小动态计算，保持高分辨率
    const sourceWidth = videoInfo.width;
    const sourceHeight = videoInfo.height;
    
    // 确保输出不小于源视频
    const minWidth = Math.max(1920, sourceWidth + padding * 2);
    const minHeight = Math.max(1080, sourceHeight + padding * 2);
    
    const ratios = {
      '16:9': { w: Math.max(minWidth, 1920), h: Math.max(minHeight, 1080) },
      '1:1': { w: Math.max(minWidth, minHeight), h: Math.max(minWidth, minHeight) },
      '9:16': { w: Math.max(1080, sourceWidth + padding * 2), h: Math.max(1920, sourceHeight + padding * 2) },
      '4:5': { w: Math.max(1080, sourceWidth + padding * 2), h: Math.max(1350, sourceHeight + padding * 2) }
    };
    
    const ratio = ratios[backgroundConfig.outputRatio] || ratios['16:9'];
    
    // 如果源视频是4K，保持4K输出
    if (sourceWidth >= 3840 || sourceHeight >= 2160) {
      outputWidth = Math.max(ratio.w, 3840);
      outputHeight = Math.max(ratio.h, 2160);
    } else {
      outputWidth = ratio.w;
      outputHeight = ratio.h;
    }
  }
  
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  
  console.log('Canvas dimensions optimized:', {
    source: { width: videoInfo.width, height: videoInfo.height },
    output: { width: outputWidth, height: outputHeight }
  });
  
  // ... 其余代码保持不变
}

// ============================================
// 3. 提升MediaRecorder比特率（已完成）
// ============================================

// videoRecorder.js 中：
const options = {
  mimeType: this.getSupportedMimeType(),
  videoBitsPerSecond: 20000000, // 提升到 20 Mbps
  audioBitsPerSecond: 128000
};

// backgroundProcessor.js 中：
const recorderOptions = {
  mimeType: mimeType,
  videoBitsPerSecond: 15000000, // 提升到 15 Mbps
  audioBitsPerSecond: 128000
};

// ============================================
// 4. 添加质量监控功能
// ============================================

class QualityMonitor {
  static checkStreamQuality(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return null;
    
    const settings = videoTrack.getSettings();
    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
    
    const quality = {
      actual: {
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate,
        aspectRatio: settings.aspectRatio
      },
      capabilities: {
        maxWidth: capabilities.width?.max,
        maxHeight: capabilities.height?.max,
        maxFrameRate: capabilities.frameRate?.max
      },
      score: this.calculateQualityScore(settings)
    };
    
    console.log('Stream Quality Analysis:', quality);
    return quality;
  }
  
  static calculateQualityScore(settings) {
    let score = 0;
    
    // 分辨率评分
    if (settings.width >= 3840) score += 40; // 4K
    else if (settings.width >= 1920) score += 30; // FHD
    else if (settings.width >= 1280) score += 20; // HD
    else score += 10;
    
    // 帧率评分
    if (settings.frameRate >= 60) score += 30;
    else if (settings.frameRate >= 30) score += 20;
    else if (settings.frameRate >= 24) score += 15;
    else score += 10;
    
    // 纵横比评分
    const aspectRatio = settings.width / settings.height;
    if (Math.abs(aspectRatio - 16/9) < 0.01) score += 30; // 16:9
    else if (Math.abs(aspectRatio - 4/3) < 0.01) score += 25; // 4:3
    else score += 20;
    
    return score;
  }
  
  static suggestImprovements(quality) {
    const suggestions = [];
    
    if (quality.actual.width < 1920) {
      suggestions.push('建议：提高屏幕分辨率到至少1920x1080以获得更清晰的录制效果');
    }
    
    if (quality.actual.frameRate < 30) {
      suggestions.push('建议：提高帧率到至少30fps以获得更流畅的视频');
    }
    
    if (quality.score < 60) {
      suggestions.push('警告：当前录制质量较低，可能影响文字清晰度');
    }
    
    return suggestions;
  }
}

// ============================================
// 5. 实施建议
// ============================================

/*
实施步骤：

1. 立即修改 videoRecorder.js:
   - 移除多级降级逻辑
   - 使用 applyConstraints() 动态调整分辨率
   - 添加质量监控

2. 修改 backgroundProcessor.js:
   - 实现动态Canvas尺寸
   - 保持源视频分辨率
   - 提升编码比特率

3. 添加用户界面提示:
   - 显示实际录制分辨率
   - 提供质量选择器
   - 警告低质量情况

4. 测试验证:
   - 测试不同分辨率屏幕
   - 验证4K录制支持
   - 检查文字清晰度

5. 可选：集成WebCodecs (Chrome 94+):
   - 更精确的质量控制
   - 硬件加速编码
   - 更小的文件体积
*/

// 导出工具函数
window.QualityMonitor = QualityMonitor;
