// MP4 导出 Worker - 协调视频合成和 MP4 导出
// 使用 video-composite-worker 进行合成，然后用 Mediabunny 导出 MP4
import type { EncodedChunk, ExportOptions, BackgroundConfig, GradientConfig, ImageBackgroundConfig } from '../../types/background'
import { Mp4Strategy } from './strategies/mp4'
import { WebmStrategy } from './strategies/webm'
import { addVideoTrackWithTiming } from './video-track-metadata'
import { GifStrategy, type GifFrameData } from './strategies/gif'
import { ExportCancellationController, type ActiveExportResource } from './export-cancellation-controller'
import { buildPresentationSchedule, type PresentationScheduleEntry } from '../../recording/recording-timeline'
import {
  createExportCompositeRenderRequest,
  isSourceFrameInLoadedWindow,
  writePresentationSchedule
} from '../../export/presentation-schedule-export'
import {
  hasUsableExportTimeline,
  hasTimeVaryingEditEffects,
  rebaseZoomForTrim
} from '../../export/edit-export-parity'
import { createStaticHoldPlan } from '../../recording/static-hold-plan'
import { writeStaticHoldVideoSample } from '../../export/static-hold-export'
import {
  createMemoryExportCompositeRenderRequest,
  getMemoryVisibleFrameCount,
  type MemoryChunkVisibleRange
} from '../../export/memory-trim-export'
import { H264_PROBE_CODECS, normalizeH264Dimensions } from '../../utils/h264-export-config'
import { createGifFrameSchedule, type GifFrameScheduleEntry } from '../../export/gif-frame-schedule'
import { assertGifExportWithinMemoryBudget, validateGifBlob } from '../../export/gif-export-preflight'
import { resolveGifScaledDimensions } from '../../export/gif-export-settings'
import { waitForWorkerMessage } from '../worker-message'

import { Output, Mp4OutputFormat, BufferTarget, CanvasSource } from 'mediabunny'



interface ExportData {
  chunks: EncodedChunk[]
  options: ExportOptions
}

interface ProgressData {
  stage: 'preparing' | 'compositing' | 'encoding' | 'muxing' | 'finalizing'
  progress: number
  currentFrame: number
  totalFrames: number
  estimatedTimeRemaining?: number
  fileSize?: number
}

// Worker 状态
let isExporting = false
let shouldCancel = false
let compositeWorker: Worker | null = null
let offscreenCanvas: OffscreenCanvas | null = null
let canvasCtx: OffscreenCanvasRenderingContext2D | null = null
// 当前导出的背景色（用于对齐填充区域），默认黑色以兼容播放器
let exportBgColor: string = '#000000'
// 当前背景配置（用于渐变背景处理）
let currentBackgroundConfig: BackgroundConfig | null = null
// 当前导出格式，用于控制进度更新逻辑
let currentExportFormat: string = ''
const exportCancellation = new ExportCancellationController()
let cancellationTask: Promise<void> | null = null

// ---- OPFS data processing utilities ----
const onceFromWorker = waitForWorkerMessage

// OPFS 驱动器状态
let opfsReader: Worker | null = null
let opfsSummary: any = null
let opfsWindowSize = 90

let totalOpfsFrames = 0
let consumedGlobalFrames = 0
let currentWindowStart = -1
let currentWindowFrames = 0
let lastEmittedGlobalEnd = 0
let warnedCanvasSizeMismatch = false
let compositeRenderRequestId = 0

let isOpfsMode = false

// 裁剪参数
let trimStartMs = 0
let trimEndMs = Number.MAX_SAFE_INTEGER
let isTrimEnabled = false

async function initializeOpfsReader(dirId: string, windowSize?: number, trimOptions?: { startMs: number, endMs: number }): Promise<void> {
  try {

    opfsReader = new Worker(new URL('../opfs-reader-worker.ts', import.meta.url), { type: 'module' })
    opfsWindowSize = Math.max(30, Math.min(windowSize ?? 90, 150)) // 限制窗口大小

    // 打开 OPFS 目录并获取摘要
    opfsReader.postMessage({ type: 'open', dirId })
    const ready: any = await onceFromWorker(opfsReader, 'ready')

    opfsSummary = ready?.summary || { totalChunks: 0 }
    totalOpfsFrames = Number(opfsSummary.totalChunks) || 0

    // ✂️ 应用裁剪范围
    if (trimOptions) {
      isTrimEnabled = true
      trimStartMs = Math.max(0, trimOptions.startMs)
      trimEndMs = Math.max(trimStartMs, trimOptions.endMs)
    }

    consumedGlobalFrames = 0
    currentWindowStart = -1
    lastEmittedGlobalEnd = 0
    isOpfsMode = true


  } catch (error) {
    console.error('❌ [MP4-Export-Worker] Failed to initialize OPFS reader:', error)
    throw error
  }
}

async function loadOpfsWindow(start: number, count: number): Promise<{ chunks: any[]; actualStart: number; actualCount: number }> {
  if (!opfsReader) {
    throw new Error('OPFS reader not initialized')
  }

  opfsReader.postMessage({ type: 'getRange', start, count })
  const range: any = await onceFromWorker(opfsReader, 'range')

  const chunks = range?.chunks || []
  const actualStart = Number(range?.start ?? start)
  const actualCount = Number(range?.count ?? chunks.length ?? 0)


  return { chunks, actualStart, actualCount }
}

function cleanupOpfsReader(): void {
  if (opfsReader) {
    try {
      opfsReader.postMessage({ type: 'close' })
      opfsReader.terminate()
    } catch (e) {
      console.warn('⚠️ [MP4-Export-Worker] Error cleaning up OPFS reader:', e)
    }
    opfsReader = null
  }

  opfsSummary = null
  totalOpfsFrames = 0

  consumedGlobalFrames = 0
  currentWindowStart = -1
  lastEmittedGlobalEnd = 0
  isOpfsMode = false

  // ✂️ 重置裁剪参数
  isTrimEnabled = false
  trimStartMs = 0
  trimEndMs = Number.MAX_SAFE_INTEGER
}

function getOpfsPresentationSchedule(targetFps: number): PresentationScheduleEntry[] | null {
  if (!isOpfsMode) return null
  if (!hasUsableExportTimeline(opfsSummary?.timeline, totalOpfsFrames)) return null
  const sampleTimestampsMs = opfsSummary.timeline.sampleTimestampsMs
  const durationMs = Number(opfsSummary?.timeline?.durationMs ?? opfsSummary?.durationMs)
  if (!Array.isArray(sampleTimestampsMs) || sampleTimestampsMs.length !== totalOpfsFrames) return null
  return buildPresentationSchedule({
    sourceTimestampsMs: sampleTimestampsMs,
    durationMs,
    targetFps,
    startMs: isTrimEnabled ? trimStartMs : undefined,
    endMs: isTrimEnabled ? trimEndMs : undefined
  })
}
// ---- end OPFS data processing utilities ----

// 合成状态
let totalFrames = 0
let processedFrames = 0
let videoInfo: { width: number, height: number, frameRate: number } | null = null
let memoryChunkVisibleRange: MemoryChunkVisibleRange | null = null
let memoryOutputFrameRate = 30

// 创建渐变对象
function createGradient(gradientConfig: GradientConfig, width: number, height: number): CanvasGradient | null {
  if (!canvasCtx) return null

  try {
    let gradient: CanvasGradient

    switch (gradientConfig.type) {
      case 'linear':
        const angle = gradientConfig.angle || 0
        const radians = (angle * Math.PI) / 180

        // 计算渐变的起点和终点
        const centerX = width / 2
        const centerY = height / 2
        const diagonal = Math.sqrt(width * width + height * height) / 2

        const x1 = centerX - Math.cos(radians) * diagonal
        const y1 = centerY - Math.sin(radians) * diagonal
        const x2 = centerX + Math.cos(radians) * diagonal
        const y2 = centerY + Math.sin(radians) * diagonal

        gradient = canvasCtx.createLinearGradient(x1, y1, x2, y2)
        break

      case 'radial':
        const centerX_r = (gradientConfig.centerX || 0.5) * width
        const centerY_r = (gradientConfig.centerY || 0.5) * height
        const radius = (gradientConfig.radius || 0.5) * Math.min(width, height)

        gradient = canvasCtx.createRadialGradient(centerX_r, centerY_r, 0, centerX_r, centerY_r, radius)
        break

      case 'conic':
        const centerX_c = (gradientConfig.centerX || 0.5) * width
        const centerY_c = (gradientConfig.centerY || 0.5) * height
        const angle_c = (gradientConfig.angle || 0) * Math.PI / 180

        gradient = canvasCtx.createConicGradient(angle_c, centerX_c, centerY_c)
        break

      default:
        console.warn('🎨 [MP4-Export-Worker] Unsupported gradient type:', (gradientConfig as any).type)
        return null
    }

    // 添加颜色停止点
    gradientConfig.stops.forEach(stop => {
      gradient.addColorStop(stop.position, stop.color)
    })

    return gradient
  } catch (error) {
    console.error('🎨 [MP4-Export-Worker] Error creating gradient:', error)
    return null
  }
}

