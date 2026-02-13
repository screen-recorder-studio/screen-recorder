/**
 * Video Zoom Store - Video Zoom State Management
 *
 * Manages the configuration and state of video zoom intervals.
 */

/**
 * Zoom Mode
 * - dolly: Dolly mode (default). Focus point moves to the center of the screen. Suitable for close-ups or dramatic emphasis.
 * - anchor: Anchor mode. Focus point remains fixed at its screen position. Suitable for tutorials or examining details.
 */
export type ZoomMode = 'dolly' | 'anchor'

/**
 * Easing Type
 * - smooth: easeInOutCubic (default). Smooth camera movement (accelerate then decelerate).
 * - linear: Constant speed. Mechanical or precise demonstration.
 * - punch: Step/Hold. Instant magnification. Good for beat-syncing or emphasis.
 */
export type ZoomEasing = 'smooth' | 'linear' | 'punch'

export interface ZoomInterval {
  startMs: number
  endMs: number
  // Optional: Interval-specific focus point (0..1), supports two coordinate spaces
  focusX?: number
  focusY?: number
  focusSpace?: 'source' | 'layout'
  // Optional: Interval-specific scale multiplier
  scale?: number
  // 🆕 P1: Zoom Mode (default: dolly)
  mode?: ZoomMode
  // 🆕 P1: Interval-specific transition duration (ms, defaults to global 300ms)
  transitionDurationMs?: number
  // 🆕 P1: Easing type (default: smooth)
  easing?: ZoomEasing
  // 🆕 P2: Sync background with foreground zoom (default: false)
  // When enabled, background zooms together with video, creating a "push in" effect
  syncBackground?: boolean
}

class VideoZoomStore {
  // Whether zoom is enabled
  enabled = $state(false)

  // List of Zoom intervals (sorted by start time)
  intervals = $state<ZoomInterval[]>([])

  // Global focus point (normalized 0~1 relative to display area)
  // Default is center (0.5, 0.5), adjustable via setFocus()
  focusX = $state(0.5)
  focusY = $state(0.5)

  /**
   * Set global focus point
   * @param fx 0~1, relative to layout width (0=left, 1=right)
   * @param fy 0~1, relative to layout height (0=top, 1=bottom)
   */
  setFocus(fx: number, fy: number) {
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
    this.focusX = clamp01(fx)
    this.focusY = clamp01(fy)
  }

  /** Get current global focus point (read-only snapshot) */
  getFocus() { return { x: this.focusX, y: this.focusY } }

  // Global default scale (can be overridden by intervals)
  readonly scale = 1.5

  // Transition duration (ms)
  readonly transitionDurationMs = 300

  /**
   * Check if a new interval overlaps with existing ones (including transition buffer)
   *
   * 🔧 P0 Fix: Consider 300ms transition period to avoid conflicts between adjacent intervals
   *
   * Logic: Do the new interval (with transition) and existing interval (with transition) intersect?
   * - New effective range: [startMs - transitionMs, endMs + transitionMs]
   * - Existing effective range: [interval.startMs - transitionMs, interval.endMs + transitionMs]
   */
  private hasOverlap(startMs: number, endMs: number, excludeIndex?: number): boolean {
    const transitionMs = this.transitionDurationMs

    return this.intervals.some((interval, index) => {
      // Exclude itself (for moveInterval checks)
      if (excludeIndex !== undefined && index === excludeIndex) {
        return false
      }

      // Calculate effective range (including transition)
      const newEffectiveStart = startMs - transitionMs
      const newEffectiveEnd = endMs + transitionMs
      const existingEffectiveStart = interval.startMs - transitionMs
      const existingEffectiveEnd = interval.endMs + transitionMs

      // Overlap condition
      const hasOverlap = newEffectiveStart < existingEffectiveEnd && newEffectiveEnd > existingEffectiveStart

      if (hasOverlap) {
      }

      return hasOverlap
    })
  }

