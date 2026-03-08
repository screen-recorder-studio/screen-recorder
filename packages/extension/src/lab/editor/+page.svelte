<script lang="ts">
  import { onMount } from 'svelte'

  type ReaderReady = {
    type: 'ready'
    meta: any
    summary: {
      totalChunks: number
      keyframeIndices?: number[]
    }
    keyframes?: number[] // ms
    keyframeInfo?: { indices: number[]; timestamps: number[]; count: number }
  }

  type ReaderRange = {
    type: 'range'
    start: number
    count: number
    chunks: Array<{
      data: ArrayBuffer
      timestamp: number // μs
      type: 'key' | 'delta'
      size: number
      codedWidth?: number
      codedHeight?: number
      codec?: string
    }>
  }

  let recordingIdInput = ''
  let effectiveDirId = ''
  let statusMsg = ''
  let errorMsg = ''

  let readerWorker: Worker | null = null

  let totalFrames = 0
  let keyframeIndices: number[] = []

  let currentIndex = 0
  let isLoading = false
  let isConnected = false

  // playback state
  let playing = false
  let playbackTimer: any = null
  let fps = 30

  // playback speed
  let rate: number = 1.0
  const rates: number[] = [1, 1.2, 1.4, 1.6, 1.8, 2]
  function onRateChange(e: Event) {
    const v = Number((e.target as HTMLSelectElement).value)
    if (!isFinite(v) || v <= 0) return
    rate = v
    // Inform worker about new rate; if already playing, let worker adjust its timer
    if (decodeWorker) {
      decodeWorker.postMessage({ type: 'setRate', rate })
      if (playing) decodeWorker.postMessage({ type: 'play' })
    }
  }
  let bitmapCtx: ImageBitmapRenderingContext | null = null


  // Canvas refs
  let canvasEl: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null

  // Decoder state
  let decoder: VideoDecoder | null = null
  let decoderCodec: string | null = null

  // Request scheduling / throttling
  let inFlight = false
  let queuedIndex: number | null = null
  let debounceTimer: any = null
  let lastRequestedIndex = -1

  // Index entries for metadata (read directly from OPFS for offset)
  type IndexEntry = {
    offset: number
    size: number
    timestamp: number
    type: 'key' | 'delta'
    isKeyframe?: boolean
    codedWidth?: number
    codedHeight?: number
    codec?: string
  }
  let indexEntries: IndexEntry[] = []

  const usToMs = (us: number) => Math.floor(us / 1000)

  function ensureCanvas(w = 640, h = 360) {
    if (!canvasEl) return
    const needResize = canvasEl.width !== w || canvasEl.height !== h
    if (needResize) {
      canvasEl.width = w
      canvasEl.height = h
    }
    // Prefer zero-copy bitmaprenderer; fallback to 2D
    if (!bitmapCtx) bitmapCtx = canvasEl.getContext('bitmaprenderer') as any
    if (!bitmapCtx && !ctx) ctx = canvasEl.getContext('2d')
  }

  async function connect() {
    try {
      errorMsg = ''
      statusMsg = 'Connecting...'

      // Normalize dir id: allow plain id or rec_<id>
      effectiveDirId = recordingIdInput?.trim()
      if (!effectiveDirId) throw new Error('请输入 Recording ID 或目录名')
      if (!effectiveDirId.startsWith('rec_')) effectiveDirId = `rec_${effectiveDirId}`

      // Create worker
      if (readerWorker) readerWorker.terminate()
      readerWorker = new Worker(new URL('../../../lib/workers/opfs-reader-worker.ts', import.meta.url), { type: 'module' })

      const readyPromise = new Promise<ReaderReady>((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          const msg: any = ev.data
          if (msg?.type === 'ready') {
            readerWorker?.removeEventListener('message', onMsg)
            resolve(msg as ReaderReady)
          } else if (msg?.type === 'error') {
            readerWorker?.removeEventListener('message', onMsg)
            reject(new Error(msg.message || 'Reader error'))
          }
        }
        readerWorker!.addEventListener('message', onMsg)
      })

      readerWorker.postMessage({ type: 'open', dirId: effectiveDirId })
      const ready = await readyPromise

      totalFrames = Math.max(0, Number(ready.summary?.totalChunks) || 0)
      keyframeIndices = ready.keyframeInfo?.indices || ready.summary?.keyframeIndices || []
      statusMsg = `Opened ${effectiveDirId}. Total frames: ${totalFrames}`

      // Read index.jsonl directly for offset metadata
      await loadIndexForMetadata(effectiveDirId)
      fps = inferFPS(indexEntries) || 30

      currentIndex = 0
      isConnected = true

      if (totalFrames > 0) {
        setupDecodeWorker()
        await sendSeekWindow(currentIndex)
      }
    } catch (e: any) {
      errorMsg = e?.message || String(e)
      statusMsg = ''
    }
  }

  async function loadIndexForMetadata(dirId: string) {
    try {
      // OPFS access
      // @ts-ignore
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(dirId, { create: false })
      const indexHandle = await dir.getFileHandle('index.jsonl')
      const text = await (await indexHandle.getFile()).text()
      const lines = text.split(/\r?\n/).filter(Boolean)
      indexEntries = lines.map((l, i) => {
        try { return JSON.parse(l) as IndexEntry } catch {
          throw new Error(`index.jsonl 第 ${i} 行 JSON 解析失败`)
        }
      })
    } catch (e: any) {
      console.warn('Failed to read index.jsonl for metadata:', e)
      indexEntries = []
    }
  }

  function inferFPS(entries: IndexEntry[]): number {
    if (!entries || entries.length < 2) return 30
    const N = Math.min(entries.length - 1, 60)
    const deltas: number[] = []
    for (let i = 1; i <= N; i++) deltas.push((entries[i].timestamp - entries[i - 1].timestamp) / 1000)
    deltas.sort((a, b) => a - b)
    const medianMs = deltas[Math.floor(deltas.length / 2)] || 33.3
    return Math.max(1, Math.min(120, Math.round(1000 / Math.max(1, medianMs))))
  }

  // Decode worker integration and windowed playback
  let decodeWorker: Worker | null = null
  let windowStart = 0
  let windowEnd = -1
  let fetchingNextWindow = false
  let seekReqId = 0

  function setupDecodeWorker() {
    if (decodeWorker) { try { decodeWorker.terminate() } catch {} }
    decodeWorker = new Worker(new URL('./player-decode-worker.ts', import.meta.url), { type: 'module' })
    decodeWorker.onmessage = (ev: MessageEvent) => {
      const msg: any = ev.data
      if (msg?.type === 'ready') {
        // worker initialized
      } else if (msg?.type === 'frame') {
        const { bitmap, index, width, height } = msg
        ensureCanvas(width || 640, height || 360)
        if (bitmapCtx) {
          try { (bitmapCtx as any).transferFromImageBitmap(bitmap) } catch (e) { console.warn('bitmap render failed', e) }
        } else if (ctx) {
          try {
            ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
            // fallback: drawImage may accept ImageBitmap
            ctx.drawImage(bitmap as any, 0, 0, canvasEl.width, canvasEl.height)
          } catch {}
        }
        currentIndex = Math.max(0, Math.min(totalFrames - 1, index))
        // 如果已到最后一帧，自动暂停，避免出现“进度到末尾但仍有画面变化”
        if (currentIndex >= Math.max(0, totalFrames - 1)) {
          if (playing) {
            playing = false
            decodeWorker?.postMessage({ type: 'pause' })
          }
          statusMsg = '已到最后一帧'
          return
        }
        appendNextWindowIfNeeded()
      } else if (msg?.type === 'bufferStatus') {
        // Optionally react to low buffer
      } else if (msg?.type === 'error') {
        errorMsg = msg.message || 'Decode worker error'
      }
    }
    decodeWorker.postMessage({ type: 'init', fps })
  }

  function windowSize(): number {
    const seconds = 3
    const desired = Math.max(30, Math.round(fps * seconds))
    return Math.min(desired, Math.max(0, totalFrames - windowStart))
  }

  async function fetchWindow(start: number, count: number): Promise<ReaderRange> {
    return await new Promise<ReaderRange>((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const m: any = ev.data
        if (m?.type === 'range') {
          readerWorker?.removeEventListener('message', onMsg)
          resolve(m as ReaderRange)
        } else if (m?.type === 'error') {
          readerWorker?.removeEventListener('message', onMsg)
          reject(new Error(m.message || 'Reader error'))
        }
      }
      readerWorker!.addEventListener('message', onMsg)
      readerWorker!.postMessage({ type: 'getRange', start, count })
    })
  }

  async function sendSeekWindow(targetIndex: number) {
    if (!readerWorker) return
    const myReq = ++seekReqId
    isLoading = true
    errorMsg = ''
    try {
      const range = await fetchWindow(targetIndex, windowSize())
      if (myReq !== seekReqId) return // discard stale response
      windowStart = range.start
      windowEnd = range.start + range.count - 1
      if (decodeWorker) {
        const transfer: ArrayBuffer[] = range.chunks.map((c: any) => c.data as ArrayBuffer)
        decodeWorker.postMessage(
          { type: 'seek', start: range.start, targetIndex, chunks: range.chunks },
          { transfer: transfer as unknown as Transferable[] }
        )
      }
      statusMsg = `显示第 ${targetIndex} 帧（窗口 ${windowStart}-${windowEnd}）`
    } catch (e: any) {
      if (myReq !== seekReqId) return
      errorMsg = e?.message || String(e)
      statusMsg = ''
    } finally {
      if (myReq === seekReqId) isLoading = false
    }
  }

  function appendNextWindowIfNeeded() {
    if (!readerWorker || !decodeWorker) return
    if (fetchingNextWindow) return
    if (windowEnd >= totalFrames - 1) return
    const safety = Math.max(20, Math.round(fps * 1.0))
    if (currentIndex + safety < windowEnd) return
    fetchingNextWindow = true
    const start = windowEnd + 1
    const count = windowSize()
    fetchWindow(start, count)
      .then((range) => {
        windowStart = Math.min(windowStart, range.start)
        windowEnd = range.start + range.count - 1
        const transfer: ArrayBuffer[] = range.chunks.map((c: any) => c.data as ArrayBuffer)
        decodeWorker!.postMessage(
          { type: 'append', start: range.start, chunks: range.chunks },
          { transfer: transfer as unknown as Transferable[] }
        )
      })
      .catch((e) => { console.warn('append window failed', e) })
      .finally(() => { fetchingNextWindow = false })
  }


  function getCurrentIndexEntry(): IndexEntry | null {
    if (!indexEntries?.length) return null
    const i = Math.max(0, Math.min(currentIndex, indexEntries.length - 1))
    return indexEntries[i]
  }

  function resetDecoder() {
    if (decoder) {
      try { decoder.close() } catch {}
    }
    decoder = null
    decoderCodec = null
  }

  async function decodeAndRender(targetIndex: number, range: ReaderRange) {
    if (!('VideoDecoder' in window)) throw new Error('当前环境不支持 WebCodecs VideoDecoder')

    const { chunks, start } = range
    if (!chunks || chunks.length === 0) throw new Error('未获取到视频块')

    const targetPos = Math.max(0, Math.min(chunks.length - 1, targetIndex - start))
    const first = chunks[0]
    const codec = first.codec || 'vp8'

    // Prepare decoder fresh for this request; close previous to avoid leaks
    if (decoder) {
      try { decoder.close() } catch {}
      decoder = null
    }

    // Collect decoded frames in order
    const decoded: VideoFrame[] = []

    decoder = new VideoDecoder({
      output: (frame: VideoFrame) => decoded.push(frame),
      error: (err) => console.error('Decoder error:', err)
    })
    try {
      decoder.configure({ codec } as VideoDecoderConfig)
      decoderCodec = codec
    } catch (e) {
      throw new Error(`解码器配置失败: ${(e as Error).message}`)
    }

    try {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        const data = c.data instanceof ArrayBuffer ? new Uint8Array(c.data) : new Uint8Array(c.data as any)
        const evc = new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, data })
        decoder.decode(evc)
      }
      await decoder.flush()
    } catch (e) {
      decoded.forEach((f) => { try { f.close() } catch {} })
      throw e
    }

    // Choose the target frame
    const frame = decoded[targetPos] || decoded[decoded.length - 1]
    if (!frame) throw new Error('未解码出可用帧')

    // Draw to canvas
    const w = frame.displayWidth || frame.codedWidth || 640
    const h = frame.displayHeight || frame.codedHeight || 360
    ensureCanvas(w, h)
    if (!ctx) throw new Error('Canvas 2D 上下文不可用')

    const bitmap = await createImageBitmap(frame)
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
    ctx.drawImage(bitmap, 0, 0, canvasEl.width, canvasEl.height)
    // Release bitmap to free GPU memory
    try { (bitmap as any).close?.() } catch {}

    // Cleanup
    try { frame.close() } catch {}
    for (let i = 0; i < decoded.length; i++) { if (decoded[i] !== frame) { try { decoded[i].close() } catch {} } }
  }

  async function fetchAndPreview(index: number) {
    if (!readerWorker) return
    isLoading = true
    statusMsg = playing ? `Playing ${index}` : 'Loading frame...'
    errorMsg = ''

    try {
      const range = await new Promise<ReaderRange>((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          const msg: any = ev.data
          if (msg?.type === 'range') {
            readerWorker?.removeEventListener('message', onMsg)
            resolve(msg as ReaderRange)
          } else if (msg?.type === 'error') {
            readerWorker?.removeEventListener('message', onMsg)
            reject(new Error(msg.message || 'Reader error'))
          }
        }
        readerWorker!.addEventListener('message', onMsg)
        readerWorker!.postMessage({ type: 'getRange', start: index, count: 1 })
      })

      await decodeAndRender(index, range)
      statusMsg = playing ? `Playing ${index}` : `显示第 ${index} 帧（返回范围 ${range.start}..${range.start + range.count - 1}）`
    } catch (e: any) {
      errorMsg = e?.message || String(e)
      statusMsg = ''
    } finally {
      isLoading = false
    }
  }

  // Throttled request dispatcher to avoid flooding worker/decoder on slider drag
  async function requestFrame(index: number) {
    if (index === lastRequestedIndex) return
    lastRequestedIndex = index

    if (inFlight) {
      queuedIndex = index
      return
    }
    inFlight = true
    try {
      await fetchAndPreview(index)
    } catch (e) {
      // errorMsg already set inside fetch
    } finally {
      inFlight = false
      if (queuedIndex !== null && queuedIndex !== index) {
        const next = queuedIndex
        queuedIndex = null
        // microtask yield to keep UI responsive
        await Promise.resolve()
        await requestFrame(next!)
      } else {
        queuedIndex = null
      }
    }
  }

  function onSliderInput() {
    // Debounce to ~8-10fps while dragging
    if (debounceTimer) clearTimeout(debounceTimer)
    const idx = currentIndex
    debounceTimer = setTimeout(() => { sendSeekWindow(idx) }, 100)
  }

  function play() {
    if (!isConnected || totalFrames <= 0 || playing) return
    playing = true
    if (decodeWorker) {
      decodeWorker.postMessage({ type: 'setRate', rate })
      decodeWorker.postMessage({ type: 'play' })
      // proactively plan next window if needed
      appendNextWindowIfNeeded()
    }
  }
  function pause() {
    playing = false
    if (playbackTimer) { clearInterval(playbackTimer); playbackTimer = null }
    if (decodeWorker) decodeWorker.postMessage({ type: 'pause' })
  }
  function togglePlay() { playing ? pause() : play() }
  function step(delta: number) {
    pause()
    currentIndex = Math.max(0, Math.min(totalFrames - 1, currentIndex + delta))
    sendSeekWindow(currentIndex)
  }

  function jumpPrevKeyframe() {
    if (!keyframeIndices?.length) return
    let prev = 0
    for (let i = 0; i < keyframeIndices.length; i++) {
      const k = keyframeIndices[i]
      if (k >= currentIndex) break
      prev = k
    }
    currentIndex = prev
    sendSeekWindow(currentIndex)
  }

  function jumpNextKeyframe() {
    if (!keyframeIndices?.length) return
    for (let i = 0; i < keyframeIndices.length; i++) {
      const k = keyframeIndices[i]
      if (k > currentIndex) {
        currentIndex = k
        sendSeekWindow(currentIndex)
        return
      }
    }
    // already at or past last keyframe; move to last frame
    currentIndex = Math.max(0, totalFrames - 1)
    sendSeekWindow(currentIndex)
  }

  onMount(() => {
    return () => {
      if (readerWorker) { try { readerWorker.terminate() } catch {} }
      if (decodeWorker) { try { decodeWorker.postMessage({ type: 'close' }); decodeWorker.terminate() } catch {} }
      resetDecoder()
    }
  })
