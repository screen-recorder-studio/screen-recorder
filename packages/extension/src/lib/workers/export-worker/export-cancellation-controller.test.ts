import { describe, expect, it, vi } from 'vitest'
import { ExportCancellationController } from './export-cancellation-controller'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('ExportCancellationController', () => {
  it('waits for Output.cancel and partial OPFS cleanup before resolving', async () => {
    const order: string[] = []
    const outputCancelled = deferred()
    const partialRemoved = deferred()
    const controller = new ExportCancellationController()
    controller.register({
      output: Promise.resolve({
        cancel: async () => {
          order.push('output.cancel:start')
          await outputCancelled.promise
          order.push('output.cancel:done')
        }
      }),
      closeVideoSource: () => { order.push('video-source:closed') },
      discardPartialOutput: async () => {
        order.push('opfs-remove:start')
        await partialRemoved.promise
        order.push('opfs-remove:done')
      }
    })

    let resolved = false
    const cancellation = controller.request().then(() => { resolved = true })
    await vi.waitFor(() => expect(order).toEqual(['output.cancel:start']))
    expect(resolved).toBe(false)

    outputCancelled.resolve()
    await vi.waitFor(() => expect(order).toEqual([
      'output.cancel:start',
      'output.cancel:done',
      'video-source:closed',
      'opfs-remove:start'
    ]))
    expect(resolved).toBe(false)

    partialRemoved.resolve()
    await cancellation
    expect(resolved).toBe(true)
    expect(order.at(-1)).toBe('opfs-remove:done')
  })

  it('attempts partial-output cleanup even when Output.cancel fails', async () => {
    const discardPartialOutput = vi.fn(async () => {})
    const controller = new ExportCancellationController()
    controller.register({
      output: Promise.resolve({ cancel: async () => { throw new Error('cancel failed') } }),
      discardPartialOutput
    })

    await expect(controller.request()).rejects.toThrow('cancel failed')
    expect(discardPartialOutput).toHaveBeenCalledOnce()
  })

  it('coalesces duplicate cancellation requests', async () => {
    const outputCancelled = deferred()
    const cancel = vi.fn(async () => { await outputCancelled.promise })
    const controller = new ExportCancellationController()
    controller.register({ output: Promise.resolve({ cancel }) })

    const first = controller.request()
    const second = controller.request()
    outputCancelled.resolve()

    await Promise.all([first, second])
    expect(cancel).toHaveBeenCalledOnce()
  })
})


it('retains the active resource after cleanup failure so cancellation can be retried', async () => {
  const discardPartialOutput = vi.fn()
    .mockRejectedValueOnce(new Error('remove failed'))
    .mockResolvedValueOnce(undefined)
  const cancel = vi.fn(async () => {})
  const controller = new ExportCancellationController()
  controller.register({
    output: Promise.resolve({ cancel }),
    discardPartialOutput
  })

  await expect(controller.request()).rejects.toThrow('remove failed')
  await expect(controller.request()).resolves.toBeUndefined()

  expect(discardPartialOutput).toHaveBeenCalledTimes(2)
  expect(cancel).toHaveBeenCalledTimes(2)
})