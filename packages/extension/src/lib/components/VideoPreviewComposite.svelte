<!-- Video preview component - using VideoComposite Worker for background composition -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { Play, Pause, LoaderCircle, Monitor, Info, Scissors, Crop, ZoomIn } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { DataFormatValidator } from '$lib/utils/data-format-validator'
  import { imageBackgroundManager } from '$lib/services/image-background-manager'
  import { trimStore } from '$lib/stores/trim.svelte'
  import { videoCropStore } from '$lib/stores/video-crop.svelte'
  import { videoZoomStore, type ZoomMode, type ZoomEasing } from '$lib/stores/video-zoom.svelte'
  import VideoCropPanel from './VideoCropPanel.svelte'
  import VideoFocusPanel from './VideoFocusPanel.svelte'
  import Timeline from './Timeline.svelte'

  // Props
  interface Props {
    encodedChunks?: any[]
    isRecordingComplete?: boolean
    displayWidth?: number
    displayHeight?: number
    showControls?: boolean
    showTimeline?: boolean
    durationMs?: number
    windowStartMs?: number
    windowEndMs?: number
    totalFramesAll?: number
    windowStartIndex?: number
    keyframeInfo?: {
      indices: number[]
      timestamps: number[]
      count: number
      avgInterval: number
    } | null
    onRequestWindow?: (args: { centerMs: number; beforeMs: number; afterMs: number }) => void
    // Optional: only fetch data, don't switch window, used for prefetch cache
    fetchWindowData?: (args: { centerMs: number; beforeMs: number; afterMs: number }) => Promise<{ chunks: any[]; windowStartIndex: number }>
    // 🆕 Single-frame preview: fetch minimal GOP for target frame (for fast preview)
    fetchSingleFrameGOP?: (targetFrame: number) => Promise<{ chunks: any[]; targetIndexInGOP: number } | null>
    className?: string
  }

  let {
    encodedChunks = [],
    isRecordingComplete = false,
    displayWidth = 640,
    displayHeight = 360,
    showControls = true,
    showTimeline = true,
    durationMs = 0,
    windowStartMs = 0,
    windowEndMs = 0,
    totalFramesAll = 0,
    windowStartIndex = 0,
    keyframeInfo = null,
    onRequestWindow,
    fetchWindowData,
    fetchSingleFrameGOP,
    className = ''
  }: Props = $props()

  // Prefetch cache and planning (Phase 2B-small step): only record planning parameters, fill data later
  type PrefetchPlan = { nextGlobalFrame: number; windowSize: number } | null
  let prefetchPlan: PrefetchPlan = null
  // Reserved: future can cache sliced transferableChunks and transferObjects
  type PrefetchCache = {
    targetGlobalFrame: number
    windowSize: number
    transferableChunks: any[]
    transferObjects: Transferable[]
  } | null
  let prefetchCache: PrefetchCache = null
  // building flag to avoid duplicate prefetch
  let isBuildingPrefetch = false

  // Record appendWindow start point sent to worker, avoid duplicate append decoding
  let lastAppendedStartFrame: number | null = null

  // Latest worker reported buffer level status
  let lastBufferLevel: 'healthy' | 'low' | 'critical' | null = null

  // Observation: prefetch hit statistics and window switching time
  let prefetchHits = 0
  let prefetchMisses = 0
  let cutoverTimerLabel: string | null = null
  let cutoverPlannedNext: number | null = null



  // Use global background configuration
  const backgroundConfig = $derived(backgroundConfigStore.config)

  // State variables - display related only
  let canvas: HTMLCanvasElement
  let bitmapCtx: ImageBitmapRenderingContext | null = null
  let isInitialized = $state(false)
  let isProcessing = $state(false)
  let hasEverProcessed = $state(false)
  let compositeWorker: Worker | null = null
  // Playback control state
  let currentFrameIndex = $state(0)
  let totalFrames = $state(0)
  let currentTime = $state(0)
  let duration = $state(0)
  let frameRate = $state(30)

  // 🆕 自动推断真实帧率（优先使用全局帧数和时长），避免 Zoom 时间漂移/跳出
  $effect(() => {
    if (totalFramesAll > 0 && durationMs > 0) {
      const fps = Math.max(1, Math.round(totalFramesAll / (durationMs / 1000)))
      if (fps !== frameRate) {
        frameRate = fps
      }
    }
  })
  let isPlaying = $state(false)
  let shouldContinuePlayback = $state(false) // 🔧 Continuous playback flag
  let continueFromGlobalFrame = $state(0) // 🔧 Record which global frame to continue playback from
  // Rendered frame corresponding window start point (for stable timing display/log, avoid false jumps caused by props changing first)
  let lastFrameWindowStartIndex = $state(windowStartIndex)

  // ✂️ 时间裁剪相关状态
  let hasInitializedTrim = $state(false)

  // ✂️ 视频裁剪相关状态
  let isCropMode = $state(false)
  // 🎯 焦点设置模式
  let isFocusMode = $state(false)
  let focusIntervalIndex = $state<number | null>(null)
  let focusFrameBitmap = $state<ImageBitmap | null>(null)
  let focusFrameSize = $state<{ width: number; height: number } | null>(null)  // 🔧 独立的焦点帧尺寸
  let pendingFocusGlobalFrame: number | null = null

  let pendingFocusIntervalIndex: number | null = null

  let currentFrameBitmap = $state<ImageBitmap | null>(null)
  let videoInfo = $state<{ width: number; height: number } | null>(null)

  // 🆕 预览相关状态
  let isPreviewMode = $state(false)
  let previewTimeMs = $state(0)
  let previewFrameIndex = $state<number | null>(null)  // 🆕 预览帧索引（独立于播放位置）
  let savedPlaybackState = $state<{ frameIndex: number; isPlaying: boolean; windowStartIndex?: number } | null>(null)
  let hoverPreviewThrottleTimer: number | null = null
  let windowSwitchThrottleTimer: number | null = null  // 🔧 窗口切换防抖
  const HOVER_PREVIEW_THROTTLE_MS = 50  // 50ms 节流（窗口内帧预览）
  const WINDOW_SWITCH_DEBOUNCE_MS = 200  // 🔧 200ms 防抖（窗口切换）- 快速拖动时不触发，鼠标稳定后才请求

  // 🆕 标记：是否有因预览触发的待处理窗口切换，避免 ready 时误跳到 0 帧
  let pendingPreviewWindowSwitch = false
  // 🔧 Pending restore target after hover ends and window switch is required
  let pendingRestoreGlobalFrameIndex: number | null = null

  // 🆕 #9 优化：预览加载状态指示器
  let isLoadingPreview = $state(false)
  let previewLoadingStartTime = 0
  const PREVIEW_LOADING_DELAY_MS = 150  // 150ms 后才显示加载指示器，避免闪烁


  // UI display duration: prioritize using global frame count/frame rate (consistent with timeline), then durationMs, finally fallback to internal duration
  const uiDurationSec = $derived.by(() => {
    if (totalFramesAll > 0 && frameRate > 0) return totalFramesAll / frameRate
    if (durationMs > 0) return durationMs / 1000
    return duration
  })

  // 🔧 Timeline maximum value (milliseconds): Video editor optimized version
  const timelineMaxMs = $derived.by(() => {
    let result: number

    // Priority 1: Use global duration (based on global frame count)
    if (totalFramesAll > 0 && frameRate > 0) {
      // 使用总时长，不是最后一帧的时间戳
      // 这样时间轴会显示完整的视频时长
      result = Math.max(1, Math.floor((totalFramesAll / frameRate) * 1000))
    }
    // Priority 2: Use passed real duration
    else if (durationMs > 0) {
      result = Math.max(1, Math.floor(durationMs))
    }
    // Priority 3: Use current window frame count calculation
    else if (totalFrames > 0 && frameRate > 0) {
      result = Math.max(1, Math.floor((totalFrames / frameRate) * 1000))
    }
    // Priority 4: Use window duration
    else if (windowEndMs > windowStartMs) {
      result = Math.max(1, windowEndMs - windowStartMs)
    }
    // Fallback value
    else {
      result = 1000
    }

    return result
  })



  // Output size information
  let outputWidth = $state(1920)
  let outputHeight = $state(1080)

  // Preview size - based on output ratio dynamic adjustment
  let previewWidth = $state(displayWidth)
  let previewHeight = $state(displayHeight)

  // Update preview size - intelligent adaptive full height layout
  function updatePreviewSize() {
    if (displayWidth <= 0 || displayHeight <= 0) return
    const aspectRatio = outputWidth / outputHeight

    // Calculate available space - consider control bar and timeline height
    const headerHeight = 0  // Preview info bar height (Removed)
    const controlsHeight = showControls && totalFrames > 0 ? 56 : 0  // Play control bar height
    // 🔧 更新：新 Timeline 组件包含时间刻度、轨道和 Zoom 控制区，总高度约 200-232px
    // 保守估计使用 232px 以确保不会溢出
    const timelineHeight = showTimeline && totalFrames > 0 ? 232 : 0  // New Timeline component height (with zoom control)
    const padding = 0  // Canvas area padding (Removed)

    const availableWidth = displayWidth - padding
    const availableHeight = displayHeight - headerHeight - controlsHeight - timelineHeight - padding

    // Calculate suitable preview size, maintain aspect ratio, fully utilize available space
    let calculatedWidth, calculatedHeight

    if (aspectRatio > availableWidth / availableHeight) {
      // Width limited: use all available width
      calculatedWidth = availableWidth
      calculatedHeight = Math.round(calculatedWidth / aspectRatio)
    } else {
      // Height limited: use all available height
      calculatedHeight = availableHeight
      calculatedWidth = Math.round(calculatedHeight * aspectRatio)
    }

    // Ensure minimum size, avoid too small preview
    const minSize = 300
    if (calculatedWidth < minSize || calculatedHeight < minSize) {
      if (aspectRatio > 1) {
        // Landscape video
        previewWidth = Math.max(minSize, calculatedWidth)
        previewHeight = Math.round(previewWidth / aspectRatio)
      } else {
        // Portrait video
        previewHeight = Math.max(minSize, calculatedHeight)
        previewWidth = Math.round(previewHeight * aspectRatio)
      }
    } else {
      previewWidth = calculatedWidth
      previewHeight = calculatedHeight
    }

    // Ensure not exceeding container limits
    previewWidth = Math.min(previewWidth, availableWidth)
    previewHeight = Math.min(previewHeight, availableHeight)
  }

  // Initialize Canvas (only used for display)
  function initializeCanvas() {
    if (!canvas) return

    // Use ImageBitmapRenderingContext for efficient display
    bitmapCtx = canvas.getContext('bitmaprenderer')

    if (!bitmapCtx) {
      console.error('❌ [VideoPreview] Failed to get ImageBitmapRenderingContext')
      return
    }

    isInitialized = true
  }

  // 🔧 消息计数器（诊断用）
  // 🔧 优化：使用模运算防止计数器溢出
  let workerMessageCount = 0
  const MAX_MESSAGE_COUNT = 1000000 // 100万次后重置

  // 🔧 frameBitmap 等待标志（用于 enterCropMode）
  let waitingForFrameBitmap = false
  let frameBitmapResolver: ((bitmap: ImageBitmap) => void) | null = null
  let frameBitmapRejecter: ((error: Error) => void) | null = null

  // Initialize VideoComposite Worker
  function initializeWorker() {
    if (compositeWorker) return

    compositeWorker = new Worker(
      new URL('../workers/composite-worker/index.ts', import.meta.url),
      { type: 'module' }
    )

    // Worker message handling
    compositeWorker.onmessage = (event) => {
      workerMessageCount = (workerMessageCount + 1) % MAX_MESSAGE_COUNT
      const { type, data } = event.data

      switch (type) {
        case 'initialized':
          break

        case 'ready':
          hasEverProcessed = true
          totalFrames = data.totalFrames
          duration = totalFrames / frameRate
          outputWidth = data.outputSize.width
          outputHeight = data.outputSize.height
          
          // Update Canvas internal resolution
          canvas.width = outputWidth
          canvas.height = outputHeight

          isProcessing = false
          // Observation: cutover time endpoint
          if (cutoverTimerLabel) {
            try { console.timeEnd(cutoverTimerLabel) } catch {}
            cutoverTimerLabel = null
          }

          // 🔧 检查是否在预览模式
          if (isPreviewMode && previewTimeMs > 0) {
            // 窗口切换完成后，继续预览
            const globalFrameIndex = Math.floor((previewTimeMs / 1000) * frameRate)
            const windowFrameIndex = globalFrameIndex - windowStartIndex

            if (windowFrameIndex >= 0 && windowFrameIndex < totalFrames) {
              compositeWorker?.postMessage({
                type: 'preview-frame',
                data: { frameIndex: windowFrameIndex }
              })
            }
          } else if (!shouldContinuePlayback && !isPreviewMode && !pendingPreviewWindowSwitch) {
            // 默认：就绪后跳到第 0 帧（仅在没有任何 pending 操作时）
            seekToFrame(0)
          }

          // 🆕 如果存在悬而未决的“恢复到保存位置”的请求，则优先恢复
          if (pendingRestoreGlobalFrameIndex != null) {
            const targetWindowFrame = pendingRestoreGlobalFrameIndex - windowStartIndex
            if (targetWindowFrame >= 0 && targetWindowFrame < data.totalFrames) {
              compositeWorker?.postMessage({ type: 'seek', data: { frameIndex: targetWindowFrame } })
              pendingRestoreGlobalFrameIndex = null
              pendingPreviewWindowSwitch = false
            }
          }

          // 🎯 若存在挂起的焦点设置请求，优先处理（独立于恢复请求）
          if (pendingFocusGlobalFrame != null && pendingFocusIntervalIndex != null) {
            const targetWindowFrame = pendingFocusGlobalFrame - windowStartIndex
            if (targetWindowFrame >= 0 && targetWindowFrame < data.totalFrames) {
              (async () => {
                try {
                  const bitmap = await getRawSourceFrameBitmapForWindowIndex(targetWindowFrame)
                  focusFrameBitmap = bitmap
                  focusFrameSize = { width: bitmap.width, height: bitmap.height }  // 🔧 使用独立变量
                  focusIntervalIndex = pendingFocusIntervalIndex
                  isFocusMode = true
                  // 清理挂起状态
                  pendingFocusGlobalFrame = null
                  pendingFocusIntervalIndex = null
                  pendingPreviewWindowSwitch = false
                } catch (e) {
                  console.error('❌ [VideoPreview] Failed to get focus frame after window ready:', e)
                }
              })()
            }
          }

          // 🔧 Check if new window is prepared to continue playback
          if (shouldContinuePlayback) {
            const targetWindowFrame = continueFromGlobalFrame - windowStartIndex
            const startFrame = Math.max(0, Math.min(targetWindowFrame, data.totalFrames - 1))

            shouldContinuePlayback = false

            lastFrameWindowStartIndex = windowStartIndex
            currentFrameIndex = startFrame

            requestAnimationFrame(() => {
              seekToFrame(startFrame)
              requestAnimationFrame(() => {
                play()
              })
            })
          }
          break

        case 'preview-frame':
          if (data.bitmap) {
            isLoadingPreview = false
            
            displayFrame(data.bitmap)
            previewFrameIndex = data.frameIndex
            pendingPreviewWindowSwitch = false
          }
          break

        case 'frame':
          // Display composite after frame

          // 如果存在挂起的恢复目标，则优先跳到目标帧，避免短暂显示错误帧（如 0 帧）
          if (pendingRestoreGlobalFrameIndex != null) {
            const desired = pendingRestoreGlobalFrameIndex - windowStartIndex
            if (desired >= 0 && desired < totalFrames && data.frameIndex !== desired) {
              compositeWorker?.postMessage({ type: 'seek', data: { frameIndex: desired } })
              break
            }
          }

          // 🔧 关键修复：只在非裁剪模式下显示帧
          if (!isCropMode) {
            displayFrame(data.bitmap, data.frameIndex, data.timestamp)
            pendingPreviewWindowSwitch = false
          } else {
            try {
              data.bitmap.close()
            } catch (e) {
              console.warn('⚠️ [VideoPreview] Failed to close bitmap:', e)
            }
          }
          break

        case 'frameBitmap':
        case 'frameBitmapRaw':
          if (waitingForFrameBitmap && frameBitmapResolver) {
            frameBitmapResolver(data.bitmap)
            waitingForFrameBitmap = false
            frameBitmapResolver = null
            frameBitmapRejecter = null
          }
          break

        case 'bufferStatus':
          // Phase2B small step validation: record buffer status, and generate prefetch plan (does not change existing behavior)
          console.log(`🧯 [VideoPreview] Buffer status: ${data.level}`, data)
          // Record latest buffer level
          lastBufferLevel = data.level as any

          // If already prefetch cache and current level is low/critical, then priority append background decode (avoid health period waste)
          if (
            (data.level === 'low' || data.level === 'critical') &&
            compositeWorker &&
            prefetchCache &&
            prefetchCache.targetGlobalFrame > windowStartIndex &&
            lastAppendedStartFrame !== prefetchCache.targetGlobalFrame
          ) {
            try {
              const appendedChunks = prefetchCache.transferableChunks.map((c: any) => {
                const buf: ArrayBuffer = (c.data as ArrayBuffer).slice(0)
                return { ...c, data: buf }
              })
              const appendedTransfers = appendedChunks.map((c: any) => c.data as ArrayBuffer)
              compositeWorker.postMessage({
                type: 'appendWindow',
                data: { chunks: appendedChunks, startGlobalFrame: prefetchCache.targetGlobalFrame }
              }, { transfer: appendedTransfers as unknown as Transferable[] })
              lastAppendedStartFrame = prefetchCache.targetGlobalFrame
              console.log('➕ [prefetch] appendWindow dispatched (reuse cache) for start:', lastAppendedStartFrame, 'chunks:', appendedChunks.length)
            } catch (e) {
              console.warn('⚠️ [prefetch] appendWindow (reuse) failed:', e)
            }
          }

          if (totalFramesAll > 0) {
            // Fixed point current window end of next window start point, avoid with frame shake
            const boundaryNext = windowStartIndex + Math.max(0, totalFrames)
            // As "start index", allow equals totalFramesAll (indicate no next window)
            const nextGlobal = Math.min(boundaryNext, Math.max(0, totalFramesAll))
            const remainingAll = Math.max(0, totalFramesAll - nextGlobal)
            const plannedSize = Math.min(90, remainingAll)
            if (plannedSize > 0) {
              const isSamePlan = prefetchPlan && prefetchPlan.nextGlobalFrame === nextGlobal
              if (!isSamePlan) {
                prefetchPlan = { nextGlobalFrame: nextGlobal, windowSize: plannedSize }
                console.log('[prefetch] Planned next window:', prefetchPlan)
              }


                // 🔧 优化：更智能的缓存失效逻辑
                // 1. 如果缓存起点 <= 当前窗口起点，说明缓存已过期
                // 2. 如果缓存起点远超下一窗口起点（超过2个窗口大小），也视为过期
                if (prefetchCache) {
                  const cacheIsStale = prefetchCache.targetGlobalFrame <= windowStartIndex
                  const cacheIsTooFar = prefetchCache.targetGlobalFrame > (windowStartIndex + totalFrames * 2)

                  if (cacheIsStale || cacheIsTooFar) {
                    console.log('[prefetch] Discard cache:', {
                      reason: cacheIsStale ? 'stale' : 'too far',
                      cacheStart: prefetchCache.targetGlobalFrame,
                      windowStart: windowStartIndex,
                      windowSize: totalFrames
                    })
                    prefetchCache = null
                  }
                }

              //  kick off prefetch build (data only, no window switch)
              if (fetchWindowData && !isBuildingPrefetch && !prefetchCache && prefetchPlan && (data.level === 'low' || data.level === 'critical')) {
                isBuildingPrefetch = true
                ;(async () => {
                  try {
                    console.time('[prefetch] build')
                    const centerMs = (prefetchPlan.nextGlobalFrame / frameRate) * 1000
                    const afterMs = (prefetchPlan.windowSize / frameRate) * 1000
                    console.log('[prefetch] Building cache for plan:', { centerMs, afterMs, plan: prefetchPlan })
                    const res = await fetchWindowData({ centerMs, beforeMs: 0, afterMs })
                    const rawChunks = Array.isArray(res?.chunks) ? res.chunks : []
                    const tChunks = rawChunks.map((chunk: any) => {
                      const uint8 = DataFormatValidator.convertToUint8Array(chunk.data)
                      const buf = uint8 ? uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) : (chunk.data as ArrayBuffer)
                      return {
                        data: buf,
                        timestamp: chunk.timestamp,
                        type: chunk.type,
                        size: chunk.size,
                        codedWidth: chunk.codedWidth,
                        codedHeight: chunk.codedHeight,
                        codec: chunk.codec
                      }
                    })
                    prefetchCache = {
                      targetGlobalFrame: (res?.windowStartIndex ?? prefetchPlan.nextGlobalFrame),
                      windowSize: tChunks.length,
                      transferableChunks: tChunks,
                      transferObjects: tChunks.map((c: any) => c.data as ArrayBuffer)
                    }
                    console.timeEnd('[prefetch] build')
                    console.log('[prefetch] Cache ready for start:', prefetchCache?.targetGlobalFrame, 'size:', prefetchCache?.windowSize)

                    // Small stepC: in cache ready, ahead of next window encoding block copy and issue to worker for background decode (no cut window)
                    try {
                      if (
                        (lastBufferLevel === 'low' || lastBufferLevel === 'critical') &&
                        compositeWorker &&
                        prefetchCache &&
                        prefetchCache.targetGlobalFrame > windowStartIndex &&
                        lastAppendedStartFrame !== prefetchCache.targetGlobalFrame
                      ) {
                        const appendedChunks = prefetchCache.transferableChunks.map((c: any) => {
                          const buf: ArrayBuffer = (c.data as ArrayBuffer).slice(0) // Copy one, avoid affecting main thread cache
                          return { ...c, data: buf }
                        })
                        const appendedTransfers = appendedChunks.map((c: any) => c.data as ArrayBuffer)
                        compositeWorker.postMessage({
                          type: 'appendWindow',
                          data: { chunks: appendedChunks, startGlobalFrame: prefetchCache.targetGlobalFrame }
                        }, { transfer: appendedTransfers as unknown as Transferable[] })
                        lastAppendedStartFrame = prefetchCache.targetGlobalFrame
                        console.log('➕ [prefetch] appendWindow dispatched for start:', lastAppendedStartFrame, 'chunks:', appendedChunks.length)
                      }
                    } catch (e) {
                      console.warn('⚠️ [prefetch] appendWindow failed:', e)
                    }
                  } catch (err) {
                    console.warn('\u26a0\ufe0f [prefetch] build failed:', err)
                  } finally {
                    isBuildingPrefetch = false
                  }
                })()
              }
            }
          }
          break


        case 'sizeChanged':
          // Handle output size change
          console.log('📐 [VideoPreview] Output size changed:', data)
          outputWidth = data.outputSize.width
          outputHeight = data.outputSize.height

          // Update preview size
          updatePreviewSize()

          // Update Canvas internal resolution
          canvas.width = outputWidth
          canvas.height = outputHeight
          break

        case 'windowComplete':
          console.log('🔄 [VideoPreview] Window playback completed, requesting next window')
          handleWindowComplete(data)
          break

        case 'complete':
          console.log('🎉 [VideoPreview] Playback completed')
          isPlaying = false
          break

        // 🆕 Single-frame preview response handling
        case 'singleFramePreview':
          console.log('🔍 [VideoPreview] Received single frame preview:', {
            success: data.success,
            hasError: !!data.error,
            globalFrameIndex: data.globalFrameIndex,
            hasBitmap: !!data.bitmap
          })

          // 清除加载状态
          isLoadingPreview = false

          if (data.success && data.bitmap) {
            // 显示预览帧（不更新播放位置）
            displayFrame(data.bitmap)
            previewFrameIndex = data.globalFrameIndex
            pendingPreviewWindowSwitch = false
            console.log('✅ [VideoPreview] Single frame preview displayed')
          } else {
            console.warn('⚠️ [VideoPreview] Single frame preview failed:', data.error)
          }
          break

        case 'error':
          console.error('❌ [VideoPreview] Worker error:', data)
          isProcessing = false
          break

        default:
          console.warn('⚠️ [VideoPreview] Unknown worker message:', type)
      }
    }

    compositeWorker.onerror = (error) => {
      console.error('❌ [VideoPreview] Worker error:', error)
      isProcessing = false
    }

    // Initialize Worker
    compositeWorker.postMessage({ type: 'init' })
  }

  // Display frame (core display logic)
  function displayFrame(bitmap: ImageBitmap, frameIndex?: number, timestamp?: number) {
    console.log('📀 [VideoPreview] displayFrame called:', {
      frameIndex,
      timestamp,
      hasBitmap: !!bitmap,
      bitmapWidth: bitmap.width,
      bitmapHeight: bitmap.height,
      hasBitmapCtx: !!bitmapCtx,
      hasCanvas: !!canvas,
      canvasWidth: canvas?.width,
      canvasHeight: canvas?.height
    })

    if (!bitmapCtx) {
      console.error('❌ [VideoPreview] Bitmap context not available', {
        hasCanvas: !!canvas,
        canvasWidth: canvas?.width,
        canvasHeight: canvas?.height
      })
      return
    }

    // consume unused param to satisfy TS/linters
    void timestamp

    try {
      // Efficiently display ImageBitmap
      console.log('🎨 [VideoPreview] Transferring bitmap to canvas...')
      bitmapCtx.transferFromImageBitmap(bitmap)
      console.log('✅ [VideoPreview] Frame displayed successfully:', frameIndex)

      // Update playback state only when a valid frameIndex is provided (i.e., not in hover preview)
      if (typeof frameIndex === 'number') {
        currentFrameIndex = frameIndex
        // Bind this frame to corresponding window start point, stable display/log of global frame
        lastFrameWindowStartIndex = windowStartIndex
        // Use global frame index calculation relative video start time, avoid absolute timestamp (like epoch/us) causing huge value
        currentTime = (lastFrameWindowStartIndex + frameIndex) / frameRate

        // 🔧 裁剪检查：如果启用了裁剪且到达裁剪终点，自动停止播放
        if (trimStore.enabled && isPlaying) {
          const currentGlobalFrame = lastFrameWindowStartIndex + frameIndex
          
          // 🔧 修复：使用帧索引比较避免时间戳精度问题
          if (currentGlobalFrame >= trimStore.trimEndFrame) {
            console.log('✂️ [VideoPreview] Reached trim end point (frame ' + currentGlobalFrame + '), stopping playback')
            pause()
          }
        }
      }

      // Debug: reduce per-frame log cost, only development environment and every 60 frames output once
      // if (import.meta.env.DEV && frameIndex % 60 === 0) {
      //   console.debug(`[VideoPreview] frame ${frameIndex}/${totalFrames} global ${windowStartIndex + frameIndex + 1}/${totalFramesAll}`)
      // }
    } catch (error) {
      console.error('❌ [VideoPreview] Display error:', error)
    }
  }

  // Handle video data
  async function processVideo() {
    if (!compositeWorker || !encodedChunks.length) {
      console.warn('⚠️ [VideoPreview] Cannot process: missing worker or chunks')
      return
    }

    console.log('🎬 [VideoPreview] Processing video with', encodedChunks.length, 'chunks')

    // Validate and fix data format
    const validation = DataFormatValidator.validateChunks(encodedChunks)
    if (!validation.isValid) {
      console.warn('⚠️ [VideoPreview] Invalid chunk data detected, attempting to fix...')
      const fixedChunks = DataFormatValidator.fixChunksFormat(encodedChunks)

      if (fixedChunks.length > 0) {
        encodedChunks = fixedChunks
        console.log('✅ [VideoPreview] Fixed chunk format')
      } else {
        console.error('❌ [VideoPreview] Cannot fix chunk format, aborting')
        isProcessing = false
        return
      }
    }

    // Only first load show processing mask; continuous playback switch doesn't cover
    isProcessing = !hasEverProcessed

    // Prepare can transfer data chunks: priority hit prefetch cache, or calculate
    let transferableChunks: any[]
    let usingPrefetchCache = false

    if (prefetchCache && prefetchCache.targetGlobalFrame === windowStartIndex) {
      // Hit cache
      transferableChunks = prefetchCache.transferableChunks
      usingPrefetchCache = true
      console.log('⚡ [prefetch] Using cached transferableChunks:', {
        targetGlobalFrame: prefetchCache.targetGlobalFrame,
        windowSize: prefetchCache.windowSize,
        chunks: transferableChunks.length
      })
      // Hit after immediately clear, avoid repeat use of expired cache
      prefetchCache = null
    } else {
      // Rollback: convert current props.encodedChunks
      transferableChunks = encodedChunks.map((chunk) => {
        let dataBuffer
        try {
          const uint8Data = DataFormatValidator.convertToUint8Array(chunk.data)
          if (!uint8Data) {
            console.error('❌ [VideoPreview] Cannot convert chunk data to Uint8Array:', chunk.data)
            return null
          }
          const byteOffset = uint8Data.byteOffset
          const byteLength = uint8Data.byteLength
          dataBuffer = uint8Data.buffer.slice(byteOffset, byteOffset + byteLength)


        } catch (error) {
          console.error('❌ [VideoPreview] Error processing chunk data:', error)
          return null
        }
        return {
          data: dataBuffer,
          timestamp: chunk.timestamp,
          type: chunk.type,
          size: chunk.size,
          codedWidth: chunk.codedWidth,
          codedHeight: chunk.codedHeight,
          codec: chunk.codec
        }
      }).filter(chunk => chunk !== null)
    }

    console.log('📤 [VideoPreview] Prepared', transferableChunks.length, 'transferable chunks', usingPrefetchCache ? '(from cache)' : '')

    // Debug: check first data chunk size information
    if (transferableChunks.length > 0) {
      const firstChunk = transferableChunks[0]
      console.log('🔍 [VideoPreview] First chunk dimensions:', {
        codedWidth: firstChunk.codedWidth,
        codedHeight: firstChunk.codedHeight,


        aspectRatio: firstChunk.codedWidth && firstChunk.codedHeight ?
          (firstChunk.codedWidth / firstChunk.codedHeight).toFixed(3) : 'unknown',
        size: firstChunk.size,
        type: firstChunk.type,
        codec: firstChunk.codec
      })

      // 🆕 修复：使用源视频尺寸设置裁剪 Store 和 videoInfo
      if (firstChunk.codedWidth && firstChunk.codedHeight) {
        const sw = firstChunk.codedWidth
        const sh = firstChunk.codedHeight
        videoCropStore.setOriginalSize(sw, sh)
        videoInfo = { width: sw, height: sh }
        console.log('✅ [VideoPreview] Set source dimensions for crop:', { width: sw, height: sh })
      }
    }

    // Collect all ArrayBuffers for transfer
    const transferList = transferableChunks.map((chunk: any) => chunk.data)

    // Convert Svelte 5 Proxy objects to plain objects
    const plainBackgroundConfig = {
      type: backgroundConfig.type,

    //
    // :

      color: backgroundConfig.color,
      padding: backgroundConfig.padding,
      outputRatio: backgroundConfig.outputRatio,
      videoPosition: backgroundConfig.videoPosition,
      borderRadius: backgroundConfig.borderRadius,
      inset: backgroundConfig.inset,
      // Deep convert gradient object
      gradient: backgroundConfig.gradient ? {
        type: backgroundConfig.gradient.type,
        ...(backgroundConfig.gradient.type === 'linear' && 'angle' in backgroundConfig.gradient ? { angle: backgroundConfig.gradient.angle } : {}),
        ...(backgroundConfig.gradient.type === 'radial' && 'centerX' in backgroundConfig.gradient ? {
          centerX: backgroundConfig.gradient.centerX,
          centerY: backgroundConfig.gradient.centerY,
          radius: backgroundConfig.gradient.radius
        } : {}),
        ...(backgroundConfig.gradient.type === 'conic' && 'centerX' in backgroundConfig.gradient ? {
          centerX: backgroundConfig.gradient.centerX,
          centerY: backgroundConfig.gradient.centerY,
          angle: 'angle' in backgroundConfig.gradient ? backgroundConfig.gradient.angle : 0
        } : {}),
        stops: backgroundConfig.gradient.stops.map(stop => ({
          color: stop.color,
          position: stop.position
        }))
      } : undefined,
      // Deep convert shadow object
      shadow: backgroundConfig.shadow ? {
        offsetX: backgroundConfig.shadow.offsetX,
        offsetY: backgroundConfig.shadow.offsetY,
        blur: backgroundConfig.shadow.blur,
        color: backgroundConfig.shadow.color
      } : undefined,
      // Deep convert image object - get new ImageBitmap to avoid detached issue
      image: backgroundConfig.image ? {
        imageId: backgroundConfig.image.imageId,
        imageBitmap: null as any, // Set to null first, get new ImageBitmap later
        fit: backgroundConfig.image.fit,
        position: backgroundConfig.image.position,
        opacity: backgroundConfig.image.opacity,
        blur: backgroundConfig.image.blur,
        scale: backgroundConfig.image.scale,
        offsetX: backgroundConfig.image.offsetX,
        offsetY: backgroundConfig.image.offsetY
      } : undefined,
      // Deep convert wallpaper object - get new ImageBitmap to avoid detached issue
      wallpaper: backgroundConfig.wallpaper ? {
        imageId: backgroundConfig.wallpaper.imageId,
        imageBitmap: null as any, // Set to null first, get new ImageBitmap later
        fit: backgroundConfig.wallpaper.fit,
        position: backgroundConfig.wallpaper.position,
        opacity: backgroundConfig.wallpaper.opacity,
        blur: backgroundConfig.wallpaper.blur,
        scale: backgroundConfig.wallpaper.scale,
        offsetX: backgroundConfig.wallpaper.offsetX,
        offsetY: backgroundConfig.wallpaper.offsetY
      } : undefined,
      // 🆕 添加视频裁剪配置
      videoCrop: videoCropStore.getCropConfig(),
      // 🆕 添加视频 Zoom 配置（与 config 路径保持一致）
      videoZoom: videoZoomStore.getZoomConfig()
    }

    // If image background, get new ImageBitmap
    const transferObjects: Transferable[] = [...transferList]
    if (plainBackgroundConfig.image && backgroundConfig.image) {
      try {
        // Get new ImageBitmap from ImageBackgroundManager
        const freshImageBitmap = imageBackgroundManager.getImageBitmap(backgroundConfig.image.imageId)

        if (freshImageBitmap) {
          // Create ImageBitmap copy for transfer
          const imageBitmapCopy = await createImageBitmap(freshImageBitmap)
          plainBackgroundConfig.image.imageBitmap = imageBitmapCopy
          transferObjects.push(imageBitmapCopy as any)
        } else {
          console.warn('⚠️ [VideoPreview] ImageBitmap not found for imageId:', backgroundConfig.image.imageId)
          plainBackgroundConfig.image = undefined // Remove image config if ImageBitmap not found
        }
      } catch (error) {
        console.error('❌ [VideoPreview] Failed to get ImageBitmap:', error)
        plainBackgroundConfig.image = undefined
      }
    }

    // If wallpaper background, get new ImageBitmap
    if (plainBackgroundConfig.wallpaper && backgroundConfig.wallpaper) {
      try {
        // Get new ImageBitmap from ImageBackgroundManager
        const freshImageBitmap = imageBackgroundManager.getImageBitmap(backgroundConfig.wallpaper.imageId)

        if (freshImageBitmap) {
          // Create ImageBitmap copy for transfer
          const imageBitmapCopy = await createImageBitmap(freshImageBitmap)
          plainBackgroundConfig.wallpaper.imageBitmap = imageBitmapCopy
          transferObjects.push(imageBitmapCopy as any)
        } else {
          console.warn('⚠️ [VideoPreview] ImageBitmap not found for wallpaper imageId:', backgroundConfig.wallpaper.imageId)
          plainBackgroundConfig.wallpaper = undefined // Remove wallpaper config if ImageBitmap not found
        }
      } catch (error) {
        console.error('❌ [VideoPreview] Failed to get wallpaper ImageBitmap:', error)
        plainBackgroundConfig.wallpaper = undefined
      }
    }

    console.log('📤 [VideoPreview] Sending config to worker:', plainBackgroundConfig);

    console.log('[progress] VideoPreview - sending process message to worker:', {
      chunksLength: transferableChunks.length,
      transferObjectsLength: transferObjects.length,
      windowStartIndex
    })

    compositeWorker.postMessage({
      type: 'process',
      data: {
        chunks: transferableChunks,
        backgroundConfig: plainBackgroundConfig,
        startGlobalFrame: windowStartIndex,
        frameRate: frameRate  // 🆕 传递帧率
      }
    }, { transfer: transferObjects })

    console.log('[progress] VideoPreview - process message sent')

    // Observation: prefetch hit statistics (send after window end)
    if (usingPrefetchCache) { prefetchHits++; } else { prefetchMisses++; }
    {
      const total = prefetchHits + prefetchMisses
      const rate = total ? (prefetchHits / total).toFixed(2) : '0.00'
      console.log('[prefetch] stats', { hits: prefetchHits, misses: prefetchMisses, hitRate: rate })
    }

  }

  // ✂️ 视频裁剪模式函数
  // 进入裁剪模式
  async function enterCropMode() {
    // 暂停播放
    if (isPlaying) {
      pause()
    }

    // 获取当前帧的 ImageBitmap
    if (!compositeWorker || currentFrameIndex >= totalFrames) {
      console.warn('⚠️ [VideoPreview] Cannot enter crop mode: no frame available')
      return
    }

    try {
      // 🔧 关键修复：使用全局标志位代替 addEventListener
      // 先设置 Promise，再发送消息（避免竞态）
      const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('❌ [VideoPreview] getCurrentFrameBitmap timeout')
          waitingForFrameBitmap = false
          frameBitmapResolver = null
          frameBitmapRejecter = null
          reject(new Error('Timeout waiting for frameBitmap'))
        }, 3000)

        // 设置全局标志，由 onmessage 处理器调用
        waitingForFrameBitmap = true
        frameBitmapResolver = (bitmap: ImageBitmap) => {
          clearTimeout(timeout)
          resolve(bitmap)
        }
        frameBitmapRejecter = (error: Error) => {
          clearTimeout(timeout)
          reject(error)
        }

        console.log('✂️ [VideoPreview] Set up frameBitmap waiting, sending request...')

        // 🔧 关键：在 Promise 内部发送消息，确保 resolver 已经设置
        compositeWorker!.postMessage({
          type: 'getSourceFrameBitmap',
          data: { frameIndex: currentFrameIndex }
        })
      })

      currentFrameBitmap = bitmap
      isCropMode = true

      console.log('✂️ [VideoPreview] Entered crop mode with frame', currentFrameIndex)
    } catch (error) {
      console.error('❌ [VideoPreview] Failed to enter crop mode:', error)
    }
  }

  // 退出裁剪模式
  function exitCropMode(applied: boolean) {
    console.log('✂️ [VideoPreview] Exiting crop mode, applied:', applied)

    isCropMode = false

    // 清理 ImageBitmap
    if (currentFrameBitmap) {
      currentFrameBitmap.close()
      currentFrameBitmap = null
    }

    if (applied) {
      console.log('✂️ [VideoPreview] Applying crop, current config:', videoCropStore.getCropConfig())

      // 🔧 应用裁剪：更新配置后强制刷新显示
      if (compositeWorker) {
        // 保存当前帧位置
        const savedFrameIndex = currentFrameIndex

        // 更新 Worker 配置
        updateBackgroundConfig(backgroundConfig).then(() => {
          console.log('✅ [VideoPreview] Crop config updated, forcing frame refresh...')

          // 🔧 关键修复：强制 seek 到当前帧，确保帧被重新渲染和显示
          requestAnimationFrame(() => {
            seekToFrame(savedFrameIndex)
          })
        }).catch(error => {
          console.error('❌ [VideoPreview] Failed to apply crop:', error)
        })
      } else {
        console.warn('⚠️ [VideoPreview] Cannot apply crop: missing worker', {
          hasWorker: !!compositeWorker
        })
      }
    }
  }

  // Playback control
  function play() {
    if (!compositeWorker || totalFrames === 0) return

    // 🔧 如果在预览模式，退出预览
    if (isPreviewMode) {
      isPreviewMode = false
      savedPlaybackState = null
      console.log('🔍 [Preview] Exited preview mode due to play')
    }

    const startFrame = windowStartIndex + currentFrameIndex
    let needsSeek = false
    let targetGlobalFrame = startFrame

    // 1. 检查是否在 Trim 范围外（或已到达 Trim 终点）
    if (trimStore.enabled) {
      // 如果当前位置小于起点，或大于等于终点（播放结束），则重置到起点
      if (startFrame < trimStore.trimStartFrame || startFrame >= trimStore.trimEndFrame) {
        targetGlobalFrame = trimStore.trimStartFrame
        needsSeek = true
        console.log('⚠️ [Play] Outside trim range or at end, resetting to:', targetGlobalFrame)
      }
    } 
    // 2. 检查是否已到达视频末尾（无 Trim 情况）
    else if (totalFramesAll > 0 && startFrame >= totalFramesAll - 1) { 
      // -1 容错，避免在最后一帧点击播放无效
      targetGlobalFrame = 0
      needsSeek = true
      console.log('🔄 [Play] Reached end of video, resetting to start')
    }

    if (needsSeek) {
      // 判断是否需要切窗
      const targetWindowFrame = targetGlobalFrame - windowStartIndex
      const isInsideWindow = targetWindowFrame >= 0 && targetWindowFrame < totalFrames

      if (isInsideWindow) {
        // 窗口内跳转：直接 Seek 然后 Play
        console.log('⏭️ [Play] Seeking inside window to', targetWindowFrame)
        seekToFrame(targetWindowFrame)
        // 确保 Seek 消息发送后再发送 Play
        requestAnimationFrame(() => {
          if (compositeWorker) {
            console.log('▶️ [Play] Starting playback after seek')
            compositeWorker.postMessage({ type: 'play' })
            isPlaying = true
          }
        })
      } else {
        // 窗口外跳转：利用 shouldContinuePlayback 机制，在 Ready 后自动播放
        console.log('🔄 [Play] Target outside window, requesting switch with auto-play')
        shouldContinuePlayback = true
        continueFromGlobalFrame = targetGlobalFrame
        seekToGlobalFrame(targetGlobalFrame) // 这会触发 onRequestWindow
        // 注意：这里不立即设置 isPlaying = true，等待 Worker Ready 后处理
      }
    } else {
      // 不需要跳转，直接播放
      console.log('▶️ [Play] Resuming playback')
      isPlaying = true
      compositeWorker.postMessage({ type: 'play' })
    }
  }

  function pause() {
    if (!compositeWorker) return

    console.log('⏸️ [VideoPreview] Pausing playback')
    isPlaying = false

    compositeWorker.postMessage({ type: 'pause' })
  }

  function stop() {
    pause()
    seekToFrame(0)
  }

  function seekToFrame(frameIndex: number) {
    if (!compositeWorker || frameIndex < 0 || frameIndex >= totalFrames) return

    console.log('⏭️ [VideoPreview] Seeking to frame:', frameIndex)


    compositeWorker.postMessage({
      type: 'seek',
      data: { frameIndex }
    })
  }

  function seekToTime(time: number) {
    const frameIndex = Math.floor(time * frameRate)
    seekToFrame(frameIndex)
  }

  // Format seconds as 00:00.xx（mm:ss.cs），显示百分秒精度
  function formatTimeSec(sec: number): string {
    const total = Math.max(0, sec)
    const mm = Math.floor(total / 60)
    const ss = Math.floor(total % 60)
    const cs = Math.floor((total % 1) * 100)  // 百分秒 (centiseconds)
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
  }

  // ✂️ 裁剪相关函数
  // 初始化 trimStore
  $effect(() => {
    if (timelineMaxMs > 0 && totalFramesAll > 0 && !hasInitializedTrim) {
      trimStore.initialize(timelineMaxMs, frameRate, totalFramesAll)
      hasInitializedTrim = true
      console.log('✂️ [VideoPreview] Trim store initialized')
    } else if (timelineMaxMs > 0 && totalFramesAll > 0 && hasInitializedTrim) {
      trimStore.updateParameters(timelineMaxMs, frameRate, totalFramesAll)
    }
  })

  // 计算当前播放时间（毫秒）
  // 🔧 修复：使用 lastFrameWindowStartIndex 而非 windowStartIndex
  // 避免窗口切换期间 props 更新与帧渲染不同步导致的时间跳跃
  const currentTimeMs = $derived.by(() => {
    // 🔧 预览模式下，显示保存的播放位置（蓝色播放头不动）
    if (isPreviewMode && savedPlaybackState) {
      return Math.floor((savedPlaybackState.frameIndex) / frameRate * 1000)
    }
    // 正常模式：使用 lastFrameWindowStartIndex 确保与最后渲染的帧同步
    return Math.floor((lastFrameWindowStartIndex + currentFrameIndex) / frameRate * 1000)
  })

  // 🆕 计算当前帧号（用于显示）
  const currentFrameNumber = $derived.by(() => {
    // 🔧 预览模式下，显示保存的播放位置的帧号
    if (isPreviewMode && savedPlaybackState) {
      return savedPlaybackState.frameIndex + 1
    }
    // 正常模式：使用 lastFrameWindowStartIndex 确保与最后渲染的帧同步
    return lastFrameWindowStartIndex + currentFrameIndex + 1
  })

  // ===== Debug logging for timer and frame jumps =====
  // Print timer under progress bar and detect frame skips
  let lastLoggedGlobalFrame: number = -1
  $effect(() => {
    const globalFrame = lastFrameWindowStartIndex + currentFrameIndex
    const totalSec = uiDurationSec
    // Only log when frame changes to avoid excessive spam on unrelated updates
    if (globalFrame !== lastLoggedGlobalFrame) {
      if (lastLoggedGlobalFrame >= 0) {
        const delta = globalFrame - lastLoggedGlobalFrame
        if (Math.abs(delta) !== 1) {
          console.warn(`[video-timer] frame jump ${lastLoggedGlobalFrame} -> ${globalFrame} (Δ=${delta})`)
        }
      }
      lastLoggedGlobalFrame = globalFrame
      console.log(`[video-timer] ${formatTimeSec(globalFrame / frameRate)} / ${formatTimeSec(totalSec)}`)
    }
  })



  // Update background configuration
  async function updateBackgroundConfig(newConfig: typeof backgroundConfig) {
    if (!compositeWorker) return

    // Convert Svelte 5's Proxy object to common object
    const plainConfig = {
      type: newConfig.type,
      color: newConfig.color,
      padding: newConfig.padding,
      outputRatio: newConfig.outputRatio,
      videoPosition: newConfig.videoPosition,

      borderRadius: newConfig.borderRadius,
      inset: newConfig.inset,
      // Deep convert gradient object
      gradient: newConfig.gradient ? {
        type: newConfig.gradient.type,
        ...(newConfig.gradient.type === 'linear' && 'angle' in newConfig.gradient ? { angle: newConfig.gradient.angle } : {}),
        ...(newConfig.gradient.type === 'radial' && 'centerX' in newConfig.gradient ? {
          centerX: newConfig.gradient.centerX,
          centerY: newConfig.gradient.centerY,
          radius: newConfig.gradient.radius
        } : {}),
        ...(newConfig.gradient.type === 'conic' && 'centerX' in newConfig.gradient ? {
          centerX: newConfig.gradient.centerX,
          centerY: newConfig.gradient.centerY,
          angle: 'angle' in newConfig.gradient ? newConfig.gradient.angle : 0
        } : {}),
        stops: newConfig.gradient.stops.map(stop => ({
          color: stop.color,
          position: stop.position
        }))
      } : undefined,
      // Deep convert shadow object
      shadow: newConfig.shadow ? {
        offsetX: newConfig.shadow.offsetX,
        offsetY: newConfig.shadow.offsetY,
        blur: newConfig.shadow.blur,
        color: newConfig.shadow.color
      } : undefined,
      // Deep convert image object - get new ImageBitmap to avoid detached issue
      image: newConfig.image ? {
        imageId: newConfig.image.imageId,
        imageBitmap: null as any, // Set to null first, get new ImageBitmap later
        fit: newConfig.image.fit,
        position: newConfig.image.position,
        opacity: newConfig.image.opacity,
        blur: newConfig.image.blur,
        scale: newConfig.image.scale,
        offsetX: newConfig.image.offsetX,
        offsetY: newConfig.image.offsetY
      } : undefined,
      // Deep convert wallpaper object - get new ImageBitmap to avoid detached issue
      wallpaper: newConfig.wallpaper ? {
        imageId: newConfig.wallpaper.imageId,
        imageBitmap: null as any, // Set to null first, get new ImageBitmap later
        fit: newConfig.wallpaper.fit,
        position: newConfig.wallpaper.position,
        opacity: newConfig.wallpaper.opacity,
        blur: newConfig.wallpaper.blur,
        scale: newConfig.wallpaper.scale,
        offsetX: newConfig.wallpaper.offsetX,
        offsetY: newConfig.wallpaper.offsetY
      } : undefined,
      // 🆕 添加视频裁剪配置
      videoCrop: videoCropStore.getCropConfig(),
      // 🆕 添加视频 Zoom 配置
      videoZoom: videoZoomStore.getZoomConfig()
    }

    console.log('⚙️ [VideoPreview] Updating background config:', plainConfig)

    // If image background, get new ImageBitmap
    const transferObjects: Transferable[] = []
    if (plainConfig.image && newConfig.image) {
      try {
        // Get new ImageBitmap from ImageBackgroundManager
        const freshImageBitmap = imageBackgroundManager.getImageBitmap(newConfig.image.imageId)

        if (freshImageBitmap) {
          // Create ImageBitmap copy for transfer
          const imageBitmapCopy = await createImageBitmap(freshImageBitmap)
          plainConfig.image.imageBitmap = imageBitmapCopy
          transferObjects.push(imageBitmapCopy as any)
        } else {
          console.warn('⚠️ [VideoPreview] ImageBitmap not found for imageId:', newConfig.image.imageId)
          plainConfig.image = undefined // Remove image config if ImageBitmap not found
        }
      } catch (error) {
        console.error('❌ [VideoPreview] Failed to get ImageBitmap:', error)
        plainConfig.image = undefined
      }
    }

    // If wallpaper background, get new ImageBitmap
    if (plainConfig.wallpaper && newConfig.wallpaper) {
      try {
        // Get new ImageBitmap from ImageBackgroundManager
        const freshImageBitmap = imageBackgroundManager.getImageBitmap(newConfig.wallpaper.imageId)

        if (freshImageBitmap) {
          // Create ImageBitmap copy for transfer
          const imageBitmapCopy = await createImageBitmap(freshImageBitmap)
          plainConfig.wallpaper.imageBitmap = imageBitmapCopy
          transferObjects.push(imageBitmapCopy as any)
        } else {
          console.warn('⚠️ [VideoPreview] ImageBitmap not found for wallpaper imageId:', newConfig.wallpaper.imageId)
          plainConfig.wallpaper = undefined // Remove wallpaper config if ImageBitmap not found
        }
      } catch (error) {
        console.error('❌ [VideoPreview] Failed to get wallpaper ImageBitmap:', error)
        plainConfig.wallpaper = undefined
      }
    }

    // 🔧 修复：包含窗口信息，确保 Zoom 时间计算正确
    compositeWorker.postMessage({
      type: 'config',
      data: {
        backgroundConfig: plainConfig,
        startGlobalFrame: windowStartIndex,  // 🔧 添加窗口起始帧
        frameRate: frameRate  // 🔧 添加帧率
      }
    }, transferObjects.length > 0 ? { transfer: transferObjects } : undefined)

    console.log('🔍 [VideoPreview] Config update with window info:', {
      startGlobalFrame: windowStartIndex,
      frameRate: frameRate
    })
  }

  // Reactive processing - only process once after recording is complete
  let hasProcessed = false
  // 🔧 修复：追踪已处理的 chunks 引用，防止重复处理
  let processedChunksRef: any[] | null = null
  let lastChunksRef: any[] | null = null

  $effect(() => {
    console.log('🔍 [VideoPreview] Effect triggered:', {
      isRecordingComplete,
      chunksLength: encodedChunks.length,
      hasProcessed,
      isInitialized,
      hasWorker: !!compositeWorker
    })

    console.log('[progress] Component state check:', {
      isRecordingComplete,
      chunksLength: encodedChunks.length,
      hasProcessed,
      isInitialized,
      hasWorker: !!compositeWorker,
      durationMs,
      totalFrames,
      totalFramesAll,
      showTimeline,
      timelineMaxMs,
      timelineCondition: showTimeline && timelineMaxMs > 0
    })

    // Only process when recording is complete and has encoded chunks
    if (isRecordingComplete &&
        encodedChunks.length > 0 &&
        !hasProcessed &&
        isInitialized &&
        compositeWorker) {
      console.log('🎬 [VideoPreview] Processing completed recording with', encodedChunks.length, 'chunks')
      hasProcessed = true
      processedChunksRef = encodedChunks  // 🔧 标记为已处理，防止第二个 effect 重复处理
      processVideo().catch(error => {
        console.error('❌ [VideoPreview] Failed to process video:', error)
      })
    }
  })

  // When external window data (encodedChunks) reference changes, allow reprocessing
  // 🔧 修复：使用 processedChunksRef 追踪已处理的 chunks，避免重复处理
  $effect(() => {
    if (encodedChunks && encodedChunks !== lastChunksRef) {
      const oldRef = lastChunksRef
      lastChunksRef = encodedChunks

      // 🔧 关键修复：如果这批 chunks 已经被处理过，跳过
      if (encodedChunks === processedChunksRef) {
        console.log('[progress] Skipping already processed chunks:', {
          length: encodedChunks.length,
          windowStartIndex
        })
        return
      }

      console.log('[progress] New window data detected, reprocessing:', {
        oldLength: oldRef?.length || 0,
        newLength: encodedChunks.length,
        windowStartIndex,
        wasProcessed: hasProcessed
      })

      // 🔧 只有当 oldRef 不为 null 时才重置 hasProcessed
      // 这样首次加载时不会与第一个 effect 冲突
      if (oldRef !== null) {
        hasProcessed = false
      }

      // 🔧 Immediately process new window data
      if (isRecordingComplete && encodedChunks.length > 0 && isInitialized && compositeWorker && !hasProcessed) {
        console.log('[progress] Immediately processing new window data')

        // Reset current frame index only when truly idle (no preview/restore pending)
        const hasPending = isPreviewMode || pendingPreviewWindowSwitch || (pendingRestoreGlobalFrameIndex != null)
        if (!shouldContinuePlayback && !hasPending) {
          currentFrameIndex = 0
          console.log('[progress] Reset currentFrameIndex to 0 for new window (no resume, no pending)')
        } else {
          console.log('[progress] Preserve currentFrameIndex due to resume or pending restore/preview', {
            shouldContinuePlayback,
            isPreviewMode,
            pendingPreviewWindowSwitch,
            pendingRestoreGlobalFrameIndex
          })
        }

        hasProcessed = true
        processedChunksRef = encodedChunks  // 标记为已处理
        processVideo().catch(error => {
          console.error('❌ [VideoPreview] Failed to process new window data:', error)
        })
      }
    }
  })

  // 🔧 Handle window playback complete - continuous playback core functionality
  function handleWindowComplete(data: { totalFrames: number, lastFrameIndex: number }) {
    console.log('[progress] Handling window complete:', {
      windowStartIndex,
      totalFrames: data.totalFrames,
      lastFrameIndex: data.lastFrameIndex,
      totalFramesAll,
      currentGlobalFrame: windowStartIndex + data.lastFrameIndex,
      isPlaying
    })

    // 🔧 Only handle window complete when in playing state
    if (!isPlaying) {
      console.log('[progress] Not playing, ignoring window complete')
      return
    }

    const currentGlobalFrame = windowStartIndex + data.lastFrameIndex
    const nextGlobalFrame = currentGlobalFrame + 1

    // Check if there are more frames
    if (nextGlobalFrame < totalFramesAll) {
      // 🔧 #4 修复：简化窗口选择逻辑
      // 核心原则：始终从 nextGlobalFrame 开始，保证帧连续性
      // 预取缓存仅用于加速解码，不改变请求起点
      
      let plannedNext = nextGlobalFrame  // 🔧 始终从下一帧开始，不跳帧
      let windowSize = Math.min(90, totalFramesAll - nextGlobalFrame)
      let usePrefetchCache = false
      
      // 🔧 #4 修复：预取缓存匹配检查
      // 只有当缓存起点恰好等于 nextGlobalFrame 时才使用，否则丢弃
      if (prefetchCache) {
        if (prefetchCache.targetGlobalFrame === nextGlobalFrame) {
          // ✅ 完美匹配：缓存正好是我们需要的
          windowSize = Math.min(prefetchCache.windowSize, totalFramesAll - plannedNext)
          usePrefetchCache = true
          console.log('[prefetch] Cache hit: using prefetch for frame', nextGlobalFrame)
        } else if (prefetchCache.targetGlobalFrame < nextGlobalFrame) {
          // ❌ 缓存已过时：丢弃
          console.log('[prefetch] Cache stale: expected', nextGlobalFrame, 'but cache starts at', prefetchCache.targetGlobalFrame)
          prefetchCache = null
        } else {
          // ⚠️ 缓存是未来的：暂时保留，但不使用
          console.log('[prefetch] Cache for future frame', prefetchCache.targetGlobalFrame, ', requesting', nextGlobalFrame)
        }
      }

      // Guard: avoid requesting non-forward or out-of-range window at tail
      if (plannedNext <= windowStartIndex || plannedNext >= totalFramesAll) {
        console.log('[progress] No forward progress available (plannedNext=', plannedNext, '), stopping playback')
        isPlaying = false
        shouldContinuePlayback = false
        return
      }

      console.log('[progress] Requesting next window for continuous playback:', {
        nextGlobalFrame: plannedNext,
        totalFramesAll,
        remainingFrames: totalFramesAll - plannedNext,
        usePrefetchCache
      })

      // Observation: cutover time start point
      cutoverPlannedNext = plannedNext
      cutoverTimerLabel = `[cutover] to ${plannedNext}`
      try { console.time(cutoverTimerLabel) } catch {}

      // 🔧 #4 修复：始终从 nextGlobalFrame 继续
      shouldContinuePlayback = true
      continueFromGlobalFrame = plannedNext

      // 🔧 Directly use frame range request, avoid time conversion error
      if (onRequestWindow) {
        const nextTimeMs = (plannedNext / frameRate) * 1000
        onRequestWindow({
          centerMs: nextTimeMs,
          beforeMs: 0,
          afterMs: (windowSize / frameRate) * 1000
        })
      }

      // Clear plan once after this request
      prefetchPlan = null
    } else {
      console.log('[progress] Reached end of video, stopping playback')
      isPlaying = false
      shouldContinuePlayback = false
    }
  }

  // 🔧 Global frame positioning system - video editor core functionality
  function seekToGlobalFrame(globalFrameIndex: number) {
    console.log('[progress] Seeking to global frame:', {
      globalFrameIndex,
      windowStartIndex,
      totalFrames,
      totalFramesAll
    })

    const windowFrameIndex = globalFrameIndex - windowStartIndex

    if (windowFrameIndex >= 0 && windowFrameIndex < totalFrames) {
      // Within current window, seek directly
      console.log('[progress] Frame in current window, seeking locally:', windowFrameIndex)
      seekToFrame(windowFrameIndex)
    } else {
      // Need to switch window
      console.log('[progress] Frame outside current window, requesting new window')
      const targetTimeMs = (globalFrameIndex / frameRate) * 1000

      // guard default ready behavior while switching
      pendingPreviewWindowSwitch = true
      onRequestWindow?.({
        centerMs: targetTimeMs,
        beforeMs: 1500,
        afterMs: 1500
      })
    }
  }

  function seekToGlobalTime(globalTimeMs: number) {
    const globalFrameIndex = Math.floor((globalTimeMs / 1000) * frameRate)
    seekToGlobalFrame(globalFrameIndex)
  }

  // Timeline input handling (based on milliseconds)
  function handleTimelineInput(timeMs: number) {
    // 🔧 如果在预览模式，退出预览并清除保存状态
    if (isPreviewMode) {
      isPreviewMode = false
      savedPlaybackState = null
      console.log('🔍 [Preview] Exited preview mode due to timeline click')
    }

    const clampedMs = Math.max(0, Math.min(timeMs, timelineMaxMs))
    console.log('[progress] Timeline input:', {
      timeMs,
      clampedMs,
      windowStartMs,
      windowEndMs,
      timelineMaxMs
    })

    // 🔧 Use global time positioning
    seekToGlobalTime(clampedMs)
  }

  // 🆕 处理鼠标悬停预览 - #9 #10 优化版本
  function handleHoverPreview(timeMs: number) {
    // 🔧 防御性检查：确保时间值有效
    if (typeof timeMs !== 'number' || isNaN(timeMs) || timeMs < 0) {
      console.warn('⚠️ [Preview] Invalid timeMs:', timeMs)
      return
    }

    // 节流控制
    if (hoverPreviewThrottleTimer) return

    hoverPreviewThrottleTimer = window.setTimeout(() => {
      hoverPreviewThrottleTimer = null
    }, HOVER_PREVIEW_THROTTLE_MS)

    if (!isPreviewMode) {
      // 进入预览模式
      isPreviewMode = true

      // 🔧 #10 优化：保存当前播放状态（使用更安全的深拷贝）
      savedPlaybackState = {
        frameIndex: windowStartIndex + currentFrameIndex,  // 保存全局帧位置
        isPlaying: isPlaying,
        windowStartIndex: windowStartIndex  // 🆕 同时保存窗口信息
      }

      // 暂停播放（如果正在播放）
      if (isPlaying) {
        pause()
      }

      console.log('🔍 [Preview] Entered preview mode, saved state:', savedPlaybackState)
    }

    // 计算预览帧索引（全局 → 窗口内）
    const globalFrameIndex = Math.floor((timeMs / 1000) * frameRate)
    const windowFrameIndex = globalFrameIndex - windowStartIndex

    previewTimeMs = timeMs

    if (windowFrameIndex >= 0 && windowFrameIndex < totalFrames) {
      // 🔧 在当前窗口内，立即显示预览帧（帧已在内存中）
      isLoadingPreview = false

      // 🔧 取消任何挂起的窗口切换请求
      if (windowSwitchThrottleTimer) {
        clearTimeout(windowSwitchThrottleTimer)
        windowSwitchThrottleTimer = null
      }

      // 请求预览帧
      if (compositeWorker) {
        compositeWorker.postMessage({
          type: 'preview-frame',
          data: { frameIndex: windowFrameIndex }
        })
      }
    } else {
      // 🆕 Optimization: use single-frame preview (only load minimal GOP) instead of full window switching
      // Cancel any previous pending request
      if (windowSwitchThrottleTimer) {
        clearTimeout(windowSwitchThrottleTimer)
      }

      windowSwitchThrottleTimer = window.setTimeout(async () => {
        windowSwitchThrottleTimer = null

        // Check again if preview is still needed (mouse may have moved back into window or left)
        if (!isPreviewMode) return
        const currentGlobalFrame = Math.floor((previewTimeMs / 1000) * frameRate)
        const currentWindowFrame = currentGlobalFrame - windowStartIndex
        if (currentWindowFrame >= 0 && currentWindowFrame < totalFrames) {
          // 已经在窗口内了，直接请求预览
          if (compositeWorker) {
            compositeWorker.postMessage({
              type: 'preview-frame',
              data: { frameIndex: currentWindowFrame }
            })
          }
          return
        }

        // 🆕 Use single-frame GOP preview (if available)
        if (fetchSingleFrameGOP && compositeWorker) {
          console.log('🔍 [Preview] Using single-frame GOP preview for frame:', currentGlobalFrame)

          // 显示加载指示器（延迟）
          previewLoadingStartTime = performance.now()
          pendingPreviewWindowSwitch = true
          setTimeout(() => {
            if (isPreviewMode && pendingPreviewWindowSwitch &&
                performance.now() - previewLoadingStartTime >= PREVIEW_LOADING_DELAY_MS) {
              isLoadingPreview = true
            }
          }, PREVIEW_LOADING_DELAY_MS)

          try {
            const gopData = await fetchSingleFrameGOP(currentGlobalFrame)

            // 检查预览模式是否仍然有效
            if (!isPreviewMode || !gopData || gopData.chunks.length === 0) {
              pendingPreviewWindowSwitch = false
              isLoadingPreview = false
              return
            }

            // 发送单帧解码请求到 composite worker
            compositeWorker.postMessage({
              type: 'decodeSingleFrame',
              data: {
                chunks: gopData.chunks,
                targetIndexInGOP: gopData.targetIndexInGOP,
                globalFrameIndex: currentGlobalFrame
              }
            })
          } catch (error) {
            console.warn('⚠️ [Preview] Single-frame GOP fetch failed:', error)
            pendingPreviewWindowSwitch = false
            isLoadingPreview = false
          }
        } else {
          // 🔧 Fallback: use full window switching (legacy method)
          const targetTimeMs = (currentGlobalFrame / frameRate) * 1000

          // 显示加载指示器
          previewLoadingStartTime = performance.now()
          setTimeout(() => {
            if (isPreviewMode && pendingPreviewWindowSwitch &&
                performance.now() - previewLoadingStartTime >= PREVIEW_LOADING_DELAY_MS) {
              isLoadingPreview = true
            }
          }, PREVIEW_LOADING_DELAY_MS)

          // 触发窗口切换
          pendingPreviewWindowSwitch = true

          onRequestWindow?.({
            centerMs: targetTimeMs,
            beforeMs: 1000,
            afterMs: 2000
          })
        }
      }, WINDOW_SWITCH_DEBOUNCE_MS)  // 使用防抖延迟
    }
  }

  // 🆕 处理预览结束 - #10 优化版本：修复恢复边界情况
  function handleHoverPreviewEnd() {
    if (!isPreviewMode) {
      // 🔧 #9：即使不在预览模式，也清理加载状态
      isLoadingPreview = false
      return
    }

    console.log('🔍 [Preview] Exiting preview mode...')

    // 🔧 #9：立即清理加载状态
    isLoadingPreview = false
    
    // 🔧 清理预览状态
    isPreviewMode = false
    previewFrameIndex = null

    // 🔧 清理节流定时器
    if (hoverPreviewThrottleTimer) {
      clearTimeout(hoverPreviewThrottleTimer)
      hoverPreviewThrottleTimer = null
    }
    if (windowSwitchThrottleTimer) {
      clearTimeout(windowSwitchThrottleTimer)
      windowSwitchThrottleTimer = null
    }

    // 🔧 #10 核心修复：恢复到保存的播放位置
    if (savedPlaybackState) {
      const savedGlobalFrameIndex = savedPlaybackState.frameIndex
      const savedOriginalWindowStart = savedPlaybackState.windowStartIndex ?? savedGlobalFrameIndex
      const savedWindowFrameIndex = savedGlobalFrameIndex - windowStartIndex
      const wasPlaying = savedPlaybackState.isPlaying

      console.log('🔍 [Preview] Restoring to saved playback position:', {
        savedGlobalFrameIndex,
        savedOriginalWindowStart,
        savedWindowFrameIndex,
        windowStartIndex,
        totalFrames,
        wasPlaying
      })

      // 🔧 #10 修复：更宽容的边界判断
      // 即使保存的帧在当前窗口边界外一点，也尝试 clamp 到有效范围
      const clampedWindowFrameIndex = Math.max(0, Math.min(savedWindowFrameIndex, totalFrames - 1))
      const isWithinWindow = savedWindowFrameIndex >= 0 && savedWindowFrameIndex < totalFrames
      const isCloseEnough = Math.abs(savedWindowFrameIndex - clampedWindowFrameIndex) <= 5  // 允许 5 帧误差

      if (isWithinWindow || isCloseEnough) {
        // 在当前窗口内或接近边界，直接 seek 到 clamp 后的位置
        if (compositeWorker) {
          compositeWorker.postMessage({
            type: 'seek',
            data: { frameIndex: clampedWindowFrameIndex }
          })
          currentFrameIndex = clampedWindowFrameIndex
        }
        // 清除 pending 状态
        pendingPreviewWindowSwitch = false
        pendingRestoreGlobalFrameIndex = null

        // 恢复播放状态
        if (wasPlaying) {
          requestAnimationFrame(() => {
            play()
          })
        }
      } else {
        // 🔧 #10 修复：需要跳转到保存的全局位置
        // 先标记恢复目标，再触发窗口切换
        pendingRestoreGlobalFrameIndex = savedGlobalFrameIndex
        pendingPreviewWindowSwitch = true
        
        // 🆕 保存是否需要恢复播放的标志
        if (wasPlaying) {
          // 使用 shouldContinuePlayback 复用连续播放逻辑
          shouldContinuePlayback = true
          continueFromGlobalFrame = savedGlobalFrameIndex
        }
        
        seekToGlobalFrame(savedGlobalFrameIndex)
      }

      savedPlaybackState = null
    } else {
      // 🔧 防御性：即使没有保存状态，也清理 pending 标志
      console.warn('⚠️ [Preview] No saved playback state found')
      pendingPreviewWindowSwitch = false
      pendingRestoreGlobalFrameIndex = null
    }
  }

  // 🆕 处理 Zoom 区间变化
  async function handleZoomChange(startMs: number, endMs: number): Promise<boolean> {
    console.log('🔍 [VideoPreview] handleZoomChange called:', { startMs, endMs })

    // 特殊情况：(0, 0) 表示清除所有 Zoom
    if (startMs === 0 && endMs === 0) {
      videoZoomStore.clearAll()
      // ✅ P0 修复：等待配置更新完成
      await updateBackgroundConfig(backgroundConfig)

      // 🆕 强制刷新当前帧（如果暂停状态）
      if (!isPlaying) {
        seekToFrame(currentFrameIndex)
      }

      console.log('✅ [VideoPreview] Zoom cleared and config updated')
      return true
    }

    // 尝试添加区间
    const success = videoZoomStore.addInterval(startMs, endMs)

    console.log('🔍 [VideoPreview] addInterval result:', success)
    console.log('🔍 [VideoPreview] videoZoomStore state:', {
      enabled: videoZoomStore.enabled,
      intervals: videoZoomStore.intervals,
      zoomConfig: videoZoomStore.getZoomConfig()
    })

    if (success) {
      // ✅ P0 修复：等待配置更新完成
      await updateBackgroundConfig(backgroundConfig)

      // 🆕 强制刷新当前帧（如果暂停状态）
      if (!isPlaying) {
        seekToFrame(currentFrameIndex)
      }

      console.log('✅ [VideoPreview] Zoom interval added and config updated')
    }

    return success
  }

  // 🆕 处理删除 Zoom 区间
  async function handleZoomRemove(index: number): Promise<void> {
    videoZoomStore.removeInterval(index)

    // ✅ P0 修复：等待配置更新完成
    await updateBackgroundConfig(backgroundConfig)

    // 🆕 强制刷新当前帧（如果暂停状态）
    if (!isPlaying) {
      seekToFrame(currentFrameIndex)
    }

    console.log('✅ [VideoPreview] Zoom interval removed and config updated')
  }

  // 🆕 处理移动 Zoom 区间
  async function handleZoomIntervalMove(index: number, newStartMs: number, newEndMs: number): Promise<boolean> {
    console.log('🔍 [VideoPreview] handleZoomIntervalMove called:', { index, newStartMs, newEndMs })
    console.log('🔍 [VideoPreview] Before moveInterval - videoZoomStore state:', {
      enabled: videoZoomStore.enabled,
      intervals: videoZoomStore.intervals
    })

    const success = videoZoomStore.moveInterval(index, newStartMs, newEndMs)

    console.log('🔍 [VideoPreview] After moveInterval - success:', success)
    console.log('🔍 [VideoPreview] After moveInterval - videoZoomStore state:', {
      enabled: videoZoomStore.enabled,
      intervals: videoZoomStore.intervals,
      zoomConfig: videoZoomStore.getZoomConfig()
    })

    if (success) {
      // ✅ P0 修复：等待配置更新完成
      await updateBackgroundConfig(backgroundConfig)

      // 🆕 强制刷新当前帧（如果暂停状态）
      if (!isPlaying) {
        seekToFrame(currentFrameIndex)
      }

      console.log('✅ [VideoPreview] Zoom interval moved and config updated')
    }

    return success
  }



  // 🎯 请求任意窗口内帧的位图
  function getFrameBitmapForWindowIndex(windowFrameIndex: number): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('❌ [VideoPreview] getCurrentFrameBitmap timeout')
        waitingForFrameBitmap = false
        frameBitmapResolver = null
        frameBitmapRejecter = null
        reject(new Error('Timeout waiting for frameBitmap'))
      }, 3000)

      waitingForFrameBitmap = true
      frameBitmapResolver = (bitmap: ImageBitmap) => {
        clearTimeout(timeout)
        resolve(bitmap)
      }
      frameBitmapRejecter = (error: Error) => {
        clearTimeout(timeout)
        reject(error)
      }

      console.log('🎯 [VideoPreview] Requesting frame bitmap for window index', windowFrameIndex)
      compositeWorker!.postMessage({
        type: 'getCurrentFrameBitmap',
        data: { frameIndex: windowFrameIndex }
      })
    })
  }

  // 🆕 获取“源帧”位图（不带任何缩放/平移/合成偏移），用于焦点设置面板
  function getRawSourceFrameBitmapForWindowIndex(windowFrameIndex: number): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('❌ [VideoPreview] getSourceFrameBitmap timeout')
        waitingForFrameBitmap = false
        frameBitmapResolver = null
        frameBitmapRejecter = null
        reject(new Error('Timeout waiting for raw frameBitmap'))
      }, 3000)

      waitingForFrameBitmap = true
      frameBitmapResolver = (bitmap: ImageBitmap) => {
        clearTimeout(timeout)
        resolve(bitmap)
      }
      frameBitmapRejecter = (error: Error) => {
        clearTimeout(timeout)
        reject(error)
      }

      console.log('🎯 [VideoPreview] Requesting RAW source frame bitmap for window index', windowFrameIndex)
      compositeWorker!.postMessage({
        type: 'getSourceFrameBitmap',
        data: { frameIndex: windowFrameIndex }
      })
    })
  }

  // 🎯 进入焦点设置模式（针对某个区间的首帧）
  async function handleZoomFocusSetup(intervalIndex: number) {
    try {
      if (isPlaying) pause()
      const interval = videoZoomStore.intervals[intervalIndex]
      if (!interval) {
        console.warn('⚠️ [VideoPreview] Invalid interval index for focus setup:', intervalIndex)
        return
      }
      const startMs = interval.startMs
      const globalFrameIndex = Math.floor((startMs / 1000) * frameRate)
      const windowFrameIndex = globalFrameIndex - windowStartIndex

      // 若目标帧在当前窗口内，直接请求位图
      if (compositeWorker && windowFrameIndex >= 0 && windowFrameIndex < totalFrames) {
        const bitmap = await getRawSourceFrameBitmapForWindowIndex(windowFrameIndex)
        focusFrameBitmap = bitmap
        focusFrameSize = { width: bitmap.width, height: bitmap.height }  // 🔧 使用独立变量
        focusIntervalIndex = intervalIndex
        isFocusMode = true
        return
      }

      // 否则，触发切窗，待 ready 后再获取
      pendingFocusGlobalFrame = globalFrameIndex
      pendingFocusIntervalIndex = intervalIndex
      // 复用预览的 pending 标志以避免 ready 时默认跳 0 帧
      pendingPreviewWindowSwitch = true
      console.log('🎯 [VideoPreview] Focus target outside window, requesting window switch', {
        startMs,
        globalFrameIndex,
        windowStartIndex,
        totalFrames
      })
      onRequestWindow?.({
        centerMs: startMs,
        beforeMs: 0,
        afterMs: Math.min(1000, timelineMaxMs - startMs)
      })
    } catch (error) {
      console.error('❌ [VideoPreview] Failed to start focus setup:', error)
    }
  }

  // 🎯 退出焦点模式（可选择应用）
  // 🆕 P1: 扩展 payload 支持 mode, easing, transitionDurationMs
  // 🆕 P2: 扩展 payload 支持 syncBackground
  interface FocusModePayload {
    focus: { x: number; y: number; space: 'source' | 'layout' }
    scale?: number
    mode?: ZoomMode
    easing?: ZoomEasing
    transitionDurationMs?: number
    syncBackground?: boolean
  }

  async function exitFocusMode(apply: boolean, payload?: FocusModePayload) {
    try {
      if (apply && payload && focusIntervalIndex != null) {
        // 基础属性
        videoZoomStore.setIntervalFocus(focusIntervalIndex, payload.focus)
        if (payload.scale != null) {
          videoZoomStore.setIntervalScale(focusIntervalIndex, payload.scale)
        }
        // 🆕 P1: 新增属性
        if (payload.mode != null) {
          videoZoomStore.setIntervalMode(focusIntervalIndex, payload.mode)
        }
        if (payload.easing != null) {
          videoZoomStore.setIntervalEasing(focusIntervalIndex, payload.easing)
        }
        if (payload.transitionDurationMs != null) {
          videoZoomStore.setIntervalTransitionDuration(focusIntervalIndex, payload.transitionDurationMs)
        }
        // 🆕 P2: 背景同步放大
        if (payload.syncBackground != null) {
          videoZoomStore.setIntervalSyncBackground(focusIntervalIndex, payload.syncBackground)
        }
        await updateBackgroundConfig(backgroundConfig)
        if (!isPlaying) {
          // 刷新当前帧，确保效果即时可见
          seekToFrame(currentFrameIndex)
        }
      }
    } finally {
      isFocusMode = false
      if (focusFrameBitmap) {
        try { focusFrameBitmap.close() } catch {}
        focusFrameBitmap = null
      }
      focusFrameSize = null  // 🔧 清理焦点帧尺寸
      focusIntervalIndex = null
    }
  }

  $effect(() => {
    if (backgroundConfig && compositeWorker && totalFrames > 0) {
      updateBackgroundConfig(backgroundConfig)
    }
  })

  // Respond to output size changes, update preview size
  $effect(() => {
    if (outputWidth > 0 && outputHeight > 0) {
      updatePreviewSize()
    }
  })

  // Component mount
  onMount(() => {
    console.log('[progress] Component mounted with props:', {
      encodedChunks: encodedChunks.length,
      isRecordingComplete,
      durationMs,
      windowStartMs,
      windowEndMs,
      showTimeline,
      totalFramesAll,
      windowStartIndex
    })
    initializeCanvas()
    initializeWorker()

  // Listen for key props changes
  $effect(() => {
    console.log('[progress] Props changed:', {
      durationMs,
      windowStartMs,
      windowEndMs,
      showTimeline,
      totalFramesAll,
      windowStartIndex,
      encodedChunksLength: encodedChunks.length,
      isRecordingComplete,
      shouldContinuePlayback
    })

    // Note: continue playback logic has been moved to worker ready event handling
  })

  // When totalFrames/showTimeline/showControls or container size changes, recalculate preview size,
  // to reserve space for timeline/control bar, avoid being clipped by overflow-hidden
  $effect(() => {
    // Trigger dependency tracking
    const _tf = totalFrames
    const _st = showTimeline
    const _sc = showControls
    const _dw = displayWidth
    const _dh = displayHeight
    if (outputWidth > 0 && outputHeight > 0) {
      updatePreviewSize()
    }
  })


    // Cleanup function
    return () => {
      if (compositeWorker) {
        compositeWorker.terminate()
        compositeWorker = null
      }
    }
  })

  // Export control methods
  export function getControls() {
    return {
      play,
      pause,
      stop,
      seekToFrame,
      seekToTime,
      seekToGlobalFrame,
      seekToGlobalTime,
      updateBackgroundConfig,
      getCurrentFrame: () => currentFrameIndex,
      getCurrentTime: () => currentTime,
      getTotalFrames: () => totalFrames,
      getGlobalFrame: () => windowStartIndex + currentFrameIndex,
      getDuration: () => duration,
      isPlaying: () => isPlaying
    }
  }
