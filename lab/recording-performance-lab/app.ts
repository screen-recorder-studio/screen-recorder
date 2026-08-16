import type { BackgroundConfig, ExportOptions } from '../../packages/extension/src/lib/types/background'
import { ExportManager } from '../../packages/extension/src/lib/services/export-manager'
import {
  PERFORMANCE_SCENARIOS,
  evaluatePerformanceRun,
  projectExportMinutes,
  type PerformanceScenario
} from './performance-fixture'

interface EncodedSourceChunk {
  data: Uint8Array
  timestamp: number
  type: 'key' | 'delta'
  size: number
  codec: string
  codedWidth: number
  codedHeight: number
}

const scenarioSelect = document.querySelector<HTMLSelectElement>('#scenario')!
const runButton = document.querySelector<HTMLButtonElement>('#run')!
const statusElement = document.querySelector<HTMLElement>('#status')!
const progressElement = document.querySelector<HTMLElement>('#progress')!
const metricsElement = document.querySelector<HTMLElement>('#metrics')!
const resultsElement = document.querySelector<HTMLTableSectionElement>('#results')!
const detailsElement = document.querySelector<HTMLElement>('#details')!
const environmentElement = document.querySelector<HTMLElement>('#environment')!
const sourceCanvas = document.querySelector<HTMLCanvasElement>('#source')!
const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview')!

for (const scenario of PERFORMANCE_SCENARIOS) {
  const option = document.createElement('option')
  option.value = scenario.id
  option.textContent = `${scenario.label}${scenario.runByDefault ? '' : ' · ⚠️'}`
  scenarioSelect.append(option)
}

