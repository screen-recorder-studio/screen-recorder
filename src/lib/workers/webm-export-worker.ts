// WebM 导出 Worker - 处理编辑后视频的 WebM 格式导出
import type { EncodedChunk, ExportOptions, BackgroundConfig } from '../types/background'

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
        console.warn('⚠️ [WebM-Worker] Unknown message type:', type)
    }
  } catch (error) {
    console.error('❌ [WebM-Worker] Error processing message:', error)
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
    console.log('🎬 [WebM-Worker] Starting WebM export')
    console.log('📊 [WebM-Worker] Input chunks:', exportData.chunks.length)
    console.log('⚙️ [WebM-Worker] Export options:', exportData.options)

    const { chunks, options } = exportData

    // 更新进度：准备阶段
    updateProgress({
      stage: 'preparing',
      progress: 0,
      currentFrame: 0,
      totalFrames: chunks.length
    })

    let finalChunks = chunks

    // 如果需要背景合成，先进行合成处理
    if (options.includeBackground && options.backgroundConfig) {
      console.log('🎨 [WebM-Worker] Starting background composition')
      finalChunks = await composeWithBackground(chunks, options.backgroundConfig)
      
      if (shouldCancel) return
    }

    // 创建 WebM 容器
    console.log('📦 [WebM-Worker] Creating WebM container')
    const webmBlob = await createWebMContainer(finalChunks, options)

    if (shouldCancel) return

    // 完成导出
    console.log('✅ [WebM-Worker] WebM export completed')
    self.postMessage({
      type: 'complete',
      data: { blob: webmBlob }
    })

  } catch (error) {
    console.error('❌ [WebM-Worker] Export failed:', error)
    self.postMessage({
      type: 'error',
      data: { error: (error as Error).message }
    })
  } finally {
    isExporting = false
  }
}

/**
 * 背景合成处理
 */
async function composeWithBackground(
  chunks: EncodedChunk[],
  backgroundConfig: BackgroundConfig
): Promise<EncodedChunk[]> {
  
  console.log('🎨 [WebM-Worker] Compositing with background:', backgroundConfig.type)
  
  // 更新进度：合成阶段
  updateProgress({
    stage: 'compositing',
    progress: 10,
    currentFrame: 0,
    totalFrames: chunks.length
  })

  // 创建合成 Worker（嵌套 Worker）
  const compositeWorker = new Worker(
    new URL('./video-composite-worker.ts', import.meta.url),
    { type: 'module' }
  )

  return new Promise((resolve, reject) => {
    const compositedChunks: EncodedChunk[] = []
    let processedFrames = 0

    compositeWorker.onmessage = (event) => {
      const { type, data } = event.data

      switch (type) {
        case 'initialized':
          // 开始合成处理
          compositeWorker.postMessage({
            type: 'process',
            data: {
              chunks: chunks.map(chunk => ({
                data: chunk.data.buffer.slice(chunk.data.byteOffset, chunk.data.byteOffset + chunk.data.byteLength),
                timestamp: chunk.timestamp,
                type: chunk.type,
                size: chunk.size,
                codedWidth: chunk.codedWidth,
                codedHeight: chunk.codedHeight,
                codec: chunk.codec
              })),
              backgroundConfig
            }
          }, { transfer: chunks.map(chunk => chunk.data.buffer) })
          break

        case 'frame':
          // 收到合成后的帧，需要重新编码
          processedFrames++
          
          // 更新合成进度
          const compositeProgress = 10 + (processedFrames / chunks.length) * 40
          updateProgress({
            stage: 'compositing',
            progress: compositeProgress,
            currentFrame: processedFrames,
            totalFrames: chunks.length
          })
          
          // TODO: 将合成后的 ImageBitmap 重新编码为 EncodedChunk
          // 这里需要使用 VideoEncoder 重新编码
          break

        case 'ready':
          // 合成准备完成，开始处理
          console.log('🎨 [WebM-Worker] Composite worker ready')
          break

        case 'complete':
          console.log('✅ [WebM-Worker] Background composition completed')
          compositeWorker.terminate()
          
          // 暂时返回原始块（实际应该返回重新编码的块）
          // TODO: 实现完整的重新编码流程
          resolve(chunks)
          break

        case 'error':
          console.error('❌ [WebM-Worker] Composite error:', data)
          compositeWorker.terminate()
          reject(new Error(data))
          break
      }
    }

    compositeWorker.onerror = (error) => {
      console.error('❌ [WebM-Worker] Composite worker error:', error)
      compositeWorker.terminate()
      reject(new Error('Composite worker failed'))
    }

    // 初始化合成 Worker
    compositeWorker.postMessage({ type: 'init' })
  })
}

/**
 * 创建 WebM 容器
 */
