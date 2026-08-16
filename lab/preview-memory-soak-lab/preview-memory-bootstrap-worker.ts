import type { FrameLane, OwnershipSnapshot } from './memory-soak-fixture'

type ProductionMessage = {
  type?: string
  data?: {
    chunks?: Array<{ timestamp?: number }>
    startGlobalFrame?: number
    retainStartGlobalFrame?: number
    windowGeneration?: number
  }
}

type DecodeBatch = {
  lane: FrameLane
  generation: number
  timestamps: number[]
  cursor: number
}

type TrackedFrame = {
  id: number
  frame: VideoFrame
  lane: FrameLane
  bytes: number
  alive: boolean
}

const NativeVideoDecoder = globalThis.VideoDecoder
const NativeVideoFrame = globalThis.VideoFrame
const nativeFrameClose = NativeVideoFrame.prototype.close
const nativePostMessage = globalThis.postMessage.bind(globalThis)
const trackedByFrame = new WeakMap<VideoFrame, TrackedFrame>()
const trackedFrames = new Map<number, TrackedFrame>()
const decodeBatches: DecodeBatch[] = []
const peakAliveByLane: Record<FrameLane, number> = { main: 0, next: 0, hover: 0 }
let peakAlive = 0
let peakAliveBytes = 0
let nextFrameId = 1
let nextDecoderId = 1
let allocated = 0
let closed = 0
let activeGeneration = 0
let prefetchedStart: number | null = null
let pendingCutoverStart: number | null = null
let patchError = ''
let activeConstructLane: FrameLane | null = null
let publishedDecodeQueueHighWatermark = 0
let publishedPreviewPlan: OwnershipSnapshot['publishedPreviewPlan'] = null
const decodeQueuePeakByKind = { main: 0, hover: 0 }

function postLab(type: string, data: unknown) {
  nativePostMessage({ type, data })
}

function chunkTimestamps(message: ProductionMessage): number[] {
  return (message.data?.chunks || []).map(chunk => Number(chunk.timestamp) || 0)
}

function enqueueBatch(lane: FrameLane, message: ProductionMessage) {
  const timestamps = chunkTimestamps(message)
  if (timestamps.length === 0) return
  decodeBatches.push({ lane, generation: activeGeneration, timestamps, cursor: 0 })
}

function consumeSubmissionLane(timestamp: number, decoderKind: 'main' | 'hover'): FrameLane {
  const fallback: FrameLane = decoderKind === 'hover' ? 'hover' : 'main'
  for (let index = 0; index < decodeBatches.length; index++) {
    const batch = decodeBatches[index]!
    if (batch.lane === 'hover' && decoderKind !== 'hover') continue
    if (batch.lane !== 'hover' && decoderKind === 'hover') continue
    const expected = batch.timestamps[batch.cursor]
    if (expected !== timestamp) continue
    batch.cursor += 1
    if (batch.cursor >= batch.timestamps.length) decodeBatches.splice(index, 1)
    return batch.lane
  }
  return fallback
}

function aliveRecords(lane?: FrameLane) {
  return [...trackedFrames.values()].filter(record => record.alive && (!lane || record.lane === lane))
}

function updatePeaks() {
  const counts = {
    main: aliveRecords('main').length,
    next: aliveRecords('next').length,
    hover: aliveRecords('hover').length
  }
  peakAliveByLane.main = Math.max(peakAliveByLane.main, counts.main)
  peakAliveByLane.next = Math.max(peakAliveByLane.next, counts.next)
  peakAliveByLane.hover = Math.max(peakAliveByLane.hover, counts.hover)
  peakAlive = Math.max(peakAlive, counts.main + counts.next + counts.hover)
  peakAliveBytes = Math.max(
    peakAliveBytes,
    aliveRecords().reduce((sum, record) => sum + record.bytes, 0)
  )
}

function trackDecodedFrame(frame: VideoFrame, lane: FrameLane) {
  const width = Number(frame.codedWidth || frame.displayWidth || 0)
  const height = Number(frame.codedHeight || frame.displayHeight || 0)
  const record: TrackedFrame = {
    id: nextFrameId++,
    frame,
    lane,
    bytes: Math.max(0, width) * Math.max(0, height) * 4,
    alive: true
  }
  trackedByFrame.set(frame, record)
  trackedFrames.set(record.id, record)
  allocated += 1
  updatePeaks()
}

