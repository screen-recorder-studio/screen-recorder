<!-- Video export panel component -->
<script lang="ts">
  import { Download, Video, Film, LoaderCircle, Info, TriangleAlert, CircleCheck, Clock } from '@lucide/svelte'
  import { ExportManager } from '$lib/services/export-manager'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { trimStore } from '$lib/stores/trim.svelte'
  import { videoCropStore } from '$lib/stores/video-crop.svelte'

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

  // Display total frames: prioritize using total frames (totalFramesAll), otherwise fallback to current window (encodedChunks.length)
  const displayTotalFrames = $derived(totalFramesAll > 0 ? totalFramesAll : encodedChunks.length)

  // Use global background configuration
  const backgroundConfig = $derived(backgroundConfigStore.config)

  // Export status
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


  // Smooth display export progress, avoid UI flicker caused by high-frequency updates
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
      // Ease to target, reduce redraw frequency, reduce flicker
      displayedProgress += diff * 0.25
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
  }

  function setProgressTarget(p: number) {
    // Prevent visual jumps caused by progress rollback
    const clamped = Math.max(0, Math.min(100, p))
    if (clamped >= targetProgress) {
      targetProgress = clamped
      animateProgress()
    }
  }

  // Throttle export progress field updates, reduce template re-render frequency
  let pendingProgress: {
    stage: 'preparing' | 'compositing' | 'encoding' | 'muxing' | 'finalizing'
    currentFrame: number
    totalFrames: number
    estimatedTimeRemaining: number
  } | null = null
  let scheduled = false
  let lastUIUpdate = 0
  const MIN_UPDATE_INTERVAL = 80 // milliseconds

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


  // Export manager
  const exportManager = new ExportManager()

  // Check if export is possible
  const canExport = $derived(
    isRecordingComplete &&
    encodedChunks.length > 0 &&
    !isExportingWebM &&
    !isExportingMP4
  )

  // Export WebM
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

      // Convert Svelte 5 Proxy objects to plain objects
      const plainBackgroundConfig = backgroundConfig ? {
        type: backgroundConfig.type,
        color: backgroundConfig.color,
        padding: backgroundConfig.padding,
        outputRatio: backgroundConfig.outputRatio,
        videoPosition: backgroundConfig.videoPosition,
        borderRadius: backgroundConfig.borderRadius,
        inset: backgroundConfig.inset,
        // Deep convert gradient object
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
        // Deep convert shadow object
        shadow: backgroundConfig.shadow ? {
          offsetX: backgroundConfig.shadow.offsetX,
          offsetY: backgroundConfig.shadow.offsetY,
          blur: backgroundConfig.shadow.blur,
          color: backgroundConfig.shadow.color
        } : undefined,
        // Deep convert image object
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
        // Deep convert wallpaper object
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
        } : undefined,
        // 🆕 Deep convert videoCrop object - 从 videoCropStore 获取
        videoCrop: videoCropStore.getCropConfig()
      } : undefined

      console.log('🎬 [Export] WebM export config:', {
        hasBackgroundConfig: !!plainBackgroundConfig,
        videoCrop: plainBackgroundConfig?.videoCrop,
        videoCropEnabled: plainBackgroundConfig?.videoCrop?.enabled
      })

      const videoResult = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'webm',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig as any,
          quality: 'medium',
          source: opfsDirId ? 'opfs' : 'chunks',
          opfsDirId: opfsDirId || undefined,
          saveToOpfs: !!opfsDirId,
          opfsFileName: (() => {
            if (!opfsDirId) return undefined
            const ts = new Date().toISOString().replace(/[:.]/g, '-')
            return `edited-video-${ts}.webm`
          })(),
          // 🔧 裁剪参数
          trim: trimStore.enabled ? {
            enabled: true,
            startMs: trimStore.trimStartMs,
            endMs: trimStore.trimEndMs,
            startFrame: trimStore.trimStartFrame,
            endFrame: trimStore.trimEndFrame
          } : undefined
        },
        (progress) => {
          // Cache and throttle update non-critical fields, avoid high-frequency re-rendering of entire block area
          pendingProgress = {
            stage: progress.stage,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames,
            estimatedTimeRemaining: progress.estimatedTimeRemaining || 0
          }
          // Use "current frame / display total frames" to calculate percentage, ensure consistency with 136 / 1020 frames
          const denomWebm = displayTotalFrames || progress.totalFrames || 0
          const frameBasedPctWebm = denomWebm > 0 ? (progress.currentFrame / denomWebm) * 100 : progress.progress
          setProgressTarget(frameBasedPctWebm)
          scheduleProgressFieldsUpdate()
        }
      )

      // Ensure display progress reaches 100%
      setProgressTarget(100)

      // Completion handling: OPFS or Blob download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fallbackFilename = `edited-video-${timestamp}.webm`

      if (videoResult && (videoResult as any).savedToOpfs) {
        const info = (videoResult as any).savedToOpfs as { dirId: string; fileName: string; bytesWritten: number }
        console.log('✅ [Export] WebM saved to OPFS:', info)
        try {
          const root: any = await (navigator as any).storage.getDirectory()
          const dir: any = await root.getDirectoryHandle(info.dirId, { create: false })
          const fileHandle: any = await dir.getFileHandle(info.fileName, { create: false })
          const file: File = await fileHandle.getFile()
          const blob = file.slice(0, file.size, 'video/webm')
          await downloadBlob(blob, info.fileName)
          console.log('⬇️ [Export] Downloaded WebM from OPFS:', info.fileName)
        } catch (e) {
          console.warn('⚠️ [Export] Failed to read WebM from OPFS, falling back to no-op:', e)
        }
      } else {
        await downloadBlob(videoResult as Blob, fallbackFilename)
        console.log('✅ [Export] WebM export completed:', fallbackFilename)
      }

    } catch (error) {
      console.error('❌ [Export] WebM export failed:', error)
      // TODO: Show error message
    } finally {
      isExportingWebM = false
      resetProgressAnimation()
      exportProgress = null
    }
  }

  // Export MP4
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

      // Convert Svelte 5 Proxy objects to plain objects
      const plainBackgroundConfig = backgroundConfig ? {
        type: backgroundConfig.type,
        color: backgroundConfig.color,
        padding: backgroundConfig.padding,
        outputRatio: backgroundConfig.outputRatio,
        videoPosition: backgroundConfig.videoPosition,
        borderRadius: backgroundConfig.borderRadius,
        inset: backgroundConfig.inset,
        // Deep convert gradient object
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
        // Deep convert shadow object
        shadow: backgroundConfig.shadow ? {
          offsetX: backgroundConfig.shadow.offsetX,
          offsetY: backgroundConfig.shadow.offsetY,
          blur: backgroundConfig.shadow.blur,
          color: backgroundConfig.shadow.color
        } : undefined,
        // Deep convert image object
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
        // Deep convert wallpaper object
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
        } : undefined,
        // 🆕 Deep convert videoCrop object - 从 videoCropStore 获取
        videoCrop: videoCropStore.getCropConfig()
      } : undefined

      console.log('🎬 [Export] MP4 export config:', {
        hasBackgroundConfig: !!plainBackgroundConfig,
        videoCrop: plainBackgroundConfig?.videoCrop,
        videoCropEnabled: plainBackgroundConfig?.videoCrop?.enabled
      })

      const videoBlob = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'mp4',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig as any,
          quality: 'medium',
          source: opfsDirId ? 'opfs' : 'chunks',
          opfsDirId: opfsDirId || undefined,
          // 🔧 裁剪参数
          trim: trimStore.enabled ? {
            enabled: true,
            startMs: trimStore.trimStartMs,
            endMs: trimStore.trimEndMs,
            startFrame: trimStore.trimStartFrame,
            endFrame: trimStore.trimEndFrame
          } : undefined
        },
        (progress) => {
          // Cache and throttle update non-critical fields, avoid high-frequency re-rendering of entire block area
          pendingProgress = {
            stage: progress.stage,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames,
            estimatedTimeRemaining: progress.estimatedTimeRemaining || 0
          }
          //








          const denomMp4 = displayTotalFrames || progress.totalFrames || 0
          const frameBasedPctMp4 = denomMp4 > 0 ? (progress.currentFrame / denomMp4) * 100 : progress.progress
          setProgressTarget(frameBasedPctMp4)
          scheduleProgressFieldsUpdate()
        }
      )

      // Download file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `edited-video-${timestamp}.mp4`

      // Ensure display progress reaches 100%
      setProgressTarget(100)

      await downloadBlob(videoBlob, filename)

      console.log('✅ [Export] MP4 export completed:', filename)

    } catch (error) {
      console.error('❌ [Export] MP4 export failed:', error)
      // TODO: Show error message
    } finally {
      isExportingMP4 = false
      resetProgressAnimation()
      exportProgress = null
    }
  }

  // Download Blob file
  async function downloadBlob(blob: Blob, filename: string) {
    try {
      // Try using Chrome API
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        const url = URL.createObjectURL(blob)

        chrome.runtime.sendMessage({
          action: 'saveRecording',
          filename,
          url
        }, (response) => {
          URL.revokeObjectURL(url)
          if (!response?.success) {
            // Fallback to direct download
            directDownload(blob, filename)
          }
        })
      } else {
        // Direct download
        directDownload(blob, filename)
      }
    } catch (error) {
      console.error('Download failed:', error)
      directDownload(blob, filename)
    }
  }

  // Direct download
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

  // Format progress stage
  function formatStage(stage: string): string {
    const stageMap = {
      'preparing': 'Preparing',
      'compositing': 'Compositing Background',
      'encoding': 'Encoding',
      'muxing': 'Muxing Container',
      'finalizing': 'Finalizing'
    }
    return stageMap[stage as keyof typeof stageMap] || stage
  }

  // Format time
  function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.round(seconds % 60)
    return `${minutes}m ${remainingSeconds}s`
  }