</script>

<style>
  .container { display: grid; grid-template-columns: 360px 1fr; gap: 16px; }
  .panel { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #fff; }
  .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
  .status { font-size: 12px; color: #555; }
  .error { color: #b91c1c; font-weight: 600; }
  .kline { position: relative; height: 14px; background: #f3f4f6; border-radius: 7px; margin-top: 6px; }
  .kmarker { position: absolute; top: 2px; width: 2px; height: 10px; background: #ef4444; opacity: 0.7; }
  .preview { width: 100%; max-width: 960px; background: #111; border-radius: 8px; display: grid; place-items: center; }
  canvas { width: 100%; height: auto; background: #000; border-radius: 6px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
  .seekbar { margin-top: 10px; }
  .seekbar input[type="range"] { width: 100%; }
  .controls { display: flex; gap: 8px; align-items: center; justify-content: center; margin-top: 8px; }
</style>

<svelte:head>
  <title>OPFS 编辑器（自动播放）</title>
</svelte:head>

<div class="container">
  <div class="panel">
    <h3>连接 OPFS 录制</h3>
    <div class="row">
      <label for="recordingId">Recording ID/目录：</label>
      <input id="recordingId" placeholder="例如 abc123 或 rec_abc123" bind:value={recordingIdInput} style="flex:1; padding:6px 8px; border:1px solid #ddd; border-radius:6px" />
      <button on:click={connect} style="padding:6px 10px">连接</button>
    </div>
    {#if statusMsg}<div class="status">{statusMsg}</div>{/if}
    {#if errorMsg}<div class="error">{errorMsg}</div>{/if}

    {#if isConnected}

      <!-- Keyframe markers -->
      <div class="kline">
        {#if keyframeIndices && keyframeIndices.length > 0 && totalFrames > 0}
          {#each keyframeIndices as k}
            <div class="kmarker" style={`left:${(k / Math.max(1,totalFrames-1)) * 100}%`}></div>
          {/each}
        {/if}
      </div>
      <div class="row" style="justify-content: space-between; margin-top: 8px;">
        <button on:click={jumpPrevKeyframe}>上一关键帧</button>
        <button on:click={jumpNextKeyframe}>下一关键帧</button>
      </div>

      <div class="panel" style="margin-top:12px">
        <h4>当前帧信息</h4>
        {#if indexEntries && indexEntries.length > 0}
          {@const ent = getCurrentIndexEntry()}
          {#if ent}
            <div class="mono">
              <div>offset: {ent.offset}</div>
              <div>size: {ent.size} bytes</div>
              <div>timestamp: {ent.timestamp} μs ({usToMs(ent.timestamp)} ms)</div>
              <div>type: {ent.isKeyframe || ent.type === 'key' ? 'key' : 'delta'}</div>
              <div>codec: {ent.codec || 'unknown'}</div>
              <div>coded: {ent.codedWidth || '-'} x {ent.codedHeight || '-'}</div>
            </div>
          {/if}
        {:else}
          <div class="status">未载入 index.jsonl 元数据（offset/codec 等将不可见）</div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="panel">
    <h3>视频帧预览 {isLoading ? '(加载中...)' : ''}</h3>
    <div class="preview">
      <canvas bind:this={canvasEl}></canvas>
    </div>
    {#if isConnected}
      <div class="seekbar">
        <input id="frameIndex" type="range" min="0" max={Math.max(0, totalFrames - 1)} bind:value={currentIndex} on:input={onSliderInput} />
        <div class="status" style="text-align: right; margin-top: 4px;">{currentIndex}/{Math.max(0, totalFrames - 1)} · FPS {fps}</div>
      </div>
      <div class="controls">
        <button on:click={() => step(-1)}>&lt; 上一帧</button>
        <button on:click={togglePlay}>{playing ? '暂停' : '播放'}</button>
        <button on:click={() => step(1)}>下一帧 &gt;</button>
        <label for="rateSelect">倍速</label>
        <select id="rateSelect" on:change={onRateChange} aria-label="Playback rate">
          {#each rates as r}
            <option value={r} selected={r === rate}>{r}x</option>
          {/each}
        </select>
      </div>
    {/if}

  </div>
</div>

