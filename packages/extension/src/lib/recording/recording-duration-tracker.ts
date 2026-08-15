function normalizeTime(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export class RecordingDurationTracker {
  private activeSinceMs: number | null = null
  private elapsedMs = 0

  start(nowMs: number): void {
    this.elapsedMs = 0
    this.activeSinceMs = normalizeTime(nowMs)
  }

  pause(nowMs: number): void {
    if (this.activeSinceMs === null) return
    this.elapsedMs += Math.max(0, normalizeTime(nowMs) - this.activeSinceMs)
    this.activeSinceMs = null
  }

  resume(nowMs: number): void {
    if (this.activeSinceMs !== null) return
    this.activeSinceMs = normalizeTime(nowMs)
  }

  stop(nowMs: number): void {
    this.pause(nowMs)
  }

  duration(nowMs: number): number {
    const activeMs = this.activeSinceMs === null
      ? 0
      : Math.max(0, normalizeTime(nowMs) - this.activeSinceMs)
    return Math.max(0, Math.round(this.elapsedMs + activeMs))
  }

  timestampUs(nowMs: number): number {
    return this.duration(nowMs) * 1000
  }

  reset(): void {
    this.elapsedMs = 0
    this.activeSinceMs = null
  }
}
