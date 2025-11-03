// GIF 编码器服务 - 在主线程中运行
// 用于处理来自 export-worker 的 GIF 编码请求

export interface GifEncodeOptions {
  width: number
  height: number
  quality?: number
  fps?: number
  workers?: number
  repeat?: number
  dither?: boolean | string
  background?: string
  transparent?: string | null
  debug?: boolean
}

export interface GifFrameData {
  imageData: ImageData
  delay: number
  dispose?: number
}

/**
 * GIF 编码器（主线程）
 * 使用 gif.js 库进行实际的 GIF 编码
 */
export class GifEncoder {
  private gif: any = null
  private options: GifEncodeOptions

  constructor(options: GifEncodeOptions) {
    this.options = {
      quality: 10,
      fps: 10,
      workers: 2,
      repeat: 0,
      dither: false,
      background: '#000000',
      transparent: null,
      debug: false,
      ...options
    }
  }

  /**
   * 初始化 GIF 编码器
   */
  async initialize(): Promise<void> {
    // 检查 gif.js 是否已加载
    if (typeof (window as any).GIF === 'undefined') {
      throw new Error('gif.js library not loaded. Please include gif.js in your HTML.')
    }

    const GIF = (window as any).GIF

    // 获取 worker 脚本路径
    const workerScript = this.getWorkerScriptPath()

    // 创建 GIF 实例
    this.gif = new GIF({
      workers: this.options.workers,
      quality: this.options.quality,
      width: this.options.width,
      height: this.options.height,
      workerScript,
      repeat: this.options.repeat,
      background: this.options.background,
      transparent: this.options.transparent,
      dither: this.options.dither,
      debug: this.options.debug
    })

    console.log('✅ [GifEncoder] Initialized with gif.js', {
      workerScript,
      options: this.options
    })
  }

  /**
   * 获取 worker 脚本路径
   */
  private getWorkerScriptPath(): string {
    // 检查是否在 Chrome 扩展环境中
    if (typeof chrome !== 'undefined' && (chrome as any)?.runtime?.getURL) {
      try {
        return (chrome as any).runtime.getURL('gif/gif.worker.js')
      } catch (e) {
        console.warn('⚠️ [GifEncoder] Failed to get Chrome extension URL, using default path')
      }
    }

    // 默认路径
    return '/gif/gif.worker.js'
  }

  /**
   * 添加帧
   */
  addFrame(imageData: ImageData, delay: number, dispose?: number): void {
    if (!this.gif) {
      throw new Error('GIF encoder not initialized')
    }

    // 创建临时 canvas 来承载 ImageData
    const canvas = document.createElement('canvas')
    canvas.width = imageData.width
    canvas.height = imageData.height
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Failed to get 2D context')
    }

    ctx.putImageData(imageData, 0, 0)

    // 添加到 GIF
    this.gif.addFrame(canvas, {
      delay,
      dispose: dispose ?? -1,
      copy: true
    })

    console.log(`🖼️ [GifEncoder] Frame added, delay: ${delay}ms`)
  }

  /**
   * 渲染 GIF
   */
  async render(onProgress?: (progress: number) => void): Promise<Blob> {
    if (!this.gif) {
      throw new Error('GIF encoder not initialized')
    }

    return new Promise((resolve, reject) => {
      // 监听进度
      if (onProgress) {
        this.gif.on('progress', (p: number) => {
          console.log(`🎨 [GifEncoder] Rendering progress: ${(p * 100).toFixed(1)}%`)
          onProgress(p)
        })
      }

      // 监听完成
      this.gif.on('finished', (blob: Blob) => {
        console.log('✅ [GifEncoder] Rendering completed, size:', blob.size, 'bytes')
        resolve(blob)
      })

      // 监听错误
      this.gif.on('error', (error: Error) => {
        console.error('❌ [GifEncoder] Rendering failed:', error)
        reject(error)
      })

      // 开始渲染
      console.log('🎬 [GifEncoder] Starting render...')
      this.gif.render()
    })
  }

  /**
   * 中止渲染
   */
  abort(): void {
    if (this.gif) {
      this.gif.abort()
      console.log('🛑 [GifEncoder] Rendering aborted')
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.gif) {
      try {
        this.gif.abort()
      } catch (e) {
        // Ignore errors during cleanup
      }
      this.gif = null
    }
  }
}

/**
 * 处理来自 Worker 的 GIF 编码请求
 */
export async function handleGifEncodeRequest(
  frames: GifFrameData[],
  options: GifEncodeOptions,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  console.log('🎨 [GifEncoder] Handling encode request:', {
    frameCount: frames.length,
    options
  })

  // 创建编码器
  const encoder = new GifEncoder(options)

  try {
    // 初始化
    await encoder.initialize()

    // 添加所有帧
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]
      encoder.addFrame(frame.imageData, frame.delay, frame.dispose)

      // 报告添加帧的进度 (0-50%)
      if (onProgress) {
        const progress = (i + 1) / frames.length * 0.5
        onProgress(progress)
      }
    }

    // 渲染 GIF (50-100%)
    const blob = await encoder.render((p) => {
      if (onProgress) {
        const progress = 0.5 + p * 0.5
        onProgress(progress)
      }
    })

    return blob

  } finally {
    // 清理
    encoder.cleanup()
  }
}

