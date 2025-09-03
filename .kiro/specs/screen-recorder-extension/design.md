# 设计文档

## 概述

本设计文档描述了使用 SvelteKit 和 Svelte5 构建的 Chrome 屏幕录制扩展的技术架构。该扩展将通过 Chrome sidepanel 提供屏幕录制功能，使用 Manifest V3 标准，并将所有 UI 组件构建为 TypeScript 静态页面。

## 架构

### 整体架构图

```mermaid
graph TB
    A[Chrome Sidepanel UI] --> B[Service Worker]
    B --> C[chrome.desktopCapture API]
    B --> D[chrome.storage API]
    
    A --> E[录制控制器 - 主线程]
    E --> F[WebCodecs Worker]
    E --> G[MediaRecorder Worker]
    E --> H[文件处理 Worker]
    
    subgraph "WebCodecs Worker"
        F --> I[MediaStreamTrackProcessor]
        I --> J[VideoEncoder]
        J --> K[编码块缓冲]
        K --> L[WebM 容器写入]
    end
    
    subgraph "MediaRecorder Worker"
        G --> M[MediaRecorder API]
        M --> N[数据块收集]
        N --> O[Blob 组装]
    end
    
    subgraph "文件处理 Worker"
        H --> P[视频后处理]
        P --> Q[文件压缩]
        Q --> R[元数据写入]
    end
    
    L --> S[主线程消息传递]
    O --> S
    R --> S
    S --> T[chrome.downloads API]
    
    subgraph "SvelteKit + TypeScript 构建"
        U[Svelte 组件 (.svelte)] --> V[TypeScript 逻辑 (.ts)]
        V --> W[静态 HTML/CSS/JS]
        W --> A
    end
    
    subgraph "UI 响应性保证"
        A --> X[状态更新 - 非阻塞]
        X --> Y[进度显示 - 实时]
        Y --> Z[用户交互 - 流畅]
    end
```

### 技术栈

- **前端框架**: SvelteKit + Svelte5 + TypeScript
- **构建输出**: 静态页面 (Static Site Generation)
- **Chrome 扩展**: Manifest V3
- **录制技术**: WebCodecs API (主要) + MediaRecorder API (降级)
- **视频编码**: VideoEncoder + MediaStreamTrackProcessor
- **权限管理**: chrome.desktopCapture.chooseDesktopMedia()
- **文件管理**: chrome.downloads API
- **数据存储**: chrome.storage.local API
- **性能优化**: Web Workers + OffscreenCanvas

## 组件和接口

### 1. SvelteKit + TypeScript 项目结构

```
src/
├── app.html                 # 应用模板
├── routes/
│   ├── sidepanel/
│   │   └── +page.svelte    # Sidepanel 主页面
│   └── popup/
│       └── +page.svelte    # Popup 页面（可选）
├── lib/
│   ├── components/
│   │   ├── RecordButton.svelte
│   │   ├── StatusIndicator.svelte
│   │   ├── ProgressBar.svelte
│   │   └── VideoPreview.svelte
│   ├── stores/
│   │   └── recording.ts    # 录制状态管理
│   ├── types/
│   │   ├── chrome.d.ts     # Chrome API 类型定义
│   │   ├── recording.d.ts  # 录制相关类型
│   │   └── worker.d.ts     # Worker 消息类型
│   ├── utils/
│   │   ├── recorder.ts     # 录制控制器（主线程）
│   │   ├── chrome-api.ts   # Chrome API 封装
│   │   └── worker-manager.ts # Worker 管理器
│   └── workers/
│       ├── webcodecs-worker.ts    # WebCodecs 编码 Worker
│       ├── mediarecorder-worker.ts # MediaRecorder Worker
│       └── file-processor-worker.ts # 文件处理 Worker
└── static/
    ├── manifest.json
    ├── background.js
    ├── workers/              # 编译后的 Worker 文件
    │   ├── webcodecs-worker.js
    │   ├── mediarecorder-worker.js
    │   └── file-processor-worker.js
    └── assets/
```

### 2. TypeScript 类型定义

#### Chrome API 类型
```typescript
// lib/types/chrome.d.ts
declare namespace chrome {
  namespace desktopCapture {
    type DesktopCaptureSourceType = 'screen' | 'window' | 'tab' | 'audio'
    
    interface ChooseDesktopMediaOptions {
      sources: DesktopCaptureSourceType[]
      targetTab?: chrome.tabs.Tab
    }
    
    function chooseDesktopMedia(
      sources: DesktopCaptureSourceType[],
      callback: (streamId: string, options: { canRequestAudioTrack: boolean }) => void
    ): number
    
    function cancelChooseDesktopMedia(desktopMediaRequestId: number): void
  }
  
  namespace sidePanel {
    interface OpenOptions {
      tabId?: number
      windowId?: number
    }
    
    function open(options: OpenOptions): Promise<void>
  }
}
```

#### 录制状态类型
```typescript
// lib/types/recording.d.ts
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
```

#### Worker 消息类型
```typescript
// lib/types/worker.d.ts
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
```

### 3. 核心组件接口

#### 录制引擎接口
```typescript
// lib/types/recording.d.ts
export interface IRecordingEngine {
  start(stream: MediaStream): Promise<void>
  stop(): Promise<Blob>
  getStatus(): RecordingStatus
  getDuration(): number
  cleanup(): void
  onProgress?: (chunks: number) => void
}

// lib/utils/recorder.ts
export class ScreenRecorder {
  private engine: IRecordingEngine | null = null
  private stream: MediaStream | null = null
  private startTime: number | null = null
  private status: RecordingStatus = 'idle'
  
  constructor(private options: RecordingOptions) {}
  
  async requestScreenCapture(): Promise<string>
  async startRecording(): Promise<void>
  async stopRecording(): Promise<Blob>
  getStatus(): RecordingStatus
  getDuration(): number
  cleanup(): void
  
  private async selectBestEngine(): Promise<IRecordingEngine>
  private async detectCapabilities(): Promise<WebCodecsCapabilities>
}
```

