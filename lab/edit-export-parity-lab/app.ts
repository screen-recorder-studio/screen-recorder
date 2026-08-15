import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink
} from '../../packages/extension/node_modules/mediabunny'
import {
  hasTimeVaryingEditEffects,
  rebaseZoomForTrim,
  toTrimmedPresentationTimeMs
} from '../../packages/extension/src/lib/export/edit-export-parity'
import type { BackgroundConfig } from '../../packages/extension/src/lib/types/background'

type EncodedSourceChunk = {
  type: EncodedVideoChunkType
  timestamp: number
  data: Uint8Array
  codec: string
  codedWidth: number
  codedHeight: number
}

type WorkerFrame = {
  bitmap: ImageBitmap
  frameIndex: number
  presentationTimeMs: number
}

type CheckpointResult = {
  relativeTimeMs: number
  sourceTimeMs: number
  sourceFrameIndex: number
  zoomLabel: string
  preview: ImageData
  correct: ImageData
  legacy: ImageData
  mediabunny?: ImageData
  htmlVideo?: ImageData
  rawMae: number
  legacyMae: number
  mediabunnyMae?: number
  htmlVideoMae?: number
}

const SOURCE_WIDTH = 320
const SOURCE_HEIGHT = 180
const OUTPUT_WIDTH = 640
const OUTPUT_HEIGHT = 360
const TRIM = { enabled: true, startMs: 1_400, endMs: 5_400 }
const EXPORT_DURATION_MS = TRIM.endMs - TRIM.startMs
const EXPORT_FPS = 10
const FRAME_DURATION_MS = 1_000 / EXPORT_FPS
const SOURCE_TIMESTAMPS_MS = [0, 260, 710, 1_200, 1_400, 1_950, 2_520, 3_100, 3_650, 4_200, 4_700, 5_400, 6_100]
const CHECKPOINTS_MS = [0, 700, 1_400, 2_200, 3_200, 3_800]
const RAW_MAE_LIMIT = 0.05
const MP4_MAE_LIMIT = 18
const LEGACY_MAE_MINIMUM = 8
const DURATION_TOLERANCE_SECONDS = 0.12

const SOURCE_CONFIG: BackgroundConfig = {
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
    scale: 1.65,
    transitionDurationMs: 200,
    intervals: [
      {
        startMs: 2_500,
        endMs: 3_300,
        scale: 1.65,
        focusX: 0.2,
        focusY: 0.3,
        focusSpace: 'source',
        mode: 'dolly',
        easing: 'linear'
      },
      {
        startMs: 4_350,
        endMs: 4_950,
        scale: 1.9,
        focusX: 0.78,
        focusY: 0.68,
        focusSpace: 'source',
        mode: 'anchor',
        easing: 'smooth',
        transitionDurationMs: 180
      }
    ]
  }
} as BackgroundConfig

const runButton = document.querySelector<HTMLButtonElement>('#run')!
const statusElement = document.querySelector<HTMLElement>('#status')!
const progressElement = document.querySelector<HTMLElement>('#progress')!
const checkpointBody = document.querySelector<HTMLTableSectionElement>('#checkpoint-body')!
const metadataElement = document.querySelector<HTMLDListElement>('#metadata')!
const contractElement = document.querySelector<HTMLElement>('#contract-output')!
const videoElement = document.querySelector<HTMLVideoElement>('#result-video')!
const downloadElement = document.querySelector<HTMLAnchorElement>('#download')!
const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview-canvas')!
const correctCanvas = document.querySelector<HTMLCanvasElement>('#export-canvas')!
const legacyCanvas = document.querySelector<HTMLCanvasElement>('#legacy-canvas')!
const environmentElement = document.querySelector<HTMLElement>('#environment')!

let currentObjectUrl: string | null = null

environmentElement.textContent = `Mediabunny 1.35 · ${navigator.userAgent}`
runButton.addEventListener('click', () => void run())

class CompositeHarness {
  private readonly worker = new Worker(
    new URL('../../packages/extension/src/lib/workers/composite-worker/index.ts', import.meta.url),
    { type: 'module' }
  )
  private readonly pending = new Map<number, {
    resolve: (frame: WorkerFrame) => void
    reject: (error: Error) => void
    timeout: number
  }>()
  private requestId = 1
  private generation = 1

