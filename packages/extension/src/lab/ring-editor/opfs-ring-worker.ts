// OPFS Ring Reader Worker
// Goal: Provide an encoded-chunk ring buffer over OPFS data for low-latency preview.
// - Append-only store: rec_<id>/{meta.json,index.jsonl,data.bin}
// - Ring semantics: fixed-capacity (power-of-two) SPSC ring with overwrite-oldest
// - Keyframe alignment: optional alignment of read windows to previous keyframe
// - API is compatible in spirit with opfs-reader-worker but caches encoded chunks

// ---------- Message Types ----------
interface OpenMsg { type: 'open'; dirId: string }
interface ConfigureMsg {
  type: 'configure'
  capacityPow2?: number // ring capacity in chunks (power of two)
  alignToKeyframe?: boolean // default true
}
interface GetRangeMsg { type: 'getRange'; start: number; count: number; alignToKeyframe?: boolean }
interface GetWindowByTimeMsg { type: 'getWindowByTime'; centerMs?: number; beforeMs?: number; afterMs?: number }
interface PrefetchMsg {
  type: 'prefetch';
  // choose one of the following
  start?: number; end?: number; // [start,end) by index
  centerMs?: number; beforeMs?: number; afterMs?: number; // window by time
}
interface GetStatsMsg { type: 'getStats' }
interface ResetRingMsg { type: 'resetRing' }
interface CloseMsg { type: 'close' }

type InMsg =
  | OpenMsg | ConfigureMsg | GetRangeMsg | GetWindowByTimeMsg
  | PrefetchMsg | GetStatsMsg | ResetRingMsg | CloseMsg

// ---------- Index/Data Types ----------
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

// ---------- Ring Types ----------
interface SlotMeta {
  gen: number
  globalIndex: number // index in indexEntries[]
  data: ArrayBuffer
  ts: number
  type: 'key' | 'delta'
  size: number
  cw?: number
  ch?: number
  codec?: string
}

// ---------- State ----------
let rootDir: FileSystemDirectoryHandle | null = null
let recDir: FileSystemDirectoryHandle | null = null
let meta: any = null
let indexEntries: ChunkIndex[] = []
let dataFileHandle: FileSystemFileHandle | null = null

let keyframeIndices: number[] = []

// Ring buffer
let RING_CAP = 512 // default
let RING_MASK = RING_CAP - 1
let head = 0 // next write sequence
let tail = 0 // next logical oldest
let ring: (SlotMeta | undefined)[] = new Array(RING_CAP)
let indexToSlot = new Map<number, number>() // globalIndex -> slotIdx
let alignToKeyframeDefault = true

// Stats
let bytesRead = 0
let ringHits = 0
let ringMisses = 0
let evicted = 0

// ----- Playback & Rendering (Worker-side) -----
let offscreen: OffscreenCanvas | null = null
let octx: OffscreenCanvasRenderingContext2D | null = null
let playing = false
let playbackRate = 1.0
let playbackFps = 30
let currentIndexW = 0
let tickTimer: any = null

// WebCodecs decoder (persistent)
let decoder: VideoDecoder | null = null
let decoderCodec: string | null = null
let expectedNextIndex = 0

// Decoded frame cache (LRU)
const DECODED_CAP = 180
const decodedMap = new Map<number, VideoFrame>()
let decodedOrder: number[] = []
function clearDecoded() {
  for (const f of decodedMap.values()) { try { f.close() } catch {} }
  decodedMap.clear(); decodedOrder = []
}
function putDecoded(idx: number, frame: VideoFrame) {
  const old = decodedMap.get(idx); if (old) { try { old.close() } catch {} }
  decodedMap.set(idx, frame); decodedOrder.push(idx)
  while (decodedOrder.length > DECODED_CAP) {
    const rm = decodedOrder.shift(); if (rm != null) { try { decodedMap.get(rm)?.close() } catch {}; decodedMap.delete(rm) }
  }
}
function getDecoded(idx: number): VideoFrame | null { return decodedMap.get(idx) || null }

function ensureOffscreen(w = 640, h = 360) {
  if (!offscreen) return
  if (offscreen.width !== w || offscreen.height !== h) { offscreen.width = w; offscreen.height = h }
  if (!octx) octx = offscreen.getContext('2d') as OffscreenCanvasRenderingContext2D
}

