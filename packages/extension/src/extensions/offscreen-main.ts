// Enhanced Offscreen engine with MediaRecorder support
// Complete screen recording implementation with data handling

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
    try { chrome.runtime?.sendMessage({ type: 'BADGE_TICK', elapsedMs: 0, source: 'offscreen' }) } catch {}
    badgeTicker = setInterval(() => {
      if (!isRecording) return
      const extra = (!isPaused && badgeLastStart != null) ? Date.now() - badgeLastStart : 0
      const elapsedMs = badgeAccumMs + extra
      try { chrome.runtime?.sendMessage({ type: 'BADGE_TICK', elapsedMs, source: 'offscreen' }) } catch {}
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
    try { chrome.runtime?.sendMessage({ type: 'STREAM_WARNING', warning, code }) } catch {}
  }

  function emitStreamError(error: string, code?: string) {
    try { chrome.runtime?.sendMessage({ type: 'STREAM_ERROR', error, code }) } catch {}
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
    clearOpfsInitState()
  }

  function cleanupFailedStart() {
    try { stopBadgeTicker() } catch {}
    try { wcFrameLoopActive = false; wcWorker?.postMessage({ type: 'stop' }) } catch {}
    wcWorker = null
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
    return { codec: m.codec || 'vp8', width: metaW ?? 1920, height: metaH ?? 1080, fps: m.framerate || m.fps || 30 }
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
        if (d.type === 'ready') { opfsWriterReady = true; resolveOpfsInitIfPending(); flushOpfsPendingIfReady() }
        else if (d.type === 'warning') { handleOpfsWriterWarning(d) }
        else if (d.type === 'progress') { /* light log omitted */ }
        else if (d.type === 'error') { handleOpfsWriterFatalError(d) }
        else if (d.type === 'finalized') {
          try {
            log('[stop-share] offscreen: sending OPFS_RECORDING_READY')
            chrome.runtime?.sendMessage({ type: 'OPFS_RECORDING_READY', id: `rec_${d?.id ?? id}`, meta: opfsLastMeta })
          } catch {}
          clearOpfsInitState()
          try { opfsWriter?.terminate() } catch {}
          opfsWriter = null; opfsWriterReady = false; opfsSessionId = null; opfsLastMeta = null; opfsPendingChunks.length = 0; opfsEndPending = false
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
    if (opfsEndPending) { opfsEndPending = false; void finalizeOpfsWriter() }
  }

  function appendToOpfsChunk(d: { data: any; timestamp?: number; type?: string; isKeyframe?: boolean; codedWidth?: number; codedHeight?: number; codec?: string }) {
    if (!OPFS_WRITER_ENABLED) return
    if (!opfsWriter || !opfsWriterReady) {
      if (opfsPendingChunks.length >= OPFS_PENDING_CHUNKS_MAX) {
        console.warn(`[Offscreen][OPFS] Pending chunks queue full (${OPFS_PENDING_CHUNKS_MAX}), dropping oldest chunk`)
        opfsPendingChunks.shift()
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
    } catch (e) { log('[Offscreen][OPFS] append failed', e) }
  }

  async function finalizeOpfsWriter() {
    if (!opfsWriter) return
    const w = opfsWriter
    try {
      await new Promise<void>((resolve) => {
        let settled = false
        const onMsg = (ev: MessageEvent) => { const t = (ev.data || {}).type; if (t === 'finalized' || t === 'error') { if (!settled) { settled = true; try { w.removeEventListener('message', onMsg as any) } catch {}; resolve() } } }
        try { w.addEventListener('message', onMsg as any) } catch {}
        try { w.postMessage({ type: 'finalize' }) } catch {}
        setTimeout(() => { if (!settled) { settled = true; try { w.removeEventListener('message', onMsg as any) } catch {}; resolve() } }, 1500)
      })
    } catch (e) { log('[Offscreen][OPFS] finalize failed', e) }
    finally { try { w.terminate() } catch {}; if (opfsWriter === w) { opfsWriter = null; opfsWriterReady = false; opfsSessionId = null } }
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
  async function getDisplayMediaStream(mode: 'tab' | 'window' | 'screen' = 'screen'): Promise<MediaStream> {
    log('🎥 Requesting display media directly in offscreen document...', { mode })

    try {
      // 根据模式配置 getDisplayMedia 选项
      const displayMediaOptions: any = {
        video: {
          // 根据模式设置默认的显示表面类型
          ...(mode === 'screen' && {
            displaySurface: 'monitor',
            // 优先显示屏幕选项
            monitorTypeSurfaces: 'include',
            selfBrowserSurface: 'exclude'
          }),
          ...(mode === 'window' && {
            displaySurface: 'window',
            selfBrowserSurface: 'exclude'
          }),
          ...(mode === 'tab' && {
            displaySurface: 'browser',
            // preferCurrentTab: true,
            selfBrowserSurface: 'exclude'
          })
        },
        audio: false,
        // 根据模式设置顶级选项
        // ...(mode === 'tab' && { preferCurrentTab: true }),
        ...(mode === 'screen' && {
          selfBrowserSurface: 'exclude',
          monitorTypeSurfaces: 'include'
        })
      }

      log('📋 Display media options:', displayMediaOptions)

      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)

      if (!stream) {
        throw new Error('getDisplayMedia returned null stream')
      }

      const videoTracks = stream.getVideoTracks()
      const audioTracks = stream.getAudioTracks()

      log('📺 Display media stream obtained successfully:', {
        id: stream.id,
        videoTracks: videoTracks.length,
        audioTracks: audioTracks.length,
        videoLabel: videoTracks[0]?.label,
        videoState: videoTracks[0]?.readyState
      })

      return stream

    } catch (error) {
      log('❌ Error getting display media:', error)

      // 提供更详细的错误信息
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`User cancelled screen sharing: ${error.message}`)
        } else if (error.name === 'NotAllowedError') {
          throw new Error(`Permission denied for screen sharing: ${error.message}`)
        } else if (error.name === 'NotFoundError') {
          throw new Error(`No display media source found: ${error.message}`)
        } else if (error.name === 'NotSupportedError') {
          throw new Error(`getDisplayMedia not supported: ${error.message}`)
        } else {
          throw new Error(`getDisplayMedia failed: ${error.name} - ${error.message}`)
        }
      } else {
        throw new Error(`Unknown error getting display media: ${error}`)
      }
    }
  }

  async function startRecording(options?: any): Promise<void> {
    const timestamp = new Date().toISOString()
    log(`🎯 [${timestamp}] Starting recording directly in offscreen document...`, { options })

    // Guard against concurrent start requests
    if (isStarting) {
      log('⚠️ Recording start already in progress, rejecting duplicate request')
      throw createErrorWithCode('Recording start already in progress', 'START_ALREADY_IN_PROGRESS')
    }
    isStarting = true

    try {
      // Stop any existing recording
      if (isRecording) {
        log('🛑 Stopping existing recording before starting new one')
        stopRecordingInternal()
      }

      // 提取录制模式，默认为 screen
      const mode = options?.mode || 'screen'
      log(`📺 Recording mode: ${mode}`)

      // 1) Get the media stream directly through getDisplayMedia with mode-specific options
      const stream = await getDisplayMediaStream(mode)
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

      // 3) Derive encoding parameters from track settings
      const settings = (videoTrack as any)?.getSettings?.() || {}
      let width = settings.width || 1920
      let height = settings.height || 1080
      const framerate = Math.round(settings.frameRate || 30)
      const bitrate = options?.bitrate || 8_000_000 // 8 Mbps default

      // 4) Create MediaStreamTrackProcessor
      const ProcessorCtor: any = (window as any).MediaStreamTrackProcessor
      const processor = new ProcessorCtor({ track: videoTrack })
      const reader: ReadableStreamDefaultReader<VideoFrame> = processor.readable.getReader()
      wcReader = reader

      // 5) Create or reuse preloaded WebCodecs Worker
      const wasPreloaded = wcWorker !== null && wcWorkerPreloaded
      if (!wcWorker) {
        log('🔧 Creating new WebCodecs Worker (not preloaded)')
        wcWorker = new Worker(new URL('../lib/workers/webcodecs-worker.ts', import.meta.url), { type: 'module' })
      } else {
        log('⚡ Reusing preloaded WebCodecs Worker')
      }
      wcWorkerPreloaded = false  // Reset preload flag as we're now using it for recording

      let configuredEncoderConfig: any = null
      let resolveConfigured: (() => void) | null = null
      const waitForConfigured = new Promise<void>((res) => { resolveConfigured = res })
      recordedChunks = []
      recordingStartTime = Date.now()

      wcWorker.onmessage = (evt: MessageEvent) => {
        const { type, data, config } = (evt.data || {})
        switch (type) {
          case 'initialized':
            log(`👷 WebCodecs worker initialized${wasPreloaded ? ' (was preloaded)' : ''}`)
            break
          case 'configured':
            configuredEncoderConfig = config
            try { resolveConfigured?.(); resolveConfigured = null } catch {}
            log('✅ WebCodecs worker configured:', config)
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
            try {
              chrome.runtime.sendMessage({ type: 'STREAM_ERROR', error: String(data) })
            } catch {}
            break
          case 'complete':
            try {
              log('🎞️ WebCodecs encoding complete')
              const stopTs = new Date().toISOString()
              const duration = recordingStartTime ? Date.now() - recordingStartTime : 0

              // ✅ 延迟100ms确保所有chunks到达OPFS Writer
              setTimeout(() => {
                try {
                  if (OPFS_WRITER_ENABLED) {
                    if (!opfsWriterReady || opfsPendingChunks.length > 0) {
                      log(`⏳ OPFS not ready or has pending chunks (${opfsPendingChunks.length}), deferring finalize`)
                      opfsEndPending = true
                    } else {
                      log('✅ Finalizing OPFS writer')
                      void finalizeOpfsWriter()
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

      wcWorker.postMessage({ type: 'configure', config: { width, height, bitrate, framerate } })

      // Wait until worker confirms configured to avoid unconfigured encode errors
      await waitForConfigured
      if (OPFS_WRITER_ENABLED) {
        await initOpfsWriter({ codec: configuredEncoderConfig?.codec, width, height, framerate })
      }
      // Global pre-start countdown for all modes to avoid early layout shifts and unify UX
      // After user grants capture (stream available), open centralized countdown via background
      const COUNTDOWN_SECONDS = (typeof options?.countdown === 'number' && options.countdown >= 1 && options.countdown <= 5) ? options.countdown : 3;
      try { chrome.runtime.sendMessage({ type: 'STREAM_META', meta: { preparing: true, countdown: COUNTDOWN_SECONDS, mode } }) } catch {}
      // Wait for unified countdown gate from background (use dynamic timeout based on configured countdown)
      await new Promise((resolve) => {
        const to = setTimeout(resolve, (COUNTDOWN_SECONDS + 2) * 1000);
        function onMsg(msg: any) { if (msg?.type === 'COUNTDOWN_DONE_BROADCAST') { try { clearTimeout(to) } catch {}; try { chrome.runtime.onMessage.removeListener(onMsg) } catch {}; resolve(null); } }
        try { chrome.runtime.onMessage.addListener(onMsg) } catch {}
      })
      // Extra guard to avoid capturing the last compositor frame of countdown window
      await new Promise((r) => setTimeout(r, 140));

      // 6) Start frame processing loop
      isPaused = false
      wcFrameLoopActive = true
      isRecording = true

      // Start badge elapsed ticker for action button
      startBadgeTicker()

      // Notify service worker (engine: webcodecs)
      try {
        chrome.runtime.sendMessage({
          type: 'STREAM_START',
          mode: mode,
          metadata: { engine: 'webcodecs', width, height, framerate, bitrate, startTime: recordingStartTime }
        })
      } catch {}

      let frameIndex = 0
      const keyEvery = Math.max(1, framerate * 2) // force keyframe every 2 seconds
      ;(async () => {
        try {
          while (wcFrameLoopActive) {
            const { value: frame, done } = await reader.read()
            if (done || !frame) break
            if (isPaused) { try { frame.close() } catch {}
              continue }

            // On first frame, check actual dimensions and reconfigure encoder if needed
            // This fixes aspect ratio distortion when track.getSettings() dimensions
            // don't match actual VideoFrame dimensions (common in tab capture)
            if (frameIndex === 0) {
              const fw = (frame as any).displayWidth || (frame as any).codedWidth
              const fh = (frame as any).displayHeight || (frame as any).codedHeight
              if (fw && fh && (fw !== width || fh !== height)) {
                log(`🔧 Frame dimensions (${fw}x${fh}) differ from track settings (${width}x${height}), reconfiguring encoder`)
                width = fw
                height = fh
                wcWorker?.postMessage({ type: 'configure', config: { width: fw, height: fh, bitrate, framerate } })
                // Drop this frame to allow reconfiguration to complete before encoding
                // Don't increment frameIndex so the next frame is still treated as first (keyframe)
                try { (frame as any).close() } catch {}
                continue
              }
            }

            const keyFrame = frameIndex === 0 || (frameIndex % keyEvery === 0)
            wcWorker?.postMessage({ type: 'encode', frame, keyFrame }, [frame])
            frameIndex++
          }
        } catch (err) {
          log('❌ Frame loop error:', err)
        }
      })()

      log(`✅ [${timestamp}] Recording started successfully:`, {
        engine: 'webcodecs', width, height, framerate, bitrate, chunkStrategy: 'frame-stream'
      })

    } catch (e) {
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
      // Stop badge ticker first so background stops updating time
      try { stopBadgeTicker() } catch {}
      // Stop WebCodecs pipeline (if active)
      try { wcFrameLoopActive = false; wcWorker?.postMessage({ type: 'stop' }) } catch (e) { log('❌ Error posting stop to WebCodecs worker:', e) }
      wcWorker = null
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
        chrome.runtime.sendMessage({ type: 'STREAM_END' })
      } catch {
        log('[stop-share] offscreen: failed to send STREAM_END')
      }

    } catch (e) {
      log('❌ Error during recording cleanup:', e)
      try {
        log('[stop-share] offscreen: sending STREAM_END (error path)')
        chrome.runtime.sendMessage({ type: 'STREAM_END' })
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

          log(`🎬 [${timestamp}] START_RECORDING request:`, {
            options,
            currentlyRecording: isRecording,
            message: 'Will request display media directly in offscreen'
          })

          // Start recording asynchronously - no streamId needed
          ;(async () => {
            try {
              await startRecording(options)
              log(`✅ [${timestamp}] Recording started successfully`)
              try {
                sendResponse?.({
                  ok: true,
                  message: 'Recording started via getDisplayMedia',
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
            pauseBadgeTicker()
          } else {
            resumeBadgeTicker()
          }
          try { chrome.runtime.sendMessage({ type: 'STREAM_META', meta: { paused: isPaused } }) } catch {}
          try { sendResponse?.({ ok: true, paused: isPaused }) } catch {}
          return true
        }


        case 'OFFSCREEN_GET_STATUS':
          log(`📊 [${timestamp}] STATUS request`)
          try {
            const status = {
              isRecording,
              recordingStartTime,
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

