import {
  completePreviewRender,
  createPreviewClock,
  createPreviewRenderGate,
  pausePreviewClock,
  playPreviewClock,
  queuePreviewRender,
  resetPreviewRenderGate,
  samplePreviewClock,
  seekPreviewClock,
  shouldPresentPreviewFrame,
  type PreviewClock,
  type PreviewRenderGate,
  type PreviewRenderRequest
} from '../../packages/extension/src/lib/studio/preview-playback-scheduler'
import { findSourceFrameAtTime } from '../../packages/extension/src/lib/recording/recording-timeline'

type Mode = 'source' | 'clock'
type Scenario = 'sparse' | 'regular' | 'pressure'

interface Metrics {
  displayedAt: number[]
  driftMs: number[]
  renderMs: number[]
  latencyMs: number[]
  coalesced: number
  sent: number
  displayed: number
  heldRedraws: number
  exactSeeks: number
  totalSeeks: number
  seekLatencyMs: number[]
}

interface Player {
  mode: Mode
  worker: Worker
  canvas: HTMLCanvasElement
  context: ImageBitmapRenderingContext
  metricsElement: HTMLElement
  clock: PreviewClock
  renderGate: PreviewRenderGate
  lastSourceFrame: number
  requestId: number
  ready: boolean
  readyInfo: any | null
  metrics: Metrics
  pendingSeekResolvers: Map<number, (value: { sourceFrameIndex: number; latencyMs: number }) => void>
}

const DURATION_MS = 8_000
const scenarioElement = document.querySelector<HTMLSelectElement>('#scenario')!
const workloadElement = document.querySelector<HTMLSelectElement>('#workload')!
const prepareButton = document.querySelector<HTMLButtonElement>('#prepare')!
const runButton = document.querySelector<HTMLButtonElement>('#run')!
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!
const seekProbeButton = document.querySelector<HTMLButtonElement>('#seek-probe')!
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!
const statusElement = document.querySelector<HTMLElement>('#status')!
const clockElement = document.querySelector<HTMLElement>('#clock')!
const environmentElement = document.querySelector<HTMLElement>('#environment')!

let sourceTimestampsMs = buildSourceTimestamps('sparse')
let players: Player[] = []
let animationFrameId: number | null = null
let running = false
let seekProbeSequence = 0
let longAnimationFrames = 0

environmentElement.textContent = `${navigator.userAgent} · ${window.devicePixelRatio}x DPR`
observeLongAnimationFrames()
renderEmptyMetrics()

prepareButton.addEventListener('click', prepare)
runButton.addEventListener('click', run)
pauseButton.addEventListener('click', pause)
seekProbeButton.addEventListener('click', runSeekProbe)
resetButton.addEventListener('click', reset)
scenarioElement.addEventListener('change', reset)
workloadElement.addEventListener('change', reset)

async function prepare() {
  reset()
  prepareButton.disabled = true
  statusElement.textContent = 'WebCodecs 编码/解码中…'
  sourceTimestampsMs = buildSourceTimestamps(scenarioElement.value as Scenario)

  try {
    players = [createPlayer('source'), createPlayer('clock')]
    await Promise.all(players.map(initializePlayer))
    setCheck('webcodecs', true, `通过：${sourceTimestampsMs.length} 个样本完成 WebCodecs 编解码`)
    const productionProbe = await runProductionCompositeProbe()
    setCheck(
      'production-worker',
      productionProbe.changed,
      productionProbe.changed
        ? `通过：同一源帧在 ${productionProbe.times.join('/')}ms 得到不同 Zoom 合成结果`
        : '失败：生产 Composite Worker 未采用显式展示时间'
    )
    statusElement.textContent = '素材就绪，可以运行对比'
    runButton.disabled = false
    seekProbeButton.disabled = false
  } catch (error) {
    statusElement.textContent = `准备失败：${error instanceof Error ? error.message : String(error)}`
    setCheck('webcodecs', false, '失败：WebCodecs 编解码未闭环')
  } finally {
    prepareButton.disabled = false
  }
}