function resetDecoder() { if (decoder) { try { decoder.close() } catch {} } decoder = null; decoderCodec = null }
function ensureDecoder(codec: string) {
  if (!('VideoDecoder' in self)) throw new Error('WebCodecs VideoDecoder not supported in worker')
  if (!decoder || decoderCodec !== codec) {
    resetDecoder()
    decoderCodec = codec
    decoder = new VideoDecoder({
      output: (frame: VideoFrame) => { putDecoded(expectedNextIndex++, frame) },
      error: (err) => { (self as any).postMessage({ type: 'error', code: 'DECODER_ERROR', message: String(err?.message || err) }) }
    })
    decoder.configure({ codec } as any)
  }
}

let decodingPromise: Promise<void> | null = null
let decodingWindowStart = 0
let decodingWindowEnd = 0

async function decodeWindow(start: number, count: number) {
  // Align to previous keyframe for decodability
  const { start: s, end: e } = await ensureAlignedRange(start, count, true)
  const cached = collectRangeFromRing(s, e) || []
  // Set mapping base for output callback
  expectedNextIndex = s
  // Configure decoder by first chunk codec or meta
  const first = cached[0]; const codec = (first?.codec) || (meta?.codec) || 'vp8'
  ensureDecoder(codec)
  for (let i = 0; i < cached.length; i++) {
    const c = cached[i]
    // avoid feeding the same window repeatedly
    if (expectedNextIndex > s + i) continue
    const data = c.data instanceof ArrayBuffer ? new Uint8Array(c.data) : new Uint8Array(c.data as any)
    const evc = new (self as any).EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, data })
    decoder!.decode(evc)
  }
  await decoder!.flush()
  decodingWindowStart = s; decodingWindowEnd = e
}

function drawFrameAt(index: number) {
  const ent = indexEntries[index]
  const w = ent?.codedWidth || meta?.width || 640
  const h = ent?.codedHeight || meta?.height || 360
  ensureOffscreen(w, h)
  const f = getDecoded(index)
  if (!f || !octx) return false
  try { (octx as any).drawImage(f as any, 0, 0, offscreen!.width, offscreen!.height) } catch {}
  return true
}

function schedulePrefetch() {
  // If near the end of decoded window, prefetch next segment starting at next keyframe
  const margin = Math.max(10, Math.floor(0.5 * playbackFps))
  if (currentIndexW + margin >= decodingWindowEnd) {
    const nextK = keyframeAfter(Math.max(currentIndexW + 1, decodingWindowEnd))
    if (!decodingPromise) {
      decodingPromise = decodeWindow(nextK, Math.max(2 * playbackFps, 60)).catch(() => {}).finally(() => { decodingPromise = null })
    }
  }
}

function startTicker() {
  if (tickTimer) return
  let last = Date.now()
  let accumulator = 0
  let lastReport = last
  const reportInterval = 100 // ms
  tickTimer = setInterval(() => {
    if (!playing) return
    if (!offscreen || !octx) return
    const now = Date.now()
    const dt = (now - last) / 1000
    last = now
    accumulator += dt * playbackFps * playbackRate
    const steps = Math.floor(accumulator)
    if (steps > 0) {
      accumulator -= steps
      currentIndexW = Math.min(indexEntries.length - 1, currentIndexW + steps)
      // ensure decode window contains current index
      if (!(currentIndexW >= decodingWindowStart && currentIndexW < decodingWindowEnd)) {
        if (!decodingPromise) {
          decodingPromise = decodeWindow(currentIndexW, Math.max(2 * playbackFps, 60)).catch(() => {}).finally(() => { decodingPromise = null })
        }
      }
      drawFrameAt(currentIndexW)
      schedulePrefetch()
    }
    if (now - lastReport >= reportInterval) {
      lastReport = now
      ;(self as any).postMessage({ type: 'position', index: currentIndexW })
    }
  }, 16)
}
function stopTicker() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null } }

