<!-- Timeline Component - Professional video editing timeline with time markers, playhead, trim handles, and zoom -->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Scissors, ZoomIn, X } from '@lucide/svelte'

  // Props Interface
  interface Props {
    // Timeline data
    timelineMaxMs: number                  // 总时长（毫秒）
    currentTimeMs: number                  // 当前播放时间（毫秒）
    frameRate?: number                     // 帧率，默认 30

    // Playback state
    isPlaying?: boolean                    // 是否播放中
    isProcessing?: boolean                 // 是否处理中

    // Trim state
    trimEnabled?: boolean                  // 是否启用裁剪
    trimStartMs?: number                   // 裁剪开始时间
    trimEndMs?: number                     // 裁剪结束时间

    // Zoom state
    zoomIntervals?: Array<{ startMs: number; endMs: number }>  // Zoom 区间列表

    // Callbacks
    onSeek?: (timeMs: number) => void      // 跳转时间
    onTrimStartChange?: (timeMs: number) => void
    onTrimEndChange?: (timeMs: number) => void
    onTrimToggle?: () => void              // 切换裁剪开关
    onZoomChange?: (startMs: number, endMs: number) => boolean  // Zoom 变化（返回是否成功）
    onZoomRemove?: (index: number) => void // 删除 Zoom 区间
    onHoverPreview?: (timeMs: number) => void      // 鼠标悬停预览
    onHoverPreviewEnd?: () => void                 // 预览结束
  }

  let {
    timelineMaxMs,
    currentTimeMs,
    frameRate = 30,
    isPlaying = false,
    isProcessing = false,
    trimEnabled = false,
    trimStartMs = 0,
    trimEndMs = 0,
    zoomIntervals = [],
    onSeek,
    onTrimStartChange,
    onTrimEndChange,
    onTrimToggle,
    onZoomChange,
    onZoomRemove,
    onHoverPreview,
    onHoverPreviewEnd
  }: Props = $props()

  // DOM 引用
  let timelineTrackEl = $state<HTMLDivElement | null>(null)
  let zoomTrackEl = $state<HTMLDivElement | null>(null)

  // 拖拽状态
  let isDraggingPlayhead = $state(false)
  let isDraggingTrimStart = $state(false)
  let isDraggingTrimEnd = $state(false)
  let isDraggingZoom = $state(false)
  let isDraggingZoomStart = $state(false)
  let isDraggingZoomEnd = $state(false)

  // Zoom 状态
  let zoomActive = $state(false)
  let zoomStartMs = $state(0)
  let zoomEndMs = $state(0)

  // 🆕 预览状态
  let isHoveringTimeline = $state(false)
  let hoverPreviewTimeMs = $state(0)

  // rAF throttle for hover preview
  let hoverRaf = 0

  // 🔧 内存泄漏修复：跟踪所有活动的事件监听器清理函数
  let activeCleanups: (() => void)[] = []

  // 组件销毁时清理所有事件监听器
  onDestroy(() => {
    activeCleanups.forEach(cleanup => cleanup())
    activeCleanups = []
  })

  // 计算时长（秒）
  const durationSec = $derived(timelineMaxMs / 1000)

  // 计算当前时间标签
  const currentTimeLabel = $derived(formatTimeSec(currentTimeMs / 1000))

  // 计算播放头位置百分比
  const playheadPercent = $derived.by(() => {
    if (timelineMaxMs <= 0) return 0
    return Math.min(100, Math.max(0, (currentTimeMs / timelineMaxMs) * 100))
  })

  // 计算裁剪手柄位置百分比
  const trimStartPercent = $derived(timelineMaxMs > 0 ? (trimStartMs / timelineMaxMs) * 100 : 0)
  const trimEndPercent = $derived.by(() => {
    if (timelineMaxMs <= 0) return 100
    const end = trimEndMs > 0 ? trimEndMs : timelineMaxMs
    return (end / timelineMaxMs) * 100
  })

  // 计算 Zoom 选区百分比
  const zoomStartPercent = $derived(timelineMaxMs > 0 ? (zoomStartMs / timelineMaxMs) * 100 : 0)
  const zoomEndPercent = $derived(timelineMaxMs > 0 ? (zoomEndMs / timelineMaxMs) * 100 : 100)

  // 🆕 计算预览位置百分比
  const hoverPreviewPercent = $derived(timelineMaxMs > 0 ? (hoverPreviewTimeMs / timelineMaxMs) * 100 : 0)

  // 🆕 Zoom 是否激活（基于区间列表）
  const hasZoomIntervals = $derived(zoomIntervals.length > 0)

  // ========== 时间刻度计算 ==========

  interface TimeMarker {
    timeSec: number
    timeMs: number
    timeLabel?: string
    isMajor: boolean
    position: number
  }

  // 智能刻度间隔计算 - 确保刻度均匀分布
  function calculateTickInterval(durationSec: number): { major: number; minor: number } {
    // 候选刻度间隔（秒），按优先级排序
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

    // 目标：生成 5-10 个主刻度
    const minTicks = 5
    const maxTicks = 10
    const idealTicks = 7

    let bestMajor = 1
    let bestScore = -Infinity

    for (const interval of candidates) {
      // 计算该间隔会生成多少个刻度（包括起点和终点）
      const tickCount = Math.ceil(durationSec / interval) + 1

      // 跳过刻度数过少或过多的间隔
      if (tickCount < minTicks || tickCount > maxTicks) continue

      // 计算得分
      let score = 0

      // 1. 刻度数接近理想值（权重：50%）
      const tickDiff = Math.abs(tickCount - idealTicks)
      score += (1 - tickDiff / idealTicks) * 50

      // 2. 能否整除视频时长（权重：30%）
      const remainder = durationSec % interval
      const divisibilityScore = (1 - remainder / interval) * 30
      score += divisibilityScore

      // 3. 间隔是否常见（权重：20%）
      const commonIntervals = [1, 2, 5, 10, 30, 60]
      if (commonIntervals.includes(interval)) {
        score += 20
      }

      if (score > bestScore) {
        bestScore = score
        bestMajor = interval
      }
    }

    // 次刻度为主刻度的 1/5 或 1/2
    let bestMinor: number
    if (bestMajor >= 10) {
      bestMinor = bestMajor / 5  // 大间隔用 1/5
    } else if (bestMajor >= 5) {
      bestMinor = bestMajor / 5  // 5秒用 1/5 (1秒)
    } else {
      bestMinor = bestMajor / 2  // 小间隔用 1/2
    }

    return { major: bestMajor, minor: bestMinor }
  }

  // 生成时间刻度
  const timeMarkers = $derived.by((): TimeMarker[] => {
    if (durationSec <= 0) {
      console.log('[Timeline] No markers: durationSec =', durationSec)
      return []
    }

    const markers: TimeMarker[] = []
    const { major, minor } = calculateTickInterval(durationSec)

    console.log('[Timeline] Generating markers:', {
      durationSec,
      major,
      minor,
      timelineMaxMs
    })

    // 🔧 优化：使用 Map 去重，避免重复刻度
    const markerMap = new Map<string, TimeMarker>()

    // 生成主要刻度（带时间标签）
    for (let t = 0; t <= durationSec; t += major) {
      const label = formatTimeSec(t)
      const key = `major-${label}`

      if (!markerMap.has(key)) {
        markerMap.set(key, {
          timeSec: t,
          timeMs: t * 1000,
          timeLabel: label,
          isMajor: true,
          position: (t / durationSec) * 100
        })
      }
    }

    // 确保最后一个刻度（视频结束点）总是存在
    const endLabel = formatTimeSec(durationSec)
    const endKey = `major-${endLabel}`

    if (!markerMap.has(endKey)) {
      // 检查是否有非常接近的刻度（容差 0.1 秒）
      const TOLERANCE = 0.1
      let hasSimilar = false

      for (const marker of markerMap.values()) {
        if (marker.isMajor && Math.abs(marker.timeSec - durationSec) < TOLERANCE) {
          hasSimilar = true
          break
        }
      }

      if (!hasSimilar) {
        markerMap.set(endKey, {
          timeSec: durationSec,
          timeMs: durationSec * 1000,
          timeLabel: endLabel,
          isMajor: true,
          position: 100
        })
      }
    }

    // 生成次要刻度（不带标签）
    for (let t = minor; t < durationSec; t += minor) {
      // 检查是否与主刻度重叠（使用容差）
      const TOLERANCE = 0.01
      let overlapsWithMajor = false

      for (const marker of markerMap.values()) {
        if (marker.isMajor && Math.abs(marker.timeSec - t) < TOLERANCE) {
          overlapsWithMajor = true
          break
        }
      }

      if (!overlapsWithMajor) {
        const key = `minor-${t.toFixed(3)}`
        if (!markerMap.has(key)) {
          markerMap.set(key, {
            timeSec: t,
            timeMs: t * 1000,
            isMajor: false,
            position: (t / durationSec) * 100
          })
        }
      }
    }

    // 转换为数组并排序
    const finalMarkers = Array.from(markerMap.values()).sort((a, b) => a.timeSec - b.timeSec)

    console.log('[Timeline] Generated markers:', {
      total: finalMarkers.length,
      major: finalMarkers.filter(m => m.isMajor).length,
      minor: finalMarkers.filter(m => !m.isMajor).length,
      firstFew: finalMarkers.slice(0, 5).map(m => ({ time: m.timeSec, label: m.timeLabel, pos: m.position.toFixed(1) }))
    })

    return finalMarkers
  })

  // ========== 工具函数 ==========

  // 格式化时间为 mm:ss（统一格式）
  function formatTimeSec(sec: number): string {
    const total = Math.max(0, sec)
    const mm = Math.floor(total / 60)
    const ss = Math.floor(total % 60)
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }

  // 像素位置转换为时间（主时间轴）
  function pixelToTimeMs(pixelX: number, containerEl: HTMLElement | null = timelineTrackEl): number {
    if (!containerEl) return 0
    const rect = containerEl.getBoundingClientRect()
    const relativeX = Math.max(0, Math.min(pixelX - rect.left, rect.width))
    return (relativeX / rect.width) * timelineMaxMs
  }
  // 将时间对齐到帧边界，保持与播放器一致（使用向下取整对齐）
  function alignToFrameMs(rawMs: number): number {
    if (!frameRate || frameRate <= 0) return rawMs
    const frameIndex = Math.floor((rawMs / 1000) * frameRate)
    const aligned = (frameIndex / frameRate) * 1000
    return aligned
  }


  // ========== 播放头拖拽 ==========

  function handlePlayheadMouseDown(e: MouseEvent) {
    if (isProcessing) return
    e.preventDefault()
    e.stopPropagation()

    isDraggingPlayhead = true

    const handleMove = (moveEvent: MouseEvent) => {
      const newTimeMs = pixelToTimeMs(moveEvent.clientX)
      onSeek?.(newTimeMs)
    }

    const handleUp = () => {
      isDraggingPlayhead = false
      cleanup()
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      activeCleanups = activeCleanups.filter(c => c !== cleanup)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    activeCleanups.push(cleanup)
  }

  // 点击时间轴跳转
  function handleTimelineClick(e: MouseEvent) {
    if (isProcessing || isDraggingTrimStart || isDraggingTrimEnd) return

    const rawMs = pixelToTimeMs(e.clientX)
    const alignedMs = alignToFrameMs(rawMs)
    onSeek?.(alignedMs)
  }

  // 🆕 鼠标移动处理（预览）
  function handleTimelineMouseMove(e: MouseEvent) {
    if (!timelineTrackEl || isDraggingPlayhead || isDraggingTrimStart || isDraggingTrimEnd || isProcessing) {
      return
    }

    isHoveringTimeline = true

    if (hoverRaf) cancelAnimationFrame(hoverRaf)
    const x = e.clientX
    hoverRaf = requestAnimationFrame(() => {
      hoverPreviewTimeMs = pixelToTimeMs(x)
      onHoverPreview?.(hoverPreviewTimeMs)
    })
  }

  // 🆕 Zoom 轨道鼠标移动处理（预览）
  function handleZoomTrackMouseMove(e: MouseEvent) {
    // 🔧 拖拽创建区间时不触发预览
    if (!zoomTrackEl || isDraggingZoom || isProcessing) {
      return
    }

    isHoveringTimeline = true
    hoverPreviewTimeMs = pixelToTimeMs(e.clientX, zoomTrackEl)

    // 触发预览回调
    onHoverPreview?.(hoverPreviewTimeMs)
  }
  // 统一容器级鼠标移动处理（覆盖整个进度条区域，包括内部元素/覆盖层）
  function handleContainerMouseMove(e: MouseEvent) {
    if (isDraggingPlayhead || isDraggingTrimStart || isDraggingTrimEnd || isProcessing) return

    isHoveringTimeline = true

    if (hoverRaf) cancelAnimationFrame(hoverRaf)
    const x = e.clientX
    const y = e.clientY

    hoverRaf = requestAnimationFrame(() => {
      let timeMs = 0
      // 优先判断是否在 zoom 区域内
      if (zoomTrackEl) {
        const zr = zoomTrackEl.getBoundingClientRect()
        if (y >= zr.top && y <= zr.bottom && x >= zr.left && x <= zr.right) {
          timeMs = pixelToTimeMs(x, zoomTrackEl)
          const aligned = alignToFrameMs(timeMs)
          hoverPreviewTimeMs = aligned
          onHoverPreview?.(aligned)
          return
        }
      }
      // 默认使用主轨道
      if (timelineTrackEl) {
        timeMs = pixelToTimeMs(x)
        const aligned = alignToFrameMs(timeMs)
        hoverPreviewTimeMs = aligned
        onHoverPreview?.(aligned)
      }
    })
  }

  // 容器级鼠标离开
  function handleContainerMouseLeave() {
    if (!isHoveringTimeline) return
    isHoveringTimeline = false
    onHoverPreviewEnd?.()
  }


  // 🆕 鼠标离开处理
  function handleTimelineMouseLeave() {
    if (!isHoveringTimeline) return

    isHoveringTimeline = false
    onHoverPreviewEnd?.()
  }

  // 🆕 Zoom 轨道鼠标离开处理
  function handleZoomTrackMouseLeave() {
    if (!isHoveringTimeline || isDraggingZoom) return

    isHoveringTimeline = false
    onHoverPreviewEnd?.()
  }

  // 键盘导航
  function handleTimelineKeydown(e: KeyboardEvent) {
    if (isProcessing) return

    // 左右箭头快进/快退
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const step = e.shiftKey ? 5000 : 1000  // Shift: 5秒, 普通: 1秒
      const newTimeMs = e.key === 'ArrowLeft'
        ? Math.max(0, currentTimeMs - step)
        : Math.min(timelineMaxMs, currentTimeMs + step)
      onSeek?.(newTimeMs)
    }

    // Home/End 跳转到开始/结束
    else if (e.key === 'Home') {
      e.preventDefault()
      onSeek?.(0)
    }
    else if (e.key === 'End') {
      e.preventDefault()
      onSeek?.(timelineMaxMs)
    }

    // Space 播放/暂停（如果提供了回调）
    else if (e.key === ' ') {
      e.preventDefault()
      // Note: Timeline 本身不控制播放，交给父组件处理
    }
  }

  // ========== 裁剪手柄拖拽 ==========

  function handleTrimStartDrag(e: MouseEvent) {
    if (isProcessing) return
    e.preventDefault()
    e.stopPropagation()

    isDraggingTrimStart = true

    const handleMove = (moveEvent: MouseEvent) => {
      const newTimeMs = pixelToTimeMs(moveEvent.clientX)
      onTrimStartChange?.(newTimeMs)
      onSeek?.(newTimeMs)  // 实时预览
    }

    const handleUp = () => {
      isDraggingTrimStart = false
      cleanup()
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      activeCleanups = activeCleanups.filter(c => c !== cleanup)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    activeCleanups.push(cleanup)
  }

  function handleTrimEndDrag(e: MouseEvent) {
    if (isProcessing) return
    e.preventDefault()
    e.stopPropagation()

    isDraggingTrimEnd = true

    const handleMove = (moveEvent: MouseEvent) => {
      const newTimeMs = pixelToTimeMs(moveEvent.clientX)
      onTrimEndChange?.(newTimeMs)
      onSeek?.(newTimeMs)  // 实时预览
    }

    const handleUp = () => {
      isDraggingTrimEnd = false
      cleanup()
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      activeCleanups = activeCleanups.filter(c => c !== cleanup)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    activeCleanups.push(cleanup)
  }

  // ========== Zoom 功能 ==========

  function handleZoomTrackMouseDown(e: MouseEvent) {
    if (!zoomTrackEl) return
    e.preventDefault()

    const startX = e.clientX
    const startMs = pixelToTimeMs(startX, zoomTrackEl)

    isDraggingZoom = true
    zoomStartMs = startMs
    zoomEndMs = startMs

    const handleMove = (moveEvent: MouseEvent) => {
      const currentMs = pixelToTimeMs(moveEvent.clientX, zoomTrackEl)

      // 确保开始和结束位置正确排序
      if (currentMs >= startMs) {
        zoomStartMs = startMs
        zoomEndMs = currentMs
      } else {
        zoomStartMs = currentMs
        zoomEndMs = startMs
      }
    }

    const handleUp = () => {
      isDraggingZoom = false

      // 验证选区有效性（至少1秒）
      const duration = Math.abs(zoomEndMs - zoomStartMs)
      if (duration >= 1000) {
        // 🔧 调用回调并检查返回值
        const success = onZoomChange?.(zoomStartMs, zoomEndMs)

        if (success) {
          console.log(`✅ [Timeline] Zoom interval created: ${formatTimeSec(zoomStartMs / 1000)} - ${formatTimeSec(zoomEndMs / 1000)}`)
        } else {
          console.warn('⚠️ [Timeline] Zoom interval rejected (overlap)')
        }

        // 重置选区
        zoomStartMs = 0
        zoomEndMs = timelineMaxMs
      } else {
        // 选区太小，重置
        zoomStartMs = 0
        zoomEndMs = timelineMaxMs
      }

      cleanup()
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      activeCleanups = activeCleanups.filter(c => c !== cleanup)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    activeCleanups.push(cleanup)
  }

  // Zoom 手柄拖拽
  function handleZoomStartDrag(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    isDraggingZoomStart = true

    const handleMove = (moveEvent: MouseEvent) => {
      const newMs = pixelToTimeMs(moveEvent.clientX, zoomTrackEl)
      zoomStartMs = Math.min(newMs, zoomEndMs - 1000)  // 至少保持1秒间隔
    }

    const handleUp = () => {
      isDraggingZoomStart = false
      onZoomChange?.(zoomStartMs, zoomEndMs)
      cleanup()
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      activeCleanups = activeCleanups.filter(c => c !== cleanup)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    activeCleanups.push(cleanup)
  }

  function handleZoomEndDrag(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    isDraggingZoomEnd = true

    const handleMove = (moveEvent: MouseEvent) => {
      const newMs = pixelToTimeMs(moveEvent.clientX, zoomTrackEl)
      zoomEndMs = Math.max(newMs, zoomStartMs + 1000)  // 至少保持1秒间隔
    }

    const handleUp = () => {
      isDraggingZoomEnd = false
      onZoomChange?.(zoomStartMs, zoomEndMs)
      cleanup()
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      activeCleanups = activeCleanups.filter(c => c !== cleanup)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    activeCleanups.push(cleanup)
  }

  // 🔧 重置 Zoom（清除所有区间）
  function resetZoom() {
    zoomActive = false
    zoomStartMs = 0
    zoomEndMs = timelineMaxMs
    onZoomChange?.(0, 0)  // 🔧 传递 (0, 0) 表示清除所有区间
    console.log('🔍 [Timeline] Zoom reset - all intervals cleared')
  }

  // 🆕 删除单个 Zoom 区间
  function handleRemoveZoomInterval(index: number) {
    onZoomRemove?.(index)
    console.log('�️ [Timeline] Zoom interval removed:', index)
  }
</script>

<!-- Timeline Container -->
<div class="timeline-container" role="region" aria-label="Timeline area" onmousemove={handleContainerMouseMove} onmouseleave={handleContainerMouseLeave}>
  <!-- 主时间轴区域 -->
  <div class="timeline-main">
    <!-- 时间刻度 -->
    <div class="time-markers">
      {#each timeMarkers as marker, index (marker.timeMs)}
        <div
          class="marker"
          class:major={marker.isMajor}
          style="left: {marker.position}%"
        >
          {#if marker.isMajor && marker.timeLabel}
            <span
              class="marker-label"
              class:align-right={marker.position >= 95}
              class:align-left={marker.position <= 5}
            >
              {marker.timeLabel}
            </span>
          {/if}
        </div>
      {/each}
    </div>

    <!-- 时间轴轨道 -->
    <div
      class="timeline-track"
      bind:this={timelineTrackEl}
      onclick={handleTimelineClick}
      onkeydown={handleTimelineKeydown}
      role="slider"
      tabindex="0"
      aria-valuemin="0"
      aria-valuemax={timelineMaxMs}
      aria-valuenow={currentTimeMs}
      aria-label="Timeline"
    >
      <!-- 裁剪区域遮罩 -->
      {#if trimEnabled}
        <!-- 左侧遮罩 -->
        <div
          class="trim-overlay trim-overlay-left"
          style="width: {trimStartPercent}%"
        ></div>
        <!-- 右侧遮罩 -->
        <div
          class="trim-overlay trim-overlay-right"
          style="left: {trimEndPercent}%; width: {100 - trimEndPercent}%"
        ></div>
        <!-- 激活区域高亮 -->
        <div
          class="trim-active-region"
          style="left: {trimStartPercent}%; width: {trimEndPercent - trimStartPercent}%"
        ></div>
      {/if}

      <!-- 裁剪手柄 -->
      {#if trimEnabled}
        <!-- 开始手柄 -->
        <button
          class="trim-handle trim-start"
          class:dragging={isDraggingTrimStart}
          style="left: {trimStartPercent}%"
          onmousedown={handleTrimStartDrag}
          aria-label="Trim start"
          title="Drag to set trim start"
        >
          <Scissors class="w-4 h-4 text-white" />
        </button>

        <!-- 结束手柄 -->
        <button
          class="trim-handle trim-end"
          class:dragging={isDraggingTrimEnd}
          style="left: {trimEndPercent}%"
          onmousedown={handleTrimEndDrag}
          aria-label="Trim end"
          title="Drag to set trim end"
        >
          <Scissors class="w-4 h-4 text-white" />
        </button>
      {/if}
    </div>
  </div>

  <!-- 🆕 预览竖线（灰色） - 在播放头之前渲染 -->
  {#if isHoveringTimeline && !isDraggingPlayhead && !isDraggingTrimStart && !isDraggingTrimEnd}
    <div
      class="preview-line-container"
      style="left: {hoverPreviewPercent}%"
    >
      <div class="preview-line"></div>
      <div class="preview-tooltip">
        {formatTimeSec(hoverPreviewTimeMs / 1000)}
      </div>
    </div>
  {/if}

  <!-- Zoom 控制区 -->
  <div class="zoom-control">
    {#if !hasZoomIntervals}
      <!-- 默认提示状态 -->
      <div
        class="zoom-hint"
        bind:this={zoomTrackEl}
        onmousedown={handleZoomTrackMouseDown}
        role="button"
        tabindex="0"
        aria-label="Click and drag to create zoom interval"
      >
        <ZoomIn class="w-4 h-4" />
        <span>Click and drag to create zoom interval</span>
      </div>
    {:else}
      <!-- Zoom 激活状态 - 显示区间列表 -->
      <div class="zoom-active">
        <!-- 标题栏 -->
        <div class="zoom-header">
          <div class="zoom-info">
            <ZoomIn class="w-3.5 h-3.5" />
            <span class="text-xs font-medium">
              Zoom Intervals ({zoomIntervals.length})
            </span>
          </div>
          <button
            class="zoom-reset"
            onclick={resetZoom}
            aria-label="Clear all zoom intervals"
            title="Clear all zoom intervals"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Zoom 缩略时间轴 -->
        <div
          class="zoom-mini-timeline"
          bind:this={zoomTrackEl}

        >
          <!-- 全时间轴背景 -->
          <div class="zoom-full-range"></div>

          <!-- 🆕 显示所有 Zoom 区间 -->
          {#each zoomIntervals as interval, index}
            {@const startPercent = (interval.startMs / timelineMaxMs) * 100}
            {@const widthPercent = ((interval.endMs - interval.startMs) / timelineMaxMs) * 100}

            <div
              class="zoom-interval"
              style="left: {startPercent}%; width: {widthPercent}%"
              title="{formatTimeSec(interval.startMs / 1000)} - {formatTimeSec(interval.endMs / 1000)}"
            >
              <!-- 区间标签 -->
              <span class="zoom-interval-label">
                {index + 1}
              </span>

              <!-- 删除按钮 -->
              <button
                class="zoom-interval-delete"
                onclick={() => handleRemoveZoomInterval(index)}
                aria-label="Remove zoom interval {index + 1}"
                title="Remove this interval"
              >
                <X class="w-3 h-3" />
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- 播放头竖线 - 覆盖整个时间轴包括 zoom 区 -->
  <div
    class="playhead-container"
    style="left: {playheadPercent}%"
  >
    <!-- 竖线 -->
    <div
      class="playhead-line"
      class:playing={isPlaying}
      class:paused={!isPlaying}
      onmousedown={handlePlayheadMouseDown}
      role="button"
      tabindex="0"
      aria-label="Playhead"
    ></div>

    <!-- 时间气泡提示 -->
    <div class="playhead-tooltip">
      {currentTimeLabel}
    </div>
  </div>
</div>

<style>
  /* ========== 时间轴容器 ========== */
  .timeline-container {
    position: relative;
    width: 100%;
    padding: 1rem;
    background: linear-gradient(to bottom, #1f2937, #111827); /* 深色渐变背景 */
    border-radius: 0.5rem;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.3),
      0 2px 4px -1px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.05); /* 内部高光 */
  }

  /* ========== 主时间轴区域 ========== */
  .timeline-main {
    margin-bottom: 0.75rem; /* mb-3 */
  }

  /* ========== 时间刻度 ========== */
  .time-markers {
    position: relative;
    width: 100%;
    height: 2.5rem; /* h-10 - 增加高度以容纳标签 */
    margin-bottom: 0.5rem; /* mb-2 */
    padding-right: 1.5rem; /* 为最后刻度标签留空间 */
    padding-left: 1.5rem; /* 为第一个刻度标签留空间 */
    box-sizing: border-box;
  }

  .marker {
    position: absolute;
    bottom: 0; /* 从底部开始 */
    transform: translateX(-50%);
  }

  /* 主要刻度 */
  .marker.major {
    height: 0.5rem; /* h-2 */
    border-left: 2px solid #9ca3af; /* 浅灰色，在深色背景下清晰 */
  }

  .marker-label {
    position: absolute;
    bottom: 0.75rem; /* 在刻度线上方 */
    left: 50%;
    transform: translateX(-50%);
    width: 3rem; /* w-12 */
    text-align: center;
    font-size: 0.75rem; /* text-xs */
    font-family: ui-monospace, monospace; /* font-mono */
    font-weight: 500;
    color: #d1d5db; /* 浅灰色文字，在深色背景下清晰 */
    white-space: nowrap;
  }

  /* 最后刻度标签右对齐 */
  .marker-label.align-right {
    left: auto;
    right: 0;
    transform: none;
  }

  /* 第一个刻度标签左对齐 */
  .marker-label.align-left {
    left: 0;
    transform: none;
  }

  /* 次要刻度 */
  .marker:not(.major) {
    height: 0.25rem; /* h-1 */
    border-left: 1px solid #6b7280; /* 中灰色 */
  }

  /* ========== 时间轴轨道 ========== */
  .timeline-track {
    position: relative;
    width: 100%;
    height: 2.5rem; /* 增加高度 */
    background: linear-gradient(to bottom, #374151, #1f2937); /* 深色渐变背景 */
    border: 1px solid #4b5563;
    border-radius: 0.375rem; /* 更圆润 */
    cursor: pointer;
    overflow: visible;
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.05); /* 内部高光 */
    transition: all 0.2s ease;
  }

  .timeline-track:hover {
    border-color: #6b7280;
    background: linear-gradient(to bottom, #3f4a5a, #252f3f);
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  /* ========== 裁剪遮罩 ========== */
  .trim-overlay {
    position: absolute;
    top: 0;
    height: 100%;
    background: repeating-linear-gradient(
      45deg,
      rgba(0, 0, 0, 0.4),
      rgba(0, 0, 0, 0.4) 10px,
      rgba(0, 0, 0, 0.6) 10px,
      rgba(0, 0, 0, 0.6) 20px
    ); /* 深色斜纹图案 */
    pointer-events: none;
    backdrop-filter: blur(1px);
  }

  .trim-overlay-left {
    left: 0;
    border-radius: 0.375rem 0 0 0.375rem; /* rounded-l */
  }

  .trim-overlay-right {
    border-radius: 0 0.375rem 0.375rem 0; /* rounded-r */
  }

  .trim-active-region {
    position: absolute;
    top: 0;
    height: 100%;
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.25), rgba(37, 99, 235, 0.35)); /* 更亮的渐变高亮 */
    border-top: 2px solid rgba(59, 130, 246, 0.7);
    border-bottom: 2px solid rgba(59, 130, 246, 0.7);
    pointer-events: none;
  }

  /* ========== 裁剪手柄 ========== */
  .trim-handle {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 2.5rem; /* 增大尺寸 */
    height: 2.5rem;
    background: linear-gradient(135deg, #3b82f6, #2563eb); /* 渐变背景 */
    border: 2px solid white;
    border-radius: 50%;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 2px 4px -1px rgba(0, 0, 0, 0.06),
      0 0 0 3px rgba(59, 130, 246, 0.2); /* 外发光 */
    cursor: ew-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    z-index: 35; /* 高于预览线和播放头 */
    pointer-events: auto; /* 确保可以接收鼠标事件 */
  }

  .trim-handle:hover {
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    transform: translate(-50%, -50%) scale(1.1);
    box-shadow:
      0 10px 15px -3px rgba(0, 0, 0, 0.1),
      0 4px 6px -2px rgba(0, 0, 0, 0.05),
      0 0 0 4px rgba(59, 130, 246, 0.3);
  }

  .trim-handle.dragging {
    background: linear-gradient(135deg, #1d4ed8, #1e40af);
    transform: translate(-50%, -50%) scale(1.15);
    box-shadow:
      0 20px 25px -5px rgba(0, 0, 0, 0.1),
      0 10px 10px -5px rgba(0, 0, 0, 0.04),
      0 0 0 5px rgba(59, 130, 246, 0.4);
  }

  /* ========== Zoom 控制区 ========== */
  .zoom-control {
    margin-top: 0.75rem; /* mt-3 */
    padding-top: 0.75rem; /* pt-3 */
    border-top: 1px solid #374151; /* 深色分隔线 */
  }

  /* Zoom 提示 */
  .zoom-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem; /* gap-2 */
    padding: 0.75rem;
    font-size: 0.875rem; /* text-sm */
    font-weight: 500;
    color: #9ca3af;
    background: rgba(31, 41, 55, 0.5); /* 半透明深色背景 */
    border: 1px dashed #4b5563;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
  }

  .zoom-hint:hover {
    color: #60a5fa;
    border-color: #60a5fa;
    background: rgba(37, 99, 235, 0.1);
  }

  /* Zoom 激活状态 */
  .zoom-active {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(31, 41, 55, 0.5);
    border: 1px solid #4b5563;
    border-radius: 0.375rem;
  }

  .zoom-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.25rem;
  }

  .zoom-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #d1d5db;
    font-weight: 500;
  }

  .zoom-reset {
    padding: 0.375rem;
    color: #9ca3af;
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .zoom-reset:hover {
    color: #f87171;
    background-color: rgba(239, 68, 68, 0.1);
  }

  /* Zoom 缩略时间轴 */
  .zoom-mini-timeline {
    position: relative;
    width: 100%;
    height: 3rem; /* h-12 */
    background: linear-gradient(to bottom, #374151, #1f2937);
    border: 1px solid #4b5563;
    border-radius: 0.375rem;
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  .zoom-full-range {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, #1f2937, #111827);
    opacity: 0.5;
    border-radius: 0.375rem;
  }

  .zoom-selected-range {
    position: absolute;
    top: 0;
    height: 100%;
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.3), rgba(37, 99, 235, 0.4));
    border: 2px solid #60a5fa;
    border-radius: 0.375rem;
    cursor: move;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }

  /* Zoom 手柄 */
  .zoom-handle {
    position: absolute;
    top: 0;
    width: 0.875rem; /* 稍微加宽 */
    height: 100%;
    background: linear-gradient(to bottom, #60a5fa, #3b82f6);
    cursor: ew-resize;
    transition: all 0.2s ease;
    border: none;
  }

  .zoom-handle:hover,
  .zoom-handle.dragging {
    background: linear-gradient(to bottom, #3b82f6, #2563eb);
    box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.4);
  }

  .zoom-handle-start {
    left: 0;
    border-radius: 0.375rem 0 0 0.375rem;
  }

  .zoom-handle-end {
    right: 0;
    border-radius: 0 0.375rem 0.375rem 0;
  }

  /* 🆕 Zoom 区间块 */
  .zoom-interval {
    position: absolute;
    top: 0;
    height: 100%;
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.4), rgba(37, 99, 235, 0.5));
    border: 2px solid #3b82f6;
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.5rem;
    gap: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    overflow: hidden;
  }

  .zoom-interval:hover {
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.6), rgba(37, 99, 235, 0.7));
    border-color: #60a5fa;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
  }

  .zoom-interval-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    flex-shrink: 0;
  }

  .zoom-interval-delete {
    padding: 0.25rem;
    background: rgba(239, 68, 68, 0.8);
    border: none;
    border-radius: 0.25rem;
    color: white;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s ease;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .zoom-interval:hover .zoom-interval-delete {
    opacity: 1;
  }

  .zoom-interval-delete:hover {
    background: rgba(220, 38, 38, 1);
  }

  /* ========== 预览竖线（灰色） ========== */
  .preview-line-container {
    position: absolute;
    top: 0;
    bottom: 0;
    transform: translateX(-50%);
    z-index: 25; /* 低于播放头 */
    pointer-events: none;
  }

  .preview-line {
    width: 2px;
    height: 100%;
    background: linear-gradient(to bottom, #9ca3af, #6b7280);
    opacity: 0.8;
    border-radius: 1px;
    box-shadow: 0 0 4px rgba(156, 163, 175, 0.4);
  }

  .preview-tooltip {
    position: absolute;
    top: -2rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.25rem 0.5rem;
    background: rgba(107, 114, 128, 0.95);
    color: white;
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: 0.25rem;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  /* ========== 播放头竖线（覆盖整个时间轴） ========== */
  .playhead-container {
    position: absolute;
    top: 0;
    bottom: 0;
    transform: translateX(-50%);
    z-index: 30;
    pointer-events: none;
  }

  .playhead-line {
    width: 3px; /* 加粗 */
    height: 100%;
    cursor: ew-resize;
    pointer-events: auto;
    transition: all 0.2s ease;
    border-radius: 1.5px;
  }

  /* 播放中：红色 + 脉冲动画 */
  .playhead-line.playing {
    background: linear-gradient(to bottom, #ef4444, #dc2626);
    box-shadow:
      0 0 8px rgba(239, 68, 68, 0.6),
      0 0 16px rgba(239, 68, 68, 0.3);
    animation: pulse-glow 2s ease-in-out infinite;
  }

  /* 暂停：蓝色 */
  .playhead-line.paused {
    background: linear-gradient(to bottom, #3b82f6, #2563eb);
    box-shadow:
      0 0 6px rgba(59, 130, 246, 0.6),
      0 0 12px rgba(59, 130, 246, 0.3);
  }

  .playhead-line:hover {
    transform: scaleX(1.5);
  }

  /* 时间气泡 */
  .playhead-tooltip {
    position: absolute;
    top: -2.5rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.375rem 0.625rem;
    background: linear-gradient(135deg, #1f2937, #111827);
    color: white;
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
    font-weight: 600;
    border-radius: 0.375rem;
    box-shadow:
      0 10px 15px -3px rgba(0, 0, 0, 0.2),
      0 4px 6px -2px rgba(0, 0, 0, 0.1),
      0 0 0 1px rgba(255, 255, 255, 0.1);
    white-space: nowrap;
    pointer-events: none;
    /* 🔧 优化：默认隐藏，仅在悬停时显示，避免遮挡上方内容 */
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }

  /* 🔧 悬停播放头时显示时间气泡 */
  .playhead-container:hover .playhead-tooltip {
    opacity: 1;
    visibility: visible;
  }

  .playhead-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-top-color: #111827;
  }

  /* ========== 动画 ========== */
  @keyframes pulse-glow {
    0%, 100% {
      box-shadow:
        0 0 8px rgba(239, 68, 68, 0.6),
        0 0 16px rgba(239, 68, 68, 0.3);
    }
    50% {
      box-shadow:
        0 0 12px rgba(239, 68, 68, 0.8),
        0 0 24px rgba(239, 68, 68, 0.5);
    }
  }
</style>
