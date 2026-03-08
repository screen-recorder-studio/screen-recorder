// 录制功能核心导出
export { recordingService } from './services/recording-service'
export { recordingStore } from './stores/recording.svelte'
export { ScreenRecorder } from './utils/screen-recorder'
export { WorkerManager } from './utils/worker-manager'
export { PerformanceMonitor } from './utils/performance-monitor'
export { ChromeAPIWrapper } from './utils/chrome-api'

// 类型导出
export type * from './types/recording'
export type * from './types/worker'