  constructor(private readonly name: string) {
    this.worker.addEventListener('message', event => this.handleMessage(event.data))
    this.worker.addEventListener('error', event => this.rejectAll(new Error(`${name}: ${event.message}`)))
  }

  initialize(chunks: EncodedSourceChunk[], backgroundConfig: BackgroundConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`${this.name}: process timeout`)), 20_000)
      const onMessage = (event: MessageEvent) => {
        if (event.data.type === 'ready' && event.data.data?.windowGeneration === this.generation) {
          window.clearTimeout(timeout)
          this.worker.removeEventListener('message', onMessage)
          const size = event.data.data.outputSize
          if (size?.width !== OUTPUT_WIDTH || size?.height !== OUTPUT_HEIGHT) {
            reject(new Error(`${this.name}: unexpected output ${size?.width}x${size?.height}`))
            return
          }
          resolve()
        } else if (event.data.type === 'error') {
          window.clearTimeout(timeout)
          this.worker.removeEventListener('message', onMessage)
          reject(new Error(`${this.name}: ${event.data.data ?? 'worker error'}`))
        }
      }
      this.worker.addEventListener('message', onMessage)
      this.worker.postMessage({
        type: 'process',
        data: {
          chunks,
          backgroundConfig,
          startGlobalFrame: 0,
          decodeStartGlobalFrame: 0,
          retainStartGlobalFrame: 0,
          retainedFrameCount: chunks.length,
          windowGeneration: this.generation,
          frameRate: EXPORT_FPS
        }
      })
    })
  }

  render(frameIndex: number, presentationTimeMs: number): Promise<WorkerFrame> {
    const requestId = this.requestId++
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`${this.name}: render ${requestId} timeout`))
      }, 20_000)
      this.pending.set(requestId, { resolve, reject, timeout })
      this.worker.postMessage({
        type: 'renderAtTime',
        data: {
          frameIndex,
          presentationTimeMs,
          requestId,
          windowGeneration: this.generation
        }
      })
    })
  }

  dispose() {
    this.rejectAll(new Error(`${this.name}: disposed`))
    this.worker.terminate()
  }

  private handleMessage(message: any) {
    if (message.type === 'frame' && message.data?.requestId !== undefined) {
      const pending = this.pending.get(message.data.requestId)
      if (!pending) {
        message.data.bitmap?.close()
        return
      }
      window.clearTimeout(pending.timeout)
      this.pending.delete(message.data.requestId)
      pending.resolve(message.data)
      return
    }
    if (message.type === 'renderUnavailable' && message.data?.requestId !== undefined) {
      const pending = this.pending.get(message.data.requestId)
      if (!pending) return
      window.clearTimeout(pending.timeout)
      this.pending.delete(message.data.requestId)
      pending.reject(new Error(`${this.name}: ${message.data.reason}`))
    }
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

async function run() {
  resetUi()
  runButton.disabled = true
  const preview = new CompositeHarness('Preview')
  const correct = new CompositeHarness('Export')
  const legacy = new CompositeHarness('Legacy')

  try {
    updateProgress(4, '正在生成确定性稀疏源素材…')
    assertEnvironment()
    const { chunks, codec } = await buildSparseSource()
    const sourcePass = chunks.length === SOURCE_TIMESTAMPS_MS.length
      && chunks.every((chunk, index) => index === 0 || chunk.timestamp > chunks[index - 1].timestamp)
    setCheck('source', sourcePass, `${codec} · ${chunks.length} 个稀疏 chunk · ${SOURCE_WIDTH}×${SOURCE_HEIGHT}`)
    if (!sourcePass) throw new Error('稀疏源素材数量或时间戳不符合契约')

    const exportConfig = rebaseZoomForTrim(SOURCE_CONFIG, TRIM)
    if (!hasTimeVaryingEditEffects(SOURCE_CONFIG) || !hasTimeVaryingEditEffects(exportConfig)) {
      throw new Error('时间变化编辑效果探测失败')
    }
    renderContract(exportConfig)

    updateProgress(15, '正在初始化三个生产 Composite Worker…')
    await Promise.all([
      preview.initialize(chunks, SOURCE_CONFIG),
      correct.initialize(chunks, exportConfig),
      legacy.initialize(chunks, SOURCE_CONFIG)
    ])

    const results: CheckpointResult[] = []
    for (let index = 0; index < CHECKPOINTS_MS.length; index++) {
      const relativeTimeMs = CHECKPOINTS_MS[index]
      const sourceTimeMs = TRIM.startMs + relativeTimeMs
      const exportTimeMs = toTrimmedPresentationTimeMs(sourceTimeMs, TRIM.startMs)
      const sourceFrameIndex = findSourceFrame(sourceTimeMs)
      updateProgress(20 + index * 5, `生产 Worker checkpoint ${index + 1}/${CHECKPOINTS_MS.length}…`)
      const [previewFrame, correctFrame, legacyFrame] = await Promise.all([
        preview.render(sourceFrameIndex, sourceTimeMs),
        correct.render(sourceFrameIndex, exportTimeMs),
        legacy.render(sourceFrameIndex, exportTimeMs)
      ])
      const previewPixels = consumeBitmap(previewFrame.bitmap)
      const correctPixels = consumeBitmap(correctFrame.bitmap)
      const legacyPixels = consumeBitmap(legacyFrame.bitmap)
      results.push({
        relativeTimeMs,
        sourceTimeMs,
        sourceFrameIndex,
        zoomLabel: activeZoomLabel(sourceTimeMs),
        preview: previewPixels,
        correct: correctPixels,
        legacy: legacyPixels,
        rawMae: pixelMae(previewPixels, correctPixels),
        legacyMae: pixelMae(previewPixels, legacyPixels)
      })
    }

    const rawPass = results.every(result => result.rawMae <= RAW_MAE_LIMIT)
    const legacyMismatchCount = results.filter(result => result.legacyMae >= LEGACY_MAE_MINIMUM).length
    setCheck('raw-parity', rawPass, `最大 Raw MAE ${formatMetric(Math.max(...results.map(result => result.rawMae)))}`)
    setCheck('legacy', legacyMismatchCount >= 2, `${legacyMismatchCount}/${results.length} 个 checkpoint 显著失配`)

    updateProgress(54, '正在用 Mediabunny CanvasSource 生成 MP4…')
    const mp4Blob = await encodeMp4(correct)
    attachVideo(mp4Blob)

    updateProgress(78, '正在用 Mediabunny 回读 MP4…')
    const mediaMetadata = await readWithMediabunny(mp4Blob, results)
    updateProgress(88, '正在用 HTMLVideoElement 回读 MP4…')
    const htmlMetadata = await readWithHtmlVideo(results)

    const metadataPass = Math.abs(mediaMetadata.durationSeconds - EXPORT_DURATION_MS / 1000) <= DURATION_TOLERANCE_SECONDS
      && Math.abs(htmlMetadata.durationSeconds - EXPORT_DURATION_MS / 1000) <= DURATION_TOLERANCE_SECONDS
      && mediaMetadata.width === OUTPUT_WIDTH
      && mediaMetadata.height === OUTPUT_HEIGHT
      && htmlMetadata.width === OUTPUT_WIDTH
      && htmlMetadata.height === OUTPUT_HEIGHT
    const pixelPass = results.every(result =>
      (result.mediabunnyMae ?? Infinity) <= MP4_MAE_LIMIT
      && (result.htmlVideoMae ?? Infinity) <= MP4_MAE_LIMIT
    )
    setCheck(
      'mp4',
      metadataPass && pixelPass,
      `${mp4Blob.size.toLocaleString()} bytes · ${mediaMetadata.durationSeconds.toFixed(3)}s · ${mediaMetadata.width}×${mediaMetadata.height}`
    )
    renderMetadata(mp4Blob, mediaMetadata, htmlMetadata)
    renderTable(results)
    showCheckpoint(results.find(result => result.zoomLabel.includes('1.9×')) ?? results[2])

    const allPass = sourcePass && rawPass && legacyMismatchCount >= 2 && metadataPass && pixelPass
    updateProgress(100, allPass ? 'PASS：编辑预览与 MP4 导出一致' : 'FAIL：至少一项验收未通过')
    statusElement.style.color = allPass ? '#5eead4' : '#fca5a5'
  } catch (error) {
    updateProgress(100, `运行失败：${error instanceof Error ? error.message : String(error)}`)
    statusElement.style.color = '#fca5a5'
  } finally {
    preview.dispose()
    correct.dispose()
    legacy.dispose()
    runButton.disabled = false
  }
}

async function buildSparseSource(): Promise<{ chunks: EncodedSourceChunk[]; codec: string }> {
  const codec = await chooseSourceCodec()
  const chunks: EncodedSourceChunk[] = []
  const encoder = new VideoEncoder({
    output(chunk) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({
        type: chunk.type,
        timestamp: chunk.timestamp,
        data,
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
    bitrate: 1_800_000,
    framerate: EXPORT_FPS,
    latencyMode: 'realtime'
  })
  const canvas = new OffscreenCanvas(SOURCE_WIDTH, SOURCE_HEIGHT)
  const context = canvas.getContext('2d', { alpha: false })!

  for (let index = 0; index < SOURCE_TIMESTAMPS_MS.length; index++) {
    const timestampMs = SOURCE_TIMESTAMPS_MS[index]
    drawSourcePattern(context, index, timestampMs)
    const frame = new VideoFrame(canvas, { timestamp: timestampMs * 1_000 })
    encoder.encode(frame, { keyFrame: true })
    frame.close()
    if (encoder.encodeQueueSize > 4) await waitForEncoderDrain(encoder)
  }
  await encoder.flush()
  encoder.close()
  chunks.sort((left, right) => left.timestamp - right.timestamp)
  return { chunks, codec }
}

async function chooseSourceCodec() {
  for (const codec of ['vp8', 'vp09.00.10.08']) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width: SOURCE_WIDTH,
      height: SOURCE_HEIGHT,
      bitrate: 1_800_000,
      framerate: EXPORT_FPS,
      latencyMode: 'realtime'
    })
    if (support.supported) return codec
  }
  throw new Error('浏览器不支持 VP8/VP9 WebCodecs 编码')
}

