<script lang="ts">
  import { onMount } from 'svelte'

  interface FocusPoint { x: number; y: number; space?: 'source' | 'layout' }

  interface Props {
    frameBitmap: ImageBitmap
    videoWidth: number
    videoHeight: number
    initialFocus?: FocusPoint
    initialScale?: number
    onConfirm?: (payload: { focus: Required<FocusPoint>; scale: number }) => void
    onCancel?: () => void
  }

  let {
    frameBitmap,
    videoWidth,
    videoHeight,
    initialFocus = { x: 0.5, y: 0.5, space: 'source' },
    initialScale = 1.5,
    onConfirm,
    onCancel
  }: Props = $props()

  const scaleOptions = [1.25, 1.5, 2.0, 2.5, 3.0]
  let selectedScale = $state(initialScale ?? 1.5)

  // Canvas & layout
  let containerEl = $state<HTMLDivElement | null>(null)
  let canvasEl = $state<HTMLCanvasElement | null>(null)
  const display = $state({ width: 0, height: 0 })
  const offset = $state({ x: 0, y: 0 })

  // Focus state (normalized 0..1 in source space by default)
  let focus = $state<Required<FocusPoint>>({ x: initialFocus.x, y: initialFocus.y, space: initialFocus.space ?? 'source' })
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

  function layoutToFit() {
    if (!containerEl) return
    const maxW = containerEl.clientWidth
    const maxH = containerEl.clientHeight
    const aspect = videoWidth / videoHeight
    let w = maxW
    let h = Math.floor(w / aspect)
    if (h > maxH) {
      h = maxH
      w = Math.floor(h * aspect)
    }
    display.width = w
    display.height = h
    offset.x = Math.floor((maxW - w) / 2)
    offset.y = Math.floor((maxH - h) / 2)
    if (canvasEl) {
      canvasEl.width = w
      canvasEl.height = h
    }
  }

  function drawFrame() {
    if (!canvasEl || !frameBitmap) return
    const ctx = canvasEl.getContext('2d')!
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
    // Draw frame scaled to canvas
    ctx.drawImage(frameBitmap, 0, 0, videoWidth, videoHeight, 0, 0, canvasEl.width, canvasEl.height)
  }

  $effect(() => {
    layoutToFit()
    drawFrame()
  })

  onMount(() => {
    const ro = new ResizeObserver(() => {
      layoutToFit()
      drawFrame()
    })
    if (containerEl) ro.observe(containerEl)
    return () => ro.disconnect()
  })

  // Coordinate conversions (source <-> screen)
  function screenToSource(sx: number, sy: number) {
    const scale = display.width / videoWidth
    return { x: (sx - offset.x) / scale, y: (sy - offset.y) / scale }
  }

  // Drag handling
  let dragging = $state(false)
  function onPointerDown(e: PointerEvent) {
    e.stopPropagation()
    dragging = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    const rect = containerEl!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x, y } = screenToSource(sx, sy)
    focus.x = clamp01(x / videoWidth)
    focus.y = clamp01(y / videoHeight)
  }
  function onPointerUp() {
    dragging = false
  }
  function onStagePointerDown(e: PointerEvent) {
    // 允许点击舞台任意位置放置/移动焦点，解决在某些情况下初始焦点未显示导致无法拖拽的问题
    const rect = containerEl!.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x, y } = screenToSource(sx, sy)
    focus.x = clamp01(x / videoWidth)
    focus.y = clamp01(y / videoHeight)
    dragging = true
    ;(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId)
  }

  function handleConfirm() {
    onConfirm?.({ focus: { x: focus.x, y: focus.y, space: focus.space }, scale: selectedScale })
  }
  function handleCancel() {
    onCancel?.()
  }
</script>

<style>
  .panel {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 240px;
    background: #0b1220;
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .canvas-wrap {
    position: absolute;
    inset: 0;
  }
  canvas {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    image-rendering: pixelated;
  }
  .focus-dot {
    position: absolute;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: rgba(59, 130, 246, 0.08);
    border: 2px solid rgba(59, 130, 246, 0.95);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.35);
    transform: translate(-50%, -50%);
    cursor: grab;
    touch-action: none;
  }
  .focus-dot .cross {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 18px;
    height: 18px;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .focus-dot .cross::before,
  .focus-dot .cross::after {
    content: '';
    position: absolute;
    background: white;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
  }
  .focus-dot .cross::before {
    width: 2px;
    height: 100%;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
  }
  .focus-dot .cross::after {
    height: 2px;
    width: 100%;
    top: 50%;
    left: 0;
    transform: translateY(-50%);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    justify-content: flex-end;
  }
  .btn {
    padding: 0.35rem 0.6rem;
    border-radius: 0.375rem;
    border: none;
    cursor: pointer;
    color: white;
  }
  .btn-confirm { background: #2563eb; }
  .btn-cancel { background: #374151; }
  .opt-label { color: #d1d5db; font-size: 0.875rem; }
  .opt-select { background:#111827; color:#e5e7eb; border:1px solid #374151; border-radius:0.375rem; padding:0.25rem 0.5rem; }

  .btn:hover { opacity: 0.9 }
</style>

<div class="panel">
  <div class="stage" bind:this={containerEl} onpointerdown={onStagePointerDown} onpointermove={onPointerMove} onpointerup={onPointerUp}>
    <div class="canvas-wrap" style={`width:${display.width}px;height:${display.height}px;left:${offset.x}px;top:${offset.y}px`}>
      <canvas bind:this={canvasEl}></canvas>

      {#if frameBitmap}
        {#key `${focus.x}-${focus.y}-${display.width}-${display.height}-${offset.x}-${offset.y}`}
          <div
            class="focus-dot"
            style={`left:${focus.x * display.width}px;top:${focus.y * display.height}px`}
            onpointerdown={onPointerDown}
            title={`(${focus.x.toFixed(3)}, ${focus.y.toFixed(3)})`}
          >
            <div class="cross"></div>
          </div>
        {/key}
      {/if}
    </div>

  </div>
  <div class="toolbar">
    <label class="opt-label" for="scale-select">缩放倍数</label>
    <select id="scale-select" class="opt-select" bind:value={selectedScale}>
      {#each scaleOptions as s}
        <option value={s}>{s}x</option>
      {/each}
    </select>
    <button class="btn btn-cancel" onclick={handleCancel}>Cancel</button>
    <button class="btn btn-confirm" onclick={handleConfirm}>Confirm</button>
  </div>
</div>

