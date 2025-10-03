<script lang="ts">
  import { 
    X, 
    LoaderCircle, 
    Film, 
    Video,
    Target, 
    Gem, 
    Scale, 
    FileDown, 
    Waves, 
    Zap,
    Settings,
    BarChart3,
    Info,
    CircleCheck,
    Clock
  } from '@lucide/svelte'

  interface Props {
    open: boolean
    format: 'mp4' | 'webm'
    onClose: () => void
    onConfirm: (options: VideoExportOptions) => void
    sourceInfo: SourceVideoInfo
    isExporting?: boolean
    exportProgress?: {
      stage: string
      progress: number
      currentFrame: number
      totalFrames: number
      estimatedTimeRemaining?: number
    } | null
  }

  let {
    open = $bindable(),
    format,
    onClose,
    onConfirm,
    sourceInfo,
    isExporting = false,
    exportProgress = null
  }: Props = $props()

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

  export interface SourceVideoInfo {
    width: number
    height: number
    frameCount: number
    codec: string
    duration: number
    estimatedSize: number
  }

  // Default settings
  let resolution = $state<string>('source')
  let quality = $state<string>('high')
  let framerate = $state<number>(30)
  let bitrateMode = $state<'auto' | 'manual'>('auto')
  let manualBitrate = $state<number>(8)
  let encodingSpeed = $state<string>('balanced')
  let limitFileSize = $state<boolean>(false)
  let maxFileSize = $state<number>(100)

  // Preset templates
  const presets = {
    'source': {
      name: 'Match Source',
      icon: Gem,
      resolution: 'source',
      quality: 'high',
      framerate: 30,
      bitrate: 'auto',
      encodingSpeed: 'balanced'
    },
    'youtube-1080p': {
      name: 'YouTube 1080p',
      icon: Video,
      resolution: '1080p',
      quality: 'high',
      framerate: 30,
      bitrate: 10,
      encodingSpeed: 'balanced'
    },
    'social-media': {
      name: 'Social Media',
      icon: Waves,
      resolution: '1080p',
      quality: 'balanced',
      framerate: 30,
      bitrate: 5,
      encodingSpeed: 'balanced',
      limitFileSize: true,
      maxSize: 100
    },
    'quick-preview': {
      name: 'Quick Preview',
      icon: Zap,
      resolution: '720p',
      quality: 'balanced',
      framerate: 30,
      bitrate: 3,
      encodingSpeed: 'fast'
    },
    'master-quality': {
      name: 'Master Quality',
      icon: Gem,
      resolution: 'source',
      quality: 'best',
      framerate: 30,
      bitrate: 20,
      encodingSpeed: 'slow'
    }
  }

  // Resolution options
  const resolutionOptions = [
    { value: 'source', label: `Match Source (${sourceInfo.width}×${sourceInfo.height})`, width: sourceInfo.width, height: sourceInfo.height },
    { value: '2160p', label: '2160p (4K)', width: 3840, height: 2160 },
    { value: '1440p', label: '1440p (2K)', width: 2560, height: 1440 },
    { value: '1080p', label: '1080p (Full HD)', width: 1920, height: 1080 },
    { value: '720p', label: '720p (HD)', width: 1280, height: 720 },
    { value: '480p', label: '480p (SD)', width: 854, height: 480 }
  ]

  // Quality presets
  const qualityPresets = [
    { value: 'draft', label: 'Draft', description: 'Fastest export, lower quality' },
    { value: 'balanced', label: 'Balanced', description: 'Good quality, reasonable speed' },
    { value: 'high', label: 'High', description: 'High quality, slower' },
    { value: 'best', label: 'Best', description: 'Maximum quality, slowest' }
  ]

  // Framerate options
  const framerateOptions = [24, 30, 60]

  // Encoding speed options
  const encodingSpeedOptions = [
    { value: 'fastest', label: 'Fastest' },
    { value: 'fast', label: 'Fast' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'slow', label: 'Slow' },
    { value: 'slowest', label: 'Slowest' }
  ]

  function applyPreset(presetName: keyof typeof presets) {
    const preset = presets[presetName]
    resolution = preset.resolution
    quality = preset.quality
    framerate = preset.framerate
    if (preset.bitrate === 'auto') {
      bitrateMode = 'auto'
    } else {
      bitrateMode = 'manual'
      manualBitrate = preset.bitrate as number
    }
    encodingSpeed = preset.encodingSpeed
    if (preset.limitFileSize) {
      limitFileSize = true
      maxFileSize = preset.maxSize || 100
    }
  }

  function handleConfirm() {
    const selectedResolution = resolutionOptions.find(r => r.value === resolution)!
    
    const options: VideoExportOptions = {
      resolution,
      resolutionWidth: selectedResolution.width,
      resolutionHeight: selectedResolution.height,
      quality,
      framerate,
      bitrate: bitrateMode === 'auto' ? calculateAutoBitrate() : manualBitrate * 1_000_000,
      targetFileSize: limitFileSize ? maxFileSize : undefined,
      encodingSpeed
    }
    onConfirm(options)
  }

  function handleCancel() {
    if (!isExporting) {
      onClose()
      open = false
    }
  }

  function calculateAutoBitrate(): number {
    const selectedResolution = resolutionOptions.find(r => r.value === resolution)!
    const pixels = selectedResolution.width * selectedResolution.height
    
    // Bitrate formula: pixels * framerate * quality_factor
    const qualityFactors = {
      'draft': 0.05,
      'balanced': 0.1,
      'high': 0.15,
      'best': 0.2
    }
    
    const factor = qualityFactors[quality as keyof typeof qualityFactors] || 0.1
    return Math.round(pixels * framerate * factor)
  }

  // Calculate estimated output
  const estimatedResolution = $derived(() => {
    const selected = resolutionOptions.find(r => r.value === resolution)!
    return `${selected.width}×${selected.height}`
  })

  const estimatedBitrate = $derived(() => {
    const bitrate = bitrateMode === 'auto' ? calculateAutoBitrate() : manualBitrate * 1_000_000
    return (bitrate / 1_000_000).toFixed(1)
  })

  const estimatedSize = $derived(() => {
    const bitrate = bitrateMode === 'auto' ? calculateAutoBitrate() : manualBitrate * 1_000_000
    const durationSeconds = sourceInfo.duration
    const bytes = (bitrate / 8) * durationSeconds
    
    if (limitFileSize && bytes > maxFileSize * 1024 * 1024) {
      return `~${maxFileSize} MB (limited)`
    }
    
    if (bytes < 1024 * 1024) {
      return `~${Math.round(bytes / 1024)} KB`
    } else {
      return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }
  })

  const estimatedTime = $derived(() => {
    const speedFactors = {
      'fastest': 0.5,
      'fast': 0.7,
      'balanced': 1.0,
      'slow': 1.5,
      'slowest': 2.0
    }
    const factor = speedFactors[encodingSpeed as keyof typeof speedFactors] || 1.0
    const baseTime = sourceInfo.duration * 0.3 // Rough estimate: 30% of video duration
    const seconds = Math.round(baseTime * factor)
    
    if (seconds < 60) return `~${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `~${minutes}m ${remainingSeconds}s`
  })

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const stageText = $derived(() => {
    if (!exportProgress) return ''
    switch (exportProgress.stage) {
      case 'preparing': return 'Preparing'
      case 'compositing': return 'Compositing Background'
      case 'encoding': return 'Encoding'
      case 'muxing': return 'Muxing Container'
      case 'finalizing': return 'Finalizing'
      default: return exportProgress.stage
    }
  })

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.round(seconds % 60)
    return `${minutes}m ${remainingSeconds}s`
  }
</script>

{#if open}
  <!-- Backdrop overlay -->
  <div
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    onclick={handleCancel}
    role="presentation"
  >
    <!-- Dialog content -->
    <div
      class="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') handleCancel() }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
        <h2 class="text-xl font-semibold text-gray-900 flex items-center gap-2">
          {#if format === 'mp4'}
            <Film class="w-6 h-6 text-blue-600" />
            Export MP4 Video
          {:else}
            <Video class="w-6 h-6 text-emerald-600" />
            Export WebM Video
          {/if}
        </h2>
        <button
          onclick={handleCancel}
          disabled={isExporting}
          class="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close"
        >
          <X class="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <!-- Content -->
      <div class="px-6 py-4 space-y-6">
        <!-- Source Information -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 class="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
            <Info class="w-4 h-4" />
            Source Information
          </h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span class="text-blue-600">Resolution:</span>
              <span class="font-semibold ml-1">{sourceInfo.width}×{sourceInfo.height}</span>
            </div>
            <div>
              <span class="text-blue-600">Codec:</span>
              <span class="font-semibold ml-1">{sourceInfo.codec.toUpperCase()}</span>
            </div>
            <div>
              <span class="text-blue-600">Duration:</span>
              <span class="font-semibold ml-1">{formatDuration(sourceInfo.duration)}</span>
            </div>
            <div>
              <span class="text-blue-600">Frames:</span>
              <span class="font-semibold ml-1">{sourceInfo.frameCount}</span>
            </div>
          </div>
        </div>

        <!-- Presets -->
        <div class="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4">
          <label class="block text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Target class="w-4 h-4" />
            Quick Presets
          </label>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
            {#each Object.entries(presets) as [key, preset]}
              {@const Icon = preset.icon}
              <button
                onclick={() => applyPreset(key as keyof typeof presets)}
                disabled={isExporting}
                class="px-3 py-2 bg-white border-2 border-blue-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon class="w-4 h-4" />
                {preset.name}
              </button>
            {/each}
          </div>
        </div>

        <!-- Basic Settings -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Settings class="w-4 h-4" />
            Export Settings
          </h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Resolution -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Resolution
              
              <select
                bind:value={resolution}
                disabled={isExporting}
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {#each resolutionOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
              </label>
            </div>

            <!-- Quality -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Quality
              
              <select
                bind:value={quality}
                disabled={isExporting}
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {#each qualityPresets as preset}
                  <option value={preset.value}>{preset.label} - {preset.description}</option>
                {/each}
              </select>
              </label>
            </div>

            <!-- Frame Rate -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Frame Rate
              
              <select
                bind:value={framerate}
                disabled={isExporting}
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {#each framerateOptions as fps}
                  <option value={fps}>{fps} fps</option>
                {/each}
              </select>
              </label>
            </div>

            <!-- Encoding Speed -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Encoding Speed
              
              <select
                bind:value={encodingSpeed}
                disabled={isExporting}
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {#each encodingSpeedOptions as speed}
                  <option value={speed.value}>{speed.label}</option>
                {/each}
              </select>
              </label>
            </div>
          </div>
        </div>

        <!-- Advanced Settings -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-700">Advanced Settings</h3>
          
          <div class="space-y-3">
            <!-- Bitrate Control -->
            <div>
              <div class="block text-sm text-gray-600 mb-2">Bitrate Control</div>
              <div class="flex gap-4 mb-2">
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    bind:group={bitrateMode}
                    value="auto"
                    disabled={isExporting}
                    class="text-blue-600 focus:ring-blue-500"
                  />
                  <span class="text-sm">Auto</span>
                </label>
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    bind:group={bitrateMode}
                    value="manual"
                    disabled={isExporting}
                    class="text-blue-600 focus:ring-blue-500"
                  />
                  <span class="text-sm">Manual</span>
                </label>
              </div>
              {#if bitrateMode === 'manual'}
                <div class="flex items-center gap-2">
                  <input
                    type="range"
                    bind:value={manualBitrate}
                    min="1"
                    max="50"
                    step="1"
                    disabled={isExporting}
                    class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span class="text-sm font-semibold text-blue-600 w-16">{manualBitrate} Mbps</span>
                </div>
              {/if}
            </div>

            <!-- File Size Limit -->
            <div>
              <label class="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  bind:checked={limitFileSize}
                  disabled={isExporting}
                  class="rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span class="text-sm text-gray-600">Limit file size</span>
              </label>
              {#if limitFileSize}
                <div class="flex items-center gap-2">
                  <input
                    type="range"
                    bind:value={maxFileSize}
                    min="10"
                    max="500"
                    step="10"
                    disabled={isExporting}
                    class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span class="text-sm font-semibold text-blue-600 w-20">{maxFileSize} MB</span>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Estimated Output -->
        <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <h4 class="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
            <BarChart3 class="w-4 h-4" />
            Estimated Output
          </h4>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span class="text-emerald-600">Resolution:</span>
              <span class="font-semibold ml-1">{estimatedResolution()}</span>
            </div>
            <div>
              <span class="text-emerald-600">Bitrate:</span>
              <span class="font-semibold ml-1">{estimatedBitrate()} Mbps</span>
            </div>
            <div>
              <span class="text-emerald-600">File Size:</span>
              <span class="font-semibold ml-1">{estimatedSize()}</span>
            </div>
            <div>
              <span class="text-emerald-600">Export Time:</span>
              <span class="font-semibold ml-1">{estimatedTime()}</span>
            </div>
          </div>
        </div>

        <!-- Export Progress -->
        {#if isExporting && exportProgress}
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-sm font-semibold text-blue-900 flex items-center gap-2">
                <LoaderCircle class="w-4 h-4 animate-spin" />
                Exporting {format.toUpperCase()}...
              </h4>
              <span class="text-sm font-semibold text-blue-600">
                {Math.round(exportProgress.progress)}%
              </span>
            </div>

            <!-- Progress Bar -->
            <div class="w-full h-2 bg-blue-100 rounded-full overflow-hidden mb-3">
              <div
                class="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-300"
                style="width: {exportProgress.progress}%"
              ></div>
            </div>

            <!-- Details -->
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span class="text-blue-600">Stage:</span>
                <span class="font-semibold ml-1">{stageText()}</span>
              </div>
              <div>
                <span class="text-blue-600">Frames:</span>
                <span class="font-semibold ml-1">{exportProgress.currentFrame} / {exportProgress.totalFrames}</span>
              </div>
              {#if exportProgress.estimatedTimeRemaining && exportProgress.estimatedTimeRemaining > 0}
                <div class="col-span-2">
                  <span class="text-blue-600 flex items-center gap-1">
                    <Clock class="w-3 h-3" />
                    Remaining:
                  </span>
                  <span class="font-semibold ml-1">{formatTime(exportProgress.estimatedTimeRemaining)}</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <!-- Footer Buttons -->
      <div class="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3 rounded-b-xl">
        <button
          onclick={handleCancel}
          disabled={isExporting}
          class="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExporting ? 'Exporting...' : 'Cancel'}
        </button>
        <button
          onclick={handleConfirm}
          disabled={isExporting}
          class="px-6 py-2 bg-gradient-to-r from-blue-500 to-emerald-500 text-white rounded-lg hover:from-blue-600 hover:to-emerald-600 transition-all font-medium shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {#if isExporting}
            <LoaderCircle class="w-4 h-4 animate-spin" />
            Exporting...
          {:else}
            {#if format === 'mp4'}
              <Film class="w-4 h-4" />
            {:else}
              <Video class="w-4 h-4" />
            {/if}
            Start Export
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