function createPlayer(mode: Mode): Player {
  const canvas = document.querySelector<HTMLCanvasElement>(`#${mode}-canvas`)!
  const context = canvas.getContext('bitmaprenderer')
  if (!context) throw new Error('ImageBitmapRenderingContext unavailable')
  const worker = new Worker(new URL('./preview-worker.ts', import.meta.url), { type: 'module' })
  const player: Player = {
    mode,
    worker,
    canvas,
    context,
    metricsElement: document.querySelector<HTMLElement>(`#${mode}-metrics`)!,
    clock: createPreviewClock({ durationMs: DURATION_MS }),
    renderGate: createPreviewRenderGate(1),
    lastSourceFrame: -1,
    requestId: 1,
    ready: false,
    readyInfo: null,
    metrics: createMetrics(),
    pendingSeekResolvers: new Map()
  }
  worker.addEventListener('message', event => handleWorkerMessage(player, event.data))
  return player
}

function initializePlayer(player: Player): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`${player.mode} worker timeout`)), 20_000)
    const onMessage = (event: MessageEvent) => {
      if (event.data.type === 'ready') {
        window.clearTimeout(timeout)
        player.worker.removeEventListener('message', onMessage)
        player.ready = true
        player.readyInfo = event.data
        player.metricsElement.dataset.codec = event.data.codec
        renderMetrics(player, event.data)
        resolve()
      } else if (event.data.type === 'error') {
        window.clearTimeout(timeout)
        player.worker.removeEventListener('message', onMessage)
        reject(new Error(event.data.error))
      }
    }
    player.worker.addEventListener('message', onMessage)
    player.worker.postMessage({
      type: 'init',
      mode: player.mode,
      sourceTimestampsMs,
      durationMs: DURATION_MS,
      workloadMs: Number(workloadElement.value),
      pressure: scenarioElement.value === 'pressure'
    })
  })
}

function run() {
  if (!players.every(player => player.ready)) return
  const now = performance.now()
  for (const player of players) {
    player.clock = playPreviewClock(player.clock, now)
  }
  running = true
  runButton.disabled = true
  pauseButton.disabled = false
  statusElement.textContent = '对比运行中'
  if (animationFrameId === null) animationFrameId = requestAnimationFrame(tick)
}

function pause() {
  const now = performance.now()
  for (const player of players) player.clock = pausePreviewClock(player.clock, now)
  running = false
  pauseButton.disabled = true
  runButton.disabled = players.length === 0
  statusElement.textContent = '已暂停'
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  animationFrameId = null
  finalizeAcceptance()
}

function tick(now: number) {
  if (!running) return
  let ended = true
  for (const player of players) {
    const sample = samplePreviewClock(player.clock, now)
    const sourceFrameIndex = findSourceFrameAtTime(sourceTimestampsMs, sample.positionMs)
    ended &&= sample.ended

    if (player.mode === 'source') {
      if (sourceFrameIndex !== player.lastSourceFrame) {
        player.lastSourceFrame = sourceFrameIndex
        dispatchSourceRender(player, sourceFrameIndex, sample.positionMs)
      }
    } else {
      const queued = queuePreviewRender(player.renderGate, {
        windowGeneration: player.renderGate.windowGeneration,
        sourceFrameIndex,
        presentationTimeMs: sample.positionMs
      })
      if (!queued.dispatch) player.metrics.coalesced += 1
      player.renderGate = queued.gate
      if (queued.dispatch) dispatchClockRender(player, queued.dispatch)
    }
  }

  const displaySample = samplePreviewClock(players[1].clock, now)
  clockElement.textContent = `${formatTime(displaySample.positionMs)} / ${formatTime(DURATION_MS)}`
  if (ended) {
    pause()
    statusElement.textContent = '8 秒对比完成'
    return
  }
  animationFrameId = requestAnimationFrame(tick)
}

function dispatchSourceRender(player: Player, sourceFrameIndex: number, presentationTimeMs: number) {
  const requestId = player.requestId++
  player.metrics.sent += 1
  player.worker.postMessage({
    type: 'render',
    requestId,
    sourceFrameIndex,
    presentationTimeMs,
    sentAtMs: performance.now()
  })
}

function dispatchClockRender(player: Player, request: PreviewRenderRequest) {
  player.metrics.sent += 1
  player.worker.postMessage({
    type: 'render',
    ...request,
    sentAtMs: performance.now()
  })
}

