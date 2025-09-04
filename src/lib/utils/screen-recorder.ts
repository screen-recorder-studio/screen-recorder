// 屏幕录制控制器 - 基于 demo/popup/videoRecorder.js
import { WorkerManager } from './worker-manager'
import { ChromeAPIWrapper } from './chrome-api'
import type { 
  RecordingOptions, 
  RecordingStatus, 
  RecordingProgress, 
  WebCodecsCapabilities,
  RecordingError 
} from '../types/recording'
import type { MediaRecorderWorkerMessage } from '../types/worker'

export class ScreenRecorder {
  private workerManager: WorkerManager
  private stream: MediaStream | null = null
  private startTime: number | null = null
  private status: RecordingStatus = 'idle'
  private progress: RecordingProgress = {
    encodedChunks: 0,
    processedFrames: 0,
    encodedFrames: 0,
    fileSize: 0,
    fps: 0,
    bitrate: 0,
    cpuUsage: 0
  }
  private progressCallback?: (progress: RecordingProgress, duration: number) => void
  private statusCallback?: (status: RecordingStatus, error?: string) => void

  constructor(private options: RecordingOptions) {
    this.workerManager = new WorkerManager()
    this.setupWorkerListeners()
  }

  // 设置 Worker 监听器
  private setupWorkerListeners(): void {
    this.workerManager.onRecordingMessage((message: MediaRecorderWorkerMessage) => {
      this.handleWorkerMessage(message)
    })
  }

  // 处理 Worker 消息
  private handleWorkerMessage(message: MediaRecorderWorkerMessage): void {
    switch (message.type) {
      case 'progress':
        if (message.payload.progress) {
          this.progress = { ...this.progress, ...message.payload.progress }
          this.notifyProgressUpdate()
        }
        break
        
      case 'error':
        this.status = 'error'
        console.error('Worker error:', message.payload.error)
        this.statusCallback?.(this.status, message.payload.error)
        break
        
      case 'complete':
        this.status = 'completed'
        this.statusCallback?.(this.status)
        break
    }
  }

  // 请求屏幕捕获权限
  async requestScreenCapture(): Promise<string> {
    try {
      const sources: chrome.desktopCapture.DesktopCaptureSourceType[] = 
        this.options.includeAudio ? ['screen', 'window', 'tab', 'audio'] : ['screen', 'window', 'tab']
      
      return await ChromeAPIWrapper.requestDesktopCapture(sources)
    } catch (error) {
      throw new Error('PERMISSION_DENIED')
    }
  }

  // 开始录制
  async startRecording(): Promise<void> {
    try {
      this.status = 'requesting'
      this.statusCallback?.(this.status)
      
      // 等待 Worker 就绪
      await this.workerManager.waitForReady()
      
      // 请求屏幕捕获权限（非阻塞）
      const streamId = await this.requestScreenCapture()
      
      if (!streamId) {
        throw new Error('DESKTOP_CAPTURE_CANCELLED')
      }
      
      // 获取媒体流（非阻塞）
      this.stream = await ChromeAPIWrapper.getUserMediaFromStreamId(streamId)
      
      if (!this.stream) {
        throw new Error('STREAM_INVALID')
      }

      // 检测能力并选择引擎（非阻塞）
      const capabilities = await this.detectCapabilities()
      console.log('📊 Detected capabilities:', capabilities)

      // 更新选项基于检测结果
      const finalOptions = this.optimizeOptions(capabilities)
      
      // 启动 Worker 进行录制（CPU 密集型任务转移到 Worker）
      await this.workerManager.startRecording(this.stream, finalOptions)
      
      this.status = 'recording'
      this.startTime = Date.now()
      this.statusCallback?.(this.status)
      
      // 启动进度监控（非阻塞）
      this.startProgressMonitoring()
      
      console.log('🎬 Recording started successfully')
      
    } catch (error) {
      this.status = 'error'
      this.statusCallback?.(this.status, (error as Error).message)
      throw error
    }
  }

  // 停止录制
  async stopRecording(): Promise<Blob> {
    if (this.status !== 'recording') {
      throw new Error('RECORDING_FAILED')
    }

    this.status = 'stopping'
    this.statusCallback?.(this.status)
    
    try {
      // 停止 Worker 录制（非阻塞）
      const result = await this.workerManager.stopRecording()
      
      this.cleanup()
      this.status = 'completed'
      this.statusCallback?.(this.status)
      
      console.log('✅ Recording completed successfully')
      return result
      
    } catch (error) {
      this.status = 'error'
      this.statusCallback?.(this.status, (error as Error).message)
      throw error
    }
  }