function drawSourcePattern(context: OffscreenCanvasRenderingContext2D, index: number, timestampMs: number) {
  context.fillStyle = '#172554'
  context.fillRect(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT)
  const palette = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899']
  for (let y = 0; y < SOURCE_HEIGHT; y += 20) {
    for (let x = 0; x < SOURCE_WIDTH; x += 20) {
      context.fillStyle = palette[(x / 20 + y / 20 + index) % palette.length]
      context.globalAlpha = 0.26
      context.fillRect(x, y, 20, 20)
    }
  }
  context.globalAlpha = 1
  context.strokeStyle = '#f8fafc'
  context.lineWidth = 5
  context.strokeRect(32, 25, 64, 64)
  context.fillStyle = '#fde047'
  context.beginPath()
  context.arc(245, 55, 31, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#2dd4bf'
  context.beginPath()
  context.moveTo(155, 36)
  context.lineTo(205, 118)
  context.lineTo(112, 118)
  context.closePath()
  context.fill()
  const markerX = 45 + (index * 29) % 230
  context.fillStyle = '#ffffff'
  context.fillRect(markerX, 142, 24, 18)
  context.fillStyle = 'rgba(3, 7, 18, .82)'
  context.fillRect(8, 7, 145, 22)
  context.fillStyle = '#f8fafc'
  context.font = '12px ui-monospace, monospace'
  context.fillText(`F${index.toString().padStart(2, '0')} ${timestampMs}ms`, 15, 22)
}

async function encodeMp4(correct: CompositeHarness): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_WIDTH
  canvas.height = OUTPUT_HEIGHT
  const context = canvas.getContext('2d', { alpha: false })!
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat(), target })
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: 4_000_000 })
  output.addVideoTrack(videoSource)
  await output.start()

  const frameCount = Math.round(EXPORT_DURATION_MS / FRAME_DURATION_MS)
  for (let index = 0; index < frameCount; index++) {
    const relativeTimeMs = index * FRAME_DURATION_MS
    const sourceTimeMs = TRIM.startMs + relativeTimeMs
    const frame = await correct.render(findSourceFrame(sourceTimeMs), relativeTimeMs)
    context.drawImage(frame.bitmap, 0, 0)
    frame.bitmap.close()
    await videoSource.add(relativeTimeMs / 1_000, FRAME_DURATION_MS / 1_000, { keyFrame: index % 20 === 0 })
    if (index % 5 === 0) updateProgress(54 + (index / frameCount) * 22, `MP4 编码 ${index + 1}/${frameCount}`)
  }
  await output.finalize()
  if (!target.buffer) throw new Error('Mediabunny 未生成 MP4 buffer')
  return new Blob([target.buffer], { type: 'video/mp4' })
}