#### ChromeAPIWrapper 类
```typescript
// lib/utils/chrome-api.ts
export class ChromeAPIWrapper {
  static async requestDesktopCapture(
    sources: chrome.desktopCapture.DesktopCaptureSourceType[] = ['screen', 'window', 'tab']
  ): Promise<string>
  
  static async getUserMediaFromStreamId(streamId: string): Promise<MediaStream>
  
  static async saveVideo(blob: Blob, filename: string): Promise<void>
  
  static async getStorageData<T>(key: string): Promise<T | null>
  
  static async setStorageData<T>(key: string, value: T): Promise<void>
  
  static async openSidePanel(tabId?: number): Promise<void>
}
```

### 4. Sidepanel 组件设计

#### 主界面组件 (Sidepanel.svelte)
```svelte
<script lang="ts">
  import { recordingStore } from '$lib/stores/recording'
  import RecordButton from '$lib/components/RecordButton.svelte'
  import StatusIndicator from '$lib/components/StatusIndicator.svelte'
  import VideoPreview from '$lib/components/VideoPreview.svelte'
  import type { RecordingState } from '$lib/types/recording'
  
  $: state = $recordingStore as RecordingState
</script>

<div class="sidepanel-container">
  <StatusIndicator status={state.status} duration={state.duration} />
  <RecordButton 
    isRecording={state.isRecording} 
    disabled={state.status === 'requesting' || state.status === 'stopping'} 
  />
  {#if state.videoBlob}
    <VideoPreview blob={state.videoBlob} />
  {/if}
  {#if state.error}
    <div class="error-message">{state.error}</div>
  {/if}
</div>

<style>
  .sidepanel-container {
    padding: 16px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  .error-message {
    color: #ef4444;
    background: #fef2f2;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid #fecaca;
  }
</style>
```

## 数据模型

### 录制会话数据
```typescript
interface RecordingSession {
  id: string
  startTime: number
  endTime?: number
  duration: number
  filename: string
  fileSize: number
  status: 'recording' | 'completed' | 'failed'
  streamId?: string
  mimeType: string
}
```

### 用户设置
```typescript
interface UserSettings {
  videoQuality: 'high' | 'medium' | 'low'
  audioEnabled: boolean
  autoDownload: boolean
  filenameTemplate: string
  maxDuration: number
  preferredSources: chrome.desktopCapture.DesktopCaptureSourceType[]
}
```

## 错误处理

### 错误类型定义
```typescript
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
```

### 错误处理策略
1. **权限错误**: 显示权限请求指导
2. **媒体错误**: 提供浏览器兼容性信息
3. **录制错误**: 重试机制和降级方案
4. **保存错误**: 手动下载备选方案

## 测试策略

### 单元测试
- Svelte 组件测试 (使用 @testing-library/svelte)
- 录制逻辑测试 (使用 Vitest)
- Chrome API 封装测试

### 集成测试
- 端到端录制流程测试
- 权限处理测试
- 文件保存测试

### 浏览器兼容性测试
- Chrome 88+ 版本测试
- 不同操作系统测试
- 权限场景测试

## 实现细节

### 1. SvelteKit + TypeScript 配置

#### svelte.config.js
```javascript
import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: null,
      precompress: false,
      strict: true
    }),
    paths: {
      base: '',
      relative: false
    },
    prerender: {
      entries: ['/sidepanel', '/popup']
    }
  }
}
```

#### tsconfig.json
```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "types": ["chrome"]
  }
}
```

### 2. Manifest V3 配置

```json
{
  "manifest_version": 3,
  "name": "屏幕录制扩展",
  "version": "1.0.0",
  "description": "通过 sidepanel 进行屏幕录制的 Chrome 扩展",
  "permissions": [
    "desktopCapture",
    "downloads",
    "storage",
    "sidePanel",
    "activeTab"
  ],
  "side_panel": {
    "default_path": "sidepanel/index.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_title": "打开录制面板"
  },
  "icons": {
    "16": "assets/icon16.png",
    "48": "assets/icon48.png",
    "128": "assets/icon128.png"
  },
  "minimum_chrome_version": "116"
}
```

### 3. Service Worker 实现

```typescript
// background.js (编译后的 TypeScript)
chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id })
  }
})

chrome.runtime.onMessage.addListener((
  message: any, 
  sender: chrome.runtime.MessageSender, 
  sendResponse: (response: any) => void
) => {
  if (message.action === 'requestScreenCapture') {
    const sources: chrome.desktopCapture.DesktopCaptureSourceType[] = 
      message.sources || ['screen', 'window', 'tab']
    
    const requestId = chrome.desktopCapture.chooseDesktopMedia(
      sources,
      (streamId: string, options: { canRequestAudioTrack: boolean }) => {
        sendResponse({ 
          streamId, 
          canRequestAudioTrack: options.canRequestAudioTrack 
        })
      }
    )
    
    // 处理取消情况
    if (!requestId) {
      sendResponse({ error: 'DESKTOP_CAPTURE_CANCELLED' })
    }
    
    return true // 保持消息通道开放
  }
})
```

### 4. WebCodecs 录制引擎

