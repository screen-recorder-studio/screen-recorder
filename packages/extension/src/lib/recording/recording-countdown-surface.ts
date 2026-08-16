import type { RecordingMode } from './recording-session'

const COUNTDOWN_WINDOW_WIDTH = 320
const COUNTDOWN_WINDOW_HEIGHT = 320

export interface RecordingCountdownHostBounds {
  left?: number
  top?: number
  width?: number
  height?: number
}

export interface RecordingCountdownWindowCreateData {
  url: string
  type: 'popup'
  focused: true
  width: number
  height: number
  left?: number
  top?: number
}

export interface RecordingCountdownWindowDriver {
  create(data: RecordingCountdownWindowCreateData): Promise<{ id?: number } | undefined>
  remove(windowId: number): Promise<void>
}

export interface RecordingCountdownSurface {
  show(input: {
    operationId: string
    mode: RecordingMode
    remaining: number
    hostBounds?: RecordingCountdownHostBounds | null
  }): Promise<void>
  hide(operationId?: string | null): Promise<void>
  windowRemoved(windowId: number): void
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function centeredOffset(origin: unknown, span: unknown, surfaceSpan: number): number | undefined {
  if (!finite(origin) || !finite(span)) return undefined
  return Math.round(origin + (span - surfaceSpan) / 2)
}

export function createRecordingCountdownSurface({
  driver,
  getUrl
}: {
  driver: RecordingCountdownWindowDriver
  getUrl(path: string): string
}): RecordingCountdownSurface {
  let generation = 0
  let activeOperationId: string | null = null
  let activeWindowId: number | null = null
  let opening: Promise<void> | null = null

  const closeWindow = async (windowId: number | null) => {
    if (windowId == null) return
    try { await driver.remove(windowId) } catch {}
  }

  const hide = async (operationId?: string | null) => {
    if (operationId && activeOperationId && operationId !== activeOperationId) return
    generation += 1
    activeOperationId = null
    const windowId = activeWindowId
    activeWindowId = null
    await closeWindow(windowId)
  }

  return {
    async show({ operationId, mode, remaining, hostBounds }) {
      if ((mode !== 'screen' && mode !== 'window') || remaining <= 0) {
        await hide(operationId)
        return
      }
      if (activeOperationId === operationId && (activeWindowId != null || opening)) {
        await opening
        return
      }

      if (activeOperationId && activeOperationId !== operationId) await hide(activeOperationId)

      activeOperationId = operationId
      const requestedGeneration = ++generation
      const params = new URLSearchParams({
        surface: 'recording',
        operationId,
        seconds: String(Math.max(1, Math.floor(remaining)))
      })
      const createData: RecordingCountdownWindowCreateData = {
        url: `${getUrl('countdown.html')}?${params.toString()}`,
        type: 'popup',
        focused: true,
        width: COUNTDOWN_WINDOW_WIDTH,
        height: COUNTDOWN_WINDOW_HEIGHT
      }
      const left = centeredOffset(hostBounds?.left, hostBounds?.width, COUNTDOWN_WINDOW_WIDTH)
      const top = centeredOffset(hostBounds?.top, hostBounds?.height, COUNTDOWN_WINDOW_HEIGHT)
      if (left !== undefined) createData.left = left
      if (top !== undefined) createData.top = top

      const request = (async () => {
        let created: { id?: number } | undefined
        try { created = await driver.create(createData) } catch { return }
        const windowId = typeof created?.id === 'number' ? created.id : null
        if (windowId == null) return
        if (generation !== requestedGeneration || activeOperationId !== operationId) {
          await closeWindow(windowId)
          return
        }
        activeWindowId = windowId
      })()
      opening = request
      try { await request } finally {
        if (opening === request) opening = null
      }
    },
    hide,
    windowRemoved(windowId) {
      if (activeWindowId !== windowId) return
      activeWindowId = null
      activeOperationId = null
      generation += 1
    }
  }
}
