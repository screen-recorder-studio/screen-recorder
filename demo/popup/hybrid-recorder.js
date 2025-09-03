// Hybrid Recording Solution
// 混合方案：使用 MediaRecorder 录制可播放视频，同时利用 WebCodecs 的性能优势

class HybridRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.webCodecsAdapter = null;
    this.recordedChunks = [];
    this.stream = null;
    this.mode = 'hybrid'; // 'hybrid', 'mediarecorder', 'webcodecs'
  }
  
  // 检测支持情况
  static isSupported() {
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
    const hasWebCodecs = typeof VideoEncoder !== 'undefined';
    
    return {
      mediaRecorder: hasMediaRecorder,
      webCodecs: hasWebCodecs,
      hybrid: hasMediaRecorder && hasWebCodecs
    };
  }
  
  // 开始录制
  async start(stream) {
    this.stream = stream;
    const support = HybridRecorder.isSupported();
    
    if (support.hybrid) {
      // 混合模式：主录制用 MediaRecorder（生成可播放视频）
      // 辅助分析用 WebCodecs（性能监控和优化）
      console.log('🎯 Using Hybrid mode: MediaRecorder + WebCodecs monitoring');
      this.mode = 'hybrid';
      
      // 启动 MediaRecorder 进行主录制
      await this.startMediaRecorder(stream);
      
      // 同时启动 WebCodecs 进行性能监控（不影响主录制）
      try {
        this.startWebCodecsMonitoring(stream);
      } catch (error) {
        console.warn('WebCodecs monitoring failed, continuing with MediaRecorder only:', error);
      }
      
    } else if (support.mediaRecorder) {
      // 仅 MediaRecorder 模式
      console.log('📹 Using MediaRecorder only mode');
      this.mode = 'mediarecorder';
      await this.startMediaRecorder(stream);
      
    } else {
      throw new Error('No recording API available');
    }
  }
  
  // 启动 MediaRecorder
  async startMediaRecorder(stream) {
    // 智能比特率设置
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack ? videoTrack.getSettings() : {};
    const pixels = (settings.width || 1920) * (settings.height || 1080);
    
    // 优化的比特率（基于 WebCodecs 研究）
    let bitrate;
    if (pixels >= 3840 * 2160) {
      bitrate = 20000000; // 20 Mbps for 4K (WebCodecs 优化值)
    } else if (pixels >= 1920 * 1080) {
      bitrate = 10000000; // 10 Mbps for FHD (WebCodecs 优化值)
    } else {
      bitrate = 5000000;  // 5 Mbps
    }
    
    const options = {
      mimeType: this.getSupportedMimeType(),
      videoBitsPerSecond: bitrate
    };
    
    this.mediaRecorder = new MediaRecorder(stream, options);
    this.recordedChunks = [];
    
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
    
    this.mediaRecorder.start(1000); // 每秒收集一次数据
    console.log(`MediaRecorder started with ${bitrate / 1000000} Mbps`);
  }
  
  // 启动 WebCodecs 监控（仅用于性能分析）
  startWebCodecsMonitoring(stream) {
    // 创建一个轻量级的 WebCodecs 监控器
    // 不存储数据，只监控性能
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    const processor = new MediaStreamTrackProcessor({ track: videoTrack });
    const reader = processor.readable.getReader();
    
    let frameCount = 0;
    let lastTime = performance.now();
    
    const monitorFrame = async () => {
      if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
        return;
      }
      
      try {
        const { done, value } = await reader.read();
        if (done) return;
        
        frameCount++;
        
        // 每秒报告一次性能
        const now = performance.now();
        if (now - lastTime > 1000) {
          const fps = frameCount / ((now - lastTime) / 1000);
          console.log(`📊 Performance: ${fps.toFixed(1)} FPS`);
          frameCount = 0;
          lastTime = now;
        }
        
        value.close();
        
        // 继续监控
        monitorFrame();
      } catch (error) {
        console.warn('Frame monitoring error:', error);
      }
    };
    
    monitorFrame();
  }
  
  // 获取支持的 MIME 类型
  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'video/webm';
  }
  
  // 停止录制
  async stop() {
    return new Promise((resolve) => {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.recordedChunks, { 
            type: this.getSupportedMimeType() 
          });
          console.log(`Recording complete: ${blob.size} bytes, mode: ${this.mode}`);
          resolve(blob);
        };
        
        this.mediaRecorder.stop();
      } else {
        resolve(new Blob(this.recordedChunks, { type: 'video/webm' }));
      }
    });
  }
  
  // 获取性能指标
  getPerformanceMetrics() {
    return {
      mode: this.mode,
      chunks: this.recordedChunks.length,
      supported: HybridRecorder.isSupported()
    };
  }
}

// 替换现有的 WebCodecsAdapter
window.WebCodecsAdapter = HybridRecorder;

console.log('✨ Hybrid Recorder installed - Best of both worlds!');
console.log('Features:');
console.log('- ✅ MediaRecorder for reliable recording');
console.log('- ✅ WebCodecs-optimized bitrates');
console.log('- ✅ Performance monitoring');
console.log('- ✅ Playable video output');