```typescript
// lib/utils/webcodecs-recorder.ts
import type { IRecordingEngine, RecordingOptions, RecordingStatus } from '$lib/types/recording'

export class WebCodecsRecorder implements IRecordingEngine {
  private videoEncoder: VideoEncoder | null = null
  private trackProcessor: MediaStreamTrackProcessor | null = null
  private worker: Worker | null = null
  private encodedChunks: Uint8Array[] = []
  private startTime: number | null = null
  private status: RecordingStatus = 'idle'
  
  constructor(private options: RecordingOptions) {}

  async start(stream: MediaStream): Promise<void> {
    try {
      this.status = 'recording'
      this.startTime = Date.now()
      
      // 获取视频轨道
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) {
        throw new Error('No video track found')
      }

      // 创建 MediaStreamTrackProcessor
      this.trackProcessor = new MediaStreamTrackProcessor({ track: videoTrack })
      
      // 创建 Web Worker 进行编码
      this.worker = new Worker('/encode-worker.js')
      
      // 配置 VideoEncoder
      await this.setupVideoEncoder()
      
      // 开始处理视频帧
      await this.processVideoFrames()
      
    } catch (error) {
      this.status = 'error'
      throw error
    }
  }

  private async setupVideoEncoder(): Promise<void> {
    const config = this.getEncoderConfig()
    
    // 检查编码器支持
    const support = await VideoEncoder.isConfigSupported(config)
    if (!support.supported) {
      throw new Error('VideoEncoder configuration not supported')
    }

    this.videoEncoder = new VideoEncoder({
      output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
        this.handleEncodedChunk(chunk, metadata)
      },
      error: (error: Error) => {
        console.error('VideoEncoder error:', error)
        this.status = 'error'
      }
    })

    await this.videoEncoder.configure(config)
  }

  private getEncoderConfig(): VideoEncoderConfig {
    const bitrateMap = {
      high: 15000000,   // 15 Mbps
      medium: 8000000,  // 8 Mbps  
      low: 4000000      // 4 Mbps
    }

    return {
      codec: this.getCodecString(),
      width: 1920,
      height: 1080,
      bitrate: this.options.bitrate || bitrateMap[this.options.videoQuality],
      framerate: this.options.framerate || 30,
      latencyMode: 'realtime',
      bitrateMode: 'variable'
    }
  }

  private getCodecString(): string {
    const codecMap = {
      vp9: 'vp09.00.10.08',
      vp8: 'vp8',
      av1: 'av01.0.01M.08',
      h264: 'avc1.42001e'
    }
    return codecMap[this.options.codec] || codecMap.vp9
  }

  private async processVideoFrames(): Promise<void> {
    if (!this.trackProcessor || !this.videoEncoder) return

    const reader = this.trackProcessor.readable.getReader()
    
    const processFrame = async (): Promise<void> => {
      try {
        const { done, value } = await reader.read()
        
        if (done || this.status !== 'recording') {
          return
        }

        // 编码视频帧
        this.videoEncoder!.encode(value as VideoFrame)
        
        // 释放帧资源
        (value as VideoFrame).close()
        
        // 继续处理下一帧
        processFrame()
        
      } catch (error) {
        console.error('Frame processing error:', error)
        this.status = 'error'
      }
    }

    processFrame()
  }

  private handleEncodedChunk(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    // 将编码块转换为 Uint8Array
    const chunkData = new Uint8Array(chunk.byteLength)
    chunk.copyTo(chunkData)
    
    this.encodedChunks.push(chunkData)
    
    // 通知进度
    if (this.onProgress) {
      this.onProgress(this.encodedChunks.length)
    }
  }

  async stop(): Promise<Blob> {
    try {
      this.status = 'stopping'
      
      // 刷新编码器
      if (this.videoEncoder) {
        await this.videoEncoder.flush()
        this.videoEncoder.close()
      }
      
      // 组装最终视频文件
      const videoBlob = await this.assembleVideo()
      
      this.cleanup()
      this.status = 'completed'
      
      return videoBlob
      
    } catch (error) {
      this.status = 'error'
      throw error
    }
  }

  private async assembleVideo(): Promise<Blob> {
    // 使用 WebM 容器格式组装编码块
    // 这里需要实现 WebM 容器的写入逻辑
    // 或者使用现有的库如 webm-writer
    
    const totalSize = this.encodedChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combinedData = new Uint8Array(totalSize)
    
    let offset = 0
    for (const chunk of this.encodedChunks) {
      combinedData.set(chunk, offset)
      offset += chunk.length
    }
    
    return new Blob([combinedData], { type: 'video/webm' })
  }

  getStatus(): RecordingStatus {
    return this.status
  }

  getDuration(): number {
    if (!this.startTime) return 0
    return Math.floor((Date.now() - this.startTime) / 1000)
  }

  cleanup(): void {
    if (this.videoEncoder) {
      this.videoEncoder.close()
      this.videoEncoder = null
    }
    
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    
    this.trackProcessor = null
    this.encodedChunks = []
    this.startTime = null
    this.status = 'idle'
  }

  onProgress?: (chunks: number) => void
}
```

### 5. MediaRecorder 降级引擎

