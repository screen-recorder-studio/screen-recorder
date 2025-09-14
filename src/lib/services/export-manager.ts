// 导出管理器 - 统一处理 WebM 和 MP4 导出
import type { ExportOptions, ExportProgress, EncodedChunk } from '$lib/types/background'

export class ExportManager {
  private currentExportWorker: Worker | null = null
  private progressCallback: ((progress: ExportProgress) => void) | null = null

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
    const standardChunks: EncodedChunk[] = encodedChunks.map(chunk => ({
      data: chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data),
      timestamp: chunk.timestamp || 0,
      type: chunk.type === 'key' ? 'key' : 'delta',
      size: chunk.size || chunk.data.byteLength,
      codedWidth: chunk.codedWidth || 1920,
      codedHeight: chunk.codedHeight || 1080,
      codec: chunk.codec || 'vp8'
    }))

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
  ): Promise<Blob> {

    console.log('🎬 [ExportManager] Starting WebM export process')

    return new Promise((resolve, reject) => {
      // 创建 WebM 导出 Worker
      this.currentExportWorker = new Worker(
        new URL('../workers/webm-export-worker.ts', import.meta.url),
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
            resolve(data.blob)
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
        new URL('../workers/mp4-export-worker.ts', import.meta.url),
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
      this.currentExportWorker.terminate()
      this.currentExportWorker = null
    }
    this.progressCallback = null
  }
}
