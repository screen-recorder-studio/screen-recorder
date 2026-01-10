// OPFS Writer Worker: stream-append encoded chunks into Origin Private File System
// Notes:
// - Prefer SyncAccessHandle (only available in Dedicated Worker)
// - Fallback to createWritable() on unsupported environments (append simulated on finalize)

interface InitMessage {
  type: 'init'
  id: string
  meta?: {
    codec?: string
    width?: number
    height?: number
    fps?: number
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
interface FinalizeMessage { type: 'finalize' }

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
let dataSyncHandle: any | null = null // FileSystemSyncAccessHandle (typed as any for TS lib compat)
let committedBytes = 0
let queuedBytes = 0
let pendingIndexLines: string[] = []
let chunksWritten = 0
let recordingId = ''
let initialMeta: any = {}

// ✅ Track actual timestamps
let firstTimestamp = -1
let lastTimestamp = -1

// ✅ Batch write buffering (0.5~1s)
const DATA_FLUSH_INTERVAL_MS = 700 // 700ms sits in the 0.5s~1s window to balance latency vs I/O
let pendingDataQueue: Array<{ offset: number; data: Uint8Array }> = []
let dataFlushTimer: ReturnType<typeof setTimeout> | null = null
let flushInFlight: Promise<void> | null = null

// Fallback buffers when SyncAccessHandle is unavailable; we flush to file on finalize
let fallbackDataParts: Uint8Array[] = []

async function ensureRoot() {
  // @ts-ignore - navigator in Worker is available
  const nav: any = self.navigator
  if (!nav?.storage?.getDirectory) throw new Error('OPFS not available in this context')
  rootDir = await nav.storage.getDirectory()
}

async function ensureRecDir(id: string) {
  if (!rootDir) await ensureRoot()
  recDir = await (rootDir as FileSystemDirectoryHandle).getDirectoryHandle(`rec_${id}`, { create: true })
}

async function writeMeta(partial: any) {
  if (!recDir) return
  const fh = await recDir.getFileHandle('meta.json', { create: true })
  const writable = await (fh as any).createWritable({ keepExistingData: false })
  const blob = new Blob([JSON.stringify(partial, null, 2)], { type: 'application/json' })
  await writable.write(blob)
  await writable.close()
}

async function appendIndexLine(line: string) {
  // Buffer in memory; write to file on flush/finalize to avoid append complexity without SyncAccessHandle
  pendingIndexLines.push(line)
}

async function flushIndexToFile() {
  if (!recDir || pendingIndexLines.length === 0) return
  const text = pendingIndexLines.join('')
  const fh = await recDir.getFileHandle('index.jsonl', { create: true })
  const writable = await (fh as any).createWritable({ keepExistingData: false })
  await writable.write(new Blob([text], { type: 'text/plain' }))
  await writable.close()
}

async function openDataFile() {
  if (!recDir) throw new Error('recDir not ready')
  dataHandle = await recDir.getFileHandle('data.bin', { create: true })
  const hasSync = typeof (dataHandle as any).createSyncAccessHandle === 'function'
  if (hasSync) {
    dataSyncHandle = await (dataHandle as any).createSyncAccessHandle()
    // start at 0
    committedBytes = 0
    queuedBytes = 0
  } else {
    dataSyncHandle = null
    committedBytes = 0
    queuedBytes = 0
    fallbackDataParts = []
  }
}

function scheduleDataFlush() {
  if (dataFlushTimer) return
  dataFlushTimer = setTimeout(() => {
    dataFlushTimer = null
    void flushPendingData().catch((err) => {
      console.error('[OPFS] buffered flush failed', err)
      const msg = err instanceof Error ? err.message : String(err)
      const ev: WriterErrorEvent = { type: 'error', code: 'OPFS_WRITE_ERROR', message: msg }
      try { self.postMessage(ev) } catch {}
    })
  }, DATA_FLUSH_INTERVAL_MS)
}

async function writePendingParts(parts: Array<{ offset: number; data: Uint8Array }>) {
  if (parts.length === 0) return
  const segments = parts.slice().sort((a, b) => a.offset - b.offset)
  if (dataSyncHandle) {
    let isContiguous = true
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1]
      const cur = segments[i]
      if (cur.offset !== prev.offset + prev.data.byteLength) { isContiguous = false; break }
    }
    if (isContiguous && segments.length > 1) {
      const total = segments.reduce((acc, p) => acc + p.data.byteLength, 0)
      const merged = new Uint8Array(total)
      let cursor = 0
      for (const p of segments) { merged.set(p.data, cursor); cursor += p.data.byteLength }
      const startOffset = segments[0].offset
      try { dataSyncHandle.write(merged, { at: startOffset }) } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        throw new Error(`[OPFS] data write failed at offset ${startOffset}, size ${merged.byteLength}: ${errMsg}`)
      }
    } else {
      for (const p of segments) {
        try { dataSyncHandle.write(p.data, { at: p.offset }) } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e)
          throw new Error(`[OPFS] data write failed at offset ${p.offset}, size ${p.data.byteLength}: ${errMsg}`)
        }
      }
    }
  } else {
    // Fallback: keep in memory; will flush to file on finalize
    for (const p of segments) fallbackDataParts.push(p.data)
  }
}