```typescript
// lib/utils/mediarecorder-recorder.ts
import type { IRecordingEngine, RecordingOptions, RecordingStatus } from '$lib/types/recording'

export class MediaRecorderEngine implements IRecordingEngine {
  private mediaRecorder: MediaRecorder | null = null
  private recordedChunks: Blob[] = []
  private startTime: number | null = null
  private status: RecordingStatus = 'idle'

  constructor(private options: RecordingOptions) {}

  async start(stream: MediaStream): Promise<void> {
    try {
      this.status = 'recording'
      this.startTime = Date.now()

      const mimeType = this.getSupportedMimeType()
      if (!mimeType) {
        throw new Error('No supported MIME type found')
      }

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: this.getVideoBitrate()
      })

      this.setupRecorderEvents()
      this.mediaRecorder.start(1000)
      
    } catch (error) {
      this.status = 'error'
      throw error
    }
  }

  private setupRecorderEvents(): void {
    if (!this.mediaRecorder) return

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.recordedChunks.push(event.data)
        
        if (this.onProgress) {
          this.onProgress(this.recordedChunks.length)
        }
      }
    }

    this.mediaRecorder.onerror = (event: Event) => {
      this.status = 'error'
      console.error('MediaRecorder error:', event)
    }
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.status !== 'recording') {
        reject(new Error('Recording not active'))
        return
      }

      this.status = 'stopping'
      
      this.mediaRecorder.onstop = () => {
        try {
          const mimeType = this.mediaRecorder?.mimeType || 'video/webm'
          const blob = new Blob(this.recordedChunks, { type: mimeType })
          this.cleanup()
          this.status = 'completed'
          resolve(blob)
        } catch (error) {
          this.status = 'error'
          reject(error)
        }
      }
      
      this.mediaRecorder.stop()
    })
  }

  private getSupportedMimeType(): string | null {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8', 
      'video/webm',
      'video/mp4'
    ]
    
    return types.find(type => MediaRecorder.isTypeSupported(type)) || null
  }

  private getVideoBitrate(): number {
    const bitrateMap = {
      high: 15000000,
      medium: 8000000,
      low: 4000000
    }
    return bitrateMap[this.options.videoQuality]
  }

  getStatus(): RecordingStatus {
    return this.status
  }

  getDuration(): number {
    if (!this.startTime) return 0
    return Math.floor((Date.now() - this.startTime) / 1000)
  }

  cleanup(): void {
    this.recordedChunks = []
    this.mediaRecorder = null
    this.startTime = null
    this.status = 'idle'
  }

  onProgress?: (chunks: number) => void
}
```

### 6. 录制控制器（主线程 - 非阻塞）

