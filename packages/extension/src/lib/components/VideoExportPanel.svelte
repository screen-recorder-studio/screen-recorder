<!-- Video export panel component -->
<script lang="ts">
  import { Download, HardDrive, LoaderCircle, TriangleAlert, Sparkles } from '@lucide/svelte'
  import { ExportManager } from '$lib/services/export-manager'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { trimStore } from '$lib/stores/trim.svelte'
  import { videoCropStore } from '$lib/stores/video-crop.svelte'
  import UnifiedExportDialog, {
    type ExportFormat,
    type VideoExportOptions,
    type GifExportOptions,
    type SourceVideoInfo
  } from './UnifiedExportDialog.svelte'
  import { extractSourceInfo, convertBackgroundConfigForExport } from '$lib/utils/export-utils'
  import { _t as t } from '$lib/utils/i18n'

  // License tier type
  export type LicenseTier = 'free' | 'pro' | 'pro-trial'

  // Props
  export interface Props {
    encodedChunks?: any[]
    isRecordingComplete?: boolean
    totalFramesAll?: number
    opfsDirId?: string
    className?: string
    /**
     * Source frames-per-second for this recording.
     * When provided, it should match the preview timeline FPS so that
     * export duration and preview duration stay consistent.
     */
    sourceFps?: number
    /**
     * Current license tier for the user
     */
    licenseTier?: LicenseTier
    /**
     * Whether to show the license tier badge. Set false to hide it
     * when the badge is rendered elsewhere (e.g. in the Studio header).
     */
    showLicenseBadge?: boolean
  }

  let {
    encodedChunks = [],
    isRecordingComplete = false,
    totalFramesAll = 0,
    opfsDirId = '',
    className = '',
    sourceFps = 30,
    licenseTier = 'pro-trial',
    showLicenseBadge = true
  }: Props = $props()

  // License tier labels and styles (using getters for reactive translations)
  const tierConfig = $derived<Record<LicenseTier, { label: string; classes: string }>>({
    'free': {
      label: t('export_panel_tier_free'),
      classes: 'bg-gray-100 text-gray-600 border border-gray-200'
    },
    'pro': {
      label: t('export_panel_tier_pro'),
      classes: 'bg-blue-600 text-white'
    },
    'pro-trial': {
      label: t('export_panel_tier_trial'),
      classes: 'bg-blue-50 text-blue-600 border border-blue-200'
    }
  })

  const currentTier = $derived(tierConfig[licenseTier] || tierConfig['free'])

  // Display total frames: prioritize trimmed frame count if enabled, otherwise use total source frames
  const displayTotalFrames = $derived.by(() => {
    if (trimStore.enabled) {
      return Math.max(1, trimStore.trimFrameCount)
    }
    return totalFramesAll > 0 ? totalFramesAll : encodedChunks.length
  })

  // Use global background configuration
  const backgroundConfig = $derived(backgroundConfigStore.config)

  // Export status
  let isExportingWebM = $state(false)
  let isExportingMP4 = $state(false)
  let isExportingGIF = $state(false)

  // Export error feedback
  let exportErrorMessage = $state('')
  let exportErrorHint = $state('')
  let exportErrorAction = $state<'none' | 'open-drive'>('none')

  // Unified export dialog
  let showExportDialog = $state(false)
  
  let exportProgress = $state<{
    type: 'webm' | 'mp4' | 'gif'
    stage: 'preparing' | 'compositing' | 'encoding' | 'muxing' | 'finalizing'
    progress: number
    currentFrame: number
    totalFrames: number
    estimatedTimeRemaining: number
  } | null>(null)

  // Source video information for export dialogs
  const sourceInfo = $derived<SourceVideoInfo>(
    extractSourceInfo(encodedChunks, totalFramesAll, sourceFps)
  )


  // Smooth display export progress, avoid UI flicker caused by high-frequency updates
  let displayedProgress = $state(0)
  let targetProgress = $state(0)
  let rafId: number | null = null

  // Lazy-load gif.js from /gif/gif.js and verify availability
  async function ensureGifLibLoaded(): Promise<boolean> {
    if (typeof window === 'undefined') return false
    // already loaded
    if ((window as any).GIF) {
      return true
    }
    return await new Promise<boolean>((resolve) => {
      const script = document.createElement('script')
      script.src = '/gif/gif.js'
      script.async = true
      script.onload = () => {
        const ok = Boolean((window as any).GIF)
        if (ok) {
          console.log('✅ [Export] gif.js loaded, GIF constructor available')
        } else {
          console.warn('⚠️ [Export] gif.js loaded but GIF constructor not found')
        }
        resolve(ok)
      }
      script.onerror = () => {
        console.error('❌ [Export] Failed to load /gif/gif.js')
        resolve(false)
      }
      document.head.appendChild(script)
    })
  }

  // 执行 GIF 导出
  async function performGifExport(options: GifExportOptions) {
    if (!canExport) return

    try {
      clearExportError()
      isExportingGIF = true
      exportProgress = {
        type: 'gif',
        stage: 'preparing',
        progress: 0,
        currentFrame: 0,
        totalFrames: encodedChunks.length,
        estimatedTimeRemaining: 0
      }

      console.log('🎨 [Export] Starting GIF export with', encodedChunks.length, 'chunks')
      console.log('🎨 [Export] GIF options:', options)

      // 确保 gif.js 已加载
      const gifLibLoaded = await ensureGifLibLoaded()
      if (!gifLibLoaded) {
        throw new Error('Failed to load gif.js library')
      }

      // Convert Svelte 5 Proxy objects to plain objects using utility
      const plainBackgroundConfig = convertBackgroundConfigForExport(backgroundConfig, videoCropStore)

      console.log('🎨 [Export] GIF export config:', {
        hasBackgroundConfig: !!plainBackgroundConfig,
        videoCrop: plainBackgroundConfig?.videoCrop,
        videoCropEnabled: plainBackgroundConfig?.videoCrop?.enabled
      })

      // 使用对话框中的 GIF 导出选项
      const gifOptions = {
        fps: options.fps,
        quality: options.quality,
        scale: options.scale,
        workers: options.workers,
        repeat: options.repeat,
        dither: options.dither,
        transparent: options.transparent
      }

      const gifBlob = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'gif',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig as any,
          quality: 'medium',
          source: opfsDirId ? 'opfs' : 'chunks',
          opfsDirId: opfsDirId || undefined,
          trim: trimStore.enabled ? {
            enabled: true,
            startMs: trimStore.trimStartMs,
            endMs: trimStore.trimEndMs,
            startFrame: trimStore.trimStartFrame,
            endFrame: trimStore.trimEndFrame
          } : undefined,
          gifOptions
        },
        (progress) => {
          console.log(`📊 [VideoExportPanel] Progress callback: stage=${progress.stage}, progress=${progress.progress}%`)
          pendingProgress = {
            stage: progress.stage,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames,
            estimatedTimeRemaining: progress.estimatedTimeRemaining || 0
          }
          // 使用实际的进度值，不基于帧数计算（因为GIF渲染阶段不是线性的）
          setProgressTarget(progress.progress)
          scheduleProgressFieldsUpdate()
        }
      )

      // Download file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `edited-video-${timestamp}.gif`

      // 不要过早设置100%，让实际进度自然达到100%
      // setProgressTarget(100) // 移除这行，避免过早显示100%

      await downloadBlob(gifBlob, filename)

      console.log('✅ [Export] GIF export completed:', filename)

      // 导出成功，关闭对话框
      clearExportError()
      showExportDialog = false

    } catch (error) {
      console.error('❌ [Export] GIF export failed:', error)
      setExportError(t('export_error_gif_failed'), t('export_error_retry_hint'))
    } finally {
      isExportingGIF = false
      resetProgressAnimation()
      exportProgress = null
    }
  }

  function resetProgressAnimation() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    displayedProgress = 0
    targetProgress = 0
  }

  function animateProgress() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    const step = () => {
      const diff = targetProgress - displayedProgress
      if (Math.abs(diff) < 0.5) {
        displayedProgress = targetProgress
        rafId = null
        return
      }
      // 更快的响应速度用于进度更新
      displayedProgress += diff * 0.4
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
  }

  function setProgressTarget(p: number) {
    // 允许进度值更新（GIF导出时进度可能会因为阶段切换而变化）
    const clamped = Math.max(0, Math.min(100, p))
    targetProgress = clamped
    animateProgress()
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
    !isExportingMP4 &&
    !isExportingGIF
  )

  // Check if any export is in progress
  const isExporting = $derived(isExportingWebM || isExportingMP4 || isExportingGIF)

  function clearExportError() {
    exportErrorMessage = ''
    exportErrorHint = ''
    exportErrorAction = 'none'
  }

  function setExportError(message: string, hint = '', action: 'none' | 'open-drive' = 'none') {
    exportErrorMessage = message
    exportErrorHint = hint
    exportErrorAction = action
  }

  function openDriveFromExportError() {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_DRIVE' })
    } catch {
      window.open('/drive.html', '_blank')
    }
  }

  // Open unified export dialog
  function openExportDialog() {
    if (!canExport) return
    clearExportError()
    showExportDialog = true
  }

  // Handle export from unified dialog
  async function handleExport(format: ExportFormat, options: VideoExportOptions | GifExportOptions) {
    switch (format) {
      case 'webm':
        await performWebMExport(options as VideoExportOptions)
        break
      case 'mp4':
        await performMP4Export(options as VideoExportOptions)
        break
      case 'gif':
        await performGifExport(options as GifExportOptions)
        break
    }
  }

  // Perform WebM export
  async function performWebMExport(options: VideoExportOptions) {
    if (!canExport) return

    try {
      clearExportError()
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
      console.log('⚙️ [Export] WebM options:', options)

      // Convert Svelte 5 Proxy objects to plain objects using utility
      const plainBackgroundConfig = convertBackgroundConfigForExport(backgroundConfig, videoCropStore)

      console.log('🎬 [Export] WebM export config:', {
        hasBackgroundConfig: !!plainBackgroundConfig,
        videoCrop: plainBackgroundConfig?.videoCrop,
        videoCropEnabled: plainBackgroundConfig?.videoCrop?.enabled
      })

      // Map quality preset to export quality level
      const qualityMap: Record<string, 'high' | 'medium' | 'low'> = {
        draft: 'low',
        balanced: 'medium',
        high: 'high',
        best: 'high'
      }

      // Convert bitrate from Mbps to bps (integer)
      const bitrateInBps = Math.round(options.bitrate * 1000000)

      const videoResult = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'webm',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig as any,
          quality: qualityMap[options.quality] || 'high',
          bitrate: bitrateInBps,
          framerate: options.framerate,
          source: opfsDirId ? 'opfs' : 'chunks',
          opfsDirId: opfsDirId || undefined,
          saveToOpfs: !!opfsDirId,
          opfsFileName: (() => {
            if (!opfsDirId) return undefined
            const ts = new Date().toISOString().replace(/[:.]/g, '-')
            return `edited-video-${ts}.webm`
          })(),
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
          console.warn('⚠️ [Export] Failed to read WebM from OPFS:', e)
          setExportError(t('export_error_opfs_download_failed'), '', 'open-drive')
          // Do not close dialog – user needs to know file is in Drive
          return
        }
      } else {
        await downloadBlob(videoResult as Blob, fallbackFilename)
        console.log('✅ [Export] WebM export completed:', fallbackFilename)
      }

      // Close dialog on success
      clearExportError()
      showExportDialog = false

    } catch (error) {
      console.error('❌ [Export] WebM export failed:', error)
      setExportError(t('export_error_webm_failed'), t('export_error_retry_hint'))
    } finally {
      isExportingWebM = false
      resetProgressAnimation()
      exportProgress = null
    }
  }

  // Perform MP4 export
  async function performMP4Export(options: VideoExportOptions) {
    if (!canExport) return

    try {
      clearExportError()
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
      console.log('⚙️ [Export] MP4 options:', options)

      // Convert Svelte 5 Proxy objects to plain objects using utility
      const plainBackgroundConfig = convertBackgroundConfigForExport(backgroundConfig, videoCropStore)

      console.log('🎬 [Export] MP4 export config:', {
        hasBackgroundConfig: !!plainBackgroundConfig,
        videoCrop: plainBackgroundConfig?.videoCrop,
        videoCropEnabled: plainBackgroundConfig?.videoCrop?.enabled
      })

      // Map quality preset to export quality level
      const qualityMap: Record<string, 'high' | 'medium' | 'low'> = {
        draft: 'low',
        balanced: 'medium',
        high: 'high',
        best: 'high'
      }

      // Convert bitrate from Mbps to bps (integer)
      const bitrateInBps = Math.round(options.bitrate * 1000000)

      const videoBlob = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'mp4',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig as any,
          quality: qualityMap[options.quality] || 'high',
          bitrate: bitrateInBps,
          framerate: options.framerate,
          source: opfsDirId ? 'opfs' : 'chunks',
          opfsDirId: opfsDirId || undefined,
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

      // Close dialog on success
      clearExportError()
      showExportDialog = false

    } catch (error) {
      console.error('❌ [Export] MP4 export failed:', error)
      setExportError(t('export_error_mp4_failed'), t('export_error_retry_hint'))
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

</script>

<!-- Video export panel component - License badge + Export button -->
<div class="{className} flex flex-col gap-2">
  <div class="flex items-center justify-between gap-3">
    <!-- License tier badge (can be hidden when badge is placed elsewhere) -->
    {#if showLicenseBadge}
    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md {currentTier.classes}">
      <Sparkles class="w-3 h-3" />
      {currentTier.label}
    </span>
    {/if}

    <!-- Export button or warning -->
    {#if !isRecordingComplete || encodedChunks.length === 0}
      <button
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg border border-gray-200 cursor-not-allowed"
        disabled
        title={!isRecordingComplete ? t('export_panel_tooltip_incomplete') : t('export_panel_tooltip_no_data')}
      >
        <TriangleAlert class="w-4 h-4" />
        {t('export_panel_btn')}
      </button>
    {:else}
      <button
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={isExporting}
        onclick={openExportDialog}
      >
        {#if isExporting}
          <LoaderCircle class="w-4 h-4 animate-spin" />
          {t('export_panel_btn_exporting')}
        {:else}
          <Download class="w-4 h-4" />
          {t('export_panel_btn')}
        {/if}
      </button>
    {/if}
  </div>

  <!-- Export error banner -->
  {#if exportErrorMessage && !showExportDialog}
    <div class="flex items-start gap-2 px-2.5 py-2 bg-red-50 border border-red-200 rounded-lg">
      <TriangleAlert class="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-xs text-red-700">{exportErrorMessage}</p>
        {#if exportErrorHint}
          <p class="text-xs text-red-500 mt-0.5">{exportErrorHint}</p>
        {/if}
      </div>
      {#if exportErrorAction === 'open-drive'}
        <button
          class="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 flex-shrink-0"
          onclick={openDriveFromExportError}
        >
          <HardDrive class="w-3 h-3" />
          {t('studio_emptyOpenDrive')}
        </button>
      {/if}
      <button
        class="p-0.5 rounded hover:bg-red-100 transition-colors flex-shrink-0"
        onclick={clearExportError}
        title={t('common_close')}
      >
        <span class="text-red-400 text-xs">✕</span>
      </button>
    </div>
  {/if}
</div>

<!-- Unified Export Dialog -->
<UnifiedExportDialog
  bind:open={showExportDialog}
  onClose={() => { showExportDialog = false }}
  onExport={handleExport}
  onOpenDrive={openDriveFromExportError}
  sourceInfo={sourceInfo}
  sourceFps={sourceFps}
  isExporting={isExporting}
  errorMessage={exportErrorMessage}
  errorHint={exportErrorHint}
  showOpenDriveAction={exportErrorAction === 'open-drive'}
  exportProgress={exportProgress ? {
    stage: exportProgress.stage,
    progress: displayedProgress,
    currentFrame: exportProgress.currentFrame,
    totalFrames: exportProgress.totalFrames,
    estimatedTimeRemaining: exportProgress.estimatedTimeRemaining
  } : null}
  hasBackground={!!backgroundConfig}
/>
