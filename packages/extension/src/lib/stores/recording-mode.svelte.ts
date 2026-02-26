// 录制模式全局状态管理 - 使用 Svelte 5 runes
export type RecordingMode = 'element' | 'region' | 'tab' | 'window' | 'screen'

interface RecordingModeState {
  currentMode: RecordingMode
  isSelecting: boolean
  selectedTarget?: string
  isRecording: boolean
}

// 默认状态
const defaultState: RecordingModeState = {
  currentMode: 'region',
  isSelecting: false,
  selectedTarget: undefined,
  isRecording: false
}

// 创建录制模式状态 store
function createRecordingModeStore() {
  let state = $state<RecordingModeState>({ ...defaultState })

  return {
    // 状态访问器
    get currentMode() {
      return state.currentMode
    },

    get isSelecting() {
      return state.isSelecting
    },

    get selectedTarget() {
      return state.selectedTarget
    },

    get isRecording() {
      return state.isRecording
    },

    get state() {
      return state
    },

    // 状态更新方法
    setMode(mode: RecordingMode) {
      state.currentMode = mode
    },

    setSelecting(selecting: boolean) {
      state.isSelecting = selecting
    },

    setSelectedTarget(target?: string) {
      state.selectedTarget = target
    },

    setRecording(recording: boolean) {
      state.isRecording = recording
    },

    // 批量更新状态
    updateState(updates: Partial<RecordingModeState>) {
      if (updates.currentMode !== undefined) state.currentMode = updates.currentMode
      if (updates.isSelecting !== undefined) state.isSelecting = updates.isSelecting
      if (updates.selectedTarget !== undefined) state.selectedTarget = updates.selectedTarget
      if (updates.isRecording !== undefined) state.isRecording = updates.isRecording
    },

    // 重置状态
    reset() {
      state = { ...defaultState }
    },

    // 获取状态快照
    getSnapshot() {
      return { ...state }
    }
  }
}

// 导出单例实例
export const recordingModeStore = createRecordingModeStore()