// 渲染图片背景
function renderImageBackground(config: ImageBackgroundConfig, canvasWidth: number, canvasHeight: number) {
  if (!canvasCtx || !config.imageBitmap) return

  const { imageBitmap, fit, position, opacity, blur, scale, offsetX, offsetY } = config

  // 保存状态
  canvasCtx.save()

  // 应用透明度
  if (opacity !== undefined && opacity < 1) {
    canvasCtx.globalAlpha = opacity
  }

  // 应用模糊
  if (blur && blur > 0) {
    canvasCtx.filter = `blur(${blur}px)`
  }

  // 计算绘制参数
  const drawParams = calculateImageDrawParams(
    imageBitmap.width,
    imageBitmap.height,
    canvasWidth,
    canvasHeight,
    fit,
    position,
    scale,
    offsetX,
    offsetY
  )

  // 绘制图片
  canvasCtx.drawImage(
    imageBitmap,
    drawParams.x,
    drawParams.y,
    drawParams.width,
    drawParams.height
  )

  // 恢复状态
  canvasCtx.restore()
}

// 计算图片绘制参数
function calculateImageDrawParams(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  fit: string,
  position: string,
  scale: number = 1,
  offsetX: number = 0,
  offsetY: number = 0
): { x: number; y: number; width: number; height: number } {
  const imageAspect = imageWidth / imageHeight
  const canvasAspect = canvasWidth / canvasHeight

  let drawWidth: number, drawHeight: number

  // 根据适应模式计算尺寸
  switch (fit) {
    case 'cover':
      if (imageAspect > canvasAspect) {
        drawHeight = canvasHeight
        drawWidth = drawHeight * imageAspect
      } else {
        drawWidth = canvasWidth
        drawHeight = drawWidth / imageAspect
      }
      break
    case 'contain':
      if (imageAspect > canvasAspect) {
        drawWidth = canvasWidth
        drawHeight = drawWidth / imageAspect
      } else {
        drawHeight = canvasHeight
        drawWidth = drawHeight * imageAspect
      }
      break
    case 'fill':
      drawWidth = canvasWidth
      drawHeight = canvasHeight
      break
    case 'stretch':
    default:
      drawWidth = canvasWidth
      drawHeight = canvasHeight
      break
  }

  // 应用缩放
  drawWidth *= scale
  drawHeight *= scale

  // 计算位置
  let x: number, y: number

  // 基础居中位置
  x = (canvasWidth - drawWidth) / 2
  y = (canvasHeight - drawHeight) / 2

  // 根据位置调整
  switch (position) {
    case 'top':
      y = 0
      break
    case 'bottom':
      y = canvasHeight - drawHeight
      break
    case 'left':
      x = 0
      break
    case 'right':
      x = canvasWidth - drawWidth
      break
    case 'top-left':
      x = 0
      y = 0
      break
    case 'top-right':
      x = canvasWidth - drawWidth
      y = 0
      break
    case 'bottom-left':
      x = 0
      y = canvasHeight - drawHeight
      break
    case 'bottom-right':
      x = canvasWidth - drawWidth
      y = canvasHeight - drawHeight
      break
    case 'center':
    default:
      // 已经是居中位置
      break
  }

  // 应用偏移
  x += offsetX * canvasWidth
  y += offsetY * canvasHeight

  return { x, y, width: drawWidth, height: drawHeight }
}

// 渲染背景（支持渐变和图片）
function renderBackground(config: BackgroundConfig, width: number, height: number) {
  if (!canvasCtx) return

  if (config.enabled === false) {
    canvasCtx.fillStyle = '#000000'
    canvasCtx.fillRect(0, 0, width, height)
    return
  }

  if (config.type === 'gradient' && config.gradient) {
    // 使用渐变背景
    const gradientStyle = createGradient(config.gradient, width, height)
    if (gradientStyle) {
      canvasCtx.fillStyle = gradientStyle
    } else {
      // 回退到纯色
      canvasCtx.fillStyle = config.color
    }
    canvasCtx.fillRect(0, 0, width, height)
  } else if (config.type === 'image' && config.image) {
    // 用户上传的图片背景
    renderImageBackground(config.image, width, height)
  } else if (config.type === 'wallpaper' && config.wallpaper) {
    // 壁纸背景
    renderImageBackground(config.wallpaper, width, height)
  } else {
    // 纯色背景
    canvasCtx.fillStyle = config.color
    canvasCtx.fillRect(0, 0, width, height)
  }
}

// 消息处理
self.onmessage = async (event) => {
  const { type, data } = event.data

  try {
    switch (type) {
      case 'export':
        await handleExport(data as ExportData)
        break

      case 'cancel':
        await handleCancel()
        break

      default:
        console.warn('⚠️ [MP4-Export-Worker] Unknown message type:', type)
    }
  } catch (error) {
    console.error('❌ [MP4-Export-Worker] Error processing message:', error)
    self.postMessage({
      type: 'error',
      data: { error: (error as Error).message }
    })
  }

}

/**
 * 处理导出请求
 */
async function handleExport(exportData: ExportData) {
  if (isExporting) {
    throw new Error('Export already in progress')
  }

  isExporting = true
  shouldCancel = false
  exportCancellation.reset()

  try {
    const { chunks, options } = exportData

    // 记录当前导出格式
    currentExportFormat = options?.format || ''

    // The compositor evaluates an output-relative clock during export. Rebase
    // the edit intervals without dropping interval-level focus/easing data or
    // clamping away a transition already in progress at the trim boundary.
    ;(options as any).backgroundConfig = rebaseZoomForTrim(
      (options as any).backgroundConfig,
      (options as any).trim
    )


    // 分支：WebM 兼容路径（保持原 webm-export-worker 行为：不使用 OPFS 窗口/流式）
    if (options?.format === 'webm') {
      // 更新进度：准备阶段
      updateProgress({ stage: 'preparing', progress: 5, currentFrame: 0, totalFrames: chunks.length })
      if (shouldCancel) return

      // 1) 创建并初始化 composite worker
      await createCompositeWorker()
      if (shouldCancel) return

      // 2) 处理视频合成（OPFS/内存）
      if ((options as any)?.source === 'opfs' && (options as any)?.opfsDirId) {
        // ✂️ 准备裁剪参数
        const trimOptions = options.trim?.enabled ? {
          startMs: options.trim.startMs,
          endMs: options.trim.endMs
        } : undefined
        await initializeOpfsReader((options as any).opfsDirId, (options as any).windowSize, trimOptions)
        const { chunks: firstChunks, actualStart } = await loadOpfsWindow(0, opfsWindowSize)
        await processVideoCompositionOpfs(firstChunks, options, actualStart)
      } else {
        await processVideoComposition(chunks, options)
      }
      if (shouldCancel) return

      // 3) 导出 WebM（支持 OPFS 流式写入）
      const webmResult: any = await exportToWEBMCompat(options)
      if (shouldCancel) return

      if (webmResult && (webmResult as any).savedToOpfs) {
        self.postMessage({ type: 'complete', data: { savedToOpfs: (webmResult as any).savedToOpfs } })
      } else {
        self.postMessage({ type: 'complete', data: { blob: webmResult as Blob } })
      }
      return
    }

    // 分支：GIF 导出路径
    if (options?.format === 'gif') {

      // 更新进度：准备阶段
      updateProgress({ stage: 'preparing', progress: 5, currentFrame: 0, totalFrames: chunks.length })
      if (shouldCancel) return

      // 1) 创建并初始化 composite worker
      await createCompositeWorker()
      if (shouldCancel) return

      // 2) 处理视频合成
      if ((options as any)?.source === 'opfs' && (options as any)?.opfsDirId) {
        const trimOptions = options.trim?.enabled ? {
          startMs: options.trim.startMs,
          endMs: options.trim.endMs
        } : undefined
        await initializeOpfsReader((options as any).opfsDirId, (options as any).windowSize, trimOptions)
        const { chunks: firstChunks, actualStart } = await loadOpfsWindow(0, opfsWindowSize)
        await processVideoCompositionOpfs(firstChunks, options, actualStart)
      } else {
        await processVideoComposition(chunks, options)
      }
      if (shouldCancel) return

      // 3) 导出 GIF
      const gifResult = await exportToGIF(options)
      if (shouldCancel) return

      self.postMessage({ type: 'complete', data: { blob: gifResult as Blob } })
      return
    }

    // 默认：MP4 路径（保留现有 MP4 行为）

    // 当来源为 OPFS 时，初始化 OPFS 读取器（用于实际导出）
    if ((options as any)?.source === 'opfs' && (options as any)?.opfsDirId) {
      // ✂️ 准备裁剪参数
      const trimOptions = options.trim?.enabled ? {
        startMs: options.trim.startMs,
        endMs: options.trim.endMs
      } : undefined
      await initializeOpfsReader((options as any).opfsDirId, (options as any).windowSize, trimOptions)
    }

    // 更新进度：准备阶段
    updateProgress({
      stage: 'preparing',
      progress: 5,
      currentFrame: 0,
      totalFrames: (((options as any)?.source === 'opfs' && totalOpfsFrames > 0) ? totalOpfsFrames : chunks.length)
    })

    if (shouldCancel) return

    // 1. 创建并初始化 video-composite-worker
    await createCompositeWorker()

    if (shouldCancel) return

    // 2. 处理视频合成
    if (((options as any)?.source === 'opfs') && totalOpfsFrames > 0) {
      // OPFS 模式：先处理首窗口，触发 composite ready（创建 OffscreenCanvas/设置 videoInfo）
      const { chunks: firstChunks, actualStart } = await loadOpfsWindow(0, opfsWindowSize)
      await processVideoCompositionOpfs(firstChunks, options, actualStart)
      // 记录下一窗口起点，供渲染循环跳过首窗（避免重复）
      // 不跳过首窗：由渲染循环按去重逻辑决定是否输出，避免丢帧
    } else {
      // 非 OPFS 模式，按内存 chunks 处理一次
      await processVideoComposition(chunks, options)
    }

    if (shouldCancel) return

    // 3. 导出 MP4（支持内存或 OPFS 流式写入）
    const result: any = await exportToMP4(options)

    if (shouldCancel) return

    // 完成导出
    if (result && (result as any).savedToOpfs) {
      self.postMessage({ type: 'complete', data: { savedToOpfs: (result as any).savedToOpfs } })
    } else {
      self.postMessage({ type: 'complete', data: { blob: result as Blob } })
    }

  } catch (error) {
    if (shouldCancel) {
      try { await exportCancellation.request() } catch {}
      return
    }

    try { await exportCancellation.request() } catch (cleanupError) {
      console.error('❌ [Export-Worker] Failed to clean up output after export error:', cleanupError)
    }
    console.error('❌ [Export-Worker] Export failed:', error)
    self.postMessage({
      type: 'error',
      data: { error: (error as Error).message }
    })
  } finally {
    cleanup()
    isExporting = false
  }
}