```typescript
// lib/utils/recorder.ts
import { WorkerManager } from './worker-manager'
import { ChromeAPIWrapper } from './chrome-api'
import type { RecordingOptions, RecordingStatus, RecordingProgress, WebCodecsCapabilities } from '$lib/types/recording'
import type { WebCodecsWorkerMessage, MediaRecorderWorkerMessage } from '$lib/types/worker'
import { RecordingError } from '$lib/types/recording'

export class ScreenRecorder {
  private workerManager: WorkerManager
  private stream: MediaStream | null = null
  private startTime: number | null = null
  private status: RecordingStatus = 'idle'
  private progress: RecordingProgress = {
    encodedChunks: 0,
    processedFrames: 0,
    fileSize: 0,
    fps: 0,
    bitrate: 0,
    cpuUsage: 0
  }
  
  constructor(private options: RecordingOptions) {
    this.workerManager = new WorkerManager()
  }

  async requestScreenCapture(): Promise<string> {
    try {
      const sources: chrome.desktopCapture.DesktopCaptureSourceType[] = 
        this.options.includeAudio ? ['screen', 'window', 'tab', 'audio'] : ['screen', 'window', 'tab']
      
      return await ChromeAPIWrapper.requestDesktopCapture(sources)
    } catch (error) {
      throw new Error(RecordingError.PERMISSION_DENIED)
    }
  }

  async startRecording(): Promise<void> {
    try {
      this.status = 'requesting'
      
      // 请求屏幕捕获权限（非阻塞）
      const streamId = await this.requestScreenCapture()
      
      if (!streamId) {
        throw new Error(RecordingError.DESKTOP_CAPTURE_CANCELLED)
      }
      
      // 获取媒体流（非阻塞）
      this.stream = await ChromeAPIWrapper.getUserMediaFromStreamId(streamId)
      
      if (!this.stream) {
        throw new Error(RecordingError.STREAM_INVALID)
      }

      // 检测能力并选择引擎（非阻塞）
      const capabilities = await this.detectCapabilities()
      const useWebCodecs = capabilities.supported && 
                          capabilities.workerSupport && 
                          this.options.preferredEngine === 'webcodecs'

      // 启动 Worker 进行录制（CPU 密集型任务转移到 Worker）
      if (useWebCodecs) {
        await this.startWebCodecsRecording()
      } else {
        await this.startMediaRecorderRecording()
      }
      
      this.status = 'recording'
      this.startTime = Date.now()
      
      // 启动进度监控（非阻塞）
      this.startProgressMonitoring()
      
    } catch (error) {
      this.status = 'error'
      throw error
    }
  }

  private async startWebCodecsRecording(): Promise<void> {
    const config = this.getEncoderConfig()
    
    // 将流传输到 WebCodecs Worker（避免主线程阻塞）
    await this.workerManager.sendToWebCodecsWorker({
      id: crypto.randomUUID(),
      type: 'start',
      payload: {
        config,
        stream: this.stream
      }
    })

    // 监听 Worker 消息（非阻塞）
    this.workerManager.onWebCodecsMessage((message: WebCodecsWorkerMessage) => {
      this.handleWorkerMessage(message)
    })
  }

  private async startMediaRecorderRecording(): Promise<void> {
    const options = {
      mimeType: this.getSupportedMimeType(),
      videoBitsPerSecond: this.getVideoBitrate()
    }

    // 将流传输到 MediaRecorder Worker（避免主线程阻塞）
    await this.workerManager.sendToMediaRecorderWorker({
      id: crypto.randomUUID(),
      type: 'start',
      payload: {
        stream: this.stream,
        options
      }
    })

    // 监听 Worker 消息（非阻塞）
    this.workerManager.onMediaRecorderMessage((message: MediaRecorderWorkerMessage) => {
      this.handleWorkerMessage(message)
    })
  }

  private handleWorkerMessage(message: WebCodecsWorkerMessage | MediaRecorderWorkerMessage): void {
    switch (message.type) {
      case 'progress':
        // 更新进度（非阻塞 UI 更新）
        this.progress = { ...this.progress, ...message.payload.progress }
        this.notifyProgressUpdate()
        break
        
      case 'error':
        this.status = 'error'
        console.error('Worker error:', message.payload.error)
        break
        
      case 'complete':
        this.status = 'completed'
        break
    }
  }

  private startProgressMonitoring(): void {
    // 使用 requestIdleCallback 在浏览器空闲时更新进度
    const updateProgress = () => {
      if (this.status === 'recording') {
        // CPU 使用率监控（轻量级）
        this.monitorCPUUsage()
        
        // 调度下次更新（非阻塞）
        requestIdleCallback(updateProgress)
      }
    }
    
    requestIdleCallback(updateProgress)
  }

  private monitorCPUUsage(): void {
    // 轻量级 CPU 监控，不阻塞主线程
    const start = performance.now()
    
    // 使用 MessageChannel 测量主线程响应时间
    const channel = new MessageChannel()
    channel.port2.onmessage = () => {
      const elapsed = performance.now() - start
      // 简单的 CPU 使用率估算
      this.progress.cpuUsage = Math.min(100, elapsed * 10)
    }
    
    channel.port1.postMessage(null)
  }

  private notifyProgressUpdate(): void {
    // 使用自定义事件通知 UI 更新（非阻塞）
    const event = new CustomEvent('recordingProgress', {
      detail: {
        progress: this.progress,
        duration: this.getDuration()
      }
    })
    
    window.dispatchEvent(event)
  }

  async stopRecording(): Promise<Blob> {
    if (this.status !== 'recording') {
      throw new Error(RecordingError.RECORDING_FAILED)
    }

    this.status = 'stopping'
    
    try {
      // 停止 Worker 录制（非阻塞）
      const result = await this.workerManager.stopCurrentRecording()
      
      // 可选：文件后处理（在 Worker 中进行）
      const processedBlob = await this.postProcessVideo(result)
      
      this.cleanup()
      this.status = 'completed'
      
      return processedBlob
      
    } catch (error) {
      this.status = 'error'
      throw error
    }
  }

  private async postProcessVideo(blob: Blob): Promise<Blob> {
    // 如果需要后处理，在 Worker 中进行（避免阻塞主线程）
    if (this.options.videoQuality === 'high') {
      return await this.workerManager.processFile(blob, {
        compress: false,
        quality: 1.0,
        addMetadata: true,
        metadata: {
          timestamp: this.startTime!,
          duration: this.getDuration(),
          resolution: { width: 1920, height: 1080 },
          codec: this.options.codec,
          bitrate: this.getVideoBitrate()
        }
      })
    }
    
    return blob
  }

  private async detectCapabilities(): Promise<WebCodecsCapabilities> {
    // 能力检测在主线程进行，但使用异步方式避免阻塞
    return new Promise((resolve) => {
      const capabilities: WebCodecsCapabilities = {
        supported: false,
        vp9: false,
        vp8: false,
        av1: false,
        h264: false,
        hardwareAcceleration: false,
        workerSupport: false
      }

      // 使用 setTimeout 避免阻塞 UI
      setTimeout(async () => {
        try {
          // 检查 WebCodecs 基础支持
          if (typeof VideoEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') {
            resolve(capabilities)
            return
          }

          capabilities.supported = true
          capabilities.workerSupport = typeof Worker !== 'undefined'

          // 异步检查编码器支持
          const configs = [
            { codec: 'vp09.00.10.08', key: 'vp9' },
            { codec: 'vp8', key: 'vp8' },
            { codec: 'av01.0.01M.08', key: 'av1' },
            { codec: 'avc1.42001e', key: 'h264' }
          ]

          const results = await Promise.all(
            configs.map(async ({ codec, key }) => {
              try {
                const config = { codec, width: 1920, height: 1080, bitrate: 1000000, framerate: 30 }
                const support = await VideoEncoder.isConfigSupported(config)
                return { key, supported: support.supported }
              } catch {
                return { key, supported: false }
              }
            })
          )

          results.forEach(({ key, supported }) => {
            capabilities[key as keyof WebCodecsCapabilities] = supported
          })

          capabilities.hardwareAcceleration = !!navigator.gpu

          resolve(capabilities)
          
        } catch (error) {
          console.warn('Error detecting WebCodecs capabilities:', error)
          resolve(capabilities)
        }
      }, 0)
    })
  }

  // 其他辅助方法保持不变...
  private getEncoderConfig(): VideoEncoderConfig {
    const bitrateMap = {
      high: 15000000,
      medium: 8000000,
      low: 4000000
    }

    return {
      codec: this.getCodecString(),
      width: 1920,
      height: 1080,
      bitrate: this.options.bitrate || bitrateMap[this.options.videoQuality],
      framerate: this.options.framerate || 30,
      latencyMode: 'realtime',
      bitrateMode: 'variable'
    }
  }

  private getCodecString(): string {
    const codecMap = {
      vp9: 'vp09.00.10.08',
      vp8: 'vp8',
      av1: 'av01.0.01M.08',
      h264: 'avc1.42001e'
    }
    return codecMap[this.options.codec] || codecMap.vp9
  }

  private getSupportedMimeType(): string | null {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4'
    ]
    
    return types.find(type => MediaRecorder.isTypeSupported(type)) || null
  }

  private getVideoBitrate(): number {
    const bitrateMap = {
      high: 15000000,
      medium: 8000000,
      low: 4000000
    }
    return bitrateMap[this.options.videoQuality]
  }

  getStatus(): RecordingStatus {
    return this.status
  }

  getDuration(): number {
    if (!this.startTime) return 0
    return Math.floor((Date.now() - this.startTime) / 1000)
  }

  getProgress(): RecordingProgress {
    return this.progress
  }

  cleanup(): void {
    // 清理 Workers（非阻塞）
    this.workerManager.cleanup()
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    
    this.startTime = null
    this.status = 'idle'
    this.progress = {
      encodedChunks: 0,
      processedFrames: 0,
      fileSize: 0,
      fps: 0,
      bitrate: 0,
      cpuUsage: 0
    }
  }
}
```