async function readWithMediabunny(blob: Blob, results: CheckpointResult[]) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const durationSeconds = await input.computeDuration()
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error('Mediabunny 未找到视频轨道')
  const sink = new VideoSampleSink(track)
  const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  let index = 0
  for await (const sample of sink.samplesAtTimestamps(results.map(result => result.relativeTimeMs / 1_000))) {
    if (!sample) throw new Error(`Mediabunny checkpoint ${index} 无解码帧`)
    context.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    sample.draw(context, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    const pixels = context.getImageData(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    results[index].mediabunny = pixels
    results[index].mediabunnyMae = pixelMae(results[index].preview, pixels)
    sample.close()
    index++
  }
  input.dispose()
  return { durationSeconds, width: track.displayWidth, height: track.displayHeight }
}

async function readWithHtmlVideo(results: CheckpointResult[]) {
  await waitForVideoMetadata(videoElement)
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_WIDTH
  canvas.height = OUTPUT_HEIGHT
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  for (const result of results) {
    await seekVideo(videoElement, result.relativeTimeMs / 1_000)
    context.drawImage(videoElement, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    const pixels = context.getImageData(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    result.htmlVideo = pixels
    result.htmlVideoMae = pixelMae(result.preview, pixels)
  }
  return { durationSeconds: videoElement.duration, width: videoElement.videoWidth, height: videoElement.videoHeight }
}

function attachVideo(blob: Blob) {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
  currentObjectUrl = URL.createObjectURL(blob)
  videoElement.src = currentObjectUrl
  videoElement.load()
  downloadElement.href = currentObjectUrl
  downloadElement.hidden = false
}

function consumeBitmap(bitmap: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT)
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
}

function pixelMae(left: ImageData, right: ImageData) {
  if (left.width !== right.width || left.height !== right.height) return Infinity
  let total = 0
  for (let index = 0; index < left.data.length; index += 4) {
    total += Math.abs(left.data[index] - right.data[index])
    total += Math.abs(left.data[index + 1] - right.data[index + 1])
    total += Math.abs(left.data[index + 2] - right.data[index + 2])
  }
  return total / (left.width * left.height * 3)
}

function findSourceFrame(sourceTimeMs: number) {
  let index = 0
  while (index + 1 < SOURCE_TIMESTAMPS_MS.length && SOURCE_TIMESTAMPS_MS[index + 1] <= sourceTimeMs) index++
  return index
}

function activeZoomLabel(sourceTimeMs: number) {
  const interval = (SOURCE_CONFIG.videoZoom?.intervals as any[])?.find(item => sourceTimeMs >= item.startMs && sourceTimeMs <= item.endMs)
  return interval ? `${interval.scale ?? SOURCE_CONFIG.videoZoom?.scale}×` : '1× / transition'
}

function showCheckpoint(result: CheckpointResult) {
  putPixels(previewCanvas, result.preview)
  putPixels(correctCanvas, result.correct)
  putPixels(legacyCanvas, result.legacy)
  void seekVideo(videoElement, result.relativeTimeMs / 1_000)
}

function putPixels(canvas: HTMLCanvasElement, pixels: ImageData) {
  canvas.getContext('2d')!.putImageData(pixels, 0, 0)
}

function renderTable(results: CheckpointResult[]) {
  checkpointBody.innerHTML = results.map(result => {
    const pass = result.rawMae <= RAW_MAE_LIMIT
      && (result.mediabunnyMae ?? Infinity) <= MP4_MAE_LIMIT
      && (result.htmlVideoMae ?? Infinity) <= MP4_MAE_LIMIT
    return `<tr class="${pass ? 'pass' : 'fail'}">
      <td>${formatTime(result.relativeTimeMs)}</td>
      <td>${formatTime(result.sourceTimeMs)}</td>
      <td>${result.sourceFrameIndex} @ ${SOURCE_TIMESTAMPS_MS[result.sourceFrameIndex]}ms</td>
      <td>${result.zoomLabel}</td>
      <td>${formatMetric(result.rawMae)}</td>
      <td>${formatMetric(result.mediabunnyMae)}</td>
      <td>${formatMetric(result.htmlVideoMae)}</td>
      <td>${formatMetric(result.legacyMae)}</td>
      <td>${pass ? 'PASS' : 'FAIL'}</td>
    </tr>`
  }).join('')
}

function renderContract(exportConfig: BackgroundConfig) {
  const sourceIntervals = (SOURCE_CONFIG.videoZoom?.intervals as any[]).map(item => `[${item.startMs}, ${item.endMs}]`).join('  ')
  const exportIntervals = (exportConfig.videoZoom?.intervals as any[]).map(item => `[${item.startMs}, ${item.endMs}]`).join('  ')
  contractElement.textContent = [
    `Trim source: [${TRIM.startMs}, ${TRIM.endMs}] ms`,
    `Preview Zoom: ${sourceIntervals}`,
    `Export Zoom:  ${exportIntervals}`,
    `t_export = t_source - ${TRIM.startMs} ms`,
    'Unrebased baseline: t_export + Preview Zoom  ← expected mismatch'
  ].join('\n')
}

function renderMetadata(
  blob: Blob,
  media: { durationSeconds: number; width: number; height: number },
  html: { durationSeconds: number; width: number; height: number }
) {
  metadataElement.innerHTML = [
    ['目标', `${(EXPORT_DURATION_MS / 1000).toFixed(3)}s · ${OUTPUT_WIDTH}×${OUTPUT_HEIGHT}`],
    ['Mediabunny', `${media.durationSeconds.toFixed(3)}s · ${media.width}×${media.height}`],
    ['HTMLVideo', `${html.durationSeconds.toFixed(3)}s · ${html.width}×${html.height}`],
    ['MP4 bytes', blob.size.toLocaleString()],
    ['Pixel limit', `MAE ≤ ${MP4_MAE_LIMIT}`]
  ].map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join('')
}

function setCheck(name: string, pass: boolean, detail: string) {
  const element = document.querySelector<HTMLElement>(`[data-check="${name}"]`)!
  element.classList.remove('pass', 'fail')
  element.classList.add(pass ? 'pass' : 'fail')
  element.querySelector('p')!.textContent = `${pass ? '通过' : '失败'}：${detail}`
}

function resetUi() {
  checkpointBody.innerHTML = ''
  metadataElement.innerHTML = ''
  statusElement.style.color = ''
  downloadElement.hidden = true
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-check]'))) {
    element.classList.remove('pass', 'fail')
  }
  for (const canvas of [previewCanvas, correctCanvas, legacyCanvas]) canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
  updateProgress(0, '开始运行')
}