/**
 * 创建 video-composite-worker
 */
async function createCompositeWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // 创建 composite worker
      compositeWorker = new Worker(
        new URL('../composite-worker/index.ts', import.meta.url),
        { type: 'module' }
      )

      // 设置消息处理
      compositeWorker.onmessage = (event) => {
        const { type, data } = event.data

        switch (type) {
          case 'initialized':
            resolve()
            break

          case 'ready':
            totalFrames = !isOpfsMode && memoryChunkVisibleRange
              ? getMemoryVisibleFrameCount(memoryChunkVisibleRange)
              : data.totalFrames
            if (!videoInfo) {
              videoInfo = {
                width: data.outputSize.width,
                height: data.outputSize.height,
                frameRate: 30 // 默认帧率
              }
            }

            // 仅在首次 ready 时创建 OffscreenCanvas；后续窗口不重复创建，以免与 CanvasSource 绑定的画布失联导致黑屏
            if (!offscreenCanvas) {
              createOffscreenCanvas(data.outputSize.width, data.outputSize.height)
            } else {
              // 可选：如果尺寸不同，记录日志但保持现有画布，避免破坏 CanvasSource 引用
              if (offscreenCanvas.width !== data.outputSize.width || offscreenCanvas.height !== data.outputSize.height) {
                if (!warnedCanvasSizeMismatch) {
                  console.warn('⚠️ [MP4-Export-Worker] Ready reports different size after canvas created; keep existing canvas to avoid black frames:', {
                    existing: { w: offscreenCanvas.width, h: offscreenCanvas.height },
                    reported: data.outputSize
                  })
                  warnedCanvasSizeMismatch = true
                }
              }
            }
            break

          case 'frame':
            // 接收合成后的帧
            handleCompositeFrame(data.bitmap, data.frameIndex)
            break

          case 'complete':
            break

          case 'error':
            console.error('❌ [MP4-Export-Worker] Composite worker error:', data)
            reject(new Error(data.error || 'Composite worker error'))
            break
        }
      }

      compositeWorker.onerror = (error) => {
        console.error('❌ [MP4-Export-Worker] Composite worker error:', error)
        reject(error)
      }

      // 初始化 composite worker
      compositeWorker.postMessage({ type: 'init' })

    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 创建 OffscreenCanvas（H.264 兼容尺寸）
 */
function createOffscreenCanvas(width: number, height: number) {
  // 🔧 确保 Canvas 尺寸符合 H.264 要求
  const { width: h264Width, height: h264Height, modified } = normalizeH264Dimensions(width, height)

  offscreenCanvas = new OffscreenCanvas(h264Width, h264Height)
  canvasCtx = offscreenCanvas.getContext('2d')

  if (!canvasCtx) {
    throw new Error('Failed to get 2D context from OffscreenCanvas')
  }

  // 如果尺寸被调整，需要更新 videoInfo
  if (modified && videoInfo) {
    videoInfo.width = h264Width
    videoInfo.height = h264Height
  }

}

/**
 * 处理视频合成
 */
async function processVideoComposition(chunks: EncodedChunk[], options: ExportOptions): Promise<void> {
  // 记录背景配置，供 MP4 画布在对齐填充时使用
  try {
    currentBackgroundConfig = options.backgroundConfig || null
    exportBgColor = options.backgroundConfig?.color || exportBgColor
  } catch {}

  memoryChunkVisibleRange = (options as ExportOptions & {
    memoryChunkVisibleRange?: MemoryChunkVisibleRange
  }).memoryChunkVisibleRange ?? null
  memoryOutputFrameRate = Number(options.framerate) > 0
    ? Number(options.framerate)
    : 30

  return new Promise((resolve, reject) => {
    if (!compositeWorker) {
      reject(new Error('Composite worker not available'))
      return
    }

    // GIF 导出时不在这里更新进度，由帧收集控制
    // 其他格式（MP4/WebM）仍然需要更新
    if (options.format !== 'gif') {
      updateProgress({
        stage: 'compositing',
        progress: 10,
        currentFrame: 0,
        totalFrames: chunks.length
      })
    }

    // 准备可传输的数据块（兼容 Uint8Array / ArrayBuffer）
    // 零拷贝优化：当 TypedArray 完全覆盖其 ArrayBuffer 时直接转移所有权，
    // 仅当 TypedArray 是较大 ArrayBuffer 的子视图时才需要 slice
    const transferableChunks = chunks.map((chunk: any) => {
      let buf: ArrayBuffer
      if (chunk.data instanceof ArrayBuffer) {
        buf = chunk.data
      } else if (chunk.data?.buffer) {
        const view = chunk.data as Uint8Array
        if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
          // 视图覆盖整个 buffer，直接转移（零拷贝）
          buf = view.buffer as ArrayBuffer
        } else {
          // 视图是较大 buffer 的子范围，必须拷贝
          buf = (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength)
        }
      } else {
        buf = chunk.data
      }
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

    // 收集所有 ArrayBuffer 用于转移
    const transferList = transferableChunks.map(chunk => chunk.data)

    // 发送处理请求到 composite worker
    compositeWorker.postMessage({
      type: 'process',
      data: {
        chunks: transferableChunks,
        backgroundConfig: options.backgroundConfig || {
          type: 'solid-color',
          color: '#000000',
          padding: 0,
          outputRatio: '16:9',
          videoPosition: 'center'
        },
        // propagate export framerate for consistent zoom timing
        frameRate: (options as any)?.framerate || 30
      }
    }, { transfer: transferList })

    // 等待处理完成
    const originalOnMessage = compositeWorker.onmessage
    compositeWorker.onmessage = (event) => {
      const { type, data } = event.data

      if (type === 'ready') {
        // 恢复原始消息处理
        compositeWorker!.onmessage = originalOnMessage
        if (originalOnMessage && compositeWorker) {
          originalOnMessage.call(compositeWorker, event)
        }
        resolve()
      } else if (type === 'error') {
        reject(new Error(data.error || 'Composition failed'))
      } else {
        // 转发其他消息
        if (originalOnMessage && compositeWorker) {
          originalOnMessage.call(compositeWorker, event)
        }
      }
    }
  })
}

// 专用于 OPFS
async function processVideoCompositionOpfs(wireChunks: any[], options: ExportOptions, startGlobalFrame: number): Promise<void> {
  try {
    currentBackgroundConfig = options.backgroundConfig || null
    exportBgColor = options.backgroundConfig?.color || exportBgColor
  } catch {}

  return new Promise((resolve, reject) => {
    if (!compositeWorker) {
      reject(new Error('Composite worker not available'))
      return
    }

    // GIF 导出时不在这里更新进度，由帧收集控制
    if (options.format !== 'gif') {
      updateProgress({
        stage: 'compositing',
        progress: 10,
        currentFrame: isOpfsMode ? lastEmittedGlobalEnd : consumedGlobalFrames,
        totalFrames: (totalOpfsFrames > 0 ? totalOpfsFrames : wireChunks.length)
      })
    }

    currentWindowStart = startGlobalFrame
    const transferable = wireChunks.map((c: any) => ({
      data: c.data as ArrayBuffer,
      timestamp: c.timestamp,
      type: c.type,
      size: c.size,
      codedWidth: c.codedWidth,
      codedHeight: c.codedHeight,
      codec: c.codec
    }))
    const transferList = transferable.map(c => c.data)

    const originalOnMessage = compositeWorker.onmessage
    compositeWorker.onmessage = (event) => {
      const { type, data } = event.data
      if (type === 'ready') {
        // 记录当前窗口帧数（由 composite worker 基于 chunks.length 返回）
        try {
          currentWindowFrames = Number(data?.totalFrames) || transferable.length
        } catch {}
        compositeWorker!.onmessage = originalOnMessage
        if (originalOnMessage && compositeWorker) {
          originalOnMessage.call(compositeWorker, event)
        }
        resolve()
      } else if (type === 'error') {
        compositeWorker!.onmessage = originalOnMessage
        reject(new Error(data.error || 'Composition failed'))
      } else {
        if (originalOnMessage && compositeWorker) {
          originalOnMessage.call(compositeWorker, event)
        }
      }
    }

    compositeWorker.postMessage({
      type: 'process',
      data: {
        chunks: transferable,
        backgroundConfig: options.backgroundConfig || {
          type: 'solid-color', color: '#000000', padding: 0, outputRatio: '16:9', videoPosition: 'center'
        },
        startGlobalFrame,
        // prefer provided framerate, fallback to OPFS meta fps, finally 30
        frameRate: (options as any)?.framerate || (opfsSummary?.meta?.fps) || 30
      }
    }, { transfer: transferList })
  })
}

/**
 * 处理合成帧
 */
function handleCompositeFrame(bitmap: ImageBitmap, frameIndex: number) {
  // 🔧 优化：确保 bitmap 在所有路径都被释放
  let bitmapClosed = false

  const closeBitmap = () => {
    if (!bitmapClosed && bitmap) {
      try {
        bitmap.close()
        bitmapClosed = true
      } catch (e) {
        console.warn('[MP4-Export-Worker] Failed to close bitmap:', e)
      }
    }
  }

  if (!canvasCtx || !offscreenCanvas) {
    console.error('❌ [MP4-Export-Worker] Canvas not available')
    closeBitmap()
    return
  }

  try {
    const canvasWidth = offscreenCanvas.width
    const canvasHeight = offscreenCanvas.height

    // 先用背景填充整个画布，避免 H.264 无透明度导致的黑边
    try {
      if (currentBackgroundConfig) {
        // 使用完整的背景配置（支持渐变）
        renderBackground(currentBackgroundConfig, canvasWidth, canvasHeight)
      } else {
        // 回退到纯色
        canvasCtx.fillStyle = exportBgColor
        canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight)
      }
    } catch (error) {
      console.warn('🎨 [MP4-Export-Worker] Background render failed, using fallback:', error)
      canvasCtx.fillStyle = exportBgColor
      canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight)
    }

    // 🔧 智能适配：避免因 H.264 偶数补齐（例如 1079→1080）带来的缩放
    const bitmapWidth = bitmap.width
    const bitmapHeight = bitmap.height

    if (bitmapWidth !== canvasWidth || bitmapHeight !== canvasHeight) {
      const widthDiff = canvasWidth - bitmapWidth
      const heightDiff = canvasHeight - bitmapHeight
      const smallDiff = Math.abs(widthDiff) <= 16 && Math.abs(heightDiff) <= 16
      const singleDimDiff = (widthDiff === 0 && heightDiff !== 0) || (heightDiff === 0 && widthDiff !== 0)

      if (smallDiff && singleDimDiff) {
        // 仅因对齐产生的一侧差异：不缩放，居中放置，剩余区域以背景色填充
        const offsetX = Math.max(0, widthDiff / 2)
        const offsetY = Math.max(0, heightDiff / 2)
        canvasCtx.drawImage(bitmap, offsetX, offsetY)
      } else {
        // 计算缩放比例，保持纵横比
        const scaleX = canvasWidth / bitmapWidth
        const scaleY = canvasHeight / bitmapHeight
        const scale = Math.min(scaleX, scaleY)

        const scaledWidth = bitmapWidth * scale
        const scaledHeight = bitmapHeight * scale
        const offsetX = (canvasWidth - scaledWidth) / 2
        const offsetY = (canvasHeight - scaledHeight) / 2

        if (!warnedCanvasSizeMismatch) {
          warnedCanvasSizeMismatch = true
        }
        // 绘制缩放后的图像
        canvasCtx.drawImage(bitmap, offsetX, offsetY, scaledWidth, scaledHeight)
      }
    } else {
      // 尺寸一致，直接绘制
      canvasCtx.drawImage(bitmap, 0, 0)
    }

    processedFrames++

    // GIF 导出时不在这里更新进度，由帧收集控制
    // 其他格式（MP4/WebM）仍然需要更新
    if (currentExportFormat !== 'gif') {
      const progress = 20 + (processedFrames / totalFrames) * 50 // 20%-70%
      updateProgress({
        stage: 'compositing',
        progress,
        currentFrame: processedFrames,
        totalFrames: isOpfsMode ? totalOpfsFrames : totalFrames
      })
    }

    const totalForLog = isOpfsMode ? totalOpfsFrames : totalFrames

  } catch (error) {
    console.error('❌ [MP4-Export-Worker] Error handling composite frame:', error)
  } finally {
    // 🔧 优化：确保 bitmap 在所有路径都被释放，避免内存泄漏
    closeBitmap()
  }
}


