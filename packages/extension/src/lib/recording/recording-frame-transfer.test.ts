import { describe, expect, it, vi } from 'vitest'
import { transferFrameToEncoderWorker } from './recording-frame-transfer'

describe('recording frame ownership transfer', () => {
  it('uses the frame as a transferable so sender ownership moves to the worker', () => {
    const frame = { close: vi.fn() }
    const postMessage = vi.fn()

    transferFrameToEncoderWorker({ postMessage }, frame, true)

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'encode', frame, keyFrame: true },
      [frame]
    )
    expect(frame.close).not.toHaveBeenCalled()
  })

  it('closes the sender-owned frame if transfer fails synchronously', () => {
    const frame = { close: vi.fn() }
    const worker = { postMessage: vi.fn(() => { throw new Error('worker terminated') }) }

    expect(() => transferFrameToEncoderWorker(worker, frame, false)).toThrow('worker terminated')
    expect(frame.close).toHaveBeenCalledOnce()
  })
})
