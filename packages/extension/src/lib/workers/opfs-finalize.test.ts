import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForOpfsFinalization } from './opfs-finalize'

class FakeWorker extends EventTarget {
  posted: unknown[] = []

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

afterEach(() => vi.useRealTimers())

describe('waitForOpfsFinalization', () => {
  it('resolves only after the finalized acknowledgement', async () => {
    const worker = new FakeWorker()
    const pending = waitForOpfsFinalization(worker, 30_000)
    expect(worker.posted).toEqual([{ type: 'finalize' }])
    worker.emit({ type: 'finalized', id: '123' })
    await expect(pending).resolves.toEqual({ id: '123' })
  })

  it('passes wall-clock duration to the writer finalization message', async () => {
    const worker = new FakeWorker()
    const pending = waitForOpfsFinalization(worker, 30_000, { wallClockDurationMs: 11_250 })
    expect(worker.posted).toEqual([{ type: 'finalize', wallClockDurationMs: 11_250 }])
    worker.emit({ type: 'finalized', id: '123' })
    await pending
  })

  it('rejects a worker error with its stable code', async () => {
    const worker = new FakeWorker()
    const pending = waitForOpfsFinalization(worker, 30_000)
    worker.emit({ type: 'error', code: 'OPFS_WRITE_ERROR', message: 'private detail' })
    await expect(pending).rejects.toMatchObject({ code: 'OPFS_WRITE_ERROR' })
  })

  it('rejects instead of silently succeeding on timeout', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const pending = waitForOpfsFinalization(worker, 30_000)
    const assertion = expect(pending).rejects.toMatchObject({ code: 'OPFS_FINALIZE_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })
})
