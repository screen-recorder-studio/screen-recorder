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

interface AppendMouseMessage {
  type: 'append-mouse'
  event: {
    timestamp: number
    x: number
    y: number
    isInside?: boolean
  }
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

type SyncAccessHandle = {
  write(buffer: Uint8Array, options?: { at: number }): number
  flush(): void
  close(): void
}

let rootDir: FileSystemDirectoryHandle | null = null
let recDir: FileSystemDirectoryHandle | null = null
let dataHandle: FileSystemFileHandle | null = null
let dataSyncHandle: SyncAccessHandle | null = null
let dataOffset = 0
let pendingIndexLines: string[] = []
let chunksWritten = 0
let recordingId = ''
let initialMeta: any = {}

// ✅ 追踪实际时间戳
let firstTimestamp = -1
let lastTimestamp = -1

// Mouse tracking
let mouseHandle: FileSystemFileHandle | null = null
let mouseSyncHandle: SyncAccessHandle | null = null
let mouseBuffer: string[] = []
let mouseOffset = 0
let mouseEnabled = false
let mouseFallbackParts: Uint8Array[] = []
const MOUSE_FLUSH_THRESHOLD = 100

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
    dataOffset = 0
  } else {
    dataSyncHandle = null
    dataOffset = 0
    fallbackDataParts = []
  }
}

async function appendData(u8: Uint8Array) {
  if (dataSyncHandle) {
    // SyncAccessHandle.write() is synchronous and takes Uint8Array directly
    const written = dataSyncHandle.write(u8, { at: dataOffset })
    dataOffset += (typeof written === 'number' ? written : u8.byteLength)
  } else {
    // Fallback: keep in memory; will flush to file on finalize
    fallbackDataParts.push(u8)
    dataOffset += u8.byteLength
  }
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

async function flushMouse() {
  if (!mouseEnabled || mouseBuffer.length === 0) return
  const text = mouseBuffer.join('')
  mouseBuffer = []
  const encoder = new TextEncoder()
  const u8 = encoder.encode(text)

  if (mouseSyncHandle) {
    const written = mouseSyncHandle.write(u8, { at: mouseOffset })
    mouseOffset += (typeof written === 'number' ? written : u8.byteLength)
    return
  }

  // Fallback: keep in memory until finalize
  mouseFallbackParts.push(u8)
  mouseOffset += u8.byteLength
}

async function flushMouseFallbackToFile() {
  if (!mouseEnabled || !mouseHandle || mouseFallbackParts.length === 0) return
  const writable = await (mouseHandle as any).createWritable({ keepExistingData: false })
  for (const part of mouseFallbackParts) {
    await writable.write(part)
  }
  await writable.close()
  mouseFallbackParts = []
}

async function closeMouse() {
  if (!mouseEnabled) return
  try { await flushMouse() } catch {}
  if (mouseSyncHandle) {
    try { mouseSyncHandle.flush() } catch {}
    try { mouseSyncHandle.close() } catch {}
    mouseSyncHandle = null
    return
  }
  await flushMouseFallbackToFile()
}

self.onmessage = async (e: MessageEvent<InitMessage | AppendMessage | AppendMouseMessage | FlushMessage | FinalizeMessage>) => {
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
        fps: msg.meta?.fps,
        mouseTrackingEnabled: !!msg.meta?.mouseTrackingEnabled
      }
      await ensureRoot()
      await ensureRecDir(msg.id)
      await openDataFile()
      mouseEnabled = !!msg.meta?.mouseTrackingEnabled
      if (mouseEnabled) {
        try {
          mouseHandle = await recDir!.getFileHandle('mouse.jsonl', { create: true })
          const hasSync = typeof (mouseHandle as any).createSyncAccessHandle === 'function'
          if (hasSync) {
            mouseSyncHandle = await (mouseHandle as any).createSyncAccessHandle()
            mouseOffset = 0
          } else {
            mouseFallbackParts = []
            mouseOffset = 0
          }
        } catch (err) {
          mouseEnabled = false
          console.warn('[OPFS] Failed to init mouse writer:', err)
        }
      }
      await writeMeta(initialMeta)
      self.postMessage({ type: 'ready', id: msg.id } as ReadyEvent)
      return
    }

    if (msg.type === 'append') {
      if (!dataHandle) throw new Error('writer not initialized')
      const u8 = new Uint8Array(msg.buffer)
      await appendData(u8)

      // ✅ 追踪时间戳
      const ts = msg.timestamp ?? 0
      if (firstTimestamp === -1) firstTimestamp = ts
      lastTimestamp = ts

      await appendIndexLine(JSON.stringify({
        offset: dataOffset - u8.byteLength,
        size: u8.byteLength,
        timestamp: ts,
        type: msg.chunkType === 'key' ? 'key' : 'delta',
        codedWidth: msg.codedWidth,
        codedHeight: msg.codedHeight,
        codec: msg.codec,
        isKeyframe: !!msg.isKeyframe
      }) + '\n')
      chunksWritten++
      if (chunksWritten % 100 === 0) {
        self.postMessage({ type: 'progress', bytesWrittenTotal: dataOffset, chunksWritten } as WriterProgressEvent)
        try { await flushIndexToFile() } catch {}
      }
      return
    }

    if (msg.type === 'append-mouse') {
      if (!mouseEnabled) return
      try {
        mouseBuffer.push(JSON.stringify(msg.event) + '\n')
        if (mouseBuffer.length >= MOUSE_FLUSH_THRESHOLD) {
          await flushMouse()
        }
      } catch (err) {
        console.warn('[OPFS] Failed to append mouse event:', err)
      }
      return
    }

    if (msg.type === 'flush') {
      // flush() is synchronous
      try { dataSyncHandle?.flush() } catch {}
      try { await flushIndexToFile() } catch {}
      try { await flushMouse() } catch {}
      self.postMessage({ type: 'progress', bytesWrittenTotal: dataOffset, chunksWritten } as WriterProgressEvent)
      return
    }

    if (msg.type === 'finalize') {
      await flushIndexToFile()
      await closeData()
      await closeMouse()

      // ✅ 使用实际时长（最后chunk的timestamp）
      const actualDuration = lastTimestamp >= 0 ? lastTimestamp : 0

      console.log(`[OPFS] Finalize:`, {
        chunks: chunksWritten,
        bytes: dataOffset,
        firstTs: firstTimestamp,
        lastTs: lastTimestamp,
        duration: actualDuration
      })

      await writeMeta({
        ...initialMeta,
        completed: true,
        totalBytes: dataOffset,
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
