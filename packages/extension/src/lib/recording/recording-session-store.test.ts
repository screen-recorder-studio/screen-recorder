import { describe, expect, it } from 'vitest'
import {
  createRecordingSessionStore,
  RECORDING_SESSION_STORAGE_KEY,
  type StorageAreaLike
} from './recording-session-store'
import { createIdleRecordingSession, type RecordingSessionState } from './recording-session'

class MemoryStorage implements StorageAreaLike {
  data: Record<string, unknown> = {}
  setCount = 0

  async get(key: string): Promise<Record<string, unknown>> {
    await Promise.resolve()
    return { [key]: this.data[key] }
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await Promise.resolve()
    this.setCount += 1
    Object.assign(this.data, items)
  }
}

describe('recording session store', () => {
  it('returns a fresh idle session when storage is empty or corrupted', async () => {
    const storage = new MemoryStorage()
    const store = createRecordingSessionStore(storage)

    expect(await store.load()).toEqual(createIdleRecordingSession())

    storage.data[RECORDING_SESSION_STORAGE_KEY] = {
      phase: 'recording',
      operationId: null,
      revision: 3,
      mode: 'tab',
      countdownRemaining: 0,
      elapsedMs: 10,
      errorCode: null,
      updatedAt: 20
    }

    expect(await store.load()).toEqual(createIdleRecordingSession())
  })

  it('normalizes persisted counters and phase-specific fields', async () => {
    const storage = new MemoryStorage()
    storage.data[RECORDING_SESSION_STORAGE_KEY] = {
      phase: 'recording',
      operationId: 'op-1',
      revision: 3,
      mode: 'screen',
      countdownRemaining: 9,
      elapsedMs: 1200.9,
      errorCode: 'STALE_ERROR',
      updatedAt: -20
    }

    const state = await createRecordingSessionStore(storage).load()

    expect(state).toEqual({
      phase: 'recording',
      operationId: 'op-1',
      revision: 3,
      mode: 'screen',
      countdownRemaining: 0,
      elapsedMs: 1200,
      errorCode: null,
      updatedAt: 0
    })
  })

  it('saves under one fixed key and makes the write visible to the next load', async () => {
    const storage = new MemoryStorage()
    const store = createRecordingSessionStore(storage)
    const state: RecordingSessionState = {
      phase: 'requesting',
      operationId: 'op-1',
      revision: 1,
      mode: 'window',
      countdownRemaining: 0,
      elapsedMs: 0,
      errorCode: null,
      updatedAt: 100
    }

    const pendingSave = store.save(state)
    expect(await store.load()).toEqual(state)
    expect(await pendingSave).toEqual(state)
    expect(Object.keys(storage.data)).toEqual([RECORDING_SESSION_STORAGE_KEY])
    expect(await store.load()).toEqual(state)
  })

  it('serializes concurrent events and reduces each one from the latest persisted state', async () => {
    const storage = new MemoryStorage()
    const store = createRecordingSessionStore(storage)

    const [requested, started] = await Promise.all([
      store.apply({
        type: 'START_REQUESTED',
        operationId: 'op-1',
        revision: 1,
        mode: 'tab',
        updatedAt: 100
      }),
      store.apply({
        type: 'STREAM_STARTED',
        operationId: 'op-1',
        revision: 2,
        updatedAt: 101
      })
    ])

    expect(requested.phase).toBe('requesting')
    expect(started.phase).toBe('recording')
    expect(await store.load()).toMatchObject({
      phase: 'recording',
      operationId: 'op-1',
      revision: 2
    })
  })

  it('does not persist a rejected stale event', async () => {
    const storage = new MemoryStorage()
    const store = createRecordingSessionStore(storage)
    const current = await store.apply({
      type: 'START_REQUESTED',
      operationId: 'op-1',
      revision: 1,
      mode: 'tab',
      updatedAt: 100
    })
    const writesBefore = storage.setCount

    const result = await store.apply({
      type: 'STREAM_STARTED',
      operationId: 'op-1',
      revision: 1,
      updatedAt: 101
    })

    expect(result).toBe(current)
    expect(storage.setCount).toBe(writesBefore)
  })
})
