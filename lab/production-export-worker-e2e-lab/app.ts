import {
  ALL_FORMATS,
  BlobSource,
  Input,
  VideoSampleSink
} from '../../packages/extension/node_modules/mediabunny'
import type { BackgroundConfig, ExportOptions } from '../../packages/extension/src/lib/types/background'
import { createMemoryTrimExportPlan } from '../../packages/extension/src/lib/export/memory-trim-export'
import { ExportManager } from '../../packages/extension/src/lib/services/export-manager'
import {
  buildProductionExportMatrix,
  evaluateProductionExportAcceptance,
  type MemoryExportChunk,
  type ProductionExportFormat
} from './export-e2e-fixture'

const SOURCE_WIDTH = 320
const SOURCE_HEIGHT = 180
const OUTPUT_WIDTH = 640
const OUTPUT_HEIGHT = 360
const FPS = 10
const SOURCE_FRAME_COUNT = 51
const TRIM = { enabled: true, startMs: 1_100, endMs: 4_100, startFrame: 11, endFrame: 41 }
const EXPECTED_DURATION_SECONDS = (TRIM.endMs - TRIM.startMs) / 1_000
const CHECKPOINTS_MS = [200, 600, 1_200, 1_600, 2_000, 2_500, 2_900]

const BACKGROUND_CONFIG: BackgroundConfig = {
  type: 'solid-color',
  color: '#101827',
  padding: 0,
  outputRatio: 'custom',
  customWidth: OUTPUT_WIDTH,
  customHeight: OUTPUT_HEIGHT,
  videoPosition: 'center',
  borderRadius: 0,
  videoCrop: {
    enabled: true,
    mode: 'percentage',
    x: 0,
    y: 0,
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    xPercent: 0.1,
    yPercent: 0.1,
    widthPercent: 0.8,
    heightPercent: 0.8
  },
  videoZoom: {
    enabled: true,
    scale: 1.7,
    transitionDurationMs: 180,
    intervals: [
      {
        startMs: 1_800,
        endMs: 2_600,
        scale: 1.7,
        focusX: 0.2,
        focusY: 0.32,
        focusSpace: 'source',
        mode: 'dolly',
        easing: 'linear'
      },
      {
        startMs: 3_200,
        endMs: 3_700,
        scale: 1.9,
        focusX: 0.78,
        focusY: 0.68,
        focusSpace: 'source',
        mode: 'anchor',
        easing: 'smooth',
        transitionDurationMs: 150
      }
    ]
  }
} as BackgroundConfig

const runButton = document.querySelector<HTMLButtonElement>('#run')!
const formatSelect = document.querySelector<HTMLSelectElement>('#format')!
const statusElement = document.querySelector<HTMLElement>('#status')!
const progressElement = document.querySelector<HTMLElement>('#progress')!
const matrixElement = document.querySelector<HTMLElement>('#matrix')!
const acceptanceElement = document.querySelector<HTMLElement>('#acceptance')!
const checkpointBody = document.querySelector<HTMLTableSectionElement>('#checkpoints')!
const metadataElement = document.querySelector<HTMLDListElement>('#metadata')!
const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview')!
const exportedCanvas = document.querySelector<HTMLCanvasElement>('#exported')!
const downloadElement = document.querySelector<HTMLAnchorElement>('#download')!
const environmentElement = document.querySelector<HTMLElement>('#environment')!

let objectUrl: string | null = null

environmentElement.textContent = `${navigator.userAgent} · WebCodecs ${'VideoEncoder' in window ? 'yes' : 'no'}`
renderMatrix()
runButton.addEventListener('click', () => void run())

class PreviewHarness {
  private readonly worker = new Worker(
    new URL('../../packages/extension/src/lib/workers/composite-worker/index.ts', import.meta.url),
    { type: 'module' }
  )
  private requestId = 1
  private readonly pending = new Map<number, {
    resolve: (bitmap: ImageBitmap) => void
    reject: (error: Error) => void
    timeout: number
  }>()

