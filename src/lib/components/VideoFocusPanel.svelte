<script lang="ts">
  import { onMount } from 'svelte'

  interface FocusPoint { x: number; y: number; space?: 'source' | 'layout' }

  interface Props {
    frameBitmap: ImageBitmap
    videoWidth: number
    videoHeight: number
    initialFocus?: FocusPoint
    onConfirm?: (focus: Required<FocusPoint>) => void
    onCancel?: () => void
  }

  let {
    frameBitmap,
    videoWidth,
    videoHeight,
    initialFocus = { x: 0, y: 0, space: 'source' },
    onConfirm,
    onCancel
  }: Props = $props()

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
  function sourceToScreen(px: number, py: number) {
    const scale = display.width / videoWidth
    return { x: offset.x + px * scale, y: offset.y + py * scale }
  }
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
  function onPointerUp(e: PointerEvent) {
    dragging = false
  }

  function handleConfirm() {
    onConfirm?.({ x: focus.x, y: focus.y, space: focus.space })
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
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: rgba(59, 130, 246, 0.95);
    border: 2px solid white;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35);
    transform: translate(-50%, -50%);
    cursor: grab;
    touch-action: none;
  }
  .toolbar {
    display: flex;
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
  .btn:hover { opacity: 0.9 }
</style>

<div class="panel">
  <div class="stage" bind:this={containerEl} onpointermove={onPointerMove} onpointerup={onPointerUp}>
    <div class="canvas-wrap" style={`width:${display.width}px;height:${display.height}px;left:${offset.x}px;top:${offset.y}px`}>
      <canvas bind:this={canvasEl}></canvas>

      {#if frameBitmap}
        {#key `${focus.x}-${focus.y}-${display.width}-${display.height}-${offset.x}-${offset.y}`}
          <div
            class="focus-dot"
            style={`left:${focus.x * display.width}px;top:${focus.y * display.height}px`}
            onpointerdown={onPointerDown}
            title={`(${focus.x.toFixed(3)}, ${focus.y.toFixed(3)})`}
          ></div>
        {/key}
      {/if}
    </div>
  </div>
  <div class="toolbar">
    <button class="btn btn-cancel" onclick={handleCancel}>Cancel</button>
    <button class="btn btn-confirm" onclick={handleConfirm}>Confirm</button>
  </div>
</div>

