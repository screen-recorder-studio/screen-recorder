const RESULT_KEY = 'recordingStartLatencyResultV1'
const PROGRESS_KEY = 'recordingStartLatencyProgressV1'
let activeStream = null
let activeReader = null
let activeEncoder = null
let cancelled = false

const now = () => performance.now()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function saveProgress(stage, extra = {}) {
  await saveState({ [PROGRESS_KEY]: { stage, at: Date.now(), ...extra } })
}

async function saveState(values) {
  const response = await chrome.runtime.sendMessage({
    target: 'latency-background',
    type: 'SAVE_LATENCY_STATE',
    values
  })
  if (!response?.ok) throw new Error(response?.error || 'Failed to persist Lab state')
}

async function notifySurface(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ target: 'latency-surface', type, ...payload })
  } catch {
    return null
  }
}

function createProcessor(track) {
  const Processor = globalThis.MediaStreamTrackProcessor
  if (typeof Processor !== 'function') throw new Error('MediaStreamTrackProcessor is unavailable')
  try {
    return new Processor({ track, maxBufferSize: 1 })
  } catch {
    return new Processor({ track })
  }
}

async function openProbeStorage() {
  const root = await navigator.storage.getDirectory()
  const file = await root.getFileHandle('recording-start-latency.tmp', { create: true })
  const writable = await file.createWritable()
  await writable.write(new Uint8Array([0x52, 0x45, 0x43]))
  await writable.close()
}

async function configureEncoder(width, height, metrics) {
  const safeWidth = Math.max(2, Math.floor(width / 2) * 2)
  const safeHeight = Math.max(2, Math.floor(height / 2) * 2)
  const candidates = ['vp09.00.10.08', 'vp8']
  let selected = null
  for (const codec of candidates) {
    const config = { codec, width: safeWidth, height: safeHeight, framerate: 30, bitrate: 2_000_000 }
    try {
      const support = await VideoEncoder.isConfigSupported(config)
      if (support.supported) {
        selected = support.config
        break
      }
    } catch {}
  }
  if (!selected) throw new Error('No VP8/VP9 encoder is supported')

  let chunks = 0
  activeEncoder = new VideoEncoder({
    output: () => { chunks += 1 },
    error: (error) => { metrics.encoderError = String(error) }
  })
  activeEncoder.configure(selected)
  metrics.codec = selected.codec
  metrics.width = safeWidth
  metrics.height = safeHeight
  metrics.getEncodedChunks = () => chunks
}

function startWarmup(track, metrics) {
  const processor = createProcessor(track)
  const reader = processor.readable.getReader()
  let stopping = false
  let prepareResolve
  let prepareReject
  const prepared = new Promise((resolve, reject) => {
    prepareResolve = resolve
    prepareReject = reject
  })
  let preparationStarted = false

  const loop = (async () => {
    try {
      while (!stopping) {
        const { value: frame, done } = await reader.read()
        if (done) break
        metrics.warmupFrames += 1
        if (metrics.countdownSeconds > 0 && (metrics.warmupMagentaRatio || 0) < 0.02) {
          const warmupMarker = inspectCountdownMarker(frame)
          metrics.warmupMagentaRatio = Math.max(metrics.warmupMagentaRatio || 0, warmupMarker.magentaRatio)
        }
        if (!preparationStarted) {
          preparationStarted = true
          metrics.firstWarmupFrameAt = now()
          const width = frame.displayWidth || frame.codedWidth
          const height = frame.displayHeight || frame.codedHeight
          Promise.all([
            configureEncoder(width, height, metrics).then(() => { metrics.encoderReadyAt = now() }),
            openProbeStorage().then(() => { metrics.storageReadyAt = now() })
          ]).then(prepareResolve, prepareReject)
        }
        try { frame.close() } finally { metrics.closedWarmupFrames += 1 }
      }
      if (!preparationStarted) prepareReject(new Error('Capture ended before a warm-up frame arrived'))
    } catch (error) {
      if (!stopping) prepareReject(error)
    }
  })()

  return {
    prepared,
    async stop() {
      stopping = true
      try { await reader.cancel() } catch {}
      try { await loop } catch {}
      try { reader.releaseLock() } catch {}
    }
  }
}

async function runCountdown(seconds, metrics) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.min(5, Math.floor(seconds))) : 3
  metrics.countdownStartedAt = now()
  if (safeSeconds === 0) {
    await notifySurface('LAB_COUNTDOWN_SHOW', { remaining: 0 })
  } else {
    for (let remaining = safeSeconds; remaining > 0; remaining -= 1) {
      if (cancelled) throw new Error('Probe cancelled')
      await notifySurface('LAB_COUNTDOWN_SHOW', { remaining })
      await sleep(1000)
    }
  }
  metrics.countdownFinishedAt = now()
  const response = await notifySurface('LAB_COUNTDOWN_HIDE')
  metrics.surfaceHideAcknowledged = response?.ok === true
  metrics.surfaceHideAckAt = now()
}

