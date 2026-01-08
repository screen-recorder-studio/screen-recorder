// 鼠标指针配置状态管理
export type CursorStyle = 'default' | 'hand' | 'magnifier' | 'custom'

interface MouseCursorState {
  enabled: boolean
  style: CursorStyle
  size: number
  customImageUrl?: string
}

const defaultState: MouseCursorState = {
  enabled: true,
  style: 'default',
  size: 20
}

function createMouseCursorStore() {
  let state = $state<MouseCursorState>({ ...defaultState })

  return {
    get enabled() { return state.enabled },
    get style() { return state.style },
    get size() { return state.size },
    get customImageUrl() { return state.customImageUrl },

    setEnabled(enabled: boolean) { state.enabled = enabled },
    setStyle(style: CursorStyle) { state.style = style },
    setSize(size: number) { state.size = size },
    setCustomImageUrl(url: string) { state.customImageUrl = url },

    reset() { state = { ...defaultState } }
  }
}

export const mouseCursorStore = createMouseCursorStore()
