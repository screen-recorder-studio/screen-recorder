type Mode = 'source' | 'clock'

interface InitMessage {
  type: 'init'
  mode: Mode
  sourceTimestampsMs: number[]
  durationMs: number
  workloadMs: number
  pressure: boolean
}

interface RenderMessage {
  type: 'render'
  requestId: number
  sourceFrameIndex: number
  presentationTimeMs: number
  sentAtMs: number
  seekProbeId?: number
}

const SOURCE_WIDTH = 320
const SOURCE_HEIGHT = 180
const OUTPUT_WIDTH = 960
const OUTPUT_HEIGHT = 540

let mode: Mode = 'source'
let sourceTimestampsMs: number[] = []
let decodedFrames: VideoFrame[] = []
let outputCanvas: OffscreenCanvas
let outputContext: OffscreenCanvasRenderingContext2D
let workloadMs = 2
let pressure = false
const pressureBuckets = new Set<number>()

self.onmessage = async (event: MessageEvent<InitMessage | RenderMessage>) => {
  const message = event.data
  if (message.type === 'init') {
    mode = message.mode
    sourceTimestampsMs = message.sourceTimestampsMs
    workloadMs = message.workloadMs
    pressure = message.pressure
    outputCanvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
    outputContext = outputCanvas.getContext('2d', {
      alpha: false,
      desynchronized: true
    })!

    try {
      const result = await buildDecodedSource(message.durationMs)
      self.postMessage({ type: 'ready', mode, ...result })
    } catch (error) {
      self.postMessage({
        type: 'error',
        mode,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      })
    }
    return
  }

  if (message.type === 'render') {
    render(message)
  }
}

async function buildDecodedSource(durationMs: number) {
  const codec = await chooseCodec()
  const encodeStartedAt = performance.now()
  const chunks: Array<{ type: EncodedVideoChunkType; timestamp: number; data: Uint8Array }> = []
  let decoderConfig: VideoDecoderConfig | null = null
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({ type: chunk.type, timestamp: chunk.timestamp, data })
      if (metadata?.decoderConfig) decoderConfig = metadata.decoderConfig
    },
    error(error) {
      throw error
    }
  })
  encoder.configure({
    codec,
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    bitrate: 1_500_000,
    framerate: 30,
    latencyMode: 'realtime'
  })

  const sourceCanvas = new OffscreenCanvas(SOURCE_WIDTH, SOURCE_HEIGHT)
  const sourceContext = sourceCanvas.getContext('2d', { alpha: false })!
  for (let index = 0; index < sourceTimestampsMs.length; index++) {
    const timestampMs = sourceTimestampsMs[index]
    drawSourceFrame(sourceContext, index, timestampMs, durationMs)
    const frame = new VideoFrame(sourceCanvas, { timestamp: Math.round(timestampMs * 1000) })
    encoder.encode(frame, { keyFrame: index === 0 || index % 60 === 0 })
    frame.close()
    if (encoder.encodeQueueSize > 6) await waitForEncoderDrain(encoder)
  }
  await encoder.flush()
  encoder.close()
  const encodeMs = performance.now() - encodeStartedAt

  const decodeStartedAt = performance.now()
  let peakDecodeQueue = 0
  decodedFrames = []
  const decoder = new VideoDecoder({
    output(frame) {
      decodedFrames.push(frame)
    },
    error(error) {
      throw error
    }
  })
  decoder.configure({
    ...(decoderConfig ?? {}),
    codec,
    codedWidth: SOURCE_WIDTH,
    codedHeight: SOURCE_HEIGHT,
    optimizeForLatency: true
  })
  for (const chunk of chunks) {
    decoder.decode(new EncodedVideoChunk(chunk))
    peakDecodeQueue = Math.max(peakDecodeQueue, decoder.decodeQueueSize)
    if (decoder.decodeQueueSize > 12) await waitForDecoderDrain(decoder)
  }
  await decoder.flush()
  decoder.close()

  if (decodedFrames.length !== sourceTimestampsMs.length) {
    throw new Error(`Decoded ${decodedFrames.length}/${sourceTimestampsMs.length} frames`)
  }

  return {
    codec,
    sourceFrames: sourceTimestampsMs.length,
    encodeMs,
    decodeMs: performance.now() - decodeStartedAt,
    peakDecodeQueue
  }
}

async function chooseCodec(): Promise<string> {
  for (const codec of ['vp8', 'vp09.00.10.08']) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width: SOURCE_WIDTH,
      height: SOURCE_HEIGHT,
      bitrate: 1_500_000,
      framerate: 30,
      latencyMode: 'realtime'
    })
    if (support.supported) return codec
  }
  throw new Error('No VP8 or VP9 WebCodecs encoder available')
}

