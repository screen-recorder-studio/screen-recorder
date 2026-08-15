// 导出管理器 - 统一处理 WebM、MP4 和 GIF 导出
import type { ExportOptions, ExportProgress, EncodedChunk } from '$lib/types/background'
import { handleGifEncodeRequest, type GifFrameData } from './gif-encoder'

export class ExportCancelledError extends Error {
  readonly code = 'EXPORT_CANCELLED'

  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelledError'
  }
}

export class ExportManager {
  private currentExportWorker: Worker | null = null
  private progressCallback: ((progress: ExportProgress) => void) | null = null
  private gifEncodeHandler: ((event: MessageEvent) => void) | null = null
  private activeGifEncoder: any | null = null
  private cancelRequested = false

  /**
   * 导出编辑后的视频
   * @param encodedChunks 原始编码块
   * @param options 导出选项
   * @param progressCallback 进度回调
   */
  async exportEditedVideo(
    encodedChunks: any[],
    options: ExportOptions,
    progressCallback?: (progress: ExportProgress) => void
  ): Promise<Blob> {

    this.progressCallback = progressCallback || null

    try {


      // 验证输入数据（保持现状：仅当使用内存块导出时必须提供）
      if (!encodedChunks || encodedChunks.length === 0) {
        throw new Error('No encoded chunks provided')
      }

      // 准备导出数据
      const exportData = this.prepareExportData(encodedChunks, options)

      // 根据格式选择导出方式
      if (options.format === 'webm') {
        return await this.exportWebM(exportData, options)
      } else if (options.format === 'mp4') {
        return await this.exportMP4(exportData, options)
      } else if (options.format === 'gif') {
        return await this.exportGIF(exportData, options)
      } else {
        throw new Error(`Unsupported format: ${options.format}`)
      }

    } catch (error) {
      if (!(error instanceof ExportCancelledError)) {
        console.error(`❌ [ExportManager] ${options.format.toUpperCase()} export failed:`, error)
      }
      throw error
    } finally {
      this.cleanup()
    }
  }


  /**
   * 准备导出数据
   */
  private prepareExportData(encodedChunks: any[], options: ExportOptions) {
    // 转换为标准格式
    let standardChunks: EncodedChunk[] = encodedChunks.map(chunk => ({
      data: chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data),
      timestamp: chunk.timestamp || 0,
      type: chunk.type === 'key' ? 'key' : 'delta',
      size: chunk.size || chunk.data.byteLength,
      codedWidth: chunk.codedWidth || 1920,
      codedHeight: chunk.codedHeight || 1080,
      codec: chunk.codec || 'vp8'
    }))

    // 🔧 裁剪处理：根据时间戳过滤帧
    if (options.trim && options.trim.enabled) {

      const firstTimestamp = standardChunks[0]?.timestamp || 0
      const trimStartTimestamp = firstTimestamp + (options.trim.startMs * 1000) // 转换为微秒
      const trimEndTimestamp = firstTimestamp + (options.trim.endMs * 1000)

      // 过滤并调整时间戳
      standardChunks = standardChunks
        .filter(chunk => {
          return chunk.timestamp >= trimStartTimestamp && chunk.timestamp <= trimEndTimestamp
        })
        .map((chunk, index) => ({
          ...chunk,
          // 重新计算时间戳，使其从 0 开始
          timestamp: chunk.timestamp - trimStartTimestamp
        }))

    }

    // 根据质量级别映射比特率（当用户未显式指定 bitrate 时使用）
    const qualityBitrateMap: Record<string, number> = {
      high: 8000000,    // 8 Mbps
      medium: 5000000,  // 5 Mbps
      low: 2500000      // 2.5 Mbps
    }
    const derivedBitrate = options.bitrate || qualityBitrateMap[options.quality] || 8000000

    // 默认导出参数
    const defaultOptions = {
      resolution: { width: 1920, height: 1080 },
      bitrate: derivedBitrate,
      framerate: 30
    }

