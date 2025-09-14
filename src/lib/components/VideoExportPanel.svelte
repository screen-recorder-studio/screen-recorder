<!-- 视频导出面板组件 -->
<script lang="ts">
  import { Download, Video, Film, LoaderCircle, Info, TriangleAlert, CircleCheck, Clock } from '@lucide/svelte'
  import { ExportManager } from '$lib/services/export-manager'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'

  // Props
  interface Props {
    encodedChunks?: any[]
    isRecordingComplete?: boolean
    totalFramesAll?: number
    opfsDirId?: string
    className?: string
  }

  let {
    encodedChunks = [],
    isRecordingComplete = false,
    totalFramesAll = 0,
    opfsDirId = '',
    className = ''
  }: Props = $props()

  // 显示用总帧数：优先使用全量(totalFramesAll)，否则退回当前窗口(encodedChunks.length)
  const displayTotalFrames = $derived(totalFramesAll > 0 ? totalFramesAll : encodedChunks.length)

  // 使用全局背景配置
  const backgroundConfig = $derived(backgroundConfigStore.config)

  // 导出状态
  let isExportingWebM = $state(false)
  let isExportingMP4 = $state(false)
  let exportProgress = $state<{
    type: 'webm' | 'mp4'
    stage: 'preparing' | 'compositing' | 'encoding' | 'muxing' | 'finalizing'
    progress: number
    currentFrame: number
    totalFrames: number
    estimatedTimeRemaining: number
  } | null>(null)


  // 平滑显示的导出进度，避免高频率更新导致 UI 闪动
  let displayedProgress = $state(0)
  let targetProgress = $state(0)
  let rafId: number | null = null

  function resetProgressAnimation() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    displayedProgress = 0
    targetProgress = 0
  }

  function animateProgress() {
    if (rafId) return
    const step = () => {
      const diff = targetProgress - displayedProgress
      if (Math.abs(diff) < 0.5) {
        displayedProgress = targetProgress
        rafId = null
        return
      }
      // 缓动到目标，降低重绘频率，减少闪动
      displayedProgress += diff * 0.25
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
  }

  function setProgressTarget(p: number) {
    // 防止进度回退造成的视觉跳变
    const clamped = Math.max(0, Math.min(100, p))
    if (clamped >= targetProgress) {
      targetProgress = clamped
      animateProgress()
    }
  }

  // 节流导出进度字段更新，降低模板重渲染频率
  let pendingProgress: {
    stage: 'preparing' | 'compositing' | 'encoding' | 'muxing' | 'finalizing'
    currentFrame: number
    totalFrames: number
    estimatedTimeRemaining: number
  } | null = null
  let scheduled = false
  let lastUIUpdate = 0
  const MIN_UPDATE_INTERVAL = 80 // 毫秒

  function scheduleProgressFieldsUpdate() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      const now = performance.now()
      if (now - lastUIUpdate < MIN_UPDATE_INTERVAL) return
      lastUIUpdate = now
      if (exportProgress && pendingProgress) {
        exportProgress.stage = pendingProgress.stage
        exportProgress.currentFrame = pendingProgress.currentFrame
        exportProgress.totalFrames = pendingProgress.totalFrames
        exportProgress.estimatedTimeRemaining = pendingProgress.estimatedTimeRemaining || 0
      }
    })
  }


  // 导出管理器
  const exportManager = new ExportManager()

  // 检查是否可以导出
  const canExport = $derived(
    isRecordingComplete &&
    encodedChunks.length > 0 &&
    !isExportingWebM &&
    !isExportingMP4
  )

  // 导出 WebM
  async function exportWebM() {
    if (!canExport) return

    try {
      isExportingWebM = true
      exportProgress = {
        type: 'webm',
        stage: 'preparing',
        progress: 0,
        currentFrame: 0,
        totalFrames: encodedChunks.length,
        estimatedTimeRemaining: 0
      }

      console.log('🎬 [Export] Starting WebM export with', encodedChunks.length, 'chunks')

      // 将 Svelte 5 的 Proxy 对象转换为普通对象
      const plainBackgroundConfig = backgroundConfig ? {
        type: backgroundConfig.type,
        color: backgroundConfig.color,
        padding: backgroundConfig.padding,
        outputRatio: backgroundConfig.outputRatio,
        videoPosition: backgroundConfig.videoPosition,
        borderRadius: backgroundConfig.borderRadius,
        inset: backgroundConfig.inset,
        // 深度转换 gradient 对象
        gradient: backgroundConfig.gradient ? {
          type: backgroundConfig.gradient.type,
          ...(backgroundConfig.gradient.type === 'linear' && 'angle' in backgroundConfig.gradient ? { angle: backgroundConfig.gradient.angle } : {}),
          ...(backgroundConfig.gradient.type === 'radial' && 'centerX' in backgroundConfig.gradient ? {
            centerX: backgroundConfig.gradient.centerX,
            centerY: backgroundConfig.gradient.centerY,
            radius: backgroundConfig.gradient.radius
          } : {}),
          ...(backgroundConfig.gradient.type === 'conic' && 'centerX' in backgroundConfig.gradient ? {
            centerX: backgroundConfig.gradient.centerX,
            centerY: backgroundConfig.gradient.centerY,
            angle: 'angle' in backgroundConfig.gradient ? backgroundConfig.gradient.angle : 0
          } : {}),
          stops: backgroundConfig.gradient.stops.map(stop => ({
            color: stop.color,
            position: stop.position
          }))
        } : undefined,
        // 深度转换 shadow 对象
        shadow: backgroundConfig.shadow ? {
          offsetX: backgroundConfig.shadow.offsetX,
          offsetY: backgroundConfig.shadow.offsetY,
          blur: backgroundConfig.shadow.blur,
          color: backgroundConfig.shadow.color
        } : undefined,
        // 深度转换 image 对象
        image: backgroundConfig.image ? {
          imageId: backgroundConfig.image.imageId,
          imageBitmap: backgroundConfig.image.imageBitmap,
          fit: backgroundConfig.image.fit,
          position: backgroundConfig.image.position,
          opacity: backgroundConfig.image.opacity,
          blur: backgroundConfig.image.blur,
          scale: backgroundConfig.image.scale,
          offsetX: backgroundConfig.image.offsetX,
          offsetY: backgroundConfig.image.offsetY
        } : undefined,
        // 深度转换 wallpaper 对象
        wallpaper: backgroundConfig.wallpaper ? {
          imageId: backgroundConfig.wallpaper.imageId,
          imageBitmap: backgroundConfig.wallpaper.imageBitmap,
          fit: backgroundConfig.wallpaper.fit,
          position: backgroundConfig.wallpaper.position,
          opacity: backgroundConfig.wallpaper.opacity,
          blur: backgroundConfig.wallpaper.blur,
          scale: backgroundConfig.wallpaper.scale,
          offsetX: backgroundConfig.wallpaper.offsetX,
          offsetY: backgroundConfig.wallpaper.offsetY
        } : undefined
      } : undefined

      const videoBlob = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'webm',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig as any,
          quality: 'medium',
          source: opfsDirId ? 'opfs' : 'chunks',
          opfsDirId: opfsDirId || undefined
        },
        (progress) => {
          // 缓存并节流更新非关键字段，避免整块区域高频重渲染
          pendingProgress = {
            stage: progress.stage,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames,
            estimatedTimeRemaining: progress.estimatedTimeRemaining || 0
          }
          setProgressTarget(progress.progress)
          scheduleProgressFieldsUpdate()
        }
      )

      // 确保显示进度达 100%
      setProgressTarget(100)

      // 下载文件
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `edited-video-${timestamp}.webm`

      await downloadBlob(videoBlob, filename)

      console.log('✅ [Export] WebM export completed:', filename)

    } catch (error) {
      console.error('❌ [Export] WebM export failed:', error)
      // TODO: 显示错误提示
    } finally {
      isExportingWebM = false
      resetProgressAnimation()
      exportProgress = null
    }
  }

  // 导出 MP4
  async function exportMP4() {
    if (!canExport) return

    try {
      isExportingMP4 = true
      exportProgress = {
        type: 'mp4',
        stage: 'preparing',
        progress: 0,
        currentFrame: 0,
        totalFrames: encodedChunks.length,
        estimatedTimeRemaining: 0
      }

      console.log('🎬 [Export] Starting MP4 export with', encodedChunks.length, 'chunks')

      // 将 Svelte 5 的 Proxy 对象转换为普通对象
      const plainBackgroundConfig = backgroundConfig ? {
        type: backgroundConfig.type,
        color: backgroundConfig.color,
        padding: backgroundConfig.padding,
        outputRatio: backgroundConfig.outputRatio,
        videoPosition: backgroundConfig.videoPosition,
        borderRadius: backgroundConfig.borderRadius,
        inset: backgroundConfig.inset,
        // 深度转换 gradient 对象
        gradient: backgroundConfig.gradient ? {
          type: backgroundConfig.gradient.type,
          ...(backgroundConfig.gradient.type === 'linear' && 'angle' in backgroundConfig.gradient ? { angle: backgroundConfig.gradient.angle } : {}),
          ...(backgroundConfig.gradient.type === 'radial' && 'centerX' in backgroundConfig.gradient ? {
            centerX: backgroundConfig.gradient.centerX,
            centerY: backgroundConfig.gradient.centerY,
            radius: backgroundConfig.gradient.radius
          } : {}),
          ...(backgroundConfig.gradient.type === 'conic' && 'centerX' in backgroundConfig.gradient ? {
            centerX: backgroundConfig.gradient.centerX,
            centerY: backgroundConfig.gradient.centerY,
            angle: 'angle' in backgroundConfig.gradient ? backgroundConfig.gradient.angle : 0
          } : {}),
          stops: backgroundConfig.gradient.stops.map(stop => ({
            color: stop.color,
            position: stop.position
          }))
        } : undefined,
        // 深度转换 shadow 对象
        shadow: backgroundConfig.shadow ? {
          offsetX: backgroundConfig.shadow.offsetX,
          offsetY: backgroundConfig.shadow.offsetY,
          blur: backgroundConfig.shadow.blur,
          color: backgroundConfig.shadow.color
        } : undefined,
        // 深度转换 image 对象
        image: backgroundConfig.image ? {
          imageId: backgroundConfig.image.imageId,
          imageBitmap: backgroundConfig.image.imageBitmap,
          fit: backgroundConfig.image.fit,
          position: backgroundConfig.image.position,
          opacity: backgroundConfig.image.opacity,
          blur: backgroundConfig.image.blur,
          scale: backgroundConfig.image.scale,
          offsetX: backgroundConfig.image.offsetX,
          offsetY: backgroundConfig.image.offsetY
        } : undefined,
        // 深度转换 wallpaper 对象
        wallpaper: backgroundConfig.wallpaper ? {
          imageId: backgroundConfig.wallpaper.imageId,
          imageBitmap: backgroundConfig.wallpaper.imageBitmap,
          fit: backgroundConfig.wallpaper.fit,
          position: backgroundConfig.wallpaper.position,
          opacity: backgroundConfig.wallpaper.opacity,
          blur: backgroundConfig.wallpaper.blur,
          scale: backgroundConfig.wallpaper.scale,
          offsetX: backgroundConfig.wallpaper.offsetX,
          offsetY: backgroundConfig.wallpaper.offsetY
        } : undefined
      } : undefined

      const videoBlob = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'mp4',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig as any,
          quality: 'medium',
          source: opfsDirId ? 'opfs' : 'chunks',
          opfsDirId: opfsDirId || undefined
        },
        (progress) => {
          // 缓存并节流更新非关键字段，避免整块区域高频重渲染
          pendingProgress = {
            stage: progress.stage,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames,
            estimatedTimeRemaining: progress.estimatedTimeRemaining || 0
          }
          setProgressTarget(progress.progress)
          scheduleProgressFieldsUpdate()
        }
      )

      // 下载文件
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `edited-video-${timestamp}.mp4`

      // 确保显示进度达 100%
      setProgressTarget(100)

      await downloadBlob(videoBlob, filename)

      console.log('✅ [Export] MP4 export completed:', filename)

    } catch (error) {
      console.error('❌ [Export] MP4 export failed:', error)
      // TODO: 显示错误提示
    } finally {
      isExportingMP4 = false
      resetProgressAnimation()
      exportProgress = null
    }
  }

  // 下载 Blob 文件
  async function downloadBlob(blob: Blob, filename: string) {
    try {
      // 尝试使用 Chrome API
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        const url = URL.createObjectURL(blob)

        chrome.runtime.sendMessage({
          action: 'saveRecording',
          filename,
          url
        }, (response) => {
          URL.revokeObjectURL(url)
          if (!response?.success) {
            // 降级到直接下载
            directDownload(blob, filename)
          }
        })
      } else {
        // 直接下载
        directDownload(blob, filename)
      }
    } catch (error) {
      console.error('Download failed:', error)
      directDownload(blob, filename)
    }
  }

  // 直接下载
  function directDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'

    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 格式化进度阶段
  function formatStage(stage: string): string {
    const stageMap = {
      'preparing': '准备中',
      'compositing': '合成背景',
      'encoding': '编码中',
      'muxing': '封装容器',
      'finalizing': '完成中'
    }
    return stageMap[stage as keyof typeof stageMap] || stage
  }

  // 格式化时间
  function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}秒`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.round(seconds % 60)
    return `${minutes}分${remainingSeconds}秒`
  }
</script>

<!-- 导出面板 -->
<div class="flex flex-col gap-4 p-4 bg-slate-50 border border-slate-200 rounded-lg {className}">
  <div class="flex justify-between items-center">
    <div class="flex items-center gap-2">
      <Download class="w-4 h-4 text-gray-600" />
      <h3 class="text-base font-semibold text-slate-800 m-0">导出视频</h3>
    </div>
    <div class="flex gap-2 text-xs">
      {#if encodedChunks.length > 0}
        <span class="bg-blue-500 text-white px-2 py-1 rounded">{displayTotalFrames} 帧</span>
        {#if backgroundConfig}
          <span class="bg-emerald-500 text-white px-2 py-1 rounded">包含背景</span>
        {/if}
      {:else}
        <span class="text-slate-500">暂无录制数据</span>
      {/if}
    </div>
  </div>

  <!-- 导出按钮 -->
  <div class="flex gap-3">
    <button
      class="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 text-white text-sm font-medium rounded-md cursor-pointer transition-all duration-200 hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
      class:opacity-80={isExportingWebM}
      disabled={!canExport}
      onclick={() => { resetProgressAnimation(); exportWebM() }}
    >
      {#if isExportingWebM}
        <LoaderCircle class="w-4 h-4 animate-spin" />
        导出 WebM...
      {:else}
        <Video class="w-4 h-4" />
        导出 WebM
      {/if}
    </button>

    <button
      class="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white text-sm font-medium rounded-md cursor-pointer transition-all duration-200 hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
      class:opacity-80={isExportingMP4}
      disabled={!canExport}
      onclick={() => { resetProgressAnimation(); exportMP4() }}
    >
      {#if isExportingMP4}
        <LoaderCircle class="w-4 h-4 animate-spin" />
        导出 MP4...
      {:else}
        <Film class="w-4 h-4" />
        导出 MP4
      {/if}
    </button>
  </div>

  <!-- 导出进度 -->
  {#if exportProgress}
    <div class="bg-white border border-slate-200 rounded-md p-3">
      <div class="flex justify-between items-center mb-2">
        <span class="text-sm font-medium text-gray-700">
          导出 {exportProgress.type.toUpperCase()} - {formatStage(exportProgress.stage)}
        </span>
        <span class="text-sm font-semibold text-gray-900">
          {Math.round(displayedProgress)}%
        </span>
      </div>

      <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
        <div
          class="h-full origin-left transition-transform duration-300 rounded-full will-change-transform"
          class:bg-blue-500={exportProgress.type === 'webm'}
          class:bg-emerald-500={exportProgress.type === 'mp4'}
          style="transform: scaleX({displayedProgress / 100})"
        ></div>
      </div>

      <div class="flex justify-between text-xs text-slate-600">
        <span class="flex items-center gap-1">
          <CircleCheck class="w-3 h-3" />
          {exportProgress.currentFrame} / {displayTotalFrames} 帧
        </span>
        {#if exportProgress.estimatedTimeRemaining > 0}
          <span class="flex items-center gap-1">
            <Clock class="w-3 h-3" />
            剩余 {formatTime(exportProgress.estimatedTimeRemaining)}
          </span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- 提示信息 -->
  {#if !isRecordingComplete}
    <div class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
      <Info class="w-4 h-4 text-amber-600" />
      请先完成录制后再导出视频
    </div>
  {:else if encodedChunks.length === 0}
    <div class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
      <TriangleAlert class="w-4 h-4 text-amber-600" />
      没有可导出的视频数据
    </div>
  {/if}
</div>

<!-- 所有样式已迁移到 Tailwind CSS -->
