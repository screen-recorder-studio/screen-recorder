// MP4 导出 Worker - 协调视频合成和 MP4 导出
// 使用 video-composite-worker 进行合成，然后用 Mediabunny 导出 MP4
import type { EncodedChunk, ExportOptions } from '../types/background'
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

// 合成状态
let totalFrames = 0
let processedFrames = 0
let videoInfo: { width: number, height: number, frameRate: number } | null = null

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
 * 创建 OffscreenCanvas
 */
function createOffscreenCanvas(width: number, height: number) {
  offscreenCanvas = new OffscreenCanvas(width, height)
  canvasCtx = offscreenCanvas.getContext('2d')

  if (!canvasCtx) {
    throw new Error('Failed to get 2D context from OffscreenCanvas')
  }

  console.log('🎨 [MP4-Export-Worker] OffscreenCanvas created:', { width, height })
}

/**
 * 处理视频合成
 */
async function processVideoComposition(chunks: EncodedChunk[], options: ExportOptions): Promise<void> {
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
    // 将 ImageBitmap 绘制到 Canvas
    canvasCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height)
    canvasCtx.drawImage(bitmap, 0, 0)

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
 * 导出 MP4
 */
async function exportToMP4(options: ExportOptions): Promise<Blob> {
  if (!offscreenCanvas || !videoInfo) {
    throw new Error('Canvas or video info not available')
  }

  console.log('🎬 [MP4-Export-Worker] Starting Mediabunny export')

  try {
    // 更新进度：编码阶段
    updateProgress({
      stage: 'encoding',
      progress: 75,
      currentFrame: 0,
      totalFrames: 100
    })

    // 创建 Mediabunny 输出
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget()
    })

    // 创建 CanvasSource（为 MP4 显式指定 H.264 与分辨率/帧率）
    const videoSource = new CanvasSource(offscreenCanvas, {
      codec: 'avc',
      bitrate: options.bitrate || 8000000
    })

    // 添加视频轨道
    output.addVideoTrack(videoSource)

    // 启动输出
    await output.start()
    console.log('✅ [MP4-Export-Worker] Mediabunny output started')

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
    const addedFrames = await renderFramesForExport(videoSource, frameDuration)
    if (!addedFrames) {
      throw new Error('未成功向 H.264 编码器添加任何帧（可能浏览器不支持 H.264 编码或被策略禁用）。')
    }

    // 完成输出
    updateProgress({
      stage: 'finalizing',
      progress: 95,
      currentFrame: totalFrames,
      totalFrames
    })

    await output.finalize()
    console.log('✅ [MP4-Export-Worker] Mediabunny output finalized')

    // 获取结果
    const buffer = output.target.buffer
    if (!buffer) {
      throw new Error('No buffer data available from Mediabunny output')
    }

    const mp4Blob = new Blob([buffer], { type: 'video/mp4' })

    console.log('✅ [MP4-Export-Worker] MP4 export completed, size:', buffer.byteLength)

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

  let addedCount = 0

  // 逐帧请求合成并添加到 CanvasSource
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    if (shouldCancel) break

    const timestamp = frameIndex * frameDuration

    try {
      // 请求 composite worker 渲染指定帧
      await requestCompositeFrame(frameIndex)

      // 等待一帧时间确保渲染完成
      await new Promise(resolve => setTimeout(resolve, 16))

      // 添加当前 Canvas 状态到 CanvasSource
      await videoSource.add(timestamp, frameDuration)
      addedCount++

      // 更新进度
      const progress = 80 + (frameIndex / totalFrames) * 15 // 80%-95%
      updateProgress({
        stage: 'muxing',
        progress,
        currentFrame: frameIndex + 1,
        totalFrames
      })

      // 每10帧输出一次日志
      if (frameIndex % 10 === 0) {
        console.log(`📊 [MP4-Export-Worker] Added frame ${frameIndex + 1}/${totalFrames}, timestamp: ${timestamp.toFixed(3)}s`)
      }

    } catch (error) {
      console.error(`❌ [MP4-Export-Worker] Failed to add frame ${frameIndex}:`, error)
      // 继续处理下一帧，不中断整个过程
    }
  }

  console.log('✅ [MP4-Export-Worker] All frames added to CanvasSource')
  return addedCount
}

/**
 * 请求 composite worker 渲染指定帧
 */
async function requestCompositeFrame(frameIndex: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!compositeWorker) {
      reject(new Error('Composite worker not available'))
      return
    }

    // 设置临时消息处理器等待帧渲染完成
    const originalOnMessage = compositeWorker.onmessage
    const timeout = setTimeout(() => {
      compositeWorker!.onmessage = originalOnMessage
      reject(new Error(`Frame ${frameIndex} rendering timeout`))
    }, 5000) // 5秒超时

    compositeWorker.onmessage = (event) => {
      const { type, data } = event.data

      if (type === 'frame' && data.frameIndex === frameIndex) {
        // 恢复原始消息处理器
        compositeWorker!.onmessage = originalOnMessage
        clearTimeout(timeout)

        // 处理接收到的帧
        handleCompositeFrame(data.bitmap, data.frameIndex)
        resolve()
      } else {
        // 转发其他消息
        if (originalOnMessage && compositeWorker) {
          originalOnMessage.call(compositeWorker, event)
        }
      }
    }

    // 请求渲染指定帧
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

console.log('🎥 [MP4-Export-Worker] MP4 Export Worker loaded')
