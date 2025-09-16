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

  // WebCodecs pipeline state
  let wcWorker: Worker | null = null
  let wcReader: ReadableStreamDefaultReader<VideoFrame> | null = null
  let wcFrameLoopActive = false

  // OPFS writer (side-write) state
  const OPFS_WRITER_ENABLED = true
  let opfsWriter: Worker | null = null
  let opfsWriterReady = false
  let opfsSessionId: string | null = null
  let opfsLastMeta: any = null
  const opfsPendingChunks: Array<{ data: any; timestamp?: number; type?: string; codedWidth?: number; codedHeight?: number; codec?: string }> = []
  let opfsEndPending = false

  function ensureOpfsSessionId() { if (!opfsSessionId) opfsSessionId = `${Date.now()}`; return opfsSessionId }

  function normalizeMeta(m: any) {
    if (!m) return {} as any
    const metaW = (typeof m.width === 'number') ? m.width : (m.codedWidth)
    const metaH = (typeof m.height === 'number') ? m.height : (m.codedHeight)
    return { codec: m.codec || 'vp8', width: metaW ?? 1920, height: metaH ?? 1080, fps: m.framerate || m.fps || 30 }
  }

  function initOpfsWriter(meta?: any) {
    if (!OPFS_WRITER_ENABLED) return
    if (opfsWriter) return
    opfsWriterReady = false
    opfsLastMeta = normalizeMeta(meta || opfsLastMeta)
    try {
      opfsWriter = new Worker(new URL('../lib/workers/opfs-writer-worker.ts', import.meta.url), { type: 'module' })
      const id = ensureOpfsSessionId()
      opfsWriter.onmessage = (ev: MessageEvent) => {
        const d: any = ev.data || {}
        if (d.type === 'ready') { opfsWriterReady = true; flushOpfsPendingIfReady() }
        else if (d.type === 'progress') { /* light log omitted */ }
        else if (d.type === 'finalized') {
          try {
            log('[stop-share] offscreen: sending OPFS_RECORDING_READY')
            chrome.runtime?.sendMessage({ type: 'OPFS_RECORDING_READY', id: `rec_${d?.id ?? id}`, meta: opfsLastMeta })
          } catch {}
          try { opfsWriter?.terminate() } catch {}
          opfsWriter = null; opfsWriterReady = false; opfsSessionId = null
        }
      }
      opfsWriter.postMessage({ type: 'init', id, meta: opfsLastMeta })
    } catch (e) {
      log('[Offscreen][OPFS] failed to start writer', e)
      opfsWriter = null; opfsWriterReady = false
    }
  }

  function flushOpfsPendingIfReady() {
    if (!opfsWriter || !opfsWriterReady) return
    while (opfsPendingChunks.length) { const c = opfsPendingChunks.shift()!; appendToOpfsChunk(c) }
    if (opfsEndPending) { opfsEndPending = false; void finalizeOpfsWriter() }
  }

  function appendToOpfsChunk(d: { data: any; timestamp?: number; type?: string; codedWidth?: number; codedHeight?: number; codec?: string }) {
    if (!OPFS_WRITER_ENABLED) return
    if (!opfsWriter || !opfsWriterReady) { opfsPendingChunks.push(d); return }
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
      opfsWriter!.postMessage({ type: 'append', buffer: transferBuf, timestamp: d.timestamp || 0, chunkType: d.type === 'key' ? 'key' : 'delta', codedWidth: d.codedWidth || opfsLastMeta?.width, codedHeight: d.codedHeight || opfsLastMeta?.height, codec: d.codec || opfsLastMeta?.codec, isKeyframe: d.type === 'key' }, [transferBuf])
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
      const width = settings.width || 1920
      const height = settings.height || 1080
      const framerate = Math.round(settings.frameRate || 30)
      const bitrate = options?.bitrate || 8_000_000 // 8 Mbps default

      // 4) Create MediaStreamTrackProcessor
      const ProcessorCtor: any = (window as any).MediaStreamTrackProcessor
      const processor = new ProcessorCtor({ track: videoTrack })
      const reader: ReadableStreamDefaultReader<VideoFrame> = processor.readable.getReader()
      wcReader = reader

      // 5) Create and configure WebCodecs Worker
      wcWorker = new Worker(new URL('../lib/workers/webcodecs-worker.ts', import.meta.url), { type: 'module' })

      let configured = false
      let resolveConfigured: (() => void) | null = null
      const waitForConfigured = new Promise<void>((res) => { resolveConfigured = res })
      recordedChunks = []
      recordingStartTime = Date.now()

      wcWorker.onmessage = (evt: MessageEvent) => {
        const { type, data, config } = (evt.data || {})
        switch (type) {
          case 'initialized':
            log('👷 WebCodecs worker initialized')
            break
          case 'configured':
            configured = true
            try { resolveConfigured?.(); resolveConfigured = null } catch {}
            log('✅ WebCodecs worker configured:', config)
            try { if (OPFS_WRITER_ENABLED) initOpfsWriter({ codec: config?.codec, width: config?.width, height: config?.height, framerate }) } catch {}
            break
          case 'chunk': {
            // track chunk meta count; avoid retaining big buffers here to save memory
            if (data) {
              recordedChunks.push({ size: data.size, ts: data.timestamp, type: data.type })
              try {
                chrome.runtime.sendMessage({
                  type: 'STREAM_CHUNK_INFO',
                  meta: { index: recordedChunks.length, size: data.size, ts: data.timestamp, type: data.type }
                })
              } catch {}
              try {
                // Side-write to OPFS
                appendToOpfsChunk({
                  data: data.data,
                  timestamp: data.timestamp,
                  type: data.type,
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
              const finalU8: Uint8Array = data
              log('🎞️ WebCodecs final data received:', { bytes: finalU8?.byteLength })
              const _copy = new Uint8Array(finalU8.byteLength); _copy.set(finalU8); const finalBlob = new Blob([_copy], { type: 'video/webm' })
              const stopTs = new Date().toISOString()
              const duration = recordingStartTime ? Date.now() - recordingStartTime : 0

              // Request OPFS finalize
              try {
                if (OPFS_WRITER_ENABLED) {
                  if (!opfsWriterReady || opfsPendingChunks.length > 0) {
                    opfsEndPending = true
                  } else {
                    void finalizeOpfsWriter()
                  }
                }
              } catch {}

              const readerFR = new FileReader()
              readerFR.onloadend = () => {
                try {
                  log('[stop-share] offscreen: sending RECORDING_COMPLETE')
                  chrome.runtime.sendMessage({
                    type: 'RECORDING_COMPLETE',
                    target: 'service-worker',
                    data: {
                      videoBlob: readerFR.result, // Base64 encoded
                      metadata: {
                        size: finalBlob.size,
                        type: finalBlob.type,
                        duration,
                        chunks: recordedChunks.length,
                        timestamp: stopTs,
                        engine: 'webcodecs',
                        width,
                        height,
                        framerate
                      }
                    }
                  })
                } catch {}
              }
              readerFR.readAsDataURL(finalBlob)
            } catch (e) {
              log('❌ Failed to process final WebCodecs data:', e)
            }
            break
        }
      }

      wcWorker.postMessage({ type: 'configure', config: { width, height, bitrate, framerate } })

      // Wait until worker confirms configured to avoid unconfigured encode errors
      await waitForConfigured
      log('🟢 Worker configured confirmed, starting frame loop')

      // 6) Start frame processing loop
      isPaused = false
      wcFrameLoopActive = true
      isRecording = true

      // Notify service worker (engine: webcodecs)
      try {
        chrome.runtime.sendMessage({
          type: 'STREAM_START',
          mode: 'screen',
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
      recordingStartTime = null
      try {
        chrome.runtime.sendMessage({
          type: 'STREAM_ERROR',
          error: String(e)
        })
      } catch {}
      throw e
    }
  }

  function stopRecordingInternal(): void {
    const timestamp = new Date().toISOString()
    log(`🛑 [${timestamp}] Stopping recording...`)
    log('[stop-share] offscreen: stopRecordingInternal invoked')

    try {
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
              const error = String(e)
              log(`❌ [${timestamp}] Failed to start recording:`, error)
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
    log('🧹 Offscreen document unloading, cleaning up...')
    if (isRecording) {
      stopRecordingInternal()
    }
  })

  // Periodic status reporting (optional)
  setInterval(() => {
    if (isRecording && recordingStartTime) {
      const duration = Date.now() - recordingStartTime
      log(`⏱️ Recording status: ${(duration / 1000).toFixed(1)}s, ${recordedChunks.length} chunks`)
    }
  }, 10000) // Every 10 seconds
})()