### 7. Worker 管理器（主线程协调）

```typescript
// lib/utils/worker-manager.ts
import type { 
  WebCodecsWorkerMessage, 
  MediaRecorderWorkerMessage, 
  FileProcessorWorkerMessage,
  FileProcessingOptions 
} from '$lib/types/worker'

export class WorkerManager {
  private webCodecsWorker: Worker | null = null
  private mediaRecorderWorker: Worker | null = null
  private fileProcessorWorker: Worker | null = null
  private messageHandlers = new Map<string, (message: any) => void>()
  private pendingMessages = new Map<string, { resolve: Function; reject: Function }>()

  constructor() {
    this.initializeWorkers()
  }

  private initializeWorkers(): void {
    // 延迟加载 Workers，避免启动时阻塞
    requestIdleCallback(() => {
      this.webCodecsWorker = new Worker('/workers/webcodecs-worker.js')
      this.mediaRecorderWorker = new Worker('/workers/mediarecorder-worker.js')
      this.fileProcessorWorker = new Worker('/workers/file-processor-worker.js')

      // 设置消息处理（非阻塞）
      this.setupWorkerMessageHandling()
    })
  }

  private setupWorkerMessageHandling(): void {
    // WebCodecs Worker 消息处理
    if (this.webCodecsWorker) {
      this.webCodecsWorker.onmessage = (event) => {
        this.handleWorkerMessage('webcodecs', event.data)
      }
    }

    // MediaRecorder Worker 消息处理
    if (this.mediaRecorderWorker) {
      this.mediaRecorderWorker.onmessage = (event) => {
        this.handleWorkerMessage('mediarecorder', event.data)
      }
    }

    // File Processor Worker 消息处理
    if (this.fileProcessorWorker) {
      this.fileProcessorWorker.onmessage = (event) => {
        this.handleWorkerMessage('fileprocessor', event.data)
      }
    }
  }

  private handleWorkerMessage(workerType: string, message: any): void {
    const { id, type, payload } = message

    // 处理 Promise 响应
    if (this.pendingMessages.has(id)) {
      const { resolve, reject } = this.pendingMessages.get(id)!
      this.pendingMessages.delete(id)

      if (type === 'error') {
        reject(new Error(payload.error))
      } else {
        resolve(payload)
      }
      return
    }

    // 处理事件监听器
    const handlerKey = `${workerType}-${type}`
    const handler = this.messageHandlers.get(handlerKey)
    if (handler) {
      // 使用 setTimeout 确保处理器不阻塞主线程
      setTimeout(() => handler(message), 0)
    }
  }

  async sendToWebCodecsWorker(message: WebCodecsWorkerMessage): Promise<any> {
    if (!this.webCodecsWorker) {
      throw new Error('WebCodecs worker not initialized')
    }

    return this.sendWorkerMessage(this.webCodecsWorker, message)
  }

  async sendToMediaRecorderWorker(message: MediaRecorderWorkerMessage): Promise<any> {
    if (!this.mediaRecorderWorker) {
      throw new Error('MediaRecorder worker not initialized')
    }

    return this.sendWorkerMessage(this.mediaRecorderWorker, message)
  }

  async sendToFileProcessorWorker(message: FileProcessorWorkerMessage): Promise<any> {
    if (!this.fileProcessorWorker) {
      throw new Error('File processor worker not initialized')
    }

    return this.sendWorkerMessage(this.fileProcessorWorker, message)
  }

  private sendWorkerMessage(worker: Worker, message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // 存储 Promise 处理器
      this.pendingMessages.set(message.id, { resolve, reject })

      // 发送消息到 Worker（非阻塞）
      worker.postMessage(message)

      // 设置超时
      setTimeout(() => {
        if (this.pendingMessages.has(message.id)) {
          this.pendingMessages.delete(message.id)
          reject(new Error('Worker message timeout'))
        }
      }, 30000) // 30秒超时
    })
  }

  onWebCodecsMessage(handler: (message: WebCodecsWorkerMessage) => void): void {
    this.messageHandlers.set('webcodecs-progress', handler)
    this.messageHandlers.set('webcodecs-error', handler)
    this.messageHandlers.set('webcodecs-complete', handler)
  }

  onMediaRecorderMessage(handler: (message: MediaRecorderWorkerMessage) => void): void {
    this.messageHandlers.set('mediarecorder-progress', handler)
    this.messageHandlers.set('mediarecorder-error', handler)
    this.messageHandlers.set('mediarecorder-complete', handler)
  }

  async stopCurrentRecording(): Promise<Blob> {
    // 尝试停止当前活动的录制 Worker
    const stopMessage = {
      id: crypto.randomUUID(),
      type: 'stop',
      payload: {}
    }

    try {
      // 尝试 WebCodecs Worker
      if (this.webCodecsWorker) {
        const result = await this.sendWorkerMessage(this.webCodecsWorker, stopMessage)
        if (result.result) return result.result
      }

      // 尝试 MediaRecorder Worker
      if (this.mediaRecorderWorker) {
        const result = await this.sendWorkerMessage(this.mediaRecorderWorker, stopMessage)
        if (result.result) return result.result
      }

      throw new Error('No active recording found')
    } catch (error) {
      throw new Error(`Failed to stop recording: ${error.message}`)
    }
  }

  async processFile(blob: Blob, options: FileProcessingOptions): Promise<Blob> {
    const message: FileProcessorWorkerMessage = {
      id: crypto.randomUUID(),
      type: 'process',
      payload: {
        file: blob,
        options
      }
    }

    const result = await this.sendToFileProcessorWorker(message)
    return result.result
  }

  cleanup(): void {
    // 清理所有 Workers（非阻塞）
    setTimeout(() => {
      if (this.webCodecsWorker) {
        this.webCodecsWorker.terminate()
        this.webCodecsWorker = null
      }

      if (this.mediaRecorderWorker) {
        this.mediaRecorderWorker.terminate()
        this.mediaRecorderWorker = null
      }

      if (this.fileProcessorWorker) {
        this.fileProcessorWorker.terminate()
        this.fileProcessorWorker = null
      }

      // 清理待处理的消息
      this.pendingMessages.clear()
      this.messageHandlers.clear()
    }, 0)
  }
}
```

