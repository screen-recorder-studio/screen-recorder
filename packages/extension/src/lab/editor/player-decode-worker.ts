// Dedicated decode worker for lab/editor
// - Maintains a persistent VideoDecoder for smooth playback
// - Supports seek (reinitialize/realign) and append (continuous feed)
// - Exposes a simple message protocol for play/pause/rate control

export type ChunkWire = {
  data: ArrayBuffer
  timestamp: number // microseconds
  type: 'key' | 'delta'
  size: number
  codedWidth?: number
  codedHeight?: number
  codec?: string
}

type InitMsg = { type: 'init'; fps: number }
type SetRateMsg = { type: 'setRate'; rate: number }
type PlayMsg = { type: 'play' }
type PauseMsg = { type: 'pause' }
// Seek resets the decoder and starts from a window aligned at keyframe
// targetIndex is the global frame index to show first
// start is the global frame index of chunks[0]
// The worker will drop frames < targetIndex and start buffering from target onward
// and send the target frame immediately when available.

type SeekMsg = { type: 'seek'; start: number; targetIndex: number; chunks: ChunkWire[] }
// Append more encoded chunks continuing from the last appended end
// start is the global frame index of chunks[0]

type AppendMsg = { type: 'append'; start: number; chunks: ChunkWire[] }

type CloseMsg = { type: 'close' }

type InMsg = InitMsg | SetRateMsg | PlayMsg | PauseMsg | SeekMsg | AppendMsg | CloseMsg

type FrameOut = { type: 'frame'; bitmap: ImageBitmap; index: number; timestamp: number; width: number; height: number }

type BufferStatusOut = { type: 'bufferStatus'; level: 'healthy' | 'low' | 'critical'; buffered: number }

type ErrorOut = { type: 'error'; message: string }

// Internal state
let decoder: VideoDecoder | null = null
let configuredCodec: string | null = null
let fps = 30
let rate = 1
let playing = false

// Mapping decoded frames to global indices
let currentWindowStart = 0
let decodeCursorIndex = 0 // global index assigned for next decoded frame

// Ring buffer of decoded frames (as ImageBitmap) ready to display
const RING_CAP = 120 // about 4s @30fps
const ring: { bitmap: ImageBitmap; index: number; timestamp: number; w: number; h: number }[] = []

let displayTimer: any = null
// Cancellation / sequencing token to distinguish seeks
let activeToken: symbol = Symbol('op')
function bumpToken(): symbol { activeToken = Symbol('op'); return activeToken }

function makeOutput(token: symbol) {
  return async function onDecodedToken(frame: VideoFrame) {
    if (token !== activeToken) { try { frame.close() } catch {}; return }
    try {
      const idx = decodeCursorIndex++
      const ts = frame.timestamp ?? 0
      const bmp = await createImageBitmap(frame)
      const w = bmp.width
      const h = bmp.height
      try { frame.close() } catch {}
      if (ring.length >= RING_CAP) { const dropped = ring.shift(); void dropped }
      ring.push({ bitmap: bmp, index: idx, timestamp: ts, w, h })
      maybeNotifyBuffer()
    } catch (e: any) {
      postError('onDecoded failed: ' + e?.message)
      try { frame.close() } catch {}
    }
  }
}


function ensureDecoder(token: symbol, codec?: string) {
  if (decoder && codec && configuredCodec && configuredCodec !== codec) {
    try { decoder.close() } catch {}
    decoder = null
    configuredCodec = null
  }
  if (!decoder) {
    decoder = new VideoDecoder({
      output: makeOutput(token),
      error: (e) => postError('Decoder error: ' + (e as any)?.message)
    })
    if (codec) {
      try {
        decoder.configure({ codec } as VideoDecoderConfig)
        configuredCodec = codec
      } catch (e: any) {
        postError('Decoder configure failed: ' + e?.message)
      }
    }
  }
}

function postError(message: string) {
  ;(self as any).postMessage({ type: 'error', message } as ErrorOut)
}

function clearRing() {
  // ImageBitmap is transferred to main and becomes detached; nothing to close here.
  ring.length = 0
}



