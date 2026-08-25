// Enhanced Offscreen engine with MediaRecorder support
// Complete screen recording implementation with data handling

import { emitJourneyEvent } from '../lib/observability/journey-events'
import { classifyCaptureError } from '../lib/recording/capture-errors'
import { resolveRecordingEncodePlan } from '../lib/recording/recording-encode-plan'
import { createRecordingFrameCadence, sampleRecordingFrame } from '../lib/recording/recording-frame-cadence'
import { mapAreaSelectionToSourceFrame, type AreaRect } from '../lib/recording/area-crop'
import { transferFrameToEncoderWorker } from '../lib/recording/recording-frame-transfer'
import { RecordingDurationTracker } from '../lib/recording/recording-duration-tracker'
import {
  normalizeRecordingCountdown,
  readFirstFormalFrameAfterWarmup,
  startRecordingWarmup
} from '../lib/recording/recording-startup'
import { buildTabCaptureConstraints } from '../lib/recording/tab-capture'
import { waitForOpfsFinalization } from '../lib/workers/opfs-finalize'

(function(){
  const log = (...args: any[]) => {
    try { console.log('[OffscreenEngine]', ...args) } catch {}
  }
  log('🎬 Offscreen recording engine loaded')

  // Recording state management
  let currentStream: MediaStream | null = null
  // MediaRecorder kept for backward-compat/fallback, but WebCodecs will be used
  let mediaRecorder: MediaRecorder | null = null
  // In WebCodecs mode, this will track number of encoded chunks (or store small metadata)
  let recordedChunks: any[] = []
  let isRecording = false
  let isPaused = false
  let recordingStartTime: number | null = null
  const recordingDurationTracker = new RecordingDurationTracker()
  let activeOperationId: string | null = null

  // Badge elapsed timer for action button (drives BADGE_TICK for background)
  let badgeTicker: any = null
  let badgeAccumMs = 0
  let badgeLastStart: number | null = null

  function resetBadgeTicker() {
    try { if (badgeTicker) clearInterval(badgeTicker) } catch {}
    badgeTicker = null
    badgeAccumMs = 0
    badgeLastStart = null
  }

  function startBadgeTicker() {
    resetBadgeTicker()
    badgeLastStart = Date.now()
    try { chrome.runtime?.sendMessage({ type: 'BADGE_TICK', elapsedMs: 0, source: 'offscreen', operationId: activeOperationId }) } catch {}
    badgeTicker = setInterval(() => {
      if (!isRecording) return
      const extra = (!isPaused && badgeLastStart != null) ? Date.now() - badgeLastStart : 0
      const elapsedMs = badgeAccumMs + extra
      try { chrome.runtime?.sendMessage({ type: 'BADGE_TICK', elapsedMs, source: 'offscreen', operationId: activeOperationId }) } catch {}
    }, 1000)
  }

  function pauseBadgeTicker() {
    if (badgeLastStart != null) {
      badgeAccumMs += Date.now() - badgeLastStart
      badgeLastStart = null
    }
  }

  function resumeBadgeTicker() {
    if (badgeLastStart == null) badgeLastStart = Date.now()
  }

  function stopBadgeTicker() {
    resetBadgeTicker()
  }


  // WebCodecs pipeline state
  let wcWorker: Worker | null = null
  let wcReader: ReadableStreamDefaultReader<VideoFrame> | null = null
  let wcFrameLoopActive = false
  let wcWorkerPreloaded = false  // ✅ Track if worker was preloaded
  let wcFramesInFlight = 0
  const WC_MAX_FRAMES_IN_FLIGHT = 4
  let isStarting = false  // Guard against concurrent start requests

  // OPFS writer (side-write) state
  const OPFS_WRITER_ENABLED = true
  let opfsWriter: Worker | null = null
  let opfsWriterReady = false
  let opfsSessionId: string | null = null
  let opfsLastMeta: any = null
  const opfsPendingChunks: Array<{ data: any; timestamp?: number; type?: string; codedWidth?: number; codedHeight?: number; codec?: string }> = []
  const OPFS_PENDING_CHUNKS_MAX = 500
  let opfsEndPending = false
  let opfsPendingFinalizeDurationMs = 0
  let opfsInitPromise: Promise<void> | null = null
  let resolveOpfsInit: (() => void) | null = null
  let rejectOpfsInit: ((error: any) => void) | null = null

  function ensureOpfsSessionId() { if (!opfsSessionId) opfsSessionId = `${Date.now()}`; return opfsSessionId }

  function getErrorMessage(error: any, fallback = 'Unknown error') {
    if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) return error.message
    if (typeof error?.message === 'string' && error.message.trim()) return error.message
    if (typeof error === 'string' && error.trim()) return error
    return fallback
  }

  function createErrorWithCode(message: string, code?: string) {
    const error: any = new Error(message)
    if (code) error.code = code
    return error
  }

  function emitStreamWarning(warning: string, code?: string) {
    try { chrome.runtime?.sendMessage({ type: 'STREAM_WARNING', warning, code, operationId: activeOperationId }) } catch {}
  }

  function emitStreamError(error: string, code?: string) {
    try { chrome.runtime?.sendMessage({ type: 'STREAM_ERROR', error, code, operationId: activeOperationId }) } catch {}
  }

  function clearOpfsInitState() {
    opfsInitPromise = null
    resolveOpfsInit = null
    rejectOpfsInit = null
  }

  function resolveOpfsInitIfPending() {
    const resolve = resolveOpfsInit
    clearOpfsInitState()
    try { resolve?.() } catch {}
  }

  function rejectOpfsInitIfPending(error: any) {
    const reject = rejectOpfsInit
    clearOpfsInitState()
    if (!reject) return false
    try { reject(error) } catch {}
    return true
  }

  function resetOpfsWriterState() {
    try { opfsWriter?.terminate() } catch {}
    opfsWriter = null
    opfsWriterReady = false
    opfsSessionId = null
    opfsLastMeta = null
    opfsPendingChunks.length = 0
    opfsEndPending = false
    opfsPendingFinalizeDurationMs = 0
    clearOpfsInitState()
  }

  function cleanupFailedStart() {
    try { stopBadgeTicker() } catch {}
    try { wcFrameLoopActive = false; wcWorker?.postMessage({ type: 'stop' }) } catch {}
    wcWorker = null
    wcFramesInFlight = 0
    try { void wcReader?.cancel() } catch {}
    try { wcReader?.releaseLock() } catch {}
    wcReader = null
    if (currentStream) {
      try {
        currentStream.getTracks().forEach((track) => {
          try { track.stop() } catch {}
        })
      } catch {}
      currentStream = null
    }
    mediaRecorder = null
    recordedChunks = []
    isPaused = false
    recordingStartTime = null
    recordingDurationTracker.reset()
    resetOpfsWriterState()
  }

  function handleOpfsWriterWarning(payload: any) {
    const warning = getErrorMessage(payload?.message || payload?.warning, 'Storage space is running low. Recording may fail.')
    const code = typeof payload?.code === 'string' && payload.code.trim() ? payload.code : 'STORAGE_LOW_WARNING'
    log('[Offscreen][OPFS] warning:', payload)
    emitStreamWarning(warning, code)
  }

  function handleOpfsWriterFatalError(payload: any) {
    const code = typeof payload?.code === 'string' && payload.code.trim() ? payload.code : 'OPFS_WRITE_ERROR'
    const message = getErrorMessage(payload?.message || payload?.error, 'Failed to write recording data')
    const error = createErrorWithCode(message, code)
    const wasWaitingForInit = rejectOpfsInitIfPending(error)
    log('[Offscreen][OPFS] fatal error:', payload)
    emitJourneyEvent({
      name: 'storage.failed',
      context: 'offscreen',
      attributes: { outcome: 'failure', errorCode: code }
    })
    resetOpfsWriterState()
    if (wasWaitingForInit) return
    emitStreamError(message, code)
    if (isRecording) {
      stopRecordingInternal()
    }
  }

  function normalizeMeta(m: any) {
    if (!m) return {} as any
    const metaW = (typeof m.width === 'number') ? m.width : (m.codedWidth)
    const metaH = (typeof m.height === 'number') ? m.height : (m.codedHeight)
    return {
      codec: m.codec || 'vp8',
      width: metaW ?? 1920,
      height: metaH ?? 1080,
      fps: m.framerate || m.fps || 30,
      intent: m.intent === 'gif' ? 'gif' : 'video',
      ...(m.capture ? { capture: m.capture } : {})
    }
  }

  async function initOpfsWriter(meta?: any): Promise<void> {
    if (!OPFS_WRITER_ENABLED) return
    if (opfsWriterReady) return
    if (opfsInitPromise) return opfsInitPromise
    if (opfsWriter) return
    opfsWriterReady = false
    opfsLastMeta = normalizeMeta(meta || opfsLastMeta)
    opfsInitPromise = new Promise<void>((resolve, reject) => {
      resolveOpfsInit = resolve
      rejectOpfsInit = reject
    })
    try {
      opfsWriter = new Worker(new URL('../lib/workers/opfs-writer-worker.ts', import.meta.url), { type: 'module' })
      const id = ensureOpfsSessionId()
      opfsWriter.onmessage = (ev: MessageEvent) => {
        const d: any = ev.data || {}
        if (d.type === 'ready') {
          opfsWriterReady = true
          emitJourneyEvent({ name: 'storage.ready', context: 'offscreen' })
          resolveOpfsInitIfPending()
          flushOpfsPendingIfReady()
        }
        else if (d.type === 'warning') { handleOpfsWriterWarning(d) }
        else if (d.type === 'progress') { /* light log omitted */ }
        else if (d.type === 'error') { handleOpfsWriterFatalError(d) }
        else if (d.type === 'finalized') {
          emitJourneyEvent({ name: 'storage.finalized', context: 'offscreen', attributes: { outcome: 'success' } })
          try {
            log('[stop-share] offscreen: sending OPFS_RECORDING_READY')
            chrome.runtime?.sendMessage({
              type: 'OPFS_RECORDING_READY',
              id: `rec_${d?.id ?? id}`,
              meta: opfsLastMeta,
              intent: opfsLastMeta?.intent,
              operationId: activeOperationId
            })
          } catch {}
          clearOpfsInitState()
          try { opfsWriter?.terminate() } catch {}
          opfsWriter = null; opfsWriterReady = false; opfsSessionId = null; opfsLastMeta = null; opfsPendingChunks.length = 0; opfsEndPending = false; opfsPendingFinalizeDurationMs = 0
          recordingDurationTracker.reset()
          activeOperationId = null
        }
      }
      opfsWriter.postMessage({ type: 'init', id, meta: opfsLastMeta })
      return opfsInitPromise
    } catch (e) {
      log('[Offscreen][OPFS] failed to start writer', e)
      const error = createErrorWithCode(getErrorMessage(e, 'Failed to start OPFS writer'), 'OPFS_INIT_ERROR')
      rejectOpfsInitIfPending(error)
      resetOpfsWriterState()
      throw error
    }
  }

  function flushOpfsPendingIfReady() {
    if (!opfsWriter || !opfsWriterReady) return
    while (opfsPendingChunks.length) { const c = opfsPendingChunks.shift()!; appendToOpfsChunk(c) }
    if (opfsEndPending) {
      const durationMs = opfsPendingFinalizeDurationMs
      opfsEndPending = false
      opfsPendingFinalizeDurationMs = 0
      void finalizeOpfsWriter(durationMs)
    }
  }

  function appendToOpfsChunk(d: { data: any; timestamp?: number; type?: string; isKeyframe?: boolean; codedWidth?: number; codedHeight?: number; codec?: string }) {
    if (!OPFS_WRITER_ENABLED) return
    if (!opfsWriter || !opfsWriterReady) {
      if (opfsPendingChunks.length >= OPFS_PENDING_CHUNKS_MAX) {
        handleOpfsWriterFatalError({
          code: 'OPFS_BACKPRESSURE_OVERFLOW',
          message: `Recording storage queue exceeded ${OPFS_PENDING_CHUNKS_MAX} chunks`
        })
        return
      }
      opfsPendingChunks.push(d); return
    }
    try {
      const raw: any = d.data
      let u8: Uint8Array | null = null
      if (raw instanceof ArrayBuffer) u8 = new Uint8Array(raw)
      else if (raw && ArrayBuffer.isView(raw) && typeof raw.byteLength === 'number') { const view = raw as ArrayBufferView & { byteOffset?: number }; u8 = new Uint8Array(view.buffer, (view as any).byteOffset || 0, view.byteLength) }
      else if (raw && typeof raw.copyTo === 'function' && typeof raw.byteLength === 'number') { const tmp = new Uint8Array(raw.byteLength); try { raw.copyTo(tmp) } catch {}; u8 = tmp }
      else if (raw instanceof Blob) { raw.arrayBuffer().then((ab) => appendToOpfsChunk({ ...d, data: ab })).catch(() => {}); return }
      else if (Array.isArray(raw)) u8 = new Uint8Array(raw as number[])
      else if (raw && typeof raw === 'object') { const keys = Object.keys(raw); const isIndexedObject = keys.length > 0 && keys.every(k => /^\d+$/.test(k)); if (isIndexedObject) { const maxIndex = Math.max(...keys.map(k => parseInt(k, 10))); const bytes = new Array(maxIndex + 1); for (let i = 0; i <= maxIndex; i++) bytes[i] = raw[i] || 0; u8 = new Uint8Array(bytes) } }
      if (!u8) { log('[Offscreen][OPFS] Unsupported chunk data'); return }
      const transferBuf = (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) ? u8.buffer : u8.slice().buffer

      // 🔧 修复：优先使用传入的 isKeyframe 标记，回退到 type 字段检查
      const isKeyframe = d.isKeyframe === true || d.type === 'key'
      const chunkType = isKeyframe ? 'key' : 'delta'
      if (isKeyframe) {
        log(`[OPFS] 🔑 Keyframe detected: ts=${d.timestamp}, size=${u8.byteLength}`)
      }

      opfsWriter!.postMessage({ type: 'append', buffer: transferBuf, timestamp: d.timestamp || 0, chunkType, codedWidth: d.codedWidth || opfsLastMeta?.width, codedHeight: d.codedHeight || opfsLastMeta?.height, codec: d.codec || opfsLastMeta?.codec, isKeyframe }, [transferBuf])
    } catch (e) {
      handleOpfsWriterFatalError({
        code: 'OPFS_APPEND_FAILED',
        message: getErrorMessage(e, 'Failed to append recording data')
      })
    }
  }

  async function finalizeOpfsWriter(wallClockDurationMs = 0) {
    if (!opfsWriter) return
    const writer = opfsWriter
    emitJourneyEvent({ name: 'storage.finalize_started', context: 'offscreen' })
    try {
      await waitForOpfsFinalization(writer, 30_000, { wallClockDurationMs })
    } catch (error) {
      const code = typeof (error as any)?.code === 'string' ? (error as any).code : 'OPFS_FINALIZE_FAILED'
      log('[Offscreen][OPFS] finalize failed', error)
      if (code.startsWith('OPFS_FINALIZE_')) {
        emitJourneyEvent({
          name: 'storage.failed',
          context: 'offscreen',
          attributes: { outcome: 'failure', errorCode: code }
        })
        emitStreamError('Recording storage could not be finalized', code)
      }
    } finally {
      try { writer.terminate() } catch {}
      if (opfsWriter === writer) resetOpfsWriterState()
    }
  }

  // ✅ Preload WebCodecs Worker for faster recording start
  function preloadWebCodecsWorker(): void {
    if (wcWorker) {
      log('⚡ [Preload] WebCodecs Worker already exists, skipping')
      return
    }
    if (isRecording) {
      log('⚡ [Preload] Recording in progress, skipping preload')
      return
    }

    try {
      log('⚡ [Preload] Creating WebCodecs Worker...')
      wcWorker = new Worker(new URL('../lib/workers/webcodecs-worker.ts', import.meta.url), { type: 'module' })

      wcWorker.onmessage = (evt: MessageEvent) => {
        const { type } = evt.data || {}
        if (type === 'initialized') {
          log('⚡ [Preload] WebCodecs Worker initialized and ready')
          wcWorkerPreloaded = true
        }
      }

      wcWorker.onerror = (err) => {
        log('⚡ [Preload] WebCodecs Worker preload error:', err)
        wcWorker = null
        wcWorkerPreloaded = false
      }

      log('⚡ [Preload] WebCodecs Worker created, waiting for initialization...')
    } catch (e) {
      log('⚡ [Preload] Failed to preload WebCodecs Worker:', e)
      wcWorker = null
      wcWorkerPreloaded = false
    }
  }

  // Get supported MIME types for recording
  function getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4'
    ]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        log('📹 Using MIME type:', type)
        return type
      }
    }

    log('⚠️ No preferred MIME type supported, using default')
    return 'video/webm'
  }

  // 直接在 offscreen document 中获取显示媒体流
  async function getDisplayMediaStream(mode: 'window' | 'screen' = 'screen'): Promise<MediaStream> {
    log('🎥 Requesting display media directly in offscreen document...', { mode })
    emitJourneyEvent({
      name: 'capture.permission_requested',
      context: 'offscreen',
      attributes: { mode }
    })

    try {
      const displayMediaOptions: any = {
        video: {
          ...(mode === 'screen' && {
            displaySurface: 'monitor',
            monitorTypeSurfaces: 'include',
            selfBrowserSurface: 'exclude'
          }),
          ...(mode === 'window' && {
            displaySurface: 'window',
            selfBrowserSurface: 'exclude'
          }),
        },
        audio: false,
        ...(mode === 'screen' && {
          selfBrowserSurface: 'exclude',
          monitorTypeSurfaces: 'include'
        })
      }

      log('📋 Display media options:', displayMediaOptions)
      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)
      const videoTracks = stream?.getVideoTracks() || []
      if (!stream || videoTracks.length === 0) {
        throw new DOMException('No display video track was returned', 'NotFoundError')
      }

      const audioTracks = stream.getAudioTracks()
      emitJourneyEvent({
        name: 'capture.permission_granted',
        context: 'offscreen',
        attributes: { mode }
      })
      log('📺 Display media stream obtained successfully:', {
        id: stream.id,
        videoTracks: videoTracks.length,
        audioTracks: audioTracks.length,
        videoLabel: videoTracks[0]?.label,
        videoState: videoTracks[0]?.readyState
      })
      return stream
    } catch (error) {
      const { code } = classifyCaptureError(error)
      const isDenied = code === 'PERMISSION_DENIED'
      emitJourneyEvent({
        name: isDenied ? 'capture.permission_denied' : 'capture.failed',
        context: 'offscreen',
        attributes: {
          mode,
          outcome: code === 'CAPTURE_CANCELLED' ? 'cancelled' : 'failure',
          errorCode: code
        }
      })
      log('❌ Error getting display media:', { code })

      const messages: Record<string, string> = {
        PERMISSION_DENIED: 'Screen sharing was not started',
        CAPTURE_CANCELLED: 'Screen sharing was cancelled',
        CAPTURE_SOURCE_NOT_FOUND: 'No display media source was found',
        CAPTURE_NOT_SUPPORTED: 'Screen sharing is not supported in this environment',
        CAPTURE_INVALID_STATE: 'Screen sharing must be started from an active extension window',
        CAPTURE_FAILED: 'Screen sharing could not be started'
      }
      throw createErrorWithCode(messages[code] || messages.CAPTURE_FAILED, code)
    }
  }

  async function getTabMediaStream(streamId: unknown, includeAudio: boolean): Promise<MediaStream> {
    log('🎥 Consuming current-tab capture stream in offscreen document...')
    try {
      const constraints = buildTabCaptureConstraints(
        typeof streamId === 'string' ? streamId : '',
        includeAudio
      )
      const stream = await navigator.mediaDevices.getUserMedia(constraints as any)
      if (!stream || stream.getVideoTracks().length === 0) {
        throw createErrorWithCode('No current-tab video track was returned', 'TAB_CAPTURE_FAILED')
      }
      emitJourneyEvent({
        name: 'capture.permission_granted',
        context: 'offscreen',
        attributes: { mode: 'tab' }
      })
      return stream
    } catch (error) {
      const code = typeof (error as any)?.code === 'string'
        ? (error as any).code
        : 'TAB_CAPTURE_FAILED'
      emitJourneyEvent({
        name: 'capture.failed',
        context: 'offscreen',
        attributes: { mode: 'tab', outcome: 'failure', errorCode: code }
      })
      throw createErrorWithCode('Current-tab recording could not be started', code)
    }
  }

  async function startRecording(options?: any, tabStreamId?: unknown): Promise<void> {
    const timestamp = new Date().toISOString()
    let heldFirstFrame: VideoFrame | null = null
    let stopWarmup: (() => Promise<void>) | null = null
    let areaCropRect: AreaRect | null = null
    let areaSourceFrameSize: { width: number; height: number } | null = null
    log(`🎯 [${timestamp}] Starting recording directly in offscreen document...`, { options })

    // Guard against concurrent start requests
    if (isStarting) {
      log('⚠️ Recording start already in progress, rejecting duplicate request')
      throw createErrorWithCode('Recording start already in progress', 'START_ALREADY_IN_PROGRESS')
    }
    isStarting = true
    activeOperationId = typeof options?.operationId === 'string' && options.operationId.trim()
      ? options.operationId
      : null

    try {
      // Stop any existing recording
      if (isRecording) {
        log('🛑 Stopping existing recording before starting new one')
        stopRecordingInternal()
      }

      // 提取录制模式，默认为 screen
      const mode = options?.mode === 'tab' || options?.mode === 'window' || options?.mode === 'screen' || options?.mode === 'area'
        ? options.mode
        : 'screen'
      const intent = options?.intent === 'gif' ? 'gif' : 'video'
      log(`📺 Recording mode: ${mode}`)

      // Current-tab capture is a no-picker tabCapture stream. Window/screen
      // capture intentionally continue to use the system display picker.
      const stream = mode === 'tab' || mode === 'area'
        ? await getTabMediaStream(tabStreamId, options?.audio === true)
        : await getDisplayMediaStream(mode)
      currentStream = stream

      const videoTracks = stream.getVideoTracks() || []
      const audioTracks = stream.getAudioTracks() || []
      const videoTrack = videoTracks[0]

      log('📺 MediaStream acquired:', {
        id: stream.id,
        videoTracks: videoTracks.length,
        audioTracks: audioTracks.length,
        videoLabel: videoTrack?.label,
        videoState: videoTrack?.readyState,
        canRequestAudioTrack: options?.canRequestAudioTrack
      })

      // Stop on user stop sharing
      if (videoTrack) {
        videoTrack.onended = () => {
          log('[stop-share] offscreen: video track onended fired (user stop share)')
          log('📺 Video track ended - user stopped sharing')
          stopRecordingInternal()
        }
      }

      // 2) Ensure WebCodecs availability
      if (typeof (window as any).VideoEncoder === 'undefined' || typeof (window as any).MediaStreamTrackProcessor === 'undefined') {
        throw new Error('WebCodecs APIs not supported in this environment')
      }

      // 3) Track settings are only hints. The first warm-up frame is the source
      // of truth for the stable balanced encode plan, but no warm-up frame may
      // cross the formal recording boundary.
      const settings = (videoTrack as any)?.getSettings?.() || {}
      let width = 1920
      let height = 1080
      let framerate = Math.round(settings.frameRate || 30)
      const bitrate = options?.bitrate || 8_000_000 // 8 Mbps default

      // 4) Create or reuse preloaded WebCodecs Worker
      const wasPreloaded = wcWorker !== null && wcWorkerPreloaded
      if (!wcWorker) {
        log('🔧 Creating new WebCodecs Worker (not preloaded)')
        wcWorker = new Worker(new URL('../lib/workers/webcodecs-worker.ts', import.meta.url), { type: 'module' })
      } else {
        log('⚡ Reusing preloaded WebCodecs Worker')
      }
      wcWorkerPreloaded = false  // Reset preload flag as we're now using it for recording
      wcFramesInFlight = 0

      let configuredEncoderConfig: any = null
      let resolveConfigured: (() => void) | null = null
      let rejectConfigured: ((error: Error) => void) | null = null
      const waitForConfigured = new Promise<void>((resolve, reject) => {
        resolveConfigured = resolve
        rejectConfigured = reject
      })
      recordedChunks = []
      recordingStartTime = null
      recordingDurationTracker.reset()

      wcWorker.onmessage = (evt: MessageEvent) => {
        const { type, data, config } = (evt.data || {})
        switch (type) {
          case 'initialized':
            log(`👷 WebCodecs worker initialized${wasPreloaded ? ' (was preloaded)' : ''}`)
            break
          case 'configured':
            configuredEncoderConfig = config
            try { resolveConfigured?.() } catch {}
            resolveConfigured = null
            rejectConfigured = null
            log('✅ WebCodecs worker configured:', config)
            break
          case 'frame-done':
            wcFramesInFlight = Math.max(0, wcFramesInFlight - 1)
            break
          case 'chunk': {
            // track chunk meta count; avoid retaining big buffers here to save memory
            if (data) {
              // 🔧 修复：使用 chunkType 字段（从 webcodecs-worker 传递）
              const chunkType = data.chunkType || data.type || 'delta'
              const isKeyframe = data.isKeyframe === true || chunkType === 'key'

              recordedChunks.push({ size: data.size, ts: data.timestamp, type: chunkType })
              try {
                chrome.runtime.sendMessage({
                  type: 'STREAM_CHUNK_INFO',
                  meta: { index: recordedChunks.length, size: data.size, ts: data.timestamp, type: chunkType }
                })
              } catch {}
              try {
                // Side-write to OPFS
                appendToOpfsChunk({
                  data: data.data,
                  timestamp: data.timestamp,
                  type: chunkType,
                  isKeyframe: isKeyframe, // 🔧 额外传递布尔标记
                  codedWidth: data.codedWidth,
                  codedHeight: data.codedHeight,
                  codec: data.codec
                })
              } catch {}
            }
            break
          }
          case 'error':
            log('❌ [WebCodecs Worker] error:', data)
            if (rejectConfigured) {
              try { rejectConfigured(createErrorWithCode(String(data), 'ENCODER_CONFIG_ERROR')) } catch {}
              resolveConfigured = null
              rejectConfigured = null
            }
            try {
              emitStreamError(String(data), 'ENCODER_ERROR')
            } catch {}
            break
          case 'complete':
            try {
              log('🎞️ WebCodecs encoding complete')
              const stopTs = new Date().toISOString()
              const duration = recordingDurationTracker.duration(performance.now())

              // ✅ 延迟100ms确保所有chunks到达OPFS Writer
              setTimeout(() => {
                try {
                  if (OPFS_WRITER_ENABLED) {
                    if (!opfsWriterReady || opfsPendingChunks.length > 0) {
                      log(`⏳ OPFS not ready or has pending chunks (${opfsPendingChunks.length}), deferring finalize`)
                      opfsEndPending = true
                      opfsPendingFinalizeDurationMs = duration
                    } else {
                      log('✅ Finalizing OPFS writer')
                      void finalizeOpfsWriter(duration)
                    }
                  }
                } catch (e) {
                  log('❌ Failed to finalize OPFS:', e)
                }
              }, 100)

              // 通知录制完成（不再发送base64 blob，使用OPFS）
              try {
                log('[stop-share] offscreen: sending RECORDING_COMPLETE')
                chrome.runtime.sendMessage({
                  type: 'RECORDING_COMPLETE',
                  target: 'service-worker',
                  operationId: activeOperationId,
                  data: {
                    metadata: {
                      duration,
                      chunks: recordedChunks.length,
                      timestamp: stopTs,
                      engine: 'webcodecs',
                      width,
                      height,
                      framerate,
                      useOpfs: OPFS_WRITER_ENABLED
                    }
                  }
                })
              } catch (e) {
                log('❌ Failed to send RECORDING_COMPLETE:', e)
              }
            } catch (e) {
              log('❌ Failed to process complete message:', e)
            }
            break
        }
      }

      // 5) Drain countdown frames while encoder selection and OPFS startup run
      // concurrently. Every frame in this lane is closed by the warm-up owner;
      // a fresh processor is created only after the countdown boundary.
      const ProcessorCtor: any = (window as any).MediaStreamTrackProcessor
      const createProcessorReader = (): ReadableStreamDefaultReader<VideoFrame> => {
        let processor: any
        try {
          processor = new ProcessorCtor({ track: videoTrack, maxBufferSize: 1 })
        } catch {
          processor = new ProcessorCtor({ track: videoTrack })
        }
        return processor.readable.getReader()
      }
      const warmup = startRecordingWarmup({
        reader: createProcessorReader(),
        prepareFromFrame: async (frame: VideoFrame) => {
          const firstFrameWidth = frame.displayWidth || frame.codedWidth || settings.width || 1920
          const firstFrameHeight = frame.displayHeight || frame.codedHeight || settings.height || 1080
          if (mode === 'area') {
            areaCropRect = mapAreaSelectionToSourceFrame({
              rectCss: options?.areaSelection?.rectCss,
              viewportCss: options?.areaSelection?.viewportCss,
              sourceFrame: { width: firstFrameWidth, height: firstFrameHeight }
            })
            areaSourceFrameSize = { width: firstFrameWidth, height: firstFrameHeight }
          }
          const encodePlan = resolveRecordingEncodePlan(
            areaCropRect?.width || firstFrameWidth,
            areaCropRect?.height || firstFrameHeight,
            settings.frameRate || 30
          )
          width = encodePlan.width
          height = encodePlan.height
          framerate = encodePlan.framerate

          wcWorker?.postMessage({ type: 'configure', config: { width, height, bitrate, framerate } })
          await waitForConfigured
          width = configuredEncoderConfig?.width || width
          height = configuredEncoderConfig?.height || height
          framerate = configuredEncoderConfig?.framerate || framerate
          if (OPFS_WRITER_ENABLED) {
            await initOpfsWriter({
              codec: configuredEncoderConfig?.codec,
              width,
              height,
              framerate,
              intent,
              ...(mode === 'area' && areaCropRect && areaSourceFrameSize ? {
                capture: {
                  mode: 'area',
                  source: 'tab',
                  intent: 'gif',
                  mappingVersion: 2,
                  requestedRectCss: options.areaSelection.rectCss,
                  viewportCss: options.areaSelection.viewportCss,
                  actualRectPx: areaCropRect,
                  sourceFrameSize: areaSourceFrameSize
                }
              } : {})
            })
          }
        }
      })
      stopWarmup = () => warmup.stop()
      // Preparation failures are observed after the countdown so the user still
      // sees a stable countdown lifecycle without an unhandled rejection.
      void warmup.prepared.catch(() => {})

      // The capture owner also owns the countdown. Action popups are disposable
      // and may close as soon as the browser source picker takes focus.
      const COUNTDOWN_SECONDS = normalizeRecordingCountdown(options?.countdown)
      const publishCountdown = async (remaining: number) => {
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'STREAM_META',
            operationId: activeOperationId,
            meta: { preparing: true, countdown: remaining, mode }
          })
          if (mode === 'area' && response?.ok !== true) {
            throw createErrorWithCode('Area selector countdown acknowledgement failed', 'AREA_SELECTOR_ACK_FAILED')
          }
        } catch (error) {
          if (mode === 'area') throw error
        }
      }
      for (let remaining = COUNTDOWN_SECONDS; remaining > 0; remaining -= 1) {
        await publishCountdown(remaining)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      await publishCountdown(0)
      // Extra guard to avoid capturing the last compositor frame of countdown window
      await new Promise((r) => setTimeout(r, 140));

      const formalStart = await readFirstFormalFrameAfterWarmup({
        warmup,
        createFormalReader: createProcessorReader
      })
      stopWarmup = null

      // The formal lane is intentionally a new processor. MediaStreamTrackProcessor
      // queues are implementation-owned and can contain the last countdown frame;
      // recreating it after the boundary prevents that frame from entering OPFS.
      const reader = formalStart.reader as ReadableStreamDefaultReader<VideoFrame>
      wcReader = reader
      heldFirstFrame = formalStart.frame

      // 6) Start frame processing loop
      isPaused = false
      wcFrameLoopActive = true
      isRecording = true
      recordingStartTime = Date.now()
      recordingDurationTracker.start(performance.now())

      // Start badge elapsed ticker for action button
      startBadgeTicker()

      // Notify service worker (engine: webcodecs)
      try {
        chrome.runtime.sendMessage({
          type: 'STREAM_START',
          operationId: activeOperationId,
          mode: mode,
          metadata: { engine: 'webcodecs', width, height, framerate, bitrate, startTime: recordingStartTime }
        })
      } catch {}

      let frameIndex = 0
      let lastActiveFrameTimestampUs = -1
      let frameCadence = createRecordingFrameCadence(framerate)
      const keyEvery = Math.max(1, framerate * 2) // force keyframe every 2 seconds
      const enqueueFrame = (frame: VideoFrame) => {
        if (isPaused) {
          try { frame.close() } catch {}
          return
        }
        const candidateTimestampUs = Math.max(
          lastActiveFrameTimestampUs + 1,
          recordingDurationTracker.timestampUs(performance.now())
        )
        const cadenceDecision = sampleRecordingFrame(frameCadence, candidateTimestampUs)
        frameCadence = cadenceDecision.cadence
        if (!cadenceDecision.accept) {
          try { frame.close() } catch {}
          return
        }

        if (wcFramesInFlight >= WC_MAX_FRAMES_IN_FLIGHT) {
          try { frame.close() } catch {}
          return
        }

        const keyFrame = frameIndex === 0 || (frameIndex % keyEvery === 0)
        const activeTimestampUs = candidateTimestampUs
        let activeTimelineFrame: VideoFrame | null = null
        try {
          if (mode === 'area') {
            if (!areaCropRect || !areaSourceFrameSize) {
              throw createErrorWithCode('Area crop was not initialized', 'AREA_CROP_UNAVAILABLE')
            }
            const frameWidth = frame.displayWidth || frame.codedWidth
            const frameHeight = frame.displayHeight || frame.codedHeight
            if (frameWidth !== areaSourceFrameSize.width || frameHeight !== areaSourceFrameSize.height) {
              throw createErrorWithCode('Captured page dimensions changed during area recording', 'AREA_SOURCE_SIZE_CHANGED')
            }
            activeTimelineFrame = new VideoFrame(frame, {
              timestamp: activeTimestampUs,
              visibleRect: areaCropRect,
              displayWidth: width,
              displayHeight: height
            })
          } else {
            activeTimelineFrame = new VideoFrame(frame, { timestamp: activeTimestampUs })
          }
          try { frame.close() } catch {}
          const worker = wcWorker
          if (!worker) throw createErrorWithCode('Encoder worker is unavailable', 'ENCODER_UNAVAILABLE')
          transferFrameToEncoderWorker(worker, activeTimelineFrame, keyFrame)
          activeTimelineFrame = null
          wcFramesInFlight++
          lastActiveFrameTimestampUs = activeTimestampUs
          frameIndex++
        } catch (error) {
          try { frame.close() } catch {}
          try { activeTimelineFrame?.close() } catch {}
          throw error
        }
      }

      enqueueFrame(heldFirstFrame)
      heldFirstFrame = null
      ;(async () => {
        try {
          while (wcFrameLoopActive) {
            const { value: frame, done } = await reader.read()
            if (done || !frame) break
            enqueueFrame(frame)
          }
        } catch (err) {
          log('❌ Frame loop error:', err)
          const errorMessage = getErrorMessage(err, 'Area frame processing failed')
          const code = typeof (err as any)?.code === 'string' ? (err as any).code : 'FRAME_PIPELINE_ERROR'
          emitStreamError(errorMessage, code)
          if (isRecording) stopRecordingInternal()
        }
      })()

      log(`✅ [${timestamp}] Recording started successfully:`, {
        engine: 'webcodecs', width, height, framerate, bitrate, chunkStrategy: 'frame-stream'
      })

    } catch (e) {
      if (stopWarmup) {
        try { await stopWarmup() } catch {}
        stopWarmup = null
      }
      if (heldFirstFrame) {
        try { heldFirstFrame.close() } catch {}
        heldFirstFrame = null
      }
      log('❌ Failed to start recording:', e)
      isRecording = false
      isPaused = false
      recordingStartTime = null
      cleanupFailedStart()
      const errorMessage = getErrorMessage(e, 'Failed to start recording')
      const code = typeof (e as any)?.code === 'string' && (e as any).code.trim() ? (e as any).code : undefined
      emitStreamError(errorMessage, code)
      throw createErrorWithCode(errorMessage, code)
    } finally {
      isStarting = false
    }
  }

  function stopRecordingInternal(): void {
    const timestamp = new Date().toISOString()
    log(`🛑 [${timestamp}] Stopping recording...`)
    log('[stop-share] offscreen: stopRecordingInternal invoked')

    try {
      recordingDurationTracker.stop(performance.now())
      // Stop badge ticker first so background stops updating time
      try { stopBadgeTicker() } catch {}
      // Stop WebCodecs pipeline (if active)
      try { wcFrameLoopActive = false; wcWorker?.postMessage({ type: 'stop' }) } catch (e) { log('❌ Error posting stop to WebCodecs worker:', e) }
      wcWorker = null
      try { void wcReader?.cancel() } catch {}
      try { wcReader?.releaseLock() } catch {}
      wcReader = null

      // Stop MediaRecorder (fallback)
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        log('📹 Stopping MediaRecorder...')
        mediaRecorder.stop()
      }

      // Stop all tracks
      if (currentStream) {
        const tracks = currentStream.getTracks()
        tracks.forEach((track, index) => {
          try {
            track.stop()
            log(`🔇 Stopped track ${index + 1}/${tracks.length}: ${track.kind}`)
          } catch (e) {
            log(`❌ Error stopping track ${index + 1}:`, e)
          }
        })
        currentStream = null
      }

      log(`✅ [${timestamp}] Recording cleanup completed`)

      // Notify service worker
      try {
        log('[stop-share] offscreen: sending STREAM_END')
        chrome.runtime.sendMessage({ type: 'STREAM_END', operationId: activeOperationId })
      } catch {
        log('[stop-share] offscreen: failed to send STREAM_END')
      }

    } catch (e) {
      log('❌ Error during recording cleanup:', e)
      try {
        log('[stop-share] offscreen: sending STREAM_END (error path)')
        chrome.runtime.sendMessage({ type: 'STREAM_END', operationId: activeOperationId })
      } catch {
        log('[stop-share] offscreen: failed to send STREAM_END (error path)')
      }
    } finally {
      // Reset state
      try { stopBadgeTicker() } catch {}
      isRecording = false
      isPaused = false
      recordingStartTime = null
      mediaRecorder = null
      recordedChunks = []
    }
  }


  // Enhanced message handling with better logging and error handling
  try {
    chrome.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
      const type = msg?.type as string | undefined
      const timestamp = new Date().toISOString()

      // Only handle messages explicitly targeted to this offscreen document
      const isForOffscreen = msg?.target === 'offscreen-doc' && typeof type === 'string' && type.startsWith('OFFSCREEN_')

      if (!isForOffscreen) {
        return false // Ignore non-offscreen or untargeted messages
      }

      log(`📨 [${timestamp}] Received message:`, {
        type,
        target: msg?.target,
        trigger: msg?.trigger,
        hasPayload: !!msg?.payload,
        sender: sender?.tab?.id ? `tab:${sender.tab.id}` : 'extension'
      })

      switch (type) {
        case 'OFFSCREEN_PING':
          log('🏓 PING received:', msg)
          try {
            sendResponse?.({
              ok: true,
              pong: Date.now(),
              timestamp,
              status: isRecording ? 'recording' : 'idle'
            })
          } catch (e) {
            log('❌ Failed to send PING response:', e)
          }
          return true

        // ✅ Preload WebCodecs Worker when popup opens (for faster recording start)
        case 'OFFSCREEN_PRELOAD_WORKER':
          log(`⚡ [${timestamp}] PRELOAD_WORKER request`)
          try {
            preloadWebCodecsWorker()
            sendResponse?.({
              ok: true,
              preloaded: wcWorkerPreloaded || wcWorker !== null,
              timestamp
            })
          } catch (e) {
            log('❌ Failed to preload worker:', e)
            try {
              sendResponse?.({ ok: false, error: String(e), timestamp })
            } catch {}
          }
          return true

        case 'OFFSCREEN_START_RECORDING':
        case 'start-recording-offscreen': {
          const options = msg?.payload?.options || msg?.payload
          const tabStreamId = msg?.payload?.streamId

          log(`🎬 [${timestamp}] START_RECORDING request:`, {
            mode: options?.mode,
            currentlyRecording: isRecording,
            captureSource: tabStreamId ? 'tabCapture' : 'displayMedia'
          })

          ;(async () => {
            try {
              await startRecording(options, tabStreamId)
              log(`✅ [${timestamp}] Recording started successfully`)
              try {
                sendResponse?.({
                  ok: true,
                  message: tabStreamId
                    ? 'Recording started via tabCapture'
                    : 'Recording started via getDisplayMedia',
                  timestamp
                })
              } catch (e) {
                log('❌ Failed to send success response:', e)
              }
            } catch (e) {
              const error = getErrorMessage(e, 'Failed to start recording')
              const code = typeof (e as any)?.code === 'string' && (e as any).code.trim() ? (e as any).code : undefined
              log(`❌ [${timestamp}] Failed to start recording:`, error)
              try {
                sendResponse?.({
                  ok: false,
                  error,
                  ...(code ? { code } : {}),
                  timestamp
                })
              } catch (err) {
                log('❌ Failed to send error response:', err)
              }
            }
          })()
          return true
        }

        case 'OFFSCREEN_STOP_RECORDING':
          log(`🛑 [${timestamp}] STOP_RECORDING request`)
          log('[stop-share] offscreen: OFFSCREEN_STOP_RECORDING received')
          try {
            stopRecordingInternal()
            log(`✅ [${timestamp}] Recording stopped successfully`)
            try {
              sendResponse?.({
                ok: true,
                message: 'Recording stopped',
                timestamp
              })
            } catch (e) {
              log('❌ Failed to send stop response:', e)
            }
          } catch (e) {
            const error = String(e)
            log(`❌ [${timestamp}] Failed to stop recording:`, error)
            try {
              sendResponse?.({
                ok: false,
                error,
                timestamp
              })
            } catch (err) {
              log('❌ Failed to send error response:', err)
            }
          }
          return true

        case 'OFFSCREEN_TOGGLE_PAUSE': {
          const desired = (msg?.payload && typeof msg.payload.paused === 'boolean')
            ? !!msg.payload.paused
            : !isPaused
          isPaused = desired
          if (isPaused) {
            recordingDurationTracker.pause(performance.now())
            pauseBadgeTicker()
          } else {
            recordingDurationTracker.resume(performance.now())
            resumeBadgeTicker()
          }
          try { chrome.runtime.sendMessage({ type: 'STREAM_META', operationId: activeOperationId, meta: { paused: isPaused } }) } catch {}
          try { sendResponse?.({ ok: true, paused: isPaused }) } catch {}
          return true
        }


        case 'OFFSCREEN_GET_STATUS':
          log(`📊 [${timestamp}] STATUS request`)
          try {
            const status = {
              isRecording,
              isPaused,
              recordingStartTime,
              operationId: activeOperationId,
              currentStreamId: currentStream?.id,
              recordedChunks: recordedChunks.length,
              timestamp
            }
            sendResponse?.({ ok: true, status })
          } catch (e) {
            log('❌ Failed to send status response:', e)
            try {
              sendResponse?.({ ok: false, error: String(e) })
            } catch (err) {
              log('❌ Failed to send error response:', err)
            }
          }
          return true

        default:
          log(`❓ [${timestamp}] Unknown message type:`, type)
          return false
      }
    })

    log('✅ Message listener registered successfully')

  } catch (e) {
    log('❌ Failed to register message listener:', e)
  }

  // Listen for unload to clean up resources
  window.addEventListener('beforeunload', () => {
    if (isRecording) {
      stopRecordingInternal()
    }
  })
})()
