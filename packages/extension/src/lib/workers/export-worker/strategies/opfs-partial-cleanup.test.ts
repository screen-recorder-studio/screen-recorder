import { describe, expect, it, vi } from 'vitest'
import { Mp4Strategy } from './mp4'
import { WebmStrategy } from './webm'

describe.each([
  ['MP4', () => new Mp4Strategy()],
  ['WebM', () => new WebmStrategy()]
] as const)('%s partial OPFS cleanup', (_format, createStrategy) => {
  it('aborts the writable before deleting the incomplete file and is idempotent', async () => {
    const order: string[] = []
    const abort = vi.fn(async () => { order.push('abort') })
    const removeEntry = vi.fn(async () => { order.push('remove') })
    const strategy = createStrategy()
    Object.assign(strategy as object, {
      opfsWritable: { abort },
      opfsDirectoryHandle: { removeEntry },
      opfsFileHandle: {},
      opfsFileName: 'partial-export.bin'
    })

    await strategy.discardPartialOutput()
    await strategy.discardPartialOutput()

    expect(order).toEqual(['abort', 'remove'])
    expect(removeEntry).toHaveBeenCalledExactlyOnceWith('partial-export.bin')
  })
})


describe.each([
  ['MP4', () => new Mp4Strategy()],
  ['WebM', () => new WebmStrategy()]
] as const)('%s retryable partial OPFS cleanup', (_format, createStrategy) => {
  it('retains the file identity when deletion fails and retries it', async () => {
    const removeEntry = vi.fn()
      .mockRejectedValueOnce(new Error('OPFS file is temporarily locked'))
      .mockResolvedValueOnce(undefined)
    const strategy = createStrategy()
    Object.assign(strategy as object, {
      opfsDirectoryHandle: { removeEntry },
      opfsFileHandle: {},
      opfsFileName: 'partial-export.bin'
    })

    await expect(strategy.discardPartialOutput()).rejects.toThrow('temporarily locked')
    await expect(strategy.discardPartialOutput()).resolves.toBeUndefined()

    expect(removeEntry).toHaveBeenCalledTimes(2)
    expect(removeEntry).toHaveBeenNthCalledWith(1, 'partial-export.bin')
    expect(removeEntry).toHaveBeenNthCalledWith(2, 'partial-export.bin')
  })

  it('treats NotFoundError as an already-clean result', async () => {
    const notFound = Object.assign(new Error('missing'), { name: 'NotFoundError' })
    const removeEntry = vi.fn().mockRejectedValue(notFound)
    const strategy = createStrategy()
    Object.assign(strategy as object, {
      opfsDirectoryHandle: { removeEntry },
      opfsFileHandle: {},
      opfsFileName: 'partial-export.bin'
    })

    await expect(strategy.discardPartialOutput()).resolves.toBeUndefined()
    await expect(strategy.discardPartialOutput()).resolves.toBeUndefined()
    expect(removeEntry).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent cleanup calls onto one deletion', async () => {
    let releaseRemoval!: () => void
    const removalGate = new Promise<void>((resolve) => { releaseRemoval = resolve })
    const removeEntry = vi.fn(async () => { await removalGate })
    const strategy = createStrategy()
    Object.assign(strategy as object, {
      opfsDirectoryHandle: { removeEntry },
      opfsFileHandle: {},
      opfsFileName: 'partial-export.bin'
    })

    const first = strategy.discardPartialOutput()
    const second = strategy.discardPartialOutput()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(removeEntry).toHaveBeenCalledOnce())

    releaseRemoval()
    await Promise.all([first, second])
    expect(removeEntry).toHaveBeenCalledOnce()
  })
})