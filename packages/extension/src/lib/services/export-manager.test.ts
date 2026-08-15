import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportManager } from './export-manager'

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = []
  messages: unknown[] = []
  terminated = false
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  constructor() {
    super()
    FakeWorker.instances.push(this)
  }

  postMessage(message: unknown) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(data: unknown) {
    const event = new MessageEvent('message', { data })
    this.onmessage?.(event)
    this.dispatchEvent(event)
  }
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => vi.unstubAllGlobals())

describe('ExportManager cancellation', () => {
  it('waits for worker acknowledgement and rejects the active export with a stable code', async () => {
    const manager = new ExportManager()
    const pending = manager.exportEditedVideo(
      [{ data: new Uint8Array([1]), timestamp: 0, type: 'key', size: 1 }],
      { format: 'mp4', quality: 'high' } as any
    )
    const worker = FakeWorker.instances[0]

    expect(manager.cancelExport()).toBe(true)
    expect(worker.messages.at(-1)).toEqual({ type: 'cancel' })
    expect(worker.terminated).toBe(false)

    worker.emit({ type: 'cancelled', data: {} })
    await expect(pending).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' })
    expect(worker.terminated).toBe(true)
  })
})


describe('ExportManager GIF cancellation', () => {
  it('cleans the active main-thread encoder before cancellation settles', async () => {
    const manager = new ExportManager()
    const pending = manager.exportEditedVideo(
      [{ data: new Uint8Array([1]), timestamp: 0, type: 'key', size: 1 }],
      { format: 'gif', quality: 'high' } as any
    )
    const worker = FakeWorker.instances[0]
    const cleanup = vi.fn()
    ;(manager as any).activeGifEncoder = { cleanup }

    expect(manager.cancelExport()).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()

    worker.emit({ type: 'cancelled', data: {} })
    await expect(pending).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' })
  })
})