function updateProgress(percent: number, status: string) {
  progressElement.style.width = `${Math.min(100, Math.max(0, percent))}%`
  statusElement.textContent = status
}

function assertEnvironment() {
  if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) throw new Error('WebCodecs 不可用')
  if (!('OffscreenCanvas' in window)) throw new Error('OffscreenCanvas 不可用')
}

function formatTime(milliseconds: number) {
  return `${(milliseconds / 1_000).toFixed(3)}s`
}

function formatMetric(value: number | undefined) {
  return value === undefined ? '—' : Number.isFinite(value) ? value.toFixed(2) : '∞'
}

function waitForEncoderDrain(encoder: VideoEncoder) {
  return new Promise<void>(resolve => encoder.addEventListener('dequeue', () => resolve(), { once: true }))
}

function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('HTMLVideo metadata timeout')), 15_000)
    video.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timeout)
      resolve()
    }, { once: true })
    video.addEventListener('error', () => {
      window.clearTimeout(timeout)
      reject(new Error(`HTMLVideo load error ${video.error?.code ?? ''}`))
    }, { once: true })
  })
}

function seekVideo(video: HTMLVideoElement, timeSeconds: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(`HTMLVideo seek ${timeSeconds.toFixed(3)}s timeout`))
    }, 10_000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
    }
    const onSeeked = () => {
      cleanup()
      if ('requestVideoFrameCallback' in video) {
        let settled = false
        const fallback = window.setTimeout(() => {
          if (!settled) { settled = true; resolve() }
        }, 120)
        video.requestVideoFrameCallback(() => {
          if (settled) return
          settled = true
          window.clearTimeout(fallback)
          resolve()
        })
      } else {
        resolve()
      }
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.currentTime = Math.min(timeSeconds, Math.max(0, video.duration - 0.001))
  })
}
