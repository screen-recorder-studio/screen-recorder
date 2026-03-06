<script lang="ts">
  import { onMount } from 'svelte'
  import { Play, Square, LoaderCircle, CircleAlert, HardDrive, Video, AlertTriangle } from '@lucide/svelte'
  import { _t } from '$lib/utils/i18n'

  // Recording state machine: 'idle' | 'preparing' | 'recording' | 'stopping' | 'error'
  let phase = $state<'idle' | 'preparing' | 'recording' | 'stopping' | 'error'>('idle')
  let errorMessage = $state('')

  // i18n fallback messages (loaded from /_locales/{lang}/messages.json)
  let fallbackMessages = $state<Record<string, string>>({})
  let langLoaded = $state(false)

  // Worker references
  let webcodecWorker: Worker | null = null
  let opfsWriterWorker: Worker | null = null
  let mediaStream: MediaStream | null = null
  let frameReader: ReadableStreamDefaultReader<VideoFrame> | null = null
  let frameLoopActive = false

  // Recording metadata
  let recordingId = ''
  let recordingStartTime = 0
  let frameIndex = 0
  let encoderConfigured = false
  let opfsReady = false
  let videoWidth = 1920
  let videoHeight = 1080
  let videoFramerate = 30

  // Helper function: translate with fallback
  function t(key: string, subs?: string | string[]): string {
    return _t(key, subs, fallbackMessages)
  }

  // Parse language from URL or use browser language
  function detectLanguage(): string {
    const params = new URLSearchParams(window.location.search)
    const urlLang = params.get('l')
    if (urlLang) return urlLang

    // Fallback to browser language
    const browserLang = navigator.language || (navigator as any).userLanguage || 'en'
    // Map common browser language codes to our locale folder names
    const langMap: Record<string, string> = {
      'zh-CN': 'zh_CN',
      'zh-TW': 'zh_TW',
      'zh': 'zh_CN',
      'pt-BR': 'pt_BR',
      'pt': 'pt_BR'
    }
    const base = browserLang.split('-')[0]
    return langMap[browserLang] || langMap[base] || base || 'en'
  }

  // Load locale messages and convert Chrome i18n format to flat object
  async function loadLocaleMessages(lang: string): Promise<Record<string, string>> {
    try {
      const response = await fetch(`/_locales/${lang}/messages.json`)
      if (!response.ok) {
        // Fallback to English if language not found
        if (lang !== 'en') {
          console.warn(`Locale ${lang} not found, falling back to English`)
          return loadLocaleMessages('en')
        }
        return {}
      }
      const chromeFormat = await response.json()
      // Convert Chrome i18n format { "key": { "message": "Text" } } to flat { "key": "Text" }
      const flat: Record<string, string> = {}
      for (const key in chromeFormat) {
        if (chromeFormat[key]?.message) {
          flat[key] = chromeFormat[key].message
        }
      }
      return flat
    } catch (e) {
      console.error('Failed to load locale messages:', e)
      if (lang !== 'en') {
        return loadLocaleMessages('en')
      }
      return {}
    }
  }

  // Check if running in secure context (required for getDisplayMedia)
  function isSecureContext(): boolean {
    return window.isSecureContext === true
  }

  // Check if WebCodecs and getDisplayMedia are supported
  function checkAPISupport(): { supported: boolean; reason?: string } {
    if (!isSecureContext()) {
      return { supported: false, reason: t('webRecord_errorInsecure') }
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      return { supported: false, reason: t('webRecord_errorNoDisplayMedia') }
    }
    if (typeof VideoEncoder === 'undefined') {
      return { supported: false, reason: t('webRecord_errorNoWebCodecs') }
    }
    if (typeof (window as any).MediaStreamTrackProcessor === 'undefined') {
      return { supported: false, reason: t('webRecord_errorNoTrackProcessor') }
    }
    if (!navigator.storage?.getDirectory) {
      return { supported: false, reason: t('webRecord_errorNoOPFS') }
    }
    return { supported: true }
  }

  // Generate unique recording ID
  function generateRecordingId(): string {
    return `${Date.now()}`
  }

  // Start recording
  async function startRecording() {
    if (phase !== 'idle') return

    // Check API support first
    const support = checkAPISupport()
    if (!support.supported) {
      phase = 'error'
      errorMessage = support.reason || t('webRecord_errorGeneric')
      return
    }

    phase = 'preparing'
    errorMessage = ''
    recordingId = generateRecordingId()
    recordingStartTime = Date.now()
    frameIndex = 0
    encoderConfigured = false
    opfsReady = false

    try {
      // 1. Request display media
      mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      })

      const videoTrack = mediaStream.getVideoTracks()[0]
      if (!videoTrack) {
        throw new Error(t('webRecord_errorNoVideoTrack'))
      }

      // Get video settings
      const settings = videoTrack.getSettings()
      videoWidth = settings.width || 1920
      videoHeight = settings.height || 1080
      videoFramerate = Math.round(settings.frameRate || 30)

      // Handle track ended (user stopped sharing)
      videoTrack.onended = () => {
        console.log('[WebRecord] Video track ended by user')
        stopRecording()
      }

      // 2. Create OPFS Writer Worker
      opfsWriterWorker = new Worker(
        new URL('$lib/workers/opfs-writer-worker.ts', import.meta.url),
        { type: 'module' }
      )

      // Wait for OPFS ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('OPFS init timeout')), 5000)
        opfsWriterWorker!.onmessage = (ev) => {
          const { type } = ev.data || {}
          if (type === 'ready') {
            clearTimeout(timeout)
            opfsReady = true
            resolve()
          } else if (type === 'error') {
            clearTimeout(timeout)
            reject(new Error(ev.data?.message || 'OPFS error'))
          }
        }
        opfsWriterWorker!.postMessage({
          type: 'init',
          id: recordingId,
          meta: {
            codec: 'auto',
            width: videoWidth,
            height: videoHeight,
            fps: videoFramerate
          }
        })
      })

      // 3. Create WebCodecs Worker
      webcodecWorker = new Worker(
        new URL('$lib/workers/webcodecs-worker.ts', import.meta.url),
        { type: 'module' }
      )

      // Handle WebCodecs worker messages
      webcodecWorker.onmessage = (ev) => {
        const { type, data, config } = ev.data || {}

        if (type === 'configured') {
          console.log('[WebRecord] Encoder configured:', config)
          encoderConfigured = true
        } else if (type === 'chunk') {
          // Forward encoded chunk to OPFS writer
          if (data && opfsWriterWorker && opfsReady) {
            const chunkType = data.chunkType || data.type || 'delta'
            const isKeyframe = data.isKeyframe === true || chunkType === 'key'
            
            // Convert data to ArrayBuffer if needed
            let buffer: ArrayBuffer
            if (data.data instanceof ArrayBuffer) {
              buffer = data.data
            } else if (data.data instanceof Uint8Array) {
              buffer = data.data.buffer.slice(
                data.data.byteOffset,
                data.data.byteOffset + data.data.byteLength
              )
            } else {
              // Create a copy
              const u8 = new Uint8Array(data.data)
              buffer = u8.buffer
            }

            opfsWriterWorker.postMessage({
              type: 'append',
              buffer,
              timestamp: data.timestamp, // Already in microseconds from WebCodecs
              chunkType,
              codedWidth: data.codedWidth || videoWidth,
              codedHeight: data.codedHeight || videoHeight,
              codec: data.codec || config?.codec || 'vp8',
              isKeyframe
            }, [buffer])
          }
        } else if (type === 'complete') {
          console.log('[WebRecord] Encoding complete')
          finalizeRecording()
        } else if (type === 'error') {
          console.error('[WebRecord] Encoder error:', data)
          handleError(data || t('webRecord_errorEncoding'))
        }
      }

      // Configure encoder and wait
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Encoder config timeout')), 5000)
        const worker = webcodecWorker!
        const origHandler = worker.onmessage
        worker.onmessage = (ev) => {
          if (ev.data?.type === 'configured') {
            clearTimeout(timeout)
            resolve()
          }
          origHandler?.call(worker, ev)
        }
        worker.postMessage({
          type: 'configure',
          config: {
            width: videoWidth,
            height: videoHeight,
            framerate: videoFramerate,
            bitrate: 8_000_000
          }
        })
      })

      // 4. Create MediaStreamTrackProcessor
      const ProcessorCtor = (window as any).MediaStreamTrackProcessor
      const processor = new ProcessorCtor({ track: videoTrack })
      frameReader = processor.readable.getReader()

      // 5. Start frame loop
      frameLoopActive = true
      phase = 'recording'

      const keyEvery = Math.max(1, videoFramerate * 2) // Keyframe every 2 seconds
      ;(async () => {
        try {
          while (frameLoopActive) {
            const { value: frame, done } = await frameReader!.read()
            if (done || !frame) break
            
            const keyFrame = frameIndex === 0 || (frameIndex % keyEvery === 0)
            webcodecWorker?.postMessage({ type: 'encode', frame, keyFrame }, [frame as any])
            frameIndex++
          }
        } catch (err) {
          console.error('[WebRecord] Frame loop error:', err)
          if (phase === 'recording') {
            handleError(String(err))
          }
        }
      })()

      console.log('[WebRecord] Recording started:', {
        id: recordingId,
        width: videoWidth,
        height: videoHeight,
        fps: videoFramerate
      })

    } catch (err: any) {
      console.error('[WebRecord] Failed to start recording:', err)
      cleanup()
      
      // Handle specific errors
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
        phase = 'idle'
        errorMessage = t('webRecord_errorPermissionDenied')
      } else {
        phase = 'error'
        errorMessage = err.message || t('webRecord_errorGeneric')
      }
    }
  }

  // Stop recording
  async function stopRecording() {
    if (phase !== 'recording') return

    phase = 'stopping'
    frameLoopActive = false

    try {
      // Stop frame processing
      try {
        frameReader?.cancel()
      } catch {}
      frameReader = null

      // Stop media tracks
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
          try { track.stop() } catch {}
        })
        mediaStream = null
      }

      // Flush and stop encoder
      if (webcodecWorker) {
        webcodecWorker.postMessage({ type: 'stop' })
        // Wait for 'complete' message handled in onmessage
      } else {
        // No encoder, just finalize
        finalizeRecording()
      }
    } catch (err) {
      console.error('[WebRecord] Error stopping recording:', err)
      finalizeRecording()
    }
  }

  // Finalize recording (called after encoder completes)
  async function finalizeRecording() {
    try {
      // Finalize OPFS
      if (opfsWriterWorker) {
        const writer = opfsWriterWorker
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 3000)
          const origHandler = writer.onmessage
          writer.onmessage = (ev) => {
            if (ev.data?.type === 'finalized') {
              clearTimeout(timeout)
              resolve()
            }
            origHandler?.call(writer, ev)
          }
          writer.postMessage({ type: 'finalize' })
        })
      }
    } catch (err) {
      console.error('[WebRecord] Error finalizing OPFS:', err)
    } finally {
      cleanup()
      phase = 'idle'
      console.log('[WebRecord] Recording finalized:', recordingId)
    }
  }

  // Handle errors during recording
  function handleError(message: string) {
    console.error('[WebRecord] Error:', message)
    cleanup()
    phase = 'error'
    errorMessage = message
  }

  // Cleanup resources
  function cleanup() {
    frameLoopActive = false

    try { frameReader?.cancel() } catch {}
    frameReader = null

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => {
        try { track.stop() } catch {}
      })
      mediaStream = null
    }

    try { webcodecWorker?.terminate() } catch {}
    webcodecWorker = null

    try { opfsWriterWorker?.terminate() } catch {}
    opfsWriterWorker = null
  }

  // Open Drive page
  function openDrive() {
    const lang = detectLanguage()
    window.open(`/drive.html?l=${lang}`, '_blank')
  }

  // Initialize
  onMount(() => {
    const lang = detectLanguage()
    console.log('[WebRecord] Detected language:', lang)
    loadLocaleMessages(lang).then((messages) => {
      fallbackMessages = messages
      langLoaded = true

      // Check API support on load
      const support = checkAPISupport()
      if (!support.supported) {
        phase = 'error'
        errorMessage = support.reason || t('webRecord_errorGeneric')
      }
    })

    return () => {
      cleanup()
    }
  })