function handleWorkerMessage(player: Player, data: any) {
  if (data.type !== 'frame') return

  if (player.mode === 'clock' && data.seekProbeId === undefined) {
    const completed = completePreviewRender(player.renderGate, data.requestId)
    player.renderGate = completed.gate
    if (!completed.accepted) {
      data.bitmap.close()
      return
    }
    if (completed.dispatch) {
      dispatchClockRender(player, completed.dispatch)
      data.bitmap.close()
      return
    }

    const latestClock = samplePreviewClock(player.clock, performance.now())
    if (running && !shouldPresentPreviewFrame({
      requestedPresentationTimeMs: data.presentationTimeMs,
      currentPresentationTimeMs: latestClock.positionMs,
      maxLatenessMs: 34
    })) {
      data.bitmap.close()
      player.metrics.coalesced += 1
      const latestSourceFrame = findSourceFrameAtTime(sourceTimestampsMs, latestClock.positionMs)
      const queued = queuePreviewRender(player.renderGate, {
        windowGeneration: player.renderGate.windowGeneration,
        sourceFrameIndex: latestSourceFrame,
        presentationTimeMs: latestClock.positionMs
      })
      player.renderGate = queued.gate
      if (queued.dispatch) dispatchClockRender(player, queued.dispatch)
      return
    }
  }

  player.context.transferFromImageBitmap(data.bitmap)
  const displayedAt = performance.now()

  if (typeof data.seekProbeId === 'number') {
    player.pendingSeekResolvers.get(data.seekProbeId)?.({
      sourceFrameIndex: data.sourceFrameIndex,
      latencyMs: displayedAt - data.sentAtMs
    })
    player.pendingSeekResolvers.delete(data.seekProbeId)
    return
  }

  const currentClock = samplePreviewClock(player.clock, displayedAt).positionMs
  player.metrics.displayedAt.push(displayedAt)
  player.metrics.driftMs.push(Math.abs(currentClock - data.presentationTimeMs))
  player.metrics.renderMs.push(data.renderMs)
  player.metrics.latencyMs.push(displayedAt - data.sentAtMs)
  player.metrics.displayed += 1
  if (data.presentationTimeMs >= 2_000 && data.presentationTimeMs < 6_000) {
    player.metrics.heldRedraws += 1
  }

  renderMetrics(player)
}

async function runSeekProbe() {
  pause()
  seekProbeButton.disabled = true
  statusElement.textContent = '运行精确定位探针…'
  const targets = [0, 1_999, 2_000, 3_500, 5_999, 6_000, 7_999]

  for (const targetMs of targets) {
    const expectedSourceFrame = findSourceFrameAtTime(sourceTimestampsMs, targetMs)
    for (const player of players) {
      player.clock = seekPreviewClock(player.clock, targetMs, performance.now())
      player.renderGate = resetPreviewRenderGate(player.renderGate, player.renderGate.windowGeneration + 1)
      const probeId = ++seekProbeSequence
      const result = await renderSeekProbe(player, targetMs, expectedSourceFrame, probeId)
      player.metrics.totalSeeks += 1
      player.metrics.seekLatencyMs.push(result.latencyMs)
      if (result.sourceFrameIndex === expectedSourceFrame) player.metrics.exactSeeks += 1
      renderMetrics(player)
    }
  }

  const exact = players.every(player => player.metrics.exactSeeks === player.metrics.totalSeeks)
  setCheck('seek', exact, exact ? '通过：精确定位命中率 100%' : '失败：存在定位到错误源帧')
  statusElement.textContent = '精确定位探针完成'
  seekProbeButton.disabled = false
}

function renderSeekProbe(
  player: Player,
  presentationTimeMs: number,
  sourceFrameIndex: number,
  seekProbeId: number
): Promise<{ sourceFrameIndex: number; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      player.pendingSeekResolvers.delete(seekProbeId)
      reject(new Error(`Seek probe timed out at ${presentationTimeMs}ms`))
    }, 2_000)
    player.pendingSeekResolvers.set(seekProbeId, value => {
      window.clearTimeout(timeout)
      resolve(value)
    })
    player.worker.postMessage({
      type: 'render',
      requestId: player.requestId++,
      sourceFrameIndex,
      presentationTimeMs,
      sentAtMs: performance.now(),
      seekProbeId
    })
  })
}

function reset() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  animationFrameId = null
  running = false
  for (const player of players) player.worker.terminate()
  players = []
  runButton.disabled = true
  pauseButton.disabled = true
  seekProbeButton.disabled = true
  statusElement.textContent = '等待准备'
  clockElement.textContent = `${formatTime(0)} / ${formatTime(DURATION_MS)}`
  longAnimationFrames = 0
  clearChecks()
  clearCanvases()
  renderEmptyMetrics()
}

