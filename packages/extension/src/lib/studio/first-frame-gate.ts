export interface FirstFrameGateOptions {
  timeoutMs: number
  setWaiting(waiting: boolean): void
  afterUpdate(): Promise<void>
  onVisible(): void
  onFailure(errorCode: string): void
}

export interface FirstFrameGate {
  start(): void
  markVisible(): Promise<boolean>
  fail(errorCode: string): boolean
  dispose(): void
}

type GateState = 'idle' | 'waiting' | 'visible' | 'failed'

export function createFirstFrameGate(options: FirstFrameGateOptions): FirstFrameGate {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs))
  let state: GateState = 'idle'
  let generation = 0
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timeoutId === null) return
    clearTimeout(timeoutId)
    timeoutId = null
  }

  function fail(errorCode: string): boolean {
    if (state !== 'waiting') return false

    state = 'failed'
    clearTimer()
    options.setWaiting(false)
    options.onFailure(errorCode)
    return true
  }

  return {
    start() {
      generation += 1
      const currentGeneration = generation
      clearTimer()
      state = 'waiting'
      options.setWaiting(true)
      timeoutId = setTimeout(() => {
        if (generation === currentGeneration) fail('STUDIO_FIRST_FRAME_TIMEOUT')
      }, timeoutMs)
    },

    async markVisible() {
      if (state !== 'waiting') return false

      const currentGeneration = generation
      state = 'visible'
      clearTimer()
      options.setWaiting(false)
      await options.afterUpdate()

      if (generation !== currentGeneration || state !== 'visible') return false
      options.onVisible()
      return true
    },

    fail,

    dispose() {
      generation += 1
      state = 'idle'
      clearTimer()
    }
  }
}