/**
 * 验证 MP4 Blob
 */
function validateMP4Blob(blob: Blob, addedFrames: number, totalFrames: number): { isValid: boolean; issues: string[] } {
  const issues: string[] = []

  // 检查文件大小
  if (blob.size === 0) {
    issues.push('文件大小为 0')
  } else if (blob.size < 1000) {
    issues.push('文件大小过小，可能不是有效的 MP4 文件')
  }

  // 检查 MIME 类型
  if (blob.type !== 'video/mp4') {
    issues.push(`MIME 类型不正确: ${blob.type}，期望: video/mp4`)
  }

  // 检查帧数匹配
  const frameSuccessRate = addedFrames / totalFrames
  if (frameSuccessRate < 0.5) {
    issues.push(`帧添加成功率过低: ${(frameSuccessRate * 100).toFixed(1)}%`)
  }

  // 估算合理的文件大小范围
  const estimatedMinSize = addedFrames * 1000 // 每帧至少 1KB
  const estimatedMaxSize = addedFrames * 100000 // 每帧最多 100KB

  if (blob.size < estimatedMinSize) {
    issues.push(`文件大小过小: ${blob.size} bytes，期望至少: ${estimatedMinSize} bytes`)
  } else if (blob.size > estimatedMaxSize) {
    issues.push(`文件大小过大: ${blob.size} bytes，期望最多: ${estimatedMaxSize} bytes`)
  }

  return {
    isValid: issues.length === 0,
    issues
  }
}

/**
 * 检查 Mediabunny 库状态
 */
function checkMediabunnyStatus(): { available: boolean; reason: string } {
  try {
    // 检查 Mediabunny 类是否可用
    if (typeof Output === 'undefined') {
      return { available: false, reason: 'Output 类不可用' }
    }
    if (typeof Mp4OutputFormat === 'undefined') {
      return { available: false, reason: 'Mp4OutputFormat 类不可用' }
    }
    if (typeof BufferTarget === 'undefined') {
      return { available: false, reason: 'BufferTarget 类不可用' }
    }
    if (typeof CanvasSource === 'undefined') {
      return { available: false, reason: 'CanvasSource 类不可用' }
    }

    return { available: true, reason: '所有 Mediabunny 类都可用' }
  } catch (error) {
    return { available: false, reason: `Mediabunny 检查失败: ${(error as Error).message}` }
  }
}

/**
 * 检查 H.264 编码器支持
 */
async function checkH264Support(): Promise<{ supported: boolean; reason: string }> {
  try {
    // 检查 WebCodecs API 可用性
    if (typeof VideoEncoder === 'undefined') {
      return { supported: false, reason: 'WebCodecs API 不可用' }
    }

    // 获取并验证视频尺寸
    const originalWidth = videoInfo?.width || 1920
    const originalHeight = videoInfo?.height || 1080
    const { width, height } = normalizeH264Dimensions(originalWidth, originalHeight)

    // 测试 H.264 编码器配置
    for (const codec of H264_PROBE_CODECS) {
      try {
        const config = {
          codec,
          width,  // 使用修正后的尺寸
          height, // 使用修正后的尺寸
          bitrate: 2000000,
          framerate: 30
        }

        const support = await VideoEncoder.isConfigSupported(config)
        if (support.supported) {
          return { supported: true, reason: `支持 ${codec} (${width}×${height})` }
        } else {
        }
      } catch (error) {
      }
    }

    return { supported: false, reason: `所有 H.264 配置都不支持 (测试尺寸: ${width}×${height})` }
  } catch (error) {
    return { supported: false, reason: `检测失败: ${(error as Error).message}` }
  }
}

/**
 * 导出 MP4
 */



