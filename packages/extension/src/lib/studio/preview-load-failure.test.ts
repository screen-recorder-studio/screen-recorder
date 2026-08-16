import { describe, expect, it, vi } from 'vitest'
import { createFirstFrameGate } from './first-frame-gate'
import {
  reportPreviewLoadFailure,
  runPreviewProcessing
} from './preview-load-failure'

describe('preview preprocessing failures', () => {
  it('routes unfixable chunks through the first-frame gate immediately', () => {
    const setWaiting = vi.fn()
    const onFailure = vi.fn()
    const gate = createFirstFrameGate({
      timeoutMs: 15_000,
      setWaiting,
      afterUpdate: () => Promise.resolve(),
      onVisible: vi.fn(),
      onFailure
    })
    gate.start()

    const code = reportPreviewLoadFailure(
      (errorCode) => gate.fail(errorCode),
      'invalid-chunks'
    )

    expect(code).toBe('STUDIO_PREVIEW_INVALID_CHUNKS')
    expect(setWaiting).toHaveBeenLastCalledWith(false)
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('STUDIO_PREVIEW_INVALID_CHUNKS')
  })

  it('classifies a rejected processVideo call and reports it without waiting for timeout', async () => {
    const onLoadError = vi.fn()
    const onProcessingError = vi.fn()
    const failure = new Error('worker post failed')

    await expect(runPreviewProcessing(
      async () => { throw failure },
      onLoadError,
      onProcessingError
    )).resolves.toBe(false)

    expect(onProcessingError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(onLoadError).toHaveBeenCalledExactlyOnceWith('STUDIO_PREVIEW_PROCESSING_FAILED')
  })

  it('does not report a failure when processing succeeds', async () => {
    const onLoadError = vi.fn()

    await expect(runPreviewProcessing(
      async () => {},
      onLoadError
    )).resolves.toBe(true)

    expect(onLoadError).not.toHaveBeenCalled()
  })
})
