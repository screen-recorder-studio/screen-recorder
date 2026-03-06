// 混合录制 Worker - 基于 demo/popup/hybrid-recorder.js
import type { MediaRecorderWorkerMessage } from '../types/worker'
import type { RecordingProgress, RecordingOptions } from '../types/recording'

class HybridRecordingWorker {
  private mediaRecorder: MediaRecorder | null = null
  private webCodecsAdapter: any = null
  private recordedChunks: Blob[] = []
  private stream: MediaStream | null = null
  private mode: 'hybrid' | 'mediarecorder' | 'webcodecs' = 'mediarecorder'
  private startTime: number = 0
  private frameCount: number = 0
  private lastProgressTime: number = 0

  // 检查支持情况
  private static isSupported() {
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined'
    const hasWebCodecs = typeof VideoEncoder !== 'undefined' && 
                        typeof MediaStreamTrackProcessor !== 'undefined'
    
    return {
      mediaRecorder: hasMediaRecorder,
      webCodecs: hasWebCodecs,
      hybrid: hasMediaRecorder && hasWebCodecs
    }
  }

  // 开始录制
  async start(stream: MediaStream, options: RecordingOptions): Promise<void> {
    this.stream = stream
    this.startTime = performance.now()
    const support = HybridRecordingWorker.isSupported()
    
    if (support.hybrid && options.preferredEngine === 'webcodecs') {
      // 混合模式：主录制用 MediaRecorder（生成可播放视频）
      // 辅助分析用 WebCodecs（性能监控和优化）
      console.log('🎯 Using Hybrid mode: MediaRecorder + WebCodecs monitoring')
      this.mode = 'hybrid'
      
      // 启动 MediaRecorder 进行主录制
      await this.startMediaRecorder(stream, options)
      
      // 同时启动 WebCodecs 进行性能监控（不影响主录制）
      try {
        this.startWebCodecsMonitoring(stream, options)
      } catch (error) {
        console.warn('WebCodecs monitoring failed, continuing with MediaRecorder only:', error)
      }
      
    } else if (support.mediaRecorder) {
      // 仅 MediaRecorder 模式
      console.log('📹 Using MediaRecorder only mode')
      this.mode = 'mediarecorder'
      await this.startMediaRecorder(stream, options)
      
    } else {
      throw new Error('No supported recording method available')
    }

    // 开始进度监控
    this.startProgressMonitoring()
  }

  // 启动 MediaRecorder
  private async startMediaRecorder(stream: MediaStream, options: RecordingOptions): Promise<void> {
    const mimeType = this.getSupportedMimeType()
    const videoBitrate = this.getVideoBitrate(options.videoQuality)
    
    const mediaRecorderOptions: MediaRecorderOptions = {
      mimeType,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: options.includeAudio ? 192000 : undefined
    }

    this.mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions)
    this.recordedChunks = []

    // 设置事件监听器
    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.recordedChunks.push(event.data)
      }
    }

    this.mediaRecorder.onerror = (event: Event) => {
      this.sendMessage('error', { error: 'MediaRecorder error: ' + event })
    }

    this.mediaRecorder.start(1000) // 每秒收集一次数据
  }

  // 启动 WebCodecs 监控（不影响主录制）
  private startWebCodecsMonitoring(stream: MediaStream, options: RecordingOptions): void {
    try {
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) return

      // 创建 MediaStreamTrackProcessor 用于监控
      const trackProcessor = new MediaStreamTrackProcessor({ track: videoTrack })
      const reader = trackProcessor.readable.getReader()

      // 监控帧处理（不进行实际编码）
      const monitorFrames = async () => {
        try {
          const { done, value } = await reader.read()
          if (done) return

          this.frameCount++
          
          // 释放帧资源
          if (value && typeof (value as any).close === 'function') {
            (value as any).close()
          }

          // 继续监控
          setTimeout(monitorFrames, 0)
        } catch (error) {
          console.warn('Frame monitoring error:', error)
        }
      }

      monitorFrames()
    } catch (error) {
      console.warn('WebCodecs monitoring setup failed:', error)
    }
  }

  // 获取支持的 MIME 类型
  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4'
    ]
    
    return types.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm'
  }

  // 获取视频比特率
  private getVideoBitrate(quality: 'high' | 'medium' | 'low'): number {
    const bitrateMap = {
      high: 15000000,   // 15 Mbps
      medium: 8000000,  // 8 Mbps
      low: 4000000      // 4 Mbps
    }
    return bitrateMap[quality]
  }

  // 开始进度监控
  private startProgressMonitoring(): void {
    const updateProgress = () => {
      const now = performance.now()
      if (now - this.lastProgressTime > 1000) { // 每秒更新一次
        this.reportProgress()
        this.lastProgressTime = now
      }

      if (this.mediaRecorder?.state === 'recording') {
        setTimeout(updateProgress, 100)
      }
    }
    updateProgress()
  }

  // 报告进度
  private reportProgress(): void {
    const elapsed = (performance.now() - this.startTime) / 1000
    const fps = this.frameCount / elapsed
    const fileSize = this.recordedChunks.reduce((sum, chunk) => sum + chunk.size, 0)
    const bitrate = fileSize > 0 ? (fileSize * 8) / elapsed : 0

    const progress: RecordingProgress = {
      encodedChunks: this.recordedChunks.length,
      processedFrames: this.frameCount,
      encodedFrames: this.frameCount,
      fileSize,
      fps: Math.round(fps),
      bitrate: Math.round(bitrate),
      cpuUsage: 0 // Worker 中无法直接测量主线程 CPU
    }

    this.sendMessage('progress', { progress })
  }

  // 停止录制
  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
        reject(new Error('Recording not active'))
        return
      }

      this.mediaRecorder.onstop = () => {
        try {
          const mimeType = this.mediaRecorder?.mimeType || 'video/webm'
          const blob = new Blob(this.recordedChunks, { type: mimeType })
          this.cleanup()
          resolve(blob)
        } catch (error) {
          reject(error)
        }
      }

      this.mediaRecorder.stop()
    })
  }

  // 获取性能指标
  getPerformanceMetrics() {
    return {
      mode: this.mode,
      chunks: this.recordedChunks.length,
      frameCount: this.frameCount,
      supported: HybridRecordingWorker.isSupported()
    }
  }

  // 清理资源
  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    
    this.mediaRecorder = null
    this.webCodecsAdapter = null
    this.recordedChunks = []
    this.frameCount = 0
  }

  // 发送消息到主线程
  private sendMessage(type: string, payload: any): void {
    const message: MediaRecorderWorkerMessage = {
      id: crypto.randomUUID(),
      type: type as any,
      payload
    }
    self.postMessage(message)
  }
}

// Worker 实例
const worker = new HybridRecordingWorker()

// 消息处理
self.onmessage = async (event) => {
  const { id, type, payload } = event.data as MediaRecorderWorkerMessage
  
  try {
    let result: any

    switch (type) {
      case 'start':
        await worker.start(payload.stream!, payload.options!)
        result = { success: true }
        break
        
      case 'stop':
        result = { result: await worker.stop() }
        break
        
      default:
        throw new Error(`Unknown message type: ${type}`)
    }

    // 发送响应
    self.postMessage({
      id,
      type: 'response',
      payload: result
    })
    
  } catch (error) {
    // 发送错误响应
    self.postMessage({
      id,
      type: 'error',
      payload: { error: (error as Error).message }
    })
  }
}

console.log('✨ Hybrid Recording Worker loaded - Best of both worlds!')
