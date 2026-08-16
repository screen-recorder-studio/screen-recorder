<!-- Timeline Component - Professional video editing timeline with time markers, playhead, trim handles, and zoom -->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { X, Crosshair } from '@lucide/svelte'
  import {
    clampTrimEnd,
    clampTrimStart,
    parseTrimSecondsInput,
    resolveTrimKeyboardValue
  } from '$lib/studio/trim-boundary'
  import {
    resolvePaddedTimelinePositionCss,
    TIMELINE_CONTENT_INSET_REM
  } from '$lib/studio/timeline-coordinate'

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
    onZoomChange?: (startMs: number, endMs: number) => Promise<boolean>  // ✅ P0 修复：返回 Promise
    onZoomRemove?: (index: number) => Promise<void> // ✅ P0 修复：返回 Promise
    onZoomIntervalMove?: (index: number, newStartMs: number, newEndMs: number) => Promise<boolean>  // ✅ P0 修复：返回 Promise
    onHoverPreview?: (timeMs: number) => void      // 鼠标悬停预览
    onHoverPreviewEnd?: () => void                 // 预览结束
    onZoomFocusSetup?: (index: number) => void              // 🆕 设置区间焦点

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
    onZoomIntervalMove,
    onZoomFocusSetup,

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
  
  // 🆕 Local state for smoother trim dragging
  let draggingTrimStartMs = $state(0)
  let draggingTrimEndMs = $state(0)

  // 🆕 Zoom 区间拖拽状态
  let draggingZoomIndex = $state<number | null>(null)

  let draggingZoomStartMs = $state(0)
  let draggingZoomEndMs = $state(0)
  let draggingZoomType = $state<'move' | 'resize-start' | 'resize-end' | null>(null) // 拖拽类型

  // 🔍 调试：监听拖拽状态变化（可选，用于调试）
  // $effect(() => {
  //   if (draggingZoomIndex !== null) {
  //     console.log('🔍 [Timeline] Dragging state changed:', {
  //       index: draggingZoomIndex,
  //       type: draggingZoomType,
  //       startMs: draggingZoomStartMs,
  //       endMs: draggingZoomEndMs
  //     })
  //   } else {
  //     console.log('🔍 [Timeline] Dragging state cleared')
  //   }
  // })

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
  const trimStartPercent = $derived.by(() => {
    const ms = isDraggingTrimStart ? draggingTrimStartMs : trimStartMs
    return timelineMaxMs > 0 ? (ms / timelineMaxMs) * 100 : 0
  })
  
  const trimEndPercent = $derived.by(() => {
    if (timelineMaxMs <= 0) return 100
    const ms = isDraggingTrimEnd ? draggingTrimEndMs : (trimEndMs > 0 ? trimEndMs : timelineMaxMs)
    return (ms / timelineMaxMs) * 100
  })

  const effectiveTrimEndMs = $derived(trimEndMs > 0 ? trimEndMs : timelineMaxMs)

  // 🆕 计算预览位置百分比
  const hoverPreviewPercent = $derived(timelineMaxMs > 0 ? (hoverPreviewTimeMs / timelineMaxMs) * 100 : 0)
  const playheadLeft = $derived(resolvePaddedTimelinePositionCss(playheadPercent, TIMELINE_CONTENT_INSET_REM))
  const hoverPreviewLeft = $derived(resolvePaddedTimelinePositionCss(hoverPreviewPercent, TIMELINE_CONTENT_INSET_REM))

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
    // 🔧 修复：添加更细粒度的间隔支持短视频
    const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

    // 目标：生成 3-12 个主刻度（放宽范围，支持更多视频时长）
    const minTicks = 3
    const maxTicks = 12
    const idealTicks = 6

    let bestMajor = 1
    let bestScore = -Infinity

    for (const interval of candidates) {
      // 计算该间隔会生成多少个刻度（包括起点和终点）
      const tickCount = Math.floor(durationSec / interval) + 1

      // 🔧 修复：不再硬性跳过，而是用惩罚分数
      let score = 0

      // 1. 刻度数接近理想值（权重：40%）
      const tickDiff = Math.abs(tickCount - idealTicks)
      score += Math.max(0, (1 - tickDiff / idealTicks)) * 40

      // 2. 刻度数在可接受范围内加分（权重：30%）
      if (tickCount >= minTicks && tickCount <= maxTicks) {
        score += 30
      } else if (tickCount >= 2 && tickCount <= 15) {
        // 稍微超出范围但仍可接受
        score += 15
      }

      // 3. 能否整除视频时长（权重：20%）
      const remainder = durationSec % interval
      const divisibilityScore = (1 - remainder / interval) * 20
      score += divisibilityScore

      // 4. 间隔是否常见（权重：10%）
      const commonIntervals = [1, 2, 5, 10, 30, 60]
      if (commonIntervals.includes(interval)) {
        score += 10
      }

      // 🔧 修复：始终更新最佳选项（不再硬性跳过）
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
    } else if (bestMajor >= 1) {
      bestMinor = bestMajor / 2  // 1-2秒用 1/2
    } else {
      bestMinor = bestMajor / 2  // 0.5秒用 0.25秒
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

    // 🔧 处理结束点刻度 - 保持视觉韵律一致
    // 策略：如果结束点距离最后一个常规刻度太近，替换它而非添加新刻度
    const endLabel = formatTimeSec(durationSec)
    const endPosition = 100
    
    // 找到最接近末尾的主刻度
    let lastMajorKey: string | null = null
    let lastMajorMarker: TimeMarker | null = null
    
    for (const [key, marker] of markerMap.entries()) {
      if (marker.isMajor) {
        if (!lastMajorMarker || marker.timeSec > lastMajorMarker.timeSec) {
          lastMajorKey = key
          lastMajorMarker = marker
        }
      }
    }
    
    // 计算结束点与最后一个主刻度的距离
    const distanceToEnd = lastMajorMarker ? (durationSec - lastMajorMarker.timeSec) : durationSec
    const threshold = major * 0.5  // 阈值：间隔的 50%
    
    if (lastMajorMarker && distanceToEnd < threshold && distanceToEnd > 0.01) {
      // 🔧 距离太近（< 50% 间隔）：替换最后一个刻度为结束点刻度
      // 这样保持刻度间距的视觉一致性
      if (lastMajorKey) {
        markerMap.delete(lastMajorKey)
      }
      const endKey = `end-marker-${durationSec.toFixed(3)}`
      markerMap.set(endKey, {
        timeSec: durationSec,
        timeMs: durationSec * 1000,
        timeLabel: endLabel,
        isMajor: true,
        position: endPosition
      })
    } else if (distanceToEnd >= threshold) {
      // 🔧 距离足够远（>= 50% 间隔）：添加结束点刻度
      const endKey = `end-marker-${durationSec.toFixed(3)}`
      markerMap.set(endKey, {
        timeSec: durationSec,
        timeMs: durationSec * 1000,
        timeLabel: endLabel,
        isMajor: true,
        position: endPosition
      })
    }
    // 如果 distanceToEnd ≈ 0（结束点正好在刻度上），不需要添加

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

  // 格式化时间 - 智能格式（整秒用 MM:SS，非整秒用 MM:SS.s）
  function formatTimeSec(sec: number, forceDecimal: boolean = false): string {
    const total = Math.max(0, sec)
    const mm = Math.floor(total / 60)
    const ss = Math.floor(total % 60)
    const decimal = total % 1
    
    const base = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    
    // 🔧 智能格式：非整秒时显示十分位
    if (forceDecimal || decimal >= 0.05) {
      // 四舍五入到十分位
      const tenths = Math.round(decimal * 10)
      if (tenths > 0 && tenths < 10) {
        return `${base}.${tenths}`
      }
    }
    
    return base
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
    if (!zoomTrackEl || isProcessing) {
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
    if (!isHoveringTimeline) return

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
    // Initialize local state to current props
    draggingTrimStartMs = trimStartMs
    
    // Snapshot initial values for delta calculation
    const startX = e.clientX
    const initialStartMs = trimStartMs
    const currentEndMs = trimEndMs > 0 ? trimEndMs : timelineMaxMs

    const handleMove = (moveEvent: MouseEvent) => {
      if (!timelineTrackEl) return
      
      const deltaX = moveEvent.clientX - startX
      const trackWidth = timelineTrackEl.getBoundingClientRect().width
      const deltaMs = (deltaX / trackWidth) * timelineMaxMs
      
      // Calculate new position based on initial + delta (prevents jumping)
      let newStartMs = initialStartMs + deltaMs
      
      // Apply constraints
      // Min: 0
      // Max: currentEndMs - 100 (min duration)
      newStartMs = clampTrimStart(newStartMs, currentEndMs, timelineMaxMs)
      
      // Update local state for smooth UI
      draggingTrimStartMs = newStartMs
      
      // Notify parent for preview
      onTrimStartChange?.(newStartMs)
      onSeek?.(newStartMs)
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
    // Initialize local state
    const currentEndMs = trimEndMs > 0 ? trimEndMs : timelineMaxMs
    draggingTrimEndMs = currentEndMs
    
    // Snapshot initial values
    const startX = e.clientX
    const initialEndMs = currentEndMs
    const currentStartMs = trimStartMs

    const handleMove = (moveEvent: MouseEvent) => {
      if (!timelineTrackEl) return

      const deltaX = moveEvent.clientX - startX
      const trackWidth = timelineTrackEl.getBoundingClientRect().width
      const deltaMs = (deltaX / trackWidth) * timelineMaxMs
      
      // Calculate new position based on initial + delta
      let newEndMs = initialEndMs + deltaMs
      
      // Apply constraints
      // Min: currentStartMs + 100 (min duration)
      // Max: timelineMaxMs
      newEndMs = clampTrimEnd(newEndMs, currentStartMs, timelineMaxMs)
      
      // Update local state for smooth UI
      draggingTrimEndMs = newEndMs
      
      // Notify parent for preview
      onTrimEndChange?.(newEndMs)
      onSeek?.(newEndMs)
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

  // 🆕 Keyboard Nudge for Trim Handles
  function handleTrimStartKeydown(e: KeyboardEvent) {
    if (isProcessing) return
    const newStartMs = resolveTrimKeyboardValue({
      boundary: 'start',
      key: e.key,
      currentMs: trimStartMs,
      otherMs: effectiveTrimEndMs,
      timelineMaxMs,
      frameRate,
      shiftKey: e.shiftKey
    })
    if (newStartMs === null) return
    e.preventDefault()
    e.stopPropagation()
    onTrimStartChange?.(newStartMs)
    onSeek?.(newStartMs)
  }

  function handleTrimEndKeydown(e: KeyboardEvent) {
    if (isProcessing) return
    const newEndMs = resolveTrimKeyboardValue({
      boundary: 'end',
      key: e.key,
      currentMs: effectiveTrimEndMs,
      otherMs: trimStartMs,
      timelineMaxMs,
      frameRate,
      shiftKey: e.shiftKey
    })
    if (newEndMs === null) return
    e.preventDefault()
    e.stopPropagation()
    onTrimEndChange?.(newEndMs)
    onSeek?.(newEndMs)
  }

  function handleTrimStartInput(e: Event) {
    const valueMs = parseTrimSecondsInput((e.currentTarget as HTMLInputElement).valueAsNumber)
    if (valueMs === null) return
    const newStartMs = clampTrimStart(valueMs, effectiveTrimEndMs, timelineMaxMs)
    onTrimStartChange?.(newStartMs)
    onSeek?.(newStartMs)
  }

  function handleTrimEndInput(e: Event) {
    const valueMs = parseTrimSecondsInput((e.currentTarget as HTMLInputElement).valueAsNumber)
    if (valueMs === null) return
    const newEndMs = clampTrimEnd(valueMs, trimStartMs, timelineMaxMs)
    onTrimEndChange?.(newEndMs)
    onSeek?.(newEndMs)
  }

  // ========== Zoom 功能 ==========

  // 默认 Zoom 时长（1500ms，足够宽以容纳按钮）
  const DEFAULT_ZOOM_DURATION_MS = 1500
  // 最小 Zoom 时长（100ms，约 3 帧 @ 30fps）
  const MIN_ZOOM_DURATION_MS = 100

  // 点击创建默认 1500ms 的 Zoom 区间
  async function handleZoomTrackClick(e: MouseEvent) {
    if (!zoomTrackEl) return

    // 🔧 区分点击和拖拽：如果是在已有区间上，不创建新区间
    const target = e.target as HTMLElement
    if (target.closest('.zoom-interval')) {
      return  // 点击在区间上，由区间的拖拽处理
    }

    e.preventDefault()

    // ✅ 使用当前 hover 的对齐时间（已经是帧边界）
    const startMs = hoverPreviewTimeMs
    const endMs = Math.min(startMs + DEFAULT_ZOOM_DURATION_MS, timelineMaxMs)

    // 边界检查
    if (endMs > timelineMaxMs) {
      console.warn('⚠️ [Timeline] Cannot create zoom interval: exceeds timeline duration')
      return
    }

    // ✅ P0 修复：等待配置更新完成
    const success = await onZoomChange?.(startMs, endMs)

    if (success) {
      console.log(`✅ [Timeline] Zoom interval created: ${formatTimeSec(startMs / 1000)} - ${formatTimeSec(endMs / 1000)}`)
    } else {
      console.warn('⚠️ [Timeline] Zoom interval rejected (overlap)')
    }
  }

	  // 键盘创建 Zoom 区间（Enter / Space）
	  async function handleZoomTrackKeydown(e: KeyboardEvent) {
	    if (isProcessing) return
	    if (e.key === 'Enter' || e.key === ' ') {
	      e.preventDefault()
	      // 使用悬停预览时间（若不可用则回退到当前时间），并做帧对齐
	      const base = hoverPreviewTimeMs > 0 ? hoverPreviewTimeMs : currentTimeMs
	      const startMs = alignToFrameMs(base)
	      const endMs = Math.min(startMs + DEFAULT_ZOOM_DURATION_MS, timelineMaxMs)
	      if (endMs <= timelineMaxMs) {
	        const success = await onZoomChange?.(startMs, endMs)
	        if (success) {
	          console.log(`✅ [Timeline] Zoom interval created via keyboard: ${formatTimeSec(startMs / 1000)} - ${formatTimeSec(endMs / 1000)}`)
	        } else {
	          console.warn('⚠️ [Timeline] Zoom interval rejected (overlap)')
	        }
	      }
	    }
	  }


  // 🆕 拖拽整个 Zoom 区间（移动位置）
  function handleZoomIntervalDrag(e: MouseEvent, intervalIndex: number) {
    e.preventDefault()
    e.stopPropagation()

    const interval = zoomIntervals[intervalIndex]
    const duration = interval.endMs - interval.startMs
    const startX = e.clientX
    const initialStartMs = interval.startMs

    // 🆕 设置拖拽状态（用于实时 UI 更新）
    draggingZoomIndex = intervalIndex
    draggingZoomType = 'move'
    draggingZoomStartMs = initialStartMs
    draggingZoomEndMs = interval.endMs

    const handleMove = (moveEvent: MouseEvent) => {
      if (!zoomTrackEl) return

      const deltaX = moveEvent.clientX - startX
      const trackWidth = zoomTrackEl.getBoundingClientRect().width
      const deltaMs = (deltaX / trackWidth) * timelineMaxMs

      let newStartMs = initialStartMs + deltaMs
      let newEndMs = newStartMs + duration

      // 边界检查
      if (newStartMs < 0) {
        newStartMs = 0
        newEndMs = duration
      }
      if (newEndMs > timelineMaxMs) {
        newEndMs = timelineMaxMs
        newStartMs = timelineMaxMs - duration
      }

      // 🆕 实时更新拖拽位置（UI 会响应式更新）
      draggingZoomStartMs = newStartMs
      draggingZoomEndMs = newEndMs
    }

    const handleUp = async () => {
      // 🔧 先移除事件监听器，防止重复触发
      cleanup()

      // 🆕 然后处理拖拽结束逻辑
      if (draggingZoomIndex !== null) {
        // 🆕 帧对齐：对齐到最近的帧边界
        const alignedStartMs = alignToFrameMs(draggingZoomStartMs)
        const alignedEndMs = alignToFrameMs(draggingZoomEndMs)

        // ✅ P0 修复：等待配置更新完成
        const success = await onZoomIntervalMove?.(intervalIndex, alignedStartMs, alignedEndMs)
        if (success) {
          console.log(`✅ [Timeline] Zoom interval moved: ${formatTimeSec(alignedStartMs / 1000)} - ${formatTimeSec(alignedEndMs / 1000)}`)
        } else {
          console.warn('⚠️ [Timeline] Zoom interval move rejected (overlap)')
        }
      }

      // 🆕 最后清除拖拽状态
      draggingZoomIndex = null
      draggingZoomType = null
      draggingZoomStartMs = 0
      draggingZoomEndMs = 0
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

  // 🆕 拖拽 Zoom 区间的开始边界（调整起始时间）
  function handleZoomStartResize(e: MouseEvent, intervalIndex: number) {
    e.preventDefault()
    e.stopPropagation()

    const interval = zoomIntervals[intervalIndex]
    const startX = e.clientX
    const initialStartMs = interval.startMs
    const fixedEndMs = interval.endMs

    // 🆕 设置拖拽状态
    draggingZoomIndex = intervalIndex
    draggingZoomType = 'resize-start'
    draggingZoomStartMs = initialStartMs
    draggingZoomEndMs = fixedEndMs

    const handleMove = (moveEvent: MouseEvent) => {
      if (!zoomTrackEl) return

      const deltaX = moveEvent.clientX - startX
      const trackWidth = zoomTrackEl.getBoundingClientRect().width
      const deltaMs = (deltaX / trackWidth) * timelineMaxMs

      let newStartMs = initialStartMs + deltaMs

      // 边界检查：不能超过结束时间（保持最小时长）
      const maxStartMs = fixedEndMs - MIN_ZOOM_DURATION_MS
      newStartMs = Math.max(0, Math.min(newStartMs, maxStartMs))

      // 实时更新
      draggingZoomStartMs = newStartMs
      draggingZoomEndMs = fixedEndMs
    }

    const handleUp = async () => {
      cleanup()

      if (draggingZoomIndex !== null) {
        const alignedStartMs = alignToFrameMs(draggingZoomStartMs)
        const alignedEndMs = alignToFrameMs(draggingZoomEndMs)

        // 确保最小时长
        if (alignedEndMs - alignedStartMs >= MIN_ZOOM_DURATION_MS) {
          // ✅ P0 修复：等待配置更新完成
          const success = await onZoomIntervalMove?.(intervalIndex, alignedStartMs, alignedEndMs)
          if (success) {
            console.log(`✅ [Timeline] Zoom interval resized (start): ${formatTimeSec(alignedStartMs / 1000)} - ${formatTimeSec(alignedEndMs / 1000)}`)
          }
        } else {
          console.warn('⚠️ [Timeline] Zoom interval too short, reverting')
        }
      }

      draggingZoomIndex = null
      draggingZoomType = null
      draggingZoomStartMs = 0
      draggingZoomEndMs = 0
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

  // 🆕 拖拽 Zoom 区间的结束边界（调整结束时间）
  function handleZoomEndResize(e: MouseEvent, intervalIndex: number) {
    e.preventDefault()
    e.stopPropagation()

    const interval = zoomIntervals[intervalIndex]
    const startX = e.clientX
    const fixedStartMs = interval.startMs
    const initialEndMs = interval.endMs

    // 🆕 设置拖拽状态
    draggingZoomIndex = intervalIndex
    draggingZoomType = 'resize-end'
    draggingZoomStartMs = fixedStartMs
    draggingZoomEndMs = initialEndMs

    const handleMove = (moveEvent: MouseEvent) => {
      if (!zoomTrackEl) return

      const deltaX = moveEvent.clientX - startX
      const trackWidth = zoomTrackEl.getBoundingClientRect().width
      const deltaMs = (deltaX / trackWidth) * timelineMaxMs

      let newEndMs = initialEndMs + deltaMs

      // 边界检查：不能小于开始时间（保持最小时长）
      const minEndMs = fixedStartMs + MIN_ZOOM_DURATION_MS
      newEndMs = Math.min(timelineMaxMs, Math.max(newEndMs, minEndMs))

      // 实时更新
      draggingZoomStartMs = fixedStartMs
      draggingZoomEndMs = newEndMs
    }

    const handleUp = async () => {
      cleanup()

      if (draggingZoomIndex !== null) {
        const alignedStartMs = alignToFrameMs(draggingZoomStartMs)
        const alignedEndMs = alignToFrameMs(draggingZoomEndMs)

        // 确保最小时长
        if (alignedEndMs - alignedStartMs >= MIN_ZOOM_DURATION_MS) {
          // ✅ P0 修复：等待配置更新完成
          const success = await onZoomIntervalMove?.(intervalIndex, alignedStartMs, alignedEndMs)
          if (success) {
            console.log(`✅ [Timeline] Zoom interval resized (end): ${formatTimeSec(alignedStartMs / 1000)} - ${formatTimeSec(alignedEndMs / 1000)}`)
          }
        } else {
          console.warn('⚠️ [Timeline] Zoom interval too short, reverting')
        }
      }

      draggingZoomIndex = null
      draggingZoomType = null
      draggingZoomStartMs = 0
      draggingZoomEndMs = 0
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
  async function resetZoom() {
    // ✅ P0 修复：等待配置更新完成
    await onZoomChange?.(0, 0)  // 🔧 传递 (0, 0) 表示清除所有区间
    console.log('🔍 [Timeline] Zoom reset - all intervals cleared')
  }

  // 🆕 删除单个 Zoom 区间
  async function handleRemoveZoomInterval(index: number) {
    // ✅ P0 修复：等待配置更新完成
    await onZoomRemove?.(index)
    console.log('�️ [Timeline] Zoom interval removed:', index)
  }
</script>

<!-- Timeline Container -->
<div
  class="timeline-container"
  style={`--timeline-content-inset: ${TIMELINE_CONTENT_INSET_REM}rem`}
  role="region"
  aria-label="Timeline area"
  onmousemove={handleContainerMouseMove}
  onmouseleave={handleContainerMouseLeave}
>
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
          onkeydown={handleTrimStartKeydown}
          role="slider"
          aria-orientation="horizontal"
          aria-valuemin="0"
          aria-valuemax={Math.max(0, effectiveTrimEndMs - 100)}
          aria-valuenow={Math.round(trimStartMs)}
          aria-valuetext={`Trim start ${formatTimeSec(trimStartMs / 1000)}`}
          aria-label="Trim start"
          title="Drag to set trim start"
        ></button>

        <!-- 结束手柄 -->
        <button
          class="trim-handle trim-end"
          class:dragging={isDraggingTrimEnd}
          style="left: {trimEndPercent}%"
          onmousedown={handleTrimEndDrag}
          onkeydown={handleTrimEndKeydown}
          role="slider"
          aria-orientation="horizontal"
          aria-valuemin={Math.min(timelineMaxMs, trimStartMs + 100)}
          aria-valuemax={timelineMaxMs}
          aria-valuenow={Math.round(effectiveTrimEndMs)}
          aria-valuetext={`Trim end ${formatTimeSec(effectiveTrimEndMs / 1000)}`}
          aria-label="Trim end"
          title="Drag to set trim end"
        ></button>
      {/if}
    </div>

    {#if trimEnabled}
      <div class="trim-value-controls" aria-label="Trim range values">
        <label>
          <span>Start</span>
          <input
            type="number"
            min="0"
            max={Math.max(0, (effectiveTrimEndMs - 100) / 1000)}
            step="0.01"
            value={(trimStartMs / 1000).toFixed(2)}
            aria-label="Trim start time in seconds"
            onchange={handleTrimStartInput}
          />
          <span>s</span>
        </label>
        <label>
          <span>End</span>
          <input
            type="number"
            min={Math.min(timelineMaxMs, trimStartMs + 100) / 1000}
            max={timelineMaxMs / 1000}
            step="0.01"
            value={(effectiveTrimEndMs / 1000).toFixed(2)}
            aria-label="Trim end time in seconds"
            onchange={handleTrimEndInput}
          />
          <span>s</span>
        </label>
      </div>
    {/if}
  </div>

  <!-- 🆕 预览竖线（灰色） - 在播放头之前渲染 -->
  {#if isHoveringTimeline && !isDraggingPlayhead && !isDraggingTrimStart && !isDraggingTrimEnd}
    <div
      class="preview-line-container"
      style="left: {hoverPreviewLeft}"
    >
      <div class="preview-line"></div>
      <div class="preview-tooltip">
        {formatTimeSec(hoverPreviewTimeMs / 1000)}
      </div>
    </div>
  {/if}

  <!-- Zoom 控制区 -->
  {#if hasZoomIntervals}
    <div class="zoom-active">
      <!-- Zoom 缩略时间轴 -->
      <div
        class="zoom-mini-timeline"
        bind:this={zoomTrackEl}
        onclick={handleZoomTrackClick}
        onkeydown={handleZoomTrackKeydown}
        role="button"
        tabindex="0"
        aria-label="Click to create zoom interval"
      >
        <!-- 全时间轴背景 -->
        <div class="zoom-full-range"></div>

        <!-- 🆕 显示所有 Zoom 区间 -->
        {#each zoomIntervals as interval, index}
          <!-- 🆕 如果正在拖拽当前区间，使用拖拽位置；否则使用实际位置 -->
          {@const isDragging = draggingZoomIndex === index}
          {@const displayStartMs = isDragging ? draggingZoomStartMs : interval.startMs}
          {@const displayEndMs = isDragging ? draggingZoomEndMs : interval.endMs}
          {@const startPercent = (displayStartMs / timelineMaxMs) * 100}
          {@const widthPercent = ((displayEndMs - displayStartMs) / timelineMaxMs) * 100}
          {@const durationMs = displayEndMs - displayStartMs}

          <div
            class="zoom-interval"
            class:dragging={isDragging}
            class:moving={isDragging && draggingZoomType === 'move'}
            class:resizing={isDragging && (draggingZoomType === 'resize-start' || draggingZoomType === 'resize-end')}
            style="left: {startPercent}%; width: {widthPercent}%"
            title="{formatTimeSec(displayStartMs / 1000)} - {formatTimeSec(displayEndMs / 1000)} ({durationMs}ms)"
            onmousedown={(e) => handleZoomIntervalDrag(e, index)}
            role="button"
            tabindex="0"
            aria-label="Zoom interval {index + 1}"
          >
            <!-- 🆕 左侧调整手柄 -->
            <div
              class="zoom-resize-handle zoom-resize-handle-start"
              onmousedown={(e) => handleZoomStartResize(e, index)}
              role="button"
              tabindex="0"
              aria-label="Resize start of interval {index + 1}"
              title="Drag to adjust start time"
            ></div>

            <!-- 区间内容 -->
            <div class="zoom-interval-content">

                <!-- 🆕 设置焦点按钮 -->
                <button
                  class="zoom-interval-focus"
                  onclick={(e) => { e.stopPropagation(); onZoomFocusSetup?.(index) }}
                  aria-label={`Set zoom focal point for interval ${index + 1}`}
                  title="Set zoom focal point"
                >
                  <Crosshair class="w-3 h-3" />
                </button>

              <!-- 区间标签 -->
              <span class="zoom-interval-label">
                {index + 1}
              </span>

              <!-- 删除按钮 -->
              <button
                class="zoom-interval-delete"
                onclick={(e) => {
                  e.stopPropagation()
                  handleRemoveZoomInterval(index)
                }}
                aria-label="Remove zoom interval {index + 1}"
                title="Remove this interval"
              >
                <X class="w-3 h-3" />
              </button>
            </div>

            <!-- 🆕 右侧调整手柄 -->
            <div
              class="zoom-resize-handle zoom-resize-handle-end"
              onmousedown={(e) => handleZoomEndResize(e, index)}
              role="button"
              tabindex="0"
              aria-label="Resize end of interval {index + 1}"
              title="Drag to adjust end time"
            ></div>
          </div>
        {/each}

        <!-- 🆕 Zoom 轨道裁剪遮罩 (Visual Sync) -->
        {#if trimEnabled}
          <div
            class="trim-overlay trim-overlay-left zoom-trim-mask"
            style="width: {trimStartPercent}%"
            onclick={(e) => e.stopPropagation()}
            role="none"
          ></div>
          <div
            class="trim-overlay trim-overlay-right zoom-trim-mask"
            style="left: {trimEndPercent}%; width: {100 - trimEndPercent}%"
            onclick={(e) => e.stopPropagation()}
            role="none"
          ></div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- 播放头竖线 - 覆盖整个时间轴包括 zoom 区 -->
  <div
    class="playhead-container"
    style="left: {playheadLeft}"
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
    padding: var(--timeline-content-inset);
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
    height: 2rem; /* Reduced height from 2.5rem */
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
    height: 2.25rem; /* Matched to zoom-mini-timeline height */
    background: linear-gradient(to bottom, #374151, #1f2937);
    border: 1px solid #4b5563;
    border-radius: 0.375rem;
    cursor: pointer;
    overflow: visible;
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    transition: all 0.2s ease;
  }

  .timeline-track:hover {
    border-color: #6b7280;
    background: linear-gradient(to bottom, #3f4a5a, #252f3f);
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .trim-value-controls {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.5rem;
    color: #d1d5db;
    font-size: 0.75rem;
  }

  .trim-value-controls label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .trim-value-controls input {
    width: 5.5rem;
    border: 1px solid #4b5563;
    border-radius: 0.375rem;
    background: #111827;
    padding: 0.25rem 0.4rem;
    color: #f9fafb;
    font-variant-numeric: tabular-nums;
  }

  .trim-value-controls input:focus {
    border-color: #60a5fa;
    outline: 2px solid rgba(96, 165, 250, 0.35);
    outline-offset: 1px;
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
    );
    pointer-events: none;
    backdrop-filter: blur(1px);
  }

  .trim-overlay-left {
    left: 0;
    border-radius: 0.375rem 0 0 0.375rem;
  }

  .trim-overlay-right {
    border-radius: 0 0.375rem 0.375rem 0;
  }

  .trim-active-region {
    position: absolute;
    top: 0;
    height: 100%;
    /* Match Zoom Interval Style */
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.4), rgba(37, 99, 235, 0.5));
    border-top: 2px solid #3b82f6;
    border-bottom: 2px solid #3b82f6;
    pointer-events: none;
  }

  /* ========== 裁剪手柄 (Unified with Zoom) ========== */
  .trim-handle {
    position: absolute;
    top: 50%;
    /* Base transform is handled by specific start/end classes */
    width: 8px; /* Match zoom handle width */
    height: 100%; /* Match track height */
    background: rgba(96, 165, 250, 0.8); /* Match zoom handle color */
    border: none;
    box-shadow: none; /* Flat style like zoom */
    cursor: ew-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    z-index: 35;
    pointer-events: auto;
  }

  .trim-handle.trim-start {
    transform: translate(-100%, -50%); /* Sit to the left of the start line */
    border-radius: 0.25rem 0 0 0.25rem; /* Rounded on outer side (left) */
    border-right: 1px solid rgba(255, 255, 255, 0.3); /* Match zoom separator */
  }

  .trim-handle.trim-end {
    transform: translate(0%, -50%); /* Sit to the right of the end line */
    border-radius: 0 0.25rem 0.25rem 0; /* Rounded on outer side (right) */
    border-left: 1px solid rgba(255, 255, 255, 0.3); /* Match zoom separator */
  }

  .trim-handle:hover {
    background: rgba(96, 165, 250, 1);
    width: 10px; /* Expand on hover */
    z-index: 40;
  }
  
  .trim-handle.trim-start:hover {
    transform: translate(-100%, -50%);
  }
  .trim-handle.trim-end:hover {
    transform: translate(0%, -50%);
  }

  .trim-handle.dragging {
    background: rgba(37, 99, 235, 1); /* Darker active state */
    width: 10px;
    z-index: 40;
    transition: none; /* Disable transition for instant follow */
  }
  
  .trim-handle.trim-start.dragging {
    transform: translate(-100%, -50%);
  }
  .trim-handle.trim-end.dragging {
    transform: translate(0%, -50%);
  }

  /* ========== Zoom 控制区 ========== */
  
  /* Zoom 激活状态容器 */
  .zoom-active {
    margin-top: 0.5rem; /* Space from main timeline */
    padding: 0; /* Remove padding since no container border */
    background: transparent;
    border: none;
  }

  /* Zoom 缩略时间轴 */
  .zoom-mini-timeline {
    position: relative;
    width: 100%;
    height: 2.25rem; /* Reduced height from 3rem */
    background: linear-gradient(to bottom, #374151, #1f2937);
    border: 1px solid #4b5563;
    border-radius: 0.375rem;
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    cursor: crosshair;
  }

  .zoom-full-range {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, #1f2937, #111827);
    opacity: 0.5;
    border-radius: 0.375rem;
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
    padding: 0; /* 移除 padding，由内部元素控制 */
    gap: 0;
    cursor: grab;
    transition: all 0.2s ease;
    overflow: visible; /* 允许手柄超出边界 */
  }

  .zoom-interval:hover {
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.6), rgba(37, 99, 235, 0.7));
    border-color: #60a5fa;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
  }

  .zoom-interval:active {
    cursor: grabbing;
  }

  /* 🆕 移动中的区间样式 */
  .zoom-interval.moving {
    cursor: grabbing;
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.7), rgba(37, 99, 235, 0.8));
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4), 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: none;
    z-index: 10;
  }

  /* 🆕 调整大小中的区间样式 */
  .zoom-interval.resizing {
    background: linear-gradient(to bottom, rgba(59, 130, 246, 0.7), rgba(37, 99, 235, 0.8));
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4);
    transition: none;
    z-index: 10;
  }

  /* 🆕 区间内容容器 */
  .zoom-interval-content {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.25rem; /* Reduced padding */
    gap: 0.5rem;
    min-width: 0; /* 允许内容收缩 */
  }

  /* 🆕 调整手柄 */
  .zoom-resize-handle {
    position: relative;
    width: 8px;
    height: 100%;
    background: rgba(96, 165, 250, 0.8);
    cursor: ew-resize;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .zoom-resize-handle:hover {
    background: rgba(96, 165, 250, 1);
    width: 10px;
  }

  .zoom-resize-handle-start {
    border-radius: 0.25rem 0 0 0.25rem;
    border-right: 1px solid rgba(255, 255, 255, 0.3);
  }

  .zoom-resize-handle-end {
    border-radius: 0 0.25rem 0.25rem 0;
    border-left: 1px solid rgba(255, 255, 255, 0.3);
  }

	  .zoom-interval-focus {
	    padding: 0.25rem;
	    background: rgba(59, 130, 246, 0.8); /* blue-500 */
	    border: none;
	    border-radius: 0.25rem;
	    color: white;
	    cursor: pointer;
	    display: inline-flex;
	    align-items: center;
	    justify-content: center;
	    transition: background 0.15s ease;
	    margin-right: 0.25rem;
	    opacity: 0.9;
	  }

	  .zoom-interval:hover .zoom-interval-focus {
	    opacity: 1;
	  }

	  .zoom-interval-focus:hover {
	    background: rgba(37, 99, 235, 1); /* blue-600 */
	  }


  /* 调整大小时手柄高亮 */
  .zoom-interval.resizing .zoom-resize-handle {
    background: rgba(96, 165, 250, 1);
    width: 10px;
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

  /* 🆕 Zoom 轨道专用遮罩样式 */
  .zoom-trim-mask {
    z-index: 20; /* 高于 Zoom 区间 (z-index: 10) */
    pointer-events: auto; /* 恢复鼠标事件响应，以阻挡下方交互 */
    cursor: not-allowed; /* 鼠标样式：禁止 */
  }
</style>
