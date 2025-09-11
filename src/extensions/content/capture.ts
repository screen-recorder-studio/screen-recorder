import { state, resetRecordingState, setRecordingMeta } from './state'
import { getSelectedRegion } from './selection'
import { report, transferToMainSystem, showEditingNotification } from './transfer'
import type { EncodedChunk, RecordingMetadata } from './types'

async function createEncoderWorker(): Promise<Worker> {
  // Keep compatibility with existing loader: fetch worker source by URL
  const url = chrome.runtime.getURL('encoder-worker.js')
  const res = await fetch(url)
  const code = await res.text()
  const blob = new Blob([code], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  state.workerBlobUrl = blobUrl
  const worker = new Worker(blobUrl, { type: 'module' })
  return worker
}

function buildMetadata(width: number, height: number, codec: string, framerate: number): RecordingMetadata {
  const region = getSelectedRegion()
  const selectedElement = state.selectedElement ? getDomPath(state.selectedElement) : null
  return {
    mode: state.mode,
    selectedElement,
    selectedRegion: region,
    startTime: Date.now(),
    codec, width, height, framerate,
  }
}

function getDomPath(el: Element): string {
  // Very lightweight selector for diagnostics
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && parts.length < 5) {
    const id = cur.id ? '#' + cur.id : ''
    const cls = cur.className && typeof cur.className === 'string' ? '.' + cur.className.split(/\s+/).filter(Boolean).slice(0,2).join('.') : ''
    parts.unshift(cur.tagName.toLowerCase() + id + cls)
    cur = cur.parentElement
  }
  return parts.join('>')
}

export async function startCapture() {
  if (state.recording) return
  state.recording = true

  // Acquire element/region stream via CropTarget/RestrictionTarget if available; fallback to tab capture
  // For migration baseline, reuse tab capture since original content.js used WebCodecs with frames from track
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false }).catch(() => null)
  if (!stream) {
    state.recording = false
    report({ status: 'error', message: 'getDisplayMedia failed' })
    return
  }
  state.stream = stream
  const track = stream.getVideoTracks()[0]
  state.track = track

  // WebCodecs pipeline
  const processor = new (window as any).MediaStreamTrackProcessor({ track })
  state.processor = processor
  const reader: ReadableStreamDefaultReader<VideoFrame> = processor.readable.getReader()
  state.reader = reader

  const worker = await createEncoderWorker()
  state.worker = worker

  const port = chrome.runtime.connect({ name: 'encoded-stream' })
  state.port = port

  // Read frames → send to worker
  ;(async () => {
    while (state.recording) {
      const { value, done } = await reader.read()
      if (done || !value) break
      const frame = value
      // Transfer the VideoFrame to the encoder worker (zero-copy)
      // The worker is responsible for closing the frame after encoding
      worker.postMessage({ type: 'frame', frame }, [frame])
    }
    worker.postMessage({ type: 'end' })
  })().catch(() => {})

  // Handle worker outputs
  const chunks: EncodedChunk[] = []
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data || {}
    if (msg.type === 'chunk') {
      const data: ArrayBuffer = msg.data
      const arr = new Uint8Array(data)
      const chunk: EncodedChunk = {
        data: Array.from(arr),
        timestamp: msg.ts,
        type: msg.isKey ? 'key' as const : 'delta',
        size: arr.byteLength,
        codedWidth: msg.codedWidth || msg.width || 0,
        codedHeight: msg.codedHeight || msg.height || 0,
        codec: msg.codec || 'vp8',
      }
      state.chunkCount += 1
      state.byteCount += arr.byteLength
      chunks.push(chunk)
      state.port?.postMessage({ type: 'chunk', size: chunk.size })
    } else if (msg.type === 'config') {
      // encoder config prepared
    } else if (msg.type === 'done') {
      // finalize
      const codec = msg.codec || (chunks[0]?.codec || 'vp8')
      const w = msg.width || chunks[0]?.codedWidth || 0
      const h = msg.height || chunks[0]?.codedHeight || 0
      const fr = msg.framerate || 30
      const meta = buildMetadata(w, h, codec, fr)
      setRecordingMeta(meta)
      state.encodedChunks = chunks
      finishCapture()
    }
  }

  // stop when track ends
  track.addEventListener('ended', () => stopCapture())
}

export async function stopCapture() {
  if (!state.recording) return
  state.recording = false
  try { state.reader?.releaseLock() } catch {}
  try { state.track?.stop() } catch {}
}

async function finishCapture() {
  try {
    showEditingNotification()
    await transferToMainSystem(state.encodedChunks, state.recordingMetadata!)
  } finally {
    resetRecordingState()
  }
}

