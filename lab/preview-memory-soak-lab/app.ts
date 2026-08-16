import {
  SOAK_SCENARIOS,
  evaluateCutoverGaps,
  evaluateOwnershipPhase,
  evaluateProductionCleanup,
  theoreticalFrameBytes,
  type OwnershipSnapshot,
  type SoakScenario
} from './memory-soak-fixture'

type EncodedSourceChunk = {
  data: ArrayBuffer
  timestamp: number
  type: EncodedVideoChunkType
  codec: string
  codedWidth: number
  codedHeight: number
}

type WorkerEnvelope = { type: string; data?: any }

type GeometryProbe = {
  pass: boolean
  circleAspect: number
  markerPixels: Record<'tl' | 'tr' | 'bl' | 'br', number>
  failures: string[]
}

const runSelectedButton = document.querySelector<HTMLButtonElement>('#run-selected')!
const runMatrixButton = document.querySelector<HTMLButtonElement>('#run-matrix')!
const scenarioSelect = document.querySelector<HTMLSelectElement>('#scenario')!
const statusElement = document.querySelector<HTMLElement>('#status')!
const progressElement = document.querySelector<HTMLProgressElement>('#progress')!
const progressLabel = document.querySelector<HTMLElement>('#progress-label')!
const resultsElement = document.querySelector<HTMLElement>('#results')!
const timelineElement = document.querySelector<HTMLElement>('#timeline')!
const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview')!
const rawOutput = document.querySelector<HTMLElement>('#raw-output')!

for (const scenario of SOAK_SCENARIOS) {
  const option = document.createElement('option')
  option.value = scenario.id
  option.textContent = scenario.label
  scenarioSelect.append(option)
}

runSelectedButton.addEventListener('click', () => void runScenarios([
  SOAK_SCENARIOS.find(item => item.id === scenarioSelect.value)!
]))
runMatrixButton.addEventListener('click', () => void runScenarios([...SOAK_SCENARIOS]))

class ProductionCompositeHarness {
  readonly worker = new Worker(new URL('./preview-memory-bootstrap-worker.ts', import.meta.url), { type: 'module' })
  readonly waiters = new Set<{
    predicate: (message: WorkerEnvelope) => boolean
    resolve: (message: WorkerEnvelope) => void
    reject: (error: Error) => void
    timeout: number
  }>()

