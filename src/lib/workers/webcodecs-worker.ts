// WebCodecs Worker - 在 Worker 中进行视频编码
// 这个 Worker 接收 VideoFrame 并使用 WebCodecs 进行编码

import { tryConfigureBestEncoder } from '../utils/webcodecs-config'

let encoder: VideoEncoder | null = null
let currentEncoderConfig: VideoEncoderConfig | null = null
const BACKPRESSURE_MAX = 8  // 背压控制：最大队列长度

// 处理主线程消息
self.onmessage = async (event) => {
  const { type, config, frame, keyFrame } = event.data
  console.log(`📨 [WORKER] Received message from main thread:`, { type, hasConfig: !!config, hasFrame: !!frame, keyFrame: keyFrame === true })

  switch (type) {
    case 'configure':
      console.log('⚙️ [WORKER] Configuring encoder...')
      await configureEncoder(config)
      break

    case 'encode':
      if (encoder && frame) {
        await encodeFrame(frame, keyFrame === true)
      } else {
        console.warn('⚠️ [WORKER] Cannot encode: encoder or frame missing')
      }
      break

    case 'stop':
      console.log('🛑 [WORKER] Stopping encoding...')
      await stopEncoding()
      break

    default:
      console.warn('⚠️ [WORKER] Unknown message type:', type)
  }
}

// 配置编码器
async function configureEncoder(config: any) {
  try {
    console.log('🔧 [WORKER] Starting encoder configuration...')
    console.log('🔧 [WORKER] Received config:', config)

    // 检查 WebCodecs 支持
    console.log('🔍 [WORKER] Checking WebCodecs APIs availability...')
    const hasVideoEncoder = typeof VideoEncoder !== 'undefined'
    const hasEncodedVideoChunk = typeof EncodedVideoChunk !== 'undefined'
    const hasVideoFrame = typeof VideoFrame !== 'undefined'

    console.log('🔍 [WORKER] VideoEncoder available:', hasVideoEncoder)
    console.log('🔍 [WORKER] EncodedVideoChunk available:', hasEncodedVideoChunk)
    console.log('🔍 [WORKER] VideoFrame available:', hasVideoFrame)

    if (!hasVideoEncoder || !hasEncodedVideoChunk || !hasVideoFrame) {
      throw new Error('WebCodecs APIs not fully supported in this worker')
    }
    console.log('✅ [WORKER] All WebCodecs APIs are available')

    // 创建编码器
    console.log('🏗️ [WORKER] Creating VideoEncoder instance...')
    encoder = new VideoEncoder({
      output: handleEncodedChunk,
      error: handleEncodingError
    })
    console.log('✅ [WORKER] VideoEncoder instance created')

    // 使用共享工具进行统一的编解码器选择与探测
    console.log('🔍 [WORKER] Selecting best codec via shared utils...')
    const { applied, selectedCodec } = await tryConfigureBestEncoder(encoder, {
      codec: config?.codec ?? 'auto',
      width: config?.width ?? 1920,
      height: config?.height ?? 1080,
      framerate: config?.framerate ?? 30,
      bitrate: config?.bitrate,
      latencyMode: config?.latencyMode,
      hardwareAcceleration: config?.hardwareAcceleration,
      bitrateMode: config?.bitrateMode,
    })

    // 保存最终配置（注意：tryConfigureBestEncoder 内部已完成 encoder.configure）
    currentEncoderConfig = applied

    console.log('🎉 [WORKER] ✅ WebCodecs encoder configured via shared utils!', { codec: selectedCodec, config: applied })

    // 通知主线程配置成功（统一包含最终 codec 字段）
    self.postMessage({
      type: 'configured',
      config: { ...applied, codec: selectedCodec }
    })

  } catch (error) {
    console.error('❌ [WORKER] Encoder configuration failed:', error)
    self.postMessage({
      type: 'error',
      data: (error as Error).message || 'Configuration failed'
    })
  }
}

