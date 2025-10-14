/**
 * Video Zoom Store - 视频 Zoom 状态管理
 * 
 * 管理视频时间段放大的配置和状态
 */

export interface ZoomInterval {
  startMs: number
  endMs: number
}

class VideoZoomStore {
  // 是否启用 Zoom
  enabled = $state(false)
  
  // Zoom 区间列表（按开始时间排序）
  intervals = $state<ZoomInterval[]>([])
  
  // 固定放大倍数
  readonly scale = 1.5
  
  // 过渡时长（毫秒）
  readonly transitionDurationMs = 300
  
  /**
   * 检查新区间是否与现有区间重叠
   */
  private hasOverlap(startMs: number, endMs: number): boolean {
    return this.intervals.some(interval => {
      // 两个区间重叠的条件：
      // 新区间的开始 < 现有区间的结束 && 新区间的结束 > 现有区间的开始
      return startMs < interval.endMs && endMs > interval.startMs
    })
  }
  
  /**
   * 添加 Zoom 区间（不允许重叠）
   * @returns true 成功，false 失败（重叠）
   */
  addInterval(startMs: number, endMs: number): boolean {
    // 检查重叠
    if (this.hasOverlap(startMs, endMs)) {
      console.warn('⚠️ [VideoZoomStore] Cannot add overlapping interval:', {
        new: { startMs, endMs },
        existing: this.intervals
      })
      return false
    }
    
    // 添加新区间
    this.intervals.push({ startMs, endMs })
    
    // 按开始时间排序
    this.intervals.sort((a, b) => a.startMs - b.startMs)
    
    this.enabled = true
    
    console.log('✅ [VideoZoomStore] Interval added:', {
      startMs,
      endMs,
      totalIntervals: this.intervals.length,
      allIntervals: this.intervals
    })
    
    return true
  }
  
  /**
   * 移除指定索引的区间
   */
  removeInterval(index: number) {
    if (index >= 0 && index < this.intervals.length) {
      const removed = this.intervals.splice(index, 1)[0]

      if (this.intervals.length === 0) {
        this.enabled = false
      }

      console.log('🗑️ [VideoZoomStore] Interval removed:', {
        index,
        removed,
        remaining: this.intervals.length
      })
    }
  }

  /**
   * 移动指定索引的区间到新位置（不允许重叠）
   * @returns true 成功，false 失败（重叠）
   */
  moveInterval(index: number, newStartMs: number, newEndMs: number): boolean {
    if (index < 0 || index >= this.intervals.length) {
      console.warn('⚠️ [VideoZoomStore] Invalid interval index:', index)
      return false
    }

    // 创建临时数组，排除当前区间
    const tempIntervals = this.intervals.filter((_, i) => i !== index)

    // 检查新位置是否与其他区间重叠
    const hasOverlap = tempIntervals.some(interval =>
      newStartMs < interval.endMs && newEndMs > interval.startMs
    )

    if (hasOverlap) {
      console.warn('⚠️ [VideoZoomStore] Cannot move interval: overlaps with existing interval:', {
        index,
        newPosition: { startMs: newStartMs, endMs: newEndMs },
        existing: tempIntervals
      })
      return false
    }

    // 更新区间位置
    this.intervals[index] = { startMs: newStartMs, endMs: newEndMs }

    // 重新排序
    this.intervals.sort((a, b) => a.startMs - b.startMs)

    console.log('✅ [VideoZoomStore] Interval moved:', {
      index,
      newPosition: { startMs: newStartMs, endMs: newEndMs },
      allIntervals: this.intervals
    })

    return true
  }
  
  /**
   * 清除所有区间
   */
  clearAll() {
    this.intervals = []
    this.enabled = false
    console.log('🗑️ [VideoZoomStore] All intervals cleared')
  }
  
  /**
   * 获取配置对象（传递给 worker）
   */
  getZoomConfig() {
    if (!this.enabled || this.intervals.length === 0) {
      return undefined
    }
    
    return {
      enabled: true,
      scale: this.scale,
      transitionDurationMs: this.transitionDurationMs,
      intervals: this.intervals.map(interval => ({
        startMs: interval.startMs,
        endMs: interval.endMs
      }))
    }
  }
  
  /**
   * 判断指定时间是否在任一 Zoom 区间内
   */
  isInZoomInterval(timeMs: number): boolean {
    return this.intervals.some(interval => 
      timeMs >= interval.startMs && timeMs <= interval.endMs
    )
  }
  
  /**
   * 获取指定时间所在的 Zoom 区间（如果有）
   */
  getIntervalAt(timeMs: number): ZoomInterval | null {
    return this.intervals.find(interval => 
      timeMs >= interval.startMs && timeMs <= interval.endMs
    ) || null
  }
}

// 导出单例实例
export const videoZoomStore = new VideoZoomStore()