  // 检测 WebCodecs 能力
  private async detectCapabilities(): Promise<WebCodecsCapabilities> {
    return new Promise((resolve) => {
      const capabilities: WebCodecsCapabilities = {
        supported: false,
        vp9: false,
        vp8: false,
        av1: false,
        h264: false,
        hardwareAcceleration: false,
        workerSupport: false
      }

      // 使用 setTimeout 避免阻塞 UI
      setTimeout(async () => {
        try {
          // 检查 WebCodecs 基础支持
          if (typeof VideoEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') {
            resolve(capabilities)
            return
          }

          capabilities.supported = true
          capabilities.workerSupport = typeof Worker !== 'undefined'

          // 异步检查编码器支持
          const configs = [
            { codec: 'vp09.00.10.08', key: 'vp9' },
            { codec: 'vp8', key: 'vp8' },
            { codec: 'av01.0.01M.08', key: 'av1' },
            { codec: 'avc1.42001e', key: 'h264' }
          ]

          const results = await Promise.all(
            configs.map(async ({ codec, key }) => {
              try {
                const config = { 
                  codec, 
                  width: 1920, 
                  height: 1080, 
                  bitrate: 1000000, 
                  framerate: 30 
                }
                const support = await VideoEncoder.isConfigSupported(config)
                return { key, supported: support.supported }
              } catch {
                return { key, supported: false }
              }
            })
          )

          results.forEach(({ key, supported }) => {
            (capabilities as any)[key] = supported
          })

          capabilities.hardwareAcceleration = !!navigator.gpu

          resolve(capabilities)
          
        } catch (error) {
          console.warn('Error detecting WebCodecs capabilities:', error)
          resolve(capabilities)
        }
      }, 0)
    })
  }

  // 基于能力优化选项
  private optimizeOptions(capabilities: WebCodecsCapabilities): RecordingOptions {
    const optimized = { ...this.options }

    // 如果 WebCodecs 不支持，强制使用 MediaRecorder
    if (!capabilities.supported || !capabilities.workerSupport) {
      optimized.preferredEngine = 'mediarecorder'
    }

    // 选择最佳编解码器
    if (capabilities.vp9) {
      optimized.codec = 'vp9'
    } else if (capabilities.vp8) {
      optimized.codec = 'vp8'
    } else if (capabilities.h264) {
      optimized.codec = 'h264'
    }

    console.log('🔧 Optimized options:', optimized)
    return optimized
  }

  // 开始进度监控
  private startProgressMonitoring(): void {
    // 使用 requestIdleCallback 在浏览器空闲时更新进度
    const updateProgress = () => {
      if (this.status === 'recording') {
        // CPU 使用率监控（轻量级）
        this.monitorCPUUsage()
        
        // 调度下次更新（非阻塞）
        requestIdleCallback(updateProgress)
      }
    }
    
    requestIdleCallback(updateProgress)
  }

  // 轻量级 CPU 监控
  private monitorCPUUsage(): void {
    const start = performance.now()
    
    // 使用 MessageChannel 测量主线程响应时间
    const channel = new MessageChannel()
    channel.port2.onmessage = () => {
      const elapsed = performance.now() - start
      // 简单的 CPU 使用率估算
      this.progress.cpuUsage = Math.min(100, elapsed * 10)
    }
    
    channel.port1.postMessage(null)
  }

  // 通知进度更新
  private notifyProgressUpdate(): void {
    if (this.progressCallback) {
      this.progressCallback(this.progress, this.getDuration())
    }
  }

  // 获取录制时长
  getDuration(): number {
    if (!this.startTime) return 0
    return Math.floor((Date.now() - this.startTime) / 1000)
  }

  // 获取当前状态
  getStatus(): RecordingStatus {
    return this.status
  }

  // 获取进度信息
  getProgress(): RecordingProgress {
    return this.progress
  }

  // 设置进度回调
  onProgress(callback: (progress: RecordingProgress, duration: number) => void): void {
    this.progressCallback = callback
  }

  // 设置状态回调
  onStatusChange(callback: (status: RecordingStatus, error?: string) => void): void {
    this.statusCallback = callback
  }

  // 清理资源
  cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    
    this.startTime = null
    this.status = 'idle'
    this.progress = {
      encodedChunks: 0,
      processedFrames: 0,
      encodedFrames: 0,
      fileSize: 0,
      fps: 0,
      bitrate: 0,
      cpuUsage: 0
    }
  }

  // 销毁录制器
  destroy(): void {
    this.cleanup()
    this.workerManager.cleanup()
  }
}
