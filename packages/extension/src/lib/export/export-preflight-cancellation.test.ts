import { describe, expect, it, vi } from 'vitest'
import { createExportPreflightCancellation } from './export-preflight-cancellation'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('export preflight cancellation', () => {
  it('prevents worker startup when cancellation is requested while preflight is pending', async () => {
    const preflight = deferred()
    const cancellation = createExportPreflightCancellation()
    const startExport = vi.fn(async () => {})

    const operation = (async () => {
      await preflight.promise
      cancellation.throwIfRequested()
      await startExport()
    })()

    expect(cancellation.request()).toBe(true)
    preflight.resolve()

    await expect(operation).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' })
    expect(startExport).not.toHaveBeenCalled()
  })

  it('starts once when preflight completes without cancellation', async () => {
    const cancellation = createExportPreflightCancellation()
    const startExport = vi.fn(async () => {})

    cancellation.throwIfRequested()
    await startExport()

    expect(startExport).toHaveBeenCalledOnce()
    expect(cancellation.request()).toBe(true)
    expect(cancellation.request()).toBe(false)
  })
})