  constructor() {
    this.worker.addEventListener('message', event => {
      const message = event.data
      const requestId = message.data?.requestId
      if (message.type === 'frame' && requestId !== undefined) {
        const pending = this.pending.get(requestId)
        if (!pending) { message.data.bitmap.close(); return }
        window.clearTimeout(pending.timeout)
        this.pending.delete(requestId)
        pending.resolve(message.data.bitmap)
      } else if (message.type === 'renderUnavailable' && requestId !== undefined) {
        const pending = this.pending.get(requestId)
        if (!pending) return
        window.clearTimeout(pending.timeout)
        this.pending.delete(requestId)
        pending.reject(new Error(`Preview: ${message.data.reason}`))
      }
    })
  }

  initialize(chunks: readonly MemoryExportChunk[]) {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Preview initialization timeout')), 20_000)
      const listener = (event: MessageEvent) => {
        if (event.data.type === 'ready') {
          window.clearTimeout(timeout)
          this.worker.removeEventListener('message', listener)
          resolve()
        } else if (event.data.type === 'error') {
          window.clearTimeout(timeout)
          this.worker.removeEventListener('message', listener)
          reject(new Error(event.data.data?.error ?? event.data.data ?? 'Preview worker error'))
        }
      }
      this.worker.addEventListener('message', listener)
      this.worker.postMessage({
        type: 'process',
        data: {
          chunks,
          backgroundConfig: BACKGROUND_CONFIG,
          startGlobalFrame: 0,
          decodeStartGlobalFrame: 0,
          retainStartGlobalFrame: 0,
          retainedFrameCount: chunks.length,
          windowGeneration: 1,
          frameRate: FPS
        }
      })
    })
  }

  render(frameIndex: number, presentationTimeMs: number) {
    const requestId = this.requestId++
    return new Promise<ImageBitmap>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Preview checkpoint ${requestId} timeout`))
      }, 20_000)
      this.pending.set(requestId, { resolve, reject, timeout })
      this.worker.postMessage({
        type: 'renderAtTime',
        data: { frameIndex, presentationTimeMs, requestId, windowGeneration: 1 }
      })
    })
  }

  dispose() {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout)
      pending.reject(new Error('Preview disposed'))
    }
    this.pending.clear()
    this.worker.terminate()
  }
}

async function run() {
  resetUi()
  runButton.disabled = true
  formatSelect.disabled = true
  const format = formatSelect.value as ProductionExportFormat
  const preview = new PreviewHarness()

  try {
    assertEnvironment(format)
    updateProgress(4, '生成 51 帧确定性 WebCodecs 素材…')
    const { chunks, codec } = await buildSource()
    const memoryPlan = createMemoryTrimExportPlan(chunks, TRIM)
    const preparedChunks = memoryPlan.decodeChunks as MemoryExportChunk[]
    updateProgress(
      13,
      `生产 Slice plan：${preparedChunks.length}/${chunks.length} decode chunks，visible ${memoryPlan.visibleRange.visibleStartIndex}–${memoryPlan.visibleRange.visibleEndExclusive}`
    )

    await preview.initialize(chunks)
    const expected = [] as Array<{
      relativeTimeMs: number
      sourceTimeMs: number
      frameIndex: number
      pixels: ImageData
      edit: string
      mae?: number
      exported?: ImageData
    }>
    for (const relativeTimeMs of CHECKPOINTS_MS) {
      const sourceTimeMs = TRIM.startMs + relativeTimeMs
      const frameIndex = Math.floor(sourceTimeMs / 100)
      const bitmap = await preview.render(frameIndex, sourceTimeMs)
      expected.push({
        relativeTimeMs,
        sourceTimeMs,
        frameIndex,
        pixels: consumeBitmap(bitmap),
        edit: editLabel(sourceTimeMs)
      })
    }

    updateProgress(25, `启动真实 ${format.toUpperCase()} export-worker…`)
    const { blob, progressMessages } = await runProductionExportManager(format, chunks)
    if (blob.size <= 0) throw new Error('真实 export-worker 返回空 Blob')
    attachDownload(blob, format)

    updateProgress(88, 'Mediabunny 回读真实导出文件…')
    const metadata = await readExport(blob, expected)
    const acceptance = evaluateProductionExportAcceptance({
      actualDurationSeconds: metadata.durationSeconds,
      expectedDurationSeconds: EXPECTED_DURATION_SECONDS,
      actualWidth: metadata.width,
      actualHeight: metadata.height,
      expectedWidth: OUTPUT_WIDTH,
      expectedHeight: OUTPUT_HEIGHT,
      targetFrameRate: FPS,
      checkpointMae: expected.map(item => item.mae ?? Infinity)
    })
    renderEvidence(expected, acceptance, {
      format,
      codec,
      blobBytes: blob.size,
      sourceChunks: chunks.length,
      slicedChunks: preparedChunks.length,
      progressMessages,
      ...metadata
    })
    const selected = expected.find(item => item.edit.includes('1.9×')) ?? expected[1]
    putPixels(previewCanvas, selected.pixels)
    putPixels(exportedCanvas, selected.exported!)
    updateProgress(100, acceptance.pass
      ? `PASS：真实 ${format.toUpperCase()} export-worker 端到端一致`
      : `FAIL：真实 ${format.toUpperCase()} 产物未达到发布阈值`)
    statusElement.style.color = acceptance.pass ? '#5eead4' : '#fca5a5'
  } catch (error) {
    updateProgress(100, `运行失败：${error instanceof Error ? error.message : String(error)}`)
    statusElement.style.color = '#fca5a5'
  } finally {
    preview.dispose()
    runButton.disabled = false
    formatSelect.disabled = false
  }
}

async function buildSource() {
  const codec = await chooseSourceCodec()
  const chunks: MemoryExportChunk[] = []
  const encoder = new VideoEncoder({
    output(chunk) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({
        timestamp: chunk.timestamp,
        type: chunk.type,
        data,
        size: data.byteLength,
        codec,
        codedWidth: SOURCE_WIDTH,
        codedHeight: SOURCE_HEIGHT
      })
    },
    error(error) { throw error }
  })
  encoder.configure({
    codec,
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    framerate: FPS,
    bitrate: 2_000_000,
    latencyMode: 'realtime'
  })
  const canvas = new OffscreenCanvas(SOURCE_WIDTH, SOURCE_HEIGHT)
  const context = canvas.getContext('2d', { alpha: false })!
  for (let index = 0; index < SOURCE_FRAME_COUNT; index++) {
    drawPattern(context, index)
    const frame = new VideoFrame(canvas, { timestamp: index * 100_000 })
    encoder.encode(frame, { keyFrame: index % 10 === 0 })
    frame.close()
    if (encoder.encodeQueueSize > 5) await waitForEncoderDrain(encoder)
  }
  await encoder.flush()
  encoder.close()
  chunks.sort((left, right) => left.timestamp - right.timestamp)
  if (chunks.length !== SOURCE_FRAME_COUNT) throw new Error(`WebCodecs encoded ${chunks.length}/${SOURCE_FRAME_COUNT}`)
  return { chunks, codec }
}

async function runProductionExportManager(
  format: ProductionExportFormat,
  chunks: MemoryExportChunk[]
) {
  const manager = new ExportManager()
  let progressMessages = 0
  const options: ExportOptions = {
    format,
    includeBackground: true,
    backgroundConfig: BACKGROUND_CONFIG,
    quality: 'high',
    resolution: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    bitrate: 4_000_000,
    framerate: FPS,
    source: 'chunks',
    trim: TRIM
  }
  const blob = await manager.exportEditedVideo(chunks, options, progress => {
    progressMessages++
    const raw = Number(progress.progress)
    updateProgress(
      25 + Math.min(60, Math.max(0, raw) * 0.6),
      `${format.toUpperCase()} · ${progress.stage} · ${raw.toFixed(1)}%`
    )
  })
  if (!(blob instanceof Blob)) throw new Error('ExportManager 未从真实 worker complete 返回 Blob')
  return { blob, progressMessages }
}

async function readExport(
  blob: Blob,
  expected: Array<{ relativeTimeMs: number; pixels: ImageData; mae?: number; exported?: ImageData }>
) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const durationSeconds = await input.computeDuration()
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error('真实导出 Blob 没有视频轨道')
  const width = track.displayWidth
  const height = track.displayHeight
  const sink = new VideoSampleSink(track)
  const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  let index = 0
  for await (const sample of sink.samplesAtTimestamps(expected.map(item => item.relativeTimeMs / 1_000))) {
    if (!sample) throw new Error(`导出文件 checkpoint ${index} 无视频样本`)
    context.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    sample.draw(context, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    const exported = context.getImageData(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    expected[index].exported = exported
    expected[index].mae = pixelMae(expected[index].pixels, exported)
    sample.close()
    index++
  }
  input.dispose()
  return { durationSeconds, width, height }
}

function drawPattern(context: OffscreenCanvasRenderingContext2D, index: number) {
  const colors = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899']
  context.fillStyle = '#172554'
  context.fillRect(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT)
  for (let y = 0; y < SOURCE_HEIGHT; y += 20) {
    for (let x = 0; x < SOURCE_WIDTH; x += 20) {
      context.globalAlpha = 0.28
      context.fillStyle = colors[(x / 20 + y / 20 + index) % colors.length]
      context.fillRect(x, y, 20, 20)
    }
  }
  context.globalAlpha = 1
  context.strokeStyle = '#f8fafc'
  context.lineWidth = 5
  context.strokeRect(32, 25, 64, 64)
  context.fillStyle = '#fde047'
  context.beginPath(); context.arc(245, 55, 31, 0, Math.PI * 2); context.fill()
  context.fillStyle = '#2dd4bf'
  context.beginPath(); context.moveTo(155, 36); context.lineTo(205, 118); context.lineTo(112, 118); context.closePath(); context.fill()
  context.fillStyle = '#fff'
  context.fillRect(42 + (index * 17) % 235, 142, 24, 18)
  context.fillStyle = 'rgba(3,7,18,.82)'
  context.fillRect(8, 7, 150, 22)
  context.fillStyle = '#f8fafc'
  context.font = '12px ui-monospace, monospace'
  context.fillText(`F${index.toString().padStart(2, '0')} ${index * 100}ms`, 15, 22)
}

async function chooseSourceCodec() {
  for (const codec of ['vp8', 'vp09.00.10.08']) {
    const result = await VideoEncoder.isConfigSupported({
      codec,
      width: SOURCE_WIDTH,
      height: SOURCE_HEIGHT,
      framerate: FPS,
      bitrate: 2_000_000,
      latencyMode: 'realtime'
    })
    if (result.supported) return codec
  }
  throw new Error('浏览器不支持 VP8/VP9 源素材编码')
}

function consumeBitmap(bitmap: ImageBitmap) {
  const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
}

function pixelMae(left: ImageData, right: ImageData) {
  let total = 0
  for (let index = 0; index < left.data.length; index += 4) {
    total += Math.abs(left.data[index] - right.data[index])
    total += Math.abs(left.data[index + 1] - right.data[index + 1])
    total += Math.abs(left.data[index + 2] - right.data[index + 2])
  }
  return total / (left.width * left.height * 3)
}

function editLabel(sourceTimeMs: number) {
  if (sourceTimeMs >= 1_620 && sourceTimeMs < 1_800) return 'Crop + Zoom 1 entrance'
  if (sourceTimeMs >= 1_800 && sourceTimeMs <= 2_600) return 'Crop + Zoom 1.7×'
  if (sourceTimeMs > 2_600 && sourceTimeMs <= 2_780) return 'Crop + Zoom 1 exit'
  if (sourceTimeMs >= 3_050 && sourceTimeMs < 3_200) return 'Crop + Zoom 2 entrance'
  if (sourceTimeMs >= 3_200 && sourceTimeMs <= 3_700) return 'Crop + Zoom 1.9×'
  if (sourceTimeMs > 3_700 && sourceTimeMs <= 3_850) return 'Crop + Zoom 2 exit'
  return 'Crop / no zoom'
}

function renderMatrix() {
  matrixElement.innerHTML = buildProductionExportMatrix().map(item => `
    <article class="${item.state}">
      <h2>${item.format} · ${item.state}</h2>
      <p>${item.detail}</p>
    </article>`).join('')
}

function renderEvidence(
  expected: Array<{ relativeTimeMs: number; sourceTimeMs: number; frameIndex: number; edit: string; mae?: number }>,
  acceptance: ReturnType<typeof evaluateProductionExportAcceptance>,
  metadata: {
    format: ProductionExportFormat
    codec: string
    blobBytes: number
    sourceChunks: number
    slicedChunks: number
    progressMessages: number
    durationSeconds: number
    width: number
    height: number
  }
) {
  acceptanceElement.innerHTML = [
    ['complete Blob', metadata.blobBytes > 0, `${metadata.blobBytes.toLocaleString()} bytes`],
    ['duration', acceptance.durationPass, `${metadata.durationSeconds.toFixed(3)}s / ${EXPECTED_DURATION_SECONDS.toFixed(3)}s`],
    ['dimensions', acceptance.dimensionsPass, `${metadata.width}×${metadata.height}`],
    ['pixels', acceptance.pixelsPass, `max MAE ${acceptance.maxCheckpointMae.toFixed(2)}`]
  ].map(([label, pass, detail]) => `<div class="${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'} · ${label}<br>${detail}</div>`).join('')

  checkpointBody.innerHTML = expected.map(item => {
    const pass = (item.mae ?? Infinity) <= 18
    return `<tr class="${pass ? 'pass' : 'fail'}">
      <td>${(item.relativeTimeMs / 1_000).toFixed(3)}s</td>
      <td>${(item.sourceTimeMs / 1_000).toFixed(3)}s</td>
      <td>${item.frameIndex}</td>
      <td>${item.edit}</td>
      <td>${item.mae?.toFixed(2) ?? '—'}</td>
      <td>${pass ? 'PASS' : 'FAIL'}</td>
    </tr>`
  }).join('')

  metadataElement.innerHTML = [
    ['format', metadata.format.toUpperCase()],
    ['source codec', metadata.codec],
    ['chunks', `${metadata.slicedChunks}/${metadata.sourceChunks}`],
    ['worker progress', `${metadata.progressMessages} messages`],
    ['duration', `${metadata.durationSeconds.toFixed(3)}s`],
    ['display', `${metadata.width}×${metadata.height}`]
  ].map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join('')
}

