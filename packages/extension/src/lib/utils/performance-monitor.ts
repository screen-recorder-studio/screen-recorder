// 性能监控器 - 基于 demo/popup/performance-monitor.js
import type { RecordingProgress } from '../types/recording'

export interface PerformanceMetrics {
  mode: string
  fps: number
  cpuUsage: number
  memoryUsage: number
  droppedFrames: number
  encodedFrames: number
  bitrate: number
  codec: string
  duration: number
  fileSize: number
}

export class PerformanceMonitor {
  private monitoring: boolean = false
  private metrics: PerformanceMetrics = {
    mode: 'none',
    fps: 0,
    cpuUsage: 0,
    memoryUsage: 0,
    droppedFrames: 0,
    encodedFrames: 0,
    bitrate: 0,
    codec: 'none',
    duration: 0,
    fileSize: 0
  }
  private monitorInterval: number | null = null
  private startTime: number | null = null
  private lastUpdateTime: number = 0
  private frameCount: number = 0
  private lastFrameCount: number = 0
  private callbacks: Set<(metrics: PerformanceMetrics) => void> = new Set()

  // 开始监控
  start(mode: string = 'recording'): void {
    if (this.monitoring) {
      console.warn('Performance monitoring already started')
      return
    }

    this.monitoring = true
    this.startTime = performance.now()
    this.lastUpdateTime = this.startTime
    this.metrics.mode = mode
    
    console.log('🎯 Performance monitoring started')
    
    // 启动监控循环
    this.startMonitoringLoop()
  }

  // 停止监控
  stop(): PerformanceMetrics {
    if (!this.monitoring) {
      return this.metrics
    }

    this.monitoring = false
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
    }

    console.log('🏁 Performance monitoring stopped')
    console.log('Final metrics:', this.metrics)
    
    return this.metrics
  }

  // 更新录制进度
  updateProgress(progress: RecordingProgress): void {
    if (!this.monitoring) return

    this.metrics.encodedFrames = progress.encodedFrames
    this.metrics.fileSize = progress.fileSize
    this.metrics.fps = progress.fps
    this.metrics.bitrate = progress.bitrate
    this.metrics.cpuUsage = progress.cpuUsage

    // 计算持续时间
    if (this.startTime) {
      this.metrics.duration = (performance.now() - this.startTime) / 1000
    }

    this.notifyCallbacks()
  }

  // 更新帧计数
  updateFrameCount(count: number): void {
    this.frameCount = count
  }

  // 设置编解码器
  setCodec(codec: string): void {
    this.metrics.codec = codec
  }

  // 获取当前指标
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics }
  }

  // 添加监控回调
  onUpdate(callback: (metrics: PerformanceMetrics) => void): void {
    this.callbacks.add(callback)
  }

  // 移除监控回调
  offUpdate(callback: (metrics: PerformanceMetrics) => void): void {
    this.callbacks.delete(callback)
  }

  // 启动监控循环
  private startMonitoringLoop(): void {
    // 使用 requestIdleCallback 在浏览器空闲时进行监控
    const monitorStep = () => {
      if (!this.monitoring) return

      this.updateMetrics()
      
      // 每秒通知一次回调
      const now = performance.now()
      if (now - this.lastUpdateTime >= 1000) {
        this.notifyCallbacks()
        this.lastUpdateTime = now
      }

      // 调度下次监控
      requestIdleCallback(monitorStep)
    }

    requestIdleCallback(monitorStep)
  }

  // 更新性能指标
  private updateMetrics(): void {
    if (!this.startTime) return

    const now = performance.now()
    const elapsed = (now - this.startTime) / 1000

    // 更新持续时间
    this.metrics.duration = elapsed

    // 计算 FPS（基于帧计数变化）
    if (elapsed > 0) {
      const framesDelta = this.frameCount - this.lastFrameCount
      if (framesDelta > 0) {
        this.metrics.fps = Math.round(framesDelta / (1000 / 1000)) // 每秒帧数
        this.lastFrameCount = this.frameCount
      }
    }

    // 监控内存使用（如果可用）
    this.updateMemoryUsage()

    // 监控 CPU 使用率
    this.updateCPUUsage()
  }

  // 更新内存使用情况
  private updateMemoryUsage(): void {
    if ('memory' in performance) {
      const memory = (performance as any).memory
      if (memory) {
        // 转换为 MB
        this.metrics.memoryUsage = Math.round(memory.usedJSHeapSize / 1024 / 1024)
      }
    }
  }

  // 更新 CPU 使用率（简化估算）
  private updateCPUUsage(): void {
    const start = performance.now()
    
    // 使用 MessageChannel 测量主线程响应时间
    const channel = new MessageChannel()
    channel.port2.onmessage = () => {
      const elapsed = performance.now() - start
      // 简单的 CPU 使用率估算（响应时间越长，CPU 使用率越高）
      this.metrics.cpuUsage = Math.min(100, Math.max(0, elapsed * 5))
    }
    
    channel.port1.postMessage(null)
  }

  // 通知所有回调
  private notifyCallbacks(): void {
    this.callbacks.forEach(callback => {
      try {
        callback(this.getMetrics())
      } catch (error) {
        console.error('Performance monitor callback error:', error)
      }
    })
  }

  // 重置指标
  reset(): void {
    this.metrics = {
      mode: 'none',
      fps: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      droppedFrames: 0,
      encodedFrames: 0,
      bitrate: 0,
      codec: 'none',
      duration: 0,
      fileSize: 0
    }
    this.frameCount = 0
    this.lastFrameCount = 0
    this.startTime = null
  }

  // 获取性能摘要
  getSummary(): string {
    const m = this.metrics
    return `Mode: ${m.mode} | FPS: ${m.fps} | CPU: ${m.cpuUsage}% | Memory: ${m.memoryUsage}MB | Bitrate: ${(m.bitrate / 1000000).toFixed(1)}Mbps | Duration: ${m.duration.toFixed(1)}s`
  }

  // 检查性能是否良好
  isPerformanceGood(): boolean {
    return (
      this.metrics.fps >= 25 &&
      this.metrics.cpuUsage < 80 &&
      this.metrics.droppedFrames < 10
    )
  }

  // 获取性能建议
  getPerformanceAdvice(): string[] {
    const advice: string[] = []

    if (this.metrics.fps < 25) {
      advice.push('帧率较低，建议降低录制质量或分辨率')
    }

    if (this.metrics.cpuUsage > 80) {
      advice.push('CPU 使用率过高，建议关闭其他应用程序')
    }

    if (this.metrics.memoryUsage > 1000) {
      advice.push('内存使用较高，建议重启浏览器')
    }

    if (this.metrics.droppedFrames > 10) {
      advice.push('丢帧较多，建议检查系统性能')
    }

    if (advice.length === 0) {
      advice.push('性能良好，录制质量正常')
    }

    return advice
  }

  // 导出性能数据
  exportData(): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      metrics: this.metrics,
      summary: this.getSummary(),
      advice: this.getPerformanceAdvice()
    }, null, 2)
  }
}