// ---------- Utilities ----------
function isPowerOfTwo(x: number) { return x > 0 && (x & (x - 1)) === 0 }
function usToMs(us: number) { return Math.floor(us / 1000) }
function ensureRoot() {
  if (!(self as any).navigator?.storage?.getDirectory) throw new Error('OPFS not available')
  return (self as any).navigator.storage.getDirectory()
}
async function openDir(dirId: string) {
  if (!rootDir) rootDir = await ensureRoot()
  recDir = await (rootDir as any).getDirectoryHandle(dirId, { create: false })
}
async function readMeta() {
  const fh = await (recDir as any).getFileHandle('meta.json')
  const f = await fh.getFile(); meta = JSON.parse(await f.text())
}
async function readIndexAll() {
  const ih = await (recDir as any).getFileHandle('index.jsonl')
  const f = await ih.getFile(); const text = await f.text()
  indexEntries = text.split(/\r?\n/).filter(Boolean).map((line, i) => {
    try { return JSON.parse(line) as ChunkIndex } catch { throw new Error(`INDEX_PARSE_ERROR at line ${i}`) }
  })
  keyframeIndices = []
  indexEntries.forEach((e, i) => { if (e.type === 'key' || e.isKeyframe) keyframeIndices.push(i) })
}
async function openDataFileHandle() { dataFileHandle = await (recDir as any).getFileHandle('data.bin') }
async function getDataFile(): Promise<File> { if (!dataFileHandle) throw new Error('DATA_HANDLE_NOT_OPEN'); return dataFileHandle.getFile() }

function keyframeBefore(index: number): number {
  let i = Math.max(0, Math.min(index, indexEntries.length - 1))
  for (; i >= 0; i--) { const ent = indexEntries[i]; if (ent?.isKeyframe || ent?.type === 'key') return i }
  return 0
}
function keyframeAfter(index: number): number {
  let i = Math.max(0, Math.min(index, indexEntries.length - 1))
  for (; i < indexEntries.length; i++) { const ent = indexEntries[i]; if (ent?.isKeyframe || ent?.type === 'key') return i }
  return indexEntries.length - 1
}
function idxByRelativeTimeMs(relativeMs: number): number {
  if (indexEntries.length === 0) return 0
  const baseUs = indexEntries[0]?.timestamp ?? 0
  const targetAbsMs = relativeMs + usToMs(baseUs)
  let lo = 0, hi = indexEntries.length - 1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const tMid = usToMs(indexEntries[mid]?.timestamp || 0)
    if (tMid <= targetAbsMs) lo = mid + 1
    else hi = mid - 1
  }
  return Math.max(0, Math.min(indexEntries.length - 1, hi))
}

// ---------- Ring Operations ----------
function ringClear() {
  head = 0; tail = 0; ring.fill(undefined); indexToSlot.clear(); evicted = 0
}
function ringSize() { return head - tail }
function slotOf(seq: number) { return seq & RING_MASK }
function generationOf(seq: number) { return Math.floor(seq / RING_CAP) }

function publish(globalIndex: number, data: ArrayBuffer, ent: ChunkIndex) {
  const seq = head; const slot = slotOf(seq); const gen = generationOf(seq)
  const existing = ring[slot]
  if (existing) { // evict previous occupant
    indexToSlot.delete(existing.globalIndex); evicted++
  }
  ring[slot] = {
    gen, globalIndex, data,
    ts: ent.timestamp || 0, type: (ent.type === 'key' ? 'key' : 'delta'),
    size: Number(ent.size) || data.byteLength,
    cw: ent.codedWidth, ch: ent.codedHeight, codec: ent.codec
  }
  indexToSlot.set(globalIndex, slot)
  head++
  if (ringSize() > RING_CAP) { // maintain size <= CAP by advancing tail
    tail = head - RING_CAP
  }
}

function hasIndexInRing(globalIndex: number): boolean {
  const slot = indexToSlot.get(globalIndex)
  if (slot === undefined) return false
  const s = ring[slot]; if (!s) return false
  // generation/identity check for safety
  return s.globalIndex === globalIndex
}

function collectRangeFromRing(start: number, endExclusive: number): ChunkWire[] | null {
  const out: ChunkWire[] = []
  for (let i = start; i < endExclusive; i++) {
    const slot = indexToSlot.get(i)
    if (slot === undefined) return null
    const s = ring[slot]
    if (!s || s.globalIndex !== i) return null
    out.push({
      data: s.data,
      timestamp: Number(s.ts) || 0,
      type: s.type,
      size: Number(s.size) || (s.data.byteLength || 0),
      codedWidth: s.cw,
      codedHeight: s.ch,
      codec: s.codec
    })
  }
  return out
}

async function fillRangeFromOPFS(start: number, endExclusive: number) {
  const file = await getDataFile()
  for (let i = start; i < endExclusive; i++) {
    if (hasIndexInRing(i)) { ringHits++; continue }
    const ent = indexEntries[i]
    const slice = file.slice(ent.offset, ent.offset + ent.size)
    const buf = await slice.arrayBuffer(); bytesRead += buf.byteLength; ringMisses++
    publish(i, buf, ent)
  }
}

