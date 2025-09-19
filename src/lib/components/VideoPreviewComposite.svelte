<!-- 视频预览组件 - 使用 VideoComposite Worker 进行背景合成 -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { Play, Pause, LoaderCircle, Monitor, Info } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { DataFormatValidator } from '$lib/utils/data-format-validator'
  import { imageBackgroundManager } from '$lib/services/image-background-manager'

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
    onRequestWindow?: (args: { centerMs: number; beforeMs: number; afterMs: number }) => void
    // 可选：只拉数据，不切窗，用于预取缓存
    fetchWindowData?: (args: { centerMs: number; beforeMs: number; afterMs: number }) => Promise<{ chunks: any[]; windowStartIndex: number }>
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
    onRequestWindow,
    fetchWindowData,
    className = ''
  }: Props = $props()

  // 预取缓存与计划（阶段2B-小步）：仅记录计划参数，后续填充数据
  type PrefetchPlan = { nextGlobalFrame: number; windowSize: number } | null
  let prefetchPlan: PrefetchPlan = null
  // 预留：未来可缓存已切片的 transferableChunks 与 transferObjects
  type PrefetchCache = {
    targetGlobalFrame: number
    windowSize: number
    transferableChunks: any[]
    transferObjects: Transferable[]
  } | null
  let prefetchCache: PrefetchCache = null
  // building flag to avoid duplicate prefetch
  let isBuildingPrefetch = false

  // 记录已发送到 worker 的 appendWindow 起点，避免重复追加解码
  let lastAppendedStartFrame: number | null = null

  // 最近一次 worker 上报的缓冲水位状态
  let lastBufferLevel: 'healthy' | 'low' | 'critical' | null = null

  // 观测：预取命中统计与切窗耗时
  let prefetchHits = 0
  let prefetchMisses = 0
  let cutoverTimerLabel: string | null = null
  let cutoverPlannedNext: number | null = null



  // 使用全局背景配置
  const backgroundConfig = $derived(backgroundConfigStore.config)

  // 状态变量 - 仅显示相关
  let canvas: HTMLCanvasElement
  let bitmapCtx: ImageBitmapRenderingContext | null = null
  let isInitialized = $state(false)
  let isProcessing = $state(false)
  let hasEverProcessed = $state(false)
  let compositeWorker: Worker | null = null
  // 播放控制状态
  let currentFrameIndex = $state(0)
  let totalFrames = $state(0)
  let currentTime = $state(0)
  let duration = $state(0)
  let frameRate = 30
  let isPlaying = $state(false)
  let shouldContinuePlayback = $state(false) // 🔧 连续播放标志
  let continueFromGlobalFrame = $state(0) // 🔧 记录应该从哪个全局帧继续播放

  // UI 显示用时长：优先使用全局帧数/帧率（与时间轴一致），其次 durationMs，最后回退内部 duration
  const uiDurationSec = $derived.by(() => {
    if (totalFramesAll > 0 && frameRate > 0) return totalFramesAll / frameRate
    if (durationMs > 0) return durationMs / 1000
    return duration
  })

  // 🔧 时间轴最大值（毫秒）：视频编辑器优化版本
  const timelineMaxMs = $derived.by(() => {
    let result: number

    // 优先级1：使用全局时长（基于全局帧数）
    if (totalFramesAll > 0 && frameRate > 0) {
      result = Math.max(1, Math.floor((totalFramesAll / frameRate) * 1000))
      console.log('[progress] timelineMaxMs: using global frames:', { totalFramesAll, frameRate, result })
    }
    // 优先级2：使用传入的真实时长
    else if (durationMs > 0) {
      result = Math.max(1, Math.floor(durationMs))
      console.log('[progress] timelineMaxMs: using durationMs:', { durationMs, result })
    }
    // 优先级3：使用当前窗口帧数推算
    else if (totalFrames > 0 && frameRate > 0) {
      result = Math.max(1, Math.floor((totalFrames / frameRate) * 1000))
      console.log('[progress] timelineMaxMs: using window frames:', { totalFrames, frameRate, result })
    }
    // 优先级4：使用窗口时长
    else if (windowEndMs > windowStartMs) {
      result = Math.max(1, windowEndMs - windowStartMs)
      console.log('[progress] timelineMaxMs: using window duration:', { windowStartMs, windowEndMs, result })
    }
    // 保底值
    else {
      result = 1000
      console.log('[progress] timelineMaxMs: using fallback:', { result })
    }

    console.log('[progress] timelineMaxMs calculated:', {
      result,
      totalFramesAll,
      durationMs,
      totalFrames,
      frameRate,
      windowStartMs,
      windowEndMs,
      showTimeline
    })

    return result
  })



  // 输出尺寸信息
  let outputWidth = $state(1920)
  let outputHeight = $state(1080)

  // 预览尺寸 - 根据输出比例动态调整
  let previewWidth = $state(displayWidth)
  let previewHeight = $state(displayHeight)

  // 更新预览尺寸 - 智能适应全高度布局
  function updatePreviewSize() {
    const aspectRatio = outputWidth / outputHeight

    // 计算可用空间 - 考虑控制栏和时间轴的高度
    const headerHeight = 60  // 预览信息栏高度
    const controlsHeight = showControls && totalFrames > 0 ? 56 : 0  // 播放控制栏高度
    const timelineHeight = showTimeline && totalFrames > 0 ? 48 : 0  // 时间轴高度
    const padding = 32  // Canvas 区域的内边距 (p-4 = 16px * 2)

    const availableWidth = displayWidth - padding
    const availableHeight = displayHeight - headerHeight - controlsHeight - timelineHeight - padding

    // 计算适合的预览尺寸，保持纵横比，充分利用可用空间
    let calculatedWidth, calculatedHeight

    if (aspectRatio > availableWidth / availableHeight) {
      // 宽度受限：使用全部可用宽度
      calculatedWidth = availableWidth
      calculatedHeight = Math.round(calculatedWidth / aspectRatio)
    } else {
      // 高度受限：使用全部可用高度
      calculatedHeight = availableHeight
      calculatedWidth = Math.round(calculatedHeight * aspectRatio)
    }

    // 确保最小尺寸，避免过小的预览
    const minSize = 300
    if (calculatedWidth < minSize || calculatedHeight < minSize) {
      if (aspectRatio > 1) {
        // 横屏视频
        previewWidth = Math.max(minSize, calculatedWidth)
        previewHeight = Math.round(previewWidth / aspectRatio)
      } else {
        // 竖屏视频
        previewHeight = Math.max(minSize, calculatedHeight)
        previewWidth = Math.round(previewHeight * aspectRatio)
      }
    } else {
      previewWidth = calculatedWidth
      previewHeight = calculatedHeight
    }

    // 确保不超过容器限制
    previewWidth = Math.min(previewWidth, availableWidth)
    previewHeight = Math.min(previewHeight, availableHeight)

    console.log('📐 [VideoPreview] Preview size updated:', {
      outputSize: { width: outputWidth, height: outputHeight },
      previewSize: { width: previewWidth, height: previewHeight },
      availableSpace: { width: availableWidth, height: availableHeight },
      uiElements: { headerHeight, controlsHeight, timelineHeight, padding },
      aspectRatio: aspectRatio.toFixed(3)
    })
  }

  // 初始化 Canvas（仅用于显示）
  function initializeCanvas() {
    if (!canvas) return

    // 使用 ImageBitmapRenderingContext 进行高效显示
    bitmapCtx = canvas.getContext('bitmaprenderer')

    if (!bitmapCtx) {
      console.error('❌ [VideoPreview] Failed to get ImageBitmapRenderingContext')
      return
    }

    // 不设置固定尺寸，让 CSS 控制显示尺寸
    // Canvas 会自动适应容器大小
    console.log('🎨 [VideoPreview] Canvas container size:', {
      containerWidth: canvas.parentElement?.clientWidth,
      containerHeight: canvas.parentElement?.clientHeight
    })

    isInitialized = true
    console.log('🎨 [VideoPreview] Canvas initialized for bitmap rendering')
  }

  // 初始化 VideoComposite Worker
  function initializeWorker() {
    if (compositeWorker) return

    console.log('👷 [VideoPreview] Creating VideoComposite Worker...')

    compositeWorker = new Worker(
      new URL('../workers/composite-worker/index.ts', import.meta.url),
      { type: 'module' }
    )

    // Worker 消息处理
    compositeWorker.onmessage = (event) => {
      const { type, data } = event.data

      switch (type) {
        case 'initialized':
          console.log('✅ [VideoPreview] Worker initialized')
          break

        case 'ready':
          console.log('✅ [VideoPreview] Video processing ready:', data)
          hasEverProcessed = true
          totalFrames = data.totalFrames
          duration = totalFrames / frameRate
          outputWidth = data.outputSize.width
          outputHeight = data.outputSize.height
          console.log('[progress] Worker ready - internal state updated:', {
            totalFrames,
            duration,
            outputSize: { width: outputWidth, height: outputHeight },
            shouldContinuePlayback,
            windowStartIndex
          })

          // 更新 Canvas 内部分辨率
          canvas.width = outputWidth
          canvas.height = outputHeight

          isProcessing = false
          // 观测：切窗耗时终点
          if (cutoverTimerLabel) {
            try { console.timeEnd(cutoverTimerLabel) } catch {}
            cutoverTimerLabel = null
          }

          // 默认预览首帧（不自动播放）
          seekToFrame(0)

          // 🔧 检查是否需要在新窗口准备后继续播放
          if (shouldContinuePlayback) {
            // 计算在新窗口中应该从哪一帧开始播放
            const targetWindowFrame = continueFromGlobalFrame - windowStartIndex
            const startFrame = Math.max(0, Math.min(targetWindowFrame, data.totalFrames - 1))

            console.log('[progress] Worker ready, continuing playback in new window:', {
              shouldContinuePlayback,
              continueFromGlobalFrame,
              windowStartIndex,
              targetWindowFrame,
              startFrame,
              totalFrames: data.totalFrames
            })

            // 🔧 立即重置标志，避免重复触发
            shouldContinuePlayback = false

            // 🔧 使用更可靠的异步调度
            requestAnimationFrame(() => {
              console.log('[progress] Starting playback in new window from frame', startFrame)
              seekToFrame(startFrame)
              // 确保seek完成后再开始播放
              requestAnimationFrame(() => {
                console.log('[progress] Resuming playback after seek')
                play()
              })
            })
          }
          break

        case 'frame':
          // 显示合成后的帧
          displayFrame(data.bitmap, data.frameIndex, data.timestamp)
          break

        case 'bufferStatus':
          // 阶段2B小步验证：记录水位状态，并生成预取计划（不改变现有行为）
          console.log(`🧯 [VideoPreview] Buffer status: ${data.level}`, data)
          // 记录最新水位
          lastBufferLevel = data.level as any

          // 若已有预取缓存且当前水位为 low/critical，则优先追加后台解码（避免健康期浪费）
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
            // 固定指向当前窗口末尾的下一窗口起点，避免随帧抖动
            const boundaryNext = windowStartIndex + Math.max(0, totalFrames)
            const nextGlobal = Math.min(boundaryNext, Math.max(0, totalFramesAll - 1))
            const remainingAll = Math.max(0, totalFramesAll - nextGlobal)
            const plannedSize = Math.min(90, remainingAll)
            if (plannedSize > 0) {
              const isSamePlan = prefetchPlan && prefetchPlan.nextGlobalFrame === nextGlobal
              if (!isSamePlan) {
                prefetchPlan = { nextGlobalFrame: nextGlobal, windowSize: plannedSize }
                console.log('[prefetch] Planned next window:', prefetchPlan)
              }


                // 丢弃过期的预取缓存：若缓存起点<=当前窗口起点，说明无效（可能是自我预取）
                if (prefetchCache && prefetchCache.targetGlobalFrame <= windowStartIndex) {
                  console.log('[prefetch] Discard stale cache for start:', prefetchCache.targetGlobalFrame, 'current windowStartIndex:', windowStartIndex)
                  prefetchCache = null
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

                    // 小步C：在缓存就绪后，提前把下一窗口编码块复制并下发给 worker 进行后台解码（不切窗）
                    try {
                      if (
                        (lastBufferLevel === 'low' || lastBufferLevel === 'critical') &&
                        compositeWorker &&
                        prefetchCache &&
                        prefetchCache.targetGlobalFrame > windowStartIndex &&
                        lastAppendedStartFrame !== prefetchCache.targetGlobalFrame
                      ) {
                        const appendedChunks = prefetchCache.transferableChunks.map((c: any) => {
                          const buf: ArrayBuffer = (c.data as ArrayBuffer).slice(0) // 复制一份，避免影响主线程缓存
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
          // 处理输出尺寸变化
          console.log('📐 [VideoPreview] Output size changed:', data)
          outputWidth = data.outputSize.width
          outputHeight = data.outputSize.height

          // 更新预览尺寸
          updatePreviewSize()

          // 更新 Canvas 内部分辨率
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

    // 初始化 Worker
    compositeWorker.postMessage({ type: 'init' })
  }

  // 显示帧（核心显示逻辑）
  function displayFrame(bitmap: ImageBitmap, frameIndex: number, timestamp: number) {
    if (!bitmapCtx) {
      console.error('❌ [VideoPreview] Bitmap context not available')
      return
    }

    // consume unused param to satisfy TS/linters
    void timestamp


    try {
      // 高效显示 ImageBitmap
      bitmapCtx.transferFromImageBitmap(bitmap)

      // 更新播放状态
      currentFrameIndex = frameIndex
      // 使用全局帧索引计算相对视频开始的时间，避免绝对时间戳（如epoch/us）导致显示超大值
      currentTime = (windowStartIndex + frameIndex) / frameRate

      // 调试：降低逐帧日志开销，仅开发环境且每60帧输出一次
      // if (import.meta.env.DEV && frameIndex % 60 === 0) {
      //   console.debug(`[VideoPreview] frame ${frameIndex}/${totalFrames} global ${windowStartIndex + frameIndex + 1}/${totalFramesAll}`)
      // }
    } catch (error) {
      console.error('❌ [VideoPreview] Display error:', error)
    }
  }

  // 处理视频数据
  async function processVideo() {
    if (!compositeWorker || !encodedChunks.length) {
      console.warn('⚠️ [VideoPreview] Cannot process: missing worker or chunks')
      return
    }

    console.log('🎬 [VideoPreview] Processing video with', encodedChunks.length, 'chunks')

    // 验证并修复数据格式
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

    // 仅首次加载时显示处理遮罩；连续播放切换时不遮挡
    isProcessing = !hasEverProcessed

    // 准备可传输的数据块：优先命中预取缓存，否则现算
    let transferableChunks: any[]
    let usingPrefetchCache = false

    if (prefetchCache && prefetchCache.targetGlobalFrame === windowStartIndex) {
      // 命中缓存
      transferableChunks = prefetchCache.transferableChunks
      usingPrefetchCache = true
      console.log('⚡ [prefetch] Using cached transferableChunks:', {
        targetGlobalFrame: prefetchCache.targetGlobalFrame,
        windowSize: prefetchCache.windowSize,
        chunks: transferableChunks.length
      })
      // 命中后立即清空，避免重复使用过期缓存
      prefetchCache = null
    } else {
      // 回退：按需转换当前 props.encodedChunks
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

    // 调试：检查第一个数据块的尺寸信息
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
    }

    // 收集所有 ArrayBuffer 用于转移
    const transferList = transferableChunks.map((chunk: any) => chunk.data)

    // 将 Svelte 5 的 Proxy 对象转换为普通对象
    const plainBackgroundConfig = {
      type: backgroundConfig.type,

    //     
    // : 

      color: backgroundConfig.color,
      padding: backgroundConfig.padding,
      outputRatio: backgroundConfig.outputRatio,
      videoPosition: backgroundConfig.videoPosition,
      borderRadius: backgroundConfig.borderRadius,
      inset: backgroundConfig.inset,
      // 深度转换 gradient 对象
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
      // 深度转换 shadow 对象
      shadow: backgroundConfig.shadow ? {
        offsetX: backgroundConfig.shadow.offsetX,
        offsetY: backgroundConfig.shadow.offsetY,
        blur: backgroundConfig.shadow.blur,
        color: backgroundConfig.shadow.color
      } : undefined,
      // 深度转换 image 对象 - 获取新的ImageBitmap避免detached问题
      image: backgroundConfig.image ? {
        imageId: backgroundConfig.image.imageId,
        imageBitmap: null as any, // 先设为null，稍后获取新的ImageBitmap
        fit: backgroundConfig.image.fit,
        position: backgroundConfig.image.position,
        opacity: backgroundConfig.image.opacity,
        blur: backgroundConfig.image.blur,
        scale: backgroundConfig.image.scale,
        offsetX: backgroundConfig.image.offsetX,
        offsetY: backgroundConfig.image.offsetY
      } : undefined,
      // 深度转换 wallpaper 对象 - 获取新的ImageBitmap避免detached问题
      wallpaper: backgroundConfig.wallpaper ? {
        imageId: backgroundConfig.wallpaper.imageId,
        imageBitmap: null as any, // 先设为null，稍后获取新的ImageBitmap
        fit: backgroundConfig.wallpaper.fit,
        position: backgroundConfig.wallpaper.position,
        opacity: backgroundConfig.wallpaper.opacity,
        blur: backgroundConfig.wallpaper.blur,
        scale: backgroundConfig.wallpaper.scale,
        offsetX: backgroundConfig.wallpaper.offsetX,
        offsetY: backgroundConfig.wallpaper.offsetY
      } : undefined
    }

    // 如果是图片背景，获取新的ImageBitmap
    const transferObjects: Transferable[] = [...transferList]
    if (plainBackgroundConfig.image && backgroundConfig.image) {
      try {
        // 从ImageBackgroundManager获取新的ImageBitmap
        const freshImageBitmap = imageBackgroundManager.getImageBitmap(backgroundConfig.image.imageId)

        if (freshImageBitmap) {
          // 创建ImageBitmap的副本用于传输
          const imageBitmapCopy = await createImageBitmap(freshImageBitmap)
          plainBackgroundConfig.image.imageBitmap = imageBitmapCopy
          transferObjects.push(imageBitmapCopy as any)
        } else {
          console.warn('⚠️ [VideoPreview] ImageBitmap not found for imageId:', backgroundConfig.image.imageId)
          plainBackgroundConfig.image = undefined // 如果找不到ImageBitmap，移除image配置
        }
      } catch (error) {
        console.error('❌ [VideoPreview] Failed to get ImageBitmap:', error)
        plainBackgroundConfig.image = undefined
      }
    }

    // 如果是壁纸背景，获取新的ImageBitmap
    if (plainBackgroundConfig.wallpaper && backgroundConfig.wallpaper) {
      try {
        // 从ImageBackgroundManager获取新的ImageBitmap
        const freshImageBitmap = imageBackgroundManager.getImageBitmap(backgroundConfig.wallpaper.imageId)

        if (freshImageBitmap) {
          // 创建ImageBitmap的副本用于传输
          const imageBitmapCopy = await createImageBitmap(freshImageBitmap)
          plainBackgroundConfig.wallpaper.imageBitmap = imageBitmapCopy
          transferObjects.push(imageBitmapCopy as any)
        } else {
          console.warn('⚠️ [VideoPreview] ImageBitmap not found for wallpaper imageId:', backgroundConfig.wallpaper.imageId)
          plainBackgroundConfig.wallpaper = undefined // 如果找不到ImageBitmap，移除wallpaper配置
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
        startGlobalFrame: windowStartIndex
      }
    }, { transfer: transferObjects })

    console.log('[progress] VideoPreview - process message sent')

    // 观测：预取命中率统计（发送后就位时记录一次）
    if (usingPrefetchCache) { prefetchHits++; } else { prefetchMisses++; }
    {
      const total = prefetchHits + prefetchMisses
      const rate = total ? (prefetchHits / total).toFixed(2) : '0.00'
      console.log('[prefetch] stats', { hits: prefetchHits, misses: prefetchMisses, hitRate: rate })
    }

  }

  // 播放控制
  function play() {
    if (!compositeWorker || totalFrames === 0) return

    console.log('▶️ [VideoPreview] Starting playback')
    isPlaying = true

    compositeWorker.postMessage({ type: 'play' })
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

  // 格式化秒为 00:00（mm:ss），供时间轴底部显示
  function formatTimeSec(sec: number): string {
    const total = Math.max(0, Math.floor(sec))
    const mm = Math.floor(total / 60)
    const ss = total % 60
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }


  // 更新背景配置
  async function updateBackgroundConfig(newConfig: typeof backgroundConfig) {
    if (!compositeWorker) return

    // 将 Svelte 5 的 Proxy 对象转换为普通对象
    const plainConfig = {
      type: newConfig.type,
      color: newConfig.color,
      padding: newConfig.padding,
      outputRatio: newConfig.outputRatio,
      videoPosition: newConfig.videoPosition,

      borderRadius: newConfig.borderRadius,
      inset: newConfig.inset,
      // 深度转换 gradient 对象
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
      // 深度转换 shadow 对象
      shadow: newConfig.shadow ? {
        offsetX: newConfig.shadow.offsetX,
        offsetY: newConfig.shadow.offsetY,
        blur: newConfig.shadow.blur,
        color: newConfig.shadow.color
      } : undefined,
      // 深度转换 image 对象 - 获取新的ImageBitmap避免detached问题
      image: newConfig.image ? {
        imageId: newConfig.image.imageId,
        imageBitmap: null as any, // 先设为null，稍后获取新的ImageBitmap
        fit: newConfig.image.fit,
        position: newConfig.image.position,
        opacity: newConfig.image.opacity,
        blur: newConfig.image.blur,
        scale: newConfig.image.scale,
        offsetX: newConfig.image.offsetX,
        offsetY: newConfig.image.offsetY
      } : undefined,
      // 深度转换 wallpaper 对象 - 获取新的ImageBitmap避免detached问题
      wallpaper: newConfig.wallpaper ? {
        imageId: newConfig.wallpaper.imageId,
        imageBitmap: null as any, // 先设为null，稍后获取新的ImageBitmap
        fit: newConfig.wallpaper.fit,
        position: newConfig.wallpaper.position,
        opacity: newConfig.wallpaper.opacity,
        blur: newConfig.wallpaper.blur,
        scale: newConfig.wallpaper.scale,
        offsetX: newConfig.wallpaper.offsetX,
        offsetY: newConfig.wallpaper.offsetY
      } : undefined
    }

    console.log('⚙️ [VideoPreview] Updating background config:', plainConfig)

    // 如果是图片背景，获取新的ImageBitmap
    const transferObjects: Transferable[] = []
    if (plainConfig.image && newConfig.image) {
      try {
        // 从ImageBackgroundManager获取新的ImageBitmap
        const freshImageBitmap = imageBackgroundManager.getImageBitmap(newConfig.image.imageId)

        if (freshImageBitmap) {
          // 创建ImageBitmap的副本用于传输
          const imageBitmapCopy = await createImageBitmap(freshImageBitmap)
          plainConfig.image.imageBitmap = imageBitmapCopy
          transferObjects.push(imageBitmapCopy as any)
        } else {
          console.warn('⚠️ [VideoPreview] ImageBitmap not found for imageId:', newConfig.image.imageId)
          plainConfig.image = undefined // 如果找不到ImageBitmap，移除image配置
        }
      } catch (error) {
        console.error('❌ [VideoPreview] Failed to get ImageBitmap:', error)
        plainConfig.image = undefined
      }
    }

    // 如果是壁纸背景，获取新的ImageBitmap
    if (plainConfig.wallpaper && newConfig.wallpaper) {
      try {
        // 从ImageBackgroundManager获取新的ImageBitmap
        const freshImageBitmap = imageBackgroundManager.getImageBitmap(newConfig.wallpaper.imageId)

        if (freshImageBitmap) {
          // 创建ImageBitmap的副本用于传输
          const imageBitmapCopy = await createImageBitmap(freshImageBitmap)
          plainConfig.wallpaper.imageBitmap = imageBitmapCopy
          transferObjects.push(imageBitmapCopy as any)
        } else {
          console.warn('⚠️ [VideoPreview] ImageBitmap not found for wallpaper imageId:', newConfig.wallpaper.imageId)
          plainConfig.wallpaper = undefined // 如果找不到ImageBitmap，移除wallpaper配置
        }
      } catch (error) {
        console.error('❌ [VideoPreview] Failed to get wallpaper ImageBitmap:', error)
        plainConfig.wallpaper = undefined
      }
    }

    compositeWorker.postMessage({
      type: 'config',
      data: { backgroundConfig: plainConfig }
    }, transferObjects.length > 0 ? { transfer: transferObjects } : undefined)
  }

  // 响应式处理 - 只在录制完成后处理一次
  let hasProcessed = false

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

    // 只有当录制完成且有编码块时才处理
    if (isRecordingComplete &&
        encodedChunks.length > 0 &&
        !hasProcessed &&
        isInitialized &&
        compositeWorker) {
      console.log('🎬 [VideoPreview] Processing completed recording with', encodedChunks.length, 'chunks')
      hasProcessed = true
      processVideo().catch(error => {
        console.error('❌ [VideoPreview] Failed to process video:', error)
      })
    }
  })

  // 当外部窗口数据（encodedChunks）引用变化时，允许重新处理
  let lastChunksRef: any[] | null = null
  $effect(() => {
    if (encodedChunks && encodedChunks !== lastChunksRef) {
      console.log('[progress] New window data detected, reprocessing:', {
        oldLength: lastChunksRef?.length || 0,
        newLength: encodedChunks.length,
        windowStartIndex
      })
      lastChunksRef = encodedChunks
      hasProcessed = false

      // 🔧 立即处理新窗口数据
      if (isRecordingComplete && encodedChunks.length > 0 && isInitialized && compositeWorker) {
        console.log('[progress] Immediately processing new window data')

        // 重置当前帧索引，准备新窗口
        currentFrameIndex = 0
        console.log('[progress] Reset currentFrameIndex to 0 for new window')

        hasProcessed = true
        processVideo().catch(error => {
          console.error('❌ [VideoPreview] Failed to process new window data:', error)
        })
      }
    }
  })

  // 🔧 处理窗口播放完成 - 连续播放核心功能
  function handleWindowComplete(data: { totalFrames: number, lastFrameIndex: number }) {
    console.log('[progress] Handling window complete:', {
      windowStartIndex,
      totalFrames: data.totalFrames,
      lastFrameIndex: data.lastFrameIndex,
      totalFramesAll,
      currentGlobalFrame: windowStartIndex + data.lastFrameIndex,
      isPlaying
    })

    // 🔧 只有在播放状态下才处理窗口完成
    if (!isPlaying) {
      console.log('[progress] Not playing, ignoring window complete')
      return
    }

    const currentGlobalFrame = windowStartIndex + data.lastFrameIndex
    const nextGlobalFrame = currentGlobalFrame + 1

    // 检查是否还有更多帧
    if (nextGlobalFrame < totalFramesAll) {
      // 选择下一窗口起点：优先消费已构建的预取缓存，其次才使用计划，避免跳过缓存导致丢弃
      let plannedNext = nextGlobalFrame
      let windowSize = Math.min(90, totalFramesAll - nextGlobalFrame)
      if (prefetchCache && prefetchCache.targetGlobalFrame >= nextGlobalFrame) {
        plannedNext = prefetchCache.targetGlobalFrame
        windowSize = Math.min(prefetchCache.windowSize, totalFramesAll - plannedNext)
        console.log('[prefetch] Using cached plan for next window:', { plannedNext, windowSize })
      } else if (prefetchPlan && prefetchPlan.nextGlobalFrame >= nextGlobalFrame) {
        plannedNext = prefetchPlan.nextGlobalFrame
        windowSize = Math.min(prefetchPlan.windowSize, totalFramesAll - plannedNext)
        console.log('[prefetch] Using planned next window:', { plannedNext, windowSize })
      }

      console.log('[progress] Requesting next window for continuous playback:', {
        nextGlobalFrame: plannedNext,
        totalFramesAll,
        remainingFrames: totalFramesAll - plannedNext
      })

      // 标记需要在新窗口加载后继续播放（在请求之前设置）

      // 观测：切窗耗时起点
      cutoverPlannedNext = plannedNext
      cutoverTimerLabel = `[cutover] to ${plannedNext}`
      try { console.time(cutoverTimerLabel) } catch {}

      shouldContinuePlayback = true
      continueFromGlobalFrame = plannedNext
      console.log('[progress] Set shouldContinuePlayback = true, continueFromGlobalFrame =', plannedNext)

      // 🔧 直接使用帧范围请求，避免时间转换误差
      if (onRequestWindow) {
        // 先尝试时间方式（保持兼容性）
        const nextTimeMs = (plannedNext / frameRate) * 1000
        onRequestWindow({
          centerMs: nextTimeMs,
          beforeMs: 0,      // 从目标帧开始
          afterMs: (windowSize / frameRate) * 1000  // 基于窗口大小计算
        })
      }

      // 本次请求后清理一次计划（避免重复使用过期计划）
      prefetchPlan = null
    } else {
      console.log('[progress] Reached end of video, stopping playback')
      isPlaying = false
      shouldContinuePlayback = false
    }
  }

  // 🔧 全局帧定位系统 - 视频编辑器核心功能
  function seekToGlobalFrame(globalFrameIndex: number) {
    console.log('[progress] Seeking to global frame:', {
      globalFrameIndex,
      windowStartIndex,
      totalFrames,
      totalFramesAll
    })

    const windowFrameIndex = globalFrameIndex - windowStartIndex

    if (windowFrameIndex >= 0 && windowFrameIndex < totalFrames) {
      // 在当前窗口内，直接seek
      console.log('[progress] Frame in current window, seeking locally:', windowFrameIndex)
      seekToFrame(windowFrameIndex)
    } else {
      // 需要切换窗口
      console.log('[progress] Frame outside current window, requesting new window')
      const targetTimeMs = (globalFrameIndex / frameRate) * 1000


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

  // 时间轴输入处理（基于毫秒）
  function handleTimelineInput(timeMs: number) {
    const clampedMs = Math.max(0, Math.min(timeMs, timelineMaxMs))
    console.log('[progress] Timeline input:', {
      timeMs,
      clampedMs,
      windowStartMs,
      windowEndMs,
      timelineMaxMs
    })

    // 🔧 使用全局时间定位
    seekToGlobalTime(clampedMs)
  }

  $effect(() => {
    if (backgroundConfig && compositeWorker && totalFrames > 0) {
      updateBackgroundConfig(backgroundConfig)
    }
  })

  // 响应输出尺寸变化，更新预览尺寸
  $effect(() => {
    if (outputWidth > 0 && outputHeight > 0) {
      updatePreviewSize()
    }
  })

  // 组件挂载
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

  // 监听关键 props 变化
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

    // 注意：继续播放的逻辑已移至worker ready事件中处理
  })

  // 当 totalFrames/showTimeline/showControls 或容器尺寸变动时，重新计算预览尺寸，
  // 以便为时间轴/控制栏预留空间，避免被 overflow-hidden 裁剪
  $effect(() => {
    // 触发依赖追踪
    const _tf = totalFrames
    const _st = showTimeline
    const _sc = showControls
    const _dw = displayWidth
    const _dh = displayHeight
    if (outputWidth > 0 && outputHeight > 0) {
      updatePreviewSize()
    }
  })


    // 清理函数
    return () => {
      if (compositeWorker) {
        compositeWorker.terminate()
        compositeWorker = null
      }
    }
  })

  // 导出控制方法
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

<!-- 视频预览容器 - 优化为全高度布局 -->
<div class="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden {className}">
  <!-- 预览信息栏 - 固定高度 -->
  <div class="flex-shrink-0 flex justify-between items-center p-3 border-b border-gray-700">
    <div class="flex items-center gap-2">
      <Monitor class="w-4 h-4 text-gray-400" />
      <span class="text-sm font-semibold text-gray-100">视频预览</span>
    </div>
    <span class="text-xs font-medium text-purple-400 bg-purple-500/10 px-2 py-1 rounded border border-purple-500/20">
      {backgroundConfig.outputRatio === 'custom' ? `${outputWidth}×${outputHeight}` : backgroundConfig.outputRatio}
    </span>
  </div>

  <!-- Canvas 显示区域 - 占据剩余空间 -->
  <div class="flex-1 flex items-center justify-center p-4 min-h-0">
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
          <span class="text-sm">正在处理视频...</span>
        </div>
      {/if}
    </div>
  </div>


  <!-- 时间轴 - 固定高度（基于真实时长，毫秒） -->
  {#if showTimeline && timelineMaxMs > 0}
    <div class="flex-shrink-0 p-3 bg-gray-800">
      <input
        type="range"
        class="w-full h-1 bg-gray-600 rounded-sm outline-none cursor-pointer timeline-slider"
        min="0"
        max={timelineMaxMs}
        value={Math.min(timelineMaxMs, Math.floor((windowStartIndex + currentFrameIndex) / frameRate * 1000))}
        oninput={(e) => handleTimelineInput(parseInt((e.target as HTMLInputElement).value))}
        disabled={isProcessing}
      />
      <div class="flex justify-between items-center mt-1">
        <div class="flex items-center gap-2 text-white text-sm">
          <button
            class="flex items-center justify-center w-8 h-8 border border-gray-600 text-white rounded cursor-pointer transition-all duration-200 hover:bg-gray-700 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={isPlaying ? pause : play}
            disabled={isProcessing}
          >
            {#if isPlaying}
              <Pause class="w-4 h-4" />
            {:else}
              <Play class="w-4 h-4" />
            {/if}
          </button>
          <span class="font-mono text-sm text-gray-300 ml-2">
            {formatTimeSec((windowStartIndex + currentFrameIndex) / frameRate)} / {formatTimeSec(uiDurationSec)}
          </span>
        </div>
        <div class="flex items-center gap-4 text-xs text-gray-400">
          <span>帧: {windowStartIndex + currentFrameIndex + 1}/{totalFramesAll > 0 ? totalFramesAll : (totalFrames > 0 ? totalFrames : encodedChunks.length)}</span>
          <span>窗口: {windowStartIndex + 1}-{windowStartIndex + totalFrames}/{totalFramesAll}</span>
          <span>分辨率: {outputWidth}×{outputHeight}</span>
          <span>时长: {Math.floor(timelineMaxMs / 1000)}s</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* 自定义时间轴滑块样式 - 使用蓝色主题 */
  .timeline-slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .timeline-slider::-webkit-slider-thumb:hover {
    background: #2563eb;
    transform: scale(1.1);
  }

  .timeline-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    transition: all 0.2s ease;
  }

  .timeline-slider::-moz-range-thumb:hover {
    background: #2563eb;
    transform: scale(1.1);
  }

  .timeline-slider:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
