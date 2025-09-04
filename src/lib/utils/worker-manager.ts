// Worker 管理器 - 主线程协调器
import type { 
  MediaRecorderWorkerMessage,
  WebCodecsWorkerMessage,
  FileProcessorWorkerMessage 
} from '../types/worker'
import type { RecordingOptions } from '../types/recording'

export class WorkerManager {
  private recordingWorker: Worker | null = null
  private messageHandlers = new Map<string, (message: any) => void>()
  private pendingMessages = new Map<string, { resolve: Function; reject: Function }>()

  constructor() {
    this.initializeWorkers()
  }

  // 初始化 Workers
  private initializeWorkers(): void {
    // 延迟加载 Workers，避免启动时阻塞
    requestIdleCallback(() => {
      try {
        // 创建录制 Worker
        this.recordingWorker = new Worker(
          new URL('../workers/hybrid-recording-worker.ts', import.meta.url),
          { type: 'module' }
        )

        // 设置消息处理
        this.setupWorkerMessageHandling()
        
        console.log('✅ Workers initialized successfully')
      } catch (error) {
        console.error('❌ Failed to initialize workers:', error)
      }
    })
  }

  // 设置 Worker 消息处理
  private setupWorkerMessageHandling(): void {
    if (this.recordingWorker) {
      this.recordingWorker.onmessage = (event) => {
        this.handleWorkerMessage('recording', event.data)
      }

      this.recordingWorker.onerror = (error) => {
        console.error('Recording worker error:', error)
      }
    }
  }

  // 处理 Worker 消息
  private handleWorkerMessage(workerType: string, message: any): void {
    const { id, type, payload } = message

    // 处理 Promise 响应
    if (this.pendingMessages.has(id)) {
      const { resolve, reject } = this.pendingMessages.get(id)!
      this.pendingMessages.delete(id)

      if (type === 'error') {
        reject(new Error(payload.error))
      } else {
        resolve(payload)
      }
      return
    }

    // 处理事件监听器
    const handlerKey = `${workerType}-${type}`
    const handler = this.messageHandlers.get(handlerKey)
    if (handler) {
      // 使用 setTimeout 确保处理器不阻塞主线程
      setTimeout(() => handler(message), 0)
    }
  }

  // 发送消息到录制 Worker
  async sendToRecordingWorker(message: MediaRecorderWorkerMessage): Promise<any> {
    if (!this.recordingWorker) {
      throw new Error('Recording worker not initialized')
    }

    return this.sendWorkerMessage(this.recordingWorker, message)
  }

  // 发送消息到 Worker 的通用方法
  private sendWorkerMessage(worker: Worker, message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // 存储 Promise 处理器
      this.pendingMessages.set(message.id, { resolve, reject })

      // 发送消息到 Worker（非阻塞）
      worker.postMessage(message)

      // 设置超时
      setTimeout(() => {
        if (this.pendingMessages.has(message.id)) {
          this.pendingMessages.delete(message.id)
          reject(new Error('Worker message timeout'))
        }
      }, 30000) // 30秒超时
    })
  }

  // 监听录制 Worker 消息
  onRecordingMessage(handler: (message: MediaRecorderWorkerMessage) => void): void {
    this.messageHandlers.set('recording-progress', handler)
    this.messageHandlers.set('recording-error', handler)
    this.messageHandlers.set('recording-complete', handler)
  }

  // 开始录制
  async startRecording(stream: MediaStream, options: RecordingOptions): Promise<void> {
    const message: MediaRecorderWorkerMessage = {
      id: crypto.randomUUID(),
      type: 'start',
      payload: {
        stream,
        options
      }
    }

    const result = await this.sendToRecordingWorker(message)
    if (!result.success) {
      throw new Error('Failed to start recording')
    }
  }

  // 停止录制
  async stopRecording(): Promise<Blob> {
    const message: MediaRecorderWorkerMessage = {
      id: crypto.randomUUID(),
      type: 'stop',
      payload: {}
    }

    const result = await this.sendToRecordingWorker(message)
    return result.result
  }

  // 检查 Worker 是否就绪
  isReady(): boolean {
    return this.recordingWorker !== null
  }

  // 等待 Worker 就绪
  async waitForReady(timeout: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isReady()) {
        resolve()
        return
      }

      const checkReady = () => {
        if (this.isReady()) {
          resolve()
        } else {
          setTimeout(checkReady, 100)
        }
      }

      setTimeout(() => {
        reject(new Error('Worker initialization timeout'))
      }, timeout)

      checkReady()
    })
  }

  // 清理所有 Workers
  cleanup(): void {
    // 清理所有 Workers（非阻塞）
    setTimeout(() => {
      if (this.recordingWorker) {
        this.recordingWorker.terminate()
        this.recordingWorker = null
      }

      // 清理待处理的消息
      this.pendingMessages.clear()
      this.messageHandlers.clear()
      
      console.log('🧹 Workers cleaned up')
    }, 0)
  }

  // 获取 Worker 状态
  getStatus() {
    return {
      recordingWorker: this.recordingWorker !== null,
      pendingMessages: this.pendingMessages.size,
      handlers: this.messageHandlers.size
    }
  }
}
