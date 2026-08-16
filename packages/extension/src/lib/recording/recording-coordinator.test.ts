import { describe, expect, it } from 'vitest'
import {
  RecordingCoordinator,
  type RecordingSessionStoreLike
} from './recording-coordinator'
import {
  createIdleRecordingSession,
  reduceRecordingSession,
  type RecordingSessionEvent,
  type RecordingSessionState
} from './recording-session'
import { createRecordingSessionStore } from './recording-session-store'

function createMemoryStore(initial = createIdleRecordingSession()): RecordingSessionStoreLike {
  let state = initial
  return {
    async load() {
      return state
    },
    async apply(event: RecordingSessionEvent) {
      state = reduceRecordingSession(state, event)
      return state
    }
  }
}

function createCoordinator(store = createMemoryStore()) {
  let id = 0
  let now = 100
  return new RecordingCoordinator(store, {
    createOperationId: () => `op-${++id}`,
    now: () => ++now
  })
}

describe('RecordingCoordinator', () => {
  it('accepts one start and rejects a duplicate while capture is being requested', async () => {
    const coordinator = createCoordinator()

    const first = await coordinator.requestStart('tab')
    const duplicate = await coordinator.requestStart('screen')

    expect(first.accepted).toBe(true)
    expect(first.state).toMatchObject({
      phase: 'requesting',
      operationId: 'op-1',
      revision: 1,
      mode: 'tab'
    })
    expect(duplicate).toEqual({ accepted: false, state: first.state })
  })

  it('serializes concurrent facts and never regresses STREAM_STARTED to countdown', async () => {
    const coordinator = createCoordinator()
    const start = await coordinator.requestStart('window')
    const operationId = start.state.operationId!

    const [countdown, started] = await Promise.all([
      coordinator.countdownChanged(operationId, 3),
      coordinator.streamStarted(operationId)
    ])

    expect(countdown.accepted).toBe(true)
    expect(started.accepted).toBe(true)
    expect(await coordinator.getState()).toMatchObject({
      phase: 'recording',
      operationId,
      revision: 3,
      countdownRemaining: 0
    })

    const staleCountdown = await coordinator.countdownChanged(operationId, 2)
    expect(staleCountdown.accepted).toBe(false)
    expect(staleCountdown.state.phase).toBe('recording')
  })

  it('ignores facts from an older operation after a retry', async () => {
    const coordinator = createCoordinator()
    const first = await coordinator.requestStart('screen')
    const firstId = first.state.operationId!
    await coordinator.failed(firstId, 'PERMISSION_DENIED')

    const retry = await coordinator.requestStart('screen')
    const retryId = retry.state.operationId!
    const stale = await coordinator.streamStarted(firstId)

    expect(retry.accepted).toBe(true)
    expect(retryId).toBe('op-2')
    expect(stale.accepted).toBe(false)
    expect(stale.state).toMatchObject({ phase: 'requesting', operationId: retryId })
  })

  it('models pause, resume, stop, finalization, and completion', async () => {
    const coordinator = createCoordinator()
    const start = await coordinator.requestStart('tab')
    const operationId = start.state.operationId!

    await coordinator.streamStarted(operationId)
    await coordinator.elapsedChanged(operationId, 1_200)
    await coordinator.pauseChanged(operationId, true, 1_250)
    await coordinator.pauseChanged(operationId, false, 1_250)
    await coordinator.stopRequested(operationId, 1_800)
    await coordinator.finalizingStarted(operationId)
    const completed = await coordinator.finalized(operationId)

    expect(completed.accepted).toBe(true)
    expect(completed.state).toMatchObject({
      phase: 'idle',
      operationId,
      revision: 8,
      elapsedMs: 1_800,
      errorCode: null
    })
  })

  it('reports an invalid transition as unaccepted without changing state', async () => {
    const coordinator = createCoordinator()
    const start = await coordinator.requestStart('tab')
    const operationId = start.state.operationId!

    const invalidPause = await coordinator.pauseChanged(operationId, true, 0)

    expect(invalidPause.accepted).toBe(false)
    expect(invalidPause.state).toBe(start.state)
  })

  it('detects rejection by operation/revision with a persistent store that reloads objects', async () => {
    const data: Record<string, unknown> = {}
    const store = createRecordingSessionStore({
      async get(key) { return { [key]: data[key] } },
      async set(items) { Object.assign(data, items) }
    })
    const coordinator = createCoordinator(store)
    const start = await coordinator.requestStart('tab')

    const invalidPause = await coordinator.pauseChanged(start.state.operationId!, true, 0)

    expect(invalidPause.accepted).toBe(false)
    expect(invalidPause.state).toEqual(start.state)
  })
})
