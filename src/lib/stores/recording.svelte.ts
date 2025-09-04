// 录制状态管理 - 使用 Svelte 5 runes
import type { RecordingState, RecordingOptions, RecordingProgress } from '../types/recording'

// 默认录制选项
const defaultOptions: RecordingOptions = {
  includeAudio: false,
  videoQuality: 'medium',
  maxDuration: 3600, // 1小时
  preferredEngine: 'mediarecorder',
  codec: 'vp9',
  framerate: 30,
  useWorkers: true
}

// 默认录制状态
const defaultState: RecordingState = {
  isRecording: false,
  duration: 0,
  status: 'idle',
  error: null,
  videoBlob: null,
  startTime: null,
  engine: 'mediarecorder',
  progress: {
    encodedChunks: 0,
    processedFrames: 0,
    encodedFrames: 0,
    fileSize: 0,
    fps: 0,
    bitrate: 0,
    cpuUsage: 0
  }
}

// 创建录制状态 store - 使用 .svelte.ts 文件扩展名
function createRecordingStore() {
  // 在 .svelte.ts 文件中可以直接使用 $state
  let state = $state<RecordingState>({ ...defaultState })
  let options = $state<RecordingOptions>({ ...defaultOptions })

  return {
    // 状态访问器
    get state() {
      return state
    },

    get options() {
      return options
    },

    // 计算属性
    get isIdle() {
      return state.status === 'idle'
    },

    get isRecording() {
      return state.status === 'recording'
    },

    get isProcessing() {
      return state.status === 'requesting' || state.status === 'stopping'
    },

    get hasError() {
      return state.status === 'error'
    },

    get hasVideo() {
      return state.videoBlob !== null
    },

    get formattedDuration() {
      const minutes = Math.floor(state.duration / 60)
      const seconds = state.duration % 60
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    },

    get formattedFileSize() {
      const size = state.progress.fileSize
      if (size < 1024) return `${size} B`
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
      return `${(size / 1024 / 1024).toFixed(1)} MB`
    },

    get formattedBitrate() {
      const bitrate = state.progress.bitrate
      if (bitrate < 1000) return `${bitrate} bps`
      if (bitrate < 1000000) return `${(bitrate / 1000).toFixed(1)} Kbps`
      return `${(bitrate / 1000000).toFixed(1)} Mbps`
    },

    // 状态更新方法
    updateStatus(status: RecordingState['status'], error?: string) {
      state.status = status
      state.error = error || null
      
      if (status === 'recording' && !state.startTime) {
        state.startTime = Date.now()
        state.isRecording = true
      } else if (status === 'completed' || status === 'error') {
        state.isRecording = false
      }
    },

    updateProgress(progress: RecordingProgress) {
      state.progress = { ...progress }
    },

    updateDuration(duration: number) {
      state.duration = duration
    },

    setVideoBlob(blob: Blob | null) {
      state.videoBlob = blob
    },

    setEngine(engine: RecordingState['engine']) {
      state.engine = engine
    },

    // 选项更新方法
    updateOptions(newOptions: Partial<RecordingOptions>) {
      options = { ...options, ...newOptions }
    },

    setVideoQuality(quality: RecordingOptions['videoQuality']) {
      options.videoQuality = quality
    },

    setIncludeAudio(include: boolean) {
      options.includeAudio = include
    },

    setPreferredEngine(engine: RecordingOptions['preferredEngine']) {
      options.preferredEngine = engine
    },

    setCodec(codec: RecordingOptions['codec']) {
      options.codec = codec
    },

    // 重置方法
    reset() {
      state = { ...defaultState }
    },

    resetOptions() {
      options = { ...defaultOptions }
    },

    // 完整重置
    resetAll() {
      state = { ...defaultState }
      options = { ...defaultOptions }
    },

    // 获取状态快照
    getSnapshot() {
      return {
        state: { ...state },
        options: { ...options }
      }
    },

    // 从快照恢复
    restoreFromSnapshot(snapshot: { state: RecordingState; options: RecordingOptions }) {
      state = { ...snapshot.state }
      options = { ...snapshot.options }
    },

    // 导出状态数据
    exportData() {
      return {
        timestamp: new Date().toISOString(),
        state: { ...state },
        options: { ...options },
        summary: {
          duration: this.formattedDuration,
          fileSize: this.formattedFileSize,
          bitrate: this.formattedBitrate,
          fps: state.progress.fps,
          engine: state.engine,
          status: state.status
        }
      }
    }
  }
}

// 创建全局录制状态实例
export const recordingStore = createRecordingStore()

// 导出类型
export type RecordingStore = ReturnType<typeof createRecordingStore>
