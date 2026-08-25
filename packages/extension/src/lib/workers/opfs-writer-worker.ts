// OPFS Writer Worker: stream-append encoded chunks into Origin Private File System
// Notes:
// - Prefer SyncAccessHandle in this Dedicated Worker.
// - Keep index writes incremental; never rewrite the complete JSONL history.

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
  recordWrittenChunk,
  type WriterProgressState
} from './opfs-writer-state'

interface InitMessage {
  type: 'init'
  id: string
  meta?: {
    codec?: string
    width?: number
    height?: number
    fps?: number
    intent?: 'video' | 'gif'
    capture?: Record<string, unknown>
  }
}

interface AppendMessage {
  type: 'append'
  buffer: ArrayBuffer
  timestamp?: number
  chunkType?: 'key' | 'delta'
  codedWidth?: number
  codedHeight?: number
  codec?: string
  isKeyframe?: boolean
}

interface FlushMessage { type: 'flush' }
interface FinalizeMessage { type: 'finalize'; wallClockDurationMs?: number }

interface WriterProgressEvent {
  type: 'progress'
  bytesWrittenTotal: number
  chunksWritten: number
}

interface WriterErrorEvent {
  type: 'error'
  code: string
  message: string
}

interface ReadyEvent { type: 'ready'; id: string }
interface FinalizedEvent { type: 'finalized'; id: string }

let rootDir: FileSystemDirectoryHandle | null = null
let recDir: FileSystemDirectoryHandle | null = null
let dataHandle: FileSystemFileHandle | null = null
let dataSyncHandle: any | null = null
let indexSyncHandle: any | null = null
let indexWritable: any | null = null
let indexOffset = 0
let pendingIndexLines: string[] = []
let writerState: WriterProgressState = createWriterProgressState()
let recordingId = ''
let initialMeta: Record<string, unknown> = {}
let fallbackDataState = createFallbackDataCheckpointState()
let finalMetaWritten = false

const textEncoder = new TextEncoder()
const writerLifecycle = createWriterLifecycle()
const messageQueue = createSerialTaskQueue()

async function ensureRoot() {
  const nav: any = self.navigator
  if (!nav?.storage?.getDirectory) throw new Error('OPFS not available in this context')
  rootDir = await nav.storage.getDirectory()
}

async function ensureRecDir(id: string) {
  if (!rootDir) await ensureRoot()
  recDir = await (rootDir as FileSystemDirectoryHandle).getDirectoryHandle(`rec_${id}`, { create: true })
}

async function writeMeta(meta: Record<string, unknown>) {
  if (!recDir) return
  const fileHandle = await recDir.getFileHandle('meta.json', { create: true })
  const writable = await (fileHandle as any).createWritable({ keepExistingData: false })
  await writable.write(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }))
  await writable.close()
}

async function openIndexFile() {
  if (!recDir) throw new Error('recDir not ready')
  const fileHandle = await recDir.getFileHandle('index.jsonl', { create: true })
  indexOffset = 0
  if (typeof (fileHandle as any).createSyncAccessHandle === 'function') {
    indexSyncHandle = await (fileHandle as any).createSyncAccessHandle()
    indexSyncHandle.truncate(0)
    indexWritable = null
  } else {
    indexSyncHandle = null
    indexWritable = await (fileHandle as any).createWritable({ keepExistingData: false })
  }
}

async function appendIndexText(text: string) {
  if (!text) return
  const bytes = textEncoder.encode(text)
  if (indexSyncHandle) {
    const written = indexSyncHandle.write(bytes, { at: indexOffset })
    if (written !== bytes.byteLength) throw new Error(`Partial index write: ${written}/${bytes.byteLength}`)
  } else if (indexWritable) {
    await indexWritable.write(bytes)
  } else {
    throw new Error('index writer not initialized')
  }
  indexOffset += bytes.byteLength
}

