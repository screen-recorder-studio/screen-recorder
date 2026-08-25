<!-- Video export panel component -->
<script lang="ts">
  import { Download, HardDrive, LoaderCircle, RefreshCw, TriangleAlert, Sparkles } from '@lucide/svelte'
  import { ExportCancelledError, ExportManager } from '$lib/services/export-manager'
  import { classifyExportFailure } from '$lib/export/export-error'
  import { emitJourneyEvent } from '$lib/observability/journey-events'
  import { createExportFilename, withOpfsExportTarget } from '$lib/export/export-target'
  import {
    createExportPreflightCancellation,
    type ExportPreflightCancellation
  } from '$lib/export/export-preflight-cancellation'
  import {
    buildExportDimensions,
    resolveCompositionSize,
    resolveExportDialogSourceInfo
  } from '$lib/export/export-dimensions'
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
  import { countSourceFramesInRange } from '$lib/recording/recording-timeline'
  import { hasTimeVaryingEditEffects } from '$lib/export/edit-export-parity'
  import { _t as t } from '$lib/utils/i18n'
  import { resolveStudioVisualAccent } from '$lib/studio/studio-theme'

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
    /** Canonical source duration from OPFS metadata, in milliseconds. */
    sourceDurationMs?: number
    /** Normalized source PTS values used to report VFR trim coverage. */
    sourceTimestampsMs?: number[]
    /** Recording-scoped default; users may still switch formats in the dialog. */
    preferredFormat?: ExportFormat
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
    sourceDurationMs = 0,
    sourceTimestampsMs = [],
    preferredFormat = 'mp4',
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
      return Math.max(1, countSourceFramesInRange(
        sourceTimestampsMs,
        trimStore.trimStartMs,
        trimStore.trimEndMs
      ))
    }
    return totalFramesAll > 0 ? totalFramesAll : encodedChunks.length
  })

  // Use global background configuration
  const backgroundConfig = $derived(backgroundConfigStore.config)
  const hasTimeVaryingGifEffects = $derived(hasTimeVaryingEditEffects(backgroundConfig))

  // Export status
  let isExportingWebM = $state(false)
  let isExportingMP4 = $state(false)
  let isExportingGIF = $state(false)
  let gifPreflightCancellation: ExportPreflightCancellation | null = null

  // Export error feedback
  let exportErrorMessage = $state('')
  let exportErrorHint = $state('')
  type ExportErrorAction = 'none' | 'open-drive' | 'reload-studio'
  let exportErrorAction = $state<ExportErrorAction>('none')

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
  const captureInfo = $derived<SourceVideoInfo>(
    extractSourceInfo(encodedChunks, totalFramesAll, sourceFps, sourceDurationMs)
  )
  const compositionSize = $derived(resolveCompositionSize(backgroundConfig))
  const sourceInfo = $derived<SourceVideoInfo>(
    resolveExportDialogSourceInfo(captureInfo, compositionSize)
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

    const preflightCancellation = createExportPreflightCancellation()
    gifPreflightCancellation = preflightCancellation

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

      emitJourneyEvent({ name: 'export.started', context: 'export', attributes: { format: 'gif' } })
      console.log('🎨 [Export] Starting GIF export with', encodedChunks.length, 'chunks')
      console.log('🎨 [Export] GIF options:', options)

      // 确保 gif.js 已加载
      const gifLibLoaded = await ensureGifLibLoaded()
      preflightCancellation.throwIfRequested()
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

      preflightCancellation.throwIfRequested()
      if (gifPreflightCancellation === preflightCancellation) {
        gifPreflightCancellation = null
      }

      const gifBlob = await exportManager.exportEditedVideo(
        encodedChunks,
        {
          format: 'gif',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: plainBackgroundConfig as any,
          quality: 'medium',
          source: opfsDirId ? ('opfs' as const) : ('chunks' as const),
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

      emitJourneyEvent({ name: 'export.completed', context: 'export', attributes: { format: 'gif', outcome: 'success' } })

      // Download file
      const filename = createExportFilename('gif')

      // 不要过早设置100%，让实际进度自然达到100%
      // setProgressTarget(100) // 移除这行，避免过早显示100%

      await downloadBlob(gifBlob, filename)

      console.log('✅ [Export] GIF export completed:', filename)

      // 导出成功，关闭对话框
      clearExportError()
      showExportDialog = false

    } catch (error) {
      if (error instanceof ExportCancelledError) {
        emitJourneyEvent({ name: 'export.cancelled', context: 'export', attributes: { format: 'gif', outcome: 'cancelled' } })
        clearExportError()
        showExportDialog = false
      } else {
        console.error('❌ [Export] GIF export failed:', error)
        const errorCode = presentExportFailure(error, 'gif')
        emitJourneyEvent({ name: 'export.failed', context: 'export', attributes: { format: 'gif', outcome: 'failure', errorCode } })
      }
    } finally {
      if (gifPreflightCancellation === preflightCancellation) {
        gifPreflightCancellation = null
      }
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

  function handleCancelExport() {
    const format: ExportFormat | null = isExportingMP4 ? 'mp4' : isExportingWebM ? 'webm' : isExportingGIF ? 'gif' : null
    if (!format) return

    const preflightCancelled = format === 'gif' && gifPreflightCancellation?.request() === true
    const workerCancelled = exportManager.cancelExport()
    if (!preflightCancelled && !workerCancelled) return

    emitJourneyEvent({ name: 'export.cancel_requested', context: 'export', attributes: { format } })
  }

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

  function setExportError(message: string, hint = '', action: ExportErrorAction = 'none') {
    exportErrorMessage = message
    exportErrorHint = hint
    exportErrorAction = action
  }

  const exportWorkerFallbackMessages = {
    export_error_worker_unavailable: 'Export components could not start.',
    export_error_reload_hint: 'Studio may have been updated. Reload to restore export. Your recording is safe, but unsaved edits may reset.',
    export_error_reload_action: 'Reload Studio'
  }

  function presentExportFailure(error: unknown, format: ExportFormat): string {
    const failure = classifyExportFailure(error, format)
    setExportError(
      t(failure.messageKey, undefined, exportWorkerFallbackMessages),
      t(failure.hintKey, undefined, exportWorkerFallbackMessages),
      failure.action
    )
    return failure.errorCode
  }

  function openDriveFromExportError() {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_DRIVE' })
    } catch {
      window.open('/drive.html', '_blank')
    }
  }

  function reloadStudioFromExportError() {
    window.location.reload()
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

      emitJourneyEvent({ name: 'export.started', context: 'export', attributes: { format: 'webm' } })
      console.log('🎬 [Export] Starting WebM export with', encodedChunks.length, 'chunks')
      console.log('⚙️ [Export] WebM options:', options)

      // Convert Svelte 5 Proxy objects to plain objects using utility
      const plainBackgroundConfig = convertBackgroundConfigForExport(backgroundConfig, videoCropStore)
      const exportDimensions = buildExportDimensions(plainBackgroundConfig || {}, {
        width: options.resolutionWidth,
        height: options.resolutionHeight
      })

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
        withOpfsExportTarget({
          format: 'webm',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: exportDimensions.backgroundConfig as any,
          quality: qualityMap[options.quality] || 'high',
          bitrate: bitrateInBps,
          framerate: options.framerate,
          resolution: exportDimensions.resolution,
          source: opfsDirId ? ('opfs' as const) : ('chunks' as const),
          opfsDirId: opfsDirId || undefined,
          trim: trimStore.enabled ? {
            enabled: true,
            startMs: trimStore.trimStartMs,
            endMs: trimStore.trimEndMs,
            startFrame: trimStore.trimStartFrame,
            endFrame: trimStore.trimEndFrame
          } : undefined
        }, 'webm', opfsDirId),
        (progress) => {
          // Cache and throttle update non-critical fields, avoid high-frequency re-rendering of entire block area
          pendingProgress = {
            stage: progress.stage,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames,
            estimatedTimeRemaining: progress.estimatedTimeRemaining || 0
          }
          // Use "current frame / display total frames" to calculate percentage, ensure consistency with 136 / 1020 frames
          const denomWebm = progress.totalFrames || displayTotalFrames || 0
          const frameBasedPctWebm = denomWebm > 0 ? (progress.currentFrame / denomWebm) * 100 : progress.progress
          setProgressTarget(frameBasedPctWebm)
          scheduleProgressFieldsUpdate()
        }
      )

      emitJourneyEvent({ name: 'export.completed', context: 'export', attributes: { format: 'webm', outcome: 'success' } })

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
      if (error instanceof ExportCancelledError) {
        emitJourneyEvent({ name: 'export.cancelled', context: 'export', attributes: { format: 'webm', outcome: 'cancelled' } })
        clearExportError()
        showExportDialog = false
      } else {
        console.error('❌ [Export] WebM export failed:', error)
        const errorCode = presentExportFailure(error, 'webm')
        emitJourneyEvent({ name: 'export.failed', context: 'export', attributes: { format: 'webm', outcome: 'failure', errorCode } })
      }
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

      emitJourneyEvent({ name: 'export.started', context: 'export', attributes: { format: 'mp4' } })
      console.log('🎬 [Export] Starting MP4 export with', encodedChunks.length, 'chunks')
      console.log('⚙️ [Export] MP4 options:', options)

      // Convert Svelte 5 Proxy objects to plain objects using utility
      const plainBackgroundConfig = convertBackgroundConfigForExport(backgroundConfig, videoCropStore)
      const exportDimensions = buildExportDimensions(plainBackgroundConfig || {}, {
        width: options.resolutionWidth,
        height: options.resolutionHeight
      })

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

      const videoResult = await exportManager.exportEditedVideo(
        encodedChunks,
        withOpfsExportTarget({
          format: 'mp4',
          includeBackground: !!plainBackgroundConfig,
          backgroundConfig: exportDimensions.backgroundConfig as any,
          quality: qualityMap[options.quality] || 'high',
          bitrate: bitrateInBps,
          framerate: options.framerate,
          resolution: exportDimensions.resolution,
          source: opfsDirId ? ('opfs' as const) : ('chunks' as const),
          opfsDirId: opfsDirId || undefined,
          trim: trimStore.enabled ? {
            enabled: true,
            startMs: trimStore.trimStartMs,
            endMs: trimStore.trimEndMs,
            startFrame: trimStore.trimStartFrame,
            endFrame: trimStore.trimEndFrame
          } : undefined
        }, 'mp4', opfsDirId),
        (progress) => {
          // Cache and throttle update non-critical fields, avoid high-frequency re-rendering of entire block area
          pendingProgress = {
            stage: progress.stage,
            currentFrame: progress.currentFrame,
            totalFrames: progress.totalFrames,
            estimatedTimeRemaining: progress.estimatedTimeRemaining || 0
          }

          const denomMp4 = progress.totalFrames || displayTotalFrames || 0
          const frameBasedPctMp4 = denomMp4 > 0 ? (progress.currentFrame / denomMp4) * 100 : progress.progress
          setProgressTarget(frameBasedPctMp4)
          scheduleProgressFieldsUpdate()
        }
      )

      emitJourneyEvent({ name: 'export.completed', context: 'export', attributes: { format: 'mp4', outcome: 'success' } })
      setProgressTarget(100)

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fallbackFilename = `edited-video-${timestamp}.mp4`
      if (videoResult && (videoResult as any).savedToOpfs) {
        const info = (videoResult as any).savedToOpfs as { dirId: string; fileName: string; bytesWritten: number }
        try {
          const root: any = await (navigator as any).storage.getDirectory()
          const dir: any = await root.getDirectoryHandle(info.dirId, { create: false })
          const fileHandle: any = await dir.getFileHandle(info.fileName, { create: false })
          const file: File = await fileHandle.getFile()
          await downloadBlob(file.slice(0, file.size, 'video/mp4'), info.fileName)
          console.log('✅ [Export] MP4 streamed to OPFS and downloaded:', info.fileName)
        } catch (error) {
          console.warn('⚠️ [Export] Failed to read MP4 from OPFS:', error)
          emitJourneyEvent({ name: 'download.failed', context: 'export', attributes: { format: 'mp4', outcome: 'failure', errorCode: 'OPFS_DOWNLOAD_FAILED' } })
          setExportError(t('export_error_opfs_download_failed'), '', 'open-drive')
          return
        }
      } else {
        await downloadBlob(videoResult as Blob, fallbackFilename)
        console.log('✅ [Export] MP4 export completed:', fallbackFilename)
      }

      // Close dialog on success
      clearExportError()
      showExportDialog = false

    } catch (error) {
      if (error instanceof ExportCancelledError) {
        emitJourneyEvent({ name: 'export.cancelled', context: 'export', attributes: { format: 'mp4', outcome: 'cancelled' } })
        clearExportError()
        showExportDialog = false
      } else {
        console.error('❌ [Export] MP4 export failed:', error)
        const errorCode = presentExportFailure(error, 'mp4')
        emitJourneyEvent({ name: 'export.failed', context: 'export', attributes: { format: 'mp4', outcome: 'failure', errorCode } })
      }
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
<div class="{className} flex flex-col gap-2" data-accent={resolveStudioVisualAccent(preferredFormat)}>
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
        class="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/5 bg-zinc-800 px-3 text-xs font-semibold text-zinc-600"
        disabled
        title={!isRecordingComplete ? t('export_panel_tooltip_incomplete') : t('export_panel_tooltip_no_data')}
      >
        <TriangleAlert class="w-4 h-4" />
        {t('export_panel_btn')}
      </button>
    {:else}
      <button
        class="studio-primary-action inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
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
    <div class="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 py-2">
      <TriangleAlert class="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-xs text-red-300">{exportErrorMessage}</p>
        {#if exportErrorHint}
          <p class="mt-0.5 text-xs text-red-400">{exportErrorHint}</p>
        {/if}
      </div>
      {#if exportErrorAction === 'open-drive'}
        <button
          class="inline-flex flex-shrink-0 items-center gap-1 rounded border border-red-400/20 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20"
          onclick={openDriveFromExportError}
        >
          <HardDrive class="w-3 h-3" />
          {t('studio_emptyOpenDrive')}
        </button>
      {/if}
      {#if exportErrorAction === 'reload-studio'}
        <button
          class="inline-flex flex-shrink-0 items-center gap-1 rounded border border-red-400/20 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20"
          onclick={reloadStudioFromExportError}
        >
          <RefreshCw class="w-3 h-3" />
          {t('export_error_reload_action', undefined, exportWorkerFallbackMessages)}
        </button>
      {/if}
      <button
        class="flex-shrink-0 rounded p-0.5 transition-colors hover:bg-red-500/20"
        onclick={clearExportError}
        title={t('common_close')}
      >
        <span class="text-xs text-red-300">✕</span>
      </button>
    </div>
  {/if}
</div>

<!-- Unified Export Dialog -->
<UnifiedExportDialog
  bind:open={showExportDialog}
  onClose={() => { showExportDialog = false }}
  onCancel={handleCancelExport}
  onExport={handleExport}
  onOpenDrive={openDriveFromExportError}
  onReloadStudio={reloadStudioFromExportError}
  sourceInfo={sourceInfo}
  sourceFps={sourceFps}
  selectedSourceFrameCount={displayTotalFrames}
  {hasTimeVaryingGifEffects}
  {preferredFormat}
  isExporting={isExporting}
  errorMessage={exportErrorMessage}
  errorHint={exportErrorHint}
  showOpenDriveAction={exportErrorAction === 'open-drive'}
  showReloadStudioAction={exportErrorAction === 'reload-studio'}
  exportProgress={exportProgress ? {
    stage: exportProgress.stage,
    progress: displayedProgress,
    currentFrame: exportProgress.currentFrame,
    totalFrames: exportProgress.totalFrames,
    estimatedTimeRemaining: exportProgress.estimatedTimeRemaining
  } : null}
  hasBackground={!!backgroundConfig}
/>
