<script lang="ts">
  import {
    X,
    LoaderCircle,
    Film,
    Video,
    Image,
    FileDown,
    Zap,
    Palette,
    Info,
    Clock,
    TriangleAlert,
    HardDrive,
    RefreshCw
  } from '@lucide/svelte'
  import { trimStore } from '$lib/stores/trim.svelte'
  import {
    estimateGifPresentationFrameCount,
    estimateGifSizeRange
  } from '$lib/export/gif-export-estimate'
  import { resolveGifDeliveryDefaults } from '$lib/export/gif-delivery-defaults'
  import {
    GIF_AUTO_WORKERS,
    GIF_LOOP_OPTIONS,
    resolveGifScaledDimensions,
    resolveGifOutputSizeOptions
  } from '$lib/export/gif-export-settings'
  import { deriveGifDeliveryAdvisory } from '$lib/export/gif-delivery-advisory'
  import { resolveExportDialogHeading } from '$lib/export/export-dialog-presentation'
  import { resolveStudioVisualAccent } from '$lib/studio/studio-theme'
  import { _t as t } from '$lib/utils/i18n'

  interface Props {
    open: boolean
    onClose: () => void
    onCancel?: () => void
    onExport: (format: ExportFormat, options: VideoExportOptions | GifExportOptions) => void
    onOpenDrive?: () => void
    onReloadStudio?: () => void
    sourceInfo: SourceVideoInfo
    sourceFps?: number
    selectedSourceFrameCount?: number
    hasTimeVaryingGifEffects?: boolean
    preferredFormat?: ExportFormat
    isExporting?: boolean
    exportProgress?: {
      stage: string
      progress: number
      currentFrame: number
      totalFrames: number
      estimatedTimeRemaining?: number
    } | null
    hasBackground?: boolean
    errorMessage?: string
    errorHint?: string
    showOpenDriveAction?: boolean
    showReloadStudioAction?: boolean
  }

  let {
    open = $bindable(),
    onClose,
    onCancel,
    onExport,
    onOpenDrive,
    onReloadStudio,
    sourceInfo,
    sourceFps = 30,
    selectedSourceFrameCount,
    hasTimeVaryingGifEffects = false,
    preferredFormat = 'mp4',
    isExporting = false,
    exportProgress = null,
    hasBackground = false,
    errorMessage = '',
    errorHint = '',
    showOpenDriveAction = false,
    showReloadStudioAction = false
  }: Props = $props()

  // Types
  export type ExportFormat = 'mp4' | 'webm' | 'gif'

  export interface VideoExportOptions {
    resolution: string
    resolutionWidth: number
    resolutionHeight: number
    quality: string
    framerate: number
    bitrate: number
    targetFileSize?: number
    encodingSpeed: string
  }

  export interface GifExportOptions {
    fps: number
    quality: number
    scale: number
    workers: number
    repeat: number
    dither: boolean | string
    transparent: string | null
  }

  export interface SourceVideoInfo {
    width: number
    height: number
    frameCount: number
    codec: string
    duration: number
    estimatedSize: number
  }

  // Current selected format
  let selectedFormat = $state<ExportFormat>('mp4')

  // Video settings (MP4/WebM)
  let resolution = $state<string>('source')
  let quality = $state<string>('high')
  let framerate = $state<number>(sourceFps || 30)
  let bitrateMode = $state<'auto' | 'manual'>('auto')
  let manualBitrate = $state<number>(8)
  let encodingSpeed = $state<string>('balanced')
  let limitFileSize = $state<boolean>(false)
  let maxFileSize = $state<number>(100)

  // GIF settings
  let gifFps = $state(10)
  let gifQuality = $state(10)
  let gifScale = $state(75)
  let gifRepeat = $state(0)
  let gifDither = $state<string>('false')
  let gifTransparent = $state<string | null>(null)
  let showGifAdvanced = $state(false)

  let wasOpen = false
  let dialogElement = $state<HTMLDivElement | null>(null)

  // Apply the recording-scoped delivery default only when opening. Once open,
  // the user remains free to switch formats and tune every setting.
  $effect(() => {
    if (open && !wasOpen) {
      selectedFormat = preferredFormat
      if (preferredFormat === 'gif') {
        const defaults = resolveGifDeliveryDefaults(sourceInfo.width)
        gifFps = defaults.fps
        gifScale = defaults.scalePercent
        gifRepeat = defaults.repeat
        gifQuality = 10
        gifDither = 'false'
        showGifAdvanced = false
      }
      requestAnimationFrame(() => dialogElement?.focus({ preventScroll: true }))
    }
    wasOpen = open
    if (!open) {
      framerate = sourceFps || 30
    }
  })

  // Resolution options
  const resolutionOptions = $derived([
    {
      value: 'source',
      label: t(
        'export_res_canvas',
        [String(sourceInfo.width), String(sourceInfo.height)],
        {
          export_res_canvas: {
            message: 'Match Canvas ($WIDTH$×$HEIGHT$)',
            placeholders: {
              width: { content: '$1' },
              height: { content: '$2' }
            }
          }
        }
      ),
      width: sourceInfo.width,
      height: sourceInfo.height
    },
    { value: '2160p', label: '2160p (4K)', width: 3840, height: 2160 },
    { value: '1440p', label: '1440p (2K)', width: 2560, height: 1440 },
    { value: '1080p', label: '1080p (Full HD)', width: 1920, height: 1080 },
    { value: '720p', label: '720p (HD)', width: 1280, height: 720 },
    { value: '480p', label: '480p (SD)', width: 854, height: 480 }
  ])

  // Quality presets (using getters for reactive translations)
  const qualityPresets = $derived([
    { value: 'draft', label: t('export_quality_draft'), description: t('export_quality_draft_desc') },
    { value: 'balanced', label: t('export_quality_balanced'), description: t('export_quality_balanced_desc') },
    { value: 'high', label: t('export_quality_high'), description: t('export_quality_high_desc') },
    { value: 'best', label: t('export_quality_best'), description: t('export_quality_best_desc') }
  ])

  // Framerate options
  const framerateOptions = $derived.by<{ value: number; label: string }[]>(() => {
    const base = [24, 30, 60]
    const options: { value: number; label: string }[] = base.map((fps) => ({
      value: fps,
      label: `${fps} fps`
    }))
    if (sourceFps && sourceFps > 0) {
      const rounded = Math.round(sourceFps)
      const existingIndex = options.findIndex((opt) => opt.value === rounded)
      const sourceLabel = t('export_fps_source', String(rounded))
      if (existingIndex >= 0) {
        options[existingIndex] = { value: rounded, label: sourceLabel }
      } else {
        options.unshift({ value: rounded, label: sourceLabel })
      }
    }
    return options
  })

  // Encoding speed options
  const encodingSpeedOptions = $derived([
    { value: 'fastest', label: t('export_speed_fastest') },
    { value: 'fast', label: t('export_speed_fast') },
    { value: 'balanced', label: t('export_speed_balanced') },
    { value: 'slow', label: t('export_speed_slow') },
    { value: 'slowest', label: t('export_speed_slowest') }
  ])

  // GIF quality options
  const gifQualityOptions = $derived([
    { value: 5, label: t('export_gif_quality_fine') },
    { value: 10, label: t('export_gif_quality_balanced') },
    { value: 20, label: t('export_gif_quality_faster') }
  ])

  const gifScaleOptions = $derived(resolveGifOutputSizeOptions(sourceInfo.width, sourceInfo.height))

  function gifSizeLabel(id: 'source' | 'email' | 'compact' | 'small') {
    if (id === 'source') return t('export_gif_size_original')
    if (id === 'email') return t('export_gif_size_email')
    if (id === 'compact') return t('export_gif_size_compact')
    return t('export_gif_size_small')
  }

  function gifLoopLabel(option: (typeof GIF_LOOP_OPTIONS)[number]) {
    return option.totalPlays === null
      ? t('export_loop_forever')
      : t('export_loop_total_plays', String(option.totalPlays))
  }

  // Computed values
  const selectedResolution = $derived(
    resolutionOptions.find((r) => r.value === resolution) || resolutionOptions[0]
  )

  const outputWidth = $derived(selectedResolution.width)
  const outputHeight = $derived(selectedResolution.height)

  const displayFrameCount = $derived(
    trimStore.enabled && selectedSourceFrameCount !== undefined
      ? selectedSourceFrameCount
      : sourceInfo.frameCount
  )

  const displayDuration = $derived(
    trimStore.enabled
      ? (trimStore.trimEndMs - trimStore.trimStartMs) / 1000
      : sourceInfo.duration
  )

  // Bitrate calculation based on quality preset
  const qualityBitrateMap: Record<string, number> = {
    draft: 0.05,
    balanced: 0.1,
    high: 0.15,
    best: 0.2
  }

  const calculatedBitrate = $derived.by(() => {
    const pixels = outputWidth * outputHeight
    const baseRate = (pixels / 1000000) * 8 // Base rate per megapixel
    const qualityMultiplier = qualityBitrateMap[quality] || 0.1
    return Math.round(baseRate * qualityMultiplier * 10) / 10
  })

  const effectiveBitrate = $derived(bitrateMode === 'auto' ? calculatedBitrate : manualBitrate)

  const estimatedSize = $derived.by(() => {
    const durationSecs = displayDuration
    const sizeBytes = (effectiveBitrate * 1000000 * durationSecs) / 8
    return sizeBytes
  })

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // GIF estimates
  const gifOutputSize = $derived(resolveGifScaledDimensions(
    sourceInfo.width,
    sourceInfo.height,
    gifScale / 100
  ))
  const gifOutputWidth = $derived(gifOutputSize.width)
  const gifOutputHeight = $derived(gifOutputSize.height)
  const gifEstimatedFrames = $derived(estimateGifPresentationFrameCount({
    durationSeconds: displayDuration,
    targetFps: gifFps,
    sourceFrameCount: displayFrameCount,
    hasTimeVaryingEffects: hasTimeVaryingGifEffects
  }))
  const gifEstimatedSizeRange = $derived.by(() => estimateGifSizeRange({
    width: gifOutputWidth,
    height: gifOutputHeight,
    frameCount: gifEstimatedFrames,
    quality: gifQuality
  }))
  const gifDeliveryAdvisory = $derived(deriveGifDeliveryAdvisory(gifEstimatedSizeRange))
  const dialogHeading = $derived(resolveExportDialogHeading(selectedFormat))

  const formatSizeRange = (minBytes: number, maxBytes: number): string => {
    if (minBytes === maxBytes) return formatFileSize(minBytes)
    return `${formatFileSize(minBytes)}–${formatFileSize(maxBytes)}`
  }

  // Handle export
  function handleExport() {
    if (selectedFormat === 'gif') {
      const gifOptions: GifExportOptions = {
        fps: gifFps,
        quality: gifQuality,
        scale: gifScale / 100,
        workers: GIF_AUTO_WORKERS,
        repeat: gifRepeat,
        dither: gifDither === 'false' ? false : gifDither,
        transparent: gifTransparent
      }
      onExport(selectedFormat, gifOptions)
    } else {
      const videoOptions: VideoExportOptions = {
        resolution,
        resolutionWidth: outputWidth,
        resolutionHeight: outputHeight,
        quality,
        framerate,
        bitrate: effectiveBitrate,
        targetFileSize: limitFileSize ? maxFileSize * 1024 * 1024 : undefined,
        encodingSpeed
      }
      onExport(selectedFormat, videoOptions)
    }
  }

  function handleClose() {
    if (!isExporting) {
      onClose()
    }
  }

  function handleCancel() {
    if (isExporting) onCancel?.()
  }

  function handleDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
      return
    }
    if (event.key !== 'Tab' || !dialogElement) return

    const focusable = Array.from(dialogElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hasAttribute('hidden'))
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogElement)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Format tabs config
  const formatTabs = $derived([
    { id: 'mp4' as ExportFormat, label: t('export_format_mp4'), icon: Film },
    { id: 'webm' as ExportFormat, label: t('export_format_webm'), icon: Video },
    { id: 'gif' as ExportFormat, label: t('export_format_gif'), icon: Image }
  ])

  // Export button label
  const exportButtonLabel = $derived.by(() => {
    if (isExporting) return t('export_panel_btn_exporting')
    switch (selectedFormat) {
      case 'mp4': return t('export_btn_export_mp4')
      case 'webm': return t('export_btn_export_webm')
      case 'gif': return t('export_btn_export_gif')
    }
  })

  // Progress stage labels
  const stageLabels = $derived<Record<string, string>>({
    preparing: t('export_progress_preparing'),
    encoding: t('export_progress_encoding'),
    muxing: t('export_progress_muxing'),
    finalizing: t('export_progress_finalizing')
  })
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="studio-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
    onclick={handleClose}
    role="presentation"
  >
    <!-- Dialog -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="studio-dialog-panel studio-export-dialog relative flex max-h-[calc(100vh-2rem)] w-[720px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
      data-accent={resolveStudioVisualAccent(selectedFormat)}
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleDialogKeydown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
      tabindex="-1"
      bind:this={dialogElement}
    >
      <!-- Export Progress Overlay -->
      {#if isExporting && exportProgress}
        <div class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/95 p-8 backdrop-blur-sm">
          <div class="w-full max-w-md space-y-6">
            <!-- Progress Icon -->
            <div class="flex justify-center">
              <div class="studio-dialog-leading flex h-16 w-16 items-center justify-center rounded-2xl">
                <LoaderCircle class="h-8 w-8 animate-spin" />
              </div>
            </div>

            <!-- Stage & Progress -->
            <div class="text-center">
              <h3 class="mb-1 text-lg font-semibold text-zinc-100">
                {stageLabels[exportProgress.stage] || exportProgress.stage}
              </h3>
              <p class="text-3xl font-bold text-blue-300">{Math.round(exportProgress.progress)}%</p>
            </div>

            <!-- Progress Bar -->
            <div class="h-3 w-full overflow-hidden rounded-full bg-zinc-800 ring-1 ring-white/5">
              <div
                class="h-full bg-blue-600 rounded-full transition-all duration-300"
                style="width: {exportProgress.progress}%"
              ></div>
            </div>

            <!-- Frame Info -->
            {#if exportProgress.currentFrame > 0}
              <div class="flex items-center justify-between text-sm text-zinc-400">
                <span>{t('export_progress_frame', [String(exportProgress.currentFrame), String(exportProgress.totalFrames)])}</span>
                {#if exportProgress.estimatedTimeRemaining && exportProgress.estimatedTimeRemaining > 0}
                  <span class="flex items-center gap-1">
                    <Clock class="w-4 h-4" />
                    {t('export_progress_time', String(Math.ceil(exportProgress.estimatedTimeRemaining / 1000)))}
                  </span>
                {/if}
              </div>
            {/if}

            <div class="flex flex-col items-center gap-2">
              <p class="text-center text-xs text-zinc-400">
                {t('export_progress_hint')}
              </p>
              <button
                type="button"
                class="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/20"
                onclick={handleCancel}
              >
                {t('export_btn_cancel')}
              </button>
            </div>
          </div>
        </div>
      {/if}
      <!-- Header -->
      <div class="studio-dialog-header flex items-start gap-4 px-6 py-5">
        <div class="studio-dialog-leading flex h-10 w-10 shrink-0 items-center justify-center">
          <FileDown class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1 pt-0.5">
          <h2 id="export-dialog-title" class="text-lg font-semibold tracking-tight text-zinc-100">
            {t(dialogHeading.key, undefined, { [dialogHeading.key]: dialogHeading.fallback })}
          </h2>
        </div>
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-white/5 hover:text-zinc-100"
          onclick={handleClose}
          disabled={isExporting}
          aria-label={t('common_close')}
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <!-- Source Information (above tabs) -->
      <div class="border-b border-zinc-700 bg-black/10 px-6 py-4">
        <div class="flex items-start justify-between">
          <div class="grid grid-cols-4 gap-6 text-sm flex-1">
            <div>
              <span class="text-gray-500 block text-xs">{t('export_source_res')}</span>
              <span class="font-medium">{sourceInfo.width}×{sourceInfo.height}</span>
            </div>
            <div>
              <span class="text-gray-500 block text-xs">{t('export_source_codec')}</span>
              <span class="font-medium">{sourceInfo.codec || 'VP9'}</span>
            </div>
            <div>
              <span class="text-gray-500 block text-xs">{t('export_source_duration')}</span>
              <span class="font-medium">{formatDuration(displayDuration)}</span>
            </div>
            <div>
              <span class="text-gray-500 block text-xs">{t('export_source_frames')}</span>
              <span class="font-medium">{displayFrameCount}</span>
            </div>
          </div>
          <!-- Status badges -->
          {#if hasBackground || trimStore.enabled}
            <div class="flex gap-2 ml-4 flex-shrink-0">
              {#if hasBackground}
                <span class="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded">
                  <Palette class="w-3 h-3" />
                  {t('export_badge_bg')}
                </span>
              {/if}
              {#if trimStore.enabled}
                <span class="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded">
                  ✂️ {t('export_badge_trim')}
                </span>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Format Tabs -->
      <div class="flex gap-1 border-b border-zinc-700 bg-zinc-950/30 px-6 py-3">
        {#each formatTabs as tab}
          {@const isSelected = selectedFormat === tab.id}
          <button
            type="button"
            class="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors
              {isSelected
                ? selectedFormat === 'gif' ? 'bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/30' : 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/30'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}"
            onclick={() => selectedFormat = tab.id}
            disabled={isExporting}
            aria-pressed={isSelected}
          >
            <tab.icon class="w-4 h-4" />
            {tab.label}
          </button>
        {/each}
      </div>

      <!-- Content (Scrollable) -->
      <div class="studio-dialog-body studio-scrollbar flex-1 space-y-6 overflow-y-auto p-6">
        <!-- Video Settings (MP4/WebM) -->
        {#if selectedFormat === 'mp4' || selectedFormat === 'webm'}
          <!-- Quality Presets -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Zap class="w-4 h-4" />
              {t('export_quality_title')}
            </h3>
            <div class="grid grid-cols-4 gap-2">
              {#each qualityPresets as preset}
                <button
                  class="p-3 rounded-lg border text-left transition-all
                    {quality === preset.value
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300 bg-white'}"
                  onclick={() => quality = preset.value}
                >
                  <span class="block font-medium text-sm">{preset.label}</span>
                  <span class="block text-xs text-gray-500 mt-1">{preset.description}</span>
                </button>
              {/each}
            </div>
          </div>

          <!-- Resolution & Framerate -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="export-resolution" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_resolution')}</label>
              <select
                id="export-resolution"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                bind:value={resolution}
              >
                {#each resolutionOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="export-framerate" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_framerate')}</label>
              <select
                id="export-framerate"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                bind:value={framerate}
              >
                {#each framerateOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
          </div>

          <!-- Bitrate -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label for="export-bitrate" class="text-sm font-medium text-gray-700">{t('export_label_bitrate')}</label>
              <div class="flex gap-2">
                <button
                  class="px-3 py-1 text-xs rounded-md transition-colors
                    {bitrateMode === 'auto' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
                  onclick={() => bitrateMode = 'auto'}
                >{t('export_bitrate_auto')}</button>
                <button
                  class="px-3 py-1 text-xs rounded-md transition-colors
                    {bitrateMode === 'manual' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
                  onclick={() => bitrateMode = 'manual'}
                >{t('export_bitrate_manual')}</button>
              </div>
            </div>
            {#if bitrateMode === 'manual'}
              <div class="flex items-center gap-3">
                <input
                  id="export-bitrate"
                  type="range"
                  class="flex-1"
                  min="1"
                  max="50"
                  step="0.5"
                  bind:value={manualBitrate}
                />
                <span class="text-sm font-medium w-20 text-right">{manualBitrate} Mbps</span>
              </div>
            {:else}
              <div id="export-bitrate" class="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-600">
                {t('export_bitrate_auto_hint', String(calculatedBitrate))}
              </div>
            {/if}
          </div>

          <!-- Encoding Speed -->
          <div>
            <label for="export-encoding-speed" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_speed')}</label>
            <select
              id="export-encoding-speed"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              bind:value={encodingSpeed}
            >
              {#each encodingSpeedOptions as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>

          <!-- Estimated Output -->
          <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Info class="w-4 h-4" />
              {t('export_est_output')}
            </h3>
            <div class="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span class="text-gray-500 block">{t('export_label_resolution')}</span>
                <span class="font-medium text-gray-900">{outputWidth}×{outputHeight}</span>
              </div>
              <div>
                <span class="text-gray-500 block">{t('export_label_bitrate')}</span>
                <span class="font-medium text-gray-900">{effectiveBitrate} Mbps</span>
              </div>
              <div>
                <span class="text-gray-500 block">{t('export_est_size')}</span>
                <span class="font-medium text-gray-900">~{formatFileSize(estimatedSize)}</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- GIF Settings -->
        {#if selectedFormat === 'gif'}
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="gif-fps" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_framerate')}</label>
              <select
                id="gif-fps"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                bind:value={gifFps}
              >
                {#each [5, 10, 15] as fps}
                  <option value={fps}>{fps} fps</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="gif-scale" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_output_size')}</label>
              <select
                id="gif-scale"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                bind:value={gifScale}
              >
                {#each gifScaleOptions as opt}
                  <option value={opt.scalePercent}>{gifSizeLabel(opt.id)} · {opt.width}×{opt.height}</option>
                {/each}
              </select>
            </div>
          </div>

          <div>
            <label for="gif-repeat" class="block text-sm font-medium text-gray-700 mb-2">
              {t('export_label_loop', undefined, { export_label_loop: 'Loop' })}
            </label>
            <select
              id="gif-repeat"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              bind:value={gifRepeat}
            >
              {#each GIF_LOOP_OPTIONS as option}
                <option value={option.value}>{gifLoopLabel(option)}</option>
              {/each}
            </select>
          </div>

          <div class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
            <div class="flex items-start gap-3">
              <Zap class="mt-0.5 h-4 w-4 flex-none text-emerald-700" />
              <div>
                <p class="text-sm font-semibold">{t('export_gif_compression_title')}</p>
                <p class="mt-0.5 text-xs leading-5 text-emerald-800">
                  {t('export_gif_compression_desc', String(gifFps))}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-expanded={showGifAdvanced}
            onclick={() => { showGifAdvanced = !showGifAdvanced }}
          >
            <span>{t('export_gif_advanced_colors')}</span>
            <span class="text-xs font-medium text-gray-500">{showGifAdvanced ? t('common_hide') : t('common_show')}</span>
          </button>

          {#if showGifAdvanced}
          <div class="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 p-4">
            <div>
              <label for="gif-quality" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_color_detail')}</label>
              <select
                id="gif-quality"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                bind:value={gifQuality}
              >
                {#each gifQualityOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="gif-dither" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_dither')}</label>
              <select
                id="gif-dither"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                bind:value={gifDither}
              >
                <option value="false">{t('export_dither_off_ui')}</option>
                <option value="FloydSteinberg">Floyd-Steinberg</option>
                <option value="Atkinson">Atkinson</option>
              </select>
            </div>
            <p class="col-span-2 text-xs leading-5 text-gray-500">{t('export_dither_help')}</p>
          </div>
          {/if}

          <!-- GIF Estimated Output -->
          <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Info class="w-4 h-4" />
              {t('export_est_output')}
            </h3>
            <div class="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span class="text-gray-500 block">{t('export_label_resolution')}</span>
                <span class="font-medium text-gray-900">{gifOutputWidth}×{gifOutputHeight}</span>
              </div>
              <div>
                <span class="text-gray-500 block">{t('export_source_frames')}</span>
                <span class="font-medium text-gray-900">~{gifEstimatedFrames}</span>
              </div>
              <div>
                <span class="text-gray-500 block">{t('export_est_size')}</span>
                <span class="font-medium text-gray-900">~{formatSizeRange(gifEstimatedSizeRange.minBytes, gifEstimatedSizeRange.maxBytes)}</span>
              </div>
            </div>
          </div>

          <div
            class="flex items-start gap-3 rounded-lg border px-4 py-3"
            class:border-emerald-900={gifDeliveryAdvisory.tone === 'good'}
            class:bg-emerald-950={gifDeliveryAdvisory.tone === 'good'}
            class:text-emerald-200={gifDeliveryAdvisory.tone === 'good'}
            class:border-amber-900={gifDeliveryAdvisory.tone === 'caution'}
            class:bg-amber-950={gifDeliveryAdvisory.tone === 'caution'}
            class:text-amber-200={gifDeliveryAdvisory.tone === 'caution'}
            class:border-red-900={gifDeliveryAdvisory.tone === 'warning'}
            class:bg-red-950={gifDeliveryAdvisory.tone === 'warning'}
            class:text-red-200={gifDeliveryAdvisory.tone === 'warning'}
            role="status"
          >
            {#if gifDeliveryAdvisory.tone === 'warning'}
              <TriangleAlert class="mt-0.5 h-4 w-4 flex-none" />
            {:else}
              <Info class="mt-0.5 h-4 w-4 flex-none" />
            {/if}
            <div class="min-w-0">
              {#if gifDeliveryAdvisory.code === 'email-ready'}
                <p class="text-sm font-semibold">{t('export_email_ready_title', undefined, { export_email_ready_title: 'Email-friendly estimate' })}</p>
                <p class="mt-0.5 text-xs opacity-80">{t('export_email_ready_desc', undefined, { export_email_ready_desc: 'The full estimate stays within the 1 MB target.' })}</p>
              {:else if gifDeliveryAdvisory.code === 'too-heavy'}
                <p class="text-sm font-semibold">{t('export_email_heavy_title', undefined, { export_email_heavy_title: 'Likely too heavy for email' })}</p>
                <p class="mt-0.5 text-xs opacity-80">{t('export_email_heavy_desc', undefined, { export_email_heavy_desc: 'Even the low estimate reaches 5 MB. Trim the clip or reduce FPS or scale.' })}</p>
              {:else}
                <p class="text-sm font-semibold">{t('export_email_review_title', undefined, { export_email_review_title: 'Review for email delivery' })}</p>
                <p class="mt-0.5 text-xs opacity-80">{t('export_email_review_desc', undefined, { export_email_review_desc: 'The estimate can exceed 1 MB. Check the final file before adding it to an EDM.' })}</p>
              {/if}
            </div>
          </div>
        {/if}

      </div>

      {#if errorMessage && !isExporting}
        <div class="mx-6 mt-4 flex items-start gap-3 rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-3">
          <TriangleAlert class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-red-300">{errorMessage}</p>
            {#if errorHint}
              <p class="mt-1 text-xs text-red-400">{errorHint}</p>
            {/if}
          </div>
          {#if showOpenDriveAction && onOpenDrive}
            <button
              class="inline-flex items-center gap-1.5 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20"
              onclick={onOpenDrive}
            >
              <HardDrive class="h-3.5 w-3.5" />
              {t('studio_emptyOpenDrive')}
            </button>
          {/if}
          {#if showReloadStudioAction && onReloadStudio}
            <button
              class="inline-flex items-center gap-1.5 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20"
              onclick={onReloadStudio}
            >
              <RefreshCw class="h-3.5 w-3.5" />
              {t('export_error_reload_action', undefined, {
                export_error_reload_action: 'Reload Studio'
              })}
            </button>
          {/if}
        </div>
      {/if}

      <!-- Footer -->
      <div class="studio-dialog-footer flex items-center justify-end gap-3 px-6 py-4">
        <button
          type="button"
          class="studio-muted-action px-4 py-2 text-sm font-medium"
          onclick={handleClose}
          disabled={isExporting}
        >
          {t('export_btn_cancel')}
        </button>
        <button
          type="button"
          class="studio-primary-action flex items-center gap-2 px-6 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          onclick={handleExport}
          disabled={isExporting}
        >
          {#if isExporting}
            <LoaderCircle class="w-4 h-4 animate-spin" />
          {:else}
            <FileDown class="w-4 h-4" />
          {/if}
          {exportButtonLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