</script>

<!-- Video export panel component -->
<div class="flex flex-col gap-4 p-4 bg-slate-50 border border-slate-200 rounded-lg {className}">
  <div class="flex justify-between items-center">
    <div class="flex items-center gap-2">
      <Download class="w-4 h-4 text-gray-600" />
      <h3 class="text-base font-semibold text-slate-800 m-0">Export Video</h3>
    </div>
    <div class="flex gap-2 text-xs">
      {#if encodedChunks.length > 0}
        <span class="bg-blue-500 text-white px-2 py-1 rounded">{displayTotalFrames} frames</span>
        {#if backgroundConfig}
          <span class="bg-emerald-500 text-white px-2 py-1 rounded">With Background</span>
        {/if}
        {#if trimStore.enabled}
          <span class="bg-orange-500 text-white px-2 py-1 rounded">✂️ Trimmed ({trimStore.trimFrameCount} frames)</span>
        {/if}
      {:else}
        <span class="text-slate-500">No recording data</span>
      {/if}
    </div>
  </div>

  <!-- Export button -->
  <div class="flex gap-3">
    <button
      class="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 text-white text-sm font-medium rounded-md cursor-pointer transition-all duration-200 hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"

      disabled={!canExport}
      onclick={() => { resetProgressAnimation(); exportWebM() }}
    >
      {#if isExportingWebM}
        <LoaderCircle class="w-4 h-4 animate-spin" />
        Exporting WebM...
      {:else}
        <Video class="w-4 h-4" />
        Export WebM
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
        Exporting MP4...
      {:else}
        <Film class="w-4 h-4" />
        Export MP4
      {/if}
    </button>
  </div>

  <!-- Export progress -->
  {#if exportProgress}
    <div class="bg-white border border-slate-200 rounded-md p-3">
      <div class="flex justify-between items-center mb-2">
        <span class="text-sm font-medium text-gray-700">
          Exporting {exportProgress.type.toUpperCase()} - {formatStage(exportProgress.stage)}
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
          {exportProgress.currentFrame} / {displayTotalFrames} frames
        </span>
        {#if exportProgress.estimatedTimeRemaining > 0}
          <span class="flex items-center gap-1">
            <Clock class="w-3 h-3" />
            Remaining {formatTime(exportProgress.estimatedTimeRemaining)}
          </span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Notification messages -->
  {#if !isRecordingComplete}
    <div class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
      <Info class="w-4 h-4 text-amber-600" />
      Please complete recording before exporting video
    </div>
  {:else if encodedChunks.length === 0}
    <div class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
      <TriangleAlert class="w-4 h-4 text-amber-600" />
      No video data available for export
    </div>
  {/if}
</div>

<!-- All styles have been migrated to Tailwind CSS -->