environmentElement.textContent = [
  `${navigator.hardwareConcurrency || '?'} logical cores`,
  `${(navigator as Navigator & { deviceMemory?: number }).deviceMemory || '?'} GB deviceMemory`,
  `Chrome ${navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? '?'}`
].join(' · ')

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
        pending.reject(new Error(`Preview unavailable: ${message.data.reason}`))
      }
    })
  }

  initialize(chunks: readonly EncodedSourceChunk[], config: BackgroundConfig, frameRate: number) {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Preview initialization timeout')), 30_000)
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
          backgroundConfig: config,
          startGlobalFrame: 0,
          decodeStartGlobalFrame: 0,
          retainStartGlobalFrame: 0,
          retainedFrameCount: chunks.length,
          windowGeneration: 1,
          frameRate
        }
      })
    })
  }

  render(frameIndex: number, presentationTimeMs: number) {
    const requestId = this.requestId++
    return new Promise<ImageBitmap>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Preview frame ${frameIndex} timeout`))
      }, 30_000)
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
  const scenario = PERFORMANCE_SCENARIOS.find(item => item.id === scenarioSelect.value)!
  runButton.disabled = true
  scenarioSelect.disabled = true
  resetUi()
  const heapBefore = currentHeapBytes()

  try {
    assertEnvironment()
    updateProgress(3, `生成 ${scenario.label} 素材…`)
    const capture = await encodeScenario(scenario)
    updateProgress(38, `录制编码完成：${capture.chunks.length}/${capture.frameCount} chunks`)

    const backgroundConfig = createBackgroundConfig(scenario)
    const preview = new PreviewHarness()
    let previewDurations: number[] = []
    try {
      await preview.initialize(capture.chunks, backgroundConfig, scenario.frameRate)
      previewDurations = await benchmarkPreview(preview, scenario, capture.frameCount)
    } finally {
      preview.dispose()
    }
    updateProgress(68, '生产 Composite Worker 预览完成')

    const exportStarted = performance.now()
    const exportManager = new ExportManager()
    const blob = await exportManager.exportEditedVideo(capture.chunks, {
      format: 'webm',
      includeBackground: true,
      backgroundConfig,
      quality: 'medium',
      resolution: { width: scenario.outputWidth, height: scenario.outputHeight },
      bitrate: bitrateFor(scenario),
      framerate: scenario.frameRate,
      source: 'chunks'
    } satisfies ExportOptions, progress => {
      updateProgress(68 + Math.min(29, Math.max(0, Number(progress.progress)) * 0.29), `WebM · ${progress.stage}`)
    })
    const exportMs = performance.now() - exportStarted
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error('Production ExportManager returned no WebM Blob')

    const previewP95Ms = percentile(previewDurations, 0.95)
    const captureRtf = capture.elapsedMs / 1000 / scenario.durationSeconds
    const exportRtf = exportMs / 1000 / scenario.durationSeconds
    const metrics = {
      captureRtf,
      previewP95Ms,
      exportRtf,
      droppedFrames: capture.frameCount - capture.chunks.length,
      frameCount: capture.frameCount
    }
    const acceptance = evaluatePerformanceRun(scenario, metrics)
    const heapAfter = currentHeapBytes()

    renderResult(scenario, metrics, acceptance, {
      codec: capture.codec,
      maxEncodeQueue: capture.maxEncodeQueue,
      blobBytes: blob.size,
      heapDeltaBytes: heapBefore === null || heapAfter === null ? null : heapAfter - heapBefore
    })
    updateProgress(100, acceptance.pass ? 'PASS：选中场景达到发布预算' : `FAIL：${acceptance.failures.join(', ')}`)
    statusElement.className = acceptance.pass ? 'pass' : 'fail'
  } catch (error) {
    updateProgress(100, `运行失败：${error instanceof Error ? error.message : String(error)}`)
    statusElement.className = 'fail'
  } finally {
    runButton.disabled = false
    scenarioSelect.disabled = false
  }
}

async function encodeScenario(scenario: PerformanceScenario) {
  const frameCount = Math.ceil(scenario.durationSeconds * scenario.frameRate)
  const source = new OffscreenCanvas(scenario.sourceWidth, scenario.sourceHeight)
  const sourceContext = source.getContext('2d', { alpha: false })!
  const chunks: EncodedSourceChunk[] = []
  const { config, codec } = await resolveEncoderConfig(scenario)
  let maxEncodeQueue = 0
  const encoder = new VideoEncoder({
    output(chunk) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({
        data,
        timestamp: chunk.timestamp,
        type: chunk.type,
        size: chunk.byteLength,
        codec,
        codedWidth: config.width,
        codedHeight: config.height
      })
    },
    error(error) { throw error }
  })
  encoder.configure(config)

  const started = performance.now()
  for (let index = 0; index < frameCount; index++) {
    drawPattern(sourceContext, scenario.sourceWidth, scenario.sourceHeight, index, frameCount)
    const timestamp = Math.round(index * 1_000_000 / scenario.frameRate)
    const duration = Math.round(1_000_000 / scenario.frameRate)
    // Production-faithful scaling contract: submit a capture-sized frame to
    // an encoder configured for the balanced output target.
    const frame = new VideoFrame(source, { timestamp, duration })
    encoder.encode(frame, { keyFrame: index === 0 || index % (scenario.frameRate * 2) === 0 })
    frame.close()
    maxEncodeQueue = Math.max(maxEncodeQueue, encoder.encodeQueueSize)
    while (encoder.encodeQueueSize > 4) await waitForQueueDrain(encoder)
    if (index % 4 === 0) updateSourcePreview(source, index)
  }
  await encoder.flush()
  const elapsedMs = performance.now() - started
  encoder.close()
  chunks.sort((left, right) => left.timestamp - right.timestamp)
  return { chunks, codec, elapsedMs, maxEncodeQueue, frameCount }
}

async function benchmarkPreview(preview: PreviewHarness, scenario: PerformanceScenario, frameCount: number) {
  const timings: number[] = []
  const context = previewCanvas.getContext('2d', { alpha: false })!
  for (let index = 0; index < frameCount; index++) {
    const started = performance.now()
    const bitmap = await preview.render(index, index * 1000 / scenario.frameRate)
    timings.push(performance.now() - started)
    if (index % Math.max(1, Math.floor(frameCount / 8)) === 0 || index === frameCount - 1) {
      context.drawImage(bitmap, 0, 0, previewCanvas.width, previewCanvas.height)
    }
    bitmap.close()
  }
  return timings
}

async function resolveEncoderConfig(scenario: PerformanceScenario) {
  const candidates: Array<{ codec: string; hardwareAcceleration: HardwareAcceleration }> = [
    { codec: 'vp8', hardwareAcceleration: scenario.hardwareAcceleration },
    { codec: 'vp8', hardwareAcceleration: 'no-preference' }
  ]
  for (const candidate of candidates) {
    const config: VideoEncoderConfig = {
      codec: candidate.codec,
      width: scenario.outputWidth,
      height: scenario.outputHeight,
      bitrate: bitrateFor(scenario),
      framerate: scenario.frameRate,
      latencyMode: 'quality',
      hardwareAcceleration: candidate.hardwareAcceleration
    }
    const support = await VideoEncoder.isConfigSupported(config)
    if (support.supported) return { config: support.config ?? config, codec: candidate.codec }
  }
  throw new Error('VP8 encoder configuration is unavailable')
}

function createBackgroundConfig(scenario: PerformanceScenario): BackgroundConfig {
  return {
    type: 'solid-color',
    color: '#0b1220',
    padding: 18,
    outputRatio: 'custom',
    customWidth: scenario.outputWidth,
    customHeight: scenario.outputHeight,
    videoPosition: 'center',
    borderRadius: 20,
    shadow: { enabled: true, blur: 20, offsetX: 0, offsetY: 8, color: 'rgba(0,0,0,.35)' },
    videoZoom: {
      enabled: true,
      scale: 1.35,
      transitionDurationMs: 160,
      intervals: [{
        startMs: 400,
        endMs: Math.max(800, scenario.durationSeconds * 1000 - 300),
        scale: 1.35,
        focusX: 0.72,
        focusY: 0.38,
        focusSpace: 'source',
        mode: 'dolly',
        easing: 'smooth',
        transitionDurationMs: 160
      }]
    }
  } as BackgroundConfig
}

function drawPattern(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  index: number,
  total: number
) {
  const t = index / Math.max(1, total - 1)
  context.fillStyle = '#172554'
  context.fillRect(0, 0, width, height)
  const cell = Math.max(20, Math.round(width / 32))
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      context.fillStyle = (x / cell + y / cell + index) % 2 ? '#1d4ed8' : '#0f766e'
      context.fillRect(x, y, cell, cell)
    }
  }
  context.fillStyle = '#facc15'
  context.beginPath()
  context.arc(width * (0.12 + 0.76 * t), height * 0.32, Math.max(20, height * 0.07), 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#f8fafc'
  context.fillRect(width * (0.08 + 0.76 * (1 - t)), height * 0.62, width * 0.08, height * 0.08)
  context.fillStyle = '#020617'
  context.fillRect(width * 0.03, height * 0.04, width * 0.31, height * 0.1)
  context.fillStyle = '#fff'
  context.font = `700 ${Math.max(18, Math.round(height * 0.045))}px sans-serif`
  context.fillText(`FRAME ${index + 1}/${total}`, width * 0.05, height * 0.11)
}

function updateSourcePreview(canvas: OffscreenCanvas, index: number) {
  if (index % 8 !== 0) return
  sourceCanvas.getContext('2d', { alpha: false })!.drawImage(canvas, 0, 0, sourceCanvas.width, sourceCanvas.height)
}

function renderResult(
  scenario: PerformanceScenario,
  metrics: { captureRtf: number; previewP95Ms: number; exportRtf: number; droppedFrames: number; frameCount: number },
  acceptance: ReturnType<typeof evaluatePerformanceRun>,
  extra: { codec: string; maxEncodeQueue: number; blobBytes: number; heapDeltaBytes: number | null }
) {
  metricsElement.innerHTML = [
    ['Capture RTF', `${metrics.captureRtf.toFixed(2)}×`],
    ['Preview p95', `${metrics.previewP95Ms.toFixed(1)} ms`],
    ['WebM Export RTF', `${metrics.exportRtf.toFixed(2)}×`],
    ['60 min projection', formatMinutes(projectExportMinutes(60, metrics.exportRtf))]
  ].map(([label, value]) => `<article><span>${label}</span><b>${value}</b></article>`).join('')

  const rows = [
    ['record/encode', metrics.captureRtf, `${scenario.budgets.captureRtf.toFixed(2)}× RTF`, metrics.captureRtf <= scenario.budgets.captureRtf],
    ['preview', metrics.previewP95Ms, `${scenario.budgets.previewP95Ms.toFixed(1)} ms p95`, metrics.previewP95Ms <= scenario.budgets.previewP95Ms],
    ['WebM export', metrics.exportRtf, `${scenario.budgets.exportRtf.toFixed(2)}× RTF`, metrics.exportRtf <= scenario.budgets.exportRtf],
    ['drops', metrics.droppedFrames, `≤ ${(scenario.budgets.maxDropRate * 100).toFixed(1)}%`, !acceptance.failures.includes('drops')]
  ] as const
  resultsElement.innerHTML = rows.map(([label, value, budget, pass]) => `
    <tr><td>${label}</td><td>${typeof value === 'number' ? value.toFixed(2) : value}</td><td>${budget}</td><td class="${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'}</td></tr>`).join('')

  detailsElement.textContent = JSON.stringify({
    scenario: scenario.id,
    source: `${scenario.sourceWidth}×${scenario.sourceHeight}`,
    output: `${scenario.outputWidth}×${scenario.outputHeight}@${scenario.frameRate}`,
    encoderCodec: extra.codec,
    requestedHardwareAcceleration: scenario.hardwareAcceleration,
    maxEncodeQueue: extra.maxEncodeQueue,
    WebMBytes: extra.blobBytes,
    heapDeltaMB: extra.heapDeltaBytes === null ? 'unavailable' : +(extra.heapDeltaBytes / 1024 / 1024).toFixed(1),
    caveat: 'Software preference and short deterministic clips are stress proxies, not a substitute for physical old-hardware testing.'
  }, null, 2)
}

function bitrateFor(scenario: PerformanceScenario) {
  return scenario.outputWidth <= 1280 ? 3_000_000 : scenario.outputWidth <= 1920 ? 6_000_000 : 16_000_000
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return Infinity
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)]!
}

async function waitForQueueDrain(encoder: VideoEncoder) {
  while (encoder.encodeQueueSize > 2) await new Promise(resolve => setTimeout(resolve, 0))
}

function currentHeapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes.toFixed(0)} min`
  return `${(minutes / 60).toFixed(1)} h`
}

function assertEnvironment() {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window) || !('OffscreenCanvas' in window)) {
    throw new Error('This Chrome build does not expose the required WebCodecs APIs')
  }
}

function updateProgress(value: number, label: string) {
  progressElement.style.width = `${Math.min(100, Math.max(0, value))}%`
  statusElement.textContent = label
}

function resetUi() {
  statusElement.className = ''
  metricsElement.innerHTML = ''
  resultsElement.innerHTML = ''
  detailsElement.textContent = ''
  sourceCanvas.getContext('2d')!.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height)
  previewCanvas.getContext('2d')!.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
}