async function readWithTimeout(reader, timeoutMs) {
  let timeout
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`No formal frame arrived within ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function inspectCountdownMarker(frame) {
  const width = 320
  const height = 180
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(frame, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  let magenta = 0
  let sampled = 0
  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    if (red > 180 && green < 100 && blue > 150) magenta += 1
    sampled += 1
  }
  return { magentaPixels: magenta, sampledPixels: sampled, magentaRatio: magenta / sampled }
}

async function acquireStream(message, metrics) {
  const requestedAt = now()
  metrics.captureRequestedAt = requestedAt
  let stream
  if (message.mode === 'tab') {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: message.streamId
        }
      }
    })
  } else {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  }
  metrics.captureGrantedAt = now()
  return stream
}

async function runProbe(message) {
  cancelled = false
  const metrics = {
    mode: message.mode,
    countdownSeconds: Number(message.countdownSeconds),
    settleMs: Number(message.settleMs),
    warmupFrames: 0,
    closedWarmupFrames: 0,
    startedAt: now()
  }
  await saveProgress('capture-requested', { mode: message.mode })

  try {
    activeStream = await acquireStream(message, metrics)
    const track = activeStream.getVideoTracks()[0]
    if (!track) throw new Error('No video track was returned')
    const trackSettings = track.getSettings?.() || {}
    metrics.displaySurface = trackSettings.displaySurface || message.mode
    const warmup = startWarmup(track, metrics)
    await saveProgress('countdown', { mode: message.mode })

    await runCountdown(message.countdownSeconds, metrics)
    const settleMs = Number.isFinite(message.settleMs) ? Math.max(0, Math.min(1000, Number(message.settleMs))) : 140
    if (settleMs > 0) await sleep(settleMs)
    metrics.captureBoundaryAt = now()

    await warmup.prepared
    metrics.preparedAt = now()
    await warmup.stop()
    metrics.warmupStoppedAt = now()

    const processor = createProcessor(track)
    activeReader = processor.readable.getReader()
    const firstRead = await readWithTimeout(activeReader, 5000)
    const firstFrame = firstRead.value
    if (firstRead.done || !firstFrame) throw new Error('Capture ended before the formal frame')
    metrics.firstFormalFrameAt = now()
    Object.assign(metrics, inspectCountdownMarker(firstFrame))

    const timelineFrame = new VideoFrame(firstFrame, { timestamp: 0 })
    firstFrame.close()
    activeEncoder.encode(timelineFrame, { keyFrame: true })
    timelineFrame.close()
    await activeEncoder.flush()
    metrics.encodedChunks = metrics.getEncodedChunks()
    delete metrics.getEncodedChunks
    metrics.finishedAt = now()
    metrics.zeroToFormalFrameMs = metrics.firstFormalFrameAt - metrics.countdownFinishedAt
    metrics.hideAckToFormalFrameMs = metrics.firstFormalFrameAt - metrics.surfaceHideAckAt
    metrics.preparedBeforeBoundary = metrics.preparedAt <= metrics.captureBoundaryAt
    metrics.countdownFree = metrics.magentaRatio < 0.02
    metrics.countdownObserved = metrics.countdownSeconds === 0 || metrics.warmupMagentaRatio >= 0.02
    metrics.pass = metrics.countdownFree
      && metrics.countdownObserved
      && metrics.encodedChunks > 0
      && metrics.warmupFrames === metrics.closedWarmupFrames
      && metrics.firstFormalFrameAt >= metrics.captureBoundaryAt

    await saveState({ [RESULT_KEY]: metrics })
    await saveProgress(metrics.pass ? 'pass' : 'fail')
    return { ok: true, result: metrics }
  } catch (error) {
    const result = {
      ...metrics,
      pass: false,
      error: error instanceof Error ? error.message : String(error),
      finishedAt: now()
    }
    delete result.getEncodedChunks
    await saveState({ [RESULT_KEY]: result })
    await saveProgress('error', { error: result.error })
    return { ok: false, error: result.error, result }
  } finally {
    try { await activeReader?.cancel() } catch {}
    try { activeReader?.releaseLock() } catch {}
    activeReader = null
    try { activeEncoder?.close() } catch {}
    activeEncoder = null
    for (const track of activeStream?.getTracks?.() || []) {
      try { track.stop() } catch {}
    }
    activeStream = null
    await notifySurface('LAB_COUNTDOWN_HIDE')
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'latency-offscreen') return false
  if (message.type === 'START_LATENCY_PROBE') {
    runProbe(message).then(sendResponse)
    return true
  }
  if (message.type === 'STOP_LATENCY_PROBE') {
    cancelled = true
    try { activeReader?.cancel() } catch {}
    for (const track of activeStream?.getTracks?.() || []) {
      try { track.stop() } catch {}
    }
    sendResponse({ ok: true })
    return false
  }
  return false
})
