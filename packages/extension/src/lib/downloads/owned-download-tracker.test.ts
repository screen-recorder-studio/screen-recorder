import { describe, expect, it } from 'vitest'
import { OwnedDownloadTracker } from './owned-download-tracker'

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
}

describe('OwnedDownloadTracker', () => {
  it('starts tracking only when Chrome returns a valid download id', async () => {
    const tracker = new OwnedDownloadTracker(new MemoryStorage())

    await expect(tracker.trackStarted(undefined)).resolves.toBeNull()
    await expect(tracker.trackStarted(-1)).resolves.toBeNull()
    await expect(tracker.trackStarted(41)).resolves.toEqual({
      name: 'download.started',
      context: 'background'
    })
  })

  it('ignores browser download changes that do not belong to the extension', async () => {
    const tracker = new OwnedDownloadTracker(new MemoryStorage())
    await tracker.trackStarted(41)

    await expect(tracker.observeChange({ id: 99, state: { current: 'complete' } })).resolves.toBeNull()
    await expect(tracker.observeChange({ id: 41, state: { current: 'in_progress' } })).resolves.toBeNull()
  })

  it('reports an owned completion once and releases the id', async () => {
    const storage = new MemoryStorage()
    const tracker = new OwnedDownloadTracker(storage)
    await tracker.trackStarted(41)

    await expect(tracker.observeChange({ id: 41, state: { current: 'complete' } })).resolves.toEqual({
      name: 'download.completed',
      context: 'background',
      attributes: { outcome: 'success' }
    })
    await expect(tracker.observeChange({ id: 41, state: { current: 'complete' } })).resolves.toBeNull()
  })

  it('reports an owned interruption as failure and releases the id', async () => {
    const tracker = new OwnedDownloadTracker(new MemoryStorage())
    await tracker.trackStarted(42)

    await expect(tracker.observeChange({ id: 42, state: { current: 'interrupted' } })).resolves.toEqual({
      name: 'download.failed',
      context: 'background',
      attributes: { outcome: 'failure', errorCode: 'DOWNLOAD_INTERRUPTED' }
    })
    await expect(tracker.observeChange({ id: 42, state: { current: 'complete' } })).resolves.toBeNull()
  })

  it('retains ownership across service worker instances', async () => {
    const storage = new MemoryStorage()
    await new OwnedDownloadTracker(storage).trackStarted(43)

    const restartedTracker = new OwnedDownloadTracker(storage)
    await expect(restartedTracker.observeChange({ id: 43, state: { current: 'complete' } })).resolves.toEqual({
      name: 'download.completed',
      context: 'background',
      attributes: { outcome: 'success' }
    })
  })
})