async function exportToMP4(options: ExportOptions): Promise<any> {
  if (!offscreenCanvas || !videoInfo) {
    throw new Error('Canvas or video info not available')
  }

  let activeResource: ActiveExportResource | null = null

  try {
    // 🔧 首先检查 Mediabunny 库状态
    const mediabunnyStatus = checkMediabunnyStatus()

    if (!mediabunnyStatus.available) {
      throw new Error(`Mediabunny 库不可用: ${mediabunnyStatus.reason}`)
    }

    // 🔧 然后检查 H.264 编码器支持
    const h264Support = await checkH264Support()

    if (!h264Support.supported) {
      throw new Error(`H.264 编码器不支持: ${h264Support.reason}。请尝试导出为 WebM 格式。`)
    }
    if (shouldCancel || exportCancellation.isRequested) return null

    const strategy = new Mp4Strategy()

    // 更新进度：编码阶段
    updateProgress({
      stage: 'encoding',
      progress: 75,
      currentFrame: 0,
      totalFrames: 100
    })

    // 创建 Mediabunny 输出（使用策略，支持 OPFS 流式写入）

    const useOpfsStream = Boolean((options as any)?.saveToOpfs && (options as any)?.opfsDirId)
    const outputPromise = strategy.createOutput(useOpfsStream, options).then(({ output }) => output)
    let videoSource: any = null
    const closeVideoSource = () => {
      const source = videoSource
      videoSource = null
      if (source) strategy.closeVideoSource?.(source)
    }
    activeResource = {
      output: outputPromise,
      closeVideoSource,
      discardPartialOutput: () => strategy.discardPartialOutput()
    }
    const pendingCancellation = exportCancellation.register(activeResource)
    const output = await outputPromise
    if (pendingCancellation || shouldCancel || exportCancellation.isRequested) {
      await (pendingCancellation ?? exportCancellation.request())
      return null
    }

    // 创建 CanvasSource（通过策略）
    videoSource = strategy.createVideoSource(offscreenCanvas, { bitrate: options.bitrate || 8000000 })

    const frameRate = (options as any)?.framerate || videoInfo?.frameRate || 30

    // 声明轨道帧率，确保容器可以恢复最后一个样本的持续时间。
    addVideoTrackWithTiming(output, videoSource, frameRate)

    // 启动输出（交由策略处理）
    await strategy.start(output)
    if (shouldCancel || exportCancellation.isRequested) {
      await exportCancellation.request()
      return null
    }

    // 更新进度：封装阶段
    updateProgress({
      stage: 'muxing',
      progress: 80,
      currentFrame: isOpfsMode ? lastEmittedGlobalEnd : 0,
      totalFrames: isOpfsMode ? totalOpfsFrames : totalFrames
    })

    // 计算帧参数（OPFS 模式下 videoInfo 可能尚未通过 ready 返回，优先使用 options 或默认值）
    const totalTargetFrames = isOpfsMode ? totalOpfsFrames : totalFrames
    const duration = totalTargetFrames / frameRate
    const frameDuration = 1 / frameRate


    // 请求 composite worker 逐帧渲染并添加到 CanvasSource
    const addedFrames = isOpfsMode
      ? await renderFramesForExportOpfs(videoSource, frameDuration, options)
      : await renderFramesForExport(videoSource, frameDuration)

    if (shouldCancel || exportCancellation.isRequested) {
      await exportCancellation.request()
      return null
    }

    // 🔧 修复：更宽松的错误检查，与 WebM Worker 保持一致
    if (addedFrames === 0) {
      console.error('❌ [MP4-Export-Worker] 未成功向 H.264 编码器添加任何帧')
      throw new Error('MP4 导出失败：未能添加任何帧到编码器。可能原因：1) 合成 Worker 通信失败 2) H.264 编码器不可用 3) 帧渲染超时')
    } else if (addedFrames < totalFrames * 0.8) {
      console.warn(`⚠️ [MP4-Export-Worker] 只成功添加了 ${addedFrames}/${totalFrames} 帧 (${((addedFrames/totalFrames)*100).toFixed(1)}%)，但继续导出`)
    } else {
    }

    // 完成输出
    updateProgress({
      stage: 'finalizing',
      progress: 95,
      currentFrame: (isOpfsMode ? totalOpfsFrames : totalFrames),
      totalFrames: (isOpfsMode ? totalOpfsFrames : totalFrames)
    })

    // 完成输出（交由策略处理），并关闭视频源
    await strategy.finalize(output)
    closeVideoSource()
    if (shouldCancel || exportCancellation.isRequested) {
      await exportCancellation.request()
      return null
    }

    // 获取结果
    if (useOpfsStream) {
      if (!strategy.getOpfsResultInfo) throw new Error('OPFS_EXPORT_RESULT_UNAVAILABLE')
      const info = await strategy.getOpfsResultInfo(options as any)


      // 最终进度
      updateProgress({
        stage: 'finalizing',
        progress: 100,
        currentFrame: (isOpfsMode ? totalOpfsFrames : totalFrames),
        totalFrames: (isOpfsMode ? totalOpfsFrames : totalFrames),
        fileSize: info.bytes
      })

      if (shouldCancel || exportCancellation.isRequested) {
        await exportCancellation.request()
        return null
      }
      exportCancellation.release(activeResource)
      return { savedToOpfs: { dirId: (options as any).opfsDirId, fileName: info.fileName, bytesWritten: info.bytes } }
    } else {
      const buffer = output.target.buffer
      if (!buffer) {
        throw new Error('Mediabunny 输出缓冲区为空，可能编码过程失败')
      }

      if (buffer.byteLength === 0) {
        throw new Error('Mediabunny 输出缓冲区大小为 0，编码可能失败')
      }

      const mp4Blob = new Blob([buffer], { type: 'video/mp4' })

      // 🔧 验证生成的 MP4 文件


      const validation = validateMP4Blob(mp4Blob, addedFrames, totalFrames)

      if (!validation.isValid) {
        console.warn('⚠️ [MP4-Export-Worker] MP4 validation failed, but continuing with export')
        console.warn('⚠️ [MP4-Export-Worker] Validation issues:', validation.issues)
      }


      // 最终进度
      updateProgress({
        stage: 'finalizing',
        progress: 100,
        currentFrame: (isOpfsMode ? totalOpfsFrames : totalFrames),
        totalFrames: (isOpfsMode ? totalOpfsFrames : totalFrames),
        fileSize: buffer.byteLength
      })

      if (shouldCancel || exportCancellation.isRequested) {
        await exportCancellation.request()
        return null
      }
      exportCancellation.release(activeResource)
      return mp4Blob
    }

  } catch (error) {
    const cancellationWasRequested = shouldCancel || exportCancellation.isRequested
    if (activeResource) {
      try { await exportCancellation.request() } catch (cleanupError) {
        console.error('❌ [MP4-Export-Worker] Failed to clean up output after error:', cleanupError)
      }
    }
    if (cancellationWasRequested) return null
    console.error('❌ [MP4-Export-Worker] MP4 export failed:', error)
    throw new Error(`MP4 export failed: ${(error as Error).message}`)
  }
}

/**
 * 请求逐帧渲染用于导出
 */
async function renderFramesForExport(videoSource: any, frameDuration: number): Promise<number> {
  if (!compositeWorker || !totalFrames) {
    throw new Error('Composite worker or frame count not available')
  }


  let addedCount = 0
  let requestErrors = 0
  let addErrors = 0

  // 逐帧请求合成并添加到 CanvasSource
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    if (shouldCancel) {
      break
    }

    const timestamp = frameIndex * frameDuration

    try {
      // 请求 composite worker 渲染指定帧
      await requestCompositeFrame(frameIndex)

      // 验证 Canvas 状态
      if (!offscreenCanvas || !canvasCtx) {
        throw new Error(`Canvas not available for frame ${frameIndex}`)
      }

      // 添加当前 Canvas 状态到 CanvasSource
      try {
        await videoSource.add(timestamp, frameDuration)
        addedCount++
      } catch (addError) {
        addErrors++
        console.error(`❌ [MP4-Export-Worker] Failed to add frame ${frameIndex} to CanvasSource:`, addError)
      }

      // 更新进度
      const progress = 80 + (frameIndex / totalFrames) * 15 // 80%-95%
      updateProgress({
        stage: 'muxing',
        progress,
        currentFrame: frameIndex + 1,
        totalFrames
      })

    } catch (error) {
      requestErrors++
      console.error(`❌ [MP4-Export-Worker] Failed to process frame ${frameIndex}:`, error)
      // 继续处理下一帧，不中断整个过程
    }
  }

  // 输出最终统计信息

  if (addedCount === 0) {
    console.error('❌ [MP4-Export-Worker] CRITICAL: No frames were successfully added!')
    console.error('❌ [MP4-Export-Worker] This indicates a serious problem with:')
    console.error('  1. Composite worker communication')
    console.error('  2. H.264 encoder availability')
    console.error('  3. Canvas state or CanvasSource configuration')
  }

  return addedCount
}

/**
 * 请求 composite worker 渲染指定帧
 */
async function requestCompositeFrame(
  frameIndex: number,
  scheduleEntry?: PresentationScheduleEntry
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!compositeWorker) {
      reject(new Error('Composite worker not available'))
      return
    }

    // 设置临时消息处理器等待帧渲染完成
    const requestId = ++compositeRenderRequestId
    const compositeRequest = !isOpfsMode && memoryChunkVisibleRange
      ? createMemoryExportCompositeRenderRequest({
          outputFrameIndex: frameIndex,
          outputFrameRate: memoryOutputFrameRate,
          requestId,
          visibleRange: memoryChunkVisibleRange
        })
      : createExportCompositeRenderRequest({
          frameIndex,
          requestId,
          scheduleEntry
        })
    const decodeFrameIndex = compositeRequest.data.frameIndex
    const originalOnMessage = compositeWorker.onmessage
    const timeout = setTimeout(() => {
      console.error(`⏰ [MP4-Export-Worker] Frame ${frameIndex} rendering timeout (5s)`)
      compositeWorker!.onmessage = originalOnMessage
      reject(new Error(`Frame ${frameIndex} rendering timeout after 5 seconds`))
    }, 5000) // 5秒超时

    compositeWorker.onmessage = (event) => {
      const { type, data } = event.data

      const matchesScheduledRequest = compositeRequest.type === 'renderAtTime'
        ? data?.requestId === requestId
        : true
      if (type === 'frame' && data.frameIndex === decodeFrameIndex && matchesScheduledRequest) {
        // 恢复原始消息处理器
        compositeWorker!.onmessage = originalOnMessage
        clearTimeout(timeout)

        // 处理接收到的帧
        try {
          handleCompositeFrame(data.bitmap, data.frameIndex)
          resolve()
        } catch (handleError) {
          console.error(`❌ [MP4-Export-Worker] Failed to handle frame ${frameIndex}:`, handleError)
          reject(handleError)
        }
      } else if (type === 'error') {
        console.error(`❌ [MP4-Export-Worker] Composite worker error for frame ${frameIndex}:`, data)
        compositeWorker!.onmessage = originalOnMessage
        clearTimeout(timeout)
        reject(new Error(data.error || `Composite worker error for frame ${frameIndex}`))
      } else {
        // 转发其他消息
        if (originalOnMessage && compositeWorker) {
          originalOnMessage.call(compositeWorker, event)
        }
      }
    }

    compositeWorker.postMessage(compositeRequest)
  })
}