async function createWebMContainer(
  chunks: EncodedChunk[],
  options: ExportOptions
): Promise<Blob> {
  
  console.log('📦 [WebM-Worker] Creating WebM container with', chunks.length, 'chunks')
  
  // 更新进度：封装阶段
  updateProgress({
    stage: 'muxing',
    progress: 60,
    currentFrame: 0,
    totalFrames: chunks.length
  })

  try {
    // 创建 WebM 头部
    const header = createWebMHeader(options)
    
    // 处理所有数据块
    const dataSegments: Uint8Array[] = []
    let totalSize = header.byteLength

    for (let i = 0; i < chunks.length; i++) {
      if (shouldCancel) throw new Error('Export cancelled')

      const chunk = chunks[i]
      
      // 创建 WebM 帧数据
      const frameData = createWebMFrame(chunk, i)
      dataSegments.push(frameData)
      totalSize += frameData.byteLength

      // 更新封装进度
      const muxProgress = 60 + ((i + 1) / chunks.length) * 30
      updateProgress({
        stage: 'muxing',
        progress: muxProgress,
        currentFrame: i + 1,
        totalFrames: chunks.length,
        fileSize: totalSize
      })
    }

    // 更新进度：完成阶段
    updateProgress({
      stage: 'finalizing',
      progress: 95,
      currentFrame: chunks.length,
      totalFrames: chunks.length,
      fileSize: totalSize
    })

    // 合并所有数据
    const webmData = new Uint8Array(totalSize)
    let offset = 0

    // 复制头部
    webmData.set(header, offset)
    offset += header.byteLength

    // 复制所有帧数据
    for (const segment of dataSegments) {
      webmData.set(segment, offset)
      offset += segment.byteLength
    }

    console.log('📦 [WebM-Worker] WebM container created, size:', webmData.byteLength, 'bytes')

    // 最终进度
    updateProgress({
      stage: 'finalizing',
      progress: 100,
      currentFrame: chunks.length,
      totalFrames: chunks.length,
      fileSize: webmData.byteLength
    })

    return new Blob([webmData], { type: 'video/webm' })

  } catch (error) {
    console.error('❌ [WebM-Worker] Container creation failed:', error)
    throw error
  }
}

/**
 * 创建 WebM 头部
 */
function createWebMHeader(options: ExportOptions): Uint8Array {
  const resolution = options.resolution || { width: 1920, height: 1080 }
  
  // 简化的 WebM 头部（EBML + Segment + Info + Tracks）
  return new Uint8Array([
    // EBML Header
    0x1A, 0x45, 0xDF, 0xA3, // EBML
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F, // Size
    0x42, 0x86, 0x81, 0x01, // EBMLVersion = 1
    0x42, 0xF7, 0x81, 0x01, // EBMLReadVersion = 1
    0x42, 0xF2, 0x81, 0x04, // EBMLMaxIDLength = 4
    0x42, 0xF3, 0x81, 0x08, // EBMLMaxSizeLength = 8
    0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D, // DocType = "webm"
    0x42, 0x87, 0x81, 0x04, // DocTypeVersion = 4
    0x42, 0x85, 0x81, 0x02, // DocTypeReadVersion = 2

    // Segment
    0x18, 0x53, 0x80, 0x67, // Segment
    0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // Size (unknown)

    // Info
    0x15, 0x49, 0xA9, 0x66, // Info
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x15, // Size
    0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40, // TimecodeScale = 1000000
    0x4D, 0x80, 0x84, 0x57, 0x65, 0x62, 0x4D, // MuxingApp = "WebM"

    // Tracks
    0x16, 0x54, 0xAE, 0x6B, // Tracks
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2F, // Size

    // TrackEntry
    0xAE, // TrackEntry
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2C, // Size
    0xD7, 0x81, 0x01, // TrackNumber = 1
    0x73, 0xC5, 0x81, 0x01, // TrackUID = 1
    0x83, 0x81, 0x01, // TrackType = 1 (video)
    0x86, 0x84, 0x56, 0x50, 0x38, 0x30, // CodecID = "VP80"

    // Video
    0xE0, // Video
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, // Size
    0xB0, 0x82, (resolution.width >> 8) & 0xFF, resolution.width & 0xFF, // PixelWidth
    0xBA, 0x82, (resolution.height >> 8) & 0xFF, resolution.height & 0xFF, // PixelHeight
  ])
}

/**
 * 创建 WebM 帧数据
 */
function createWebMFrame(chunk: EncodedChunk, frameIndex: number): Uint8Array {
  // 简化的帧封装（实际应该包含完整的 WebM 块结构）
  const frameHeader = new Uint8Array([
    // SimpleBlock 或 Block 头部
    0xA3, // SimpleBlock
    // Size (动态计算)
    ...encodeSize(chunk.data.byteLength + 4),
    // Track number
    0x81,
    // Timestamp (相对于 Cluster)
    (chunk.timestamp >> 8) & 0xFF, chunk.timestamp & 0xFF,
    // Flags
    chunk.type === 'key' ? 0x80 : 0x00
  ])

  // 合并头部和数据
  const frameData = new Uint8Array(frameHeader.byteLength + chunk.data.byteLength)
  frameData.set(frameHeader, 0)
  frameData.set(chunk.data, frameHeader.byteLength)

  return frameData
}

/**
 * 编码 EBML 大小
 */
function encodeSize(size: number): number[] {
  if (size < 0x7F) {
    return [0x80 | size]
  } else if (size < 0x3FFF) {
    return [0x40 | (size >> 8), size & 0xFF]
  } else if (size < 0x1FFFFF) {
    return [0x20 | (size >> 16), (size >> 8) & 0xFF, size & 0xFF]
  } else {
    return [0x10 | (size >> 24), (size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF]
  }
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
  console.log('🛑 [WebM-Worker] Export cancelled')
  shouldCancel = true
  isExporting = false
}

console.log('🎬 [WebM-Worker] WebM Export Worker loaded')
