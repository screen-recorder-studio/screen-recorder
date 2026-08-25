import {
  createIdleRecordingSession,
  reduceRecordingSession,
  type RecordingIntent,
  type RecordingMode,
  type RecordingPhase,
  type RecordingSessionEvent,
  type RecordingSessionState
} from './recording-session'

export const RECORDING_SESSION_STORAGE_KEY = 'recordingSessionV1'

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export interface RecordingSessionStore {
  load(): Promise<RecordingSessionState>
  save(state: RecordingSessionState): Promise<RecordingSessionState>
  apply(event: RecordingSessionEvent): Promise<RecordingSessionState>
}

/**
 * Persists the background-owned recording state without depending on the
 * `chrome` global. Mutations share one queue so every event reduces the latest
 * committed snapshot rather than a stale in-memory copy.
 */
export function createRecordingSessionStore(storage: StorageAreaLike): RecordingSessionStore {
  let queue: Promise<void> = Promise.resolve()
  let lastState: RecordingSessionState | undefined

  const readStoredState = async (): Promise<RecordingSessionState> => {
    const stored = await storage.get(RECORDING_SESSION_STORAGE_KEY)
    const normalized = normalizeRecordingSession(stored?.[RECORDING_SESSION_STORAGE_KEY])
    if (lastState && statesEqual(lastState, normalized)) return lastState
    lastState = normalized
    return normalized
  }

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    load() {
      return enqueue(readStoredState)
    },

    save(state) {
      return enqueue(async () => {
        const normalized = normalizeRecordingSession(state)
        await storage.set({ [RECORDING_SESSION_STORAGE_KEY]: normalized })
        lastState = normalized
        return readStoredState()
      })
    },

    apply(event) {
      return enqueue(async () => {
        const current = await readStoredState()
        const next = reduceRecordingSession(current, event)
        if (next === current) return current

        await storage.set({ [RECORDING_SESSION_STORAGE_KEY]: next })
        lastState = next
        return readStoredState()
      })
    }
  }
}

const RECORDING_PHASES = new Set<RecordingPhase>([
  'idle',
  'selecting',
  'requesting',
  'countdown',
  'recording',
  'paused',
  'stopping',
  'finalizing',
  'failed'
])

const RECORDING_MODES = new Set<RecordingMode>(['tab', 'window', 'screen', 'area'])
const RECORDING_INTENTS = new Set<RecordingIntent>(['video', 'gif'])

function normalizeRecordingSession(value: unknown): RecordingSessionState {
  if (!isRecord(value)) return createIdleRecordingSession()

  const phase = value.phase
  const mode = value.mode
  const intent = value.intent === undefined ? 'video' : value.intent
  const revision = value.revision
  const operationId = normalizeOperationId(value.operationId)

  if (!isRecordingPhase(phase) || !isRecordingMode(mode) || !isRecordingIntent(intent)) {
    return createIdleRecordingSession()
  }
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return createIdleRecordingSession()
  if (value.operationId !== null && operationId === null) return createIdleRecordingSession()
  if (phase !== 'idle' && (operationId === null || (revision as number) === 0)) {
    return createIdleRecordingSession()
  }

  const errorCode = normalizeErrorCode(value.errorCode)
  if (phase === 'failed' && errorCode === null) return createIdleRecordingSession()

  return {
    phase,
    operationId,
    revision: revision as number,
    mode,
    intent,
    countdownRemaining: phase === 'countdown' ? normalizeCounter(value.countdownRemaining) : 0,
    elapsedMs: normalizeCounter(value.elapsedMs),
    errorCode: phase === 'failed' ? errorCode : null,
    updatedAt: normalizeCounter(value.updatedAt)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecordingPhase(value: unknown): value is RecordingPhase {
  return typeof value === 'string' && RECORDING_PHASES.has(value as RecordingPhase)
}

function isRecordingMode(value: unknown): value is RecordingMode {
  return typeof value === 'string' && RECORDING_MODES.has(value as RecordingMode)
}

function isRecordingIntent(value: unknown): value is RecordingIntent {
  return typeof value === 'string' && RECORDING_INTENTS.has(value as RecordingIntent)
}

function normalizeOperationId(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeCounter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function statesEqual(left: RecordingSessionState, right: RecordingSessionState): boolean {
  return left.phase === right.phase
    && left.operationId === right.operationId
    && left.revision === right.revision
    && left.mode === right.mode
    && left.intent === right.intent
    && left.countdownRemaining === right.countdownRemaining
    && left.elapsedMs === right.elapsedMs
    && left.errorCode === right.errorCode
    && left.updatedAt === right.updatedAt
}
