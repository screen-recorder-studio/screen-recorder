<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { ChromeAPIWrapper } from '$lib/utils/chrome-api'

  // 录制状态
  let isRecording = false
  let duration = 0
  let status: 'idle' | 'requesting' | 'recording' | 'stopping' | 'error' = 'idle'
  let errorMessage = ''

  // 录制相关变量
  let mediaRecorder: MediaRecorder | null = null
  let recordedChunks: Blob[] = []
  let stream: MediaStream | null = null
  let durationTimer: number | null = null
  let startTime: number | null = null

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
    console.log('📱 Sidepanel mounted')

    // 检查扩展环境
    checkExtensionEnvironment()

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

<div class="sidepanel-container">
  <h1>屏幕录制</h1>

  <div class="status-section">
    <div class="status-indicator" class:recording={isRecording} class:error={status === 'error'}>
      {#if status === 'requesting'}
        🔄 请求权限中...
      {:else if status === 'recording'}
        🔴 录制中 - {formatDuration(duration)}
      {:else if status === 'stopping'}
        ⏹️ 停止中...
      {:else if status === 'error'}
        ❌ {errorMessage}
      {:else}
        ✅ 就绪
      {/if}
    </div>
  </div>

  {#if status === 'recording'}
    <div class="recording-info">
      <div class="info-item">
        <span class="label">录制时长:</span>
        <span class="value">{formatDuration(duration)}</span>
      </div>
      <div class="info-item">
        <span class="label">状态:</span>
        <span class="value recording-status">● 录制中</span>
      </div>
    </div>
  {/if}

  <div class="controls">
    <button
      class="record-button"
      class:recording={isRecording}
      class:requesting={status === 'requesting'}
      class:stopping={status === 'stopping'}
      disabled={status === 'requesting' || status === 'stopping'}
      on:click={handleRecordButtonClick}
    >
      {#if status === 'requesting'}
        🔄 请求权限...
      {:else if status === 'stopping'}
        ⏹️ 停止中...
      {:else if isRecording}
        ⏹️ 停止录制
      {:else}
        🎥 开始录制
      {/if}
    </button>
  </div>

  {#if errorMessage}
    <div class="error-section">
      <div class="error-message">
        <strong>错误:</strong> {errorMessage}
      </div>
      <div class="error-help">
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
          <p>请检查权限设置或重试</p>
          <p>错误详情: {errorMessage}</p>
        {/if}
      </div>
    </div>
  {/if}

  <div class="info-section">
    <h3>使用说明</h3>
    <ul>
      <li>点击"开始录制"按钮启动屏幕录制</li>
      <li>选择要录制的屏幕、窗口或标签页</li>
      <li>录制完成后文件将自动保存到下载文件夹</li>
      <li>支持高质量WebM格式录制</li>
    </ul>
  </div>
</div>

<style>
  .sidepanel-container {
    padding: 16px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow-y: auto;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1f2937;
    text-align: center;
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  .status-section {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .status-indicator {
    padding: 12px 16px;
    border-radius: 8px;
    background: #f3f4f6;
    color: #6b7280;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    min-width: 200px;
    border: 2px solid transparent;
    transition: all 0.2s ease;
  }

  .status-indicator.recording {
    background: #fef2f2;
    color: #dc2626;
    border-color: #fecaca;
    animation: pulse 2s infinite;
  }

  .status-indicator.error {
    background: #fef2f2;
    color: #dc2626;
    border-color: #fca5a5;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .recording-info {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .info-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .label {
    font-size: 13px;
    color: #6b7280;
    font-weight: 500;
  }

  .value {
    font-size: 13px;
    color: #1f2937;
    font-weight: 600;
  }

  .recording-status {
    color: #dc2626;
    animation: blink 1.5s infinite;
  }

  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0.3; }
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .record-button {
    padding: 16px 24px;
    border: none;
    border-radius: 8px;
    background: #3b82f6;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    overflow: hidden;
  }

  .record-button:hover:not(:disabled) {
    background: #2563eb;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .record-button.recording {
    background: #dc2626;
  }

  .record-button.recording:hover:not(:disabled) {
    background: #b91c1c;
    box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
  }

  .record-button.requesting {
    background: #f59e0b;
  }

  .record-button.stopping {
    background: #6b7280;
  }

  .record-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .error-section {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    padding: 16px;
    margin: 12px 0;
  }

  .error-message {
    color: #dc2626;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 12px;
  }

  .error-help {
    color: #991b1b;
    font-size: 13px;
    line-height: 1.5;
  }

  .error-help p {
    margin: 8px 0;
  }

  .error-help ol, .error-help ul {
    margin: 8px 0;
    padding-left: 20px;
  }

  .error-help li {
    margin: 4px 0;
    line-height: 1.4;
  }

  .error-help ul ul {
    margin: 4px 0;
    padding-left: 16px;
  }

  .error-help strong {
    color: #7f1d1d;
  }

  .info-section {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 8px;
    padding: 12px;
    margin-top: auto;
  }

  .info-section ul {
    margin: 8px 0 0 0;
    padding-left: 16px;
  }

  .info-section li {
    font-size: 12px;
    color: #0369a1;
    margin-bottom: 4px;
    line-height: 1.4;
  }

  /* 响应式设计 */
  @media (max-width: 320px) {
    .sidepanel-container {
      padding: 12px;
      gap: 12px;
    }

    .status-indicator {
      min-width: 160px;
      padding: 10px 12px;
      font-size: 13px;
    }

    .record-button {
      padding: 14px 20px;
      font-size: 14px;
    }
  }
</style>