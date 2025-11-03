/**
 * Video Trim Store - 视频裁剪状态管理
 * 
 * 管理视频裁剪的开始/结束时间和帧索引
 */

class TrimStore {
  // 裁剪开始时间（毫秒）
  trimStartMs = $state(0)
  // 裁剪结束时间（毫秒）- 默认为视频结束
  trimEndMs = $state(0)
  // 视频总时长（毫秒）
  durationMs = $state(0)
  // 视频帧率
  frameRate = $state(30)
  // 总帧数
  totalFrames = $state(0)
  // 是否启用裁剪
  enabled = $state(false)

  // 计算裁剪开始帧索引
  get trimStartFrame(): number {
    return Math.floor((this.trimStartMs / 1000) * this.frameRate)
  }

  // 计算裁剪结束帧索引
  get trimEndFrame(): number {
    return Math.floor((this.trimEndMs / 1000) * this.frameRate)
  }

  // 计算裁剪持续时间（毫秒）
  get trimDurationMs(): number {
    return this.trimEndMs - this.trimStartMs
  }

  // 计算裁剪帧数
  get trimFrameCount(): number {
    return Math.max(0, this.trimEndFrame - this.trimStartFrame)
  }

  /**
   * 初始化裁剪范围（设置为整个视频）
   */
  initialize(durationMs: number, frameRate: number = 30, totalFrames: number = 0) {
    this.durationMs = durationMs
    this.frameRate = frameRate
    this.totalFrames = totalFrames
    this.trimStartMs = 0
    this.trimEndMs = durationMs
    this.enabled = false
    
    console.log('🎬 [TrimStore] Initialized:', {
      durationMs,
      frameRate,
      totalFrames,
      trimStartMs: this.trimStartMs,
      trimEndMs: this.trimEndMs
    })
  }

  /**
   * 更新参数（不重置 enabled 状态和裁剪范围）
   */
  updateParameters(durationMs: number, frameRate: number = 30, totalFrames: number = 0) {
    const wasEnabled = this.enabled
    const oldDuration = this.durationMs
    
    this.durationMs = durationMs
    this.frameRate = frameRate
    this.totalFrames = totalFrames
    
    // 如果时长变化，按比例调整裁剪范围
    if (oldDuration > 0 && durationMs !== oldDuration) {
      const ratio = durationMs / oldDuration
      this.trimStartMs = Math.min(this.trimStartMs * ratio, durationMs)
      this.trimEndMs = Math.min(this.trimEndMs * ratio, durationMs)
    }
    
    // 确保 trimEndMs 不超过新的 durationMs
    if (this.trimEndMs > durationMs) {
      this.trimEndMs = durationMs
    }
    
    console.log('🔧 [TrimStore] Parameters updated:', {
      durationMs,
      frameRate,
      totalFrames,
      enabled: wasEnabled,
      trimStartMs: this.trimStartMs,
      trimEndMs: this.trimEndMs
    })
  }

  /**
   * 设置裁剪开始时间
   */
  setTrimStart(ms: number) {
    // 确保不超过裁剪结束时间
    const clampedMs = Math.max(0, Math.min(ms, this.trimEndMs - 100)) // 最少保留100ms
    this.trimStartMs = clampedMs
    
    console.log('✂️ [TrimStore] Trim start updated:', {
      trimStartMs: this.trimStartMs,
      trimStartFrame: this.trimStartFrame
    })
  }

  /**
   * 设置裁剪结束时间
   */
  setTrimEnd(ms: number) {
    // 确保不小于裁剪开始时间
    const clampedMs = Math.min(this.durationMs, Math.max(ms, this.trimStartMs + 100))
    this.trimEndMs = clampedMs
    
    console.log('✂️ [TrimStore] Trim end updated:', {
      trimEndMs: this.trimEndMs,
      trimEndFrame: this.trimEndFrame
    })
  }

  /**
   * 启用裁剪
   */
  enable() {
    this.enabled = true
    console.log('✅ [TrimStore] Trim enabled')
  }

  /**
   * 禁用裁剪（重置为全部范围）
   */
  disable() {
    this.enabled = false
    this.trimStartMs = 0
    this.trimEndMs = this.durationMs
    console.log('❌ [TrimStore] Trim disabled, reset to full range')
  }

  /**
   * 切换裁剪状态
   */
  toggle() {
    if (this.enabled) {
      this.disable()
    } else {
      this.enable()
    }
  }

  /**
   * 重置裁剪范围到整个视频
   */
  reset() {
    this.trimStartMs = 0
    this.trimEndMs = this.durationMs
    console.log('🔄 [TrimStore] Trim range reset to full video')
  }

  /**
   * 检查给定时间是否在裁剪范围内
   */
  isInTrimRange(timeMs: number): boolean {
    if (!this.enabled) return true
    return timeMs >= this.trimStartMs && timeMs <= this.trimEndMs
  }

  /**
   * 检查给定帧是否在裁剪范围内
   */
  isFrameInTrimRange(frameIndex: number): boolean {
    if (!this.enabled) return true
    return frameIndex >= this.trimStartFrame && frameIndex <= this.trimEndFrame
  }

  /**
   * 对齐到关键帧（如果提供了关键帧信息）
   */
  alignToKeyframes(keyframeIndices: number[]) {
    if (!keyframeIndices || keyframeIndices.length === 0) return

    // 找到裁剪开始前的最近关键帧
    let alignedStartFrame = this.trimStartFrame
    for (let i = keyframeIndices.length - 1; i >= 0; i--) {
      if (keyframeIndices[i] <= this.trimStartFrame) {
        alignedStartFrame = keyframeIndices[i]
        break
      }
    }

    // 找到裁剪结束后的最近关键帧（或使用原值）
    let alignedEndFrame = this.trimEndFrame
    for (let i = 0; i < keyframeIndices.length; i++) {
      if (keyframeIndices[i] >= this.trimEndFrame) {
        alignedEndFrame = keyframeIndices[i]
        break
      }
    }

    // 更新时间
    this.trimStartMs = Math.floor((alignedStartFrame / this.frameRate) * 1000)
    this.trimEndMs = Math.floor((alignedEndFrame / this.frameRate) * 1000)

    console.log('🎯 [TrimStore] Aligned to keyframes:', {
      originalStart: this.trimStartFrame,
      alignedStartFrame,
      originalEnd: this.trimEndFrame,
      alignedEndFrame
    })
  }

  /**
   * 获取裁剪信息对象
   */
  getTrimInfo() {
    return {
      enabled: this.enabled,
      startMs: this.trimStartMs,
      endMs: this.trimEndMs,
      startFrame: this.trimStartFrame,
      endFrame: this.trimEndFrame,
      durationMs: this.trimDurationMs,
      frameCount: this.trimFrameCount
    }
  }
}

// 导出单例实例
export const trimStore = new TrimStore()
