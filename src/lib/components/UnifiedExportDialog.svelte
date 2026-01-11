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
    Clock
  } from '@lucide/svelte'
  import { trimStore } from '$lib/stores/trim.svelte'
  import { _t as t } from '$lib/utils/i18n'

  interface Props {
    open: boolean
    onClose: () => void
    onExport: (format: ExportFormat, options: VideoExportOptions | GifExportOptions) => void
    sourceInfo: SourceVideoInfo
    sourceFps?: number
    isExporting?: boolean
    exportProgress?: {
      stage: string
      progress: number
      currentFrame: number
      totalFrames: number
      estimatedTimeRemaining?: number
    } | null
    hasBackground?: boolean
  }

  let {
    open = $bindable(),
    onClose,
    onExport,
    sourceInfo,
    sourceFps = 30,
    isExporting = false,
    exportProgress = null,
    hasBackground = false
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
  let gifWorkers = $state(2)
  let gifRepeat = $state(0)
  let gifDither = $state<string>('false')
  let gifTransparent = $state<string | null>(null)

  // Reset framerate when dialog closes
  $effect(() => {
    if (!open) {
      framerate = sourceFps || 30
    }
  })

  // Resolution options
  const resolutionOptions = $derived([
    { value: 'source', label: t('export_res_source', [String(sourceInfo.width), String(sourceInfo.height)]), width: sourceInfo.width, height: sourceInfo.height },
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
    { value: 1, label: t('export_gif_best') },
    { value: 5, label: t('export_gif_high') },
    { value: 10, label: t('export_gif_good') },
    { value: 15, label: t('export_gif_fast') },
    { value: 20, label: t('export_gif_fastest') }
  ])

  // GIF scale options
  const gifScaleOptions = $derived([
    { value: 100, label: t('export_scale_original') },
    { value: 75, label: '75%' },
    { value: 50, label: '50%' },
    { value: 25, label: '25%' }
  ])

  // Computed values
  const selectedResolution = $derived(
    resolutionOptions.find((r) => r.value === resolution) || resolutionOptions[0]
  )

  const outputWidth = $derived(selectedResolution.width)
  const outputHeight = $derived(selectedResolution.height)

  const displayFrameCount = $derived(
    trimStore.enabled ? trimStore.trimFrameCount : sourceInfo.frameCount
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
  const gifOutputWidth = $derived(Math.floor(sourceInfo.width * (gifScale / 100)))
  const gifOutputHeight = $derived(Math.floor(sourceInfo.height * (gifScale / 100)))
  const gifEstimatedFrames = $derived(Math.ceil(displayFrameCount / Math.max(1, Math.round(sourceFps / gifFps))))
  const gifEstimatedSize = $derived.by(() => {
    const pixels = gifOutputWidth * gifOutputHeight
    const baseSize = (pixels * gifEstimatedFrames * (21 - gifQuality)) / 1000
    return baseSize
  })

  // Handle export
  function handleExport() {
    if (selectedFormat === 'gif') {
      const gifOptions: GifExportOptions = {
        fps: gifFps,
        quality: gifQuality,
        scale: gifScale / 100,
        workers: gifWorkers,
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
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
    onclick={handleClose}
    onkeydown={(e) => e.key === 'Escape' && handleClose()}
    role="dialog"
    tabindex="-1"
  >
    <!-- Dialog -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col relative"
      onclick={(e) => e.stopPropagation()}
      role="document"
    >
      <!-- Export Progress Overlay -->
      {#if isExporting && exportProgress}
        <div class="absolute inset-0 bg-white/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center p-8">
          <div class="w-full max-w-md space-y-6">
            <!-- Progress Icon -->
            <div class="flex justify-center">
              <div class="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
                <LoaderCircle class="w-8 h-8 text-blue-600 animate-spin" />
              </div>
            </div>

            <!-- Stage & Progress -->
            <div class="text-center">
              <h3 class="text-lg font-semibold text-gray-900 mb-1">
                {stageLabels[exportProgress.stage] || exportProgress.stage}
              </h3>
              <p class="text-3xl font-bold text-blue-600">{Math.round(exportProgress.progress)}%</p>
            </div>

            <!-- Progress Bar -->
            <div class="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                class="h-full bg-blue-600 rounded-full transition-all duration-300"
                style="width: {exportProgress.progress}%"
              ></div>
            </div>

            <!-- Frame Info -->
            {#if exportProgress.currentFrame > 0}
              <div class="flex items-center justify-between text-sm text-gray-500">
                <span>{t('export_progress_frame', [String(exportProgress.currentFrame), String(exportProgress.totalFrames)])}</span>
                {#if exportProgress.estimatedTimeRemaining && exportProgress.estimatedTimeRemaining > 0}
                  <span class="flex items-center gap-1">
                    <Clock class="w-4 h-4" />
                    {t('export_progress_time', String(Math.ceil(exportProgress.estimatedTimeRemaining / 1000)))}
                  </span>
                {/if}
              </div>
            {/if}

            <!-- Cancel hint -->
            <p class="text-center text-xs text-gray-400">
              {t('export_progress_hint')}
            </p>
          </div>
        </div>
      {/if}
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 class="text-xl font-bold text-gray-900 flex items-center gap-2">
          <FileDown class="w-5 h-5" />
          {t('export_dialog_title')}
        </h2>
        <button
          class="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          onclick={handleClose}
          disabled={isExporting}
        >
          <X class="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <!-- Source Information (above tabs) -->
      <div class="px-6 py-4 bg-gray-50 border-b border-gray-200">
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
      <div class="flex gap-1 px-6 py-3 border-b border-gray-200">
        {#each formatTabs as tab}
          {@const isSelected = selectedFormat === tab.id}
          <button
            class="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors
              {isSelected
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
            onclick={() => selectedFormat = tab.id}
            disabled={isExporting}
          >
            <tab.icon class="w-4 h-4" />
            {tab.label}
          </button>
        {/each}
      </div>

      <!-- Content (Scrollable) -->
      <div class="flex-1 overflow-y-auto p-6 space-y-6">
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
                    {bitrateMode === 'auto' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
                  onclick={() => bitrateMode = 'auto'}
                >{t('export_bitrate_auto')}</button>
                <button
                  class="px-3 py-1 text-xs rounded-md transition-colors
                    {bitrateMode === 'manual' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
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
                {#each [5, 10, 15, 20, 25, 30] as fps}
                  <option value={fps}>{fps} fps</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="gif-quality" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_gif_quality')}</label>
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
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="gif-scale" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_scale')}</label>
              <select
                id="gif-scale"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                bind:value={gifScale}
              >
                {#each gifScaleOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="gif-workers" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_workers')}</label>
              <select
                id="gif-workers"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                bind:value={gifWorkers}
              >
                {#each [1, 2, 4, 8] as w}
                  <option value={w}>{t(w === 1 ? 'export_worker_singular' : 'export_worker_plural', String(w))}</option>
                {/each}
              </select>
            </div>
          </div>

          <div>
            <label for="gif-dither" class="block text-sm font-medium text-gray-700 mb-2">{t('export_label_dither')}</label>
            <select
              id="gif-dither"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              bind:value={gifDither}
            >
              <option value="false">{t('export_dither_none')}</option>
              <option value="FloydSteinberg">Floyd-Steinberg</option>
              <option value="FalseFloydSteinberg">False Floyd-Steinberg</option>
              <option value="Stucki">Stucki</option>
              <option value="Atkinson">Atkinson</option>
            </select>
          </div>

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
                <span class="font-medium text-gray-900">~{formatFileSize(gifEstimatedSize)}</span>
              </div>
            </div>
          </div>
        {/if}

      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
        <button
          class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          onclick={handleClose}
          disabled={isExporting}
        >
          {t('export_btn_cancel')}
        </button>
        <button
          class="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
