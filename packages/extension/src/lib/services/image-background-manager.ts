// 图片背景管理服务 - ImageBitmap方案
// 负责图片上传、压缩、缓存和Worker间传输

import type { ImageBackgroundConfig, ImagePreset, ImagePreviewData } from '../types/background'

// 图片处理配置
interface ImageProcessingOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  maxSizeBytes?: number
}

// 默认处理选项
const DEFAULT_OPTIONS: ImageProcessingOptions = {
  maxWidth: 1920,
  maxHeight: 1080,
  quality: 0.85,
  maxSizeBytes: 5 * 1024 * 1024 // 5MB
}

export class ImageBackgroundManager {
  private bitmapCache = new Map<string, ImageBitmap>()
  private previewCache = new Map<string, string>() // Blob URLs
  private fileCache = new Map<string, File>()      // 原始文件

  /**
   * 处理用户上传的图片文件
   */
  async processImage(
    file: File, 
    options: ImageProcessingOptions = {}
  ): Promise<{
    config: ImageBackgroundConfig,
    previewData: ImagePreviewData
  }> {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    
    // 1. 文件验证
    this.validateImageFile(file, opts)
    
    // 2. 生成唯一ID
    const imageId = this.generateImageId(file)
    
    // 3. 压缩图片（如果需要）
    const processedFile = await this.compressImageIfNeeded(file, opts)
    
    // 4. 创建ImageBitmap (核心数据)
    const imageBitmap = await createImageBitmap(processedFile)
    
    // 5. 创建预览URL
    const previewUrl = URL.createObjectURL(processedFile)
    
    // 6. 缓存数据
    this.cacheData(imageId, imageBitmap, previewUrl, processedFile)
    
    return {
      config: {
        type: 'image',
        imageId,
        imageBitmap,
        fit: 'cover',
        position: 'center',
        opacity: 1,
        blur: 0,
        scale: 1,
        offsetX: 0,
        offsetY: 0
      },
      previewData: {
        imageId,
        previewUrl,
        originalFile: processedFile
      }
    }
  }

  /**
   * 从预设创建图片配置
   */
  async processPresetImage(preset: ImagePreset): Promise<{
    config: ImageBackgroundConfig,
    previewData: ImagePreviewData
  }> {
    const imageId = `preset-${preset.id}`
    
    // 检查缓存
    if (this.bitmapCache.has(imageId)) {
      return {
        config: {
          type: 'image',
          imageId,
          imageBitmap: this.bitmapCache.get(imageId)!,
          ...preset.config
        },
        previewData: {
          imageId,
          previewUrl: this.previewCache.get(imageId) || preset.imageUrl
        }
      }
    }
    
    // 加载预设图片
    const response = await fetch(preset.imageUrl)
    const blob = await response.blob()
    const imageBitmap = await createImageBitmap(blob)
    const previewUrl = URL.createObjectURL(blob)
    
    // 缓存
    this.cacheData(imageId, imageBitmap, previewUrl, new File([blob], `preset-${preset.id}`))
    
    return {
      config: {
        type: 'image',
        imageId,
        imageBitmap,
        ...preset.config
      },
      previewData: {
        imageId,
        previewUrl
      }
    }
  }

  /**
   * 获取ImageBitmap用于Worker渲染
   */
  getImageBitmap(imageId: string): ImageBitmap | null {
    return this.bitmapCache.get(imageId) || null
  }

  /**
   * 获取预览URL
   */
  getPreviewUrl(imageId: string): string | null {
    return this.previewCache.get(imageId) || null
  }

  /**
   * 清理资源
   */
  cleanup(imageId?: string) {
    if (imageId) {
      // 清理特定图片
      const url = this.previewCache.get(imageId)
      if (url) {
        URL.revokeObjectURL(url)
        this.previewCache.delete(imageId)
      }
      
      const bitmap = this.bitmapCache.get(imageId)
      if (bitmap) {
        bitmap.close()
        this.bitmapCache.delete(imageId)
      }
      
      this.fileCache.delete(imageId)
    } else {
      // 清理所有资源
      this.previewCache.forEach(url => URL.revokeObjectURL(url))
      this.bitmapCache.forEach(bitmap => bitmap.close())
      
      this.previewCache.clear()
      this.bitmapCache.clear()
      this.fileCache.clear()
    }
  }

  // 私有方法

  private validateImageFile(file: File, options: ImageProcessingOptions) {
    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      throw new Error('只支持图片文件')
    }
    
    // 检查文件大小
    if (options.maxSizeBytes && file.size > options.maxSizeBytes) {
      throw new Error(`图片文件过大，请选择小于${Math.round(options.maxSizeBytes / 1024 / 1024)}MB的图片`)
    }
    
    // 检查支持的格式
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!supportedTypes.includes(file.type)) {
      throw new Error('不支持的图片格式，请使用 JPEG、PNG、WebP 或 GIF 格式')
    }
  }

  private generateImageId(file: File): string {
    // 基于文件名、大小和修改时间生成唯一ID
    const timestamp = Date.now()
    const hash = this.simpleHash(`${file.name}-${file.size}-${file.lastModified}`)
    return `img-${hash}-${timestamp}`
  }

  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // 转换为32位整数
    }
    return Math.abs(hash).toString(36)
  }

  private async compressImageIfNeeded(
    file: File, 
    options: ImageProcessingOptions
  ): Promise<File> {
    // 如果文件已经足够小，直接返回
    if (!options.maxSizeBytes || file.size <= options.maxSizeBytes / 2) {
      return file
    }
    
    // 创建canvas进行压缩
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    // 加载图片
    const img = await createImageBitmap(file)
    
    // 计算压缩后的尺寸
    const { width, height } = this.calculateCompressedSize(
      img.width, 
      img.height, 
      options.maxWidth || DEFAULT_OPTIONS.maxWidth!,
      options.maxHeight || DEFAULT_OPTIONS.maxHeight!
    )
    
    // 设置canvas尺寸
    canvas.width = width
    canvas.height = height
    
    // 绘制压缩后的图片
    ctx.drawImage(img, 0, 0, width, height)
    
    // 清理原始ImageBitmap
    img.close()
    
    // 转换为Blob
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: file.lastModified
            })
            resolve(compressedFile)
          } else {
            resolve(file) // 压缩失败，返回原文件
          }
        },
        'image/jpeg',
        options.quality || DEFAULT_OPTIONS.quality
      )
    })
  }

  private calculateCompressedSize(
    originalWidth: number, 
    originalHeight: number, 
    maxWidth: number, 
    maxHeight: number
  ): { width: number; height: number } {
    const aspectRatio = originalWidth / originalHeight
    
    let width = originalWidth
    let height = originalHeight
    
    // 按宽度限制
    if (width > maxWidth) {
      width = maxWidth
      height = width / aspectRatio
    }
    
    // 按高度限制
    if (height > maxHeight) {
      height = maxHeight
      width = height * aspectRatio
    }
    
    return {
      width: Math.round(width),
      height: Math.round(height)
    }
  }

  private cacheData(
    imageId: string, 
    imageBitmap: ImageBitmap, 
    previewUrl: string, 
    file: File
  ) {
    this.bitmapCache.set(imageId, imageBitmap)
    this.previewCache.set(imageId, previewUrl)
    this.fileCache.set(imageId, file)
    
    console.log('🖼️ [ImageBackgroundManager] Cached image:', {
      imageId,
      fileSize: file.size,
      bitmapSize: `${imageBitmap.width}x${imageBitmap.height}`,
      previewUrl
    })
  }
}

// 单例实例
export const imageBackgroundManager = new ImageBackgroundManager()