// 编码帧（支持外部控制关键帧）
async function encodeFrame(frame: VideoFrame, forceKey: boolean = false) {
  try {
    if (!encoder) {
      frame.close()
      throw new Error('Encoder not configured')
    }

    // ✅ 背压控制：如果队列过长则丢帧
    if (encoder.encodeQueueSize != null && encoder.encodeQueueSize > BACKPRESSURE_MAX) {
      console.warn(`⚠️ [WORKER] Backpressure: dropping frame (queue: ${encoder.encodeQueueSize})`)
      frame.close()
      return
    }

    // 调试：检查源帧与编码器配置的宽高/比例是否匹配
    try {
      const fw = (frame as any).displayWidth || (frame as any).codedWidth
      const fh = (frame as any).displayHeight || (frame as any).codedHeight
      if (fw && fh && currentEncoderConfig?.width && currentEncoderConfig?.height) {
        const srcAR = fw / fh
        const encAR = currentEncoderConfig.width / currentEncoderConfig.height
        const diff = Math.abs(srcAR - encAR)
        if (diff > 0.02) {
          console.warn(`⚠️ [WORKER] Aspect ratio mismatch: src ${fw}x${fh} (${srcAR.toFixed(3)}) vs enc ${currentEncoderConfig.width}x${currentEncoderConfig.height} (${encAR.toFixed(3)})`)
        }
      }
    } catch {}

    // 编码帧（与元素/区域策略一致：由调用方控制是否关键帧）
    encoder.encode(frame, { keyFrame: forceKey === true })

    // 关闭帧以释放内存
    frame.close()

  } catch (error) {
    console.error('❌ [WORKER] Frame encoding failed:', error)
    self.postMessage({
      type: 'error',
      data: (error as Error).message || 'Frame encoding failed'
    })
  }
}

// 处理编码后的数据块
function handleEncodedChunk(chunk: EncodedVideoChunk, metadata?: any) {
  try {
    // 将编码数据复制到 Uint8Array
    const data = new Uint8Array(chunk.byteLength)
    chunk.copyTo(data)

    // ✅ 流式输出，不在 Worker 内累积
    // 直接发送给主线程，由 OPFS Writer 处理
    self.postMessage({
      type: 'chunk',
      data: {
        data: data, // 实际的编码数据
        size: chunk.byteLength,
        timestamp: chunk.timestamp,
        type: chunk.type,
        // 添加分辨率信息
        codedWidth: currentEncoderConfig?.width || 1920,
        codedHeight: currentEncoderConfig?.height || 1080,
        codec: (currentEncoderConfig as any)?.codec || 'auto'
      }
    })

    console.log(`📦 Encoded chunk: ${chunk.byteLength} bytes, type: ${chunk.type}, resolution: ${currentEncoderConfig?.width || 1920}x${currentEncoderConfig?.height || 1080}`)

  } catch (error) {
    console.error('❌ [WORKER] Chunk handling failed:', error)
    self.postMessage({
      type: 'error',
      data: (error as Error).message || 'Chunk handling failed'
    })
  }
}

// 处理编码错误
function handleEncodingError(error: Error) {
  console.error('❌ Encoding error:', error)
  self.postMessage({
    type: 'error',
    data: error.message
  })
}

// 停止编码
async function stopEncoding() {
  try {
    if (encoder) {
      const queueBefore = encoder.encodeQueueSize
      console.log(`🛑 [WORKER] Flushing encoder (queue: ${queueBefore})...`)

      // 刷新编码器，等待所有pending帧编码完成
      await encoder.flush()

      const queueAfter = encoder.encodeQueueSize
      console.log(`✅ [WORKER] Encoder flushed (queue: ${queueAfter})`)

      if (queueAfter > 0) {
        console.warn(`⚠️ [WORKER] Queue not empty after flush: ${queueAfter}`)
      }

      encoder.close()
      encoder = null
    }

    // ✅ 不再合并数据块，所有chunks已流式发送到主线程
    // 主线程通过OPFS Writer实时写入，无需在此累积

    // 通知主线程编码完成（不再发送finalData）
    self.postMessage({
      type: 'complete'
    })

    console.log('✅ [WORKER] WebCodecs encoding completed')

  } catch (error) {
    console.error('❌ [WORKER] Stop encoding failed:', error)
    self.postMessage({
      type: 'error',
      data: (error as Error).message || 'Stop encoding failed'
    })
  }
}

// Worker 错误处理
self.onerror = (error) => {
  console.error('❌ [WORKER] Worker error:', error)
  self.postMessage({
    type: 'error',
    data: typeof error === 'string' ? error : 'Unknown worker error'
  })
}

console.log('🔧 [WORKER] WebCodecs Worker initialized')

// 立即发送初始化消息
self.postMessage({
  type: 'initialized',
  data: 'Worker is ready to receive messages'
})