function attachDownload(blob: Blob, format: ProductionExportFormat) {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(blob)
  downloadElement.href = objectUrl
  downloadElement.download = `production-export-worker.${format}`
  downloadElement.hidden = false
}

function putPixels(canvas: HTMLCanvasElement, pixels: ImageData) {
  canvas.getContext('2d')!.putImageData(pixels, 0, 0)
}

function resetUi() {
  statusElement.style.color = ''
  acceptanceElement.innerHTML = ''
  checkpointBody.innerHTML = ''
  metadataElement.innerHTML = ''
  downloadElement.hidden = true
  previewCanvas.getContext('2d')!.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
  exportedCanvas.getContext('2d')!.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
  updateProgress(0, '开始运行')
}

function updateProgress(percent: number, message: string) {
  progressElement.style.width = `${Math.min(100, Math.max(0, percent))}%`
  statusElement.textContent = message
}

function assertEnvironment(format: ProductionExportFormat) {
  if (format === 'gif') throw new Error('GIF 需要主线程编码桥，本薄片未宣称已验证')
  if (!('VideoEncoder' in window) || !('VideoDecoder' in window) || !('OffscreenCanvas' in window)) {
    throw new Error('WebCodecs / OffscreenCanvas 环境不完整')
  }
}

function waitForEncoderDrain(encoder: VideoEncoder) {
  return new Promise<void>(resolve => encoder.addEventListener('dequeue', () => resolve(), { once: true }))
}
