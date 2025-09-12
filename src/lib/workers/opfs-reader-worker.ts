// OPFSReaderWorker: basic OPFS read access for Studio (Phase 1)
// Provides: open(dirId), getRange(start,count), close
// Notes:
// - Timestamps are stored in microseconds in index.jsonl
// - This basic version parses full index.jsonl into memory once
// - Data slices are read via Blob.slice; upgrade to SyncAccessHandle later

interface OpenMsg { type: 'open'; dirId: string }
interface GetRangeMsg { type: 'getRange'; start: number; count: number }
interface CloseMsg { type: 'close' }

type InMsg = OpenMsg | GetRangeMsg | CloseMsg

interface ChunkIndex {
  offset: number
  size: number
  timestamp: number // microseconds
  type: 'key' | 'delta'
  isKeyframe?: boolean
  codedWidth?: number
  codedHeight?: number
  codec?: string
}

interface ChunkWire {
  data: ArrayBuffer
  timestamp: number
  type: 'key' | 'delta'
  size: number
  codedWidth?: number
  codedHeight?: number
  codec?: string
}

let rootDir: FileSystemDirectoryHandle | null = null
let recDir: FileSystemDirectoryHandle | null = null
let meta: any = null
let indexEntries: ChunkIndex[] = []
let dataFileHandle: FileSystemFileHandle | null = null
let openedDirId: string | null = null

async function ensureRoot() {
  if (!(self as any).navigator?.storage?.getDirectory) {
    throw new Error('OPFS not available in this context')
  }
  rootDir = await (self as any).navigator.storage.getDirectory()
}

async function openDir(dirId: string) {
  if (!rootDir) await ensureRoot()
  recDir = await (rootDir as any).getDirectoryHandle(dirId, { create: false })
  openedDirId = dirId
}

async function readMeta() {
  const fh = await (recDir as any).getFileHandle('meta.json')
  const f = await fh.getFile()
  const text = await f.text()
  meta = JSON.parse(text)
}

async function readIndexAll(): Promise<void> {
  const ih = await (recDir as any).getFileHandle('index.jsonl')
  const f = await ih.getFile()
  const text = await f.text()
  const lines = text.split(/\r?\n/).filter(Boolean)
  indexEntries = lines.map((l, i) => {
    try { return JSON.parse(l) as ChunkIndex } catch {
      throw new Error(`INDEX_PARSE_ERROR at line ${i}`)
    }
  })
}

async function openDataFileHandle() {
  dataFileHandle = await (recDir as any).getFileHandle('data.bin')
}

async function getDataFile(): Promise<File> {
  if (!dataFileHandle) throw new Error('DATA_HANDLE_NOT_OPEN')
  return dataFileHandle.getFile()
}

function summarize() {
  const totalChunks = indexEntries.length
  const durationMs = Math.round((indexEntries.at(-1)?.timestamp ?? 0) / 1000)
  return {
    totalChunks,
    durationMs,
    fps: meta?.fps,
    width: meta?.width,
    height: meta?.height,
    codec: meta?.codec
  }
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  try {
    if (msg.type === 'open') {
      await ensureRoot()
      await openDir(msg.dirId)
      await readMeta()
      await readIndexAll()
      await openDataFileHandle()

      self.postMessage({ type: 'ready', meta, summary: summarize() })
      return
    }

    if (msg.type === 'getRange') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) {
        throw new Error('NOT_OPEN')
      }

      const start = Math.max(0, Math.min(indexEntries.length, Math.floor(msg.start)))
      const count = Math.max(0, Math.floor(msg.count))
      const end = Math.min(indexEntries.length, start + count)

      const file = await getDataFile()
      const chunks: ChunkWire[] = []
      const transfer: ArrayBuffer[] = []

      for (let i = start; i < end; i++) {
        const ent = indexEntries[i]
        // boundary guard
        const slice = file.slice(ent.offset, ent.offset + ent.size)
        const buf = await slice.arrayBuffer()
        const wire: ChunkWire = {
          data: buf,
          timestamp: Number(ent.timestamp) || 0,
          type: (ent.type === 'key' ? 'key' : 'delta'),
          size: Number(ent.size) || (buf.byteLength || 0),
          codedWidth: ent.codedWidth,
          codedHeight: ent.codedHeight,
          codec: ent.codec
        }
        chunks.push(wire)
        transfer.push(buf)
      }

      self.postMessage({ type: 'range', start, count: end - start, chunks }, { transfer })
      return
    }

    if (msg.type === 'close') {
      rootDir = null
      recDir = null
      meta = null
      indexEntries = []
      dataFileHandle = null
      openedDirId = null
      self.postMessage({ type: 'closed' })
      return
    }
  } catch (err: any) {
    const message = err?.message || String(err)
    self.postMessage({ type: 'error', code: 'READER_ERROR', message })
  }
}

export {} // make this a module