/**
 * 更新进度
 */
function updateProgress(progress: ProgressData) {
  self.postMessage({
    type: 'progress',
    data: progress
  })
}

/**
 * 处理取消请求
 */
async function handleCancel(): Promise<void> {
  shouldCancel = true
  if (cancellationTask) return cancellationTask

  cancellationTask = (async () => {
    // Stop frame production first, then wait for the output target and partial file cleanup.
    cleanup()
    try {
      await exportCancellation.request()
      cleanup()
      self.postMessage({ type: 'cancelled', data: {} })
    } catch (error) {
      console.error('❌ [Export-Worker] Cancellation cleanup failed:', error)
      self.postMessage({
        type: 'error',
        data: { error: 'EXPORT_CANCEL_CLEANUP_FAILED' }
      })
    }
  })().finally(() => {
    cancellationTask = null
  })

  return cancellationTask
}

/**
 * 清理资源
 */
function cleanup() {
  try {
    if (compositeWorker) {
      compositeWorker.terminate()
      compositeWorker = null
    }
  } catch (e) {
    console.warn('⚠️ [Export-Worker] Error terminating composite worker:', e)
  }

  try { cleanupOpfsReader() } catch (e) {
    console.warn('⚠️ [Export-Worker] Error cleaning up OPFS reader during cleanup:', e)
  }

  offscreenCanvas = null
  canvasCtx = null
  totalFrames = 0
  processedFrames = 0
  videoInfo = null
  currentExportFormat = ''
  compositeRenderRequestId = 0
  memoryChunkVisibleRange = null
  memoryOutputFrameRate = 30
}

// Worker 初始化检查

// 检查 Mediabunny 库
const mediabunnyStatus = checkMediabunnyStatus()

// 检查 OffscreenCanvas 支持
const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined'

// 检查 WebCodecs 支持
const hasWebCodecs = typeof VideoEncoder !== 'undefined'

// 测试 H.264 尺寸验证

/**
 * 基于 OPFS 的逐窗口帧渲染与添加
 */
async function renderFramesForExportOpfs(videoSource: any, frameDuration: number, options: ExportOptions): Promise<number> {
  if (!compositeWorker || !totalOpfsFrames) {
    throw new Error('Composite worker or OPFS frame count not available')
  }

  let addedCount = 0

  const targetFps = Number((options as any)?.framerate) > 0
    ? Number((options as any).framerate)
    : 1 / frameDuration
  const presentationSchedule = getOpfsPresentationSchedule(targetFps)
  if (presentationSchedule) {
    let loadedWindowStart = currentWindowStart
    let loadedWindowCount = currentWindowFrames

    const renderSourceFrame = async (
      sourceFrameIndex: number,
      entry: PresentationScheduleEntry
    ) => {
      const isLoaded = isSourceFrameInLoadedWindow({
        start: loadedWindowStart,
        count: loadedWindowCount
      }, sourceFrameIndex)
      if (!isLoaded) {
        const { chunks, actualStart, actualCount } = await loadOpfsWindow(sourceFrameIndex, opfsWindowSize)
        if (actualCount <= 0 || chunks.length === 0) {
          throw new Error(`OPFS timeline frame ${sourceFrameIndex} is unavailable`)
        }
        loadedWindowStart = actualStart
        loadedWindowCount = actualCount
        await processVideoCompositionOpfs(chunks, options, actualStart)
      }

      const localFrameIndex = sourceFrameIndex - loadedWindowStart
      if (localFrameIndex < 0 || localFrameIndex >= loadedWindowCount) {
        throw new Error(`OPFS timeline frame ${sourceFrameIndex} is outside the decoded window`)
      }
      await requestCompositeFrame(localFrameIndex, entry)
      lastEmittedGlobalEnd = Math.max(lastEmittedGlobalEnd, sourceFrameIndex + 1)
    }

    return writePresentationSchedule({
      schedule: presentationSchedule,
      hasTimeVaryingEffects: hasTimeVaryingEditEffects(options.backgroundConfig),
      renderSourceFrame,
      videoSource,
      onSampleWritten: (writtenCount) => {
        const progress = 80 + (writtenCount / presentationSchedule.length) * 15
        updateProgress({
          stage: 'muxing',
          progress,
          currentFrame: writtenCount,
          totalFrames: presentationSchedule.length
        })
      }
    })
  }

  const legacyStaticHoldPlan = createStaticHoldPlan({
    sourceFrameCount: totalOpfsFrames,
    durationMs: Number(opfsSummary?.durationMs) || 0
  })
  if (!isTrimEnabled && legacyStaticHoldPlan) {
    const { chunks, actualStart, actualCount } = await loadOpfsWindow(0, 1)
    if (actualCount <= 0 || chunks.length === 0) return 0
    await processVideoCompositionOpfs(chunks, options, actualStart)
    return writeStaticHoldVideoSample({
      plan: legacyStaticHoldPlan,
      render: () => requestCompositeFrame(0),
      videoSource
    })
  }

  // 自适应回看边际，初始保守，遇到缺口自动增大，遇到重叠适度减小
  let adaptiveBacktrack = Math.min(30, Math.floor(opfsWindowSize / 2))
  const maxBacktrack = Math.max(30, Math.floor(opfsWindowSize * 2 / 3))

  let nextRequestStart = 0
  // 重置去重边界
  while (nextRequestStart < totalOpfsFrames) {
    // 拉取并对齐窗口（可能因关键帧回退），带回看边际以降低“缺口”概率
    let attempts = 0
    let chunks: any[] = []
    let actualStart = 0
    let actualCount = 0
    let backtrackMargin = adaptiveBacktrack
    let requestStart = Math.max(0, nextRequestStart - backtrackMargin)
    while (true) {
      const win = await loadOpfsWindow(requestStart, opfsWindowSize)
      chunks = win.chunks
      actualStart = win.actualStart
      actualCount = win.actualCount
      if (actualCount <= 0 || chunks.length === 0) {
        console.warn('⚠️ [MP4-Export-Worker] Empty OPFS window, stopping. nextRequestStart=', nextRequestStart)
        break
      }
      if (actualStart > lastEmittedGlobalEnd && requestStart > 0 && adaptiveBacktrack < maxBacktrack && attempts < 2) {
        const gap = actualStart - lastEmittedGlobalEnd
        // 提高回看边际（至少覆盖缺口+15，或在当前基础上+10）
        const increased = Math.max(adaptiveBacktrack + 10, gap + 15)
        const newBacktrack = Math.min(maxBacktrack, increased)
        if (newBacktrack !== adaptiveBacktrack) {
          adaptiveBacktrack = newBacktrack
        }
        backtrackMargin = adaptiveBacktrack
        requestStart = Math.max(0, nextRequestStart - backtrackMargin)
        attempts++
        continue
      }
      break
    }
    if (actualCount <= 0 || chunks.length === 0) {
      break
    }

    // 如仍存在缺口，则用上一帧进行“保持”填补，避免时间轴跳进造成卡顿
    if (actualStart > lastEmittedGlobalEnd) {
      const gap = actualStart - lastEmittedGlobalEnd
      if (gap > 0 && addedCount > 0) {
        const fill = Math.min(gap, totalOpfsFrames - lastEmittedGlobalEnd)
        if (fill > 0) {
          console.warn(`⏯️ [MP4-Export-Worker] Filling gap by holding last frame: ${fill} frame(s) (lastEnd=${lastEmittedGlobalEnd} → actualStart=${actualStart})`)
          for (let i = 0; i < fill; i++) {
            const globalIndex = lastEmittedGlobalEnd + i
            const ts = globalIndex * frameDuration
            try {
              await videoSource.add(ts, frameDuration)
              addedCount++
              const progress = 80 + (globalIndex / totalOpfsFrames) * 15
              updateProgress({ stage: 'muxing', progress, currentFrame: globalIndex + 1, totalFrames: totalOpfsFrames })
            } catch (e) {
              console.warn('⚠️ [MP4-Export-Worker] Gap fill frame add failed:', e)
              break
            }
          }
        }
      }
      // 无论是否填补，推进 lastEmittedGlobalEnd 至 actualStart，后续正常渲染新窗
      lastEmittedGlobalEnd = actualStart
    }

    // 切换/初始化当前窗口
    await processVideoCompositionOpfs(chunks, options, actualStart)

    // 当前窗口内逐帧渲染（跳过与上一窗重叠的起始部分）
    const localStartIndex = Math.max(0, lastEmittedGlobalEnd - actualStart)
    if (localStartIndex > 0) {
      // 发生重叠，适度减小回看，避免过度回看导致的冗余
      adaptiveBacktrack = Math.max(10, adaptiveBacktrack - Math.min(10, localStartIndex))
    }
    if (actualStart > lastEmittedGlobalEnd) {
      const gap = actualStart - lastEmittedGlobalEnd
      console.warn(`⏭️ [MP4-Export-Worker] Detected gap of ${gap} frame(s) between windows (lastEnd=${lastEmittedGlobalEnd} → actualStart=${actualStart}); requested with backtrack=${backtrackMargin}`)
      // 发生缺口时，提高回看边际（至少覆盖缺口+15，或在当前基础上+10），上限不超过 2/3 窗口
      const increased = Math.max(adaptiveBacktrack + 10, gap + 15)
      const newBacktrack = Math.min(maxBacktrack, increased)
      if (newBacktrack !== adaptiveBacktrack) {
        adaptiveBacktrack = newBacktrack
      }
    } else if (localStartIndex === 0 && adaptiveBacktrack > 10) {
      // 连续无缺口、无重叠时，缓慢衰减回看，避免不必要的回看成本
      adaptiveBacktrack = Math.max(10, adaptiveBacktrack - 1)
    }
    for (let localIndex = localStartIndex; localIndex < actualCount; localIndex++) {
      if (shouldCancel) {
        return addedCount
      }

      const globalIndex = actualStart + localIndex
      const timestamp = globalIndex * frameDuration

      try {
        await requestCompositeFrame(localIndex)
        await videoSource.add(timestamp, frameDuration)
        addedCount++

        // 进度按全量帧数汇报
        const progress = 80 + (globalIndex / totalOpfsFrames) * 15
        updateProgress({
          stage: 'muxing',
          progress,
          currentFrame: globalIndex + 1,
          totalFrames: totalOpfsFrames
        })
      } catch (err) {
        console.error(`❌ [MP4-Export-Worker] [OPFS] Failed to process global frame ${globalIndex}:`, err)
      }
    }

    // 跳到下一窗口：使用上次已输出的全局末尾，避免重复与回退
    lastEmittedGlobalEnd = Math.max(lastEmittedGlobalEnd, actualStart + actualCount)
    nextRequestStart = lastEmittedGlobalEnd
  }

  return addedCount
}