  constructor() {
    this.worker.onmessage = event => {
      const message = event.data as WorkerEnvelope
      let consumed = false
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue
        consumed = true
        window.clearTimeout(waiter.timeout)
        this.waiters.delete(waiter)
        waiter.resolve(message)
      }
      if (!consumed) closeBitmapIn(message)
    }
    this.worker.onerror = event => {
      const error = new Error(event.message || 'Production composite worker failed')
      for (const waiter of this.waiters) {
        window.clearTimeout(waiter.timeout)
        waiter.reject(error)
      }
      this.waiters.clear()
    }
  }

  waitFor(predicate: (message: WorkerEnvelope) => boolean, timeoutMs = 30_000) {
    return new Promise<WorkerEnvelope>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timeout: window.setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error(`Worker response timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }
      this.waiters.add(waiter)
    })
  }

  async initialize() {
    await this.waitFor(message => message.type === 'labProductionReady')
    const initialized = this.waitFor(message => message.type === 'initialized')
    this.worker.postMessage({ type: 'init', data: {} })
    await initialized
  }

  async processWindow(chunks: EncodedSourceChunk[], start: number, generation: number, scenario: SoakScenario) {
    const ready = this.waitFor(message => message.type === 'ready' && message.data?.windowGeneration === generation)
    this.worker.postMessage({
      type: 'process',
      data: {
        chunks,
        backgroundConfig: proxyBackgroundConfig(scenario),
        startGlobalFrame: start,
        decodeStartGlobalFrame: start,
        retainStartGlobalFrame: start,
        retainedFrameCount: chunks.length,
        frameRate: scenario.frameRate,
        windowGeneration: generation,
        previewMemoryPolicy: 'bounded',
        deviceMemoryGB: 4
      }
    })
    await ready
  }

  async appendWindow(chunks: EncodedSourceChunk[], start: number, generation: number) {
    const prefetched = this.waitFor(message => message.type === 'prefetchReady'
      && message.data?.startGlobalFrame === start
      && message.data?.windowGeneration === generation)
    this.worker.postMessage({
      type: 'appendWindow',
      data: {
        chunks,
        startGlobalFrame: start,
        decodeStartGlobalFrame: start,
        retainStartGlobalFrame: start,
        retainedFrameCount: chunks.length,
        windowGeneration: generation
      }
    })
    await prefetched
  }

  async render(frameIndex: number, presentationTimeMs: number, generation: number, requestId: number) {
    const rendered = this.waitFor(message => message.type === 'frame'
      && message.data?.requestId === requestId
      && message.data?.windowGeneration === generation)
    this.worker.postMessage({
      type: 'renderAtTime',
      data: { frameIndex, presentationTimeMs, requestId, windowGeneration: generation }
    })
    const message = await rendered
    return drawAndClose(message.data?.bitmap)
  }

  async hover(
    chunks: EncodedSourceChunk[],
    globalFrameIndex: number,
    generation: number,
    presentationTimeMs: number,
    requestId: number
  ) {
    const preview = this.waitFor(message => message.type === 'singleFramePreview'
      && message.data?.requestId === requestId
      && message.data?.windowGeneration === generation)
    this.worker.postMessage({
      type: 'decodeSingleFrame',
      data: {
        chunks,
        targetIndexInGOP: Math.min(1, chunks.length - 1),
        globalFrameIndex,
        windowGeneration: generation,
        presentationTimeMs,
        requestId
      }
    })
    const message = await preview
    if (message.data?.success !== true) throw new Error(message.data?.error || 'Hover decoder did not return a frame')
    drawAndClose(message.data?.bitmap)
  }

  async snapshot(): Promise<OwnershipSnapshot & { patchError?: string }> {
    const response = this.waitFor(message => message.type === 'labTelemetry')
    this.worker.postMessage({ type: 'labSnapshot' })
    return (await response).data
  }

  async productionDisposeAttempt() {
    this.worker.postMessage({ type: 'dispose', data: {} })
    await wait(150)
    return this.snapshot()
  }

  async forcedLabCleanup() {
    const response = this.waitFor(message => message.type === 'labCleanupComplete')
    this.worker.postMessage({ type: 'labCleanup' })
    return (await response).data as OwnershipSnapshot
  }

  terminate() {
    for (const waiter of this.waiters) {
      window.clearTimeout(waiter.timeout)
      waiter.reject(new Error('Harness terminated'))
    }
    this.waiters.clear()
    this.worker.terminate()
  }
}

async function runScenarios(scenarios: SoakScenario[]) {
  setRunning(true)
  resultsElement.innerHTML = ''
  timelineElement.innerHTML = ''
  rawOutput.textContent = ''
  const matrixResults: Array<{ scenario: string; functionalPass: boolean; productionCleanupPass: boolean }> = []

  try {
    for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
      const scenario = scenarios[scenarioIndex]!
      updateProgress(
        scenarioIndex / scenarios.length * 100,
        `${scenario.label}：生成确定性 ${scenario.sourceWidth}×${scenario.sourceHeight} VP8 素材`
      )
      const chunks = await encodeFixture(scenario)
      const result = await runSoakScenario(scenario, chunks, scenarioIndex, scenarios.length)
      matrixResults.push(result)
    }

    const functionalPass = matrixResults.every(result => result.functionalPass)
    const cleanupPass = matrixResults.every(result => result.productionCleanupPass)
    updateProgress(100, functionalPass && cleanupPass
      ? 'PASS：所有 ownership、cutover 与 production cleanup 均通过'
      : functionalPass
        ? 'FAIL：ownership/cutover 通过，但 production cleanup≠0'
        : 'FAIL：ownership 或 cutover 断言失败')
    statusElement.className = functionalPass && cleanupPass ? 'status pass' : 'status fail'
    statusElement.textContent = functionalPass && cleanupPass ? 'PASS' : 'FAIL'
  } catch (error) {
    statusElement.className = 'status fail'
    statusElement.textContent = 'FAIL'
    updateProgress(100, error instanceof Error ? error.message : String(error))
  } finally {
    setRunning(false)
  }
}

async function runSoakScenario(
  scenario: SoakScenario,
  chunks: EncodedSourceChunk[],
  scenarioIndex: number,
  scenarioCount: number
) {
  const harness = new ProductionCompositeHarness()
  const phaseRows: string[] = []
  const failures: string[] = []
  const gaps: number[] = []
  const geometryProbes: GeometryProbe[] = []
  let requestId = 1
  const frameBytes = theoreticalFrameBytes(scenario.sourceWidth, scenario.sourceHeight)
  const windows = chunkWindows(chunks, scenario.windowFrames)
  let generation = 1
  const soakStarted = performance.now()

  try {
    updateProgress((scenarioIndex / scenarioCount) * 100, `${scenario.label}：等待 production worker bootstrap`)
    await harness.initialize()
    updateProgress((scenarioIndex / scenarioCount) * 100 + 1, `${scenario.label}：解码 main window`)
    await harness.processWindow(windows[0]!, 0, generation, scenario)
    geometryProbes.push(await harness.render(
      scenario.windowFrames - 1,
      (scenario.windowFrames - 1) * 1000 / scenario.frameRate,
      generation,
      requestId++
    ))
    const mainSnapshot = await harness.snapshot()
    assertSnapshot(mainSnapshot, scenario, scenario.windowFrames, 0, false, 'main ready', failures)
    phaseRows.push(phaseRow('main ready', mainSnapshot, frameBytes, 'production decode'))

    updateProgress((scenarioIndex / scenarioCount) * 100 + 2, `${scenario.label}：解码 next + hover`)
    await harness.appendWindow(windows[1]!, scenario.windowFrames, generation)
    await harness.hover(
      windows[2]!.slice(0, 2),
      scenario.windowFrames * 2 + 1,
      generation,
      (scenario.windowFrames * 2 + 1) * 1000 / scenario.frameRate,
      requestId++
    )
    const primedSnapshot = await harness.snapshot()
    assertSnapshot(primedSnapshot, scenario, scenario.windowFrames, scenario.windowFrames, true, 'main + next + hover', failures)
    phaseRows.push(phaseRow('main + next + hover', primedSnapshot, frameBytes, 'hover closed after bitmap'))

    for (let windowIndex = 1; windowIndex < windows.length; windowIndex++) {
      const cutoverStarted = performance.now()
      generation += 1
      const startFrame = windowIndex * scenario.windowFrames
      await harness.processWindow(windows[windowIndex]!, startFrame, generation, scenario)
      geometryProbes.push(await harness.render(
        0,
        startFrame * 1000 / scenario.frameRate,
        generation,
        requestId++
      ))
      gaps.push(performance.now() - cutoverStarted)

      const cutoverSnapshot = await harness.snapshot()
      assertSnapshot(cutoverSnapshot, scenario, scenario.windowFrames, 0, true, `cutover ${windowIndex}`, failures)
      phaseRows.push(phaseRow(`cutover ${windowIndex}`, cutoverSnapshot, frameBytes, `${gaps.at(-1)!.toFixed(1)}ms`))

      const nextIndex = (windowIndex + 1) % windows.length
      const nextStart = nextIndex * scenario.windowFrames
      await harness.appendWindow(windows[nextIndex]!, nextStart, generation)
      await harness.hover(
        windows[(windowIndex + 2) % windows.length]!.slice(0, 2),
        nextStart + 1,
        generation,
        (nextStart + 1) * 1000 / scenario.frameRate,
        requestId++
      )
      const stableSnapshot = await harness.snapshot()
      assertSnapshot(stableSnapshot, scenario, scenario.windowFrames, scenario.windowFrames, true, `stable ${windowIndex}`, failures)

      const targetElapsed = scenario.soakMs * windowIndex / (windows.length - 1)
      const remaining = targetElapsed - (performance.now() - soakStarted)
      if (remaining > 0) await wait(remaining)
      updateProgress(
        ((scenarioIndex + windowIndex / windows.length) / scenarioCount) * 100,
        `${scenario.label}：cutover ${windowIndex}/${windows.length - 1}`
      )
    }

    const gapAcceptance = evaluateCutoverGaps(gaps, scenario.cutoverGapBudgetMs)
    if (!gapAcceptance.pass) failures.push(`max cutover ${gapAcceptance.maxGapMs.toFixed(1)}ms > ${scenario.cutoverGapBudgetMs}ms`)

    const failedGeometry = geometryProbes.filter(probe => !probe.pass)
    if (failedGeometry.length > 0) {
      failures.push(`${failedGeometry.length}/${geometryProbes.length} crop/zoom geometry checkpoints failed: ${failedGeometry[0]!.failures.join(', ')}`)
    }

    const beforeDispose = await harness.snapshot()
    const queuePeak = beforeDispose.decodeQueuePeakByKind?.main ?? Number.POSITIVE_INFINITY
    const queueHighWatermark = beforeDispose.publishedDecodeQueueHighWatermark ?? 0
    if (queueHighWatermark <= 0 || queuePeak > queueHighWatermark) {
      failures.push(`main decodeQueue peak ${queuePeak} > published high watermark ${queueHighWatermark}`)
    }
    const afterProductionDispose = await harness.productionDisposeAttempt()
    const productionCleanup = evaluateProductionCleanup(afterProductionDispose)
    phaseRows.push(phaseRow('production dispose', afterProductionDispose, frameBytes,
      productionCleanup.pass ? 'cleanup=0' : `FAIL · ${productionCleanup.remainingFrames} frames remain`))

    const forcedCleanup = await harness.forcedLabCleanup()
    phaseRows.push(phaseRow('lab forced cleanup', forcedCleanup, frameBytes, 'resource release only; not acceptance'))
    if (forcedCleanup.totalAlive !== 0) failures.push('lab forced cleanup did not release every tracked frame')

    const functionalPass = failures.length === 0
    renderScenarioResult({
      scenario,
      functionalPass,
      productionCleanupPass: productionCleanup.pass,
      gaps,
      peakSnapshot: beforeDispose,
      geometryProbes,
      phaseRows,
      failures,
      elapsedMs: performance.now() - soakStarted
    })
    rawOutput.textContent += `${scenario.id}\n${JSON.stringify({
      functionalPass,
      productionCleanup,
      maxCutoverGapMs: gapAcceptance.maxGapMs,
      geometryProbes,
      beforeDispose,
      forcedCleanup,
      patchError: (beforeDispose as any).patchError || null
    }, null, 2)}\n\n`
    return { scenario: scenario.id, functionalPass, productionCleanupPass: productionCleanup.pass }
  } finally {
    harness.terminate()
  }
}

function assertSnapshot(
  snapshot: OwnershipSnapshot & { patchError?: string },
  scenario: SoakScenario,
  expectedMain: number,
  expectedNext: number,
  requireHoverPeak: boolean,
  phase: string,
  failures: string[]
) {
  if (snapshot.patchError) failures.push(snapshot.patchError)
  const ownership = evaluateOwnershipPhase(snapshot, { expectedMain, expectedNext, requireHoverPeak })
  if (!ownership.pass) failures.push(`${phase}: ${ownership.failures.join(', ')}`)
  const retainedWidth = snapshot.publishedPreviewPlan?.previewWidth || scenario.sourceWidth
  const retainedHeight = snapshot.publishedPreviewPlan?.previewHeight || scenario.sourceHeight
  const frameBytes = theoreticalFrameBytes(retainedWidth, retainedHeight)
  if (snapshot.aliveBytesByLane.main !== expectedMain * frameBytes) failures.push(`${phase}: main proxy bytes mismatch`)
  if (snapshot.aliveBytesByLane.next !== expectedNext * frameBytes) failures.push(`${phase}: next proxy bytes mismatch`)
}

function chunkWindows(chunks: EncodedSourceChunk[], size: number) {
  const result: EncodedSourceChunk[][] = []
  for (let index = 0; index + size <= chunks.length; index += size) result.push(chunks.slice(index, index + size))
  return result
}

async function encodeFixture(scenario: SoakScenario): Promise<EncodedSourceChunk[]> {
  const canvas = new OffscreenCanvas(scenario.sourceWidth, scenario.sourceHeight)
  const context = canvas.getContext('2d', { alpha: false })!
  const chunks: EncodedSourceChunk[] = []
  const config: VideoEncoderConfig = {
    codec: 'vp8',
    width: scenario.sourceWidth,
    height: scenario.sourceHeight,
    framerate: scenario.frameRate,
    bitrate: scenario.sourceWidth >= 3840 ? 16_000_000 : 6_000_000,
    latencyMode: 'realtime'
  }
  const support = await VideoEncoder.isConfigSupported(config)
  if (!support.supported) throw new Error(`${scenario.label}: VP8 ${scenario.sourceWidth}×${scenario.sourceHeight} encoder unavailable`)
  const encoder = new VideoEncoder({
    output(chunk) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({
        data: data.buffer,
        timestamp: chunk.timestamp,
        type: chunk.type,
        codec: 'vp8',
        codedWidth: scenario.sourceWidth,
        codedHeight: scenario.sourceHeight
      })
    },
    error(error) { throw error }
  })
  encoder.configure(support.config || config)
  for (let index = 0; index < scenario.totalFrames; index++) {
    drawSourcePattern(context, scenario, index)
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(index * 1_000_000 / scenario.frameRate),
      duration: Math.round(1_000_000 / scenario.frameRate)
    })
    encoder.encode(frame, { keyFrame: index % scenario.windowFrames === 0 })
    frame.close()
    while (encoder.encodeQueueSize > 3) await wait(0)
  }
  await encoder.flush()
  encoder.close()
  chunks.sort((left, right) => left.timestamp - right.timestamp)
  if (chunks.length !== scenario.totalFrames) {
    throw new Error(`${scenario.label}: encoded ${chunks.length}/${scenario.totalFrames} fixture frames`)
  }
  return chunks
}

function drawSourcePattern(
  context: OffscreenCanvasRenderingContext2D,
  scenario: SoakScenario,
  index: number
) {
  const { sourceWidth: width, sourceHeight: height } = scenario
  context.fillStyle = index % 2 === 0 ? '#102a43' : '#123c3a'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#f6c453'
  context.beginPath()
  context.arc(width * 0.5, height * 0.5, height * 0.10, 0, Math.PI * 2)
  context.fill()
  const markerSize = height * 0.075
  const markerCenters = [
    { color: '#ff2d95', x: width * 0.18, y: height * 0.18 },
    { color: '#22d3ee', x: width * 0.82, y: height * 0.18 },
    { color: '#84cc16', x: width * 0.18, y: height * 0.82 },
    { color: '#fb923c', x: width * 0.82, y: height * 0.82 }
  ]
  for (const marker of markerCenters) {
    context.fillStyle = marker.color
    context.fillRect(marker.x - markerSize / 2, marker.y - markerSize / 2, markerSize, markerSize)
  }
  context.fillStyle = '#ffffff'
  context.font = `600 ${Math.max(32, Math.round(height * 0.055))}px sans-serif`
  context.fillText(`${scenario.id} · ${index}`, width * 0.42, height * 0.72)
}

function proxyBackgroundConfig(scenario: SoakScenario) {
  return {
    type: 'solid-color',
    color: '#091525',
    padding: 0,
    outputRatio: 'custom',
    customWidth: scenario.proxyWidth,
    customHeight: scenario.proxyHeight,
    videoPosition: 'center',
    borderRadius: 0,
    shadow: { enabled: false, blur: 0, offsetX: 0, offsetY: 0, color: 'transparent' },
    videoCrop: {
      enabled: true,
      mode: 'percentage',
      xPercent: 0.05,
      yPercent: 0.05,
      widthPercent: 0.9,
      heightPercent: 0.9
    },
    videoZoom: {
      enabled: true,
      scale: 1.1,
      focusX: 0.5,
      focusY: 0.5,
      transitionDurationMs: 0,
      intervals: [{
        startMs: 0,
        endMs: scenario.totalFrames * 1000 / scenario.frameRate,
        scale: 1.1,
        focusX: 0.5,
        focusY: 0.5,
        focusSpace: 'source',
        mode: 'anchor',
        easing: 'punch',
        transitionDurationMs: 0
      }]
    }
  }
}

function phaseRow(label: string, snapshot: OwnershipSnapshot, frameBytes: number, note: string) {
  return `<tr>
    <td>${label}</td>
    <td class="number">${snapshot.aliveByLane.main}</td>
    <td class="number">${snapshot.aliveByLane.next}</td>
    <td class="number">${snapshot.aliveByLane.hover}</td>
    <td class="number">${formatBytes(snapshot.totalAliveBytes)}</td>
    <td>${note}</td>
  </tr>`
}

function renderScenarioResult(input: {
  scenario: SoakScenario
  functionalPass: boolean
  productionCleanupPass: boolean
  gaps: number[]
  peakSnapshot: OwnershipSnapshot
  geometryProbes: GeometryProbe[]
  phaseRows: string[]
  failures: string[]
  elapsedMs: number
}) {
  const maxGap = Math.max(...input.gaps)
  const retainedPlan = input.peakSnapshot.publishedPreviewPlan
  const retainedWidth = retainedPlan?.previewWidth || input.scenario.sourceWidth
  const retainedHeight = retainedPlan?.previewHeight || input.scenario.sourceHeight
  const card = document.createElement('article')
  card.className = 'result-card'
  card.innerHTML = `
    <header>
      <div>
        <h2>${input.scenario.label}</h2>
        <p>${input.scenario.windowFrames} main + ${input.scenario.windowFrames} next frames · ${input.elapsedMs.toFixed(0)}ms soak</p>
      </div>
      <span class="result-state ${input.functionalPass && input.productionCleanupPass ? 'pass' : 'fail'}">
        ${input.functionalPass && input.productionCleanupPass ? 'PASS' : 'FAIL'}
      </span>
    </header>
    <dl class="metrics">
      <div><dt>Source frame</dt><dd>${formatBytes(theoreticalFrameBytes(input.scenario.sourceWidth, input.scenario.sourceHeight))}</dd></div>
      <div><dt>Retained frame</dt><dd>${retainedWidth}×${retainedHeight} · ${formatBytes(theoreticalFrameBytes(retainedWidth, retainedHeight))}</dd></div>
      <div><dt>Peak tracked</dt><dd>${input.peakSnapshot.peakAlive} frames</dd></div>
      <div><dt>Lane peak</dt><dd>${input.peakSnapshot.peakAliveByLane.main}/${input.peakSnapshot.peakAliveByLane.next}/${input.peakSnapshot.peakAliveByLane.hover}</dd></div>
      <div><dt>Stable alive</dt><dd>${input.peakSnapshot.aliveByLane.main}/${input.peakSnapshot.aliveByLane.next}/${input.peakSnapshot.aliveByLane.hover}</dd></div>
      <div><dt>Peak theoretical</dt><dd>${formatBytes(input.peakSnapshot.peakAliveBytes || 0)}</dd></div>
      <div><dt>Max cutover</dt><dd>${maxGap.toFixed(1)}ms</dd></div>
      <div><dt>Decode queue</dt><dd>${input.peakSnapshot.decodeQueuePeakByKind?.main ?? '—'} / ${input.peakSnapshot.publishedDecodeQueueHighWatermark ?? '—'}</dd></div>
      <div><dt>Crop + Zoom</dt><dd>${input.geometryProbes.filter(probe => probe.pass).length}/${input.geometryProbes.length}</dd></div>
    </dl>
    <p class="cleanup-result ${input.productionCleanupPass ? 'pass-text' : 'fail-text'}">
      Production dispose: ${input.productionCleanupPass ? 'cleanup=0' : 'FAIL — retained frames remain'}
    </p>
    ${input.failures.length ? `<ul class="failures">${input.failures.map(item => `<li>${item}</li>`).join('')}</ul>` : ''}
  `
  resultsElement.append(card)
  timelineElement.insertAdjacentHTML('beforeend', `
    <tbody class="scenario-timeline">
      <tr class="scenario-heading"><th colspan="6">${input.scenario.label}</th></tr>
      ${input.phaseRows.join('')}
    </tbody>
  `)
}

function drawAndClose(bitmap: ImageBitmap | undefined): GeometryProbe {
  if (!bitmap) return { pass: false, circleAspect: 0, markerPixels: { tl: 0, tr: 0, bl: 0, br: 0 }, failures: ['missing bitmap'] }
  const context = previewCanvas.getContext('2d', { alpha: false })!
  context.drawImage(bitmap, 0, 0, previewCanvas.width, previewCanvas.height)
  bitmap.close()
  return probeGeometry(context, previewCanvas.width, previewCanvas.height)
}

function probeGeometry(context: CanvasRenderingContext2D, width: number, height: number): GeometryProbe {
  const pixels = context.getImageData(0, 0, width, height).data
  const colors = {
    tl: [255, 45, 149],
    tr: [34, 211, 238],
    bl: [132, 204, 22],
    br: [251, 146, 60]
  } as const
  const markerPixels = { tl: 0, tr: 0, bl: 0, br: 0 }
  const yellowBounds = { minX: width, minY: height, maxX: -1, maxY: -1, count: 0 }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const rgb = [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]
      for (const [name, target] of Object.entries(colors) as Array<[keyof typeof colors, readonly number[]]>) {
        if (rgb.every((value, channel) => Math.abs(value - target[channel]!) <= 38)) markerPixels[name] += 1
      }
      if (Math.abs(rgb[0] - 246) <= 38 && Math.abs(rgb[1] - 196) <= 38 && Math.abs(rgb[2] - 83) <= 38) {
        yellowBounds.count += 1
        yellowBounds.minX = Math.min(yellowBounds.minX, x)
        yellowBounds.maxX = Math.max(yellowBounds.maxX, x)
        yellowBounds.minY = Math.min(yellowBounds.minY, y)
        yellowBounds.maxY = Math.max(yellowBounds.maxY, y)
      }
    }
  }
  const circleWidth = Math.max(0, yellowBounds.maxX - yellowBounds.minX + 1)
  const circleHeight = Math.max(0, yellowBounds.maxY - yellowBounds.minY + 1)
  const circleAspect = circleHeight > 0 ? circleWidth / circleHeight : 0
  const failures: string[] = []
  for (const [name, count] of Object.entries(markerPixels)) {
    if (count < 80) failures.push(`${name} marker missing (${count}px)`)
  }
  if (yellowBounds.count < 300) failures.push(`circle missing (${yellowBounds.count}px)`)
  if (circleAspect < 0.92 || circleAspect > 1.08) failures.push(`circle aspect ${circleAspect.toFixed(3)}`)
  return { pass: failures.length === 0, circleAspect, markerPixels, failures }
}

function closeBitmapIn(message: WorkerEnvelope) {
  const bitmap = message.data?.bitmap
  if (bitmap && typeof bitmap.close === 'function') bitmap.close()
}

function updateProgress(value: number, label: string) {
  progressElement.value = Math.max(0, Math.min(100, value))
  progressLabel.textContent = label
}

function setRunning(running: boolean) {
  runSelectedButton.disabled = running
  runMatrixButton.disabled = running
  scenarioSelect.disabled = running
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function wait(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms))
}
