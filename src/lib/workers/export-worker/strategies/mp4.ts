// MP4 encoding strategy (extracted from original mp4-export-worker.ts)
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, StreamTarget } from 'mediabunny'

export interface EncoderStrategy {
  preflight(videoInfo?: { width: number; height: number; frameRate: number }, options?: any): Promise<void>
  createOutput(useOpfsStream: boolean, options: any): Promise<{ output: any; targetType: 'stream' | 'buffer' }>
  createVideoSource(canvas: OffscreenCanvas, opts: { bitrate?: number }): any
  start(output: any): Promise<void>
  finalize(output: any): Promise<void>
  closeVideoSource?(source: any): void
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

function validateAndFixH264Dimensions(width: number, height: number): { width: number; height: number; modified: boolean } {
  const originalWidth = width
  const originalHeight = height
  if (width % 2 !== 0) width += 1
  if (height % 2 !== 0) height += 1
  const W16 = Math.ceil(width / 16) * 16
  const H16 = Math.ceil(height / 16) * 16
  let modified = false
  if (W16 !== width) { width = W16; modified = true }
  if (H16 !== height) { height = H16; modified = true }
  if (modified) {
  }
  return { width, height, modified }
}

async function checkH264SupportWithDims(width: number, height: number): Promise<{ supported: boolean; reason?: string }> {
  try {
    const dims = validateAndFixH264Dimensions(width, height)
    const codecs = [
      'avc1.64001f', // High@3.1
      'avc1.4d401f', // Main@3.1
      'avc1.42E01E', // Baseline@3.0
      'avc1.4d401e', // Main@3.0
      'avc1.64001e'  // High@3.0
    ]
    for (const codec of codecs) {
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
  private opfsFileHandle: FileSystemFileHandle | null = null
  private opfsWritable: any | null = null

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
    } catch (finalizeError: any) {
      console.error('❌ [MP4-Export-Worker] Failed to finalize Mediabunny output:', finalizeError)
      throw new Error(`Mediabunny 输出完成失败: ${finalizeError?.message || finalizeError}`)
    } finally {
      try { if (this.opfsWritable) { await this.opfsWritable.close() } } catch {}
    }
  }

  closeVideoSource(source: any) {
    try { if (source && typeof source.close === 'function') source.close() } catch {}
    try { if (source && typeof source.destroy === 'function') source.destroy() } catch {}
  }

  async getOpfsResultInfo(_options: any): Promise<{ bytes: number; fileName: string }> {
    let bytes = 0
    let fileName = 'export.mp4'
    try {
      const file = await (this.opfsFileHandle as any)?.getFile()
      if (file) {
        bytes = file.size
        fileName = (file as any).name || fileName
      }
    } catch {}
    return { bytes, fileName }
  }
}

