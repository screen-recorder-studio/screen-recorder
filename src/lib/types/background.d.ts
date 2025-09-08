// 背景配置类型定义
export interface BackgroundConfig {
  type: 'solid-color' | 'gradient'
  color: string
  padding: number
  outputRatio: '16:9' | '1:1' | '9:16' | '4:5' | 'custom'
  customWidth?: number
  customHeight?: number
  videoPosition: 'center' | 'top' | 'bottom'
  borderRadius?: number
  inset?: number
  shadow?: {
    offsetX: number
    offsetY: number
    blur: number
    color: string
  }
}

export interface ExportOptions {
  format: 'webm' | 'mp4'
  includeBackground: boolean
  backgroundConfig?: BackgroundConfig
  quality: 'high' | 'medium' | 'low'
  resolution?: {
    width: number
    height: number
  }
  bitrate?: number
  framerate?: number
}

export interface ExportProgress {
  type: 'webm' | 'mp4'
  stage: 'preparing' | 'compositing' | 'encoding' | 'muxing' | 'finalizing'
  progress: number
  currentFrame: number
  totalFrames: number
  estimatedTimeRemaining: number
  fileSize?: number
}

export interface EncodedChunk {
  data: Uint8Array
  timestamp: number
  type: 'key' | 'delta'
  size: number
  codedWidth?: number
  codedHeight?: number
  codec?: string
}
