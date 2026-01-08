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
let dataOffset = 0
let pendingIndexLines: string[] = []
let chunksWritten = 0
let recordingId = ''
let initialMeta: any = {}

// ✅ 追踪实际时间戳
let firstTimestamp = -1
let lastTimestamp = -1

// Camera track handles
let cameraDataHandle: FileSystemFileHandle | null = null
let cameraSyncHandle: any | null = null
let cameraOffset = 0
let cameraIndexHandle: FileSystemFileHandle | null = null
let cameraIndexBuffer: string[] = []
let cameraChunksWritten = 0
let cameraFirstTimestamp = -1
let cameraLastTimestamp = -1

// Audio track handles
let audioDataHandle: FileSystemFileHandle | null = null
let audioSyncHandle: any | null = null
let audioOffset = 0
let audioIndexHandle: FileSystemFileHandle | null = null
let audioIndexBuffer: string[] = []
let audioChunksWritten = 0
let audioFirstTimestamp = -1
let audioLastTimestamp = -1

// Fallback buffers when SyncAccessHandle is unavailable; we flush to file on finalize
let fallbackDataParts: Uint8Array[] = []
let cameraFallbackParts: Uint8Array[] = []
let audioFallbackParts: Uint8Array[] = []

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

async function flushCameraIndex() {
  if (!recDir || cameraIndexBuffer.length === 0) return
  const text = cameraIndexBuffer.join('')
  const fh = await recDir.getFileHandle('camera-index.jsonl', { create: true })
  const writable = await (fh as any).createWritable({ keepExistingData: false })
  await writable.write(new Blob([text], { type: 'text/plain' }))
  await writable.close()
}