  /**
   * Add a Zoom interval (no overlap allowed)
   * @returns true if successful, false if failed (overlap)
   */
  addInterval(startMs: number, endMs: number): boolean {
    // Check for overlap
    if (this.hasOverlap(startMs, endMs)) {
      console.warn('⚠️ [VideoZoomStore] Cannot add overlapping interval:', {
        new: { startMs, endMs },
        existing: this.intervals
      })
      return false
    }

    // Add new interval
    this.intervals.push({ startMs, endMs })

    // Sort by start time
    this.intervals.sort((a, b) => a.startMs - b.startMs)

    this.enabled = true


    return true
  }

  /**
   * Remove interval at specified index
   */
  removeInterval(index: number) {
    if (index >= 0 && index < this.intervals.length) {
      const removed = this.intervals.splice(index, 1)[0]

      if (this.intervals.length === 0) {
        this.enabled = false
      }

    }
  }

  /**
   * Move interval at specified index to new position (no overlap allowed, with transition buffer)
   * @returns true if successful, false if failed (overlap)
   */
  moveInterval(index: number, newStartMs: number, newEndMs: number): boolean {
    if (index < 0 || index >= this.intervals.length) {
      console.warn('⚠️ [VideoZoomStore] Invalid interval index:', index)
      return false
    }

    // 🔧 P0 Fix: Use unified hasOverlap method (with transition buffer), excluding itself
    if (this.hasOverlap(newStartMs, newEndMs, index)) {
      console.warn('⚠️ [VideoZoomStore] Cannot move interval: overlaps with existing interval (with transition buffer):', {
        index,
        newPosition: { startMs: newStartMs, endMs: newEndMs },
        transitionMs: this.transitionDurationMs
      })
      return false
    }

    // Update interval position (keeping existing focus info)
    this.intervals[index] = { ...this.intervals[index], startMs: newStartMs, endMs: newEndMs }

    // Re-sort
    this.intervals.sort((a, b) => a.startMs - b.startMs)

    return true
  }

  /**
   * Set focus point for a specific interval
   */
  setIntervalFocus(index: number, focus: { x: number; y: number; space?: 'source' | 'layout' }): boolean {
    if (index < 0 || index >= this.intervals.length) return false
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
    const fx = clamp01(focus.x)
    const fy = clamp01(focus.y)
    const space = focus.space ?? 'source'
    this.intervals[index] = { ...this.intervals[index], focusX: fx, focusY: fy, focusSpace: space }
    return true
  }

  /** Set scale for a specific interval (>1.0) */
  setIntervalScale(index: number, scale: number): boolean {
    if (index < 0 || index >= this.intervals.length) return false
    const s = Math.max(1.0, Number(scale) || 1.0)
    this.intervals[index] = { ...this.intervals[index], scale: s }
    return true
  }

  /** Get interval scale (returns global default if not set) */
  getIntervalScale(index: number): number {
    if (index < 0 || index >= this.intervals.length) return this.scale
    return Math.max(1.0, this.intervals[index].scale ?? this.scale)
  }

  getIntervalFocus(index: number): { x: number; y: number; space: 'source' | 'layout' } | null {
    if (index < 0 || index >= this.intervals.length) return null
    const it = this.intervals[index]
    if (it.focusX == null || it.focusY == null) return null
    return { x: it.focusX, y: it.focusY, space: it.focusSpace ?? 'source' }
  }

  clearIntervalFocus(index: number): void {
    if (index < 0 || index >= this.intervals.length) return
    const it = this.intervals[index]
    delete it.focusX; delete it.focusY; delete it.focusSpace
  }

  // ==================== 🆕 P1: New Interval Property Setters ====================

  /**
   * Set Zoom Mode for a specific interval
   * @param index Interval index
   * @param mode 'dolly' | 'anchor'
   */
  setIntervalMode(index: number, mode: ZoomMode): boolean {
    if (index < 0 || index >= this.intervals.length) return false
    this.intervals[index] = { ...this.intervals[index], mode }
    return true
  }

  /** Get interval Zoom Mode (default: dolly) */
  getIntervalMode(index: number): ZoomMode {
    if (index < 0 || index >= this.intervals.length) return 'dolly'
    return this.intervals[index].mode ?? 'dolly'
  }