/**
 * WebM 导出（支持 OPFS 流式写入；否则走内存 BufferTarget）
 */
async function exportToWEBMCompat(options: ExportOptions): Promise<any> {
  if (!offscreenCanvas || !videoInfo) {
    throw new Error('Canvas or video info not available')
  }

  // 编码阶段进度
  updateProgress({ stage: 'encoding', progress: 75, currentFrame: 0, totalFrames: 100 })

  if (shouldCancel || exportCancellation.isRequested) return null

  const strategy = new WebmStrategy()

  const useOpfsStream = Boolean((options as any)?.saveToOpfs && (options as any)?.opfsDirId)
  const outputPromise = strategy.createOutput(useOpfsStream, options).then(({ output }) => output)
  let videoSource: any = null
  const closeVideoSource = () => {
    const source = videoSource
    videoSource = null
    if (source) strategy.closeVideoSource?.(source)
  }
  const activeResource: ActiveExportResource = {
    output: outputPromise,
    closeVideoSource,
    discardPartialOutput: () => strategy.discardPartialOutput()
  }
  const pendingCancellation = exportCancellation.register(activeResource)
  const output = await outputPromise
  if (pendingCancellation || shouldCancel || exportCancellation.isRequested) {
    await (pendingCancellation ?? exportCancellation.request())
    return null
  }

  // 创建 CanvasSource（vp9，默认 8Mbps）
  videoSource = strategy.createVideoSource(offscreenCanvas, { bitrate: options.bitrate || 8_000_000 })
  const frameRate = (options as any)?.framerate || videoInfo.frameRate
  addVideoTrackWithTiming(output, videoSource, frameRate)

  await strategy.start(output)
  if (shouldCancel || exportCancellation.isRequested) {
    await exportCancellation.request()
    return null
  }

  // 封装阶段进度
  updateProgress({ stage: 'muxing', progress: 80, currentFrame: 0, totalFrames })

  const frameDuration = 1 / frameRate


  // 逐帧渲染并添加（OPFS 模式走窗口化渲染）
  const addedFrames = isOpfsMode
    ? await renderFramesForExportOpfs(videoSource, frameDuration, options)
    : await renderFramesForExportWebm(videoSource, frameDuration)

  if (shouldCancel || exportCancellation.isRequested) {
    await exportCancellation.request()
    return null
  }

  // 完成输出
  updateProgress({ stage: 'finalizing', progress: 95, currentFrame: totalFrames, totalFrames })

  await strategy.finalize(output)
  closeVideoSource()
  if (shouldCancel || exportCancellation.isRequested) {
    await exportCancellation.request()
    return null
  }

  if (useOpfsStream) {
    if (!strategy.getOpfsResultInfo) throw new Error('OPFS_EXPORT_RESULT_UNAVAILABLE')
    const info = await strategy.getOpfsResultInfo(options as any)
    updateProgress({ stage: 'finalizing', progress: 100, currentFrame: totalFrames, totalFrames, fileSize: info.bytes })
    if (shouldCancel || exportCancellation.isRequested) {
      await exportCancellation.request()
      return null
    }
    exportCancellation.release(activeResource)
    return { savedToOpfs: { dirId: (options as any).opfsDirId, fileName: info.fileName, bytesWritten: info.bytes } }
  }

  const buffer = (output as any).target?.buffer as ArrayBuffer | undefined
  if (!buffer) throw new Error('No buffer data available from Mediabunny output')

  const webmBlob = new Blob([buffer], { type: 'video/webm' })

  // 最终进度
  updateProgress({ stage: 'finalizing', progress: 100, currentFrame: totalFrames, totalFrames, fileSize: buffer.byteLength })

  if (shouldCancel || exportCancellation.isRequested) {
    await exportCancellation.request()
    return null
  }
  exportCancellation.release(activeResource)
  return webmBlob
}

/**
 * GIF 导出
 * 由于 gif.js 需要在主线程运行，这里收集所有帧数据后发送到主线程处理
 */
async function exportToGIF(options: ExportOptions): Promise<Blob> {
  if (!offscreenCanvas || !videoInfo) {
    throw new Error('Canvas or video info not available')
  }

  // 获取 GIF 配置
  const gifOptions = (options as any).gifOptions || {}
  const fps = gifOptions.fps || 10
  const quality = gifOptions.quality || 10
  const scale = gifOptions.scale || 1.0
  // 以源帧率为时间基，按 gif fps 抽帧，保证时间轴一致
  const sourceFps = videoInfo?.frameRate || 30
  const stride = Math.max(1, Math.round(sourceFps / fps))
  const rawGifPresentationSchedule = isOpfsMode ? getOpfsPresentationSchedule(fps) : null
  const gifPresentationSchedule = rawGifPresentationSchedule
    ? createGifFrameSchedule(rawGifPresentationSchedule, {
        collapseRepeated: !hasTimeVaryingEditEffects(options.backgroundConfig)
      }).frames
    : null
  const expectedFrames = gifPresentationSchedule?.length
    ?? (isOpfsMode ? Math.ceil(totalOpfsFrames / stride) : Math.ceil(totalFrames / stride))

  // 计算输出尺寸
  const outputSize = resolveGifScaledDimensions(
    offscreenCanvas.width,
    offscreenCanvas.height,
    scale
  )
  const outputWidth = outputSize.width
  const outputHeight = outputSize.height
  assertGifExportWithinMemoryBudget({ width: outputWidth, height: outputHeight, frameCount: expectedFrames })

  // 创建 GIF 策略（仅用于 extractImageData，不再收集帧）
  const gifStrategy = new GifStrategy({
    width: outputWidth,
    height: outputHeight,
    quality,
    fps,
    workers: gifOptions.workers || 2,
    repeat: gifOptions.repeat ?? 0,
    dither: gifOptions.dither || false,
    background: options.backgroundConfig?.color || '#000000',
    transparent: gifOptions.transparent || null,
    debug: gifOptions.debug || false
  })

  const frameDelay = 1000 / fps // 毫秒

  // 流式 GIF 编码：边解码边编码，避免将所有帧存入内存
  const gifBlob = await streamGifEncode(
    gifStrategy,
    options,
    frameDelay,
    scale,
    stride,
    expectedFrames,
    gifPresentationSchedule
  )

  // 清理
  gifStrategy.cleanup()

  return validateGifBlob(gifBlob)
}

/**
 * 流式 GIF 编码：边解码边发送到主线程编码，避免将所有帧存入内存
 * 内存使用从 O(N×帧大小) 降至 O(帧大小)
 */
// GIF 操作超时常量
const GIF_OPERATION_TIMEOUT = 30000   // 单帧操作超时（30秒）
const GIF_RENDER_TIMEOUT = 300000     // GIF 渲染超时（5分钟，大 GIF 较慢）

async function streamGifEncode(
  gifStrategy: GifStrategy,
  options: ExportOptions,
  frameDelay: number,
  scale: number,
  stride: number,
  expectedFrames: number,
  presentationSchedule: readonly GifFrameScheduleEntry[] | null
): Promise<Blob> {
  // 1) 初始化主线程 GIF 编码器并等待 ready
  await initGifEncoderOnMainThread(gifStrategy.getOptions(), expectedFrames)

  // 2) 边解码边发送帧（流式）
  let sentFrames = 0
  if (isOpfsMode) {
    sentFrames = await streamFramesOpfs(
      gifStrategy,
      frameDelay,
      scale,
      stride,
      expectedFrames,
      presentationSchedule
    )
  } else {
    sentFrames = await streamFramesMemory(gifStrategy, frameDelay, scale, stride, expectedFrames)
  }

  // 3) 所有帧已发送，请求主线程渲染 GIF 并等待结果
  const gifBlob = await requestGifRender(sentFrames)
  return gifBlob
}

