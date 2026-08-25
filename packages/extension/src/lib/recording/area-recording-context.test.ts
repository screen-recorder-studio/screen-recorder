import { describe, expect, it } from 'vitest'
import {
  AREA_RECORDING_CONTEXT_STORAGE_KEY,
  createAreaRecordingContextStore
} from './area-recording-context'

class MemoryStorage {
  data: Record<string, unknown> = {}
  async get(key: string) { return { [key]: this.data[key] } }
  async set(items: Record<string, unknown>) { Object.assign(this.data, items) }
  async remove(key: string) { delete this.data[key] }
}

describe('area recording context store', () => {
  it('persists the selected area and target document for service-worker restarts', async () => {
    const storage = new MemoryStorage()
    const store = createAreaRecordingContextStore(storage)
    const context = {
      version: 1 as const,
      operationId: 'op-area',
      targetTabId: 42,
      targetDocumentId: 'document-1',
      mode: 'area' as const,
      intent: 'gif' as const,
      countdown: 3,
      selection: {
        rectCss: { x: 10, y: 20, width: 300, height: 200 },
        viewportCss: { width: 1_200, height: 800 },
        devicePixelRatio: 2,
        selectedAt: 123
      },
      createdAt: 100,
      updatedAt: 123
    }

    await store.save(context)

    expect(storage.data[AREA_RECORDING_CONTEXT_STORAGE_KEY]).toEqual(context)
    expect(await createAreaRecordingContextStore(storage).load()).toEqual(context)
  })

  it('fails closed for corrupt geometry and clears only its own key', async () => {
    const storage = new MemoryStorage()
    storage.data.unrelated = 'keep'
    storage.data[AREA_RECORDING_CONTEXT_STORAGE_KEY] = {
      version: 1,
      operationId: 'op-area',
      targetTabId: 42,
      targetDocumentId: null,
      mode: 'area',
      intent: 'gif',
      countdown: 3,
      selection: { rectCss: { x: 0, y: 0, width: -1, height: 20 } },
      createdAt: 100,
      updatedAt: 100
    }

    const store = createAreaRecordingContextStore(storage)
    expect(await store.load()).toBeNull()
    await store.clear()
    expect(storage.data).toEqual({ unrelated: 'keep' })
  })
})