async function flushIndexToFile() {
  const text = drainIndexLines(pendingIndexLines)
  if (!text) return
  try {
    await appendIndexText(text)
    indexSyncHandle?.flush()
  } catch (error) {
    pendingIndexLines.unshift(text)
    throw error
  }
}

async function closeIndex(flushPending = true) {
  if (flushPending) await flushIndexToFile()
  else pendingIndexLines = []

  await closeTakenResource(
    () => {
      const handle = indexSyncHandle
      indexSyncHandle = null
      return handle
    },
    (handle) => {
      try { handle.flush() } finally { handle.close() }
    }
  )

  await closeTakenResource(
    () => {
      const writable = indexWritable
      indexWritable = null
      return writable
    },
    (writable) => writable.close()
  )
}

async function openDataFile() {
  if (!recDir) throw new Error('recDir not ready')
  dataHandle = await recDir.getFileHandle('data.bin', { create: true })
  if (typeof (dataHandle as any).createSyncAccessHandle === 'function') {
    dataSyncHandle = await (dataHandle as any).createSyncAccessHandle()
    dataSyncHandle.truncate(0)
  } else {
    dataSyncHandle = null
  }
  fallbackDataState = createFallbackDataCheckpointState()
  writerLifecycle.markOpen()
}

async function appendData(bytes: Uint8Array, offset: number) {
  if (dataSyncHandle) {
    const written = dataSyncHandle.write(bytes, { at: offset })
    if (written !== bytes.byteLength) throw new Error(`Partial data write: ${written}/${bytes.byteLength}`)
  } else {
    fallbackDataState.pendingParts.push(bytes)
  }
}

async function flushDataFallback() {
  const handle = dataHandle
  if (!handle) return
  await flushFallbackDataCheckpoint(
    fallbackDataState,
    (options) => (handle as any).createWritable(options)
  )
}

async function flushDataCheckpoint() {
  if (dataSyncHandle) {
    dataSyncHandle.flush()
    return
  }
  await flushDataFallback()
}

async function flushWriterCheckpoint() {
  await flushInDurabilityOrder(flushDataCheckpoint, flushIndexToFile)
}

async function closeData() {
  if (!dataHandle && !dataSyncHandle) return

  if (dataSyncHandle) {
    await closeTakenResource(
      () => {
        const handle = dataSyncHandle
        dataSyncHandle = null
        return handle
      },
      (handle) => {
        try { handle.flush() } finally { handle.close() }
      }
    )
  } else {
    await flushDataFallback()
  }

  dataHandle = null
  fallbackDataState = createFallbackDataCheckpointState()
}

async function closeWriterFiles() {
  if (!writerLifecycle.beginClose()) return

  try {
    await closeData()
  } catch (dataError) {
    // Never publish pending index entries when their data durability is unknown.
    try { await closeIndex(false) } catch {}
    throw dataError
  }
  await closeIndex()
  writerLifecycle.markClosed()
}

async function resetForInit() {
  try { await closeWriterFiles() } catch {}
  writerLifecycle.reset()
  recDir = null
  dataHandle = null
  dataSyncHandle = null
  indexSyncHandle = null
  indexWritable = null
  indexOffset = 0
  pendingIndexLines = []
  fallbackDataState = createFallbackDataCheckpointState()
  writerState = createWriterProgressState()
  recordingId = ''
  initialMeta = {}
  finalMetaWritten = false
}

async function checkStorageSpace(): Promise<boolean> {
  try {
    const nav: any = self.navigator
    if (!nav?.storage?.estimate) return true
    const estimate = await nav.storage.estimate()
    const usage = estimate.usage || 0
    const quota = estimate.quota || 0
    const available = quota - usage
    const minimumErrorBytes = 50 * 1024 * 1024
    const minimumWarningBytes = 100 * 1024 * 1024
    if (available < minimumErrorBytes) {
      self.postMessage({
        type: 'error',
        code: 'STORAGE_LOW',
        message: `Storage critically low: ${Math.round(available / 1024 / 1024)}MB remaining`
      } as WriterErrorEvent)
      return false
    }
    if (available < minimumWarningBytes) {
      self.postMessage({
        type: 'warning',
        code: 'STORAGE_LOW_WARNING',
        availableSpace: available,
        message: `Storage space low: ${Math.round(available / 1024 / 1024)}MB remaining`
      })
    }
  } catch {}
  return true
}

