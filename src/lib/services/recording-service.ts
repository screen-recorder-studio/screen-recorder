// 录制服务 - 整合所有录制相关功能
import { ScreenRecorder } from '../utils/screen-recorder'
import { PerformanceMonitor } from '../utils/performance-monitor'
import { ChromeAPIWrapper } from '../utils/chrome-api'
import { recordingStore } from '../stores/recording.svelte'
import type { RecordingOptions } from '../types/recording'

export class RecordingService {
  private recorder: ScreenRecorder | null = null
  private performanceMonitor: PerformanceMonitor
  private updateInterval: number | null = null

  constructor() {
    this.performanceMonitor = new PerformanceMonitor()
    this.setupPerformanceMonitoring()
  }

  // 设置性能监控
  private setupPerformanceMonitoring(): void {
    this.performanceMonitor.onUpdate((metrics) => {
      // 更新录制状态中的性能数据
      recordingStore.updateProgress({
        ...recordingStore.state.progress,
        fps: metrics.fps,
        cpuUsage: metrics.cpuUsage,
        fileSize: metrics.fileSize
      })
    })
  }

  // 检查录制环境
  async checkEnvironment(): Promise<{
    isReady: boolean
    issues: string[]
    capabilities: any
  }> {
    const issues: string[] = []

    // 检查 Chrome 扩展环境
    if (!ChromeAPIWrapper.isExtensionEnvironment()) {
      issues.push('不在 Chrome 扩展环境中')
    }

    // 检查权限
    try {
      const permissions = await ChromeAPIWrapper.checkPermissions()
      if (!permissions.desktopCapture) {
        issues.push('缺少屏幕捕获权限')
      }
      if (!permissions.downloads) {
        issues.push('缺少下载权限')
      }
    } catch (error) {
      issues.push('权限检查失败')
    }

    // 检查 MediaRecorder 支持
    if (typeof MediaRecorder === 'undefined') {
      issues.push('浏览器不支持 MediaRecorder')
    }

    // 检查 WebCodecs 支持（可选）
    const webCodecsSupported = typeof VideoEncoder !== 'undefined' && 
                              typeof MediaStreamTrackProcessor !== 'undefined'

    return {
      isReady: issues.length === 0,
      issues,
      capabilities: {
        mediaRecorder: typeof MediaRecorder !== 'undefined',
        webCodecs: webCodecsSupported,
        workers: typeof Worker !== 'undefined'
      }
    }
  }

  // 开始录制
  async startRecording(options?: Partial<RecordingOptions>): Promise<void> {
    try {
      // 检查当前状态
      if (recordingStore.isRecording) {
        throw new Error('录制已在进行中')
      }

      // 更新选项
      if (options) {
        recordingStore.updateOptions(options)
      }

      // 更新状态
      recordingStore.updateStatus('requesting')

      // 创建录制器
      this.recorder = new ScreenRecorder(recordingStore.options)

      // 设置录制器回调
      this.setupRecorderCallbacks()

      // 开始录制
      await this.recorder.startRecording()

      // 启动性能监控
      this.performanceMonitor.start('recording')

      // 启动状态更新循环
      this.startUpdateLoop()


    } catch (error) {
      console.error('❌ Failed to start recording:', error)
      recordingStore.updateStatus('error', (error as Error).message)
      throw error
    }
  }

  // 停止录制
  async stopRecording(): Promise<Blob> {
    try {
      if (!this.recorder || !recordingStore.isRecording) {
        throw new Error('没有活动的录制')
      }

      // 更新状态
      recordingStore.updateStatus('stopping')

      // 停止录制
      const videoBlob = await this.recorder.stopRecording()

      // 停止性能监控
      const finalMetrics = this.performanceMonitor.stop()

      // 更新状态
      recordingStore.setVideoBlob(videoBlob)
      recordingStore.updateStatus('completed')

      return videoBlob

    } catch (error) {
      console.error('❌ Failed to stop recording:', error)
      recordingStore.updateStatus('error', (error as Error).message)
      throw error
    } finally {
      // 确保更新循环始终被停止，避免定时器泄漏
      this.stopUpdateLoop()
    }
  }

  // 保存录制的视频
  async saveRecording(filename?: string): Promise<void> {
    try {
      const videoBlob = recordingStore.state.videoBlob
      if (!videoBlob) {
        throw new Error('没有可保存的视频')
      }

      // 生成文件名
      const finalFilename = filename || ChromeAPIWrapper.generateFilename()

      // 保存文件
      await ChromeAPIWrapper.saveVideoSmart(videoBlob, finalFilename)


    } catch (error) {
      console.error('❌ Failed to save recording:', error)
      throw error
    }
  }

  // 设置录制器回调
  private setupRecorderCallbacks(): void {
    if (!this.recorder) return

    // 状态变化回调
    this.recorder.onStatusChange((status, error) => {
      recordingStore.updateStatus(status, error)
    })

    // 进度更新回调
    this.recorder.onProgress((progress, duration) => {
      recordingStore.updateProgress(progress)
      recordingStore.updateDuration(duration)
      
      // 更新性能监控
      this.performanceMonitor.updateProgress(progress)
    })
  }

  // 启动状态更新循环
  private startUpdateLoop(): void {
    this.updateInterval = window.setInterval(() => {
      if (this.recorder && recordingStore.isRecording) {
        const duration = this.recorder.getDuration()
        recordingStore.updateDuration(duration)
      }
    }, 1000)
  }

  // 停止状态更新循环
  private stopUpdateLoop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
  }

  // 获取当前状态
  getState() {
    return recordingStore.getSnapshot()
  }

  // 获取性能指标
  getPerformanceMetrics() {
    return this.performanceMonitor.getMetrics()
  }

  // 获取性能建议
  getPerformanceAdvice() {
    return this.performanceMonitor.getPerformanceAdvice()
  }

  // 重置服务
  reset(): void {
    // 停止录制（如果正在进行）
    if (this.recorder && recordingStore.isRecording) {
      this.recorder.cleanup()
    }

    // 停止性能监控
    this.performanceMonitor.stop()

    // 停止更新循环
    this.stopUpdateLoop()

    // 重置状态
    recordingStore.reset()

    // 清理录制器
    this.recorder = null

  }

  // 销毁服务
  destroy(): void {
    this.reset()
    
    // 清理性能监控器
    this.performanceMonitor.reset()

  }

  // 导出录制数据
  exportData() {
    return {
      recording: recordingStore.exportData(),
      performance: this.performanceMonitor.exportData(),
      timestamp: new Date().toISOString()
    }
  }
}

// 创建全局录制服务实例
export const recordingService = new RecordingService()
