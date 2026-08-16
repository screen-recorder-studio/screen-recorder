// WebM encoding strategy with optional OPFS streaming support
import { Output, WebMOutputFormat, BufferTarget, CanvasSource, StreamTarget } from 'mediabunny'
import type { EncoderStrategy } from './mp4'
import { readOpfsResultInfo } from './opfs-result'

export class WebmStrategy implements EncoderStrategy {
  private opfsDirectoryHandle: FileSystemDirectoryHandle | null = null
  private opfsFileHandle: FileSystemFileHandle | null = null
  private opfsFileName: string | null = null
  private opfsWritable: any | null = null
  private partialCleanupPromise: Promise<void> | null = null

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
      const root = await (self as any).navigator.storage.getDirectory()
      const dir = await (root as any).getDirectoryHandle(dirId, { create: false })
      this.opfsDirectoryHandle = dir
      this.opfsFileName = fileName
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
    this.opfsWritable = null
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
    const fallbackFileName = options?.opfsFileName || 'export.webm'
    return readOpfsResultInfo(this.opfsFileHandle as any, fallbackFileName)
  }
}

