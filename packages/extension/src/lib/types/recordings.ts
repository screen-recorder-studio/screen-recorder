/**
 * Shared RecordingSummary type used across Drive, Studio, and Launcher.
 * Single source of truth for recording metadata display.
 */
export interface RecordingSummary {
  id: string
  displayName: string
  createdAt: number
  duration: number
  resolution: string
  size: number
  totalChunks: number
  codec?: string
  fps?: number
  thumbnail?: string
  meta?: any
}
