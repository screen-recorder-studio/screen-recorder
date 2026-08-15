import { describe, expect, it } from 'vitest'
import { createJourneyRecorder } from './journey-recorder'

class MemoryStorage {
  data: Record<string, unknown> = {}

  async get(key: string) {
    await Promise.resolve()
    return { [key]: this.data[key] }
  }

  async set(items: Record<string, unknown>) {
    await Promise.resolve()
    Object.assign(this.data, items)
  }

  async remove(key: string) {
    delete this.data[key]
  }
}

describe('journey recorder', () => {
  it('serializes concurrent writes so no journey event is lost', async () => {
    const storage = new MemoryStorage()
    const recorder = createJourneyRecorder(storage, {
      now: () => 100,
      createJourneyId: () => 'journey-1'
    })

    await Promise.all([
      recorder.record({ name: 'recording.requested', context: 'background' }),
      recorder.record({ name: 'capture.permission_requested', context: 'offscreen' }),
      recorder.record({ name: 'capture.permission_granted', context: 'offscreen' })
    ])

    const state = await recorder.read()
    expect(state.events.map((event) => event.name)).toEqual([
      'recording.requested',
      'capture.permission_requested',
      'capture.permission_granted'
    ])
    expect(state.events.map((event) => event.sequence)).toEqual([1, 2, 3])
  })

  it('clears session diagnostics without changing other storage keys', async () => {
    const storage = new MemoryStorage()
    storage.data.other = 'preserve'
    const recorder = createJourneyRecorder(storage)
    await recorder.record({ name: 'recording.requested', context: 'background' })
    await recorder.clear()

    expect((await recorder.read()).events).toEqual([])
    expect(storage.data.other).toBe('preserve')
  })
})
