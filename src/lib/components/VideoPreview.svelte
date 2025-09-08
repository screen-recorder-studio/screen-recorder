<!-- 视频预览组件 - 用于预览和编辑录制的视频 -->
<script lang="ts">
  import { onMount } from 'svelte'

  // Props
  interface Props {
    displayWidth?: number      // 显示宽度
    displayHeight?: number     // 显示高度
    canvasWidth?: number       // Canvas 内部分辨率宽度
    canvasHeight?: number      // Canvas 内部分辨率高度
    aspectRatio?: string
    showControls?: boolean
    showTimeline?: boolean
    encodedChunks?: any[]
    isDecoding?: boolean
    className?: string
  }

  let {
    displayWidth = 640,        // 显示尺寸
    displayHeight = 360,
    canvasWidth = 1920,        // 内部高分辨率
    canvasHeight = 1080,
    aspectRatio = '16/9',
    showControls = true,
    showTimeline = true,
    encodedChunks = [],
    isDecoding = false,
    className = ''
  }: Props = $props()

  // 组件状态
  let canvas: HTMLCanvasElement
  let context: CanvasRenderingContext2D | null = null
  let videoDecoder: VideoDecoder | null = null
  let decodedFrames = $state<VideoFrame[]>([])
  let currentFrameIndex = $state(0)
  let isPlaying = $state(false)
  let playbackSpeed = $state(1.0)
  let totalFrames = $state(0)
  let currentTime = $state(0)
  let duration = $state(0)
  let isInitialized = $state(false)
  let lastProcessedChunksLength = $state(0)
  let isCurrentlyDecoding = $state(false)

  // 播放控制
  let playbackTimer: ReturnType<typeof setInterval> | null = null
  let frameRate = 30 // fps

  // 初始化 Canvas
  function initializeCanvas() {
    if (!canvas) return

    // 设置 Canvas 内部高分辨率
    canvas.width = canvasWidth
    canvas.height = canvasHeight

    // 不设置 CSS 尺寸，让 CSS 样式控制显示
    // Canvas 会通过 CSS 自动缩放到容器大小

    context = canvas.getContext('2d')

    if (context) {
      // 设置初始背景
      context.fillStyle = '#1a1a1a'
      context.fillRect(0, 0, canvas.width, canvas.height)

      // 绘制占位符（适应高分辨率）
      context.fillStyle = '#666666'
      context.font = '48px Arial'  // 更大字体适应高分辨率
      context.textAlign = 'center'
      context.fillText('等待视频数据...', canvas.width / 2, canvas.height / 2)

      isInitialized = true
      console.log('🎨 [VideoPreview] Canvas initialized:', {
        canvasResolution: `${canvasWidth}x${canvasHeight}`,
        displaySize: `${displayWidth}x${displayHeight}`
      })
    }
  }

  // 解码视频块到帧
  async function decodeVideoChunks(chunks: any[]) {
    if (!chunks.length || !context || isCurrentlyDecoding) return

    try {
      console.log('🎬 [VideoPreview] Starting to decode', chunks.length, 'chunks')
      isCurrentlyDecoding = true

      // 清空之前的帧
      decodedFrames.forEach(frame => frame.close())
      decodedFrames = []
      currentFrameIndex = 0

      // 关闭之前的解码器
      if (videoDecoder) {
        try {
          videoDecoder.close()
        } catch (e) {
          // 忽略关闭错误
        }
      }

      // 动态检测实际编码分辨率（从第一个编码块）
      let actualWidth = canvasWidth
      let actualHeight = canvasHeight

      if (chunks.length > 0) {
        const firstChunk = chunks[0]
        // 尝试从编码块中获取实际分辨率信息
        if (firstChunk.codedWidth && firstChunk.codedHeight) {
          actualWidth = firstChunk.codedWidth
          actualHeight = firstChunk.codedHeight
          console.log(`🎬 [VideoPreview] Detected actual resolution from chunk: ${actualWidth}x${actualHeight}`)
        } else {
          console.log(`🎬 [VideoPreview] Using default resolution: ${actualWidth}x${actualHeight}`)
        }
      }

      // 如果检测到的分辨率与 Canvas 不匹配，调整 Canvas
      if (actualWidth !== canvas.width || actualHeight !== canvas.height) {
        console.log(`🎬 [VideoPreview] Adjusting Canvas resolution from ${canvas.width}x${canvas.height} to ${actualWidth}x${actualHeight}`)
        canvas.width = actualWidth
        canvas.height = actualHeight

        // 重新获取 context
        context = canvas.getContext('2d')
      }

      // 创建新的 VideoDecoder
      videoDecoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          decodedFrames.push(frame)
          console.log(`🎬 [VideoPreview] Decoded frame ${decodedFrames.length}, size: ${frame.codedWidth}x${frame.codedHeight}, timestamp: ${frame.timestamp}`)

          // 如果是第一帧，立即显示
          if (decodedFrames.length === 1) {
            renderFrame(0)
          }
        },
        error: (error) => {
          console.error('❌ [VideoPreview] VideoDecoder error:', error)
          isCurrentlyDecoding = false
        }
      })

      // 配置解码器（使用检测到的实际分辨率）
      const decoderConfig = {
        codec: 'vp8',
        codedWidth: actualWidth,
        codedHeight: actualHeight
      }

      console.log('🎬 [VideoPreview] Configuring decoder with:', decoderConfig)
      videoDecoder.configure(decoderConfig)

      // 解码所有块
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]

        try {
          const encodedChunk = new EncodedVideoChunk({
            type: chunk.type === 'key' ? 'key' : 'delta',
            timestamp: chunk.timestamp,
            data: chunk.data
          })

          videoDecoder.decode(encodedChunk)
        } catch (error) {
          console.error(`❌ [VideoPreview] Error decoding chunk ${i}:`, error)
        }
      }

      // 等待解码完成
      await videoDecoder.flush()

      totalFrames = decodedFrames.length
      duration = totalFrames / frameRate
      lastProcessedChunksLength = chunks.length

      console.log(`🎬 [VideoPreview] Decoding completed: ${totalFrames} frames, ${duration.toFixed(2)}s`)

    } catch (error) {
      console.error('❌ [VideoPreview] Error in decodeVideoChunks:', error)
    } finally {
      isCurrentlyDecoding = false
    }
  }

  // 渲染指定帧
  function renderFrame(frameIndex: number) {
    if (!context || !decodedFrames[frameIndex]) return

    const frame = decodedFrames[frameIndex]

    // 清空画布
    context.fillStyle = '#1a1a1a'
    context.fillRect(0, 0, canvas.width, canvas.height)

    // 获取视频帧的实际尺寸
    const frameWidth = frame.codedWidth || frame.displayWidth
    const frameHeight = frame.codedHeight || frame.displayHeight

    console.log(`🎨 [VideoPreview] Rendering frame ${frameIndex}: frame=${frameWidth}x${frameHeight}, canvas=${canvas.width}x${canvas.height}`)

    // 方案1：直接拉伸填满整个 Canvas（简单有效）
    context.drawImage(frame, 0, 0, canvas.width, canvas.height)

    // 如果需要保持宽高比，可以使用下面的代码：
    /*
    // 计算缩放比例以填满 Canvas（保持宽高比）
    const scaleX = canvas.width / frameWidth
    const scaleY = canvas.height / frameHeight
    const scale = Math.max(scaleX, scaleY) // 使用较大的缩放比例以填满区域

    // 计算居中位置
    const scaledWidth = frameWidth * scale
    const scaledHeight = frameHeight * scale
    const offsetX = (canvas.width - scaledWidth) / 2
    const offsetY = (canvas.height - scaledHeight) / 2

    // 绘制视频帧（填满预览区域）
    context.drawImage(
      frame,
      offsetX, offsetY,
      scaledWidth, scaledHeight
    )
    */

    currentFrameIndex = frameIndex
    currentTime = frameIndex / frameRate

    console.log(`🎨 [VideoPreview] Frame rendered: stretched to ${canvas.width}x${canvas.height}`)
  }

  // 播放控制
  function play() {
    if (isPlaying || !decodedFrames.length) return
    
    isPlaying = true
    const frameInterval = 1000 / (frameRate * playbackSpeed)
    
    playbackTimer = setInterval(() => {
      if (currentFrameIndex >= decodedFrames.length - 1) {
        pause()
        return
      }
      
      renderFrame(currentFrameIndex + 1)
    }, frameInterval)
    
    console.log('▶️ [VideoPreview] Playback started')
  }

  function pause() {
    isPlaying = false
    if (playbackTimer) {
      clearInterval(playbackTimer)
      playbackTimer = null
    }
    console.log('⏸️ [VideoPreview] Playback paused')
  }

  function stop() {
    pause()
    currentFrameIndex = 0
    renderFrame(0)
    console.log('⏹️ [VideoPreview] Playback stopped')
  }

  function seekToFrame(frameIndex: number) {
    if (frameIndex < 0 || frameIndex >= decodedFrames.length) return
    
    pause()
    renderFrame(frameIndex)
    console.log(`⏭️ [VideoPreview] Seeked to frame ${frameIndex}`)
  }

  function seekToTime(time: number) {
    const frameIndex = Math.floor(time * frameRate)
    seekToFrame(frameIndex)
  }

  // 格式化时间显示
  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // 响应式更新
  $effect(() => {
    if (canvas && !isInitialized) {
      initializeCanvas()
    }
  })

  $effect(() => {
    // 只有当编码块数量发生变化且不在解码中时才触发解码
    if (encodedChunks.length > 0 &&
        isInitialized &&
        !isCurrentlyDecoding &&
        encodedChunks.length !== lastProcessedChunksLength) {
      decodeVideoChunks(encodedChunks)
    }
  })

  // 清理资源
  onMount(() => {
    return () => {
      if (playbackTimer) {
        clearInterval(playbackTimer)
      }
      decodedFrames.forEach(frame => frame.close())
      if (videoDecoder) {
        videoDecoder.close()
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
  <!-- Canvas 显示区域 -->
  <div class="canvas-container" style="aspect-ratio: {aspectRatio};">
    <canvas
      bind:this={canvas}
      class="video-canvas"
      class:decoding={isDecoding}
    ></canvas>
    
    {#if isDecoding}
      <div class="decoding-overlay">
        <div class="spinner"></div>
        <span>正在解码视频...</span>
      </div>
    {/if}
  </div>

  <!-- 播放控制栏 -->
  {#if showControls && totalFrames > 0}
    <div class="controls-bar">
      <div class="playback-controls">
        <button
          class="control-btn"
          onclick={isPlaying ? pause : play}
          disabled={!decodedFrames.length}
        >
          {isPlaying ? '⏸️' : '▶️'}
        </button>
        
        <button
          class="control-btn"
          onclick={stop}
          disabled={!decodedFrames.length}
        >
          ⏹️
        </button>
        
        <span class="time-display">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div class="speed-control">
        <label for="playback-speed">速度:</label>
        <select id="playback-speed" bind:value={playbackSpeed}>
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
      </div>
    </div>
  {/if}

  <!-- 时间轴 -->
  {#if showTimeline && totalFrames > 0}
    <div class="timeline">
      <input
        type="range"
        min="0"
        max={totalFrames - 1}
        value={currentFrameIndex}
        oninput={(e) => seekToFrame(parseInt((e.target as HTMLInputElement).value))}
        class="timeline-slider"
      />
      <div class="frame-info">
        帧 {currentFrameIndex + 1} / {totalFrames}
      </div>
    </div>
  {/if}
</div>

<style>
  .video-preview {
    background-color: #1a1a1a;
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .canvas-container {
    position: relative;
    width: 100%;
    background-color: black;
  }

  .video-canvas {
    width: 100%;
    height: 100%;
    object-fit: fill;  /* 拉伸填满容器 */
    transition: opacity 0.3s ease;
    display: block;
  }

  .video-canvas.decoding {
    opacity: 0.5;
  }

  .decoding-overlay {
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
    to {
      transform: rotate(360deg);
    }
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
    padding: 0.25rem 0.75rem;
    background-color: #2563eb;
    color: white;
    border-radius: 0.25rem;
    border: none;
    cursor: pointer;
  }

  .control-btn:hover {
    background-color: #1d4ed8;
  }

  .control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .time-display {
    font-family: monospace;
    color: #d1d5db;
  }

  .speed-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .speed-control select {
    background-color: #4b5563;
    color: white;
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.875rem;
    border: none;
  }

  .timeline {
    padding: 0.75rem;
    background-color: #374151;
    color: white;
  }

  .timeline-slider {
    width: 100%;
    height: 0.5rem;
    background-color: #6b7280;
    border-radius: 0.5rem;
    appearance: none;
    cursor: pointer;
    border: none;
    outline: none;
  }

  .timeline-slider::-webkit-slider-thumb {
    appearance: none;
    width: 1rem;
    height: 1rem;
    background-color: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
  }

  .timeline-slider::-moz-range-thumb {
    width: 1rem;
    height: 1rem;
    background-color: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .frame-info {
    font-size: 0.75rem;
    color: #9ca3af;
    margin-top: 0.5rem;
    text-align: center;
  }
</style>