/** 通知主线程初始化 GIF 编码器，等待 ready */
function initGifEncoderOnMainThread(gifOptions: any, totalFrames: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'gif-encoder-ready') {
        clearTimeout(timer)
        self.removeEventListener('message', handler)
        resolve()
      } else if (event.data?.type === 'gif-encode-error') {
        clearTimeout(timer)
        self.removeEventListener('message', handler)
        reject(new Error(event.data.data?.error || 'GIF encoder init failed'))
      }
    }
    self.addEventListener('message', handler)

    self.postMessage({
      type: 'gif-init',
      data: { options: gifOptions, totalFrames }
    })

    // 初始化超时
    timer = setTimeout(() => {
      self.removeEventListener('message', handler)
      reject(new Error('GIF encoder initialization timeout'))
    }, GIF_OPERATION_TIMEOUT)
  })
}

/** 发送单帧到主线程 GIF 编码器并等待确认（背压控制） */
function sendFrameToMainThread(imageData: ImageData, delay: number, dispose: number, frameIndex: number, totalFrames: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'gif-frame-added' && event.data.data?.frameIndex === frameIndex) {
        clearTimeout(timer)
        self.removeEventListener('message', handler)
        resolve()
      } else if (event.data?.type === 'gif-encode-error') {
        clearTimeout(timer)
        self.removeEventListener('message', handler)
        reject(new Error(event.data.data?.error || 'GIF frame add failed'))
      }
    }
    self.addEventListener('message', handler)

    ;(self as any).postMessage({
      type: 'gif-add-frame',
      data: { imageData, delay, dispose, frameIndex, totalFrames }
    }, [imageData.data.buffer])

    // 单帧超时
    timer = setTimeout(() => {
      self.removeEventListener('message', handler)
      reject(new Error(`GIF frame ${frameIndex} add timeout`))
    }, GIF_OPERATION_TIMEOUT)
  })
}

/** 请求主线程渲染 GIF 并等待 blob 结果 */
function requestGifRender(totalFrames: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'gif-encode-complete') {
        clearTimeout(timer)
        self.removeEventListener('message', handler)
        resolve(event.data.data.blob)
      } else if (event.data?.type === 'gif-encode-error') {
        clearTimeout(timer)
        self.removeEventListener('message', handler)
        reject(new Error(event.data.data?.error || 'GIF rendering failed'))
      }
    }
    self.addEventListener('message', handler)

    self.postMessage({
      type: 'gif-render',
      data: { totalFrames }
    })

    // 渲染超时
    timer = setTimeout(() => {
      self.removeEventListener('message', handler)
      reject(new Error('GIF encoding timeout'))
    }, GIF_RENDER_TIMEOUT)
  })
}

/** 提取当前画布帧的 ImageData（含缩放） */
function extractCurrentFrameImageData(gifStrategy: GifStrategy, scale: number): ImageData | null {
  if (!offscreenCanvas) return null

  let sourceCanvas: OffscreenCanvas = offscreenCanvas
  if (scale !== 1.0) {
    const scaledSize = resolveGifScaledDimensions(
      offscreenCanvas.width,
      offscreenCanvas.height,
      scale
    )
    const scaledCanvas = new OffscreenCanvas(
      scaledSize.width,
      scaledSize.height
    )
    const scaledCtx = scaledCanvas.getContext('2d')
    if (scaledCtx) {
      scaledCtx.drawImage(offscreenCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height)
      sourceCanvas = scaledCanvas
    }
  }

  return gifStrategy.extractImageData(sourceCanvas)
}

/**
 * 流式发送帧到主线程（内存模式）：逐帧解码 → 立即发送 → 等待确认 → 下一帧
 */
async function streamFramesMemory(
  gifStrategy: GifStrategy,
  frameDelay: number,
  scale: number,
  stride: number,
  expectedFrames: number
): Promise<number> {
  let sentFrames = 0

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += stride) {
    if (shouldCancel) break

    try {
      await requestCompositeFrame(frameIndex)

      const imageData = extractCurrentFrameImageData(gifStrategy, scale)
      if (imageData) {
        // 立即发送到主线程编码，等待确认后才处理下一帧（背压控制）
        await sendFrameToMainThread(imageData, frameDelay, 2, sentFrames, expectedFrames)
        sentFrames++
      }

      // 更新进度：帧处理阶段占总进度的5%-40%
      const progress = 5 + (Math.min(sentFrames, expectedFrames) / expectedFrames) * 35
      updateProgress({
        stage: 'encoding',
        progress,
        currentFrame: sentFrames,
        totalFrames: expectedFrames
      })

    } catch (error) {
      throw new Error(`GIF_FRAME_STREAM_FAILED:${frameIndex}`, { cause: error })
    }
  }

  return sentFrames
}

/**
 * 流式发送帧到主线程（OPFS 模式）：窗口化读取 → 逐帧解码 → 立即发送
 */
async function streamFramesOpfs(
  gifStrategy: GifStrategy,
  frameDelay: number,
  scale: number,
  stride: number,
  expectedFrames: number,
  presentationSchedule: readonly GifFrameScheduleEntry[] | null
): Promise<number> {
  if (presentationSchedule) {
    let sentFrames = 0
    let loadedWindowStart = currentWindowStart
    let loadedWindowCount = currentWindowFrames

    for (const entry of presentationSchedule) {
      if (shouldCancel) break
      const sourceFrameIndex = entry.sourceFrameIndex
      if (!isSourceFrameInLoadedWindow({ start: loadedWindowStart, count: loadedWindowCount }, sourceFrameIndex)) {
        const window = await loadOpfsWindow(sourceFrameIndex, opfsWindowSize)
        if (window.actualCount <= 0 || window.chunks.length === 0) {
          throw new Error(`GIF_SOURCE_FRAME_UNAVAILABLE:${sourceFrameIndex}`)
        }
        loadedWindowStart = window.actualStart
        loadedWindowCount = window.actualCount
        await processVideoCompositionOpfs(
          window.chunks,
          { backgroundConfig: currentBackgroundConfig } as any,
          window.actualStart
        )
      }

      const localFrameIndex = sourceFrameIndex - loadedWindowStart
      await requestCompositeFrame(localFrameIndex, entry)
      const imageData = extractCurrentFrameImageData(gifStrategy, scale)
      if (!imageData) throw new Error(`GIF_FRAME_RENDER_FAILED:${sourceFrameIndex}`)
      await sendFrameToMainThread(
        imageData,
        entry.delayMs,
        2,
        sentFrames,
        expectedFrames
      )
      sentFrames++
      updateProgress({
        stage: 'encoding',
        progress: 5 + (sentFrames / expectedFrames) * 35,
        currentFrame: sentFrames,
        totalFrames: expectedFrames
      })
    }

    return sentFrames
  }

  let sentFrames = 0
  let nextRequestStart = 0

  while (nextRequestStart < totalOpfsFrames) {
    if (shouldCancel) break

    const { chunks, actualStart, actualCount } = await loadOpfsWindow(nextRequestStart, opfsWindowSize)

    if (actualCount <= 0 || chunks.length === 0) {
      console.warn('⚠️ [GIF-Export-Worker] Empty OPFS window, stopping')
      break
    }

    await processVideoCompositionOpfs(chunks, { backgroundConfig: currentBackgroundConfig } as any, actualStart)

    for (let i = 0; i < actualCount; i++) {
      const globalFrameIndex = actualStart + i

      if (globalFrameIndex >= totalOpfsFrames) break
      if (shouldCancel) break

      try {
        // 按步长抽帧
        if (stride > 1 && (globalFrameIndex % stride) !== 0) {
          continue
        }

        await requestCompositeFrame(i)

        const imageData = extractCurrentFrameImageData(gifStrategy, scale)
        if (imageData) {
          await sendFrameToMainThread(imageData, frameDelay, 2, sentFrames, expectedFrames)
          sentFrames++
        }

        // 更新进度：帧处理阶段占总进度的5%-40%
        const progress = 5 + (Math.min(sentFrames, expectedFrames) / expectedFrames) * 35
        updateProgress({
          stage: 'encoding',
          progress,
          currentFrame: sentFrames,
          totalFrames: expectedFrames
        })

      } catch (error) {
        throw new Error(`GIF_OPFS_FRAME_STREAM_FAILED:${globalFrameIndex}`, { cause: error })
      }
    }

    nextRequestStart += actualCount
  }

  return sentFrames
}

/**
 * WebM 逐帧渲染
 */
async function renderFramesForExportWebm(videoSource: any, frameDuration: number): Promise<void> {
  if (!compositeWorker || !totalFrames) {
    throw new Error('Composite worker or frame count not available')
  }


  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    if (shouldCancel) break

    const timestamp = frameIndex * frameDuration

    try {
      await requestCompositeFrame(frameIndex)

      await videoSource.add(timestamp, frameDuration)

      const progress = 80 + (frameIndex / totalFrames) * 15 // 80%-95%
      updateProgress({ stage: 'muxing', progress, currentFrame: frameIndex + 1, totalFrames })
    } catch (error) {
      console.error(`❌ [WebM-Export-Worker] Failed to add frame ${frameIndex}:`, error)
      // 不中断整个过程
    }
  }

}
