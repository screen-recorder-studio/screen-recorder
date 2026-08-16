import { describe, expect, it, vi } from 'vitest'
import {
  buildFinalMeta,
  closeTakenResource,
  createFallbackDataCheckpointState,
  createSerialTaskQueue,
  createWriterLifecycle,
  createWriterProgressState,
  drainIndexLines,
  flushFallbackDataCheckpoint,
  flushInDurabilityOrder,
  recordWrittenChunk
} from './opfs-writer-state'

describe('OPFS writer progress state', () => {
  it('builds contiguous offsets and relative duration when the first timestamp is non-zero', () => {
    const first = recordWrittenChunk(createWriterProgressState(), {
      byteLength: 10,
      timestamp: 5_000_000,
      chunkType: 'key',
      isKeyframe: true,
      codedWidth: 1920,
      codedHeight: 1080,
      codec: 'vp8'
    })
    const second = recordWrittenChunk(first.state, {
      byteLength: 7,
      timestamp: 7_000_000,
      chunkType: 'delta',
      isKeyframe: false
    })

    expect(first.entry).toMatchObject({ offset: 0, size: 10, timestamp: 5_000_000, type: 'key' })
    expect(second.entry).toMatchObject({ offset: 10, size: 7, timestamp: 7_000_000, type: 'delta' })
    expect(buildFinalMeta({ id: 'rec-test' }, second.state)).toMatchObject({
      completed: true,
      totalBytes: 17,
      totalChunks: 2,
      duration: 2_000_000,
      firstTimestamp: 5_000_000,
      lastTimestamp: 7_000_000
    })
  })

  it('uses a zero duration for an empty recording', () => {
    expect(buildFinalMeta({}, createWriterProgressState())).toMatchObject({
      totalBytes: 0,
      totalChunks: 0,
      duration: 0,
      firstTimestamp: -1,
      lastTimestamp: -1
    })
  })

  it('preserves wall-clock duration for a valid static recording with one encoded frame', () => {
    const singleFrame = recordWrittenChunk(createWriterProgressState(), {
      byteLength: 1024,
      timestamp: 5_000_000,
      chunkType: 'key'
    })

    expect(buildFinalMeta({}, singleFrame.state, { wallClockDurationMs: 11_250 })).toMatchObject({
      totalChunks: 1,
      duration: 0,
      wallClockDurationMs: 11_250
    })
  })

  it('drains only pending index lines so a second flush cannot rewrite history', () => {
    const pending = ['first\n', 'second\n']
    expect(drainIndexLines(pending)).toBe('first\nsecond\n')
    expect(pending).toEqual([])
    pending.push('third\n')
    expect(drainIndexLines(pending)).toBe('third\n')
    expect(pending).toEqual([])
  })
})


describe('OPFS writer durability helpers', () => {
  it('flushes data before exposing the matching index checkpoint', async () => {
    const order: string[] = []

    await flushInDurabilityOrder(
      async () => { order.push('data') },
      async () => { order.push('index') }
    )

    expect(order).toEqual(['data', 'index'])
  })

  it('does not flush index when the data flush fails', async () => {
    const flushIndex = vi.fn()

    await expect(flushInDurabilityOrder(
      async () => { throw new Error('data flush failed') },
      flushIndex
    )).rejects.toThrow('data flush failed')

    expect(flushIndex).not.toHaveBeenCalled()
  })

  it('takes a resource before closing so a failed close cannot be retried', async () => {
    const close = vi.fn(async () => { throw new Error('close failed') })
    let resource: { id: number } | null = { id: 1 }
    const take = () => {
      const current = resource
      resource = null
      return current
    }

    await expect(closeTakenResource(take, close)).rejects.toThrow('close failed')
    await expect(closeTakenResource(take, close)).resolves.toBeUndefined()

    expect(resource).toBeNull()
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('OPFS writer message serialization', () => {
  it('runs asynchronously submitted messages in FIFO completion order', async () => {
    const queue = createSerialTaskQueue()
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

    const first = queue.enqueue(async () => {
      order.push('first:start')
      await firstGate
      order.push('first:end')
    })
    const second = queue.enqueue(async () => {
      order.push('second:start')
      order.push('second:end')
    })

    await Promise.resolve()
    expect(order).toEqual(['first:start'])

    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('continues with later cleanup after an earlier message rejects', async () => {
    const queue = createSerialTaskQueue()
    const cleanup = vi.fn()

    const failed = queue.enqueue(async () => { throw new Error('checkpoint failed') })
    const laterCleanup = queue.enqueue(cleanup)

    await expect(failed).rejects.toThrow('checkpoint failed')
    await expect(laterCleanup).resolves.toBeUndefined()
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

describe('OPFS writer lifecycle', () => {
  it('makes final close idempotent and rejects append after closing starts', () => {
    const lifecycle = createWriterLifecycle()

    expect(() => lifecycle.assertCanAppend()).toThrow('writer not initialized')
    lifecycle.markOpen()
    expect(() => lifecycle.assertCanAppend()).not.toThrow()

    expect(lifecycle.beginClose()).toBe(true)
    expect(() => lifecycle.assertCanAppend()).toThrow('writer already finalized')
    lifecycle.markClosed()

    expect(lifecycle.beginClose()).toBe(false)
    expect(() => lifecycle.assertCanAppend()).toThrow('writer already finalized')
  })
})


describe('OPFS fallback data checkpoints', () => {
  it('commits only pending bytes after the first checkpoint', async () => {
    const state = createFallbackDataCheckpointState()
    const writes: number[][] = []
    const seek = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const createWritable = vi.fn(async () => ({
      seek,
      write: async (part: Uint8Array) => { writes.push(Array.from(part)) },
      close,
      abort: vi.fn(async () => {})
    }))

    state.pendingParts.push(new Uint8Array([1, 2]), new Uint8Array([3]))
    await flushFallbackDataCheckpoint(state, createWritable)

    state.pendingParts.push(new Uint8Array([4, 5]))
    await flushFallbackDataCheckpoint(state, createWritable)

    expect(createWritable).toHaveBeenNthCalledWith(1, { keepExistingData: false })
    expect(createWritable).toHaveBeenNthCalledWith(2, { keepExistingData: true })
    expect(seek).toHaveBeenCalledExactlyOnceWith(3)
    expect(writes).toEqual([[1, 2], [3], [4, 5]])
    expect(state).toMatchObject({ committedOffset: 5, initialized: true, pendingParts: [] })
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('retains pending bytes and the committed offset when a checkpoint fails', async () => {
    const state = createFallbackDataCheckpointState()
    state.pendingParts.push(new Uint8Array([1, 2, 3]))
    const abort = vi.fn(async () => {})

    await expect(flushFallbackDataCheckpoint(state, async () => ({
      seek: vi.fn(async () => {}),
      write: vi.fn(async () => {}),
      close: async () => { throw new Error('commit failed') },
      abort
    }))).rejects.toThrow('commit failed')

    expect(abort).toHaveBeenCalledOnce()
    expect(state).toMatchObject({ committedOffset: 0, initialized: false })
    expect(state.pendingParts).toHaveLength(1)
    expect(Array.from(state.pendingParts[0])).toEqual([1, 2, 3])
  })
})
