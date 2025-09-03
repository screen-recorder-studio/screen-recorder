// Worker 消息类型定义
export interface WorkerMessage {
  id: string
  type: string
  payload: any
}

export interface WebCodecsWorkerMessage extends WorkerMessage {
  type: 'start' | 'stop' | 'configure' | 'progress' | 'error' | 'complete'
  payload: {
    config?: VideoEncoderConfig
    stream?: MediaStream
    progress?: RecordingProgress
    error?: string
    result?: Blob
  }
}

export interface MediaRecorderWorkerMessage extends WorkerMessage {
  type: 'start' | 'stop' | 'progress' | 'error' | 'complete'
  payload: {
    stream?: MediaStream
    options?: MediaRecorderOptions
    progress?: RecordingProgress
    error?: string
    result?: Blob
  }
}

export interface FileProcessorWorkerMessage extends WorkerMessage {
  type: 'process' | 'compress' | 'metadata' | 'progress' | 'error' | 'complete'
  payload: {
    file?: Blob
    options?: FileProcessingOptions
    progress?: number
    error?: string
    result?: Blob
  }
}

export interface FileProcessingOptions {
  compress: boolean
  quality: number
  addMetadata: boolean
  metadata?: VideoMetadata
}

export interface VideoMetadata {
  title?: string
  description?: string
  timestamp: number
  duration: number
  resolution: { width: number; height: number }
  codec: string
  bitrate: number
}

import type { RecordingProgress } from './recording'