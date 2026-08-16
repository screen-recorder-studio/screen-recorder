export type RecordingPhase =
  | 'idle'
  | 'requesting'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'finalizing'
  | 'failed'

export type RecordingMode = 'tab' | 'window' | 'screen'

export interface RecordingSessionState {
  phase: RecordingPhase
  operationId: string | null
  revision: number
  mode: RecordingMode
  countdownRemaining: number
  elapsedMs: number
  errorCode: string | null
  updatedAt: number
}

interface VersionedRecordingEvent {
  operationId: string
  revision: number
  updatedAt: number
}

interface StartRequestedEvent extends VersionedRecordingEvent {
  type: 'START_REQUESTED'
  mode: RecordingMode
}

interface RetryRequestedEvent extends VersionedRecordingEvent {
  type: 'RETRY_REQUESTED'
  mode: RecordingMode
}

export type RecordingSessionEvent =
  | StartRequestedEvent
  | RetryRequestedEvent
  | (VersionedRecordingEvent & {
      type: 'COUNTDOWN_STARTED' | 'COUNTDOWN_TICKED'
      countdownRemaining: number
    })
  | (VersionedRecordingEvent & { type: 'STREAM_STARTED' })
  | (VersionedRecordingEvent & {
      type: 'ELAPSED_UPDATED' | 'PAUSED' | 'RESUMED' | 'STOP_REQUESTED'
      elapsedMs: number
    })
  | (VersionedRecordingEvent & { type: 'FINALIZING_STARTED' | 'FINALIZED' })
  | (VersionedRecordingEvent & { type: 'FAILED'; errorCode: string })

export interface CreateIdleRecordingSessionOptions {
  mode?: RecordingMode
  updatedAt?: number
}

export function createIdleRecordingSession(
  options: CreateIdleRecordingSessionOptions = {}
): RecordingSessionState {
  return {
    phase: 'idle',
    operationId: null,
    revision: 0,
    mode: options.mode ?? 'tab',
    countdownRemaining: 0,
    elapsedMs: 0,
    errorCode: null,
    updatedAt: normalizeNonNegativeInteger(options.updatedAt ?? 0)
  }
}

/**
 * Reduces facts for one recording operation into a serializable session snapshot.
 * Rejected and duplicate events return the original object unchanged.
 */
export function reduceRecordingSession(
  state: RecordingSessionState,
  event: RecordingSessionEvent
): RecordingSessionState {
  if (!isValidVersionedEvent(event)) return state

  if (event.type === 'START_REQUESTED') {
    if (state.phase !== 'idle' || event.operationId === state.operationId) return state
    return beginOperation(event)
  }

  if (event.type === 'RETRY_REQUESTED') {
    if (state.phase !== 'failed' || event.operationId === state.operationId) return state
    return beginOperation(event)
  }

  if (event.operationId !== state.operationId || event.revision <= state.revision) return state

  const base = {
    ...state,
    revision: event.revision,
    updatedAt: normalizeNonNegativeInteger(event.updatedAt)
  }

  switch (event.type) {
    case 'COUNTDOWN_STARTED':
      if (state.phase !== 'requesting') return state
      return {
        ...base,
        phase: 'countdown',
        countdownRemaining: normalizeNonNegativeInteger(event.countdownRemaining)
      }

    case 'COUNTDOWN_TICKED':
      if (state.phase !== 'countdown') return state
      return {
        ...base,
        countdownRemaining: normalizeNonNegativeInteger(event.countdownRemaining)
      }

    case 'STREAM_STARTED':
      if (state.phase !== 'requesting' && state.phase !== 'countdown') return state
      return { ...base, phase: 'recording', countdownRemaining: 0, errorCode: null }

    case 'ELAPSED_UPDATED':
      if (state.phase !== 'recording' && state.phase !== 'paused') return state
      return { ...base, elapsedMs: normalizeNonNegativeInteger(event.elapsedMs) }

    case 'PAUSED':
      if (state.phase !== 'recording') return state
      return { ...base, phase: 'paused', elapsedMs: normalizeNonNegativeInteger(event.elapsedMs) }

    case 'RESUMED':
      if (state.phase !== 'paused') return state
      return { ...base, phase: 'recording', elapsedMs: normalizeNonNegativeInteger(event.elapsedMs) }

    case 'STOP_REQUESTED':
      if (!canStop(state.phase)) return state
      return {
        ...base,
        phase: 'stopping',
        countdownRemaining: 0,
        elapsedMs: normalizeNonNegativeInteger(event.elapsedMs)
      }

    case 'FINALIZING_STARTED':
      if (state.phase !== 'stopping') return state
      return { ...base, phase: 'finalizing' }

    case 'FINALIZED':
      if (state.phase !== 'finalizing') return state
      return {
        ...base,
        phase: 'idle',
        countdownRemaining: 0,
        errorCode: null
      }

    case 'FAILED':
      if (state.phase === 'idle' || state.phase === 'failed') return state
      if (event.errorCode.trim().length === 0) return state
      return {
        ...base,
        phase: 'failed',
        countdownRemaining: 0,
        errorCode: event.errorCode
      }
  }
}

function beginOperation(event: StartRequestedEvent | RetryRequestedEvent): RecordingSessionState {
  return {
    phase: 'requesting',
    operationId: event.operationId,
    revision: event.revision,
    mode: event.mode,
    countdownRemaining: 0,
    elapsedMs: 0,
    errorCode: null,
    updatedAt: normalizeNonNegativeInteger(event.updatedAt)
  }
}

function canStop(phase: RecordingPhase): boolean {
  return phase === 'requesting' || phase === 'countdown' || phase === 'recording' || phase === 'paused'
}

function isValidVersionedEvent(event: VersionedRecordingEvent): boolean {
  return event.operationId.trim().length > 0
    && Number.isSafeInteger(event.revision)
    && event.revision > 0
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}
