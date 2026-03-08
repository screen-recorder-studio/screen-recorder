// 背景配置类型定义

// 渐变颜色停止点
export interface GradientStop {
  color: string      // 颜色值 (hex, rgb, rgba)
  position: number   // 位置 (0-1)
}

// 线性渐变配置
export interface LinearGradientConfig {
  type: 'linear'
  angle: number           // 角度 (0-360度)
  stops: GradientStop[]   // 颜色停止点
}

// 径向渐变配置
export interface RadialGradientConfig {
  type: 'radial'
  centerX: number         // 中心点X (0-1)
  centerY: number         // 中心点Y (0-1)
  radius: number          // 半径 (0-1)
  stops: GradientStop[]   // 颜色停止点
}

// 圆锥渐变配置
export interface ConicGradientConfig {
  type: 'conic'
  centerX: number         // 中心点X (0-1)
  centerY: number         // 中心点Y (0-1)
  angle: number           // 起始角度 (0-360度)
  stops: GradientStop[]   // 颜色停止点
}

// 渐变配置联合类型
export type GradientConfig = LinearGradientConfig | RadialGradientConfig | ConicGradientConfig

// 图片背景配置
export interface ImageBackgroundConfig {
  type: 'image'
  imageId: string                  // 唯一标识符
  imageBitmap: ImageBitmap        // 核心渲染数据
  fit: 'cover' | 'contain' | 'fill' | 'stretch'
  position: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  opacity?: number                // 透明度 (0-1)
  blur?: number                  // 模糊效果 (像素)
  scale?: number                 // 缩放比例 (0.1-3.0)
  offsetX?: number              // 水平偏移 (-1 到 1)
  offsetY?: number              // 垂直偏移 (-1 到 1)
}

// UI预览用的辅助接口
export interface ImagePreviewData {
  imageId: string
  previewUrl: string             // Blob URL用于UI预览
  originalFile?: File           // 原始文件用于持久化
}

// 背景配置主接口
export interface BackgroundConfig {
  type: 'solid-color' | 'gradient' | 'image' | 'wallpaper'

  // 纯色配置
  color: string                    // 纯色时使用

  // 渐变配置
  gradient?: GradientConfig        // 渐变时使用

  // 图片配置
  image?: ImageBackgroundConfig    // 用户上传图片时使用

  // 壁纸配置
  wallpaper?: ImageBackgroundConfig // 内置壁纸时使用

  // 通用配置
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
  // 视频源裁剪配置
  videoCrop?: {
    enabled: boolean
    mode: 'pixels' | 'percentage'
    // 像素模式（视频像素坐标）
    x: number
    y: number
    width: number
    height: number
    // 百分比模式（0-1）
    xPercent: number
    yPercent: number
    widthPercent: number
    heightPercent: number
  }
  // 视频 Zoom 配置
  videoZoom?: {
    enabled: boolean
    scale: number  // 放大倍数（例如 1.5）
    transitionDurationMs: number  // 过渡时长（暂不使用）
    intervals: Array<{
      startMs: number
      endMs: number
    }>
  }
}

// 预设渐变配置类型
export interface GradientPreset {
  id: string
  name: string
  description?: string
  config: GradientConfig
  preview?: string  // CSS渐变字符串用于预览
  category?: 'linear' | 'radial' | 'conic' | 'multicolor'  // 渐变分类
}

// 预设纯色配置类型
export interface SolidColorPreset {
  id: string
  name: string
  color: string
  category?: 'basic' | 'business' | 'creative' | 'dark' | 'light'
}

// 预设图片配置类型
export interface ImagePreset {
  id: string
  name: string
  description?: string
  imageUrl: string              // 预设图片的URL
  config: Omit<ImageBackgroundConfig, 'type' | 'imageId' | 'imageUrl' | 'imageData' | 'imageBitmap'>
  category?: 'abstract' | 'nature' | 'business' | 'tech' | 'minimal'
  tags?: string[]              // 搜索标签
}

// 预设图片配置类型
export interface ImagePreset {
  id: string
  name: string
  description?: string
  imageUrl: string              // 预设图片的URL
  config: Omit<ImageBackgroundConfig, 'type' | 'imageId' | 'imageUrl' | 'imageData' | 'imageBitmap'>
  category?: 'abstract' | 'nature' | 'business' | 'tech' | 'minimal'
  tags?: string[]              // 搜索标签
}

// 背景配置验证结果
export interface BackgroundConfigValidation {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

// 渐变方向预设
export type GradientDirection =
  | 'to-top'           // 0deg
  | 'to-top-right'     // 45deg
  | 'to-right'         // 90deg
  | 'to-bottom-right'  // 135deg
  | 'to-bottom'        // 180deg
  | 'to-bottom-left'   // 225deg
  | 'to-left'          // 270deg
  | 'to-top-left'      // 315deg

export interface ExportOptions {
  format: 'webm' | 'mp4' | 'gif'
  includeBackground: boolean
  backgroundConfig?: BackgroundConfig
  quality: 'high' | 'medium' | 'low'
  resolution?: {
    width: number
    height: number
  }
  bitrate?: number
  framerate?: number
  // 新增：导出数据源（默认为 'chunks' 保持兼容）
  source?: 'chunks' | 'opfs'
  // 当 source 为 'opfs' 时需要提供目录 id
  opfsDirId?: string
  // 可选：导出时的窗口大小（帧数），不设置则由 worker 取默认值
  windowSize?: number
  // 当需要直接写入 OPFS（流式）时启用
  saveToOpfs?: boolean
  // 指定写入 OPFS 的文件名（不含路径），缺省时自动生成
  opfsFileName?: string
  // 视频裁剪配置
  trim?: {
    enabled: boolean
    startMs: number
    endMs: number
    startFrame: number
    endFrame: number
  }
  // GIF 专用选项
  gifOptions?: {
    fps?: number // 帧率 (默认 10)
    quality?: number // 质量 1-30 (默认 10)
    scale?: number // 缩放比例 0-1 (默认 1.0)
    workers?: number // Worker 线程数 (默认 2)
    repeat?: number // 重复次数 (-1=不重复, 0=永远, 默认 0)
    dither?: boolean | string // 抖动算法 (默认 false)
    transparent?: string | null // 透明色 (默认 null)
    debug?: boolean // 调试模式 (默认 false)
  }
}

export interface ExportProgress {
  type: 'webm' | 'mp4' | 'gif'
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
