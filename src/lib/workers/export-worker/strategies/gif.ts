// GIF 导出策略 - 使用 gif.js 库
// 注意: gif.js 需要在主线程中运行，因此这个策略主要负责协调和数据准备

export interface GifExportOptions {
  width: number
  height: number
  quality?: number // 1-30, 越小质量越好
  fps?: number // 帧率
  workers?: number // Worker 线程数
  repeat?: number // 重复次数 (-1=不重复, 0=永远)
  dither?: boolean | string // 抖动算法
  background?: string // 背景色
  transparent?: string | null // 透明色
  debug?: boolean
}

export interface GifFrameData {
  imageData: ImageData
  delay: number
  dispose?: number
}

/**
 * GIF 导出策略
 * 
 * 由于 gif.js 库需要在主线程运行（依赖 DOM API），
 * 这个策略主要负责：
 * 1. 准备帧数据（ImageData）
 * 2. 通过 postMessage 与主线程通信
 * 3. 协调 GIF 编码过程
 */
export class GifStrategy {
  private options: GifExportOptions
  private frames: GifFrameData[] = []
  
  constructor(options: GifExportOptions) {
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
    
    console.log('🎨 [GifStrategy] Initialized with options:', this.options)
  }
  
  /**
   * 从 Canvas 提取 ImageData
   */
  extractImageData(canvas: OffscreenCanvas): ImageData {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas')
    }
    
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  }
  
  /**
   * 添加帧
   */
  addFrame(canvas: OffscreenCanvas, delay: number, dispose?: number) {
    const imageData = this.extractImageData(canvas)
    
    this.frames.push({
      imageData,
      delay,
      dispose
    })
    
    // console.log(\`🖼️ [GifStrategy] Frame added: \${this.frames.length}, delay: \${delay}ms\`)
  }
  
  /**
   * 获取帧数
   */
  getFrameCount(): number {
    return this.frames.length
  }
  
  /**
   * 获取所有帧数据
   */
  getFrames(): GifFrameData[] {
    return this.frames
  }
  
  /**
   * 获取导出选项
   */
  getOptions(): GifExportOptions {
    return this.options
  }
  
  /**
   * 清理资源
   */
  cleanup() {
    this.frames = []
    console.log('🧹 [GifStrategy] Cleanup completed')
  }
  
  /**
   * 估算 GIF 文件大小（粗略估算）
   */
  estimateSize(): number {
    const { width, height } = this.options
    const frameCount = this.frames.length
    
    // 粗略估算：每帧约占 width * height * 0.5 字节（考虑压缩）
    const estimatedSize = width * height * frameCount * 0.5
    
    return Math.round(estimatedSize)
  }
}
