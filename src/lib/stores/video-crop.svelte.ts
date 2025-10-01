/**
 * Video Crop Store - 视频裁剪状态管理
 * 
 * 管理视频空间裁剪的配置和状态
 */

class VideoCropStore {
  // 是否启用裁剪
  enabled = $state(false)
  
  // 裁剪模式
  mode = $state<'pixels' | 'percentage'>('percentage')
  
  // 百分比模式（0-1，相对于原始视频尺寸）
  xPercent = $state(0)
  yPercent = $state(0)
  widthPercent = $state(1)  // 100%
  heightPercent = $state(1) // 100%
  
  // 像素模式（绝对像素坐标）
  x = $state(0)
  y = $state(0)
  width = $state(1920)
  height = $state(1080)
  
  // 原始视频尺寸（用于参考和计算）
  originalWidth = $state(1920)
  originalHeight = $state(1080)
  
  /**
   * 设置原始视频尺寸
   */
  setOriginalSize(width: number, height: number) {
    this.originalWidth = width
    this.originalHeight = height
    
    console.log('📐 [VideoCropStore] Original size set:', {
      width,
      height
    })
  }
  
  /**
   * 重置到全尺寸（禁用裁剪）
   */
  reset() {
    this.enabled = false
    this.xPercent = 0
    this.yPercent = 0
    this.widthPercent = 1
    this.heightPercent = 1
    
    console.log('🔄 [VideoCropStore] Reset to full size')
  }
  
  /**
   * 启用裁剪
   */
  enable() {
    this.enabled = true
    console.log('✅ [VideoCropStore] Crop enabled')
  }
  
  /**
   * 禁用裁剪
   */
  disable() {
    this.enabled = false
    console.log('❌ [VideoCropStore] Crop disabled')
  }
  
  /**
   * 获取裁剪配置对象（传递给 worker）
   */
  getCropConfig() {
    if (!this.enabled) {
      return undefined
    }
    
    return {
      enabled: this.enabled,
      mode: this.mode,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      xPercent: this.xPercent,
      yPercent: this.yPercent,
      widthPercent: this.widthPercent,
      heightPercent: this.heightPercent
    }
  }
  
  /**
   * 从百分比更新像素坐标
   */
  updatePixelsFromPercent() {
    this.x = Math.round(this.xPercent * this.originalWidth)
    this.y = Math.round(this.yPercent * this.originalHeight)
    this.width = Math.round(this.widthPercent * this.originalWidth)
    this.height = Math.round(this.heightPercent * this.originalHeight)
  }
  
  /**
   * 从像素坐标更新百分比
   */
  updatePercentFromPixels() {
    this.xPercent = this.x / this.originalWidth
    this.yPercent = this.y / this.originalHeight
    this.widthPercent = this.width / this.originalWidth
    this.heightPercent = this.height / this.originalHeight
  }
  
  /**
   * 设置裁剪区域（百分比模式）
   */
  setCropPercent(xPercent: number, yPercent: number, widthPercent: number, heightPercent: number) {
    this.mode = 'percentage'
    this.xPercent = Math.max(0, Math.min(1, xPercent))
    this.yPercent = Math.max(0, Math.min(1, yPercent))
    this.widthPercent = Math.max(0, Math.min(1, widthPercent))
    this.heightPercent = Math.max(0, Math.min(1, heightPercent))
    
    // 同步更新像素坐标
    this.updatePixelsFromPercent()
    
    console.log('✂️ [VideoCropStore] Crop set (percent):', {
      x: this.xPercent,
      y: this.yPercent,
      width: this.widthPercent,
      height: this.heightPercent
    })
  }
  
  /**
   * 设置裁剪区域（像素模式）
   */
  setCropPixels(x: number, y: number, width: number, height: number) {
    this.mode = 'pixels'
    this.x = Math.max(0, x)
    this.y = Math.max(0, y)
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    
    // 同步更新百分比
    this.updatePercentFromPixels()
    
    console.log('✂️ [VideoCropStore] Crop set (pixels):', {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height
    })
  }
}

// 导出单例实例
export const videoCropStore = new VideoCropStore()