// Ensure the ring contains [start,end); optionally trim start to prev keyframe
async function ensureAlignedRange(start: number, count: number, align = alignToKeyframeDefault) {
  const requestedStart = Math.max(0, Math.min(indexEntries.length - 1, Math.floor(start)))
  const reqCount = Math.max(0, Math.floor(count))
  let s = requestedStart
  if (align) s = keyframeBefore(requestedStart)
  const distance = requestedStart - s
  let e = Math.min(indexEntries.length, s + reqCount + Math.max(0, distance))
  // If the requested window exceeds capacity, keep start aligned and clamp the end
  if (e - s > RING_CAP) {
    e = Math.min(indexEntries.length, s + RING_CAP)
  }
  await fillRangeFromOPFS(s, e)
  return { start: s, end: e }
}

// ---------- Message Handling ----------
self.onmessage = async (e: MessageEvent<InMsg | any>) => {
  const msg = e.data
  try {
    if (msg.type === 'open') {
      await openDir(msg.dirId)
      await readMeta()
      await readIndexAll()
      await openDataFileHandle()
      ringClear()
      ;(self as any).postMessage({ type: 'ready', meta, summary: {
        totalChunks: indexEntries.length,
        fps: meta?.fps || 30, width: meta?.width || 0, height: meta?.height || 0, codec: meta?.codec || 'unknown',
        keyframeCount: keyframeIndices.length, keyframeIndices
      } })
      return
    }

    if (msg.type === 'configure') {
      const cap = Math.max(2, Math.floor(msg.capacityPow2 || RING_CAP))
      if (!isPowerOfTwo(cap)) throw new Error('capacityPow2 must be power-of-two')
      RING_CAP = cap; RING_MASK = RING_CAP - 1
      ring = new Array(RING_CAP)
      ringClear()
      alignToKeyframeDefault = (msg.alignToKeyframe ?? true)
      ;(self as any).postMessage({ type: 'configured', capacity: RING_CAP, alignToKeyframe: alignToKeyframeDefault })
      return
    }

    if (msg.type === 'getRange') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) throw new Error('NOT_OPEN')
      const { start, count } = msg
      const { start: s, end: e } = await ensureAlignedRange(start, count, msg.alignToKeyframe ?? alignToKeyframeDefault)
      const cached = collectRangeFromRing(s, e)
      if (!cached) { // should be rare since ensure filled; but re-check for safety
        await fillRangeFromOPFS(s, e)
      }
      const _cached = collectRangeFromRing(s, e) || []
      const out = _cached.map(c => { const copy = c.data.slice(0); return { ...c, data: copy } })
      const transfer = out.map(c => c.data)
      ;(self as any).postMessage({ type: 'range', start: s, count: e - s, chunks: out }, transfer)
      return
    }

    if (msg.type === 'getWindowByTime') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) throw new Error('NOT_OPEN')
      const centerMs = Math.max(0, Math.floor(msg.centerMs ?? 0))
      const beforeMs = Math.max(0, Math.floor(msg.beforeMs ?? 0))
      const afterMs = Math.max(0, Math.floor(msg.afterMs ?? 0))
      const desiredStartMs = Math.max(0, centerMs - beforeMs)
      const desiredEndMs = centerMs + afterMs
      let startIdx = keyframeBefore(idxByRelativeTimeMs(desiredStartMs))
      // find end index: first idx with relative time > desiredEndMs
      const baseUs = indexEntries[0]?.timestamp ?? 0
      let endIdx = startIdx
      while (endIdx < indexEntries.length) {
        const relMs = (indexEntries[endIdx].timestamp - baseUs) / 1000
        if (relMs > desiredEndMs) break
        endIdx++
      }
      if (endIdx <= startIdx) endIdx = Math.min(indexEntries.length, startIdx + 1)
      // capacity clamp: keep start aligned, clamp end
      if (endIdx - startIdx > RING_CAP) endIdx = Math.min(indexEntries.length, startIdx + RING_CAP)
      await fillRangeFromOPFS(startIdx, endIdx)
      const _cached2 = collectRangeFromRing(startIdx, endIdx) || []

      const out2 = _cached2.map(c => { const copy = c.data.slice(0); return { ...c, data: copy } })
      const transfer2 = out2.map(c => c.data)
      ;(self as any).postMessage({ type: 'range', start: startIdx, count: endIdx - startIdx, chunks: out2 }, transfer2)
      return
    }

    if (msg.type === 'prefetch') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) throw new Error('NOT_OPEN')
      if (typeof msg.start === 'number' && typeof msg.end === 'number') {
        const s = Math.max(0, Math.min(msg.start, indexEntries.length))
        const e = Math.max(s, Math.min(msg.end, indexEntries.length))
        const clampS = Math.max(0, e - RING_CAP)
        await fillRangeFromOPFS(Math.max(s, clampS), e)
      } else {
        const centerMs = Math.max(0, Math.floor(msg.centerMs ?? 0))
        const beforeMs = Math.max(0, Math.floor(msg.beforeMs ?? 0))
        const afterMs = Math.max(0, Math.floor(msg.afterMs ?? 0))
        const desiredStartMs = Math.max(0, centerMs - beforeMs)
        const desiredEndMs = centerMs + afterMs
        let startIdx = keyframeBefore(idxByRelativeTimeMs(desiredStartMs))
        const baseUs = indexEntries[0]?.timestamp ?? 0
        let endIdx = startIdx
        while (endIdx < indexEntries.length) {
          const relMs = (indexEntries[endIdx].timestamp - baseUs) / 1000
          if (relMs > desiredEndMs) break
          endIdx++
        }
        if (endIdx - startIdx > RING_CAP) startIdx = Math.max(0, endIdx - RING_CAP)
        await fillRangeFromOPFS(startIdx, endIdx)
      }
      ;(self as any).postMessage({ type: 'prefetched' })
      return
    }

    if (msg.type === 'getStats') {
      ;(self as any).postMessage({ type: 'stats',
        ring: { capacity: RING_CAP, size: ringSize(), head, tail },
        io: { bytesRead, hits: ringHits, misses: ringMisses, evicted },
        meta: { totalChunks: indexEntries.length, keyframes: keyframeIndices.length }
      })
      return
    }

    if (msg.type === 'initCanvas') {
      // Expect OffscreenCanvas transferred as msg.canvas
      offscreen = msg.canvas as OffscreenCanvas
      octx = offscreen?.getContext('2d') as OffscreenCanvasRenderingContext2D
      playbackFps = Number(meta?.fps) || playbackFps
      currentIndexW = 0
      ;(self as any).postMessage({ type: 'canvasInited' })
      return
    }

    if (msg.type === 'setPlayback') {
      if (typeof msg.fps === 'number') playbackFps = Math.max(1, Math.floor(msg.fps))
      if (typeof msg.playbackRate === 'number') playbackRate = Math.max(0.1, Number(msg.playbackRate))
      ;(self as any).postMessage({ type: 'playbackSet', fps: playbackFps, playbackRate })
      return
    }

    if (msg.type === 'setRate') {
      if (typeof msg.playbackRate === 'number') playbackRate = Math.max(0.1, Number(msg.playbackRate))
      ;(self as any).postMessage({ type: 'rateSet', playbackRate })
      return
    }

    if (msg.type === 'play') { playing = true; startTicker(); (self as any).postMessage({ type: 'playing' }); return }
    if (msg.type === 'pause') { playing = false; (self as any).postMessage({ type: 'paused' }); return }

    if (msg.type === 'seekToIndex') {
      const idx = Math.max(0, Math.min(indexEntries.length - 1, Math.floor(msg.index || 0)))
      currentIndexW = idx
      if (!decodingPromise) {
        decodingPromise = decodeWindow(currentIndexW, Math.max(2 * playbackFps, 60)).catch(() => {}).finally(() => { decodingPromise = null })
      }
      // Try to draw immediately if frame already cached
      const ok = drawFrameAt(currentIndexW)
      ;(self as any).postMessage({ type: 'seeked', index: currentIndexW, drawn: ok })
      return
    }


    if (msg.type === 'resetRing') { ringClear(); (self as any).postMessage({ type: 'ringReset' }); return }

    if (msg.type === 'close') {
      rootDir = null; recDir = null; meta = null; indexEntries = []; dataFileHandle = null
      ringClear();
      ;(self as any).postMessage({ type: 'closed' })
      stopTicker(); playing = false; currentIndexW = 0; clearDecoded(); resetDecoder(); offscreen = null; octx = null

      return
    }
  } catch (err: any) {
    const message = err?.message || String(err)
    ;(self as any).postMessage({ type: 'error', code: 'RING_READER_ERROR', message })
  }
}

export {} // make this a module

