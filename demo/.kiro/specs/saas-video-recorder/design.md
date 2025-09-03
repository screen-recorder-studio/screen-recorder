# 设计文档 - SaaS视频录制器Chrome扩展

## 概述

SaaS视频录制器是一个Chrome扩展，使用Manifest V3架构。扩展通过Screen Capture API录制标签页内容，然后使用Canvas API和FFmpeg.js进行视频后处理，添加背景和布局效果。整个处理流程在浏览器端完成，无需服务器支持。

## 架构

### 整体架构
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Popup UI      │    │  Content Script │    │  Background     │
│  (用户界面)      │◄──►│   (页面交互)     │◄──►│   Service       │
│                 │    │                 │    │   Worker        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Video Recorder │    │  Canvas         │    │  File Download  │
│   Module        │    │  Processor      │    │   Manager       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 技术栈
- **Chrome Extension API**: Manifest V3, Screen Capture API, Downloads API
- **视频录制**: MediaRecorder API, getDisplayMedia()
- **视频处理**: Canvas API, Web Workers
- **UI框架**: 原生HTML/CSS/JavaScript (保持轻量)
- **文件处理**: Blob API, URL.createObjectURL()

## 组件和接口

### 1. Popup UI组件
**职责**: 用户交互界面，控制录制状态和背景选择

**接口**:
```javascript
class PopupController {
  // 开始录制
  async startRecording(): Promise<void>
  
  // 停止录制
  async stopRecording(): Promise<Blob>
  
  // 应用背景
  async applyBackground(videoBlob: Blob, backgroundType: string): Promise<Blob>
  
  // 下载视频
  downloadVideo(blob: Blob, filename: string): void
}
```

**状态管理**:
```javascript
interface RecordingState {
  isRecording: boolean
  recordingStartTime: number | null
  currentStep: 'idle' | 'recording' | 'processing' | 'complete'
}
```

### 2. Video Recorder模块
**职责**: 处理屏幕录制逻辑

**接口**:
```javascript
class VideoRecorder {
  private mediaRecorder: MediaRecorder | null
  private recordedChunks: Blob[]
  
  // 初始化录制器
  async initialize(): Promise<void>
  
  // 开始录制当前标签页
  async startTabRecording(): Promise<void>
  
  // 停止录制并返回视频数据
  async stopRecording(): Promise<Blob>
  
  // 清理资源
  cleanup(): void
}
```

### 3. Background Processor模块
**职责**: 视频背景处理和合成

**接口**:
```javascript
class BackgroundProcessor {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  
  // 应用背景到视频
  async applyBackground(
    videoBlob: Blob, 
    backgroundConfig: BackgroundConfig
  ): Promise<Blob>
  
  // 创建背景画布
  private createBackgroundCanvas(config: BackgroundConfig): HTMLCanvasElement
  
  // 合成视频帧
  private compositeFrame(
    videoFrame: ImageData, 
    backgroundCanvas: HTMLCanvasElement
  ): ImageData
}
```

**背景配置**:
```javascript
interface BackgroundConfig {
  type: 'solid-color'
  color: string  // hex color code
  padding: number  // 固定20px
  videoPosition: 'center'  // 固定居中
}
```

### 4. File Manager模块
**职责**: 文件下载和存储管理

**接口**:
```javascript
class FileManager {
  // 下载文件
  downloadBlob(blob: Blob, filename: string): void
  
  // 生成文件名
  generateFilename(prefix: string, extension: string): string
  
  // 清理临时文件
  cleanup(): void
}
```

## 数据模型

### 录制会话数据
```javascript
interface RecordingSession {
  id: string
  startTime: number
  endTime?: number
  originalVideo?: Blob
  processedVideo?: Blob
  backgroundConfig?: BackgroundConfig
  status: 'recording' | 'processing' | 'complete' | 'error'
}
```

### 预设背景配置
```javascript
const PRESET_BACKGROUNDS: BackgroundConfig[] = [
  { type: 'solid-color', color: '#ffffff', padding: 20, videoPosition: 'center' },
  { type: 'solid-color', color: '#f8f9fa', padding: 20, videoPosition: 'center' },
  { type: 'solid-color', color: '#e9ecef', padding: 20, videoPosition: 'center' },
  { type: 'solid-color', color: '#1a1a1a', padding: 20, videoPosition: 'center' },
  { type: 'solid-color', color: '#0066cc', padding: 20, videoPosition: 'center' }
]
```

## 错误处理

### 错误类型定义
```javascript
enum ErrorType {
  PERMISSION_DENIED = 'permission_denied',
  RECORDING_FAILED = 'recording_failed',
  PROCESSING_FAILED = 'processing_failed',
  DOWNLOAD_FAILED = 'download_failed'
}

interface AppError {
  type: ErrorType
  message: string
  details?: any
}
```

### 错误处理策略
1. **权限错误**: 显示权限请求指导
2. **录制错误**: 提供重试选项，清理资源
3. **处理错误**: 保留原始视频，提供下载选项
4. **下载错误**: 提供手动保存选项

## 测试策略

### 单元测试
- VideoRecorder模块的录制功能
- BackgroundProcessor的视频处理逻辑
- FileManager的文件操作
- PopupController的状态管理

### 集成测试
- 完整的录制到下载流程
- 不同背景配置的应用效果
- 错误场景的处理流程

### 手动测试
- 不同网站的录制兼容性
- 各种屏幕分辨率的适配
- Chrome不同版本的兼容性

## 性能考虑

### 内存管理
- 及时释放MediaRecorder资源
- 限制录制时长（最大5分钟）
- 使用Web Workers处理视频数据

### 文件大小优化
- 使用WebM格式（较小文件大小）
- 限制录制分辨率（最大1080p）
- 压缩处理后的视频

### 用户体验
- 显示处理进度
- 异步处理避免界面卡顿
- 提供取消操作选项