async function handleWriterMessage(event: MessageEvent<InitMessage | AppendMessage | FlushMessage | FinalizeMessage>) {
  const message: any = event.data
  try {
    if (message.type === 'init') {
      await resetForInit()
      recordingId = message.id
      initialMeta = {
        id: `rec_${message.id}`,
        createdAt: Date.now(),
        completed: false,
        codec: message.meta?.codec,
        width: message.meta?.width,
        height: message.meta?.height,
        fps: message.meta?.fps,
        intent: message.meta?.intent === 'gif' ? 'gif' : 'video',
        ...(message.meta?.capture ? { capture: message.meta.capture } : {}),
        timelineVersion: 2,
        timestampBasis: 'recording-active-us'
      }
      await ensureRoot()
      await ensureRecDir(message.id)
      await openDataFile()
      await openIndexFile()
      await writeMeta(initialMeta)

      if (!(await checkStorageSpace())) {
        try { await closeWriterFiles() } catch {}
        return
      }

      self.postMessage({ type: 'ready', id: message.id } as ReadyEvent)
      return
    }

    if (message.type === 'append') {
      writerLifecycle.assertCanAppend()
      const bytes = new Uint8Array(message.buffer)
      const recorded = recordWrittenChunk(writerState, {
        byteLength: bytes.byteLength,
        timestamp: message.timestamp,
        chunkType: message.chunkType,
        codedWidth: message.codedWidth,
        codedHeight: message.codedHeight,
        codec: message.codec,
        isKeyframe: message.isKeyframe
      })
      await appendData(bytes, recorded.entry.offset)
      writerState = recorded.state
      pendingIndexLines.push(`${JSON.stringify(recorded.entry)}\n`)

      if (writerState.chunksWritten % 100 === 0) {
        await flushWriterCheckpoint()
        self.postMessage({
          type: 'progress',
          bytesWrittenTotal: writerState.dataOffset,
          chunksWritten: writerState.chunksWritten
        } as WriterProgressEvent)
      }
      return
    }

    if (message.type === 'flush') {
      writerLifecycle.assertCanAppend()
      await flushWriterCheckpoint()
      self.postMessage({
        type: 'progress',
        bytesWrittenTotal: writerState.dataOffset,
        chunksWritten: writerState.chunksWritten
      } as WriterProgressEvent)
      return
    }

    if (message.type === 'finalize') {
      if (!recordingId) throw new Error('writer not initialized')
      await closeWriterFiles()
      if (!finalMetaWritten) {
        await writeMeta(buildFinalMeta(initialMeta, writerState, {
          wallClockDurationMs: message.wallClockDurationMs
        }))
        finalMetaWritten = true
      }
      self.postMessage({ type: 'finalized', id: recordingId } as FinalizedEvent)
    }
  } catch (error: any) {
    try { await closeWriterFiles() } catch {}
    const response: WriterErrorEvent = {
      type: 'error',
      code: 'OPFS_WRITE_ERROR',
      message: error?.message || String(error)
    }
    try { self.postMessage(response) } catch {}
  }
}

self.onmessage = (event: MessageEvent<InitMessage | AppendMessage | FlushMessage | FinalizeMessage>) => {
  void messageQueue.enqueue(() => handleWriterMessage(event))
}

self.addEventListener('error', (event: any) => {
  const message: WriterErrorEvent = {
    type: 'error',
    code: 'WORKER_ERROR',
    message: event?.message || 'Unknown worker error'
  }
  try { self.postMessage(message) } catch {}
})