  /**
   * Set Easing Type for a specific interval
   * @param index Interval index
   * @param easing 'smooth' | 'linear' | 'punch'
   */
  setIntervalEasing(index: number, easing: ZoomEasing): boolean {
    if (index < 0 || index >= this.intervals.length) return false
    this.intervals[index] = { ...this.intervals[index], easing }
    return true
  }

  /** Get interval Easing Type (default: smooth) */
  getIntervalEasing(index: number): ZoomEasing {
    if (index < 0 || index >= this.intervals.length) return 'smooth'
    return this.intervals[index].easing ?? 'smooth'
  }

  /**
   * Set Transition Duration for a specific interval
   * @param index Interval index
   * @param durationMs Duration in ms, min 0, max 1000
   */
  setIntervalTransitionDuration(index: number, durationMs: number): boolean {
    if (index < 0 || index >= this.intervals.length) return false
    const clampedDuration = Math.max(0, Math.min(1000, durationMs))
    this.intervals[index] = { ...this.intervals[index], transitionDurationMs: clampedDuration }
    return true
  }

  /** Get interval Transition Duration (default: global transitionDurationMs) */
  getIntervalTransitionDuration(index: number): number {
    if (index < 0 || index >= this.intervals.length) return this.transitionDurationMs
    return this.intervals[index].transitionDurationMs ?? this.transitionDurationMs
  }

  // ==================== P2 Sync Background Methods ====================

  /**
   * Set interval Sync Background
   * @param syncBackground Whether to zoom background with foreground
   */
  setIntervalSyncBackground(index: number, syncBackground: boolean): boolean {
    if (index < 0 || index >= this.intervals.length) return false
    this.intervals[index] = { ...this.intervals[index], syncBackground }
    return true
  }

  /** Get interval Sync Background (default: false) */
  getIntervalSyncBackground(index: number): boolean {
    if (index < 0 || index >= this.intervals.length) return false
    return this.intervals[index].syncBackground ?? false
  }

  // ==================== END P2 New Methods ====================

  /**
   * Clear all intervals
   */
  clearAll() {
    this.intervals = []
    this.enabled = false
  }

  /**
   * Get configuration object (passed to worker)
   * 🆕 P1: Includes mode, transitionDurationMs, easing fields
   * 🆕 P2: Includes syncBackground field
   */
  getZoomConfig() {
    if (!this.enabled || this.intervals.length === 0) {
      return undefined
    }

    return {
      enabled: true,
      scale: this.scale,
      transitionDurationMs: this.transitionDurationMs,
      focusX: this.focusX,
      focusY: this.focusY,
      intervals: this.intervals.map(interval => ({
        startMs: interval.startMs,
        endMs: interval.endMs,
        // Basic properties
        ...(interval.scale != null ? { scale: Math.max(1.0, interval.scale) } : {}),
        ...(interval.focusX != null && interval.focusY != null ? {
          focusX: interval.focusX,
          focusY: interval.focusY,
          focusSpace: interval.focusSpace ?? 'source'
        } : {}),
        // 🆕 P1: New properties
        mode: interval.mode ?? 'dolly',
        easing: interval.easing ?? 'smooth',
        transitionDurationMs: interval.transitionDurationMs ?? this.transitionDurationMs,
        // 🆕 P2: Sync background
        syncBackground: interval.syncBackground ?? false
      }))
    }
  }

  /**
   * Check if specific time is within any Zoom interval
   */
  isInZoomInterval(timeMs: number): boolean {
    return this.intervals.some(interval =>
      timeMs >= interval.startMs && timeMs <= interval.endMs
    )
  }

  /**
   * Get the Zoom interval at specific time (if any)
   */
  getIntervalAt(timeMs: number): ZoomInterval | null {
    return this.intervals.find(interval =>
      timeMs >= interval.startMs && timeMs <= interval.endMs
    ) || null
  }
}

// Export singleton instance
export const videoZoomStore = new VideoZoomStore()