function recordFrameClose(frame: VideoFrame) {
  const record = trackedByFrame.get(frame)
  if (!record || !record.alive) return
  record.alive = false
  closed += 1
}

function reassignPrefetchToMain() {
  if (pendingCutoverStart === null || pendingCutoverStart !== prefetchedStart) return
  for (const record of aliveRecords('next')) record.lane = 'main'
  prefetchedStart = null
  pendingCutoverStart = null
  updatePeaks()
}

function snapshot(): OwnershipSnapshot & { patchError: string } {
  const lanes: FrameLane[] = ['main', 'next', 'hover']
  const aliveByLane = { main: 0, next: 0, hover: 0 }
  const aliveBytesByLane = { main: 0, next: 0, hover: 0 }
  for (const lane of lanes) {
    const records = aliveRecords(lane)
    aliveByLane[lane] = records.length
    aliveBytesByLane[lane] = records.reduce((sum, record) => sum + record.bytes, 0)
  }
  return {
    aliveByLane,
    aliveBytesByLane,
    totalAlive: aliveByLane.main + aliveByLane.next + aliveByLane.hover,
    totalAliveBytes: aliveBytesByLane.main + aliveBytesByLane.next + aliveBytesByLane.hover,
    peakAlive,
    peakAliveBytes,
    peakAliveByLane: { ...peakAliveByLane },
    decodeQueuePeakByKind: { ...decodeQueuePeakByKind },
    publishedDecodeQueueHighWatermark,
    publishedPreviewPlan,
    allocated,
    closed,
    patchError
  }
}

function InstrumentedVideoFrame(source: CanvasImageSource | BufferSource, init?: VideoFrameInit) {
  const frame = new NativeVideoFrame(source as any, init)
  if (activeConstructLane) trackDecodedFrame(frame, activeConstructLane)
  return frame
}
Object.setPrototypeOf(InstrumentedVideoFrame, NativeVideoFrame)
InstrumentedVideoFrame.prototype = NativeVideoFrame.prototype

try {
  Object.defineProperty(NativeVideoFrame.prototype, 'close', {
    configurable: true,
    writable: true,
    value(this: VideoFrame) {
      recordFrameClose(this)
      return nativeFrameClose.call(this)
    }
  })
} catch (error) {
  patchError = `VideoFrame.close instrumentation unavailable: ${error instanceof Error ? error.message : String(error)}`
}

class InstrumentedVideoDecoder {
  static isConfigSupported(config: VideoDecoderConfig) {
    return NativeVideoDecoder.isConfigSupported(config)
  }

  readonly id = nextDecoderId++
  readonly kind: 'main' | 'hover'
  readonly inner: VideoDecoder
  readonly pendingOutputs: Array<{ timestamp: number; lane: FrameLane }> = []

  constructor(init: VideoDecoderInit) {
    this.kind = this.id === 1 ? 'main' : 'hover'
    this.inner = new NativeVideoDecoder({
      output: frame => {
        const timestamp = Number(frame.timestamp) || 0
        const tagIndex = this.pendingOutputs.findIndex(tag => tag.timestamp === timestamp)
        const tag = tagIndex >= 0 ? this.pendingOutputs.splice(tagIndex, 1)[0] : undefined
        trackDecodedFrame(frame, tag?.lane || (this.kind === 'hover' ? 'hover' : 'main'))
        activeConstructLane = tag?.lane || (this.kind === 'hover' ? 'hover' : 'main')
        try {
          init.output(frame)
        } finally {
          activeConstructLane = null
        }
      },
      error: init.error
    })
  }

  get state() { return this.inner.state }
  get decodeQueueSize() { return this.inner.decodeQueueSize }
  ondequeue: ((this: VideoDecoder, ev: Event) => unknown) | null = null