### 8. WebCodecs Worker（CPU 密集型任务）

```typescript
// lib/workers/webcodecs-worker.ts
class WebCodecsWorker {
  private videoEncoder: VideoEncoder | null = null
  private trackProcessor: MediaStreamTrackProcessor | null = null
  private encodedChunks: Uint8Array[] = []
  private frameCount = 0
  private startTime = 0
  private lastProgressTime = 0

  async handleStart(config: VideoEncoderConfig, stream: MediaStream): Promise<void> {
    try {
      this.startTime = performance.now()
      
      // 获取视频轨道
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) {
        throw new Error('No video track found')
      }

      // 创建 MediaStreamTrackProcessor（在 Worker 中处理）
      this.trackProcessor = new MediaStreamTrackProcessor({ track: videoTrack })
      
      // 配置 VideoEncoder（CPU 密集型）
      await this.setupVideoEncoder(config)
      
      // 开始处理视频帧（CPU 密集型）
      this.processVideoFrames()
      
    } catch (error) {
      this.sendMessage('error', { error: error.message })
    }
  }

  private async setupVideoEncoder(config: VideoEncoderConfig): Promise<void> {
    this.videoEncoder = new VideoEncoder({
      output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
        this.handleEncodedChunk(chunk, metadata)
      },
      error: (error: Error) => {
        this.sendMessage('error', { error: error.message })
      }
    })

    await this.videoEncoder.configure(config)
  }

  private processVideoFrames(): void {
    if (!this.trackProcessor || !this.videoEncoder) return

    const reader = this.trackProcessor.readable.getReader()
    
    const processFrame = async (): Promise<void> => {
      try {
        const { done, value } = await reader.read()
        
        if (done) {
          this.sendMessage('complete', { result: await this.assembleVideo() })
          return
        }

        // 编码视频帧（CPU 密集型操作在 Worker 中）
        this.videoEncoder!.encode(value as VideoFrame)
        
        // 更新统计信息
        this.frameCount++
        
        // 释放帧资源（重要：避免内存泄漏）
        (value as VideoFrame).close()
        
        // 定期报告进度（避免过于频繁的消息传递）
        const now = performance.now()
        if (now - this.lastProgressTime > 1000) { // 每秒更新一次
          this.reportProgress()
          this.lastProgressTime = now
        }
        
        // 继续处理下一帧（使用 setTimeout 避免阻塞）
        setTimeout(processFrame, 0)
        
      } catch (error) {
        this.sendMessage('error', { error: error.message })
      }
    }

    processFrame()
  }

  private handleEncodedChunk(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    // 将编码块转换为 Uint8Array（CPU 密集型）
    const chunkData = new Uint8Array(chunk.byteLength)
    chunk.copyTo(chunkData)
    
    this.encodedChunks.push(chunkData)
  }

  private reportProgress(): void {
    const elapsed = (performance.now() - this.startTime) / 1000
    const fps = this.frameCount / elapsed
    const fileSize = this.encodedChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    
    this.sendMessage('progress', {
      progress: {
        encodedChunks: this.encodedChunks.length,
        processedFrames: this.frameCount,
        fileSize,
        fps: Math.round(fps),
        bitrate: Math.round((fileSize * 8) / elapsed),
        cpuUsage: 0 // Worker 中无法直接测量主线程 CPU
      }
    })
  }

  private async assembleVideo(): Promise<Blob> {
    // 在 Worker 中组装视频文件（CPU 密集型）
    const totalSize = this.encodedChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const combinedData = new Uint8Array(totalSize)
    
    let offset = 0
    for (const chunk of this.encodedChunks) {
      combinedData.set(chunk, offset)
      offset += chunk.length
    }
    
    return new Blob([combinedData], { type: 'video/webm' })
  }

  async handleStop(): Promise<Blob> {
    try {
      // 刷新编码器（CPU 密集型）
      if (this.videoEncoder) {
        await this.videoEncoder.flush()
        this.videoEncoder.close()
      }
      
      // 组装最终视频文件（CPU 密集型）
      const videoBlob = await this.assembleVideo()
      
      this.cleanup()
      
      return videoBlob
      
    } catch (error) {
      this.sendMessage('error', { error: error.message })
      throw error
    }
  }

  private cleanup(): void {
    if (this.videoEncoder) {
      this.videoEncoder.close()
      this.videoEncoder = null
    }
    
    this.trackProcessor = null
    this.encodedChunks = []
    this.frameCount = 0
  }

  private sendMessage(type: string, payload: any): void {
    self.postMessage({
      id: crypto.randomUUID(),
      type,
      payload
    })
  }
}

// Worker 实例
const worker = new WebCodecsWorker()

// 消息处理（非阻塞）
self.onmessage = async (event) => {
  const { id, type, payload } = event.data
  
  try {
    let result: any
    
    switch (type) {
      case 'start':
        await worker.handleStart(payload.config, payload.stream)
        result = { success: true }
        break
        
      case 'stop':
        result = { result: await worker.handleStop() }
        break
        
      default:
        throw new Error(`Unknown message type: ${type}`)
    }
    
    // 发送响应
    self.postMessage({
      id,
      type: 'response',
      payload: result
    })
    
  } catch (error) {
    // 发送错误响应
    self.postMessage({
      id,
      type: 'error',
      payload: { error: error.message }
    })
  }
}
```

