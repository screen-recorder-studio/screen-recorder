<script lang="ts">
  import { onMount } from 'svelte'
  import type { ZoomMode, ZoomEasing } from '$lib/stores/video-zoom.svelte'

  interface FocusPoint { x: number; y: number; space?: 'source' | 'layout' }

  // 🆕 P1: 扩展的 payload 类型，包含模式/缓动/过渡时长
  // 🆕 P2: 新增 syncBackground 字段
  interface ZoomPayload {
    focus: Required<FocusPoint>
    scale: number
    mode: ZoomMode
    easing: ZoomEasing
    transitionDurationMs: number
    syncBackground: boolean
  }

  interface Props {
    frameBitmap: ImageBitmap
    videoWidth: number
    videoHeight: number
    initialFocus?: FocusPoint
    initialScale?: number
    // 🆕 P1: 新增初始属性
    initialMode?: ZoomMode
    initialEasing?: ZoomEasing
    initialTransitionDurationMs?: number
    // 🆕 P2: 背景同步放大
    initialSyncBackground?: boolean
    onConfirm?: (payload: ZoomPayload) => void
    onCancel?: () => void
  }

  let {
    frameBitmap,
    videoWidth,
    videoHeight,
    initialFocus = { x: 0.5, y: 0.5, space: 'source' },
    initialScale = 1.5,
    initialMode = 'dolly',
    initialEasing = 'smooth',
    initialTransitionDurationMs = 300,
    initialSyncBackground = false,
    onConfirm,
    onCancel
  }: Props = $props()

  // 缩放倍数选项
  const scaleOptions = [1.25, 1.5, 2.0, 2.5, 3.0]
  let selectedScale = $state(initialScale ?? 1.5)

  // 🆕 P1: Zoom 模式选项
  const modeOptions: { value: ZoomMode; label: string; description: string }[] = [
    { value: 'dolly', label: 'Dolly', description: 'Moves focus point to center' },
    { value: 'anchor', label: 'Anchor', description: 'Focus point stays fixed' }
  ]
  let selectedMode = $state<ZoomMode>(initialMode)

  // 🆕 P1: 缓动类型选项
  const easingOptions: { value: ZoomEasing; label: string; description: string }[] = [
    { value: 'smooth', label: 'Smooth', description: 'Ease in-out' },
    { value: 'linear', label: 'Linear', description: 'Constant speed' },
    { value: 'punch', label: 'Instant', description: 'Immediate jump' }
  ]
  let selectedEasing = $state<ZoomEasing>(initialEasing)

  // 🆕 P1: 过渡时长选项
  const transitionOptions = [0, 100, 200, 300, 500, 800, 1000]
  let selectedTransitionDurationMs = $state(initialTransitionDurationMs)

  // 🆕 P2: 背景同步放大选项
  let selectedSyncBackground = $state(initialSyncBackground)

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
    // 🆕 P1: 扩展 payload 包含模式/缓动/过渡时长
    // 🆕 P2: 新增 syncBackground 字段
    onConfirm?.({
      focus: { x: focus.x, y: focus.y, space: focus.space },
      scale: selectedScale,
      mode: selectedMode,
      easing: selectedEasing,
      transitionDurationMs: selectedTransitionDurationMs,
      syncBackground: selectedSyncBackground
    })
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
  /* 🆕 P1: 扩展工具栏样式 */
  .toolbar-extended {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: #111827;
    border-radius: 0.5rem;
    border: 1px solid #374151;
  }
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .toolbar-actions {
    justify-content: space-between;
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid #374151;
  }
  .toolbar-buttons {
    display: flex;
    gap: 0.5rem;
  }
  .opt-group {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .mode-hint {
    color: #9ca3af;
    font-size: 0.75rem;
    font-style: italic;
  }
  .btn {
    padding: 0.35rem 0.6rem;
    border-radius: 0.375rem;
    border: none;
    cursor: pointer;
    color: white;
    font-size: 0.875rem;
  }
  .btn-confirm { background: #2563eb; }
  .btn-cancel { background: #374151; }
  .opt-label { color: #9ca3af; font-size: 0.75rem; white-space: nowrap; }
  .opt-select { background:#1f2937; color:#e5e7eb; border:1px solid #4b5563; border-radius:0.375rem; padding:0.25rem 0.5rem; font-size: 0.875rem; }
  .opt-select:focus { outline: none; border-color: #3b82f6; }

  .btn:hover { opacity: 0.9 }

  /* 🆕 P2: 背景同步放大开关样式 */
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .sync-bg-label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: #9ca3af;
    cursor: pointer;
    user-select: none;
  }
  .sync-bg-label input[type="checkbox"] {
    accent-color: #3b82f6;
    cursor: pointer;
  }
  .sync-bg-label:hover {
    color: #e5e7eb;
  }
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

  <!-- 🆕 P1: 扩展的工具栏，包含模式/缓动/过渡时长选择器 -->
  <div class="toolbar-extended">
    <!-- 第一行：核心参数 -->
    <div class="toolbar-row">
      <div class="opt-group">
        <label class="opt-label" for="mode-select">Mode</label>
        <select id="mode-select" class="opt-select" bind:value={selectedMode} title={modeOptions.find(o => o.value === selectedMode)?.description}>
          {#each modeOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="opt-group">
        <label class="opt-label" for="scale-select">Scale</label>
        <select id="scale-select" class="opt-select" bind:value={selectedScale}>
          {#each scaleOptions as s}
            <option value={s}>{s}x</option>
          {/each}
        </select>
      </div>

      <div class="opt-group">
        <label class="opt-label" for="easing-select">Easing</label>
        <select id="easing-select" class="opt-select" bind:value={selectedEasing} title={easingOptions.find(o => o.value === selectedEasing)?.description}>
          {#each easingOptions as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="opt-group">
        <label class="opt-label" for="transition-select">Duration</label>
        <select id="transition-select" class="opt-select" bind:value={selectedTransitionDurationMs}>
          {#each transitionOptions as ms}
            <option value={ms}>{ms === 0 ? 'None' : `${ms}ms`}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- 第二行：高级选项和操作按钮 -->
    <div class="toolbar-row toolbar-actions">
      <div class="toolbar-left">
        <span class="mode-hint">
          {#if selectedMode === 'dolly'}
            Dolly: Focus point moves to center
          {:else}
            Anchor: Focus point stays fixed
          {/if}
        </span>
        <!-- 🆕 P2: 背景同步放大开关 -->
        <label class="sync-bg-label" title="When enabled, background zooms together with video">
          <input type="checkbox" bind:checked={selectedSyncBackground} />
          <span>Sync BG</span>
        </label>
      </div>
      <div class="toolbar-buttons">
        <button class="btn btn-cancel" onclick={handleCancel}>Cancel</button>
        <button class="btn btn-confirm" onclick={handleConfirm}>Confirm</button>
      </div>
    </div>
  </div>
</div>

