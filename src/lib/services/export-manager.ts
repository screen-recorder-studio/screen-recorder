// 导出管理器 - 统一处理 WebM、MP4 和 GIF 导出
import type { ExportOptions, ExportProgress, EncodedChunk } from '$lib/types/background'
import { handleGifEncodeRequest, type GifFrameData } from './gif-encoder'

export class ExportManager {
  private currentExportWorker: Worker | null = null
  private progressCallback: ((progress: ExportProgress) => void) | null = null
  private gifEncodeHandler: ((event: MessageEvent) => void) | null = null

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
      console.log(`🎬 [ExportManager] Starting ${options.format.toUpperCase()} export`)
      console.log('📊 [ExportManager] Export options:', options)
      console.log('📦 [ExportManager] Input chunks:', encodedChunks.length)


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
      console.error(`❌ [ExportManager] ${options.format.toUpperCase()} export failed:`, error)
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
      console.log('✂️ [ExportManager] Applying trim filter:', {
        startMs: options.trim.startMs,
        endMs: options.trim.endMs,
        originalChunks: standardChunks.length
      })

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

      console.log('✂️ [ExportManager] Trim applied:', {
        trimmedChunks: standardChunks.length,
        firstTimestamp: standardChunks[0]?.timestamp,
        lastTimestamp: standardChunks[standardChunks.length - 1]?.timestamp
      })
    }

    // 默认导出参数
    const defaultOptions = {
      resolution: { width: 1920, height: 1080 },
      bitrate: 8000000, // 8 Mbps
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

    console.log('🎬 [ExportManager] Starting WebM export process')

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
            console.log('✅ [ExportManager] WebM export completed')
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

    console.log('🎬 [ExportManager] Starting MP4 export process with Mediabunny')

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
            console.log('✅ [ExportManager] MP4 export completed')
            resolve(data.blob)
            break

          case 'error':
            console.error('❌ [ExportManager] MP4 export error:', data.error)
            reject(new Error(data.error))
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
    }
  }

  /**
   * 取消导出
   */
  cancelExport(): void {
    if (this.currentExportWorker) {
      this.currentExportWorker.postMessage({ type: 'cancel' })
      this.cleanup()
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
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

      // GIF 编码器实例
      let gifEncoder: any = null

      // 设置 GIF 编码请求处理器（流式处理）
      this.gifEncodeHandler = async (event: MessageEvent) => {
        const { type, data } = event.data

        try {
          if (type === 'gif-init') {
            // 初始化 GIF 编码器
            console.log('🎨 [ExportManager] Initializing GIF encoder...')

            const { GifEncoder } = await import('./gif-encoder')
            gifEncoder = new GifEncoder(data.options)
            await gifEncoder.initialize()

            // 通知 worker 编码器已准备好
            this.currentExportWorker?.postMessage({
              type: 'gif-encoder-ready',
              data: {}
            })

          } else if (type === 'gif-add-frame') {
            // 添加单帧
            if (!gifEncoder) {
              throw new Error('GIF encoder not initialized')
            }

            gifEncoder.addFrame(data.imageData, data.delay, data.dispose)

            // 通知 worker 帧已添加
            this.currentExportWorker?.postMessage({
              type: 'gif-frame-added',
              data: { frameIndex: data.frameIndex }
            })

          } else if (type === 'gif-render') {
            // 渲染 GIF
            if (!gifEncoder) {
              throw new Error('GIF encoder not initialized')
            }

            console.log('🎬 [ExportManager] Rendering GIF...')
            const blob = await gifEncoder.render((progress: number) => {
              // 发送渲染进度回 worker
              this.currentExportWorker?.postMessage({
                type: 'gif-encode-progress',
                data: { progress }
              })
            })

            // 清理编码器
            gifEncoder.cleanup()
            gifEncoder = null

            // 发送编码完成消息回 worker
            this.currentExportWorker?.postMessage({
              type: 'gif-encode-complete',
              data: { blob }
            })
          }

        } catch (error) {
          console.error('❌ [ExportManager] GIF encoding error:', error)

          // 清理编码器
          if (gifEncoder) {
            gifEncoder.cleanup()
            gifEncoder = null
          }

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
            console.log('✅ [ExportManager] GIF export completed')
            resolve(data.blob)
            break

          case 'error':
            console.error('❌ [ExportManager] GIF export failed:', data.error)
            reject(new Error(data.error))
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
