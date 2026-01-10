<script lang="ts">
  export const ssr = false

  import { browser } from '$app/environment'
  import { onDestroy, onMount } from 'svelte'
  import { _t } from '$lib/utils/i18n'

  type Status = 'idle' | 'preparing' | 'recording' | 'stopping' | 'error'

  type ChunkPayload =
    | ArrayBuffer
    | Uint8Array
    | ArrayBufferView
    | Blob
    | { copyTo: (dest: Uint8Array) => void; byteLength: number }

  type ChunkMessage = {
    data: ChunkPayload
    timestamp?: number
    type?: string
    chunkType?: string
    isKeyframe?: boolean
    codedWidth?: number
    codedHeight?: number
    codec?: string
  }

  type WriterMeta = {
    codec?: string
    width?: number
    height?: number
    codedWidth?: number
    codedHeight?: number
    fps?: number
    framerate?: number
  }

  const CONFIG_TIMEOUT_MS = 10_000
  const DEFAULT_BITRATE = 8_000_000
  const routePath = '/web-record'

  let status: Status = 'idle'
  let errorMessage = ''
  let infoMessage = ''
  let messages: Record<string, string> = {}
  let lang = 'en'

  let stream: MediaStream | null = null
  let reader: ReadableStreamDefaultReader<VideoFrame> | null = null
  let wcWorker: Worker | null = null
  let writer: Worker | null = null
  let writerReady = false
  let pendingChunks: ChunkMessage[] = []
  let finalizeRequested = false
  let frameLoopActive = false
  let recordingId = ''
  let currentMeta = { width: 1920, height: 1080, fps: 30, codec: 'vp8' }

  const sanitizeLang = (value: string | null) =>
    value ? value.toLowerCase().replace(/[^a-z-]/g, '') : ''

  async function fetchLocale(target: string) {
    try {
      const res = await fetch(`/_locales/${target}/messages.json`)
      if (!res.ok) throw new Error('locale not found')
      const raw = await res.json()
      const flat: Record<string, string> = {}
      Object.entries(raw || {}).forEach(([key, val]) => {
        if (val && typeof val === 'object' && typeof (val as any).message === 'string') {
          flat[key] = (val as any).message
        }
      })
      return flat
    } catch (err) {
      console.warn('[web-record] locale load failed:', err)
      return null
    }
  }

  async function loadLocale() {
    if (!browser) return
    const params = new URLSearchParams(window.location.search)
    const paramLang = sanitizeLang(params.get('l'))
    const navigatorLang = sanitizeLang((navigator.language || '').split('-')[0] || '')
    const target = paramLang || navigatorLang || 'en'
    lang = target
    const loaded = await fetchLocale(target)
    if (loaded) {
      messages = loaded
      return
    }
    if (target !== 'en') {
      const fallback = await fetchLocale('en')
      if (fallback) messages = fallback
    }
  }

  function ensureRecordingId() {
    if (!recordingId) recordingId = `${Date.now()}`
    return recordingId
  }

  function normalizeMeta(meta?: WriterMeta) {
    const m = meta || {}
    const width = typeof m.width === 'number' ? m.width : m.codedWidth
    const height = typeof m.height === 'number' ? m.height : m.codedHeight
    const fps = m.framerate || m.fps || currentMeta.fps || 30
    const codec = m.codec || currentMeta.codec || 'vp8'
    return { codec, width: width ?? 1920, height: height ?? 1080, fps }
  }

  function initWriter(meta?: WriterMeta) {
    if (writer) return
    writerReady = false
    const id = ensureRecordingId()
    const normalizedMeta = normalizeMeta(meta)
    currentMeta = { ...currentMeta, ...normalizedMeta }
    try {
      writer = new Worker(new URL('../../lib/workers/opfs-writer-worker.ts', import.meta.url), {
        type: 'module'
      })
      writer.onmessage = (ev: MessageEvent) => {
        const data: any = ev.data || {}
        if (data.type === 'ready') {
          writerReady = true
          flushPendingChunks()
          attemptFinalize()
        } else if (data.type === 'progress') {
          // no-op for MVP
        } else if (data.type === 'finalized') {
          writerReady = false
          infoMessage = _t('drive_headerTitle', undefined, messages)
          cleanupWorkers()
          stopStream()
          cleanupWriter()
          status = 'idle'
        } else if (data.type === 'error') {
          errorMessage = data.message || 'OPFS write error'
          status = 'error'
        }
      }
      writer.postMessage({ type: 'init', id, meta: normalizedMeta })
    } catch (err: any) {
      errorMessage = err?.message || 'Failed to start OPFS writer'
      status = 'error'
    }
  }

  function cleanupWriter() {
    try { writer?.terminate() } catch (e) { console.warn('[web-record] writer terminate failed', e) }
    writer = null
    writerReady = false
    pendingChunks = []
    finalizeRequested = false
    recordingId = ''
  }

  function toUint8(raw: ChunkPayload | null | undefined): Uint8Array | null {
    if (!raw) return null
    if (raw instanceof Uint8Array) return raw
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
    if (ArrayBuffer.isView(raw) && typeof (raw as any).byteLength === 'number') {
      const view = raw as ArrayBufferView
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    }
    if (raw && typeof raw.copyTo === 'function' && typeof raw.byteLength === 'number') {
      const tmp = new Uint8Array(raw.byteLength)
      try { raw.copyTo(tmp) } catch (e) { console.warn('[web-record] copyTo failed', e) }
      return tmp
    }
    if (raw instanceof Blob) {
      // handled asynchronously by caller
      return null
    }
    return null
  }

  function appendChunk(chunk: ChunkMessage) {
    if (!writer || !writerReady) {
      pendingChunks.push(chunk)
      return
    }
    const { data, timestamp, type, isKeyframe, codedWidth, codedHeight, codec } = chunk
    const u8 = toUint8(data)
    if (!u8) {
      if (data instanceof Blob) {
        data.arrayBuffer().then((ab) => appendChunk({ ...chunk, data: ab })).catch((e) => {
          console.warn('[web-record] blob to arrayBuffer failed', e)
        })
      }
      return
    }
    const transferBuf =
      u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer
    const isKey = isKeyframe === true || type === 'key'
    writer.postMessage(
      {
        type: 'append',
        buffer: transferBuf,
        timestamp: timestamp ?? 0,
        chunkType: isKey ? 'key' : 'delta',
        codedWidth: codedWidth || currentMeta.width,
        codedHeight: codedHeight || currentMeta.height,
        codec: codec || currentMeta.codec,
        isKeyframe: isKey
      },
      [transferBuf]
    )
  }

  function flushPendingChunks() {
    if (!writerReady || !writer) return
    while (pendingChunks.length) {
      const item = pendingChunks.shift()
      if (item) appendChunk(item)
    }
  }

  function attemptFinalize() {
    if (!writer || !writerReady) return
    if (pendingChunks.length > 0) {
      flushPendingChunks()
      if (pendingChunks.length > 0) return
    }
    if (finalizeRequested) {
      finalizeRequested = false
      try {
        writer.postMessage({ type: 'finalize' })
      } catch (err: any) {
        errorMessage = err?.message || 'Failed to finalize writer'
        status = 'error'
      }
    }
  }

  function stopStream() {
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop())
      } catch (e) {
        console.warn('[web-record] stop tracks failed', e)
      }
    }
    stream = null
  }

  function cleanupWorkers() {
    frameLoopActive = false
    try { reader?.cancel() } catch (e) { console.warn('[web-record] reader cancel failed', e) }
    reader = null
    try { wcWorker?.terminate() } catch (e) { console.warn('[web-record] worker terminate failed', e) }
    wcWorker = null
  }

  async function startRecording() {
    if (!browser) return
    if (status === 'recording' || status === 'preparing') return
    errorMessage = ''
    infoMessage = ''

    if (!window.isSecureContext) {
      errorMessage = 'Screen capture requires a secure context (HTTPS)'
      status = 'error'
      return
    }
    if (!navigator?.mediaDevices?.getDisplayMedia) {
      errorMessage = 'getDisplayMedia is not available in this browser'
      status = 'error'
      return
    }
    if (!navigator?.storage || typeof navigator.storage.getDirectory !== 'function') {
      errorMessage = _t('drive_errorSupport', undefined, messages)
      status = 'error'
      return
    }
    if (typeof (window as any).MediaStreamTrackProcessor === 'undefined') {
      errorMessage = 'MediaStreamTrackProcessor is not supported in this browser'
      status = 'error'
      return
    }
    if (typeof (window as any).VideoEncoder === 'undefined') {
      errorMessage = 'WebCodecs VideoEncoder is not supported in this browser'
      status = 'error'
      return
    }

    cleanupWorkers()
    stopStream()
    cleanupWriter()
    status = 'preparing'

    try {
      const captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      stream = captureStream
      const videoTrack = captureStream.getVideoTracks()[0]
      if (!videoTrack) throw new Error('No video track in captured stream')
      videoTrack.onended = () => stopRecording()

      const settings = videoTrack.getSettings?.() || {}
      currentMeta = {
        ...currentMeta,
        width: settings.width || currentMeta.width,
        height: settings.height || currentMeta.height,
        fps: Math.round(settings.frameRate || currentMeta.fps)
      }

      type TrackProcessorCtor = new (opts: { track: MediaStreamTrack }) => {
        readable: ReadableStream<VideoFrame>
      }
      const ProcessorCtor = (window as any).MediaStreamTrackProcessor as TrackProcessorCtor
      const processor = new ProcessorCtor({ track: videoTrack })
      reader = processor.readable.getReader()

      wcWorker = new Worker(new URL('../../lib/workers/webcodecs-worker.ts', import.meta.url), {
        type: 'module'
      })

      const waitForConfigured = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Encoder configure timeout')), CONFIG_TIMEOUT_MS)
        wcWorker!.onmessage = (event: MessageEvent) => {
          const { type, data, config } = event.data || {}
          if (type === 'initialized') return
          if (type === 'configured') {
            clearTimeout(timeout)
            const meta = normalizeMeta({ ...config, framerate: config?.framerate })
            currentMeta = meta
            initWriter(meta)
            resolve()
          } else if (type === 'chunk' && data) {
            appendChunk({
              data: data.data,
              timestamp: data.timestamp,
              type: data.chunkType || data.type,
              isKeyframe: data.isKeyframe,
              codedWidth: data.codedWidth,
              codedHeight: data.codedHeight,
              codec: data.codec
            })
          } else if (type === 'complete') {
            finalizeRequested = true
            attemptFinalize()
          } else if (type === 'error') {
            clearTimeout(timeout)
            reject(new Error(String(data)))
          }
        }
        wcWorker!.onerror = (err) => {
          clearTimeout(timeout)
          reject(new Error(err.message || 'Encoder worker error'))
        }
      })

      const encoderConfig = {
        width: currentMeta.width,
        height: currentMeta.height,
        bitrate: DEFAULT_BITRATE,
        framerate: currentMeta.fps
      }
      wcWorker.postMessage({ type: 'configure', config: encoderConfig })
      await waitForConfigured

      if (!writer) {
        throw new Error('OPFS writer unavailable')
      }

      frameLoopActive = true
      status = 'recording'
      const frameFps = Math.max(1, currentMeta.fps || 30)
      const keyEvery = Math.max(1, frameFps * 2)

      ;(async () => {
        let frameIndex = 0
        try {
          while (frameLoopActive && reader) {
            const { done, value: frame } = await reader.read()
            if (done || !frame) break
            const keyFrame = frameIndex === 0 || frameIndex % keyEvery === 0
            wcWorker?.postMessage({ type: 'encode', frame, keyFrame }, [frame])
            frameIndex++
          }
        } catch (err) {
          errorMessage = (err as Error)?.message || 'Frame read failed'
          status = 'error'
        } finally {
          try { wcWorker?.postMessage({ type: 'stop' }) } catch (e) { console.warn('[web-record] stop post failed', e) }
          finalizeRequested = true
          attemptFinalize()
        }
      })().catch((err: any) => {
        errorMessage = err?.message || 'Frame loop failed'
        status = 'error'
      })
    } catch (err: any) {
      errorMessage = err?.message || 'Failed to start recording'
      status = 'error'
      frameLoopActive = false
      stopStream()
      cleanupWorkers()
      cleanupWriter()
      finalizeRequested = false
    }
  }

  function stopRecording() {
    if (status === 'idle' || status === 'stopping') return
    status = 'stopping'
    frameLoopActive = false
    finalizeRequested = true
    try { wcWorker?.postMessage({ type: 'stop' }) } catch (e) { console.warn('[web-record] stop post failed', e) }
    try { reader?.cancel() } catch (e) { console.warn('[web-record] reader cancel failed', e) }
    stopStream()
    attemptFinalize()
  }

  onMount(() => {
    void loadLocale()
  })

  onDestroy(() => {
    frameLoopActive = false
    stopStream()
    cleanupWorkers()
    cleanupWriter()
  })

  $: statusLabel = (() => {
    if (status === 'recording') return _t('control_statusRecording', undefined, messages)
    if (status === 'preparing') return _t('control_statusPreparing', undefined, messages)
    if (status === 'stopping') return `${_t('control_btnStop', undefined, messages)}...`
    if (status === 'error' && errorMessage) return errorMessage
    return _t('control_headerDesc', undefined, messages)
  })()