async function flushPendingData(force = false) {
  if (dataFlushTimer && force) { clearTimeout(dataFlushTimer); dataFlushTimer = null }
  if (flushInFlight) { await flushInFlight }
  if (pendingDataQueue.length === 0) return
  const parts = pendingDataQueue.splice(0, pendingDataQueue.length)
  const bytesToWrite = parts.reduce((acc, p) => acc + p.data.byteLength, 0)
  flushInFlight = (async () => {
    await writePendingParts(parts)
    // queuedBytes can grow while flushing; only fail if it ever drops below reserved bytes
    if (queuedBytes < bytesToWrite) {
      throw new Error(`[OPFS] queued bytes underflow detected (queued=${queuedBytes}, written=${bytesToWrite})`)
    } else {
      queuedBytes -= bytesToWrite
    }
    committedBytes += bytesToWrite
  })()
  await flushInFlight
  flushInFlight = null
}

async function flushDataFallback() {
  if (!dataHandle || fallbackDataParts.length === 0) return
  const writable = await (dataHandle as any).createWritable({ keepExistingData: false })
  for (const part of fallbackDataParts) {
    await writable.write(part)
  }
  await writable.close()
  fallbackDataParts = []
}

async function closeData() {
  if (dataSyncHandle) {
    // flush() and close() are synchronous methods
    try { dataSyncHandle.flush() } catch {}
    try { dataSyncHandle.close() } catch {}
    dataSyncHandle = null
  } else {
    await flushDataFallback()
  }
}

self.onmessage = async (e: MessageEvent<InitMessage | AppendMessage | FlushMessage | FinalizeMessage>) => {
  const msg: any = e.data
  try {
    if (msg.type === 'init') {
      recordingId = msg.id
      initialMeta = {
        id: `rec_${msg.id}`,
        createdAt: Date.now(),
        completed: false,
        codec: msg.meta?.codec,
        width: msg.meta?.width,
        height: msg.meta?.height,
        fps: msg.meta?.fps
      }
      await ensureRoot()
      await ensureRecDir(msg.id)
      await openDataFile()
      await writeMeta(initialMeta)
      self.postMessage({ type: 'ready', id: msg.id } as ReadyEvent)
      return
    }

    if (msg.type === 'append') {
      if (!dataHandle) throw new Error('writer not initialized')
      const u8 = new Uint8Array(msg.buffer)
      const startOffset = committedBytes + queuedBytes
      queuedBytes += u8.byteLength
      pendingDataQueue.push({ offset: startOffset, data: u8 })
      scheduleDataFlush()

      // ✅ 追踪时间戳
      const ts = msg.timestamp ?? 0
      if (firstTimestamp === -1) firstTimestamp = ts
      lastTimestamp = ts

      await appendIndexLine(JSON.stringify({
        offset: startOffset,
        size: u8.byteLength,
        timestamp: ts,
        type: msg.chunkType === 'key' ? 'key' : 'delta',
        codedWidth: msg.codedWidth,
        codedHeight: msg.codedHeight,
        codec: msg.codec,
        isKeyframe: !!msg.isKeyframe
      }) + '\n')
      chunksWritten++
      if (msg.chunkType === 'key' || msg.isKeyframe) {
        // 🔑 Flush keyframes immediately to avoid long-term accumulation
        await flushPendingData(true)
      }
      if (chunksWritten % 100 === 0) {
        self.postMessage({ type: 'progress', bytesWrittenTotal: committedBytes + queuedBytes, chunksWritten } as WriterProgressEvent)
        try { await flushIndexToFile() } catch {}
      }
      return
    }

    if (msg.type === 'flush') {
      // flush() is synchronous
      await flushPendingData(true)
      try { dataSyncHandle?.flush() } catch {}
      try { await flushIndexToFile() } catch {}
      self.postMessage({ type: 'progress', bytesWrittenTotal: committedBytes + queuedBytes, chunksWritten } as WriterProgressEvent)
      return
    }

    if (msg.type === 'finalize') {
      await flushPendingData(true)
      await flushIndexToFile()
      await closeData()

      // ✅ 使用实际时长（最后chunk的timestamp）
      const actualDuration = lastTimestamp >= 0 ? lastTimestamp : 0

      console.log(`[OPFS] Finalize:`, {
        chunks: chunksWritten,
        bytes: committedBytes + queuedBytes,
        firstTs: firstTimestamp,
        lastTs: lastTimestamp,
        duration: actualDuration
      })

      await writeMeta({
        ...initialMeta,
        completed: true,
        totalBytes: committedBytes + queuedBytes,
        totalChunks: chunksWritten,
        duration: actualDuration,  // ✅ 实际时长
        firstTimestamp,
        lastTimestamp
      })

      self.postMessage({ type: 'finalized', id: recordingId } as FinalizedEvent)
      return
    }
  } catch (err: any) {
    const ev: WriterErrorEvent = { type: 'error', code: 'OPFS_WRITE_ERROR', message: err?.message || String(err) }
    try { self.postMessage(ev) } catch {}
  }
}

self.addEventListener('error', (ev: any) => {
  const msg: WriterErrorEvent = { type: 'error', code: 'WORKER_ERROR', message: ev?.message || 'Unknown worker error' }
  try { self.postMessage(msg) } catch {}
})
