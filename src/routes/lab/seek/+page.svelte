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
    if (!ctx) ctx = canvasEl.getContext('2d')
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

      currentIndex = 0
      isConnected = true

      if (totalFrames > 0) {
        await requestFrame(currentIndex)
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
    statusMsg = 'Loading frame...'
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
      statusMsg = `显示第 ${index} 帧（返回范围 ${range.start}..${range.start + range.count - 1}）`
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
    // Debounce to ~8fps while dragging
    if (debounceTimer) clearTimeout(debounceTimer)
    const idx = currentIndex
    debounceTimer = setTimeout(() => {
      requestFrame(idx)
    }, 120)
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
    requestFrame(currentIndex)
  }

  function jumpNextKeyframe() {
    if (!keyframeIndices?.length) return
    for (let i = 0; i < keyframeIndices.length; i++) {
      const k = keyframeIndices[i]
      if (k > currentIndex) {
        currentIndex = k
        requestFrame(currentIndex)
        return
      }
    }
    // already at or past last keyframe; move to last frame
    currentIndex = Math.max(0, totalFrames - 1)
    requestFrame(currentIndex)
  }

  onMount(() => {
    return () => {
      if (readerWorker) { try { readerWorker.terminate() } catch {} }
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
</style>

<svelte:head>
  <title>OPFS 帧定位验证</title>
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
        <div class="status" style="text-align: right; margin-top: 4px;">{currentIndex}/{Math.max(0, totalFrames - 1)}</div>
      </div>
    {/if}

  </div>
</div>

