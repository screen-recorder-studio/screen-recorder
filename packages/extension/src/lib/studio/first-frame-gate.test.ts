import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFirstFrameGate } from './first-frame-gate'

afterEach(() => {
  vi.useRealTimers()
})

describe('createFirstFrameGate', () => {
  it('reports visible only after the loading mask update has been applied', async () => {
    const order: string[] = []
    let releaseUpdate!: () => void
    const afterUpdate = vi.fn(() => new Promise<void>((resolve) => {
      releaseUpdate = () => {
        order.push('updated')
        resolve()
      }
    }))
    const gate = createFirstFrameGate({
      timeoutMs: 10_000,
      setWaiting: (waiting) => order.push(`waiting:${waiting}`),
      afterUpdate,
      onVisible: () => order.push('visible'),
      onFailure: vi.fn()
    })

    gate.start()
    const visible = gate.markVisible()

    expect(order).toEqual(['waiting:true', 'waiting:false'])
    expect(afterUpdate).toHaveBeenCalledOnce()

    releaseUpdate()
    await expect(visible).resolves.toBe(true)
    expect(order).toEqual(['waiting:true', 'waiting:false', 'updated', 'visible'])
    await expect(gate.markVisible()).resolves.toBe(false)
  })

  it('leaves the waiting state through a single recoverable failure', async () => {
    const setWaiting = vi.fn()
    const onFailure = vi.fn()
    const onVisible = vi.fn()
    const gate = createFirstFrameGate({
      timeoutMs: 10_000,
      setWaiting,
      afterUpdate: () => Promise.resolve(),
      onVisible,
      onFailure
    })

    gate.start()

    expect(gate.fail('STUDIO_EMPTY_RANGE')).toBe(true)
    expect(gate.fail('STUDIO_PREVIEW_WORKER_ERROR')).toBe(false)
    await expect(gate.markVisible()).resolves.toBe(false)
    expect(setWaiting).toHaveBeenLastCalledWith(false)
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('STUDIO_EMPTY_RANGE')
    expect(onVisible).not.toHaveBeenCalled()
  })

  it('times out instead of leaving the first-frame mask stuck forever', () => {
    vi.useFakeTimers()
    const setWaiting = vi.fn()
    const onFailure = vi.fn()
    const gate = createFirstFrameGate({
      timeoutMs: 5_000,
      setWaiting,
      afterUpdate: () => Promise.resolve(),
      onVisible: vi.fn(),
      onFailure
    })

    gate.start()
    vi.advanceTimersByTime(4_999)
    expect(onFailure).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(setWaiting).toHaveBeenLastCalledWith(false)
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('STUDIO_FIRST_FRAME_TIMEOUT')
  })

  it('does not report a stale frame after another recording starts loading', async () => {
    let releaseUpdate!: () => void
    const onVisible = vi.fn()
    const gate = createFirstFrameGate({
      timeoutMs: 10_000,
      setWaiting: vi.fn(),
      afterUpdate: () => new Promise<void>((resolve) => { releaseUpdate = resolve }),
      onVisible,
      onFailure: vi.fn()
    })

    gate.start()
    const staleVisible = gate.markVisible()
    gate.start()
    releaseUpdate()

    await expect(staleVisible).resolves.toBe(false)
    expect(onVisible).not.toHaveBeenCalled()
  })
})