    return {
      chunks: standardChunks,
      options: { ...defaultOptions, ...options }
    }
  }

  /**
   * 导出 WebM 格式
   */
  private async exportWebM(
    exportData: { chunks: EncodedChunk[], options: ExportOptions },
    options: ExportOptions
  ): Promise<any> {


    return new Promise((resolve, reject) => {
      // 创建 WebM 导出 Worker（统一入口）
      this.currentExportWorker = new Worker(
        new URL('../workers/export-worker/index.ts', import.meta.url),
        { type: 'module' }
      )

      // 设置消息处理
      this.currentExportWorker.onmessage = (event) => {
        const { type, data } = event.data

        switch (type) {
          case 'progress':
            this.updateProgress({
              type: 'webm',
              stage: data.stage,
              progress: data.progress,
              currentFrame: data.currentFrame,
              totalFrames: data.totalFrames,
              estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
              fileSize: data.fileSize
            })
            break

          case 'complete':
            if (data && data.savedToOpfs) {
              resolve({ savedToOpfs: data.savedToOpfs })
            } else {
              resolve(data.blob)
            }
            break

          case 'error':
            console.error('❌ [ExportManager] WebM export error:', data.error)
            reject(new Error(data.error))
            break

          case 'cancelled':
            this.cleanupGifEncoder()
            reject(new ExportCancelledError())
            break

          default:
            console.warn('⚠️ [ExportManager] Unknown WebM worker message:', type)
        }
      }

      this.currentExportWorker.onerror = (error) => {
        console.error('❌ [ExportManager] WebM worker error:', error)
        reject(new Error('WebM export worker failed'))
      }

      // 开始导出
      this.currentExportWorker.postMessage({
        type: 'export',
        data: exportData
      })
    })
  }

  /**
   * 导出 MP4 格式
   */
  private async exportMP4(
    exportData: { chunks: EncodedChunk[], options: ExportOptions },
    options: ExportOptions
  ): Promise<Blob> {


    return new Promise((resolve, reject) => {
      // 创建 MP4 导出 Worker
      this.currentExportWorker = new Worker(
        new URL('../workers/export-worker/index.ts', import.meta.url),
        { type: 'module' }
      )

      // 设置消息处理
      this.currentExportWorker.onmessage = (event) => {
        const { type, data } = event.data

        switch (type) {
          case 'progress':
            this.updateProgress({
              type: 'mp4',
              stage: data.stage,
              progress: data.progress,
              currentFrame: data.currentFrame,
              totalFrames: data.totalFrames,
              estimatedTimeRemaining: data.estimatedTimeRemaining || 0,
              fileSize: data.fileSize
            })
            break

          case 'complete':
            if (data && data.savedToOpfs) {
              resolve({ savedToOpfs: data.savedToOpfs } as any)
            } else {
              resolve(data.blob)
            }
            break

          case 'error':
            console.error('❌ [ExportManager] MP4 export error:', data.error)
            reject(new Error(data.error))
            break

          case 'cancelled':
            this.cleanupGifEncoder()
            reject(new ExportCancelledError())
            break

          default:
            console.warn('⚠️ [ExportManager] Unknown MP4 worker message:', type)
        }
      }

      this.currentExportWorker.onerror = (error) => {
        console.error('❌ [ExportManager] MP4 worker error:', error)
        reject(new Error('MP4 export worker failed'))
      }

      // 开始导出
      this.currentExportWorker.postMessage({
        type: 'export',
        data: exportData
      })
    })
  }

  /**
   * 更新进度
   */
  private updateProgress(progress: ExportProgress) {
    if (this.progressCallback) {
      this.progressCallback(progress)
    } else {
      console.warn('⚠️ [ExportManager] No progress callback set!')
    }
  }

  /**
   * 取消导出
   */
  cancelExport(): boolean {
    if (!this.currentExportWorker || this.cancelRequested) return false
    this.cancelRequested = true
    this.cleanupGifEncoder()
    this.currentExportWorker.postMessage({ type: 'cancel' })
    return true
  }

  private cleanupGifEncoder(): void {
    const encoder = this.activeGifEncoder
    this.activeGifEncoder = null
    try { encoder?.cleanup?.() } catch {}
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.cleanupGifEncoder()
    if (this.currentExportWorker) {
      // 移除 GIF 编码处理器
      if (this.gifEncodeHandler) {
        this.currentExportWorker.removeEventListener('message', this.gifEncodeHandler)
        this.gifEncodeHandler = null
      }

      this.currentExportWorker.terminate()
      this.currentExportWorker = null
    }
    this.progressCallback = null
    this.cancelRequested = false
  }

  /**
   * 导出 GIF（流式处理）
   */
  private async exportGIF(exportData: any, options: ExportOptions): Promise<Blob> {
    return new Promise((resolve, reject) => {
      // 创建 Worker
      this.currentExportWorker = new Worker(
        new URL('../workers/export-worker/index.ts', import.meta.url),
        { type: 'module' }
      )

      // 设置 GIF 编码请求处理器（流式处理）
      this.gifEncodeHandler = async (event: MessageEvent) => {
        const { type, data } = event.data
        if (this.cancelRequested) return

        try {
          if (type === 'gif-init') {
            const { GifEncoder } = await import('./gif-encoder')
            if (this.cancelRequested) return

            const encoder = new GifEncoder(data.options)
            this.activeGifEncoder = encoder
            await encoder.initialize()
            if (this.cancelRequested || this.activeGifEncoder !== encoder) {
              encoder.cleanup()
              if (this.activeGifEncoder === encoder) this.activeGifEncoder = null
              return
            }

            // 通知 worker 编码器已准备好
            this.currentExportWorker?.postMessage({
              type: 'gif-encoder-ready',
              data: {}
            })

          } else if (type === 'gif-add-frame') {
            // 添加单帧
            if (!this.activeGifEncoder) {
              throw new Error('GIF encoder not initialized')
            }

            this.activeGifEncoder.addFrame(data.imageData, data.delay, data.dispose)

            // 更新进度：帧添加阶段占40%-60%
            const frameProgress = 40 + ((data.frameIndex + 1) / data.totalFrames) * 20
            this.updateProgress({
              type: 'gif',
              stage: 'muxing',
              progress: frameProgress,
              currentFrame: data.frameIndex + 1,
              totalFrames: data.totalFrames,
              estimatedTimeRemaining: 0
            })

            // 通知 worker 帧已添加
            this.currentExportWorker?.postMessage({
              type: 'gif-frame-added',
              data: { frameIndex: data.frameIndex }
            })

          } else if (type === 'gif-render') {
            // 渲染 GIF
            const encoder = this.activeGifEncoder
            if (!encoder) {
              throw new Error('GIF encoder not initialized')
            }

            const totalFrames = data.totalFrames || 0
            const blob = await encoder.render((progress: number) => {
              if (this.cancelRequested || this.activeGifEncoder !== encoder) return
              // 计算实际的总进度：GIF渲染阶段占60%-100%
              const totalProgress = 60 + progress * 40

              this.updateProgress({
                type: 'gif',
                stage: 'finalizing',
                progress: totalProgress,
                currentFrame: totalFrames,
                totalFrames: totalFrames,
                estimatedTimeRemaining: 0
              })
            })

            if (this.cancelRequested || this.activeGifEncoder !== encoder) {
              encoder.cleanup()
              return
            }
            this.cleanupGifEncoder()

            // 发送编码完成消息回 worker
            this.currentExportWorker?.postMessage({
              type: 'gif-encode-complete',
              data: { blob }
            })
          }

        } catch (error) {
          console.error('❌ [ExportManager] GIF encoding error:', error)
          this.cleanupGifEncoder()
          if (this.cancelRequested) return

          // 发送错误消息回 worker
          this.currentExportWorker?.postMessage({
            type: 'gif-encode-error',
            data: { error: (error as Error).message }
          })
        }
      }

      // 监听 Worker 消息
      this.currentExportWorker.addEventListener('message', (event) => {
        const { type, data } = event.data

        switch (type) {
          case 'progress':
            this.updateProgress(data as ExportProgress)
            break

          case 'complete':
            resolve(data.blob)
            break

          case 'error':
            console.error('❌ [ExportManager] GIF export failed:', data.error)
            reject(new Error(data.error))
            break

          case 'cancelled':
            this.cleanupGifEncoder()
            reject(new ExportCancelledError())
            break

          case 'gif-init':
          case 'gif-add-frame':
          case 'gif-render':
            // 处理 GIF 编码请求（流式处理）
            if (this.gifEncodeHandler) {
              this.gifEncodeHandler(event)
            }
            break
        }
      })

      // 监听 Worker 错误
      this.currentExportWorker.addEventListener('error', (error) => {
        console.error('❌ [ExportManager] Worker error:', error)
        reject(error)
      })

      // 发送导出请求到 Worker
      this.currentExportWorker.postMessage({
        type: 'export',
        data: exportData
      })
    })
  }
}
