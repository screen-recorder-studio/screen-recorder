import { describe, expect, it } from 'vitest'
import {
  createIdleRecordingSession,
  reduceRecordingSession,
  type RecordingSessionEvent,
  type RecordingSessionState
} from './recording-session'

function apply(
  state: RecordingSessionState,
  ...events: RecordingSessionEvent[]
): RecordingSessionState {
  return events.reduce(reduceRecordingSession, state)
}

describe('recording session reducer', () => {
  it('models GIF area selection as a durable pre-capture phase', () => {
    const selecting = reduceRecordingSession(
      createIdleRecordingSession({ updatedAt: 100 }),
      {
        type: 'SELECTION_REQUESTED',
        operationId: 'op-area',
        revision: 1,
        mode: 'area',
        intent: 'gif',
        updatedAt: 110
      }
    )

    expect(selecting).toMatchObject({
      phase: 'selecting',
      operationId: 'op-area',
      revision: 1,
      mode: 'area',
      intent: 'gif'
    })

    const requesting = reduceRecordingSession(selecting, {
      type: 'SELECTION_CONFIRMED',
      operationId: 'op-area',
      revision: 2,
      updatedAt: 120
    })
    expect(requesting).toMatchObject({ phase: 'requesting', intent: 'gif' })

    const cancelled = reduceRecordingSession(selecting, {
      type: 'SELECTION_CANCELLED',
      operationId: 'op-area',
      revision: 2,
      updatedAt: 120
    })
    expect(cancelled).toMatchObject({
      phase: 'idle',
      operationId: 'op-area',
      revision: 2,
      mode: 'area',
      intent: 'gif'
    })
  })

  it('models the complete successful lifecycle with one monotonic revision', () => {
    const initial = createIdleRecordingSession({ mode: 'tab', updatedAt: 100 })
    const state = apply(
      initial,
      { type: 'START_REQUESTED', operationId: 'op-1', revision: 1, mode: 'tab', updatedAt: 110 },
      { type: 'COUNTDOWN_STARTED', operationId: 'op-1', revision: 2, countdownRemaining: 3, updatedAt: 120 },
      { type: 'COUNTDOWN_TICKED', operationId: 'op-1', revision: 3, countdownRemaining: 2, updatedAt: 130 },
      { type: 'STREAM_STARTED', operationId: 'op-1', revision: 4, updatedAt: 140 },
      { type: 'ELAPSED_UPDATED', operationId: 'op-1', revision: 5, elapsedMs: 1_500, updatedAt: 1_640 },
      { type: 'PAUSED', operationId: 'op-1', revision: 6, elapsedMs: 1_500, updatedAt: 1_650 },
      { type: 'RESUMED', operationId: 'op-1', revision: 7, elapsedMs: 1_500, updatedAt: 1_660 },
      { type: 'STOP_REQUESTED', operationId: 'op-1', revision: 8, elapsedMs: 2_000, updatedAt: 2_160 },
      { type: 'FINALIZING_STARTED', operationId: 'op-1', revision: 9, updatedAt: 2_170 }
    )

    expect(state).toEqual({
      phase: 'finalizing',
      operationId: 'op-1',
      revision: 9,
      mode: 'tab',
      intent: 'video',
      countdownRemaining: 0,
      elapsedMs: 2_000,
      errorCode: null,
      updatedAt: 2_170
    })

    const completed = reduceRecordingSession(state, {
      type: 'FINALIZED', operationId: 'op-1', revision: 10, updatedAt: 2_180
    })
    expect(completed).toMatchObject({
      phase: 'idle',
      operationId: 'op-1',
      revision: 10,
      elapsedMs: 2_000,
      updatedAt: 2_180
    })

    const nextOperation = reduceRecordingSession(completed, {
      type: 'START_REQUESTED', operationId: 'op-2', revision: 1, mode: 'window', updatedAt: 2_190
    })
    expect(nextOperation).toMatchObject({
      phase: 'requesting',
      operationId: 'op-2',
      revision: 1,
      mode: 'window',
      elapsedMs: 0
    })
  })

  it('ignores facts from an older operation', () => {
    const current = apply(
      createIdleRecordingSession({ mode: 'tab', updatedAt: 0 }),
      { type: 'START_REQUESTED', operationId: 'op-current', revision: 1, mode: 'screen', updatedAt: 10 },
      { type: 'STREAM_STARTED', operationId: 'op-current', revision: 2, updatedAt: 20 }
    )

    const next = reduceRecordingSession(current, {
      type: 'FAILED',
      operationId: 'op-previous',
      revision: 99,
      errorCode: 'CAPTURE_FAILED',
      updatedAt: 30
    })

    expect(next).toBe(current)
  })

  it('ignores duplicate and older revisions without regressing STREAM_STARTED to requesting', () => {
    const recording = apply(
      createIdleRecordingSession({ mode: 'tab', updatedAt: 0 }),
      { type: 'START_REQUESTED', operationId: 'op-1', revision: 3, mode: 'tab', updatedAt: 10 },
      { type: 'STREAM_STARTED', operationId: 'op-1', revision: 4, updatedAt: 20 }
    )

    const duplicate = reduceRecordingSession(recording, {
      type: 'STREAM_STARTED', operationId: 'op-1', revision: 4, updatedAt: 25
    })
    const lateRequest = reduceRecordingSession(recording, {
      type: 'START_REQUESTED', operationId: 'op-1', revision: 3, mode: 'tab', updatedAt: 15
    })

    expect(duplicate).toBe(recording)
    expect(lateRequest).toBe(recording)
    expect(lateRequest.phase).toBe('recording')
    expect(lateRequest.revision).toBe(4)
  })

  it('accepts only phase-valid events even when their revision is newer', () => {
    const requesting = reduceRecordingSession(
      createIdleRecordingSession({ mode: 'tab', updatedAt: 0 }),
      { type: 'START_REQUESTED', operationId: 'op-1', revision: 1, mode: 'tab', updatedAt: 10 }
    )

    const invalidPause = reduceRecordingSession(requesting, {
      type: 'PAUSED', operationId: 'op-1', revision: 2, elapsedMs: 0, updatedAt: 20
    })

    expect(invalidPause).toBe(requesting)
  })

  it('creates a fresh operation when retrying a failed session', () => {
    const failed = apply(
      createIdleRecordingSession({ mode: 'tab', updatedAt: 0 }),
      { type: 'START_REQUESTED', operationId: 'op-1', revision: 1, mode: 'screen', updatedAt: 10 },
      {
        type: 'FAILED',
        operationId: 'op-1',
        revision: 2,
        errorCode: 'PERMISSION_DENIED',
        updatedAt: 20
      }
    )

    const retried = reduceRecordingSession(failed, {
      type: 'RETRY_REQUESTED',
      operationId: 'op-2',
      revision: 1,
      mode: 'screen',
      updatedAt: 30
    })

    expect(retried).toEqual({
      phase: 'requesting',
      operationId: 'op-2',
      revision: 1,
      mode: 'screen',
      intent: 'video',
      countdownRemaining: 0,
      elapsedMs: 0,
      errorCode: null,
      updatedAt: 30
    })

    expect(reduceRecordingSession(retried, {
      type: 'STREAM_STARTED', operationId: 'op-1', revision: 100, updatedAt: 40
    })).toBe(retried)
  })

  it('rejects retry outside failed and rejects operation id reuse', () => {
    const idle = createIdleRecordingSession({ mode: 'tab', updatedAt: 0 })
    const idleRetry = reduceRecordingSession(idle, {
      type: 'RETRY_REQUESTED', operationId: 'op-1', revision: 1, mode: 'tab', updatedAt: 10
    })
    expect(idleRetry).toBe(idle)

    const failed = apply(
      idle,
      { type: 'START_REQUESTED', operationId: 'op-1', revision: 1, mode: 'tab', updatedAt: 10 },
      { type: 'FAILED', operationId: 'op-1', revision: 2, errorCode: 'CAPTURE_FAILED', updatedAt: 20 }
    )
    expect(reduceRecordingSession(failed, {
      type: 'RETRY_REQUESTED', operationId: 'op-1', revision: 1, mode: 'tab', updatedAt: 30
    })).toBe(failed)
  })

  it('normalizes unsafe numeric input at the domain boundary', () => {
    const state = apply(
      createIdleRecordingSession({ mode: 'window', updatedAt: Number.NaN }),
      { type: 'START_REQUESTED', operationId: 'op-1', revision: 1, mode: 'window', updatedAt: 10 },
      { type: 'COUNTDOWN_STARTED', operationId: 'op-1', revision: 2, countdownRemaining: 3.9, updatedAt: 20 },
      { type: 'COUNTDOWN_TICKED', operationId: 'op-1', revision: 3, countdownRemaining: -5, updatedAt: 30 },
      { type: 'STREAM_STARTED', operationId: 'op-1', revision: 4, updatedAt: 40 },
      { type: 'ELAPSED_UPDATED', operationId: 'op-1', revision: 5, elapsedMs: Number.POSITIVE_INFINITY, updatedAt: 50 }
    )

    expect(state.countdownRemaining).toBe(0)
    expect(state.elapsedMs).toBe(0)
    expect(createIdleRecordingSession({ mode: 'window', updatedAt: Number.NaN }).updatedAt).toBe(0)
  })
})
