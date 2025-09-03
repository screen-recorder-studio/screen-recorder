// WebCodecs Transcoder - WebM to MP4 转码器
// 使用 WebCodecs API 实现完整的视频转码流程

class WebCodecsTranscoder {
  constructor() {
    this.decoder = null;
    this.encoder = null;
    this.muxer = null;
    this.frames = [];
    this.encodedChunks = [];
    this.videoTrack = null;
    this.audioTrack = null;
  }

  // 检查 WebCodecs API 是否可用
  static isSupported() {
    return typeof VideoDecoder !== 'undefined' && 
           typeof VideoEncoder !== 'undefined' &&
           typeof VideoFrame !== 'undefined';
  }

  // 主转码方法
  async transcode(webmBlob, options = {}) {
    if (!WebCodecsTranscoder.isSupported()) {
      throw new Error('WebCodecs API not supported in this browser');
    }

    console.log('Starting WebM to MP4 transcoding...');
    
    try {
      // 1. 解析 WebM 文件
      const demuxedData = await this.demuxWebM(webmBlob);
      
      // 2. 初始化解码器
      await this.initDecoder(demuxedData.videoConfig);
      
      // 3. 初始化编码器（H.264）
      await this.initEncoder(options);
      
      // 4. 解码所有帧
      const decodedFrames = await this.decodeFrames(demuxedData.chunks);
      
      // 5. 编码为 H.264
      const encodedData = await this.encodeFrames(decodedFrames);
      
      // 6. 封装为 MP4
      const mp4Blob = await this.muxToMP4(encodedData, demuxedData.audioTrack);
      
      return mp4Blob;
      
    } catch (error) {
      console.error('Transcoding failed:', error);
      throw error;
    } finally {
      this.cleanup();
    }
  }

  // 解析 WebM 文件
  async demuxWebM(blob) {
    console.log('Demuxing WebM file...');
    
    // 创建视频元素来获取元数据
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    
    return new Promise((resolve, reject) => {
      video.onloadedmetadata = async () => {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const duration = video.duration;
        const fps = 30; // 默认帧率，实际应从文件解析
        
        console.log(`Video metadata: ${width}x${height}, ${duration}s, ${fps}fps`);
        
        // 获取视频轨道
        const stream = video.captureStream();
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        
        // 使用 MediaStreamTrackProcessor 获取帧
        const chunks = [];
        
        if (videoTrack && typeof MediaStreamTrackProcessor !== 'undefined') {
          const processor = new MediaStreamTrackProcessor({ track: videoTrack });
          const reader = processor.readable.getReader();
          
          // 读取所有视频帧
          try {
            let frameCount = 0;
            const maxFrames = Math.floor(duration * fps);
            
            while (frameCount < maxFrames) {
              const { value: frame, done } = await reader.read();
              if (done) break;
              
              chunks.push({
                type: 'key',
                timestamp: frameCount * (1000000 / fps), // 微秒
                data: frame
              });
              
              frameCount++;
              
              // 释放帧以避免内存泄漏
              frame.close();
            }
          } catch (error) {
            console.error('Error reading frames:', error);
          } finally {
            reader.releaseLock();
          }
        }
        
        URL.revokeObjectURL(url);
        
        resolve({
          videoConfig: {
            codec: 'vp09.00.10.08', // VP9 codec string
            codedWidth: width,
            codedHeight: height,
            displayWidth: width,
            displayHeight: height,
            framerate: fps
          },
          chunks,
          audioTrack,
          duration,
          width,
          height,
          fps
        });
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load video'));
      };
      
      video.src = url;
      video.load();
    });
  }

