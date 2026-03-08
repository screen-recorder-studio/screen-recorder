<script lang="ts">
  import { onMount } from 'svelte'

  // Types mirrored to ring worker
  type ReadyMsg = {
    type: 'ready'
    meta: any
    summary: {
      totalChunks: number
      fps?: number
      width?: number
      height?: number
      codec?: string
      keyframeIndices?: number[]
      keyframeCount?: number
    }
  }
  type RangeMsg = {
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

  // Inputs & UI state
  let recordingIdInput = ''
  let effectiveDirId = ''
  let statusMsg = ''
  let errorMsg = ''

  // Worker & meta
  let ringWorker: Worker | null = null
  let totalFrames = 0
  let keyframeIndices: number[] = []
  let fps = 30
  let width = 0, height = 0
  let codecFromMeta: string | undefined

  // Play/seek state
  let currentIndex = 0
  let isConnected = false
  let isLoading = false
  let isPlaying = false
  let playbackRate = 1.0


  // Canvas
  let canvasEl: HTMLCanvasElement





  // Worker request helper (single-shot listener)
  function postAndWait<T = any>(payload: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const msg: any = ev.data
        if (msg?.type === 'error') {
          ringWorker?.removeEventListener('message', onMsg)
          reject(new Error(msg.message || 'Worker error'))
          return
        }
        // Let caller filter; resolve everything
        ringWorker?.removeEventListener('message', onMsg)
        resolve(msg as T)
      }
      ringWorker!.addEventListener('message', onMsg)
      ringWorker!.postMessage(payload)
    })
  }

  function onWorkerMsg(ev: MessageEvent) {
    const m: any = ev.data
    if (!m || typeof m !== 'object') return
    if (m.type === 'position') {
      const idx = Math.max(0, Math.min(Math.max(0, totalFrames - 1), Number(m.index) || 0))
      currentIndex = idx
    } else if (m.type === 'playing') {
      isPlaying = true
    } else if (m.type === 'paused') {
      isPlaying = false
    } else if (m.type === 'error') {
      errorMsg = m.message || 'Worker error'
    }
  }

  async function connect() {
    try {
      errorMsg = ''; statusMsg = 'Connecting...'
      effectiveDirId = recordingIdInput?.trim()
      if (!effectiveDirId) throw new Error('请输入 Recording ID 或目录名')
      if (!effectiveDirId.startsWith('rec_')) effectiveDirId = `rec_${effectiveDirId}`

      if (ringWorker) { try { ringWorker.terminate() } catch {} }
      ringWorker = new Worker(new URL('./opfs-ring-worker.ts', import.meta.url), { type: 'module' })

      const ready = await new Promise<ReadyMsg>((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          const msg: any = ev.data
          if (msg?.type === 'ready') { ringWorker?.removeEventListener('message', onMsg); resolve(msg as ReadyMsg) }
          else if (msg?.type === 'error') { ringWorker?.removeEventListener('message', onMsg); reject(new Error(msg.message || 'Reader error')) }
        }
        ringWorker!.addEventListener('message', onMsg)
        ringWorker!.postMessage({ type: 'open', dirId: effectiveDirId })
      })

      totalFrames = Math.max(0, Number(ready.summary?.totalChunks) || 0)
      keyframeIndices = ready.summary?.keyframeIndices || []
      fps = Math.max(1, Number(ready.summary?.fps) || 30)
      width = Number(ready.summary?.width) || 0
      height = Number(ready.summary?.height) || 0
      codecFromMeta = ready.summary?.codec

      // Configure ring capacity (chunks) and align
      ringWorker.postMessage({ type: 'configure', capacityPow2: 1024, alignToKeyframe: true })
      // Persistent listener for playback updates
      ringWorker!.addEventListener('message', onWorkerMsg)


      statusMsg = `Opened ${effectiveDirId}. Total frames: ${totalFrames}`
      isConnected = true
      currentIndex = 0

      if (totalFrames > 0) {
        const off = (canvasEl as any).transferControlToOffscreen?.()
        if (!off) { throw new Error('当前环境不支持 OffscreenCanvas，无法由 worker 渲染') }
        ringWorker!.postMessage({ type: 'initCanvas', canvas: off }, [off])
        ringWorker!.postMessage({ type: 'setPlayback', fps, playbackRate })
        ringWorker!.postMessage({ type: 'seekToIndex', index: currentIndex })
      }
    } catch (e: any) {
      errorMsg = e?.message || String(e)
      statusMsg = ''
    }
  }

  async function showIndex(targetIndex: number) {
    if (!ringWorker) return
    errorMsg = ''
    try {
      ringWorker!.postMessage({ type: 'seekToIndex', index: targetIndex })
      statusMsg = `定位到第 ${targetIndex} 帧`
    } catch (e: any) {
      errorMsg = e?.message || String(e)
    }
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
    showIndex(currentIndex)
  }
  function jumpNextKeyframe() {
    if (!keyframeIndices?.length) return
    for (let i = 0; i < keyframeIndices.length; i++) {
      const k = keyframeIndices[i]
      if (k > currentIndex) { currentIndex = k; showIndex(currentIndex); return }
    }
    currentIndex = Math.max(0, totalFrames - 1)
    showIndex(currentIndex)
  }

  function onSliderInput() {
    // mild debounce via microtask
    Promise.resolve().then(() => showIndex(currentIndex))
  }

  function onRateChange() {
    if (ringWorker) ringWorker.postMessage({ type: 'setRate', playbackRate })
  }

  function togglePlay() {
    if (!isConnected || !ringWorker) return
    isPlaying = !isPlaying
    ringWorker.postMessage({ type: isPlaying ? 'play' : 'pause' })
  }



  onMount(() => {
    return () => {
      try { ringWorker?.removeEventListener('message', onWorkerMsg) } catch {}
      if (ringWorker) { try { ringWorker.terminate() } catch {} }
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
  .seekbar { margin-top: 10px; }
  .seekbar input[type="range"] { width: 100%; }
</style>

<svelte:head>
  <title>Ring 缓冲预览编辑器</title>
</svelte:head>

<div class="container">
  <div class="panel">
    <h3>连接 OPFS 录制（Ring）</h3>
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

      <div class="row" style="justify-content: space-between; margin-top: 8px;">
        <button on:click={togglePlay}>{isPlaying ? '暂停' : '播放'}</button>
        <div>
          <select bind:value={playbackRate} on:change={onRateChange}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </div>
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