### 8. Chrome API 封装实现

```typescript
// lib/utils/chrome-api.ts
export class ChromeAPIWrapper {
  static async requestDesktopCapture(
    sources: chrome.desktopCapture.DesktopCaptureSourceType[] = ['screen', 'window', 'tab']
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Chrome runtime not available'))
        return
      }

      chrome.runtime.sendMessage(
        { action: 'requestScreenCapture', sources },
        (response: { streamId?: string; error?: string; canRequestAudioTrack?: boolean }) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }
          
          if (response.error) {
            reject(new Error(response.error))
            return
          }
          
          if (!response.streamId) {
            reject(new Error('No stream ID received'))
            return
          }
          
          resolve(response.streamId)
        }
      )
    })
  }

  static async getUserMediaFromStreamId(streamId: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      } as any
    })
  }

  static async saveVideo(blob: Blob, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      
      chrome.downloads.download({
        url,
        filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          URL.revokeObjectURL(url)
          resolve()
        }
      })
    })
  }

  static async getStorageData<T>(key: string): Promise<T | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null)
      })
    })
  }

  static async setStorageData<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve()
        }
      })
    })
  }

  static async openSidePanel(tabId?: number): Promise<void> {
    const options: chrome.sidePanel.OpenOptions = {}
    if (tabId) options.tabId = tabId
    
    return chrome.sidePanel.open(options)
  }
}
```

### 9. 构建和部署

#### package.json
```json
{
  "name": "screen-recorder-extension",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "build:extension": "npm run build && npm run copy:assets",
    "copy:assets": "cp static/manifest.json static/background.js build/ && cp -r static/assets build/",
    "package": "cd build && zip -r ../screen-recorder-extension.zip .",
    "type-check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.0",
    "@sveltejs/kit": "^2.0.0",
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "@types/chrome": "^0.0.268",
    "svelte": "^5.0.0",
    "svelte-check": "^3.6.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

## 性能考虑

### WebCodecs + Worker 性能优势
- **完全非阻塞**: 所有 CPU 密集型任务在 Worker 中执行，主线程保持响应
- **硬件加速编码**: 利用 GPU 进行视频编码，显著降低 CPU 使用率
- **并行处理**: 多个 Worker 并行处理不同任务（编码、文件处理、压缩）
- **内存隔离**: Worker 内存独立，避免主线程内存压力

### 主线程 UI 响应性保证
- **requestIdleCallback**: 利用浏览器空闲时间进行轻量级操作
- **setTimeout(0)**: 将任务分解到下一个事件循环，避免阻塞
- **MessageChannel**: 异步消息传递，测量主线程响应时间
- **自定义事件**: 非阻塞的进度更新通知机制

### Worker 任务分离
- **WebCodecs Worker**: 专门处理视频编码（CPU 密集型）
- **MediaRecorder Worker**: 处理降级录制方案
- **File Processor Worker**: 处理文件后处理、压缩、元数据写入
- **Worker Manager**: 主线程协调器，管理 Worker 生命周期

### 内存管理策略
- **流式处理**: MediaStreamTrackProcessor 流式处理，避免内存积累
- **及时释放**: VideoFrame.close() 立即释放，防止内存泄漏
- **分块传输**: 编码块分批传输，避免大块内存占用
- **Worker 隔离**: 内存密集型操作在 Worker 中，不影响主线程

### 性能监控
- **实时 FPS**: 监控实际编码帧率
- **CPU 使用率**: 轻量级主线程 CPU 监控
- **内存使用**: 跟踪编码块和文件大小
- **比特率监控**: 实时比特率计算和调整

### 错误恢复和降级
- **Worker 错误隔离**: Worker 崩溃不影响主线程
- **自动重试**: Worker 失败时自动重启
- **降级策略**: WebCodecs → MediaRecorder → 基础录制
- **优雅降级**: 保证基本功能在所有环境下可用

### 兼容性和性能平衡
- **能力检测**: 运行时检测并选择最佳方案
- **渐进增强**: 从基础功能到高级性能逐步增强
- **最低保证**: 确保在 Chrome 88+ 上基本功能可用
- **最佳体验**: Chrome 116+ 获得完整 WebCodecs + Worker 体验

## 安全考虑

### 权限最小化
- 只请求必要的权限
- 运行时权限检查
- 用户明确授权

### 数据保护
- 录制数据仅存储在本地
- 不上传到外部服务器
- 用户可控制数据删除

### CSP 策略
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```