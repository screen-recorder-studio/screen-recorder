import { describe, expect, it, vi } from 'vitest'
import { waitForWorkerMessage } from './worker-message'

class FakeWorker {
  private listeners = new Set<(event: MessageEvent) => void>()

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener)
  }

  emit(data: unknown) {
    const event = new MessageEvent('message', { data })
    for (const listener of this.listeners) listener(event)
  }
}

describe('waitForWorkerMessage', () => {
  it('resolves the requested worker response', async () => {
    const worker = new FakeWorker()
    const pending = waitForWorkerMessage<{ type: 'range'; count: number }>(worker, 'range', 50)

    worker.emit({ type: 'range', count: 12 })

    await expect(pending).resolves.toEqual({ type: 'range', count: 12 })
  })

  it('rejects reader errors immediately instead of masking them as a timeout', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const pending = waitForWorkerMessage(worker, 'range', 30_000)

    worker.emit({ type: 'error', code: 'GOP_EXCEEDS_WINDOW_CAPACITY', message: 'window too small' })

    await expect(pending).rejects.toMatchObject({
      code: 'GOP_EXCEEDS_WINDOW_CAPACITY',
      message: 'window too small'
    })
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