function render(message: RenderMessage) {
  const startedAt = performance.now()
  const frame = decodedFrames[Math.max(0, Math.min(decodedFrames.length - 1, message.sourceFrameIndex))]
  outputContext.fillStyle = '#070a12'
  outputContext.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
  outputContext.drawImage(frame, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)

  outputContext.save()
  outputContext.translate(OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2)
  outputContext.rotate(message.presentationTimeMs / 1000 * Math.PI)
  outputContext.fillStyle = '#67e8f9'
  outputContext.shadowColor = '#22d3ee'
  outputContext.shadowBlur = 24
  outputContext.fillRect(-10, -188, 20, 188)
  outputContext.beginPath()
  outputContext.arc(0, 0, 20, 0, Math.PI * 2)
  outputContext.fill()
  outputContext.restore()

  outputContext.fillStyle = 'rgba(3, 7, 18, 0.76)'
  outputContext.fillRect(22, 22, 330, 64)
  outputContext.fillStyle = '#dbeafe'
  outputContext.font = '24px ui-monospace, monospace'
  outputContext.fillText(`${mode.toUpperCase()}  t=${message.presentationTimeMs.toFixed(1)}ms`, 36, 62)

  burnCpu(workloadMs)
  if (pressure) {
    const bucket = Math.floor(message.presentationTimeMs / 2_000)
    if (bucket > 0 && !pressureBuckets.has(bucket)) {
      pressureBuckets.add(bucket)
      burnCpu(70)
    }
  }

  const bitmap = outputCanvas.transferToImageBitmap()
  self.postMessage({
    type: 'frame',
    mode,
    bitmap,
    requestId: message.requestId,
    sourceFrameIndex: message.sourceFrameIndex,
    presentationTimeMs: message.presentationTimeMs,
    sentAtMs: message.sentAtMs,
    renderMs: performance.now() - startedAt,
    seekProbeId: message.seekProbeId
  }, { transfer: [bitmap] })
}

function drawSourceFrame(
  context: OffscreenCanvasRenderingContext2D,
  index: number,
  timestampMs: number,
  durationMs: number
) {
  const gradient = context.createLinearGradient(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT)
  gradient.addColorStop(0, '#172554')
  gradient.addColorStop(1, '#0f172a')
  context.fillStyle = gradient
  context.fillRect(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT)

  context.strokeStyle = 'rgba(148, 163, 184, 0.22)'
  context.lineWidth = 1
  for (let x = 0; x <= SOURCE_WIDTH; x += 20) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, SOURCE_HEIGHT); context.stroke()
  }
  for (let y = 0; y <= SOURCE_HEIGHT; y += 20) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(SOURCE_WIDTH, y); context.stroke()
  }

  context.save()
  context.translate(SOURCE_WIDTH / 2, SOURCE_HEIGHT / 2)
  context.rotate(timestampMs / durationMs * Math.PI * 4)
  context.fillStyle = '#fb923c'
  context.fillRect(-7, -60, 14, 74)
  context.fillStyle = '#fef3c7'
  context.beginPath(); context.moveTo(0, -76); context.lineTo(-18, -52); context.lineTo(18, -52); context.fill()
  context.restore()

  context.fillStyle = 'rgba(2, 6, 23, 0.7)'
  context.fillRect(8, SOURCE_HEIGHT - 30, 190, 22)
  context.fillStyle = '#f8fafc'
  context.font = '12px ui-monospace, monospace'
  context.fillText(`source #${index} @ ${timestampMs.toFixed(1)}ms`, 14, SOURCE_HEIGHT - 15)
}

function burnCpu(durationMs: number) {
  const end = performance.now() + durationMs
  while (performance.now() < end) {
    Math.sqrt(Math.random() * 1000)
  }
}

function waitForEncoderDrain(encoder: VideoEncoder): Promise<void> {
  return new Promise(resolve => {
    const handle = () => {
      if (encoder.encodeQueueSize <= 3) {
        encoder.removeEventListener('dequeue', handle)
        resolve()
      }
    }
    encoder.addEventListener('dequeue', handle)
    handle()
  })
}

function waitForDecoderDrain(decoder: VideoDecoder): Promise<void> {
  return new Promise(resolve => {
    const handle = () => {
      if (decoder.decodeQueueSize <= 6) {
        decoder.removeEventListener('dequeue', handle)
        resolve()
      }
    }
    decoder.addEventListener('dequeue', handle)
    handle()
  })
}