  configure(config: VideoDecoderConfig) { this.inner.configure(config) }
  decode(chunk: EncodedVideoChunk) {
    const timestamp = Number(chunk.timestamp) || 0
    this.pendingOutputs.push({ timestamp, lane: consumeSubmissionLane(timestamp, this.kind) })
    this.inner.decode(chunk)
    decodeQueuePeakByKind[this.kind] = Math.max(decodeQueuePeakByKind[this.kind], this.inner.decodeQueueSize)
  }
  flush() { return this.inner.flush() }
  reset() {
    this.pendingOutputs.length = 0
    this.inner.reset()
  }
  close() {
    this.pendingOutputs.length = 0
    this.inner.close()
  }
  addEventListener(...args: Parameters<VideoDecoder['addEventListener']>) {
    return this.inner.addEventListener(...args)
  }
  removeEventListener(...args: Parameters<VideoDecoder['removeEventListener']>) {
    return this.inner.removeEventListener(...args)
  }
  dispatchEvent(event: Event) { return this.inner.dispatchEvent(event) }
}

Object.defineProperty(globalThis, 'VideoDecoder', {
  configurable: true,
  writable: true,
  value: InstrumentedVideoDecoder
})

Object.defineProperty(globalThis, 'VideoFrame', {
  configurable: true,
  writable: true,
  value: InstrumentedVideoFrame
})

Object.defineProperty(globalThis, 'postMessage', {
  configurable: true,
  writable: true,
  value(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
    const typed = message as {
      type?: string
      data?: {
        decodeQueueHighWatermark?: number
        previewWidth?: number
        previewHeight?: number
        usesProxy?: boolean
        memoryTier?: string
        previewMemoryPlan?: OwnershipSnapshot['publishedPreviewPlan']
      }
    }
    if (typed?.type === 'ready') reassignPrefetchToMain()
    if (typed?.type === 'ready' && typed.data?.previewMemoryPlan) {
      publishedPreviewPlan = typed.data.previewMemoryPlan
    }
    if (typed?.type === 'previewMemoryPlan') {
      publishedDecodeQueueHighWatermark = Math.max(
        publishedDecodeQueueHighWatermark,
        Number(typed.data?.decodeQueueHighWatermark) || 0
      )
      publishedPreviewPlan = {
        previewWidth: Number(typed.data?.previewWidth) || 0,
        previewHeight: Number(typed.data?.previewHeight) || 0,
        usesProxy: typed.data?.usesProxy === true,
        memoryTier: typed.data?.memoryTier
      }
    }
    if (Array.isArray(transferOrOptions)) return nativePostMessage(message, transferOrOptions)
    if (transferOrOptions) return nativePostMessage(message, transferOrOptions)
    return nativePostMessage(message)
  }
})

self.addEventListener('message', event => {
  const message = (event as MessageEvent<ProductionMessage>).data
  if (message?.type === 'labSnapshot') {
    event.stopImmediatePropagation()
    postLab('labTelemetry', snapshot())
    return
  }
  if (message?.type === 'labCleanup') {
    event.stopImmediatePropagation()
    for (const record of aliveRecords()) {
      try { record.frame.close() } catch {}
    }
    postLab('labCleanupComplete', snapshot())
    return
  }

  if (message?.type === 'process') {
    activeGeneration = Number(message.data?.windowGeneration) || activeGeneration + 1
    const start = Number(message.data?.retainStartGlobalFrame ?? message.data?.startGlobalFrame ?? 0)
    const canReusePrefetch = prefetchedStart === start && aliveRecords('next').length > 0
    pendingCutoverStart = canReusePrefetch ? start : null
    decodeBatches.splice(0, decodeBatches.length, ...decodeBatches.filter(batch => batch.lane === 'hover'))
    if (!canReusePrefetch) enqueueBatch('main', message)
    return
  }
  if (message?.type === 'appendWindow') {
    prefetchedStart = Number(message.data?.retainStartGlobalFrame ?? message.data?.startGlobalFrame ?? 0)
    enqueueBatch('next', message)
    return
  }
  if (message?.type === 'decodeSingleFrame') {
    enqueueBatch('hover', message)
  }
})

postLab('labBootstrapReady', { success: true })
await import('../../packages/extension/src/lib/workers/composite-worker/index')
postLab('labProductionReady', { success: true })