</script>

<svelte:head>
  <title>{t('webRecord_pageTitle')}</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 font-sans">
  <!-- Header -->
  <div class="bg-white border-b border-gray-200 px-4 py-3">
    <div class="max-w-xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Video class="w-6 h-6 text-blue-600" />
        <h1 class="text-xl font-bold text-gray-800">{t('webRecord_headerTitle')}</h1>
      </div>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 group text-sm"
        onclick={openDrive}
        title={t('webRecord_openDriveTooltip')}
      >
        <HardDrive class="w-4 h-4 text-gray-600 group-hover:text-blue-600 transition-colors" />
        <span class="text-gray-600 group-hover:text-blue-600 transition-colors">{t('webRecord_driveBtn')}</span>
      </button>
    </div>
  </div>

  <!-- Main content -->
  <div class="max-w-xl mx-auto p-6">
    <!-- Error state -->
    {#if phase === 'error'}
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
        <div class="flex items-start gap-3">
          <AlertTriangle class="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 class="font-medium text-red-800">{t('webRecord_errorTitle')}</h3>
            <p class="text-sm text-red-700 mt-1">{errorMessage}</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Status card -->
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
      <!-- Status indicator -->
      <div class="flex items-center justify-center mb-6">
        {#if phase === 'recording'}
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>
            <span class="text-lg font-medium text-red-700">{t('webRecord_statusRecording')}</span>
          </div>
        {:else if phase === 'preparing' || phase === 'stopping'}
          <div class="flex items-center gap-3">
            <LoaderCircle class="w-5 h-5 text-orange-600 animate-spin" />
            <span class="text-lg font-medium text-orange-700">
              {phase === 'preparing' ? t('webRecord_statusPreparing') : t('webRecord_statusStopping')}
            </span>
          </div>
        {:else}
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 bg-gray-300 rounded-full"></div>
            <span class="text-lg font-medium text-gray-600">{t('webRecord_statusIdle')}</span>
          </div>
        {/if}
      </div>

      <!-- Control buttons -->
      <div class="space-y-3">
        {#if phase === 'idle' || phase === 'error'}
          <button
            class="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={startRecording}
            disabled={!langLoaded}
          >
            <Play class="w-5 h-5" />
            <span>{t('webRecord_btnStart')}</span>
          </button>
        {:else if phase === 'recording'}
          <button
            class="w-full flex items-center justify-center gap-3 px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            onclick={stopRecording}
          >
            <Square class="w-5 h-5" />
            <span>{t('webRecord_btnStop')}</span>
          </button>
        {:else}
          <!-- preparing or stopping -->
          <button
            class="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gray-400 text-white rounded-lg font-medium cursor-not-allowed"
            disabled
          >
            <LoaderCircle class="w-5 h-5 animate-spin" />
            <span>{phase === 'preparing' ? t('webRecord_btnPreparing') : t('webRecord_btnStopping')}</span>
          </button>
        {/if}
      </div>
    </div>

    <!-- Tips -->
    <div class="bg-blue-50 rounded-lg border border-blue-200 p-4">
      <div class="flex items-start gap-3">
        <CircleAlert class="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div class="text-sm text-blue-700">
          <p class="font-medium mb-1">{t('webRecord_tipsTitle')}</p>
          <ul class="list-disc list-inside space-y-1 text-blue-600">
            <li>{t('webRecord_tip1')}</li>
            <li>{t('webRecord_tip2')}</li>
            <li>{t('webRecord_tip3')}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</div>