  // 初始化解码器
  async initDecoder(config) {
    console.log('Initializing decoder with config:', config);
    
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.frames.push(frame);
      },
      error: (error) => {
        console.error('Decoder error:', error);
      }
    });
    
    // 配置解码器
    this.decoder.configure({
      codec: config.codec,
      codedWidth: config.codedWidth,
      codedHeight: config.codedHeight,
      hardwareAcceleration: 'prefer-hardware'
    });
    
    console.log('Decoder initialized');
  }

  // 初始化编码器
  async initEncoder(options = {}) {
    const {
      width = 1920,
      height = 1080,
      framerate = 30,
      bitrate = 5000000, // 5 Mbps
      codec = 'avc1.42001E' // H.264 Baseline Profile
    } = options;
    
    console.log('Initializing encoder with options:', { width, height, framerate, bitrate, codec });
    
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        this.encodedChunks.push({ chunk, metadata });
      },
      error: (error) => {
        console.error('Encoder error:', error);
      }
    });
    
    // 配置编码器
    const encoderConfig = {
      codec: codec,
      width: width,
      height: height,
      bitrate: bitrate,
      framerate: framerate,
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'avc' } // 使用 AVC 格式而不是 Annex B
    };
    
    // 检查配置是否支持
    const support = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!support.supported) {
      throw new Error('Encoder configuration not supported');
    }
    
    this.encoder.configure(encoderConfig);
    console.log('Encoder initialized');
  }

  // 解码帧
  async decodeFrames(chunks) {
    console.log(`Decoding ${chunks.length} chunks...`);
    
    for (const chunk of chunks) {
      if (chunk.data instanceof VideoFrame) {
        // 如果已经是 VideoFrame，直接使用
        this.frames.push(chunk.data);
      } else {
        // 创建 EncodedVideoChunk 并解码
        const encodedChunk = new EncodedVideoChunk({
          type: chunk.type,
          timestamp: chunk.timestamp,
          data: chunk.data
        });
        
        this.decoder.decode(encodedChunk);
      }
    }
    
    // 等待解码完成
    await this.decoder.flush();
    
    console.log(`Decoded ${this.frames.length} frames`);
    return this.frames;
  }

  // 编码帧
  async encodeFrames(frames) {
    console.log(`Encoding ${frames.length} frames to H.264...`);
    
    let frameIndex = 0;
    for (const frame of frames) {
      // 每30帧插入一个关键帧
      const keyFrame = frameIndex % 30 === 0;
      
      this.encoder.encode(frame, { keyFrame });
      
      // 释放原始帧
      frame.close();
      
      frameIndex++;
      
      // 进度回调
      if (frameIndex % 10 === 0) {
        const progress = (frameIndex / frames.length) * 100;
        console.log(`Encoding progress: ${progress.toFixed(1)}%`);
      }
    }
    
    // 等待编码完成
    await this.encoder.flush();
    
    console.log(`Encoded ${this.encodedChunks.length} chunks`);
    return this.encodedChunks;
  }

  // 封装为 MP4
  async muxToMP4(encodedData, audioTrack) {
    console.log('Muxing to MP4 container...');
    
    // 动态加载 mp4box.js
    if (typeof MP4Box === 'undefined') {
      await this.loadMP4Box();
    }
    
    const mp4File = MP4Box.createFile();
    const chunks = [];
    
    // 添加视频轨道
    const videoTrackId = mp4File.addTrack({
      timescale: 1000000, // 微秒
      width: 1920,
      height: 1080,
      nb_samples: encodedData.length,
      hdlr: 'vide',
      name: 'VideoHandler',
      type: 'avc1',
      description: this.createAVCDescription(encodedData[0].metadata)
    });
    
    // 添加视频样本
    for (let i = 0; i < encodedData.length; i++) {
      const { chunk, metadata } = encodedData[i];
      
      // 将 chunk 转换为 ArrayBuffer
      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buffer);
      
      mp4File.addSample(videoTrackId, buffer, {
        duration: chunk.duration || 33333, // 默认30fps
        dts: chunk.timestamp,
        cts: chunk.timestamp,
        is_sync: chunk.type === 'key'
      });
    }
    
    // TODO: 添加音频轨道处理
    if (audioTrack) {
      console.log('Audio track detected, but not yet implemented');
    }
    
    // 获取 MP4 数据
    const mp4ArrayBuffer = mp4File.getBuffer();
    
    return new Blob([mp4ArrayBuffer], { type: 'video/mp4' });
  }

  // 创建 AVC 配置描述
  createAVCDescription(metadata) {
    // 这里需要根据实际的 SPS/PPS 创建描述
    // 简化示例
    return {
      avcC: metadata?.decoderConfig || null
    };
  }

  // 动态加载 MP4Box
  async loadMP4Box() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '../libs/mp4box.all.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // 清理资源
  cleanup() {
    if (this.decoder) {
      this.decoder.close();
      this.decoder = null;
    }
    
    if (this.encoder) {
      this.encoder.close();
      this.encoder = null;
    }
    
    // 释放所有未关闭的帧
    for (const frame of this.frames) {
      if (frame.close) {
        frame.close();
      }
    }
    
    this.frames = [];
    this.encodedChunks = [];
  }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebCodecsTranscoder;
} else if (typeof window !== 'undefined') {
  window.WebCodecsTranscoder = WebCodecsTranscoder;
}
