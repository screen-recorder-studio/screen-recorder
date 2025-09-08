<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { ChromeAPIWrapper } from '$lib/utils/chrome-api'
  import { TriangleAlert, Activity } from '@lucide/svelte'

  // 引入 Worker 系统
  import { recordingService } from '$lib/services/recording-service'
  import { recordingStore } from '$lib/stores/recording.svelte'
  import VideoPreviewComposite from '$lib/components/VideoPreviewComposite.svelte'
  import VideoExportPanel from '$lib/components/VideoExportPanel.svelte'
  import BackgroundColorPicker from '$lib/components/BackgroundColorPicker.svelte'
  import BorderRadiusControl from '$lib/components/BorderRadiusControl.svelte'
  import PaddingControl from '$lib/components/PaddingControl.svelte'
  import AspectRatioControl from '$lib/components/AspectRatioControl.svelte'
  import ShadowControl from '$lib/components/ShadowControl.svelte'
  import RecordButton from '$lib/components/RecordButton.svelte'
  import ElementRegionSelector from '$lib/components/ElementRegionSelector.svelte'
  import { elementRecordingIntegration, type ElementRecordingData } from '$lib/utils/element-recording-integration'

  // 录制状态
  let isRecording = $state(false)
  let status = $state<'idle' | 'requesting' | 'recording' | 'stopping' | 'error'>('idle')
  let errorMessage = $state('')

  // 录制相关变量
  let mediaRecorder: MediaRecorder | null = null
  let recordedChunks: Blob[] = []
  let stream: MediaStream | null = null


  // Worker 系统状态
  let workerSystemReady = $state(false)
  let workerEnvironmentIssues = $state<string[]>([])


  // Worker 录制数据收集
  let workerEncodedChunks = $state<any[]>([])
  let workerCurrentWorker: Worker | null = null



  // 处理录制完成后的视频预览
  async function handleVideoPreview(chunks: any[]): Promise<void> {
    try {
      console.log('🎨 [VideoPreview] Preparing video preview with', chunks.length, 'chunks')

      // VideoPreview 组件会自动处理解码和渲染
      // 这里只需要设置状态，组件会响应 encodedChunks 的变化

    } catch (error) {
      console.error('❌ [VideoPreview] Error preparing video preview:', error)
    }
  }


  // Worker 系统的计算属性
  const workerIsRecording = $derived(recordingStore.isRecording)
  const workerStatus = $derived(recordingStore.state.status)
  const workerErrorMessage = $derived(recordingStore.state.error)

  // 界面模式判断
  const isMinimalMode = $derived(
    workerStatus !== 'completed' || workerEncodedChunks.length === 0
  )
  const isEditingMode = $derived(
    workerStatus === 'completed' && workerEncodedChunks.length > 0
  )


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
      // 依据采集轨道的自然尺寸配置编码器，避免拉伸变形
      const trackSettings = (videoTrack as any).getSettings ? (videoTrack as any).getSettings() : {}
      const encoderWidth = trackSettings?.width || 1920
      const encoderHeight = trackSettings?.height || 1080
      const encoderFps = Math.round(trackSettings?.frameRate || 30)

      const workerConfig = {
        codec: 'vp9',
        width: encoderWidth,
        height: encoderHeight,
        bitrate: 8000000,
        framerate: encoderFps
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

        } catch (error) {
          console.error('❌ Failed to prepare video preview:', error)
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

  // 处理元素录制数据
  function handleElementRecordingData(message: any) {
    try {
      console.log('🎬 [Sidepanel] Received element recording data:', {
        chunks: message.encodedChunks?.length || 0,
        metadata: message.metadata
      })

      if (!message.encodedChunks || message.encodedChunks.length === 0) {
        console.warn('⚠️ [Sidepanel] No encoded chunks in element recording data')
        return
      }

      // 验证数据格式
      const firstChunk = message.encodedChunks[0];
      if (!Array.isArray(firstChunk.data)) {
        console.warn('⚠️ [Sidepanel] Unexpected data format, expected array');
      }

      // 使用集成工具处理数据
      const recordingData: ElementRecordingData = {
        encodedChunks: message.encodedChunks || [],
        metadata: message.metadata || {}
      }

      // 通过集成工具处理
      elementRecordingIntegration.handleRecordingData(recordingData)

      // 转换为主系统格式
      const compatibleChunks = elementRecordingIntegration.convertToMainSystemFormat(recordingData)

      console.log('🔄 [Sidepanel] Converted', compatibleChunks.length, 'chunks for editing');

      // 将元素录制数据设置到主系统
      workerEncodedChunks = compatibleChunks

      // 更新录制状态为完成
      recordingStore.updateStatus('completed')
      recordingStore.setEngine('webcodecs')

      console.log('✅ [Sidepanel] Element recording data integrated successfully')

      // 显示成功通知
      const summary = elementRecordingIntegration.getRecordingSummary(recordingData)
      showIntegrationNotification(message.metadata, summary)

    } catch (error) {
      console.error('❌ [Sidepanel] Error handling element recording data:', error)
    }
  }

  // 处理元素录制就绪通知
  function handleElementRecordingReady(data: any) {
    try {
      console.log('🎬 [Sidepanel] Element recording ready notification:', data)

      if (data?.encodedChunks) {
        handleElementRecordingData(data)
      }
    } catch (error) {
      console.error('❌ [Sidepanel] Error handling element recording ready:', error)
    }
  }

  // 显示集成成功通知
  function showIntegrationNotification(metadata: any, summary?: any) {
    // 这里可以添加 UI 通知逻辑
    console.log('🎉 [Sidepanel] Element recording integrated:', {
      mode: metadata?.mode,
      element: metadata?.selectedElement,
      region: metadata?.selectedRegion,
      chunks: workerEncodedChunks.length,
      summary
    })
  }



  async function handleWorkerRecordButtonClick() {
    if (workerIsRecording) {
      await stopWorkerRecording()
    } else {
      await startWorkerRecording()
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

  // 清理资源
  function cleanup() {
    if (mediaRecorder) {
      mediaRecorder = null
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      stream = null
    }

    recordedChunks = []
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

    // 设置元素录制集成监听器
    const elementRecordingListener = (data: ElementRecordingData) => {
      console.log('🎬 [Sidepanel] Element recording integration callback:', data)

      // 转换并设置数据
      const compatibleChunks = elementRecordingIntegration.convertToMainSystemFormat(data)
      workerEncodedChunks = compatibleChunks

      // 更新状态
      recordingStore.updateStatus('completed')
      recordingStore.setEngine('webcodecs')

      // 获取摘要
      const summary = elementRecordingIntegration.getRecordingSummary(data)
      console.log('📊 [Sidepanel] Recording summary:', summary)
    }

    elementRecordingIntegration.onDataReceived(elementRecordingListener)

    // 监听来自background的消息
    const messageListener = (message: any) => {
      if (message.action === 'downloadComplete') {
        console.log('✅ Download completed:', message.downloadId)
      } else if (message.type === 'ELEMENT_RECORDING_DATA') {
        // 处理元素录制数据
        handleElementRecordingData(message)
      } else if (message.type === 'ELEMENT_RECORDING_READY') {
        // 处理元素录制就绪通知
        handleElementRecordingReady(message.data)
      }
    }

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener(messageListener)
    }

    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.removeListener(messageListener)
      }
      // 清理元素录制监听器
      elementRecordingIntegration.removeListener(elementRecordingListener)
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

<!-- 极简录制模式 -->
{#if isMinimalMode}
  <div class="flex flex-col items-center justify-center min-h-screen p-4 bg-gradient-to-br from-gray-50 to-gray-100 transition-all duration-300 ease-in-out">
    <!-- 简化的页面标题 -->
    <div class="text-center mb-8 animate-fade-in">
      <h1 class="text-2xl font-bold text-gray-800 mb-1 transition-colors duration-200">屏幕录制工具</h1>
      <p class="text-sm text-gray-600 transition-colors duration-200">高性能 WebCodecs 录制引擎</p>
    </div>

    <!-- 元素/区域选择面板 -->
    <div class="max-w-md w-full mb-6">
      <ElementRegionSelector />
    </div>

    <!-- 录制控制面板（简化版） -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 shadow-lg max-w-md w-full transform transition-all duration-300 ease-in-out hover:shadow-xl hover:scale-105">
      <!-- 错误信息显示 -->
      {#if workerErrorMessage || workerEnvironmentIssues.length > 0}
        <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          {#if workerErrorMessage}
            <div class="flex items-start gap-2 mb-2">
              <TriangleAlert class="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <div class="text-sm font-medium text-red-800">录制错误</div>
                <div class="text-xs text-red-600 mt-1">{workerErrorMessage}</div>
              </div>
            </div>
          {/if}

          {#if workerEnvironmentIssues.length > 0}
            <div class="flex items-start gap-2">
              <TriangleAlert class="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <div class="text-sm font-medium text-red-800">环境问题</div>
                <ul class="text-xs text-red-600 mt-1 space-y-1">
                  {#each workerEnvironmentIssues as issue}
                    <li class="flex items-center gap-1">
                      <div class="w-1 h-1 bg-red-400 rounded-full"></div>
                      {issue}
                    </li>
                  {/each}
                </ul>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- 录制控制区域 -->
      <RecordButton
        isRecording={workerIsRecording}
        status={workerStatus}
        onclick={handleWorkerRecordButtonClick}
      />
    </div>
  </div>
{/if}

<!-- 完整编辑模式 -->
{#if isEditingMode}
  <div class="flex flex-col lg:flex-row min-h-screen p-4 gap-6 font-sans bg-gradient-to-br from-gray-50 to-gray-100 transition-all duration-500 ease-in-out">

    <!-- 视频预览区域：小屏全宽在上，大屏左侧（更宽） -->
    <div class="w-full lg:w-3/4 space-y-4 lg:space-y-6 transition-all duration-300 ease-in-out">
      <!-- 页面标题（编辑模式） -->
      <div class="text-center lg:text-left animate-fade-in">
        <h1 class="text-2xl font-bold text-gray-800 mb-1 transition-colors duration-200">视频编辑</h1>
        <p class="text-sm text-gray-600 transition-colors duration-200">录制完成，开始编辑</p>
      </div>

      <!-- 视频预览面板 -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6 shadow-lg transition-all duration-300 ease-in-out hover:shadow-xl">
        <div class="flex items-center gap-2 mb-6">
          <div class="w-2 h-2 bg-blue-500 rounded-full transition-colors duration-200"></div>
          <h2 class="text-lg font-semibold text-gray-800 transition-colors duration-200">录制预览</h2>
        </div>

        <!-- 使用新的 VideoPreviewComposite 组件 -->
        <div class="w-full">
          <VideoPreviewComposite
            encodedChunks={workerEncodedChunks}
            isRecordingComplete={workerStatus === 'completed' || workerStatus === 'idle'}
            displayWidth={640}
            displayHeight={360}
            showControls={true}
            showTimeline={true}
            className="worker-video-preview w-full"
          />
        </div>

        {#if workerEncodedChunks.length > 0}
          <div class="flex items-center gap-2 mt-4 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <Activity class="w-4 h-4" />
            <span>已收集 {workerEncodedChunks.length} 个编码块</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- 配置和导出区域：小屏下方，大屏右侧（更窄） -->
    <div class="w-full lg:w-1/4 lg:max-w-sm space-y-4 lg:space-y-6 transition-all duration-300 ease-in-out">
      <!-- 视频配置面板 -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6 shadow-lg transition-all duration-300 ease-in-out hover:shadow-xl">
        <div class="flex items-center gap-2 mb-6">
          <div class="w-2 h-2 bg-purple-500 rounded-full transition-colors duration-200"></div>
          <h2 class="text-lg font-semibold text-gray-800 transition-colors duration-200">视频配置</h2>
        </div>

        <!-- 配置选项网格：小屏2列，大屏1列 -->
        <div class="grid grid-cols-2 lg:grid-cols-1 gap-4">
          <!-- 背景颜色选择 -->
          <div class="col-span-2 lg:col-span-1">
            <BackgroundColorPicker />
          </div>

          <!-- 圆角配置 -->
          <div>
            <BorderRadiusControl />
          </div>

          <!-- 边距配置 -->
          <div>
            <PaddingControl />
          </div>

          <!-- 视频比例配置 -->
          <div class="col-span-2 lg:col-span-1">
            <AspectRatioControl />
          </div>

          <!-- 阴影配置 -->
          <div class="col-span-2 lg:col-span-1">
            <ShadowControl />
          </div>
        </div>
      </div>

      <!-- 视频导出面板 -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6 shadow-lg transition-all duration-300 ease-in-out hover:shadow-xl">
        <div class="flex items-center gap-2 mb-6">
          <div class="w-2 h-2 bg-green-500 rounded-full transition-colors duration-200"></div>
          <h2 class="text-lg font-semibold text-gray-800 transition-colors duration-200">视频导出</h2>
        </div>

        <VideoExportPanel
          encodedChunks={workerEncodedChunks}
          isRecordingComplete={workerStatus === 'completed' || workerStatus === 'idle'}
          className="export-panel"
        />
      </div>
    </div>
  </div>
{/if}

<style>
  /* 自定义动画类 */
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-fade-in {
    animation: fade-in 0.5s ease-out;
  }

  /* 优化滚动条样式 */
  :global(.overflow-y-auto::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.overflow-y-auto::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(.overflow-y-auto::-webkit-scrollbar-thumb) {
    background: rgba(156, 163, 175, 0.5);
    border-radius: 3px;
  }

  :global(.overflow-y-auto::-webkit-scrollbar-thumb:hover) {
    background: rgba(156, 163, 175, 0.8);
  }
</style>