</script>

<!-- Video preview container - optimized for full height layout -->
<div class="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden {className}">
  
  <!-- 🔧 普通预览模式区域 - 包含 Canvas 和时间轴 -->
  <!-- 在裁剪模式下整体隐藏，避免布局混乱 -->
  <div class:hidden={isCropMode || isFocusMode} class="flex-1 flex flex-col min-h-0">
    <!-- Canvas display area - takes remaining space -->
    <div class="flex-1 flex items-center justify-center p-0 min-h-0">
      <div class="relative bg-black flex items-center justify-center rounded overflow-hidden" style="width: {previewWidth}px; height: {previewHeight}px;">
        <canvas
          bind:this={canvas}
          class="block rounded transition-opacity duration-300"
          class:opacity-50={isProcessing}
          style="width: {previewWidth}px; height: {previewHeight}px;"
        ></canvas>

        {#if isProcessing}
          <div class="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
            <LoaderCircle class="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <span class="text-sm">Processing video...</span>
          </div>
        {/if}
        
        {#if isLoadingPreview && !isProcessing}
          <!-- 🆕 #9 优化：预览加载指示器 - 轻量级设计，不遮挡视频 -->
          <div class="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 bg-black/70 rounded-full backdrop-blur-sm">
            <LoaderCircle class="w-4 h-4 text-blue-400 animate-spin" />
            <span class="text-xs text-gray-200">Loading...</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Time axis with controls - using new Timeline component -->
    {#if showTimeline && timelineMaxMs > 0}
    <div class="flex-shrink-0 px-6 py-3 bg-gray-800">
      <!-- 控制按钮和信息 - 三栏布局 -->
      <div class="flex justify-between items-center mb-3">
        <!-- 左侧：裁剪按钮和裁剪信息 -->
        <div class="flex items-center gap-3 text-sm flex-1">
          <!-- 启用/禁用裁剪按钮 -->
          <button
            class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            class:bg-blue-500={trimStore.enabled}
            class:border-blue-600={trimStore.enabled}
            class:text-white={trimStore.enabled}
            class:hover:bg-blue-600={trimStore.enabled}
            class:bg-gray-700={!trimStore.enabled}
            class:border-gray-600={!trimStore.enabled}
            class:text-gray-200={!trimStore.enabled}
            class:hover:bg-gray-600={!trimStore.enabled}
            class:hover:border-gray-500={!trimStore.enabled}
            onclick={() => trimStore.toggle()}
            disabled={isProcessing}
            title={trimStore.enabled ? 'Disable trim' : 'Enable trim'}
          >
            <Scissors class="w-3.5 h-3.5" />
            {trimStore.enabled ? 'Trim On' : 'Trim Off'}
          </button>

          <!-- 裁剪信息 -->
          {#if trimStore.enabled}
            <span class="text-xs text-blue-400 font-semibold">
              ✂️ {formatTimeSec(trimStore.trimDurationMs / 1000)} ({trimStore.trimFrameCount} frames)
            </span>
          {/if}
        </div>

        <!-- 中间：播放按钮 + 时间显示 - 带圆角矩形背景（毛玻璃效果） -->
        <div class="flex items-center gap-3 flex-shrink-0 px-4 py-2 bg-gray-700/90 rounded-full border border-gray-500/50 shadow-lg backdrop-blur-lg">
          <!-- 播放/暂停按钮 -->
          <button
            class="flex items-center justify-center w-9 h-9 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-md cursor-pointer transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-600 hover:scale-105"
            onclick={isPlaying ? pause : play}
            disabled={isProcessing}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {#if isPlaying}
              <Pause class="w-4 h-4" />
            {:else}
              <Play class="w-4 h-4 ml-0.5" />
            {/if}
          </button>

          <!-- 时间显示 -->
          <span class="font-mono text-sm text-gray-200 whitespace-nowrap tracking-tight">
            {formatTimeSec(currentTimeMs / 1000)} <span class="text-gray-500">/</span> {formatTimeSec(uiDurationSec)}
          </span>
        </div>

        <!-- 右侧：帧信息、分辨率和 Crop 按钮 -->
        <div class="flex items-center justify-end gap-4 text-xs text-gray-400 flex-1">
          <span>Frame: {currentFrameNumber}/{totalFramesAll > 0 ? totalFramesAll : (totalFrames > 0 ? totalFrames : encodedChunks.length)}</span>
          <span>Resolution: {outputWidth}×{outputHeight}</span>
          <!-- Add Zoom 按钮 -->
          <button
            class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600 hover:border-gray-500"
            onclick={() => handleZoomChange(currentTimeMs, Math.min(currentTimeMs + 1500, timelineMaxMs))}
            disabled={isProcessing}
            title="Add zoom effect at current time"
          >
            <ZoomIn class="w-3.5 h-3.5" />
            Add Zoom
          </button>

          <!-- Crop 按钮 -->
          <button
            class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            class:bg-blue-500={videoCropStore.enabled}
            class:border-blue-600={videoCropStore.enabled}
            class:text-white={videoCropStore.enabled}
            class:hover:bg-blue-600={videoCropStore.enabled}
            class:bg-gray-700={!videoCropStore.enabled}
            class:border-gray-600={!videoCropStore.enabled}
            class:text-gray-200={!videoCropStore.enabled}
            class:hover:bg-gray-600={!videoCropStore.enabled}
            class:hover:border-gray-500={!videoCropStore.enabled}
            onclick={enterCropMode}
            disabled={isProcessing || !hasEverProcessed}
            title={videoCropStore.enabled ? 'Click to adjust crop area' : 'Crop video'}
          >
            <Crop class="w-3.5 h-3.5" />
            {videoCropStore.enabled ? 'Edit Crop' : 'Crop'}
          </button>
        </div>
      </div>

      <!-- New Timeline Component -->
      <Timeline
        {timelineMaxMs}
        currentTimeMs={currentTimeMs}
        {frameRate}
        {isPlaying}
        {isProcessing}
        trimEnabled={trimStore.enabled}
        trimStartMs={trimStore.trimStartMs}
        trimEndMs={trimStore.trimEndMs}
        zoomIntervals={videoZoomStore.intervals}
        onSeek={handleTimelineInput}
        onHoverPreview={handleHoverPreview}
        onHoverPreviewEnd={handleHoverPreviewEnd}
        onZoomFocusSetup={handleZoomFocusSetup}
        onTrimStartChange={(newMs) => {
          trimStore.setTrimStart(newMs)
          trimStore.enable()
          seekToGlobalTime(newMs)
        }}
        onTrimEndChange={(newMs) => {
          trimStore.setTrimEnd(newMs)
          trimStore.enable()
          seekToGlobalTime(newMs)
        }}
        onTrimToggle={() => trimStore.toggle()}
        onZoomChange={handleZoomChange}
        onZoomRemove={handleZoomRemove}
        onZoomIntervalMove={handleZoomIntervalMove}
      />
    </div>
  {/if}
  </div>
  <!-- 🔧 普通预览模式区域结束 -->

  <!-- 🆕 裁剪模式 - 独立显示，不销毁 Canvas -->
  {#if isCropMode}
    <div class="flex-1 flex items-center justify-center p-4 min-h-0">
      {#if currentFrameBitmap && videoInfo}
        <VideoCropPanel
          frameBitmap={currentFrameBitmap}
          videoWidth={videoInfo.width}
          videoHeight={videoInfo.height}
          displayWidth={previewWidth}
          displayHeight={previewHeight}
          onConfirm={() => exitCropMode(true)}
          onCancel={() => exitCropMode(false)}
        />
      {/if}
    </div>
  {/if}
  <!-- 🎯 焦点设置模式 - 独立显示，不销毁 Canvas -->
  {#if isFocusMode}
    <div class="flex-1 flex items-center justify-center p-4 min-h-0">
      {#if focusFrameBitmap && focusFrameSize}
        <VideoFocusPanel
          frameBitmap={focusFrameBitmap}
          videoWidth={focusFrameSize.width}
          videoHeight={focusFrameSize.height}
          initialFocus={focusIntervalIndex !== null
            ? (videoZoomStore.getIntervalFocus(focusIntervalIndex) ?? { x: videoZoomStore.focusX, y: videoZoomStore.focusY, space: 'source' })
            : { x: videoZoomStore.focusX, y: videoZoomStore.focusY, space: 'source' }
          }
          initialScale={focusIntervalIndex !== null ? videoZoomStore.getIntervalScale(focusIntervalIndex) : videoZoomStore.scale}
          initialMode={focusIntervalIndex !== null ? videoZoomStore.getIntervalMode(focusIntervalIndex) : 'dolly'}
          initialEasing={focusIntervalIndex !== null ? videoZoomStore.getIntervalEasing(focusIntervalIndex) : 'smooth'}
          initialTransitionDurationMs={focusIntervalIndex !== null ? videoZoomStore.getIntervalTransitionDuration(focusIntervalIndex) : 300}
          initialSyncBackground={focusIntervalIndex !== null ? videoZoomStore.getIntervalSyncBackground(focusIntervalIndex) : false}
          onConfirm={(payload: FocusModePayload) => exitFocusMode(true, payload)}
          onCancel={() => exitFocusMode(false)}
        />
      {/if}
    </div>
  {/if}

</div>

