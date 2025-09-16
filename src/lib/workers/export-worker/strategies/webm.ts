// WebM encoding strategy with optional OPFS streaming support
import { Output, WebMOutputFormat, BufferTarget, CanvasSource, StreamTarget } from 'mediabunny'
import type { EncoderStrategy } from './mp4'

export class WebmStrategy implements EncoderStrategy {
  private opfsFileHandle: FileSystemFileHandle | null = null
  private opfsWritable: any | null = null

  async preflight(_videoInfo?: { width: number; height: number; frameRate: number }, _options?: any) {
    // Keep behavior unchanged: WebM path does not require preflight checks currently.
    return
  }

  async createOutput(useOpfsStream: boolean, options: any): Promise<{ output: any; targetType: 'stream' | 'buffer' }> {
    if (useOpfsStream) {
      if (!(self as any).navigator?.storage?.getDirectory) {
        throw new Error('OPFS not available in worker; cannot stream to OPFS')
      }
      const dirId = (options as any).opfsDirId as string
      const fileName = (options as any).opfsFileName || `export-${Date.now()}.webm`
      console.log('📁 [WebM-Export-Worker] OPFS stream target:', { dirId, fileName })
      const root = await (self as any).navigator.storage.getDirectory()
      const dir = await (root as any).getDirectoryHandle(dirId, { create: false })
      this.opfsFileHandle = await (dir as any).getFileHandle(fileName, { create: true })
      this.opfsWritable = await (this.opfsFileHandle as any).createWritable()

      const output = new Output({
        format: new WebMOutputFormat(),
        target: new StreamTarget(this.opfsWritable, { chunked: true })
      })
      return { output, targetType: 'stream' }
    } else {
      const output = new Output({
        format: new WebMOutputFormat(),
        target: new BufferTarget()
      })
      return { output, targetType: 'buffer' }
    }
  }

  createVideoSource(canvas: OffscreenCanvas, opts: { bitrate?: number }) {
    // Keep codec and default bitrate consistent with current WebM worker
    return new CanvasSource(canvas, {
      codec: 'vp9',
      bitrate: opts?.bitrate || 8_000_000
    })
  }

  async start(output: any) {
    await output.start()
  }

  async finalize(output: any) {
    await output.finalize()
    try { if (this.opfsWritable) { await this.opfsWritable.close() } } catch {}
  }

  closeVideoSource(source: any) {
    try { if (source && typeof source.close === 'function') source.close() } catch {}
    try { if (source && typeof source.destroy === 'function') source.destroy() } catch {}
  }

  async getOpfsResultInfo(_options: any): Promise<{ bytes: number; fileName: string }> {
    let bytes = 0
    let fileName = 'export.webm'
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

