export const DEFAULT_RECORDING_COUNTDOWN_SECONDS = 3
export const MAX_RECORDING_COUNTDOWN_SECONDS = 5

export function normalizeRecordingCountdown(
  value: unknown,
  fallback = DEFAULT_RECORDING_COUNTDOWN_SECONDS
): number {
  const normalizedFallback = Number.isFinite(fallback)
    && fallback >= 0
    && fallback <= MAX_RECORDING_COUNTDOWN_SECONDS
    ? Math.floor(fallback)
    : DEFAULT_RECORDING_COUNTDOWN_SECONDS
  if (typeof value !== 'number' || !Number.isFinite(value)) return normalizedFallback
  const seconds = Math.floor(value)
  if (seconds < 0 || seconds > MAX_RECORDING_COUNTDOWN_SECONDS) return normalizedFallback
  return seconds
}

export interface RecordingCountdownSettingsStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>
  set(value: Record<string, unknown>): Promise<void>
}

export async function persistRecordingCountdownSetting(
  storage: RecordingCountdownSettingsStorage,
  value: unknown
): Promise<number> {
  const countdownSeconds = normalizeRecordingCountdown(value)
  const stored = await storage.get(['settings'])
  const settings = stored?.settings && typeof stored.settings === 'object'
    ? stored.settings as Record<string, unknown>
    : {}
  await storage.set({ settings: { ...settings, countdownSeconds } })
  return countdownSeconds
}

export interface RecordingWarmupReader<T> {
  read(): Promise<{ done: boolean; value?: T }>
  cancel?(): Promise<unknown> | unknown
  releaseLock?(): void
}

export interface RecordingWarmup<TPrepared> {
  prepared: Promise<TPrepared>
  stop(): Promise<void>
}

export async function readFirstFormalFrameAfterWarmup<
  TFrame,
  TPrepared
>({
  warmup,
  createFormalReader
}: {
  warmup: RecordingWarmup<TPrepared>
  createFormalReader(): RecordingWarmupReader<TFrame>
}): Promise<{ frame: TFrame; reader: RecordingWarmupReader<TFrame> }> {
  await warmup.prepared
  await warmup.stop()
  const reader = createFormalReader()
  const firstRead = await reader.read()
  if (firstRead.done || !firstRead.value) {
    try { await reader.cancel?.() } catch {}
    try { reader.releaseLock?.() } catch {}
    throw new Error('Capture ended before the first formal video frame')
  }
  return { frame: firstRead.value, reader }
}

export function startRecordingWarmup<
  TFrame extends { close(): void },
  TPrepared
>({
  reader,
  prepareFromFrame
}: {
  reader: RecordingWarmupReader<TFrame>
  prepareFromFrame(frame: TFrame): Promise<TPrepared> | TPrepared
}): RecordingWarmup<TPrepared> {
  let stopping = false
  let preparationStarted = false
  let preparationSettled = false
  let resolvePrepared!: (value: TPrepared | PromiseLike<TPrepared>) => void
  let rejectPrepared!: (reason?: unknown) => void

  const prepared = new Promise<TPrepared>((resolve, reject) => {
    resolvePrepared = resolve
    rejectPrepared = reject
  })

  const settlePrepared = (
    outcome: { ok: true; value: TPrepared } | { ok: false; error: unknown }
  ) => {
    if (preparationSettled) return
    preparationSettled = true
    if (outcome.ok) resolvePrepared(outcome.value)
    else rejectPrepared(outcome.error)
  }

  const loop = (async () => {
    try {
      while (!stopping) {
        const { value: frame, done } = await reader.read()
        if (done || !frame) {
          if (!preparationStarted) {
            settlePrepared({ ok: false, error: new Error('Capture ended before a warm-up frame arrived') })
          }
          break
        }

        try {
          if (!preparationStarted) {
            preparationStarted = true
            Promise.resolve(prepareFromFrame(frame)).then(
              (value) => settlePrepared({ ok: true, value }),
              (error) => settlePrepared({ ok: false, error })
            )
          }
        } catch (error) {
          settlePrepared({ ok: false, error })
        } finally {
          try { frame.close() } catch {}
        }
      }
    } catch (error) {
      if (!stopping) settlePrepared({ ok: false, error })
    }
  })()

  let stopPromise: Promise<void> | null = null
  return {
    prepared,
    stop() {
      if (stopPromise) return stopPromise
      stopPromise = (async () => {
        stopping = true
        if (!preparationStarted) {
          settlePrepared({ ok: false, error: new Error('Recording warm-up stopped before preparation') })
        }
        try { await reader.cancel?.() } catch {}
        try { await loop } catch {}
        try { reader.releaseLock?.() } catch {}
      })()
      return stopPromise
    }
  }
}
