<script lang="ts">
  import { Scissors, RotateCcw } from '@lucide/svelte'
  import { trimStore } from '$lib/stores/trim.svelte'

  // Props
  interface Props {
    durationMs: number
    frameRate?: number
    totalFrames?: number
    disabled?: boolean
    className?: string
  }

  let {
    durationMs,
    frameRate = 30,
    totalFrames = 0,
    disabled = false,
    className = ''
  }: Props = $props()

  // 本地状态
  let isDraggingStart = $state(false)
  let isDraggingEnd = $state(false)
  let timelineWidth = $state(0)
  let timelineEl: HTMLDivElement | null = null
  let hasInitialized = $state(false)

  // 响应式计算
  const trimStartPercent = $derived(durationMs > 0 ? (trimStore.trimStartMs / durationMs) * 100 : 0)
  const trimEndPercent = $derived(durationMs > 0 ? (trimStore.trimEndMs / durationMs) * 100 : 100)
  const trimRangeWidth = $derived(trimEndPercent - trimStartPercent)

  // 初始化 trimStore（只初始化一次，避免重置 enabled 状态）
  $effect(() => {
    if (durationMs > 0 && !hasInitialized) {
      trimStore.initialize(durationMs, frameRate, totalFrames)
      hasInitialized = true
      console.log('🎬 [TrimControls] Initialized trim store once')
    } else if (durationMs > 0 && hasInitialized) {
      // 如果已经初始化过，使用 updateParameters 不重置 enabled 状态
      trimStore.updateParameters(durationMs, frameRate, totalFrames)
    }
  })

  // 测量时间轴宽度
  $effect(() => {
    if (timelineEl) {
      const resizeObserver = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect
        if (rect) {
          timelineWidth = rect.width
        }
      })
      resizeObserver.observe(timelineEl)
      
      return () => {
        resizeObserver.disconnect()
      }
    }
  })

  // 将像素位置转换为时间（毫秒）
  function pixelToTime(pixelX: number): number {
    if (!timelineEl || timelineWidth === 0) return 0
    const rect = timelineEl.getBoundingClientRect()
    const relativeX = Math.max(0, Math.min(pixelX - rect.left, timelineWidth))
    return (relativeX / timelineWidth) * durationMs
  }

  // 处理裁剪开始手柄拖拽
  function handleStartDragStart(e: MouseEvent) {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    isDraggingStart = true
    trimStore.enable()
    
    const handleMove = (moveEvent: MouseEvent) => {
      const newTime = pixelToTime(moveEvent.clientX)
      trimStore.setTrimStart(newTime)
    }
    
    const handleUp = () => {
      isDraggingStart = false
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  // 处理裁剪结束手柄拖拽
  function handleEndDragStart(e: MouseEvent) {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    isDraggingEnd = true
    trimStore.enable()
    
    const handleMove = (moveEvent: MouseEvent) => {
      const newTime = pixelToTime(moveEvent.clientX)
      trimStore.setTrimEnd(newTime)
    }
    
    const handleUp = () => {
      isDraggingEnd = false
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  // 处理裁剪区域拖拽（移动整个区域）
  let isDraggingRange = $state(false)
  let dragStartX = $state(0)
  let dragStartTrimStart = $state(0)
  let dragStartTrimEnd = $state(0)

  function handleRangeDragStart(e: MouseEvent) {
    if (disabled || !trimStore.enabled) return
    e.preventDefault()
    e.stopPropagation()
    isDraggingRange = true
    dragStartX = e.clientX
    dragStartTrimStart = trimStore.trimStartMs
    dragStartTrimEnd = trimStore.trimEndMs
    
    const handleMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStartX
      const deltaTime = (deltaX / timelineWidth) * durationMs
      
      const newStart = Math.max(0, Math.min(dragStartTrimStart + deltaTime, durationMs - (dragStartTrimEnd - dragStartTrimStart)))
      const newEnd = newStart + (dragStartTrimEnd - dragStartTrimStart)
      
      trimStore.setTrimStart(newStart)
      trimStore.setTrimEnd(newEnd)
    }
    
    const handleUp = () => {
      isDraggingRange = false
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  // 格式化时间显示
  function formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    const msRemainder = Math.floor((ms % 1000) / 10)
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(msRemainder).padStart(2, '0')}`
  }

  // 切换裁剪启用状态
  function toggleTrim() {
    trimStore.toggle()
  }

  // 重置裁剪范围
  function resetTrim() {
    trimStore.reset()
  }
</script>

<!-- 裁剪控制容器 -->
<div class="trim-controls p-3 bg-gray-800 border-t border-gray-700 {className}">
  <!-- 工具栏 -->
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center gap-2">
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200"
        class:bg-blue-500={trimStore.enabled}
        class:text-white={trimStore.enabled}
        class:hover:bg-blue-600={trimStore.enabled}
        class:bg-gray-700={!trimStore.enabled}
        class:text-gray-300={!trimStore.enabled}
        class:hover:bg-gray-600={!trimStore.enabled}
        onclick={toggleTrim}
        disabled={disabled}
      >
        <Scissors class="w-4 h-4" />
        {trimStore.enabled ? 'Trim Enabled' : 'Enable Trim'}
      </button>

      {#if trimStore.enabled}
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 transition-all duration-200"
          onclick={resetTrim}
          disabled={disabled}
        >
          <RotateCcw class="w-4 h-4" />
          Reset
        </button>
      {/if}
    </div>

    <!-- 裁剪信息 -->
    {#if trimStore.enabled}
      <div class="flex items-center gap-4 text-xs text-gray-400">
        <span>Start: {formatTime(trimStore.trimStartMs)}</span>
        <span>End: {formatTime(trimStore.trimEndMs)}</span>
        <span class="text-blue-400 font-semibold">Duration: {formatTime(trimStore.trimDurationMs)}</span>
        <span>Frames: {trimStore.trimFrameCount}</span>
      </div>
    {/if}
  </div>

  <!-- 时间轴和裁剪区域 -->
  <div
    bind:this={timelineEl}
    class="relative h-12 bg-gray-900 rounded-md overflow-hidden select-none"
    class:opacity-50={disabled}
  >
    <!-- 非裁剪区域遮罩 -->
    {#if trimStore.enabled}
      <!-- 左侧遮罩 -->
      <div
        class="absolute top-0 left-0 h-full bg-black/60 pointer-events-none"
        style="width: {trimStartPercent}%"
      ></div>
      
      <!-- 右侧遮罩 -->
      <div
        class="absolute top-0 h-full bg-black/60 pointer-events-none"
        style="left: {trimEndPercent}%; width: {100 - trimEndPercent}%"
      ></div>

      <!-- 裁剪区域高亮 -->
      <div
        role="slider"
        tabindex="0"
        aria-label="Drag to move trim range"
        aria-valuenow={trimStartPercent}
        aria-valuemin="0"
        aria-valuemax="100"
        class="absolute top-0 h-full bg-blue-500/20 border-l-2 border-r-2 border-blue-500 cursor-move"
        class:ring-2={isDraggingRange}
        class:ring-blue-400={isDraggingRange}
        style="left: {trimStartPercent}%; width: {trimRangeWidth}%"
        onmousedown={handleRangeDragStart}
      >
        <!-- 裁剪区域标签 -->
        <div class="absolute top-1 left-1/2 -translate-x-1/2 text-xs text-white bg-blue-500 px-2 py-0.5 rounded pointer-events-none">
          Trim Range
        </div>
      </div>

      <!-- 开始手柄 -->
      <div
        role="slider"
        tabindex="0"
        aria-label="Trim start handle"
        aria-valuenow={trimStartPercent}
        aria-valuemin="0"
        aria-valuemax="100"
        class="absolute top-0 h-full w-3 cursor-ew-resize group"
        class:z-20={isDraggingStart}
        class:z-10={!isDraggingStart}
        style="left: calc({trimStartPercent}% - 6px)"
        onmousedown={handleStartDragStart}
      >
        <div
          class="absolute inset-0 bg-blue-500 group-hover:bg-blue-400 transition-colors duration-150"
          class:bg-blue-400={isDraggingStart}
          class:shadow-lg={isDraggingStart}
        ></div>
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white text-xs font-bold pointer-events-none">
          ‹
        </div>
      </div>

      <!-- 结束手柄 -->
      <div
        role="slider"
        tabindex="0"
        aria-label="Trim end handle"
        aria-valuenow={trimEndPercent}
        aria-valuemin="0"
        aria-valuemax="100"
        class="absolute top-0 h-full w-3 cursor-ew-resize group"
        class:z-20={isDraggingEnd}
        class:z-10={!isDraggingEnd}
        style="left: calc({trimEndPercent}% - 6px)"
        onmousedown={handleEndDragStart}
      >
        <div
          class="absolute inset-0 bg-blue-500 group-hover:bg-blue-400 transition-colors duration-150"
          class:bg-blue-400={isDraggingEnd}
          class:shadow-lg={isDraggingEnd}
        ></div>
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white text-xs font-bold pointer-events-none">
          ›
        </div>
      </div>
    {:else}
      <!-- 未启用裁剪时的提示 -->
      <div class="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
        Click "Enable Trim" to select a range to cut
      </div>
    {/if}
  </div>
</div>

<style>
  .trim-controls {
    user-select: none;
  }
</style>
