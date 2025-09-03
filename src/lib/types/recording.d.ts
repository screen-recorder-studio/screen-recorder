// 录制相关类型定义
export type RecordingStatus = 'idle' | 'requesting' | 'recording' | 'stopping' | 'completed' | 'error'
export type RecordingEngine = 'webcodecs' | 'mediarecorder'

export interface RecordingState {
  isRecording: boolean
  duration: number
  status: RecordingStatus
  error: string | null
  videoBlob: Blob | null
  startTime: number | null
  engine: RecordingEngine
  progress: RecordingProgress
}

export interface RecordingProgress {
  encodedChunks: number
  processedFrames: number
  fileSize: number // 字节
  fps: number // 实际帧率
  bitrate: number // 实际比特率
  cpuUsage: number // CPU 使用率百分比
}

export interface RecordingOptions {
  includeAudio: boolean
  videoQuality: 'high' | 'medium' | 'low'
  maxDuration: number // 秒
  preferredEngine: RecordingEngine
  codec: 'vp9' | 'vp8' | 'av1' | 'h264'
  framerate: number
  bitrate?: number
  useWorkers: boolean // 强制使用 Workers
}

export interface WebCodecsCapabilities {
  supported: boolean
  vp9: boolean
  vp8: boolean
  av1: boolean
  h264: boolean
  hardwareAcceleration: boolean
  workerSupport: boolean
}

export enum RecordingError {
  PERMISSION_DENIED = 'permission_denied',
  MEDIA_NOT_SUPPORTED = 'media_not_supported',
  RECORDING_FAILED = 'recording_failed',
  SAVE_FAILED = 'save_failed',
  STREAM_INVALID = 'stream_invalid',
  DESKTOP_CAPTURE_CANCELLED = 'desktop_capture_cancelled'
}

export interface RecordingErrorInfo {
  code: RecordingError
  message: string
  details?: any
}