function buildSourceTimestamps(scenario: Scenario): number[] {
  const frameInterval = 1_000 / 30
  if (scenario === 'sparse') {
    const timestamps = rangeTimestamps(0, 2_000, frameInterval)
    timestamps.push(6_000)
    timestamps.push(...rangeTimestamps(6_000 + frameInterval, DURATION_MS, frameInterval))
    return dedupeTimestamps(timestamps)
  }
  return rangeTimestamps(0, DURATION_MS, frameInterval)
}

function rangeTimestamps(startMs: number, endMs: number, intervalMs: number): number[] {
  const values: number[] = []
  for (let timeMs = startMs; timeMs < endMs; timeMs += intervalMs) {
    values.push(Number(timeMs.toFixed(3)))
  }
  return values
}

function dedupeTimestamps(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function createMetrics(): Metrics {
  return {
    displayedAt: [], driftMs: [], renderMs: [], latencyMs: [], coalesced: 0,
    sent: 0, displayed: 0, heldRedraws: 0, exactSeeks: 0, totalSeeks: 0, seekLatencyMs: []
  }
}

function renderMetrics(player: Player, readyData?: any) {
  readyData ??= player.readyInfo
  const gaps = differences(player.metrics.displayedAt)
  const rows = [
    ['显示帧', String(player.metrics.displayed)],
    ['p95 间隔', formatMetric(percentile(gaps, 0.95), 'ms')],
    ['最大间隔', formatMetric(Math.max(0, ...gaps), 'ms')],
    ['p95 时钟漂移', formatMetric(percentile(player.metrics.driftMs, 0.95), 'ms')],
    ['最大时钟漂移', formatMetric(Math.max(0, ...player.metrics.driftMs), 'ms')],
    ['p95 Worker', formatMetric(percentile(player.metrics.renderMs, 0.95), 'ms')],
    ['p95 往返', formatMetric(percentile(player.metrics.latencyMs, 0.95), 'ms')],
    ['静态区重绘', String(player.metrics.heldRedraws)],
    ['合并请求', String(player.metrics.coalesced)],
    ['Seek 命中', player.metrics.totalSeeks ? `${player.metrics.exactSeeks}/${player.metrics.totalSeeks}` : '—'],
    ['Seek p95', formatMetric(percentile(player.metrics.seekLatencyMs, 0.95), 'ms')],
    ['编解码', readyData ? `${readyData.encodeMs.toFixed(0)} / ${readyData.decodeMs.toFixed(0)}ms` : '—'],
    ['Decode 队列峰值', readyData ? String(readyData.peakDecodeQueue) : player.metricsElement.dataset.peakQueue ?? '—']
  ]
  if (readyData) player.metricsElement.dataset.peakQueue = String(readyData.peakDecodeQueue)
  player.metricsElement.innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')
}

function renderEmptyMetrics() {
  for (const mode of ['source', 'clock']) {
    const element = document.querySelector<HTMLElement>(`#${mode}-metrics`)!
    element.innerHTML = ['显示帧', 'p95 间隔', '最大间隔', 'p95 时钟漂移', '最大时钟漂移', 'p95 Worker', 'p95 往返', '静态区重绘', '合并请求', 'Seek 命中', 'Seek p95', '编解码', 'Decode 队列峰值']
      .map(label => `<div><dt>${label}</dt><dd>—</dd></div>`).join('')
  }
}

function finalizeAcceptance() {
  if (players.length < 2) return
  const baseline = players.find(player => player.mode === 'source')!
  const candidate = players.find(player => player.mode === 'clock')!
  const candidateGaps = differences(candidate.metrics.displayedAt)
  const p95Gap = percentile(candidateGaps, 0.95)
  const p95Drift = percentile(candidate.metrics.driftMs, 0.95)
  const baselineMaxDrift = Math.max(0, ...baseline.metrics.driftMs)
  const candidateMaxDrift = Math.max(0, ...candidate.metrics.driftMs)
  const heldPass = scenarioElement.value !== 'sparse'
    || (candidate.metrics.heldRedraws >= 120 && candidate.metrics.heldRedraws > baseline.metrics.heldRedraws * 4)

  setCheck('held-redraw', heldPass,
    heldPass
      ? `通过：候选静态区重绘 ${candidate.metrics.heldRedraws} 次，基线 ${baseline.metrics.heldRedraws} 次`
      : '失败：静态区效果重绘不足')
  setCheck('cadence', p95Gap <= 25, `${p95Gap <= 25 ? '通过' : '失败'}：候选 p95 显示间隔 ${p95Gap.toFixed(1)}ms`)
  setCheck('drift', p95Drift <= 34, `${p95Drift <= 34 ? '通过' : '失败'}：候选 p95 时钟漂移 ${p95Drift.toFixed(1)}ms`)
  const recoveryPass = scenarioElement.value !== 'pressure'
    || (candidateMaxDrift <= 34 && candidateMaxDrift < baselineMaxDrift * 0.6)
  setCheck('recovery', recoveryPass,
    scenarioElement.value === 'pressure'
      ? `${recoveryPass ? '通过' : '失败'}：最大漂移候选 ${candidateMaxDrift.toFixed(1)}ms / 基线 ${baselineMaxDrift.toFixed(1)}ms`
      : '通过：当前场景未注入 Worker 长阻塞')
  statusElement.textContent += ` · LoAF ${longAnimationFrames}`
}

function setCheck(name: string, passed: boolean, text: string) {
  const element = document.querySelector<HTMLElement>(`[data-check="${name}"]`)!
  element.classList.remove('pass', 'fail')
  element.classList.add(passed ? 'pass' : 'fail')
  element.textContent = text
}

function clearChecks() {
  const defaults: Record<string, string> = {
    webcodecs: '等待：WebCodecs 编解码闭环',
    'production-worker': '等待：生产 Composite Worker 使用显式展示时间',
    'held-redraw': '等待：静态区编辑效果持续重绘',
    cadence: '等待：候选 p95 显示间隔 ≤ 25ms（60Hz 前台页）',
    drift: '等待：候选 p95 媒体时钟漂移 ≤ 34ms',
    recovery: '等待：过载恢复后不追播过时位图',
    seek: '等待：精确定位命中率 100%'
  }
  for (const [name, text] of Object.entries(defaults)) {
    const element = document.querySelector<HTMLElement>(`[data-check="${name}"]`)!
    element.classList.remove('pass', 'fail')
    element.textContent = text
  }
}

async function runProductionCompositeProbe(): Promise<{ changed: boolean; times: number[] }> {
  const chunks = await encodeProductionProbeChunks()
  const worker = new Worker(
    new URL('../../packages/extension/src/lib/workers/composite-worker/index.ts', import.meta.url),
    { type: 'module' }
  )
  const generation = 41
  try {
    const initialized = waitForWorkerMessage(worker, message => message.type === 'initialized')
    worker.postMessage({ type: 'init' })
    await initialized

    const ready = waitForWorkerMessage(worker, message => message.type === 'ready')
    worker.postMessage({
      type: 'process',
      data: {
        chunks,
        startGlobalFrame: 0,
        windowGeneration: generation,
        frameRate: 30,
        backgroundConfig: {
          type: 'solid-color',
          color: '#111827',
          padding: 30,
          outputRatio: 'custom',
          customWidth: 1_920,
          customHeight: 1_080,
          videoPosition: 'center',
          borderRadius: 0,
          shadow: { offsetX: 0, offsetY: 0, blur: 0, color: 'rgba(0,0,0,0)' },
          videoZoom: {
            enabled: true,
            scale: 1.8,
            focusX: 0,
            focusY: 0,
            transitionDurationMs: 1_000,
            intervals: [{
              startMs: 1_000,
              endMs: 2_000,
              focusX: 0,
              focusY: 0,
              transitionDurationMs: 1_000
            }]
          }
        }
      }
    }, { transfer: chunks.map(chunk => chunk.data) })
    await ready

    const times = [250, 750]
    const signatures: number[] = []
    for (let index = 0; index < times.length; index++) {
      const requestId = 900 + index
      const response = waitForWorkerMessage(worker, message =>
        message.type === 'frame'
        && message.data?.requestId === requestId
      )
      worker.postMessage({
        type: 'renderAtTime',
        data: {
          frameIndex: 0,
          presentationTimeMs: times[index],
          requestId,
          windowGeneration: generation
        }
      })
      const message = await response
      if (message.data.presentationTimeMs !== times[index]) {
        message.data.bitmap?.close?.()
        throw new Error('Production worker returned the wrong presentation time')
      }
      signatures.push(bitmapSignature(message.data.bitmap))
    }

    return { changed: signatures[0] !== signatures[1], times }
  } finally {
    worker.terminate()
  }
}

async function encodeProductionProbeChunks(): Promise<Array<{
  data: ArrayBuffer
  timestamp: number
  type: EncodedVideoChunkType
  size: number
  codedWidth: number
  codedHeight: number
  codec: string
}>> {
  const width = 1_920
  const height = 1_080
  let codec = ''
  for (const candidate of ['vp8', 'vp09.00.10.08']) {
    const support = await VideoEncoder.isConfigSupported({
      codec: candidate,
      width,
      height,
      bitrate: 1_000_000,
      framerate: 30,
      latencyMode: 'realtime'
    })
    if (support.supported) {
      codec = candidate
      break
    }
  }
  if (!codec) throw new Error('Production worker probe has no supported codec')

  const chunks: Array<{
    data: ArrayBuffer
    timestamp: number
    type: EncodedVideoChunkType
    size: number
    codedWidth: number
    codedHeight: number
    codec: string
  }> = []
  const encoder = new VideoEncoder({
    output(chunk) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({
        data: data.buffer,
        timestamp: chunk.timestamp,
        type: chunk.type,
        size: chunk.byteLength,
        codedWidth: width,
        codedHeight: height,
        codec
      })
    },
    error(error) { throw error }
  })
  encoder.configure({
    codec,
    width,
    height,
    bitrate: 1_000_000,
    framerate: 30,
    latencyMode: 'realtime'
  })

  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { alpha: false })!
  for (let index = 0; index < 3; index++) {
    context.fillStyle = '#0f172a'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#fb923c'
    context.fillRect(12 + index * 22, 18, 90, 52)
    context.fillStyle = '#e0f2fe'
    context.fillRect(190, 104 - index * 12, 105, 52)
    const frame = new VideoFrame(canvas, { timestamp: index * 1_000_000 })
    encoder.encode(frame, { keyFrame: index === 0 })
    frame.close()
  }
  await encoder.flush()
  encoder.close()
  return chunks
}