</script>

<svelte:head>
  <title>{_t('control_headerTitle', undefined, messages)} - Web</title>
</svelte:head>

<main class="web-record-page">
  <section class="panel">
    <div class="header">
      <div>
        <p class="lang">Lang: {lang}</p>
        <h1>{_t('control_headerTitle', undefined, messages)}</h1>
        <p class="desc">{_t('control_headerDesc', undefined, messages)}</p>
      </div>
      <div class="status" data-status={status}>
        {statusLabel}
      </div>
    </div>

    <div class="actions">
      <button class="primary" on:click={startRecording} disabled={status === 'recording' || status === 'preparing'}>
        {_t('control_btnStart', undefined, messages)}
      </button>
      <button class="secondary" on:click={stopRecording} disabled={status === 'idle' || status === 'stopping' || status === 'error'}>
        {_t('control_btnStop', undefined, messages)}
      </button>
    </div>

    {#if infoMessage}
      <div class="info">{infoMessage}</div>
    {/if}

    {#if errorMessage && status === 'error'}
      <div class="error">{errorMessage}</div>
    {/if}

    <div class="hint">
      <p>{_t('control_tipsSelectMode', [_t('control_modeScreen', undefined, messages)], messages)}</p>
      <p>{_t('drive_headerTitle', undefined, messages)} / {_t('control_headerTitle', undefined, messages)} ➜ {_t('action_defaultTitle', undefined, messages)}</p>
      <p>{`${routePath}?l=en`} • {`${routePath}?l=zh`}</p>
    </div>
  </section>
</main>

<style>
  .web-record-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #eef2ff, #f8fafc);
    padding: 24px;
    box-sizing: border-box;
    color: #0f172a;
  }

  .panel {
    width: min(720px, 100%);
    background: white;
    border-radius: 16px;
    padding: 20px 24px;
    box-shadow: 0 15px 40px rgba(15, 23, 42, 0.12);
    border: 1px solid #e2e8f0;
  }

  .header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  .lang {
    margin: 0 0 4px;
    color: #475569;
    font-size: 14px;
  }

  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: #0f172a;
  }

  .desc {
    margin: 6px 0 0;
    color: #475569;
  }

  .status {
    padding: 10px 14px;
    border-radius: 12px;
    background: #f8fafc;
    min-width: 180px;
    text-align: right;
    font-weight: 600;
    color: #0f172a;
  }

  .status[data-status='recording'] {
    color: #0ea5e9;
    background: #e0f2fe;
  }

  .status[data-status='error'] {
    color: #ef4444;
    background: #fee2e2;
  }

  .status[data-status='preparing'],
  .status[data-status='stopping'] {
    color: #f59e0b;
    background: #fef9c3;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 18px 0 12px;
  }

  button {
    padding: 12px;
    font-size: 16px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    cursor: pointer;
    font-weight: 600;
    background: white;
    transition: transform 0.1s ease, box-shadow 0.2s ease, background 0.2s ease;
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  button.primary {
    background: linear-gradient(135deg, #2563eb, #0ea5e9);
    color: white;
    border: none;
    box-shadow: 0 10px 25px rgba(37, 99, 235, 0.25);
  }

  button.primary:not(:disabled):hover {
    transform: translateY(-1px);
  }

  button.secondary:not(:disabled):hover {
    background: #f8fafc;
  }

  .info,
  .error,
  .hint {
    padding: 12px;
    border-radius: 10px;
    margin-top: 10px;
    font-size: 14px;
  }

  .info {
    background: #ecfeff;
    color: #0e7490;
    border: 1px solid #bae6fd;
  }

  .error {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecdd3;
  }

  .hint {
    background: #f8fafc;
    color: #475569;
    border: 1px dashed #cbd5e1;
  }

  .hint p {
    margin: 6px 0;
  }
</style>