async function flushAudioIndex() {
  if (!recDir || audioIndexBuffer.length === 0) return
  const text = audioIndexBuffer.join('')
  const fh = await recDir.getFileHandle('audio-index.jsonl', { create: true })
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

async function openCameraFiles() {
  if (!recDir) throw new Error('recDir not ready')
  cameraDataHandle = await recDir.getFileHandle('camera.bin', { create: true })
  const hasSync = typeof (cameraDataHandle as any).createSyncAccessHandle === 'function'
  if (hasSync) {
    cameraSyncHandle = await (cameraDataHandle as any).createSyncAccessHandle()
    cameraOffset = 0
  } else {
    cameraSyncHandle = null
    cameraOffset = 0
    cameraFallbackParts = []
  }
  cameraIndexHandle = await recDir.getFileHandle('camera-index.jsonl', { create: true })
}

async function appendCameraData(u8: Uint8Array) {
  if (cameraSyncHandle) {
    const written = cameraSyncHandle.write(u8, { at: cameraOffset })
    cameraOffset += (typeof written === 'number' ? written : u8.byteLength)
  } else {
    cameraFallbackParts.push(u8)
    cameraOffset += u8.byteLength
  }
}

async function flushCameraFallback() {
  if (!cameraDataHandle || cameraFallbackParts.length === 0) return
  const writable = await (cameraDataHandle as any).createWritable({ keepExistingData: false })
  for (const part of cameraFallbackParts) {
    await writable.write(part)
  }
  await writable.close()
  cameraFallbackParts = []
}

async function closeCameraData() {
  if (cameraSyncHandle) {
    try { cameraSyncHandle.flush() } catch {}
    try { cameraSyncHandle.close() } catch {}
    cameraSyncHandle = null
  } else {
    await flushCameraFallback()
  }
}

async function openAudioFiles() {
  if (!recDir) throw new Error('recDir not ready')
  audioDataHandle = await recDir.getFileHandle('audio.bin', { create: true })
  const hasSync = typeof (audioDataHandle as any).createSyncAccessHandle === 'function'
  if (hasSync) {
    audioSyncHandle = await (audioDataHandle as any).createSyncAccessHandle()
    audioOffset = 0
  } else {
    audioSyncHandle = null
    audioOffset = 0
    audioFallbackParts = []
  }
  audioIndexHandle = await recDir.getFileHandle('audio-index.jsonl', { create: true })
}

async function appendAudioData(u8: Uint8Array) {
  if (audioSyncHandle) {
    const written = audioSyncHandle.write(u8, { at: audioOffset })
    audioOffset += (typeof written === 'number' ? written : u8.byteLength)
  } else {
    audioFallbackParts.push(u8)
    audioOffset += u8.byteLength
  }
}

async function flushAudioFallback() {
  if (!audioDataHandle || audioFallbackParts.length === 0) return
  const writable = await (audioDataHandle as any).createWritable({ keepExistingData: false })
  for (const part of audioFallbackParts) {
    await writable.write(part)
  }
  await writable.close()
  audioFallbackParts = []
}

async function closeAudioData() {
  if (audioSyncHandle) {
    try { audioSyncHandle.flush() } catch {}
    try { audioSyncHandle.close() } catch {}
    audioSyncHandle = null
  } else {
    await flushAudioFallback()
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
        fps: msg.meta?.fps,
        camera: msg.meta?.camera,
        audio: msg.meta?.audio
      }
      pendingIndexLines = []
      chunksWritten = 0
      firstTimestamp = -1
      lastTimestamp = -1
      fallbackDataParts = []
      cameraOffset = 0
      cameraChunksWritten = 0
      cameraFirstTimestamp = -1
      cameraLastTimestamp = -1
      cameraIndexBuffer = []
      audioOffset = 0
      audioChunksWritten = 0
      audioFirstTimestamp = -1
      audioLastTimestamp = -1
      audioIndexBuffer = []
      await ensureRoot()
      await ensureRecDir(msg.id)
      await openDataFile()
      await openCameraFiles()
      await openAudioFiles()
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

    if (msg.type === 'append-camera') {
      if (!cameraDataHandle) throw new Error('camera writer not initialized')
      const u8 = new Uint8Array(msg.buffer)
      const startOffset = cameraOffset
      await appendCameraData(u8)

      const ts = msg.timestamp ?? 0
      if (cameraFirstTimestamp === -1) cameraFirstTimestamp = ts
      cameraLastTimestamp = ts

      cameraIndexBuffer.push(JSON.stringify({
        offset: startOffset,
        size: u8.byteLength,
        timestamp: ts,
        type: msg.chunkType === 'key' ? 'key' : 'delta',
        isKeyframe: !!msg.isKeyframe
      }) + '\n')
      cameraChunksWritten++
      if (cameraChunksWritten % 100 === 0) {
        try { await flushCameraIndex() } catch {}
      }
      return
    }

    if (msg.type === 'append-audio') {
      if (!audioDataHandle) throw new Error('audio writer not initialized')
      const u8 = new Uint8Array(msg.buffer)
      const startOffset = audioOffset
      await appendAudioData(u8)

      const ts = msg.timestamp ?? 0
      if (audioFirstTimestamp === -1) audioFirstTimestamp = ts
      audioLastTimestamp = ts

      audioIndexBuffer.push(JSON.stringify({
        offset: startOffset,
        size: u8.byteLength,
        timestamp: ts,
        duration: msg.duration ?? 0
      }) + '\n')
      audioChunksWritten++
      if (audioChunksWritten % 100 === 0) {
        try { await flushAudioIndex() } catch {}
      }
      return
    }

    if (msg.type === 'flush') {
      // flush() is synchronous
      try { dataSyncHandle?.flush() } catch {}
      try { await flushIndexToFile() } catch {}
      try { await flushCameraIndex() } catch {}
      try { await flushAudioIndex() } catch {}
      self.postMessage({ type: 'progress', bytesWrittenTotal: dataOffset, chunksWritten } as WriterProgressEvent)
      return
    }

    if (msg.type === 'finalize') {
      await flushIndexToFile()
      await closeData()
      try { await flushCameraIndex() } catch {}
      try { await closeCameraData() } catch {}
      try { await flushAudioIndex() } catch {}
      try { await closeAudioData() } catch {}

      // ✅ 使用实际时长（最后chunk的timestamp）
      const actualDuration = lastTimestamp >= 0 ? lastTimestamp : 0
      const cameraDuration = cameraLastTimestamp >= 0 ? cameraLastTimestamp : 0
      const audioDuration = audioLastTimestamp >= 0 ? audioLastTimestamp : 0

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
        lastTimestamp,
        camera: (initialMeta?.camera || cameraChunksWritten > 0) ? {
          ...(initialMeta?.camera || {}),
          totalBytes: cameraOffset,
          totalChunks: cameraChunksWritten,
          firstTimestamp: cameraFirstTimestamp,
          lastTimestamp: cameraLastTimestamp,
          duration: cameraDuration
        } : undefined,
        audio: (initialMeta?.audio || audioChunksWritten > 0) ? {
          ...(initialMeta?.audio || {}),
          totalBytes: audioOffset,
          totalChunks: audioChunksWritten,
          firstTimestamp: audioFirstTimestamp,
          lastTimestamp: audioLastTimestamp,
          duration: audioDuration
        } : undefined
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
