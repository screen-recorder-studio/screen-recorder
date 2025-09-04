<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { ChromeAPIWrapper } from '$lib/utils/chrome-api'
  import { Play, Square, RotateCcw, TriangleAlert, CircleCheck, Clock, Activity, Cpu, HardDrive } from '@lucide/svelte'

  // 引入 Worker 系统
  import { recordingService } from '$lib/services/recording-service'
  import { recordingStore } from '$lib/stores/recording.svelte'
  import type { RecordingOptions } from '$lib/types/recording'
  import VideoPreview from '$lib/components/VideoPreview.svelte'
  import VideoPreviewComposite from '$lib/components/VideoPreviewComposite.svelte'

  // 录制状态
  let isRecording = $state(false)
  let duration = $state(0)
  let status = $state<'idle' | 'requesting' | 'recording' | 'stopping' | 'error'>('idle')
  let errorMessage = $state('')

  // 录制相关变量
  let mediaRecorder: MediaRecorder | null = null
  let recordedChunks: Blob[] = []
  let stream: MediaStream | null = null
  let durationTimer: number | null = null
  let startTime: number | null = null

  // Svelte 5 $state 测试
  let testCounter = $state(0)
  let testMessage = $state('Svelte 5 状态测试')
  let testArray = $state([1, 2, 3])
  let testObject = $state({ name: 'Test', value: 42 })

  // $derived 测试
  const doubledCounter = $derived(testCounter * 2)
  const arrayLength = $derived(testArray.length)
  const formattedMessage = $derived(`${testMessage} - 计数器: ${testCounter}`)

  // Worker 系统状态
  let workerSystemReady = $state(false)
  let workerEnvironmentIssues = $state<string[]>([])
  let showWorkerDetails = $state(false)
  let showAdvancedOptions = $state(false)

  // Worker 录制数据收集
  let workerEncodedChunks = $state<any[]>([])
  let workerRecordingActive = false
  let workerCurrentWorker: Worker | null = null

  // 视频预览相关
  let videoPreviewRef: any = null
  let isDecodingVideo = $state(false)

  // 视频预览控制
  function getVideoPreviewControls() {
    return videoPreviewRef?.getControls?.() || null
  }

  // 处理录制完成后的视频预览
  async function handleVideoPreview(chunks: any[]): Promise<void> {
    try {
      console.log('🎨 [VideoPreview] Preparing video preview with', chunks.length, 'chunks')
      isDecodingVideo = true

      // VideoPreview 组件会自动处理解码和渲染
      // 这里只需要设置状态，组件会响应 encodedChunks 的变化

    } catch (error) {
      console.error('❌ [VideoPreview] Error preparing video preview:', error)
      isDecodingVideo = false
    }
  }

  // 直接使用 WebCodecs 编码数据创建 WebM（备用方案）
  async function createWebMFromEncodedChunks(chunks: any[]): Promise<Blob | null> {
    try {
      console.log('� [WEBM-CREATOR] Creating WebM from encoded chunks...')

      // 创建一个更完整的 WebM 文件结构
      const webmData = await createCompleteWebM(chunks)

      if (webmData) {
        console.log('🔧 [WEBM-CREATOR] WebM file created successfully, size:', webmData.size, 'bytes')
        return webmData
      } else {
        throw new Error('Failed to create WebM from chunks')
      }
    } catch (error) {
      console.error('🔧 [WEBM-CREATOR] Failed to create WebM:', error)
      return null
    }
  }

  // 创建完整的 WebM 文件（包含正确的头部和数据）
  async function createCompleteWebM(chunks: any[]): Promise<Blob | null> {
    try {
      console.log('🔧 [WEBM-COMPLETE] Creating complete WebM structure...')

      // 收集所有编码数据
      const allData = chunks.map(chunk => new Uint8Array(chunk.data))
      const totalSize = allData.reduce((sum, data) => sum + data.byteLength, 0)

      console.log('🔧 [WEBM-COMPLETE] Total encoded data:', totalSize, 'bytes')

      // 创建 WebM 头部（更完整的版本）
      const webmHeader = createWebMHeader()

      // 创建完整文件
      const completeFile = new Uint8Array(webmHeader.byteLength + totalSize)
      let offset = 0

      // 复制头部
      completeFile.set(webmHeader, offset)
      offset += webmHeader.byteLength

      // 复制所有编码数据
      for (const data of allData) {
        completeFile.set(data, offset)
        offset += data.byteLength
      }

      console.log('🔧 [WEBM-COMPLETE] Complete WebM file size:', completeFile.byteLength, 'bytes')

      return new Blob([completeFile], { type: 'video/webm' })
    } catch (error) {
      console.error('� [WEBM-COMPLETE] Error creating complete WebM:', error)
      return null
    }
  }

  // 创建 WebM 头部
  function createWebMHeader(): Uint8Array {
    // 更完整的 WebM 头部，包含必要的元数据
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
      0xB0, 0x82, 0x07, 0x80, // PixelWidth = 1920
      0xBA, 0x82, 0x04, 0x38, // PixelHeight = 1080
    ])
  }

  // 创建简单的 WebM 文件（基本容器格式）
  async function createWebMWriter(chunks: any[]) {
    console.log('🔧 [WEBM-WRITER] Creating WebM container for', chunks.length, 'chunks')

    // 简化的 WebM 头部（EBML + Segment + Info + Tracks）
    const webmHeader = new Uint8Array([
      // EBML Header
      0x1A, 0x45, 0xDF, 0xA3, // EBML
      0x9F, // Size (unknown)
      0x42, 0x86, 0x81, 0x01, // EBMLVersion = 1
      0x42, 0xF7, 0x81, 0x01, // EBMLReadVersion = 1
      0x42, 0xF2, 0x81, 0x04, // EBMLMaxIDLength = 4
      0x42, 0xF3, 0x81, 0x08, // EBMLMaxSizeLength = 8
      0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D, // DocType = "webm"
      0x42, 0x87, 0x81, 0x02, // DocTypeVersion = 2
      0x42, 0x85, 0x81, 0x02, // DocTypeReadVersion = 2

      // Segment
      0x18, 0x53, 0x80, 0x67, // Segment
      0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // Size (unknown)
    ])

    // 将所有编码数据合并
    const allChunkData = chunks.map(chunk => chunk.data)
    const totalDataSize = allChunkData.reduce((sum, data) => sum + data.byteLength, 0)

    console.log('🔧 [WEBM-WRITER] Total data size:', totalDataSize, 'bytes')

    // 创建完整的 WebM 文件
    const webmFile = new Uint8Array(webmHeader.byteLength + totalDataSize)
    let offset = 0

    // 复制头部
    webmFile.set(webmHeader, offset)
    offset += webmHeader.byteLength

    // 复制所有编码数据
    for (const data of allChunkData) {
      webmFile.set(new Uint8Array(data), offset)
      offset += data.byteLength
    }

    console.log('🔧 [WEBM-WRITER] WebM file created, total size:', webmFile.byteLength, 'bytes')

    return {
      complete() {
        return new Blob([webmFile], { type: 'video/webm' })
      }
    }
  }

  // 录制选项
  let recordingOptions = $state<RecordingOptions>({
    includeAudio: false,
    videoQuality: 'medium',
    maxDuration: 3600,
    preferredEngine: 'mediarecorder',
    codec: 'vp9',
    framerate: 30,
    useWorkers: true
  })

  // Worker 系统的计算属性
  const workerIsRecording = $derived(recordingStore.isRecording)
  const workerStatus = $derived(recordingStore.state.status)
  const workerDuration = $derived(recordingStore.state.duration)
  const workerErrorMessage = $derived(recordingStore.state.error)
  const workerProgress = $derived(recordingStore.state.progress)
  const workerFormattedDuration = $derived(recordingStore.formattedDuration)
  const workerFormattedFileSize = $derived(recordingStore.formattedFileSize)
  const workerFormattedBitrate = $derived(recordingStore.formattedBitrate)

  // 测试函数
  function incrementCounter() {
    testCounter++
  }

  function addToArray() {
    testArray.push(testArray.length + 1)
  }

  function updateObject() {
    testObject.value = Math.floor(Math.random() * 100)
  }

  function resetTests() {
    testCounter = 0
    testMessage = 'Svelte 5 状态测试'
    testArray = [1, 2, 3]
    testObject = { name: 'Test', value: 42 }
  }

  // Worker 系统函数 - 正确的 WebCodecs 架构
  async function startWorkerRecording() {
    try {
      console.log('🎬 [WORKER-MAIN] Starting Worker recording with WebCodecs...')

      // 1. 获取媒体流（主线程）
      console.log('📺 [WORKER-MAIN] Step 1: Requesting desktop capture...')
      const streamId = await requestDesktopCapture()
      if (!streamId) {
        throw new Error('DESKTOP_CAPTURE_CANCELLED')
      }
      console.log('✅ [WORKER-MAIN] Desktop capture granted, streamId:', streamId)

      console.log('🎥 [WORKER-MAIN] Step 2: Getting MediaStream from streamId...')
      const stream = await getUserMediaFromStreamId(streamId)
      if (!stream) {
        throw new Error('无法获取媒体流')
      }
      console.log('✅ [WORKER-MAIN] MediaStream obtained:', {
        id: stream.id,
        active: stream.active,
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length
      })

      // 2. 检查 WebCodecs 支持
      console.log('🔍 [WORKER-MAIN] Step 3: Checking WebCodecs support...')
      if (typeof VideoEncoder === 'undefined') {
        console.warn('❌ [WORKER-MAIN] WebCodecs not supported, falling back to MediaRecorder')
        return startSimpleRecording(stream)
      }
      console.log('✅ [WORKER-MAIN] VideoEncoder available')

      // 3. 创建 MediaStreamTrackProcessor（主线程）
      console.log('🎞️ [WORKER-MAIN] Step 4: Creating MediaStreamTrackProcessor...')
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) {
        throw new Error('No video track found')
      }
      console.log('✅ [WORKER-MAIN] Video track found:', {
        id: videoTrack.id,
        kind: videoTrack.kind,
        label: videoTrack.label,
        enabled: videoTrack.enabled,
        readyState: videoTrack.readyState
      })

      // 检查 MediaStreamTrackProcessor 支持
      if (typeof MediaStreamTrackProcessor === 'undefined') {
        console.warn('❌ [WORKER-MAIN] MediaStreamTrackProcessor not supported, falling back to MediaRecorder')
        return startSimpleRecording(stream)
      }
      console.log('✅ [WORKER-MAIN] MediaStreamTrackProcessor available')

      const processor = new MediaStreamTrackProcessor({ track: videoTrack })
      const reader = processor.readable.getReader()
      console.log('✅ [WORKER-MAIN] MediaStreamTrackProcessor created and reader obtained')

      // 4. 创建 Worker 进行 WebCodecs 编码
      console.log('👷 [WORKER-MAIN] Step 5: Creating WebCodecs Worker...')
      const worker = new Worker(
        new URL('../../lib/workers/webcodecs-worker.ts', import.meta.url),
        { type: 'module' }
      )
      console.log('✅ [WORKER-MAIN] Worker created successfully')

      // 5. 等待 Worker 配置完成的 Promise
      let workerConfigured = false
      let workerInitialized = false

      const workerReadyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('❌ [WORKER-MAIN] Worker configuration timeout after 10 seconds')
          console.error('❌ [WORKER-MAIN] Worker initialized:', workerInitialized)
          console.error('❌ [WORKER-MAIN] Worker configured:', workerConfigured)
          reject(new Error('Worker configuration timeout'))
        }, 10000) // 10秒超时

        worker.onmessage = (event) => {
          console.log('📨 [WORKER-MAIN] Received Worker message during setup:', event.data)

          if (event.data.type === 'initialized') {
            console.log('✅ [WORKER-MAIN] Worker initialized successfully')
            workerInitialized = true
          } else if (event.data.type === 'configured') {
            console.log('✅ [WORKER-MAIN] Worker configuration confirmed')
            workerConfigured = true
            clearTimeout(timeout)
            resolve()
            // 配置完成后，设置正常的消息处理器
            setupWorkerMessageHandler(worker)
          } else if (event.data.type === 'error') {
            console.error('❌ [WORKER-MAIN] Worker error during setup:', event.data.data)
            clearTimeout(timeout)
            reject(new Error(`Worker setup error: ${event.data.data}`))
          }
        }

        worker.onerror = (error) => {
          console.error('❌ [WORKER-MAIN] Worker error event during setup:', error)
          clearTimeout(timeout)
          reject(new Error(`Worker error: ${error.message || 'Unknown error'}`))
        }
      })

      // 6. 配置 Worker
      const workerConfig = {
        codec: 'vp9',
        width: 1920,
        height: 1080,
        bitrate: 8000000,
        framerate: 30
      }
      console.log('⚙️ [WORKER-MAIN] Step 6: Configuring Worker with:', workerConfig)
      worker.postMessage({
        type: 'configure',
        config: workerConfig
      })

      // 7. 等待配置完成
      console.log('⏳ [WORKER-MAIN] Waiting for Worker configuration...')
      await workerReadyPromise
      console.log('✅ [WORKER-MAIN] Worker is ready for encoding!')

      // 8. 传递 VideoFrame 到 Worker（只在配置完成后）
      let frameCount = 0
      const processFrames = async () => {
        try {
          console.log('🎞️ [WORKER-MAIN] Step 8: Starting frame processing loop...')

          // 确保 Worker 已配置
          if (!workerConfigured) {
            console.warn('⚠️ [WORKER-MAIN] Worker not configured yet, waiting...')
            await workerReadyPromise
          }

          console.log('✅ [WORKER-MAIN] Worker is ready, starting frame processing')

          while (true) {
            const { done, value: frame } = await reader.read()
            if (done) {
              console.log('🏁 [WORKER-MAIN] Frame reading completed, total frames:', frameCount)
              // 通知 Worker 停止编码
              worker.postMessage({ type: 'stop' })
              break
            }

            frameCount++
            if (frameCount % 30 === 0) { // 每秒日志一次（假设30fps）
              console.log(`📊 [WORKER-MAIN] Processing frame ${frameCount}, timestamp: ${frame.timestamp}`)
            }

            // 传递 VideoFrame 到 Worker（Transferable Object）
            worker.postMessage({
              type: 'encode',
              frame: frame
            }, [frame])
          }
        } catch (error) {
          console.error('❌ [WORKER-MAIN] Frame processing error:', error)
        }
      }

      // 7. 设置 Worker 消息处理器的函数
      function setupWorkerMessageHandler(worker: Worker) {
        console.log('📡 [WORKER-MAIN] Setting up Worker message listener...')
        worker.onmessage = (event) => {
          const { type, data, config } = event.data
          console.log(`📨 [WORKER-MAIN] Received message from Worker:`, { type, data: data ? 'present' : 'none' })

          switch (type) {
            case 'configured':
              console.log('✅ [WORKER-MAIN] Worker configured successfully:', config)
              break
            case 'chunk':
              // 处理编码后的数据块
              console.log(`📦 [WORKER-MAIN] Received encoded chunk:`, {
                size: data.size,
                timestamp: data.timestamp,
                type: data.type,
                totalChunks: data.totalChunks
              })

              // 收集编码数据块
              if (data.data) {
                workerEncodedChunks.push({
                  data: data.data,
                  timestamp: data.timestamp,
                  type: data.type,
                  size: data.size,
                  // 添加分辨率信息（如果可用）
                  codedWidth: data.codedWidth || 1920,
                  codedHeight: data.codedHeight || 1080
                })
                console.log(`💾 [WORKER-MAIN] Collected chunk ${workerEncodedChunks.length}, total size: ${workerEncodedChunks.reduce((sum, chunk) => sum + chunk.size, 0)} bytes`)
              }
              break
            case 'complete':
              // 录制完成
              console.log('🎉 [WORKER-MAIN] Worker recording completed successfully!')
              break
            case 'error':
              console.error('❌ [WORKER-MAIN] Worker encoding error:', data)
              workerEnvironmentIssues = [data || 'Worker 编码错误']
              break
            default:
              console.warn('⚠️ [WORKER-MAIN] Unknown message type from Worker:', type)
          }
        }

        // Worker 错误处理
        worker.onerror = (error) => {
          console.error('❌ [WORKER-MAIN] Worker error:', error)
          workerEnvironmentIssues = ['Worker 运行错误']
        }
      }

      // 9. 开始处理帧
      console.log('🚀 [WORKER-MAIN] Step 9: Starting frame processing...')

      // 初始化录制状态
      workerRecordingActive = true
      workerEncodedChunks = [] // 清空之前的数据
      workerCurrentWorker = worker

      // 更新录制状态到 store（这样UI会更新）
      recordingStore.updateStatus('recording')
      recordingStore.setEngine('webcodecs')

      processFrames()

      workerSystemReady = true
      console.log('🎉 [WORKER-MAIN] ✅ Worker recording started successfully with WebCodecs!')
      console.log('📊 [WORKER-MAIN] System status: Ready for high-performance recording')

    } catch (error) {
      console.error('❌ [WORKER-MAIN] Worker recording failed:', error)
      workerEnvironmentIssues = [(error as Error).message || '录制失败']
    }
  }

  // 降级到简单录制
  function startSimpleRecording(stream: MediaStream) {
    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8000000
    })

    let chunks: Blob[] = []

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    recorder.onstop = async () => {
      const videoBlob = new Blob(chunks, { type: mimeType })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `worker-fallback-${timestamp}.webm`

      await ChromeAPIWrapper.saveVideo(videoBlob, filename)
      console.log('✅ Fallback recording saved:', filename)
    }

    recorder.start(1000)
    console.log('✅ Fallback recording started')
  }

  async function stopWorkerRecording() {
    try {
      console.log('🛑 Stopping Worker recording...')

      // 停止 Worker 录制
      if (workerCurrentWorker) {
        workerCurrentWorker.postMessage({ type: 'stop' })
      }

      workerRecordingActive = false

      // 更新录制状态
      recordingStore.updateStatus('stopping')

      // 处理收集到的编码数据
      console.log(`📊 [WORKER-MAIN] Recording stopped. Collected ${workerEncodedChunks.length} chunks`)
      const totalSize = workerEncodedChunks.reduce((sum, chunk) => sum + chunk.size, 0)
      console.log(`📊 [WORKER-MAIN] Total encoded data size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)

      if (workerEncodedChunks.length > 0) {
        console.log('🎨 [WORKER-MAIN] Rendering encoded chunks to Canvas...')

        try {
          // 方案1：使用 VideoPreview 组件渲染（推荐）
          console.log('🎨 [WORKER-MAIN] Preparing video preview...')
          await handleVideoPreview(workerEncodedChunks)

          console.log('✅ Worker recording prepared for video preview')
          recordingStore.updateStatus('completed')
          isDecodingVideo = false

        } catch (error) {
          console.error('❌ Failed to prepare video preview:', error)
          isDecodingVideo = false

          try {
            // 方案2：降级到文件下载
            console.log('🔄 [WORKER-MAIN] Falling back to file download...')
            const reEncodedBlob = await createWebMFromEncodedChunks(workerEncodedChunks)

            if (reEncodedBlob) {
              // 下载文件
              const url = URL.createObjectURL(reEncodedBlob)
              const a = document.createElement('a')
              a.href = url
              a.download = `webcodecs-fallback-${Date.now()}.webm`
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              URL.revokeObjectURL(url)

              console.log('✅ Fallback: WebM file downloaded')
              recordingStore.updateStatus('completed')
            } else {
              throw new Error('Fallback file creation failed')
            }
          } catch (error2) {
            console.error('❌ All rendering methods failed:', error2)

            // 方案3：最后降级方案 - 保存原始数据
            console.log('🔄 [WORKER-MAIN] Final fallback: raw data export...')
            const allData = workerEncodedChunks.map(chunk => chunk.data)
            const videoBlob = new Blob(allData, { type: 'application/octet-stream' })

            const url = URL.createObjectURL(videoBlob)
            const a = document.createElement('a')
            a.href = url
            a.download = `webcodecs-raw-${Date.now()}.bin`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            console.log('✅ Raw encoded data saved (requires manual processing)')
            recordingStore.updateStatus('completed')
          }
        }
      } else {
        console.warn('⚠️ No encoded chunks to save')
        recordingStore.updateStatus('error', 'No encoded chunks to save')
      }

      // 清理 Worker 引用（但保留编码数据供预览使用）
      workerCurrentWorker = null
      // 注意：不清空 workerEncodedChunks，让预览组件继续使用

    } catch (error) {
      console.error('❌ Worker stop failed:', error)
    }
  }

  async function checkWorkerEnvironment() {
    try {
      const env = await recordingService.checkEnvironment()
      workerSystemReady = env.isReady
      workerEnvironmentIssues = env.issues
      console.log('🔍 Worker environment check:', env)
      return env.isReady
    } catch (error) {
      console.error('❌ Worker environment check failed:', error)
      workerSystemReady = false
      workerEnvironmentIssues = ['Worker 环境检查失败']
      return false
    }
  }

  function toggleWorkerDetails() {
    showWorkerDetails = !showWorkerDetails
  }

  function toggleAdvancedOptions() {
    showAdvancedOptions = !showAdvancedOptions
  }

  function updateRecordingOptions(updates: Partial<RecordingOptions>) {
    recordingOptions = { ...recordingOptions, ...updates }
    recordingStore.updateOptions(updates)
  }

  async function handleWorkerRecordButtonClick() {
    if (workerIsRecording) {
      await stopWorkerRecording()
    } else {
      await startWorkerRecording()
    }
  }

  // 开始录制
  async function startRecording() {
    try {
      status = 'requesting'
      errorMessage = ''

      console.log('🎬 Starting screen recording...')

      // 1. 直接使用chrome.desktopCapture API
      const streamId = await requestDesktopCapture()

      if (!streamId) {
        throw new Error('DESKTOP_CAPTURE_CANCELLED')
      }

      console.log('✅ Desktop capture permission granted:', streamId)

      // 2. 获取媒体流
      console.log('🎬 Getting media stream from streamId:', streamId)
      stream = await getUserMediaFromStreamId(streamId)

      if (!stream) {
        throw new Error('无法获取媒体流')
      }

      console.log('✅ Media stream obtained:', {
        id: stream.id,
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length,
        active: stream.active
      })

      // 3. 设置MediaRecorder
      const mimeType = getSupportedMimeType()
      mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5000000 // 5Mbps
      })

      recordedChunks = []

      // 4. 设置事件监听器
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data)
          console.log('📦 Recorded chunk:', event.data.size, 'bytes')
        }
      }

      mediaRecorder.onstop = async () => {
        console.log('🛑 Recording stopped, processing...')
        await handleRecordingComplete()
      }

      mediaRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event)
        handleRecordingError('录制过程中发生错误')
      }

      // 5. 开始录制
      mediaRecorder.start(1000) // 每秒收集一次数据

      // 6. 更新状态
      isRecording = true
      status = 'recording'
      startTime = Date.now()
      startDurationTimer()

      console.log('🎥 Recording started successfully')

    } catch (error) {
      console.error('❌ Failed to start recording:', error)

      // 根据错误类型提供不同的用户提示
      let errorMsg = '启动录制失败'
      if (error instanceof Error) {
        console.log('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack
        })

        if (error.message.includes('DESKTOP_CAPTURE_CANCELLED')) {
          errorMsg = 'DESKTOP_CAPTURE_CANCELLED'
        } else if (error.message.includes('DESKTOP_CAPTURE_FAILED')) {
          errorMsg = 'DESKTOP_CAPTURE_FAILED'
        } else if (error.message.includes('Chrome runtime not available')) {
          errorMsg = 'CHROME_RUNTIME_NOT_AVAILABLE'
        } else if (error.message.includes('Invalid state')) {
          errorMsg = 'INVALID_STATE_ERROR'
        } else if (error.message.includes('AbortError')) {
          errorMsg = 'MEDIA_ABORT_ERROR'
        } else if (error.message.includes('NotAllowedError')) {
          errorMsg = 'PERMISSION_DENIED'
        } else if (error.message.includes('NotFoundError')) {
          errorMsg = 'MEDIA_DEVICE_NOT_FOUND'
        } else {
          errorMsg = error.message
        }
      }

      handleRecordingError(errorMsg)
    }
  }

  // 停止录制
  async function stopRecording() {
    try {
      status = 'stopping'
      console.log('🛑 Stopping recording...')

      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop()
      }

      // 停止所有媒体轨道
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop()
          console.log('🔇 Track stopped:', track.kind)
        })
      }

      stopDurationTimer()

    } catch (error) {
      console.error('❌ Failed to stop recording:', error)
      handleRecordingError('停止录制失败')
    }
  }

  // 处理录制完成
  async function handleRecordingComplete() {
    try {
      if (recordedChunks.length === 0) {
        throw new Error('没有录制到任何内容')
      }

      // 创建视频文件
      const mimeType = getSupportedMimeType()
      const videoBlob = new Blob(recordedChunks, { type: mimeType })

      console.log('📹 Video created:', {
        size: videoBlob.size,
        type: videoBlob.type,
        duration: duration
      })

      // 生成文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `screen-recording-${timestamp}.webm`

      // 保存文件
      await ChromeAPIWrapper.saveVideo(videoBlob, filename)

      console.log('💾 Video saved successfully:', filename)

      // 重置状态
      resetRecordingState()

    } catch (error) {
      console.error('❌ Failed to process recording:', error)
      handleRecordingError('保存录制失败')
    }
  }

  // 处理录制错误
  function handleRecordingError(message: string) {
    errorMessage = message
    status = 'error'
    isRecording = false

    // 清理资源
    cleanup()

    // 3秒后重置错误状态
    setTimeout(() => {
      if (status === 'error') {
        status = 'idle'
        errorMessage = ''
      }
    }, 3000)
  }

  // 重置录制状态
  function resetRecordingState() {
    isRecording = false
    status = 'idle'
    duration = 0
    startTime = null
    errorMessage = ''
    cleanup()
  }

  // 清理资源
  function cleanup() {
    if (mediaRecorder) {
      mediaRecorder = null
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      stream = null
    }

    stopDurationTimer()
    recordedChunks = []
  }

  // 开始计时器
  function startDurationTimer() {
    stopDurationTimer()

    durationTimer = window.setInterval(() => {
      if (startTime) {
        duration = Math.floor((Date.now() - startTime) / 1000)
      }
    }, 1000)
  }

  // 停止计时器
  function stopDurationTimer() {
    if (durationTimer) {
      clearInterval(durationTimer)
      durationTimer = null
    }
  }

  // 直接请求桌面捕获
  async function requestDesktopCapture(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!chrome?.desktopCapture) {
        reject(new Error('chrome.desktopCapture API not available'))
        return
      }

      console.log('📞 Calling chrome.desktopCapture.chooseDesktopMedia...')

      const sources = ['screen', 'window', 'tab', 'audio']

      const requestId = chrome.desktopCapture.chooseDesktopMedia(
        sources,
        null as any, // 类型断言修复TypeScript错误
        (streamId, options) => {
          console.log('📞 Desktop capture callback:', { streamId, options })

          if (streamId) {
            console.log('✅ Desktop capture granted:', streamId)
            resolve(streamId)
          } else {
            console.log('❌ Desktop capture cancelled by user')
            reject(new Error('DESKTOP_CAPTURE_CANCELLED'))
          }
        }
      )

      console.log('📞 Desktop capture request ID:', requestId)
    })
  }

  // 从streamId获取MediaStream
  async function getUserMediaFromStreamId(streamId: string): Promise<MediaStream> {
    try {
      console.log('Getting media stream for streamId:', streamId)

      // 检查navigator.mediaDevices是否可用
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('navigator.mediaDevices.getUserMedia is not available')
      }

      // Chrome扩展的正确约束格式（回退到工作版本）
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: streamId
          }
        }
      }

      console.log('Using constraints:', constraints)
      console.log('Calling navigator.mediaDevices.getUserMedia...')

      // 使用 getUserMedia 获取媒体流
      const stream = await navigator.mediaDevices.getUserMedia(constraints as any)

      console.log('getUserMedia returned:', stream)

      if (!stream) {
        throw new Error('Failed to get media stream')
      }

      // 检查视频轨道
      const videoTracks = stream.getVideoTracks()
      if (videoTracks.length === 0) {
        throw new Error('No video tracks found in media stream')
      }

      // 检查视频轨道状态
      const videoTrack = videoTracks[0]
      if (videoTrack.readyState !== 'live') {
        throw new Error(`Video track not ready: ${videoTrack.readyState}`)
      }

      console.log('Media stream obtained successfully:', {
        id: stream.id,
        videoTracks: videoTracks.length,
        audioTracks: stream.getAudioTracks().length,
        videoTrackState: videoTrack.readyState,
        videoTrackLabel: videoTrack.label
      })

      return stream
    } catch (error) {
      console.error('Error getting media stream:', error)

      // 提供更详细的错误信息
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`AbortError: ${error.message}`)
        } else if (error.name === 'NotAllowedError') {
          throw new Error(`NotAllowedError: ${error.message}`)
        } else if (error.name === 'NotFoundError') {
          throw new Error(`NotFoundError: ${error.message}`)
        } else if (error.name === 'InvalidStateError') {
          throw new Error(`Invalid state: ${error.message}`)
        }
      }

      throw new Error(`Failed to get media stream: ${error}`)
    }
  }

  // 获取支持的MIME类型
  function getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('📋 Using MIME type:', type)
        return type
      }
    }

    console.warn('⚠️ No preferred MIME type supported, using default')
    return 'video/webm'
  }

  // 格式化时间显示
  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }



  // 处理按钮点击
  async function handleRecordButtonClick() {
    if (isRecording) {
      await stopRecording()
    } else {
      await startRecording()
    }
  }

  // 检查扩展环境和权限
  async function checkExtensionEnvironment() {
    try {
      // 检查Chrome扩展环境
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error('Chrome扩展环境不可用')
      }

      // 检查必要的API
      if (!chrome.runtime.sendMessage) {
        throw new Error('Chrome消息API不可用')
      }

      // 检查MediaRecorder支持
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('浏览器不支持MediaRecorder')
      }

      // 检查getUserMedia支持
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('浏览器不支持getUserMedia')
      }

      console.log('✅ Extension environment check passed')

    } catch (error) {
      console.error('❌ Extension environment check failed:', error)
      handleRecordingError(error instanceof Error ? error.message : '扩展环境检查失败')
    }
  }

  // 组件挂载时的初始化
  onMount(() => {
    console.log('📱 Sidepanel mounted with Worker system')

    // 检查扩展环境
    checkExtensionEnvironment()

    // 检查 Worker 环境
    checkWorkerEnvironment()

    // 监听来自background的消息
    const messageListener = (message: any) => {
      if (message.action === 'downloadComplete') {
        console.log('✅ Download completed:', message.downloadId)
      }
    }

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener(messageListener)
    }

    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.removeListener(messageListener)
      }
    }
  })

  // 组件销毁时清理
  onDestroy(() => {
    console.log('📱 Sidepanel unmounted, cleaning up...')
    cleanup()
  })
</script>

<svelte:head>
  <title>屏幕录制</title>
</svelte:head>

<div class="flex flex-col h-screen p-4 gap-4 font-sans overflow-y-auto">
  <h1 class="text-lg font-semibold text-gray-900 text-center">屏幕录制</h1>

  <div class="flex items-center justify-center">
    <div class="flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-transparent transition-all duration-200 min-w-[200px] text-center text-sm font-medium
      {status === 'recording' ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' :
       status === 'error' ? 'bg-red-50 text-red-600 border-red-300' :
       'bg-gray-50 text-gray-600'}">
      {#if status === 'requesting'}
        <RotateCcw class="w-4 h-4 animate-spin" />
        请求权限中...
      {:else if status === 'recording'}
        <div class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
        录制中 - {formatDuration(duration)}
      {:else if status === 'stopping'}
        <Square class="w-4 h-4" />
        停止中...
      {:else if status === 'error'}
        <TriangleAlert class="w-4 h-4" />
        {errorMessage}
      {:else}
        <CircleCheck class="w-4 h-4" />
        就绪
      {/if}
    </div>
  </div>

  {#if status === 'recording'}
    <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col gap-2">
      <div class="flex justify-between items-center">
        <span class="text-sm text-gray-600 font-medium">录制时长:</span>
        <span class="text-sm text-gray-900 font-semibold flex items-center gap-1">
          <Clock class="w-4 h-4" />
          {formatDuration(duration)}
        </span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-sm text-gray-600 font-medium">状态:</span>
        <span class="text-sm text-red-600 font-semibold flex items-center gap-1 animate-pulse">
          <div class="w-2 h-2 bg-red-500 rounded-full"></div>
          录制中
        </span>
      </div>
    </div>
  {/if}

  <div class="flex flex-col gap-3">
    <button
      class="flex items-center justify-center gap-2 px-6 py-4 rounded-lg font-semibold text-base transition-all duration-200 relative overflow-hidden
        {status === 'requesting' ? 'bg-amber-500 text-white cursor-not-allowed opacity-60' :
         status === 'stopping' ? 'bg-gray-500 text-white cursor-not-allowed opacity-60' :
         isRecording ? 'bg-red-600 text-white hover:bg-red-700 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-600/30' :
         'bg-blue-600 text-white hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-600/30'}"
      disabled={status === 'requesting' || status === 'stopping'}
      onclick={handleRecordButtonClick}
    >
      {#if status === 'requesting'}
        <RotateCcw class="w-5 h-5 animate-spin" />
        请求权限...
      {:else if status === 'stopping'}
        <Square class="w-5 h-5" />
        停止中...
      {:else if isRecording}
        <Square class="w-5 h-5" />
        停止录制
      {:else}
        <Play class="w-5 h-5" />
        开始录制
      {/if}
    </button>
  </div>

  {#if errorMessage}
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 my-3">
      <div class="flex items-center gap-2 text-red-600 text-sm font-semibold mb-3">
        <TriangleAlert class="w-4 h-4" />
        <strong>错误:</strong> {errorMessage}
      </div>
      <div class="text-red-900 text-sm leading-relaxed">
        {#if errorMessage.includes('DESKTOP_CAPTURE_CANCELLED')}
          <p><strong>用户取消了屏幕共享权限</strong></p>
          <p>📋 <strong>如何授予屏幕录制权限：</strong></p>
          <ol>
            <li>点击"开始录制"按钮</li>
            <li>在弹出的对话框中选择要录制的内容：
              <ul>
                <li><strong>整个屏幕</strong> - 录制完整桌面</li>
                <li><strong>应用窗口</strong> - 录制特定应用</li>
                <li><strong>Chrome标签页</strong> - 录制浏览器标签</li>
              </ul>
            </li>
            <li>点击"<strong>共享</strong>"按钮确认</li>
          </ol>
          <p>💡 <strong>提示：</strong>选择"整个屏幕"可以录制桌面上的所有内容</p>
        {:else if errorMessage.includes('DESKTOP_CAPTURE_FAILED')}
          <p><strong>屏幕捕获功能不可用</strong></p>
          <p>🔧 请检查以下设置：</p>
          <ul>
            <li>确保使用Chrome浏览器</li>
            <li>检查扩展权限是否正确授予</li>
            <li>重新加载扩展或重启浏览器</li>
          </ul>
        {:else if errorMessage.includes('CHROME_RUNTIME_NOT_AVAILABLE')}
          <p><strong>Chrome扩展环境不可用</strong></p>
          <p>🔧 请检查以下设置：</p>
          <ul>
            <li>确保在Chrome扩展环境中运行</li>
            <li>重新加载扩展</li>
            <li>检查manifest.json权限配置</li>
          </ul>
        {:else if errorMessage.includes('INVALID_STATE_ERROR')}
          <p><strong>媒体设备状态错误</strong></p>
          <p>🔧 解决方案：</p>
          <ul>
            <li>请在普通网页标签页中使用录制功能</li>
            <li>避免在Chrome扩展页面（chrome://）中录制</li>
            <li>重新打开一个新标签页后再试</li>
          </ul>
        {:else if errorMessage.includes('MEDIA_ABORT_ERROR')}
          <p><strong>媒体流获取被中断</strong></p>
          <p>🔧 解决方案：</p>
          <ul>
            <li>检查是否有其他应用正在使用屏幕录制</li>
            <li>重启浏览器后重试</li>
            <li>确保系统允许屏幕录制权限</li>
          </ul>
        {:else if errorMessage.includes('PERMISSION_DENIED')}
          <p><strong>权限被拒绝</strong></p>
          <p>🔧 解决方案：</p>
          <ul>
            <li>检查Chrome的隐私设置</li>
            <li>确保扩展有屏幕录制权限</li>
            <li>重新安装扩展</li>
          </ul>
        {:else if errorMessage.includes('MEDIA_DEVICE_NOT_FOUND')}
          <p><strong>未找到录制设备</strong></p>
          <p>🔧 解决方案：</p>
          <ul>
            <li>检查系统是否支持屏幕录制</li>
            <li>更新Chrome浏览器到最新版本</li>
            <li>重启系统后重试</li>
          </ul>
        {:else}
          <p class="my-2">请检查权限设置或重试</p>
          <p class="my-2">错误详情: {errorMessage}</p>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Svelte 5 $state 测试区域 -->
  <div class="bg-green-50 border border-green-200 rounded-lg p-3">
    <h3 class="text-sm font-semibold text-green-900 mb-2">Svelte 5 状态测试</h3>

    <div class="space-y-2 text-xs">
      <div class="flex justify-between items-center">
        <span class="text-green-700">计数器:</span>
        <span class="font-mono text-green-900">{testCounter}</span>
      </div>

      <div class="flex justify-between items-center">
        <span class="text-green-700">双倍计数器 ($derived):</span>
        <span class="font-mono text-green-900">{doubledCounter}</span>
      </div>

      <div class="flex justify-between items-center">
        <span class="text-green-700">消息:</span>
        <span class="font-mono text-green-900 text-xs">{formattedMessage}</span>
      </div>

      <div class="flex justify-between items-center">
        <span class="text-green-700">数组长度:</span>
        <span class="font-mono text-green-900">{arrayLength}</span>
      </div>

      <div class="flex justify-between items-center">
        <span class="text-green-700">数组内容:</span>
        <span class="font-mono text-green-900">[{testArray.join(', ')}]</span>
      </div>

      <div class="flex justify-between items-center">
        <span class="text-green-700">对象值:</span>
        <span class="font-mono text-green-900">{testObject.name}: {testObject.value}</span>
      </div>
    </div>

    <div class="flex flex-wrap gap-1 mt-3">
      <button
        class="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
        onclick={incrementCounter}
      >
        +1
      </button>
      <button
        class="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
        onclick={addToArray}
      >
        添加
      </button>
      <button
        class="px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
        onclick={updateObject}
      >
        随机值
      </button>
      <button
        class="px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
        onclick={resetTests}
      >
        重置
      </button>
    </div>
  </div>

  <!-- Worker 系统测试区域 -->
  <div class="bg-purple-50 border border-purple-200 rounded-lg p-3">
    <h3 class="text-sm font-semibold text-purple-900 mb-2">Worker 录制系统</h3>

    <div class="space-y-2 text-xs">
      <div class="flex justify-between items-center">
        <span class="text-purple-700">系统状态:</span>
        <span class="font-mono text-purple-900">
          {workerSystemReady ? '✅ 就绪' : '❌ 未就绪'}
        </span>
      </div>

      <div class="flex justify-between items-center">
        <span class="text-purple-700">录制状态:</span>
        <span class="font-mono text-purple-900">{workerStatus}</span>
      </div>

      {#if workerIsRecording}
        <div class="flex justify-between items-center">
          <span class="text-purple-700">录制时长:</span>
          <span class="font-mono text-purple-900">{workerFormattedDuration}</span>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-purple-700">文件大小:</span>
          <span class="font-mono text-purple-900">{workerFormattedFileSize}</span>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-purple-700">比特率:</span>
          <span class="font-mono text-purple-900">{workerFormattedBitrate}</span>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-purple-700">FPS:</span>
          <span class="font-mono text-purple-900 flex items-center gap-1">
            <Activity class="w-3 h-3" />
            {workerProgress.fps}
          </span>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-purple-700">CPU:</span>
          <span class="font-mono text-purple-900 flex items-center gap-1"
                class:text-green-600={workerProgress.cpuUsage < 50}
                class:text-yellow-600={workerProgress.cpuUsage >= 50 && workerProgress.cpuUsage < 80}
                class:text-red-600={workerProgress.cpuUsage >= 80}>
            <Cpu class="w-3 h-3" />
            {workerProgress.cpuUsage}%
          </span>
        </div>
      {/if}

      {#if workerErrorMessage}
        <div class="flex justify-between items-center">
          <span class="text-purple-700">错误:</span>
          <span class="font-mono text-red-600 text-xs">{workerErrorMessage}</span>
        </div>
      {/if}

      {#if workerEnvironmentIssues.length > 0}
        <div class="border-t border-purple-300 pt-2 mt-2">
          <span class="text-purple-700 text-xs">环境问题:</span>
          <ul class="text-xs text-red-600 mt-1">
            {#each workerEnvironmentIssues as issue}
              <li>• {issue}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap gap-1 mt-3">
      <button
        class="px-2 py-1 text-xs rounded text-white"
        class:bg-red-600={workerIsRecording}
        class:hover:bg-red-700={workerIsRecording}
        class:bg-purple-600={!workerIsRecording}
        class:hover:bg-purple-700={!workerIsRecording}
        onclick={handleWorkerRecordButtonClick}
        disabled={workerStatus === 'requesting' || workerStatus === 'stopping'}
      >
        {workerIsRecording ? '停止录制' : '开始录制'}
      </button>

      <button
        class="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
        onclick={toggleWorkerDetails}
      >
        {showWorkerDetails ? '隐藏详情' : '显示详情'}
      </button>

      <button
        class="px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
        onclick={toggleAdvancedOptions}
      >
        高级选项
      </button>
    </div>

    <!-- 视频预览区域 -->
    <div class="border-t border-purple-300 pt-2 mt-2">
      <div class="text-xs text-purple-700 mb-2">录制预览:</div>

      <!-- 使用新的 VideoPreviewComposite 组件 -->
      <VideoPreviewComposite
        encodedChunks={workerEncodedChunks}
        isRecordingComplete={workerStatus === 'completed' || workerStatus === 'idle'}
        backgroundConfig={{
          type: 'gradient',
          color: '#3b82f6',
          padding: 60,
          outputRatio: '16:9',
          videoPosition: 'center',
          borderRadius: 25,
          inset: 80,
          shadow: {
            offsetX: 20,
            offsetY: 30,
            blur: 60,
            color: 'rgba(0, 0, 0, 0.6)'
          }
        }}
        displayWidth={640}
        displayHeight={360}
        showControls={true}
        showTimeline={true}
        className="worker-video-preview"
      />

      <!-- 保留原有的 VideoPreview 作为对比 -->
      <!--
      <VideoPreview
        bind:this={videoPreviewRef}
        displayWidth={640}
        displayHeight={360}
        canvasWidth={1920}
        canvasHeight={1080}
        aspectRatio="16/9"
        showControls={true}
        showTimeline={true}
        encodedChunks={workerEncodedChunks}
        isDecoding={isDecodingVideo}
        className="border border-purple-300 rounded"
      />
      -->

      {#if workerEncodedChunks.length > 0}
        <div class="text-xs text-purple-600 mt-2">
          已收集 {workerEncodedChunks.length} 个编码块
        </div>
      {/if}
    </div>

    {#if showWorkerDetails && workerIsRecording}
      <div class="border-t border-purple-300 pt-2 mt-2">
        <div class="text-xs space-y-1">
          <div class="flex justify-between">
            <span class="text-purple-600">编码帧数:</span>
            <span class="text-purple-800">{workerProgress.encodedFrames}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-purple-600">处理帧数:</span>
            <span class="text-purple-800">{workerProgress.processedFrames}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-purple-600">录制引擎:</span>
            <span class="text-purple-800">{recordingStore.state.engine}</span>
          </div>
        </div>
      </div>
    {/if}

    {#if showAdvancedOptions}
      <div class="border-t border-purple-300 pt-2 mt-2">
        <div class="space-y-2 text-xs">
          <div class="flex justify-between items-center">
            <label for="worker-video-quality" class="text-purple-700">视频质量:</label>
            <select
              id="worker-video-quality"
              class="text-xs border border-purple-300 rounded px-1 py-0.5"
              bind:value={recordingOptions.videoQuality}
              onchange={() => updateRecordingOptions({ videoQuality: recordingOptions.videoQuality })}
            >
              <option value="low">低 (4Mbps)</option>
              <option value="medium">中 (8Mbps)</option>
              <option value="high">高 (15Mbps)</option>
            </select>
          </div>

          <div class="flex justify-between items-center">
            <label for="worker-engine" class="text-purple-700">录制引擎:</label>
            <select
              id="worker-engine"
              class="text-xs border border-purple-300 rounded px-1 py-0.5"
              bind:value={recordingOptions.preferredEngine}
              onchange={() => updateRecordingOptions({ preferredEngine: recordingOptions.preferredEngine })}
            >
              <option value="mediarecorder">MediaRecorder</option>
              <option value="webcodecs">WebCodecs</option>
            </select>
          </div>

          <div class="flex justify-between items-center">
            <label for="worker-audio" class="text-purple-700">包含音频:</label>
            <input
              id="worker-audio"
              type="checkbox"
              class="rounded"
              bind:checked={recordingOptions.includeAudio}
              onchange={() => updateRecordingOptions({ includeAudio: recordingOptions.includeAudio })}
            />
          </div>
        </div>
      </div>
    {/if}
  </div>

  <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-auto">
    <h3 class="text-sm font-semibold text-blue-900 mb-2">功能说明</h3>
    <ul class="text-xs text-blue-800 space-y-1 pl-4 list-disc">
      <li><strong>原始录制</strong>：使用传统 MediaRecorder API</li>
      <li><strong>Worker 录制</strong>：使用 Web Workers 的高性能录制系统</li>
      <li><strong>Svelte 5 测试</strong>：绿色区域测试 $state 响应式状态</li>
      <li><strong>智能降级</strong>：WebCodecs → MediaRecorder 自动切换</li>
      <li><strong>实时监控</strong>：FPS、CPU、内存使用情况</li>
      <li><strong>非阻塞架构</strong>：UI 始终保持响应</li>
    </ul>
  </div>
</div>

