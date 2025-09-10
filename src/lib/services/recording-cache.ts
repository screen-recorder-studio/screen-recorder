// IndexedDB-based cache for recorded encoded chunks shared across extension pages
// Stores chunks in a dedicated object store to avoid large single-record limits

import { DataFormatValidator } from '$lib/utils/data-format-validator'

export interface RecordingMeta {
  width?: number
  height?: number
  fps?: number
  codec?: string
  totalChunks?: number
  totalSize?: number
  createdAt?: number
  engine?: string
}

export interface StoredChunk {
  key: string // `${recordingId}:${index}`
  recordingId: string
  index: number
  timestamp: number
  type: 'key' | 'delta'
  size: number
  codedWidth?: number
  codedHeight?: number
  codec?: string
  data: ArrayBuffer
}

const DB_NAME = 'vrdb'
const DB_VERSION = 1
const STORE_RECORDINGS = 'recordings'
const STORE_CHUNKS = 'chunks'

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_RECORDINGS)) {
        db.createObjectStore(STORE_RECORDINGS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const store = db.createObjectStore(STORE_CHUNKS, { keyPath: 'key' })
        store.createIndex('by_recording', 'recordingId', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function tx(db: IDBDatabase, store: string | string[], mode: IDBTransactionMode) {
  return db.transaction(store, mode)
}

export const recordingCache = {
  async save(recordingId: string, chunks: any[], meta: RecordingMeta = {}): Promise<void> {
    if (!Array.isArray(chunks) || chunks.length === 0) return
    const db = await openDB()

    const first = chunks[0] || {}
    const inferredMeta: RecordingMeta = {
      width: meta.width ?? first.codedWidth ?? 1920,
      height: meta.height ?? first.codedHeight ?? 1080,
      fps: meta.fps ?? 30,
      codec: meta.codec ?? first.codec ?? 'vp9',
      engine: meta.engine,
      totalChunks: chunks.length,
      totalSize: chunks.reduce((s, c) => s + (c.size || 0), 0),
      createdAt: Date.now()
    }

    // Write metadata first
    await new Promise<void>((resolve, reject) => {
      const t = tx(db, STORE_RECORDINGS, 'readwrite')
      const store = t.objectStore(STORE_RECORDINGS)
      store.put({ id: recordingId, meta: inferredMeta })
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })

    // Write chunks in a separate transaction to allow large datasets
    await new Promise<void>((resolve, reject) => {
      const t = tx(db, STORE_CHUNKS, 'readwrite')
      const store = t.objectStore(STORE_CHUNKS)

      chunks.forEach((chunk, index) => {
        const uint8 = DataFormatValidator.convertToUint8Array(chunk.data)
        const buffer: ArrayBuffer = uint8 ? (uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer) : new Uint8Array().buffer
        const record: StoredChunk = {
          key: `${recordingId}:${index}`,
          recordingId,
          index,
          timestamp: Number(chunk.timestamp) || 0,
          type: (chunk.type === 'key' ? 'key' : 'delta'),
          size: Number(chunk.size) || (uint8?.length || 0),
          codedWidth: Number(chunk.codedWidth) || undefined,
          codedHeight: Number(chunk.codedHeight) || undefined,
          codec: chunk.codec || undefined,
          data: buffer
        }
        store.put(record)
      })

      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  },

  async load(recordingId: string): Promise<{ meta: RecordingMeta; chunks: any[] } | null> {
    const db = await openDB()

    const meta = await new Promise<any>((resolve, reject) => {
      const t = tx(db, STORE_RECORDINGS, 'readonly')
      const store = t.objectStore(STORE_RECORDINGS)
      const req = store.get(recordingId)
      req.onsuccess = () => resolve(req.result?.meta || null)
      req.onerror = () => reject(req.error)
    })

    if (!meta) return null

    const records: StoredChunk[] = await new Promise((resolve, reject) => {
      const t = tx(db, STORE_CHUNKS, 'readonly')
      const store = t.objectStore(STORE_CHUNKS)
      const idx = store.index('by_recording')
      const range = IDBKeyRange.only(recordingId)
      const req = idx.getAll(range)
      req.onsuccess = () => resolve(req.result as StoredChunk[])
      req.onerror = () => reject(req.error)
    })

    records.sort((a, b) => a.index - b.index)

    const chunks = records.map(r => ({
      data: new Uint8Array(r.data),
      timestamp: r.timestamp,
      type: r.type,
      size: r.size,
      codedWidth: r.codedWidth,
      codedHeight: r.codedHeight,
      codec: r.codec
    }))

    return { meta, chunks }
  },

  async remove(recordingId: string): Promise<void> {
    const db = await openDB()

    await new Promise<void>((resolve, reject) => {
      const t = tx(db, STORE_RECORDINGS, 'readwrite')
      const store = t.objectStore(STORE_RECORDINGS)
      store.delete(recordingId)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })

    await new Promise<void>((resolve, reject) => {
      const t = tx(db, STORE_CHUNKS, 'readwrite')
      const store = t.objectStore(STORE_CHUNKS)
      const idx = store.index('by_recording')
      const range = IDBKeyRange.only(recordingId)
      const req = idx.openKeyCursor(range)
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          // cursor.primaryKey is the store key
          store.delete(cursor.primaryKey as IDBValidKey)
          cursor.continue()
        } else {
          resolve()
        }
      }
      req.onerror = () => reject(req.error)
    })
  }
}

export type RecordingCache = typeof recordingCache

