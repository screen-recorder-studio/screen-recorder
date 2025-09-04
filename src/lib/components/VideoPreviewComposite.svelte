<!-- 视频预览组件 - 使用 VideoComposite Worker 进行背景合成 -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'

  // Props
  interface Props {
    encodedChunks?: any[]
    isRecordingComplete?: boolean
    displayWidth?: number
    displayHeight?: number
    showControls?: boolean
    showTimeline?: boolean
    className?: string
  }

  let {
    encodedChunks = [],
    isRecordingComplete = false,
    displayWidth = 640,
    displayHeight = 360,
    showControls = true,
    showTimeline = true,
    className = ''
  }: Props = $props()

  // 使用全局背景配置
  const backgroundConfig = $derived(backgroundConfigStore.config)

  // 状态变量 - 仅显示相关
  let canvas: HTMLCanvasElement
  let bitmapCtx: ImageBitmapRenderingContext | null = null
  let isInitialized = $state(false)
  let isProcessing = $state(false)
  let compositeWorker: Worker | null = null
  
  // 播放控制状态
  let currentFrameIndex = $state(0)
  let totalFrames = $state(0)
  let currentTime = $state(0)
  let duration = $state(0)
  let frameRate = 30
  let isPlaying = $state(false)
  let playbackSpeed = $state(1.0)

  // 输出尺寸信息
  let outputWidth = $state(1920)
  let outputHeight = $state(1080)

  // 预览尺寸 - 根据输出比例动态调整
  let previewWidth = $state(displayWidth)
  let previewHeight = $state(displayHeight)

  // 更新预览尺寸 - 根据输出比例调整预览显示
  function updatePreviewSize() {
    const aspectRatio = outputWidth / outputHeight
    const maxWidth = displayWidth
    const maxHeight = displayHeight

    // 计算适合的预览尺寸，保持纵横比，并确保充分利用空间
    if (aspectRatio > maxWidth / maxHeight) {
      // 宽度受限
      previewWidth = maxWidth
      previewHeight = Math.round(maxWidth / aspectRatio)
    } else {
      // 高度受限
      previewHeight = maxHeight
      previewWidth = Math.round(maxHeight * aspectRatio)
    }

    // 确保最小尺寸，避免过小的预览
    const minSize = 200
    if (previewWidth < minSize || previewHeight < minSize) {
      if (aspectRatio > 1) {
        // 横屏视频
        previewWidth = Math.max(minSize, previewWidth)
        previewHeight = Math.round(previewWidth / aspectRatio)
      } else {
        // 竖屏视频
        previewHeight = Math.max(minSize, previewHeight)
        previewWidth = Math.round(previewHeight * aspectRatio)
      }
    }

    console.log('📐 [VideoPreview] Preview size updated:', {
      outputSize: { width: outputWidth, height: outputHeight },
      previewSize: { width: previewWidth, height: previewHeight },
      aspectRatio,
      displayConstraints: { maxWidth, maxHeight }
    })
  }

  // 初始化 Canvas（仅用于显示）
  function initializeCanvas() {
    if (!canvas) return

    // 使用 ImageBitmapRenderingContext 进行高效显示
    bitmapCtx = canvas.getContext('bitmaprenderer')

    if (!bitmapCtx) {
      console.error('❌ [VideoPreview] Failed to get ImageBitmapRenderingContext')
      return
    }

    // 不设置固定尺寸，让 CSS 控制显示尺寸
    // Canvas 会自动适应容器大小
    console.log('🎨 [VideoPreview] Canvas container size:', {
      containerWidth: canvas.parentElement?.clientWidth,
      containerHeight: canvas.parentElement?.clientHeight
    })

    isInitialized = true
    console.log('🎨 [VideoPreview] Canvas initialized for bitmap rendering')
  }

  // 初始化 VideoComposite Worker
  function initializeWorker() {
    if (compositeWorker) return

    console.log('👷 [VideoPreview] Creating VideoComposite Worker...')
    
    compositeWorker = new Worker(
      new URL('../workers/video-composite-worker.ts', import.meta.url),
      { type: 'module' }
    )

    // Worker 消息处理
    compositeWorker.onmessage = (event) => {
      const { type, data } = event.data

      switch (type) {
        case 'initialized':
          console.log('✅ [VideoPreview] Worker initialized')
          break

        case 'ready':
          console.log('✅ [VideoPreview] Video processing ready:', data)
          totalFrames = data.totalFrames
          duration = totalFrames / frameRate
          outputWidth = data.outputSize.width
          outputHeight = data.outputSize.height
          
          // 更新 Canvas 内部分辨率
          canvas.width = outputWidth
          canvas.height = outputHeight
          
          isProcessing = false
          break

        case 'frame':
          // 显示合成后的帧
          displayFrame(data.bitmap, data.frameIndex, data.timestamp)
          break

        case 'sizeChanged':
          // 处理输出尺寸变化
          console.log('📐 [VideoPreview] Output size changed:', data)
          outputWidth = data.outputSize.width
          outputHeight = data.outputSize.height

          // 更新预览尺寸
          updatePreviewSize()

          // 更新 Canvas 内部分辨率
          canvas.width = outputWidth
          canvas.height = outputHeight
          break

        case 'complete':
          console.log('🎉 [VideoPreview] Playback completed')
          isPlaying = false
          break

        case 'error':
          console.error('❌ [VideoPreview] Worker error:', data)
          isProcessing = false
          break

        default:
          console.warn('⚠️ [VideoPreview] Unknown worker message:', type)
      }
    }

    compositeWorker.onerror = (error) => {
      console.error('❌ [VideoPreview] Worker error:', error)
      isProcessing = false
    }

    // 初始化 Worker
    compositeWorker.postMessage({ type: 'init' })
  }

  // 显示帧（核心显示逻辑）
  function displayFrame(bitmap: ImageBitmap, frameIndex: number, timestamp: number) {
    if (!bitmapCtx) {
      console.error('❌ [VideoPreview] Bitmap context not available')
      return
    }

    try {
      // 高效显示 ImageBitmap
      bitmapCtx.transferFromImageBitmap(bitmap)
      
      // 更新播放状态
      currentFrameIndex = frameIndex
      currentTime = timestamp / 1000000 // 微秒转秒
      
      console.log(`🎬 [VideoPreview] Frame displayed: ${frameIndex}/${totalFrames}`)
    } catch (error) {
      console.error('❌ [VideoPreview] Display error:', error)
    }
  }

  // 处理视频数据
  function processVideo() {
    if (!compositeWorker || !encodedChunks.length) {
      console.warn('⚠️ [VideoPreview] Cannot process: missing worker or chunks')
      return
    }

    console.log('🎬 [VideoPreview] Processing video with background config:', backgroundConfig)

    isProcessing = true

    // 准备可传输的数据块
    const transferableChunks = encodedChunks.map(chunk => ({
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

    // 将 Svelte 5 的 Proxy 对象转换为普通对象
    const plainBackgroundConfig = {
      type: backgroundConfig.type,
      color: backgroundConfig.color,
      padding: backgroundConfig.padding,
      outputRatio: backgroundConfig.outputRatio,
      videoPosition: backgroundConfig.videoPosition,
      borderRadius: backgroundConfig.borderRadius,
      inset: backgroundConfig.inset,
      // 深度转换 shadow 对象
      shadow: backgroundConfig.shadow ? {
        offsetX: backgroundConfig.shadow.offsetX,
        offsetY: backgroundConfig.shadow.offsetY,
        blur: backgroundConfig.shadow.blur,
        color: backgroundConfig.shadow.color
      } : undefined
    }

    console.log('📤 [VideoPreview] Sending config to worker:', plainBackgroundConfig);

    compositeWorker.postMessage({
      type: 'process',
      data: {
        chunks: transferableChunks,
        backgroundConfig: plainBackgroundConfig
      }
    }, { transfer: transferList })
  }

  // 播放控制
  function play() {
    if (!compositeWorker || totalFrames === 0) return
    
    console.log('▶️ [VideoPreview] Starting playback')
    isPlaying = true
    
    compositeWorker.postMessage({ type: 'play' })
  }

  function pause() {
    if (!compositeWorker) return
    
    console.log('⏸️ [VideoPreview] Pausing playback')
    isPlaying = false
    
    compositeWorker.postMessage({ type: 'pause' })
  }

  function stop() {
    pause()
    seekToFrame(0)
  }

  function seekToFrame(frameIndex: number) {
    if (!compositeWorker || frameIndex < 0 || frameIndex >= totalFrames) return
    
    console.log('⏭️ [VideoPreview] Seeking to frame:', frameIndex)
    
    compositeWorker.postMessage({
      type: 'seek',
      data: { frameIndex }
    })
  }

  function seekToTime(time: number) {
    const frameIndex = Math.floor(time * frameRate)
    seekToFrame(frameIndex)
  }

  // 更新背景配置
  function updateBackgroundConfig(newConfig: typeof backgroundConfig) {
    if (!compositeWorker) return

    // 将 Svelte 5 的 Proxy 对象转换为普通对象
    const plainConfig = {
      type: newConfig.type,
      color: newConfig.color,
      padding: newConfig.padding,
      outputRatio: newConfig.outputRatio,
      videoPosition: newConfig.videoPosition,
      borderRadius: newConfig.borderRadius,
      inset: newConfig.inset,
      // 深度转换 shadow 对象
      shadow: newConfig.shadow ? {
        offsetX: newConfig.shadow.offsetX,
        offsetY: newConfig.shadow.offsetY,
        blur: newConfig.shadow.blur,
        color: newConfig.shadow.color
      } : undefined
    }

    console.log('⚙️ [VideoPreview] Updating background config:', plainConfig)

    compositeWorker.postMessage({
      type: 'config',
      data: { backgroundConfig: plainConfig }
    })
  }

  // 响应式处理 - 只在录制完成后处理一次
  let hasProcessed = false

  $effect(() => {
    console.log('🔍 [VideoPreview] Effect triggered:', {
      isRecordingComplete,
      chunksLength: encodedChunks.length,
      hasProcessed,
      isInitialized,
      hasWorker: !!compositeWorker
    })

    // 只有当录制完成且有编码块时才处理
    if (isRecordingComplete &&
        encodedChunks.length > 0 &&
        !hasProcessed &&
        isInitialized &&
        compositeWorker) {

      console.log('🎬 [VideoPreview] Processing completed recording with', encodedChunks.length, 'chunks')
      hasProcessed = true
      processVideo()
    }
  })

  $effect(() => {
    if (backgroundConfig && compositeWorker && totalFrames > 0) {
      updateBackgroundConfig(backgroundConfig)
    }
  })

  // 响应输出尺寸变化，更新预览尺寸
  $effect(() => {
    if (outputWidth > 0 && outputHeight > 0) {
      updatePreviewSize()
    }
  })

  // 组件挂载
  onMount(() => {
    initializeCanvas()
    initializeWorker()

    // 清理函数
    return () => {
      if (compositeWorker) {
        compositeWorker.terminate()
        compositeWorker = null
      }
    }
  })

  // 导出控制方法
  export function getControls() {
    return {
      play,
      pause,
      stop,
      seekToFrame,
      seekToTime,
      updateBackgroundConfig,
      getCurrentFrame: () => currentFrameIndex,
      getCurrentTime: () => currentTime,
      getTotalFrames: () => totalFrames,
      getDuration: () => duration,
      isPlaying: () => isPlaying
    }
  }
</script>

<!-- 视频预览容器 -->
<div class="video-preview {className}">
  <!-- 预览信息栏 -->
  <div class="preview-info-bar">
    <span class="preview-title">视频预览</span>
    <span class="preview-ratio">{backgroundConfig.outputRatio === 'custom' ? `${outputWidth}×${outputHeight}` : backgroundConfig.outputRatio}</span>
  </div>

  <!-- Canvas 显示区域 -->
  <div class="canvas-container" style="width: {previewWidth}px; height: {previewHeight}px;">
    <canvas
      bind:this={canvas}
      class="video-canvas"
      class:processing={isProcessing}
      style="width: {previewWidth}px; height: {previewHeight}px;"
    ></canvas>

    {#if isProcessing}
      <div class="processing-overlay">
        <div class="spinner"></div>
        <span>正在处理视频...</span>
      </div>
    {/if}
  </div>

  <!-- 播放控制 -->
  {#if showControls && totalFrames > 0}
    <div class="controls-bar">
      <div class="playback-controls">
        <button 
          class="control-btn" 
          onclick={isPlaying ? pause : play}
          disabled={isProcessing}
        >
          {isPlaying ? '⏸️' : '▶️'}
        </button>
        
        <button 
          class="control-btn" 
          onclick={stop}
          disabled={isProcessing}
        >
          ⏹️
        </button>
        
        <span class="time-display">
          {Math.floor(currentTime)}s / {Math.floor(duration)}s
        </span>
      </div>

      <div class="frame-info">
        <span>帧: {currentFrameIndex + 1}/{totalFrames}</span>
        <span>分辨率: {outputWidth}×{outputHeight}</span>
      </div>
    </div>
  {/if}

  <!-- 时间轴 -->
  {#if showTimeline && totalFrames > 0}
    <div class="timeline-container">
      <input
        type="range"
        class="timeline-slider"
        min="0"
        max={totalFrames - 1}
        value={currentFrameIndex}
        oninput={(e) => seekToFrame(parseInt((e.target as HTMLInputElement).value))}
        disabled={isProcessing}
      />
    </div>
  {/if}
</div>

<style>
  .video-preview {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background-color: #1a1a1a;
    border-radius: 8px;
    padding: 1rem;
    overflow: hidden;
  }

  .preview-info-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid #374151;
  }

  .preview-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: #f3f4f6;
  }

  .preview-ratio {
    font-size: 0.75rem;
    font-weight: 500;
    color: #8b5cf6;
    background-color: rgba(139, 92, 246, 0.1);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }

  .canvas-container {
    position: relative;
    background-color: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    overflow: hidden;
    margin: 0 auto; /* 居中显示 */
  }

  .video-canvas {
    display: block;
    transition: opacity 0.3s ease;
    border-radius: 4px;
  }

  .video-canvas.processing {
    opacity: 0.5;
  }

  .processing-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.5);
    color: white;
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    border: 4px solid #3b82f6;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 0.5rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .controls-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    background-color: #374151;
    color: white;
    font-size: 0.875rem;
  }

  .playback-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .control-btn {
    background: none;
    border: 1px solid #6b7280;
    color: white;
    padding: 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s ease;
  }

  .control-btn:hover:not(:disabled) {
    background-color: #4b5563;
    border-color: #9ca3af;
  }

  .control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .time-display {
    font-family: monospace;
    font-size: 0.875rem;
    color: #d1d5db;
  }

  .frame-info {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .timeline-container {
    padding: 0.5rem 0.75rem;
    background-color: #374151;
  }

  .timeline-slider {
    width: 100%;
    height: 4px;
    background: #4b5563;
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .timeline-slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
  }

  .timeline-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .timeline-slider:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
