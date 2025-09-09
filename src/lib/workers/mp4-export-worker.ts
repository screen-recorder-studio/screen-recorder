// MP4 导出 Worker - 协调视频合成和 MP4 导出
// 使用 video-composite-worker 进行合成，然后用 Mediabunny 导出 MP4
import type { EncodedChunk, ExportOptions, BackgroundConfig, GradientConfig, ImageBackgroundConfig } from '../types/background'
import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource
} from 'mediabunny'

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

// 合成状态
let totalFrames = 0
let processedFrames = 0
let videoInfo: { width: number, height: number, frameRate: number } | null = null

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
        handleCancel()
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

  try {
    console.log('🎬 [MP4-Export-Worker] Starting MP4 export')
    console.log('📊 [MP4-Export-Worker] Input chunks:', exportData.chunks.length)
    console.log('⚙️ [MP4-Export-Worker] Export options:', exportData.options)

    const { chunks, options } = exportData

    // 更新进度：准备阶段
    updateProgress({
      stage: 'preparing',
      progress: 5,
      currentFrame: 0,
      totalFrames: chunks.length
    })

    if (shouldCancel) return

    // 1. 创建并初始化 video-composite-worker
    console.log('🔄 [MP4-Export-Worker] Creating composite worker')
    await createCompositeWorker()

    if (shouldCancel) return

    // 2. 处理视频合成
    console.log('🎨 [MP4-Export-Worker] Starting video composition')
    await processVideoComposition(chunks, options)

    if (shouldCancel) return

    // 3. 导出 MP4
    console.log('📦 [MP4-Export-Worker] Starting MP4 export')
    const mp4Blob = await exportToMP4(options)

    if (shouldCancel) return

    // 完成导出
    console.log('✅ [MP4-Export-Worker] MP4 export completed')
    self.postMessage({
      type: 'complete',
      data: { blob: mp4Blob }
    })

  } catch (error) {
    console.error('❌ [MP4-Export-Worker] Export failed:', error)
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
        new URL('./video-composite-worker.ts', import.meta.url),
        { type: 'module' }
      )

      // 设置消息处理
      compositeWorker.onmessage = (event) => {
        const { type, data } = event.data

        switch (type) {
          case 'initialized':
            console.log('✅ [MP4-Export-Worker] Composite worker initialized')
            resolve()
            break

          case 'ready':
            console.log('✅ [MP4-Export-Worker] Video composition ready:', data)
            totalFrames = data.totalFrames
            videoInfo = {
              width: data.outputSize.width,
              height: data.outputSize.height,
              frameRate: 30 // 默认帧率
            }

            // 创建 OffscreenCanvas 用于接收合成帧
            createOffscreenCanvas(data.outputSize.width, data.outputSize.height)
            break

          case 'frame':
            // 接收合成后的帧
            handleCompositeFrame(data.bitmap, data.frameIndex)
            break

          case 'complete':
            console.log('🎉 [MP4-Export-Worker] Video composition completed')
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
  const { width: h264Width, height: h264Height, modified } = validateAndFixH264Dimensions(width, height)

  if (modified) {
    console.log(`🔧 [MP4-Export-Worker] Canvas size adjusted for H.264 compatibility:`)
    console.log(`  Requested: ${width}×${height}`)
    console.log(`  Actual: ${h264Width}×${h264Height}`)
  }

  offscreenCanvas = new OffscreenCanvas(h264Width, h264Height)
  canvasCtx = offscreenCanvas.getContext('2d')

  if (!canvasCtx) {
    throw new Error('Failed to get 2D context from OffscreenCanvas')
  }

  // 如果尺寸被调整，需要更新 videoInfo
  if (modified && videoInfo) {
    console.log(`📐 [MP4-Export-Worker] Updating videoInfo dimensions for H.264 compatibility`)
    videoInfo.width = h264Width
    videoInfo.height = h264Height
  }

  console.log('🎨 [MP4-Export-Worker] OffscreenCanvas created:', {
    width: h264Width,
    height: h264Height,
    h264Compatible: true,
    modified
  })
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

  return new Promise((resolve, reject) => {
    if (!compositeWorker) {
      reject(new Error('Composite worker not available'))
      return
    }

    // 更新进度
    updateProgress({
      stage: 'compositing',
      progress: 10,
      currentFrame: 0,
      totalFrames: chunks.length
    })

    // 准备可传输的数据块
    const transferableChunks = chunks.map(chunk => ({
      data: chunk.data.buffer.slice(chunk.data.byteOffset, chunk.data.byteOffset + chunk.data.byteLength),
      timestamp: chunk.timestamp,
      type: chunk.type,
      size: chunk.size,
      codedWidth: chunk.codedWidth,
      codedHeight: chunk.codedHeight,
      codec: chunk.codec
    }))

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
        }
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

/**
 * 处理合成帧
 */
function handleCompositeFrame(bitmap: ImageBitmap, frameIndex: number) {
  if (!canvasCtx || !offscreenCanvas) {
    console.error('❌ [MP4-Export-Worker] Canvas not available')
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

    // 🔧 智能适配：尽量避免因 H.264 对齐(例如 1080→1088)带来的缩放
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

        console.log(`🔧 [MP4-Export-Worker] Scaling frame ${frameIndex}:`)
        console.log(`  Bitmap: ${bitmapWidth}×${bitmapHeight}`)
        console.log(`  Canvas: ${canvasWidth}×${canvasHeight}`)
        console.log(`  Scaled: ${scaledWidth.toFixed(0)}×${scaledHeight.toFixed(0)} at (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`)

        // 绘制缩放后的图像
        canvasCtx.drawImage(bitmap, offsetX, offsetY, scaledWidth, scaledHeight)
      }
    } else {
      // 尺寸一致，直接绘制
      canvasCtx.drawImage(bitmap, 0, 0)
    }

    processedFrames++

    // 更新进度
    const progress = 20 + (processedFrames / totalFrames) * 50 // 20%-70%
    updateProgress({
      stage: 'compositing',
      progress,
      currentFrame: processedFrames,
      totalFrames
    })

    console.log(`🎨 [MP4-Export-Worker] Frame ${frameIndex} composited (${processedFrames}/${totalFrames})`)

  } catch (error) {
    console.error('❌ [MP4-Export-Worker] Error handling composite frame:', error)
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

    console.log('✅ [MP4-Export-Worker] All Mediabunny classes available')
    return { available: true, reason: '所有 Mediabunny 类都可用' }
  } catch (error) {
    return { available: false, reason: `Mediabunny 检查失败: ${(error as Error).message}` }
  }
}

/**
 * 验证和修复 H.264 兼容的尺寸
 */
function validateAndFixH264Dimensions(width: number, height: number): { width: number; height: number; modified: boolean } {
  const originalWidth = width
  const originalHeight = height

  // 确保尺寸是偶数（H.264 要求）
  let fixedWidth = width % 2 === 0 ? width : width + 1
  let fixedHeight = height % 2 === 0 ? height : height + 1

  // 确保最小尺寸（16×16）
  fixedWidth = Math.max(fixedWidth, 16)
  fixedHeight = Math.max(fixedHeight, 16)

  // 推荐：调整为 16 的倍数以获得最佳性能
  const alignedWidth = Math.ceil(fixedWidth / 16) * 16
  const alignedHeight = Math.ceil(fixedHeight / 16) * 16

  const modified = (alignedWidth !== originalWidth) || (alignedHeight !== originalHeight)

  if (modified) {
    console.log(`🔧 [MP4-Export-Worker] H.264 dimension adjustment:`)
    console.log(`  Original: ${originalWidth}×${originalHeight}`)
    console.log(`  Fixed: ${alignedWidth}×${alignedHeight}`)
    console.log(`  Reasons:`)
    if (originalWidth % 2 !== 0) console.log(`    - Width must be even (was ${originalWidth})`)
    if (originalHeight % 2 !== 0) console.log(`    - Height must be even (was ${originalHeight})`)
    if (originalWidth < 16) console.log(`    - Width below minimum (was ${originalWidth})`)
    if (originalHeight < 16) console.log(`    - Height below minimum (was ${originalHeight})`)
    console.log(`    - Aligned to 16-pixel boundaries for optimal performance`)
  }

  return {
    width: alignedWidth,
    height: alignedHeight,
    modified
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
    const { width, height, modified } = validateAndFixH264Dimensions(originalWidth, originalHeight)

    if (modified) {
      console.log(`⚠️ [MP4-Export-Worker] Video dimensions need adjustment for H.264 compatibility`)
    }

    // 测试 H.264 编码器配置
    const testConfigs = [
      'avc1.42001e',  // Baseline Profile Level 3.0
      'avc1.42E01E',  // Baseline Profile Level 3.0 (alternative)
      'avc1.4D001E',  // Main Profile Level 3.0
      'avc1.640028'   // High Profile Level 4.0
    ]

    for (const codec of testConfigs) {
      try {
        const config = {
          codec,
          width,  // 使用修正后的尺寸
          height, // 使用修正后的尺寸
          bitrate: 2000000,
          framerate: 30
        }

        console.log(`🔍 [MP4-Export-Worker] Testing H.264 config:`, config)
        const support = await VideoEncoder.isConfigSupported(config)
        if (support.supported) {
          console.log(`✅ [MP4-Export-Worker] H.264 codec supported: ${codec}`)
          return { supported: true, reason: `支持 ${codec} (${width}×${height})` }
        } else {
          console.log(`❌ [MP4-Export-Worker] H.264 codec not supported: ${codec}`)
        }
      } catch (error) {
        console.log(`❌ [MP4-Export-Worker] H.264 codec test failed: ${codec}`, error)
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
async function exportToMP4(options: ExportOptions): Promise<Blob> {
  if (!offscreenCanvas || !videoInfo) {
    throw new Error('Canvas or video info not available')
  }

  console.log('🎬 [MP4-Export-Worker] Starting Mediabunny export')

  try {
    // 🔧 首先检查 Mediabunny 库状态
    console.log('🔍 [MP4-Export-Worker] Checking Mediabunny library status...')
    const mediabunnyStatus = checkMediabunnyStatus()
    console.log('🔍 [MP4-Export-Worker] Mediabunny status check result:', mediabunnyStatus)

    if (!mediabunnyStatus.available) {
      throw new Error(`Mediabunny 库不可用: ${mediabunnyStatus.reason}`)
    }

    // 🔧 然后检查 H.264 编码器支持
    console.log('🔍 [MP4-Export-Worker] Checking H.264 encoder support...')
    const h264Support = await checkH264Support()
    console.log('🔍 [MP4-Export-Worker] H.264 support check result:', h264Support)

    if (!h264Support.supported) {
      throw new Error(`H.264 编码器不支持: ${h264Support.reason}。请尝试导出为 WebM 格式。`)
    }

    // 更新进度：编码阶段
    updateProgress({
      stage: 'encoding',
      progress: 75,
      currentFrame: 0,
      totalFrames: 100
    })

    // 创建 Mediabunny 输出
    console.log('🏗️ [MP4-Export-Worker] Creating Mediabunny Output...')
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget()
    })

    // 创建 CanvasSource（为 MP4 显式指定 H.264 与分辨率/帧率）
    console.log('🎨 [MP4-Export-Worker] Creating CanvasSource with H.264 codec...')
    console.log('🎨 [MP4-Export-Worker] CanvasSource config:', {
      canvasSize: { width: offscreenCanvas.width, height: offscreenCanvas.height },
      videoInfo,
      codec: 'avc',
      bitrate: options.bitrate || 8000000
    })

    const videoSource = new CanvasSource(offscreenCanvas, {
      codec: 'avc',
      bitrate: options.bitrate || 8000000
    })

    console.log('✅ [MP4-Export-Worker] CanvasSource created successfully')

    // 添加视频轨道
    console.log('🎬 [MP4-Export-Worker] Adding video track to output...')
    output.addVideoTrack(videoSource)

    // 启动输出
    console.log('🚀 [MP4-Export-Worker] Starting Mediabunny output...')
    try {
      await output.start()
      console.log('✅ [MP4-Export-Worker] Mediabunny output started successfully')
    } catch (startError) {
      console.error('❌ [MP4-Export-Worker] Failed to start Mediabunny output:', startError)
      throw new Error(`Mediabunny 输出启动失败: ${(startError as Error).message}`)
    }

    // 更新进度：封装阶段
    updateProgress({
      stage: 'muxing',
      progress: 80,
      currentFrame: 0,
      totalFrames: totalFrames
    })

    // 计算帧参数
    const { frameRate } = videoInfo
    const duration = totalFrames / frameRate
    const frameDuration = 1 / frameRate

    console.log(`📊 [MP4-Export-Worker] Export parameters: duration=${duration}s, totalFrames=${totalFrames}, frameRate=${frameRate}`)

    // 请求 composite worker 逐帧渲染并添加到 CanvasSource
    console.log(`🎬 [MP4-Export-Worker] Starting frame rendering for ${totalFrames} frames`)
    const addedFrames = await renderFramesForExport(videoSource, frameDuration)
    console.log(`📊 [MP4-Export-Worker] Successfully added ${addedFrames} frames to H.264 encoder`)

    // 🔧 修复：更宽松的错误检查，与 WebM Worker 保持一致
    if (addedFrames === 0) {
      console.error('❌ [MP4-Export-Worker] 未成功向 H.264 编码器添加任何帧')
      throw new Error('MP4 导出失败：未能添加任何帧到编码器。可能原因：1) 合成 Worker 通信失败 2) H.264 编码器不可用 3) 帧渲染超时')
    } else if (addedFrames < totalFrames * 0.8) {
      console.warn(`⚠️ [MP4-Export-Worker] 只成功添加了 ${addedFrames}/${totalFrames} 帧 (${((addedFrames/totalFrames)*100).toFixed(1)}%)，但继续导出`)
    } else {
      console.log(`✅ [MP4-Export-Worker] 成功添加了 ${addedFrames}/${totalFrames} 帧 (${((addedFrames/totalFrames)*100).toFixed(1)}%)`)
    }

    // 完成输出
    updateProgress({
      stage: 'finalizing',
      progress: 95,
      currentFrame: totalFrames,
      totalFrames
    })

    console.log('🔚 [MP4-Export-Worker] Finalizing Mediabunny output...')
    try {
      await output.finalize()
      console.log('✅ [MP4-Export-Worker] Mediabunny output finalized successfully')
    } catch (finalizeError) {
      console.error('❌ [MP4-Export-Worker] Failed to finalize Mediabunny output:', finalizeError)
      throw new Error(`Mediabunny 输出完成失败: ${(finalizeError as Error).message}`)
    }

    // 获取结果
    const buffer = output.target.buffer
    if (!buffer) {
      throw new Error('Mediabunny 输出缓冲区为空，可能编码过程失败')
    }

    if (buffer.byteLength === 0) {
      throw new Error('Mediabunny 输出缓冲区大小为 0，编码可能失败')
    }

    const mp4Blob = new Blob([buffer], { type: 'video/mp4' })

    // 🔧 验证生成的 MP4 文件
    console.log('🔍 [MP4-Export-Worker] Validating generated MP4...')
    const validation = validateMP4Blob(mp4Blob, addedFrames, totalFrames)
    console.log('🔍 [MP4-Export-Worker] MP4 validation result:', validation)

    if (!validation.isValid) {
      console.warn('⚠️ [MP4-Export-Worker] MP4 validation failed, but continuing with export')
      console.warn('⚠️ [MP4-Export-Worker] Validation issues:', validation.issues)
    }

    console.log('✅ [MP4-Export-Worker] MP4 export completed successfully')
    console.log(`📊 [MP4-Export-Worker] Final MP4 size: ${buffer.byteLength} bytes (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`)
    console.log(`📊 [MP4-Export-Worker] Added frames: ${addedFrames}/${totalFrames} (${((addedFrames / totalFrames) * 100).toFixed(1)}%)`)
    console.log(`📊 [MP4-Export-Worker] Estimated duration: ${(totalFrames / videoInfo.frameRate).toFixed(2)}s`)
    console.log(`📊 [MP4-Export-Worker] Average bitrate: ${((buffer.byteLength * 8) / (totalFrames / videoInfo.frameRate) / 1000).toFixed(0)} kbps`)

    // 最终进度
    updateProgress({
      stage: 'finalizing',
      progress: 100,
      currentFrame: totalFrames,
      totalFrames,
      fileSize: buffer.byteLength
    })

    return mp4Blob

  } catch (error) {
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

  console.log(`🎬 [MP4-Export-Worker] Starting frame rendering for ${totalFrames} frames`)
  console.log(`📊 [MP4-Export-Worker] Frame duration: ${frameDuration}s, Total duration: ${(totalFrames * frameDuration).toFixed(2)}s`)

  let addedCount = 0
  let requestErrors = 0
  let addErrors = 0

  // 逐帧请求合成并添加到 CanvasSource
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    if (shouldCancel) {
      console.log(`🛑 [MP4-Export-Worker] Export cancelled at frame ${frameIndex}`)
      break
    }

    const timestamp = frameIndex * frameDuration

    try {
      // 请求 composite worker 渲染指定帧
      console.log(`🎬 [MP4-Export-Worker] Requesting frame ${frameIndex}...`)
      await requestCompositeFrame(frameIndex)
      console.log(`✅ [MP4-Export-Worker] Frame ${frameIndex} rendered successfully`)

      // 等待一帧时间确保渲染完成
      await new Promise(resolve => setTimeout(resolve, 16))

      // 验证 Canvas 状态
      if (!offscreenCanvas || !canvasCtx) {
        console.error(`❌ [MP4-Export-Worker] Canvas not available for frame ${frameIndex}`)
        throw new Error(`Canvas not available for frame ${frameIndex}`)
      }

      // 验证 Canvas 内容
      const imageData = canvasCtx.getImageData(0, 0, Math.min(10, offscreenCanvas.width), Math.min(10, offscreenCanvas.height))
      const hasContent = imageData.data.some(value => value > 0)

      if (!hasContent) {
        console.warn(`⚠️ [MP4-Export-Worker] Canvas appears empty for frame ${frameIndex}`)
      }

      // 添加当前 Canvas 状态到 CanvasSource
      try {
        console.log(`📦 [MP4-Export-Worker] Adding frame ${frameIndex} to CanvasSource...`)
        console.log(`📊 [MP4-Export-Worker] Canvas state: ${offscreenCanvas.width}×${offscreenCanvas.height}, hasContent: ${hasContent}`)

        await videoSource.add(timestamp, frameDuration)
        addedCount++
        console.log(`✅ [MP4-Export-Worker] Frame ${frameIndex} added successfully (total: ${addedCount})`)

        // 每10帧输出一次详细日志
        if (frameIndex % 10 === 0) {
          console.log(`📊 [MP4-Export-Worker] Progress: ${frameIndex + 1}/${totalFrames} frames, timestamp: ${timestamp.toFixed(3)}s, success rate: ${((addedCount/(frameIndex+1))*100).toFixed(1)}%`)
        }
      } catch (addError) {
        addErrors++
        console.error(`❌ [MP4-Export-Worker] Failed to add frame ${frameIndex} to CanvasSource:`, addError)
        console.error(`❌ [MP4-Export-Worker] Add error details:`, {
          frameIndex,
          timestamp,
          frameDuration,
          canvasSize: { width: offscreenCanvas?.width, height: offscreenCanvas?.height },
          hasContent,
          addErrors,
          addedCount,
          videoSourceType: typeof videoSource,
          errorMessage: (addError as Error).message || String(addError),
          errorStack: (addError as Error).stack
        })
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
      console.error(`❌ [MP4-Export-Worker] Request error details:`, {
        frameIndex,
        timestamp,
        requestErrors,
        addedCount,
        totalFrames
      })
      // 继续处理下一帧，不中断整个过程
    }
  }

  // 输出最终统计信息
  console.log('📊 [MP4-Export-Worker] Frame rendering completed:')
  console.log(`  ✅ Successfully added: ${addedCount}/${totalFrames} frames (${((addedCount/totalFrames)*100).toFixed(1)}%)`)
  console.log(`  ❌ Request errors: ${requestErrors}`)
  console.log(`  ❌ Add errors: ${addErrors}`)
  console.log(`  📈 Success rate: ${((addedCount/totalFrames)*100).toFixed(1)}%`)

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
async function requestCompositeFrame(frameIndex: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!compositeWorker) {
      console.error(`❌ [MP4-Export-Worker] Composite worker not available for frame ${frameIndex}`)
      reject(new Error('Composite worker not available'))
      return
    }

    console.log(`🔄 [MP4-Export-Worker] Requesting composite frame ${frameIndex}...`)

    // 设置临时消息处理器等待帧渲染完成
    const originalOnMessage = compositeWorker.onmessage
    const timeout = setTimeout(() => {
      console.error(`⏰ [MP4-Export-Worker] Frame ${frameIndex} rendering timeout (5s)`)
      compositeWorker!.onmessage = originalOnMessage
      reject(new Error(`Frame ${frameIndex} rendering timeout after 5 seconds`))
    }, 5000) // 5秒超时

    compositeWorker.onmessage = (event) => {
      const { type, data } = event.data

      if (type === 'frame' && data.frameIndex === frameIndex) {
        console.log(`✅ [MP4-Export-Worker] Received composite frame ${frameIndex}`)

        // 恢复原始消息处理器
        compositeWorker!.onmessage = originalOnMessage
        clearTimeout(timeout)

        // 处理接收到的帧
        try {
          handleCompositeFrame(data.bitmap, data.frameIndex)
          console.log(`✅ [MP4-Export-Worker] Frame ${frameIndex} handled successfully`)
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

    // 请求渲染指定帧
    console.log(`📤 [MP4-Export-Worker] Sending seek request for frame ${frameIndex}`)
    compositeWorker.postMessage({
      type: 'seek',
      data: { frameIndex }
    })
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
function handleCancel() {
  console.log('🛑 [MP4-Export-Worker] Export cancelled')
  shouldCancel = true
  cleanup()
}

/**
 * 清理资源
 */
function cleanup() {
  if (compositeWorker) {
    compositeWorker.terminate()
    compositeWorker = null
  }

  offscreenCanvas = null
  canvasCtx = null
  totalFrames = 0
  processedFrames = 0
  videoInfo = null
  isExporting = false
}

// Worker 初始化检查
console.log('🎥 [MP4-Export-Worker] MP4 Export Worker loaded')
console.log('🔍 [MP4-Export-Worker] Performing initialization checks...')

// 检查 Mediabunny 库
const mediabunnyStatus = checkMediabunnyStatus()
console.log('📦 [MP4-Export-Worker] Mediabunny status:', mediabunnyStatus)

// 检查 OffscreenCanvas 支持
const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined'
console.log('🎨 [MP4-Export-Worker] OffscreenCanvas support:', hasOffscreenCanvas)

// 检查 WebCodecs 支持
const hasWebCodecs = typeof VideoEncoder !== 'undefined'
console.log('🎬 [MP4-Export-Worker] WebCodecs support:', hasWebCodecs)

// 测试 H.264 尺寸验证
console.log('🔧 [MP4-Export-Worker] Testing H.264 dimension validation...')
const testCases = [
  { width: 719, height: 996, name: '奇数尺寸' },
  { width: 720, height: 996, name: '部分偶数' },
  { width: 720, height: 1000, name: '偶数但非16倍数' },
  { width: 8, height: 8, name: '过小尺寸' }
]

testCases.forEach(testCase => {
  const result = validateAndFixH264Dimensions(testCase.width, testCase.height)
  console.log(`  ${testCase.name} (${testCase.width}×${testCase.height}) → ${result.width}×${result.height} ${result.modified ? '(修正)' : '(无需修正)'}`)
})

console.log('✅ [MP4-Export-Worker] Initialization checks completed')
