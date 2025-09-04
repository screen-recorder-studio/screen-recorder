// WebCodecs Worker - 在 Worker 中进行视频编码
// 这个 Worker 接收 VideoFrame 并使用 WebCodecs 进行编码

let encoder: VideoEncoder | null = null
let chunks: Uint8Array[] = []

// 处理主线程消息
self.onmessage = async (event) => {
  const { type, config, frame } = event.data
  console.log(`📨 [WORKER] Received message from main thread:`, { type, hasConfig: !!config, hasFrame: !!frame })

  switch (type) {
    case 'configure':
      console.log('⚙️ [WORKER] Configuring encoder...')
      await configureEncoder(config)
      break

    case 'encode':
      if (encoder && frame) {
        await encodeFrame(frame)
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

    // 尝试多种编解码器配置，从最兼容的开始（基于 MDN 文档）
    const codecConfigs = [
      // VP8 - 最兼容，简单字符串
      {
        codec: 'vp8',
        width: config.width || 1920,
        height: config.height || 1080,
        bitrate: config.bitrate || 8000000,
        framerate: config.framerate || 30
      },
      // H.264 Baseline Profile - 广泛支持
      {
        codec: 'avc1.42001E',
        width: config.width || 1920,
        height: config.height || 1080,
        bitrate: config.bitrate || 8000000,
        framerate: config.framerate || 30
      },
      // VP9 - 如果支持的话
      {
        codec: 'vp09.00.10.08',
        width: config.width || 1920,
        height: config.height || 1080,
        bitrate: config.bitrate || 8000000,
        framerate: config.framerate || 30
      }
    ]

    let encoderConfig: VideoEncoderConfig | null = null
    let supportedCodec = ''

    // 逐个尝试编解码器配置，直到找到支持的
    console.log('🔍 [WORKER] Testing codec configurations...')
    for (let i = 0; i < codecConfigs.length; i++) {
      const testConfig = codecConfigs[i]
      console.log(`🔍 [WORKER] Testing codec ${i + 1}/${codecConfigs.length}: ${testConfig.codec}`)

      try {
        const supportResult = await VideoEncoder.isConfigSupported(testConfig)
        console.log(`🔍 [WORKER] Support result for ${testConfig.codec}:`, supportResult)

        if (supportResult.supported) {
          encoderConfig = testConfig
          supportedCodec = testConfig.codec
          console.log(`✅ [WORKER] Found supported codec: ${supportedCodec}`)
          break
        } else {
          console.log(`❌ [WORKER] Codec ${testConfig.codec} not supported`)
        }
      } catch (error) {
        console.log(`❌ [WORKER] Error testing codec ${testConfig.codec}:`, error)
        continue
      }
    }

    // 检查是否找到了支持的配置
    if (!encoderConfig) {
      throw new Error('No supported video codec configuration found')
    }

    console.log('⚙️ [WORKER] Using encoder configuration:', encoderConfig)

    console.log('🔧 [WORKER] Applying configuration to encoder...')
    encoder.configure(encoderConfig)

    console.log('🎉 [WORKER] ✅ WebCodecs encoder configured successfully!')

    // 通知主线程配置成功
    self.postMessage({
      type: 'configured',
      config: encoderConfig
    })

  } catch (error) {
    console.error('❌ [WORKER] Encoder configuration failed:', error)
    self.postMessage({
      type: 'error',
      data: (error as Error).message || 'Configuration failed'
    })
  }
}

// 编码帧
async function encodeFrame(frame: VideoFrame) {
  try {
    if (!encoder) {
      throw new Error('Encoder not configured')
    }

    // 编码帧
    encoder.encode(frame, { keyFrame: false })
    
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
    
    chunks.push(data)
    
    // 通知主线程收到数据块（包含实际数据）
    self.postMessage({
      type: 'chunk',
      data: {
        data: data, // 实际的编码数据
        size: chunk.byteLength,
        timestamp: chunk.timestamp,
        type: chunk.type,
        totalChunks: chunks.length
      }
    })

    console.log(`📦 Encoded chunk: ${chunk.byteLength} bytes, type: ${chunk.type}`)

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
      // 刷新编码器
      await encoder.flush()
      encoder.close()
      encoder = null
    }

    // 合并所有数据块
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const finalData = new Uint8Array(totalSize)
    
    let offset = 0
    for (const chunk of chunks) {
      finalData.set(chunk, offset)
      offset += chunk.length
    }

    // 通知主线程编码完成
    self.postMessage({
      type: 'complete',
      data: finalData
    }, { transfer: [finalData.buffer] })

    console.log('✅ WebCodecs encoding completed')
    
    // 清理
    chunks = []

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