function waitForWorkerMessage(
  worker: Worker,
  predicate: (message: any) => boolean,
  timeoutMs = 5_000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener('message', onMessage)
      reject(new Error('Production worker probe timed out'))
    }, timeoutMs)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'error') {
        window.clearTimeout(timeout)
        worker.removeEventListener('message', onMessage)
        reject(new Error(String(event.data.data ?? event.data.error)))
        return
      }
      if (!predicate(event.data)) return
      window.clearTimeout(timeout)
      worker.removeEventListener('message', onMessage)
      resolve(event.data)
    }
    worker.addEventListener('message', onMessage)
  })
}

function bitmapSignature(bitmap: ImageBitmap): number {
  const canvas = new OffscreenCanvas(160, 90)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let signature = 0
  for (let index = 0; index < pixels.length; index += 32) {
    signature = (signature + pixels[index] * (index + 1)) % 2_147_483_647
  }
  return signature
}

function clearCanvases() {
  for (const id of ['source-canvas', 'clock-canvas']) {
    const canvas = document.querySelector<HTMLCanvasElement>(`#${id}`)!
    // Reset the backing store without locking the canvas to a 2D context;
    // createPlayer must still be able to acquire bitmaprenderer afterwards.
    canvas.width = 960
    canvas.height = 540
  }
}

function observeLongAnimationFrames() {
  if (!('PerformanceObserver' in window)) return
  try {
    const observer = new PerformanceObserver(list => { longAnimationFrames += list.getEntries().length })
    observer.observe({ type: 'long-animation-frame', buffered: true } as PerformanceObserverInit)
  } catch {
    // Long Animation Frames is optional; cadence metrics remain authoritative.
  }
}

function differences(values: number[]): number[] {
  return values.slice(1).map((value, index) => value - values[index])
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]
}

function formatMetric(value: number, unit: string): string {
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(1)}${unit}` : '—'
}

function formatTime(timeMs: number): string {
  const minutes = Math.floor(timeMs / 60_000)
  const seconds = Math.floor((timeMs % 60_000) / 1_000)
  const milliseconds = Math.floor(timeMs % 1_000)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}
