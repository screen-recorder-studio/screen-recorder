export interface WriterProgressState {
  dataOffset: number
  chunksWritten: number
  firstTimestamp: number
  lastTimestamp: number
}

export interface WrittenChunkInput {
  byteLength: number
  timestamp?: number
  chunkType?: 'key' | 'delta'
  codedWidth?: number
  codedHeight?: number
  codec?: string
  isKeyframe?: boolean
}

export interface IndexEntry {
  offset: number
  size: number
  timestamp: number
  type: 'key' | 'delta'
  codedWidth?: number
  codedHeight?: number
  codec?: string
  isKeyframe: boolean
}

export function createWriterProgressState(): WriterProgressState {
  return {
    dataOffset: 0,
    chunksWritten: 0,
    firstTimestamp: -1,
    lastTimestamp: -1
  }
}

export function recordWrittenChunk(
  state: WriterProgressState,
  input: WrittenChunkInput
): { state: WriterProgressState; entry: IndexEntry } {
  const size = Math.max(0, Math.floor(input.byteLength))
  const timestamp = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : 0
  const isKeyframe = input.isKeyframe === true || input.chunkType === 'key'
  const entry: IndexEntry = {
    offset: state.dataOffset,
    size,
    timestamp,
    type: isKeyframe ? 'key' : 'delta',
    codedWidth: input.codedWidth,
    codedHeight: input.codedHeight,
    codec: input.codec,
    isKeyframe
  }
  return {
    entry,
    state: {
      dataOffset: state.dataOffset + size,
      chunksWritten: state.chunksWritten + 1,
      firstTimestamp: state.firstTimestamp < 0 ? timestamp : state.firstTimestamp,
      lastTimestamp: timestamp
    }
  }
}

export function drainIndexLines(lines: string[]): string {
  if (lines.length === 0) return ''
  return lines.splice(0, lines.length).join('')
}

export function buildFinalMeta(
  initialMeta: Record<string, unknown>,
  state: WriterProgressState,
  options: { wallClockDurationMs?: number } = {}
) {
  const duration = state.firstTimestamp >= 0 && state.lastTimestamp >= state.firstTimestamp
    ? state.lastTimestamp - state.firstTimestamp
    : 0
  return {
    ...initialMeta,
    completed: true,
    totalBytes: state.dataOffset,
    totalChunks: state.chunksWritten,
    duration,
    wallClockDurationMs: normalizeDurationMs(options.wallClockDurationMs),
    firstTimestamp: state.firstTimestamp,
    lastTimestamp: state.lastTimestamp
  }
}

function normalizeDurationMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}


export async function flushInDurabilityOrder(
  flushData: () => void | Promise<void>,
  flushIndex: () => void | Promise<void>
): Promise<void> {
  await flushData()
  await flushIndex()
}

export async function closeTakenResource<T>(
  take: () => T | null,
  close: (resource: T) => void | Promise<void>
): Promise<void> {
  const resource = take()
  if (resource === null) return
  await close(resource)
}

export interface SerialTaskQueue {
  enqueue<T>(task: () => T | PromiseLike<T>): Promise<T>
}

export function createSerialTaskQueue(): SerialTaskQueue {
  let tail: Promise<void> = Promise.resolve()

  return {
    enqueue<T>(task: () => T | PromiseLike<T>): Promise<T> {
      const result = tail.then(task)
      tail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
  }
}

export type WriterLifecyclePhase = 'idle' | 'open' | 'closing' | 'closed'

export interface WriterLifecycle {
  reset(): void
  markOpen(): void
  assertCanAppend(): void
  beginClose(): boolean
  markClosed(): void
  isClosed(): boolean
}

export function createWriterLifecycle(): WriterLifecycle {
  let phase: WriterLifecyclePhase = 'idle'

  return {
    reset() {
      phase = 'idle'
    },
    markOpen() {
      phase = 'open'
    },
    assertCanAppend() {
      if (phase === 'open') return
      if (phase === 'idle') throw new Error('writer not initialized')
      throw new Error('writer already finalized')
    },
    beginClose() {
      if (phase === 'idle' || phase === 'closed') return false
      phase = 'closing'
      return true
    },
    markClosed() {
      phase = 'closed'
    },
    isClosed() {
      return phase === 'closed'
    }
  }
}


export interface FallbackDataCheckpointState {
  pendingParts: Uint8Array[]
  committedOffset: number
  initialized: boolean
}

export interface FallbackDataWritable {
  seek(position: number): void | Promise<void>
  write(data: Uint8Array): void | Promise<void>
  close(): void | Promise<void>
  abort?(): void | Promise<void>
}

export function createFallbackDataCheckpointState(): FallbackDataCheckpointState {
  return {
    pendingParts: [],
    committedOffset: 0,
    initialized: false
  }
}

export async function flushFallbackDataCheckpoint(
  state: FallbackDataCheckpointState,
  createWritable: (options: { keepExistingData: boolean }) => Promise<FallbackDataWritable>
): Promise<void> {
  if (state.initialized && state.pendingParts.length === 0) return

  const pendingSnapshot = state.pendingParts.slice()
  const writable = await createWritable({ keepExistingData: state.initialized })

  try {
    if (state.initialized) await writable.seek(state.committedOffset)
    for (const part of pendingSnapshot) await writable.write(part)
    await writable.close()
  } catch (error) {
    try { await writable.abort?.() } catch {}
    throw error
  }

  state.pendingParts.splice(0, pendingSnapshot.length)
  state.committedOffset += pendingSnapshot.reduce((total, part) => total + part.byteLength, 0)
  state.initialized = true
}
