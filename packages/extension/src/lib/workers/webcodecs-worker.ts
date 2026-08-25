// WebCodecs Worker - 在 Worker 中进行视频编码
// 这个 Worker 接收 VideoFrame 并使用 WebCodecs 进行编码

import { tryConfigureBestEncoder } from '../utils/webcodecs-config'

let encoder: VideoEncoder | null = null
let currentEncoderConfig: VideoEncoderConfig | null = null
const BACKPRESSURE_MAX = 8  // 背压控制：最大队列长度

// 处理主线程消息
self.onmessage = async (event) => {
  const { type, config, frame, keyFrame } = event.data

  switch (type) {
    case 'configure':
      await configureEncoder(config)
      break

    case 'encode':
      try {
        if (encoder && frame) {
          await encodeFrame(frame, keyFrame === true)
        } else {
          console.warn('⚠️ [WORKER] Cannot encode: encoder or frame missing')
          if (frame) try { frame.close() } catch {}
        }
      } finally {
        self.postMessage({ type: 'frame-done' })
      }
      break

    case 'stop':
      await stopEncoding()
      break

    default:
      console.warn('⚠️ [WORKER] Unknown message type:', type)
  }
}

// 配置编码器
async function configureEncoder(config: any) {
  try {

    // 检查 WebCodecs 支持
    const hasVideoEncoder = typeof VideoEncoder !== 'undefined'
    const hasEncodedVideoChunk = typeof EncodedVideoChunk !== 'undefined'
    const hasVideoFrame = typeof VideoFrame !== 'undefined'


    if (!hasVideoEncoder || !hasEncodedVideoChunk || !hasVideoFrame) {
      throw new Error('WebCodecs APIs not fully supported in this worker')
    }

    // Close any existing encoder before creating a new one (safe for reconfiguration)
    if (encoder) {
      try { encoder.close() } catch {}
      encoder = null
      currentEncoderConfig = null
    }

    // 创建编码器 (keep local until configured to prevent race conditions)
    const newEncoder = new VideoEncoder({
      output: handleEncodedChunk,
      error: handleEncodingError
    })

    // 使用共享工具进行统一的编解码器选择与探测
    const { applied, selectedCodec } = await tryConfigureBestEncoder(newEncoder, {
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
    // Assign to global only after successful configuration
    encoder = newEncoder
    currentEncoderConfig = applied


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
      throw new Error('Encoder not configured')
    }

    // ✅ 背压控制：如果队列过长则丢帧
    if (encoder.encodeQueueSize != null && encoder.encodeQueueSize > BACKPRESSURE_MAX) {
      console.warn(`⚠️ [WORKER] Backpressure: dropping frame (queue: ${encoder.encodeQueueSize})`)
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

  } catch (error) {
    console.error('❌ [WORKER] Frame encoding failed:', error)
    self.postMessage({
      type: 'error',
      data: (error as Error).message || 'Frame encoding failed'
    })
  } finally {
    try { frame.close() } catch {}
  }
}

// 处理编码后的数据块
function handleEncodedChunk(chunk: EncodedVideoChunk, metadata?: any) {
  try {
    // 将编码数据复制到 Uint8Array
    const data = new Uint8Array(chunk.byteLength)
    chunk.copyTo(data)

    // 🔧 关键帧检测：从 EncodedVideoChunk.type 获取
    const chunkType = chunk.type // 'key' or 'delta'
    const isKeyframe = chunkType === 'key'

    // 🔧 诊断日志：每个关键帧都记录
    if (isKeyframe) {
    }

    // ✅ 流式输出，不在 Worker 内累积
    // 直接发送给主线程，由 OPFS Writer 处理
    // 🔧 修复：使用 chunkType 变量确保类型正确传递
    ;(self as any).postMessage({
      type: 'chunk',
      data: {
        data: data, // 实际的编码数据
        size: chunk.byteLength,
        timestamp: chunk.timestamp,
        chunkType: chunkType, // 🔧 使用明确的字段名避免与外层 type 混淆
        isKeyframe: isKeyframe, // 🔧 额外添加布尔标记
        // 添加分辨率信息
        codedWidth: currentEncoderConfig?.width || 1920,
        codedHeight: currentEncoderConfig?.height || 1080,
        codec: (currentEncoderConfig as any)?.codec || 'auto'
      }
    }, [data.buffer])


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

      // 刷新编码器，等待所有pending帧编码完成
      await encoder.flush()

      const queueAfter = encoder.encodeQueueSize

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


// 立即发送初始化消息
self.postMessage({
  type: 'initialized',
  data: 'Worker is ready to receive messages'
})
