// MP4 encoding strategy (extracted from original mp4-export-worker.ts)
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, StreamTarget } from 'mediabunny'
import { readOpfsResultInfo } from './opfs-result'
import { H264_PROBE_CODECS, normalizeH264Dimensions } from '../../../utils/h264-export-config'

export interface EncoderStrategy {
  preflight(videoInfo?: { width: number; height: number; frameRate: number }, options?: any): Promise<void>
  createOutput(useOpfsStream: boolean, options: any): Promise<{ output: any; targetType: 'stream' | 'buffer' }>
  createVideoSource(canvas: OffscreenCanvas, opts: { bitrate?: number }): any
  start(output: any): Promise<void>
  finalize(output: any): Promise<void>
  closeVideoSource?(source: any): void
  discardPartialOutput?(): Promise<void>
  getOpfsResultInfo?(options: any): Promise<{ bytes: number; fileName: string }>
}

function checkMediabunnyStatus(): { available: boolean; reason: string } {
  try {
    if (typeof Output === 'undefined') return { available: false, reason: 'Output 类不可用' }
    if (typeof Mp4OutputFormat === 'undefined') return { available: false, reason: 'Mp4OutputFormat 类不可用' }
    if (typeof BufferTarget === 'undefined') return { available: false, reason: 'BufferTarget 类不可用' }
    if (typeof CanvasSource === 'undefined') return { available: false, reason: 'CanvasSource 类不可用' }
    return { available: true, reason: 'OK' }
  } catch (e: any) {
    return { available: false, reason: e?.message || '未知错误' }
  }
}

async function checkH264SupportWithDims(width: number, height: number): Promise<{ supported: boolean; reason?: string }> {
  try {
    const dims = normalizeH264Dimensions(width, height)
    for (const codec of H264_PROBE_CODECS) {
      try {
        const support = await (VideoEncoder as any).isConfigSupported({
          codec,
          width: dims.width,
          height: dims.height,
          bitrate: 2_000_000,
          framerate: 30
        })
        if (support?.supported) {
          return { supported: true, reason: `支持 ${codec} (${dims.width}×${dims.height})` }
        }
      } catch {}
    }
    return { supported: false, reason: `所有 H.264 配置都不支持 (测试尺寸: ${dims.width}×${dims.height})` }
  } catch (error: any) {
    return { supported: false, reason: `检测失败: ${error?.message || error}` }
  }
}

export class Mp4Strategy implements EncoderStrategy {
  private opfsDirectoryHandle: FileSystemDirectoryHandle | null = null
  private opfsFileHandle: FileSystemFileHandle | null = null
  private opfsFileName: string | null = null
  private opfsWritable: any | null = null
  private partialCleanupPromise: Promise<void> | null = null

  async preflight(videoInfo?: { width: number; height: number; frameRate: number }) {
    const mediabunnyStatus = checkMediabunnyStatus()
    if (!mediabunnyStatus.available) {
      throw new Error(`Mediabunny 库不可用: ${mediabunnyStatus.reason}`)
    }

    const w = videoInfo?.width || 1280
    const h = videoInfo?.height || 720
    const h264Support = await checkH264SupportWithDims(w, h)
    if (!h264Support.supported) {
      throw new Error(`H.264 编码器不支持: ${h264Support.reason}。请尝试导出为 WebM 格式。`)
    }
  }

  async createOutput(useOpfsStream: boolean, options: any): Promise<{ output: any; targetType: 'stream' | 'buffer' }> {
    if (useOpfsStream) {
      if (!(self as any).navigator?.storage?.getDirectory) {
        throw new Error('OPFS not available in worker; cannot stream to OPFS')
      }
      const dirId = (options as any).opfsDirId as string
      const fileName = (options as any).opfsFileName || `export-${Date.now()}.mp4`
      const root = await (self as any).navigator.storage.getDirectory()
      const dir = await (root as any).getDirectoryHandle(dirId, { create: false })
      this.opfsDirectoryHandle = dir
      this.opfsFileName = fileName
      this.opfsFileHandle = await (dir as any).getFileHandle(fileName, { create: true })
      this.opfsWritable = await (this.opfsFileHandle as any).createWritable()

      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new StreamTarget(this.opfsWritable, { chunked: true })
      })
      return { output, targetType: 'stream' }
    } else {
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget()
      })
      return { output, targetType: 'buffer' }
    }
  }

  createVideoSource(canvas: OffscreenCanvas, opts: { bitrate?: number }) {
    return new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: opts?.bitrate || 8_000_000
    })
  }

  async start(output: any) {
    try {
      await output.start()
    } catch (startError: any) {
      console.error('❌ [MP4-Export-Worker] Failed to start Mediabunny output:', startError)
      throw new Error(`Mediabunny 输出启动失败: ${startError?.message || startError}`)
    }
  }

  async finalize(output: any) {
    try {
      await output.finalize()
      this.opfsWritable = null
    } catch (finalizeError: any) {
      console.error('❌ [MP4-Export-Worker] Failed to finalize Mediabunny output:', finalizeError)
      throw new Error(`Mediabunny 输出完成失败: ${finalizeError?.message || finalizeError}`)
    }
  }

  discardPartialOutput(): Promise<void> {
    if (this.partialCleanupPromise) return this.partialCleanupPromise

    const cleanup = this.performPartialOutputCleanup()
    this.partialCleanupPromise = cleanup
    void cleanup.then(
      () => {
        if (this.partialCleanupPromise === cleanup) this.partialCleanupPromise = null
      },
      () => {
        if (this.partialCleanupPromise === cleanup) this.partialCleanupPromise = null
      }
    )
    return cleanup
  }

  private async performPartialOutputCleanup(): Promise<void> {
    const writable = this.opfsWritable
    if (writable) {
      this.opfsWritable = null
      try { await writable.abort?.() } catch {}
    }

    const directory = this.opfsDirectoryHandle
    const fileName = this.opfsFileName
    if (directory && fileName) {
      try {
        await directory.removeEntry(fileName)
      } catch (error: any) {
        if (error?.name !== 'NotFoundError') throw error
      }
    }

    this.opfsFileHandle = null
    this.opfsDirectoryHandle = null
    this.opfsFileName = null
  }

  closeVideoSource(source: any) {
    try { if (source && typeof source.close === 'function') source.close() } catch {}
    try { if (source && typeof source.destroy === 'function') source.destroy() } catch {}
  }

  async getOpfsResultInfo(options: any): Promise<{ bytes: number; fileName: string }> {
    const fallbackFileName = options?.opfsFileName || 'export.mp4'
    return readOpfsResultInfo(this.opfsFileHandle as any, fallbackFileName)
  }
}