function maybeNotifyBuffer() {
  const n = ring.length
  const level: BufferStatusOut['level'] = n >= Math.max(30, Math.round(fps * 1.0))
    ? 'healthy'
    : n >= Math.max(10, Math.round(fps * 0.3))
    ? 'low'
    : 'critical'
  ;(self as any).postMessage({ type: 'bufferStatus', level, buffered: n } as BufferStatusOut)
}

function startDisplayTimer() {
  stopDisplayTimer()
  const interval = Math.max(5, Math.round(1000 / Math.max(1, fps * rate)))
  displayTimer = setInterval(tickDisplay, interval)
}

function stopDisplayTimer() {
  if (displayTimer) { clearInterval(displayTimer); displayTimer = null }
}

function tickDisplay() {
  if (!playing) return
  if (ring.length === 0) return // wait for decode
  const it = ring.shift()!
  ;(self as any).postMessage({ type: 'frame', bitmap: it.bitmap, index: it.index, timestamp: it.timestamp, width: it.w, height: it.h } as FrameOut, [it.bitmap as any])
  maybeNotifyBuffer()
}

async function processWindow(chunks: ChunkWire[], start: number, dropUntilIndex: number | null, token: symbol) {
  if (!chunks || chunks.length === 0) return
  const first = chunks[0]
  ensureDecoder(token, first.codec || 'vp8')
  // Align decode cursor to start index
  currentWindowStart = start
  decodeCursorIndex = dropUntilIndex != null ? start : Math.max(decodeCursorIndex, start)

  try {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]
      const data = c.data instanceof ArrayBuffer ? new Uint8Array(c.data) : new Uint8Array(c.data as any)
      const evc = new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, data })
      // On very first append after seek, decoder may require keyframe; upstream guarantees window starts at keyframe
      decoder!.decode(evc)
    }
    await decoder!.flush()
  } catch (e: any) {
    const m = (e?.message || String(e) || '').toLowerCase()
    if (token !== activeToken || m.includes('aborted') || m.includes('close')) {
      // Cancellation or decoder closed intentionally; ignore
      return
    }
    postError('decode/flush failed: ' + (e?.message || String(e)))
  }

  // If seek requested, drop prepared bitmaps until reaching target index
  if (dropUntilIndex != null) {
    while (ring.length > 0 && ring[0].index < dropUntilIndex) {
      const dropped = ring.shift()!
      // dropped.bitmap will be GCed; it's not transferred
      void dropped
    }
  }
}

function closeDecoder() {
  if (decoder) {
    try { decoder.close() } catch {}
    decoder = null
    configuredCodec = null
  }
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      fps = Math.max(1, Math.min(240, Math.floor(msg.fps || 30)))
      ;(self as any).postMessage({ type: 'ready' })
      return
    }
    if (msg.type === 'setRate') {
      const r = Number((msg as any).rate)
      if (isFinite(r) && r > 0) {
        rate = r
        if (playing) startDisplayTimer()
      }
      return
    }
    if (msg.type === 'play') {
      playing = true
      startDisplayTimer()
      return
    }
    if (msg.type === 'pause') {
      playing = false
      stopDisplayTimer()
      return
    }
    if (msg.type === 'seek') {
      // Reset state and decode from new window
      playing = false
      stopDisplayTimer()
      clearRing()
      closeDecoder()
      const token = bumpToken()
      const { start, targetIndex, chunks } = msg
      await processWindow(chunks, start, targetIndex, token)
      // After seek, immediately output one frame for preview (without starting timer)
      if (token === activeToken && ring.length > 0) {
        const it = ring.shift()!
        ;(self as any).postMessage({ type: 'frame', bitmap: it.bitmap, index: it.index, timestamp: it.timestamp, width: it.w, height: it.h } as FrameOut, [it.bitmap as any])
        maybeNotifyBuffer()
      }
      // After seek, do not auto play. Main thread controls play()
      return
    }
    if (msg.type === 'append') {
      const { start, chunks } = msg
      // Continue decode with persistent decoder and index mapping
      await processWindow(chunks, start, null, activeToken)
      return
    }
    if (msg.type === 'close') {
      playing = false
      stopDisplayTimer()
      clearRing()
      closeDecoder()
      return
    }
  } catch (err: any) {
    postError('worker error: ' + (err?.message || String(err)))
  }
}

