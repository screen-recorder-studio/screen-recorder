<script lang="ts">
  import { 
    X, 
    LoaderCircle, 
    Film, 
    Target, 
    Gem, 
    Scale, 
    FileDown, 
    Waves, 
    Gamepad2,
    Settings,
    Palette,
    BarChart3
  } from '@lucide/svelte'

  interface Props {
    open: boolean
    onClose: () => void
    onConfirm: (options: GifExportOptions) => void
    videoDuration?: number
    videoWidth?: number
    videoHeight?: number
    isExporting?: boolean
    exportProgress?: {
      stage: string
      progress: number
      currentFrame: number
      totalFrames: number
    } | null
  }

  let {
    open = $bindable(),
    onClose,
    onConfirm,
    videoDuration = 10,
    videoWidth = 1920,
    videoHeight = 1080,
    isExporting = false,
    exportProgress = null
  }: Props = $props()

  export interface GifExportOptions {
    fps: number
    quality: number
    scale: number
    workers: number
    repeat: number
    dither: boolean | string
    transparent: string | null
  }

  // Default settings
  let fps = $state(10)
  let quality = $state(10)
  let scale = $state(75)
  let workers = $state(2)
  let repeat = $state(0)
  let dither = $state<string>('false')
  let transparent = $state<string | null>(null)

  // Preset templates
  const presets = {
    'high-quality': {
      fps: 15,
      quality: 5,
      scale: 100,
      workers: 4,
      repeat: 0,
      dither: 'FloydSteinberg'
    },
    'balanced': {
      fps: 10,
      quality: 10,
      scale: 75,
      workers: 2,
      repeat: 0,
      dither: 'false'
    },
    'small-size': {
      fps: 8,
      quality: 20,
      scale: 50,
      workers: 2,
      repeat: 0,
      dither: 'false'
    },
    'smooth': {
      fps: 20,
      quality: 8,
      scale: 75,
      workers: 4,
      repeat: 0,
      dither: 'FloydSteinberg'
    },
    'retro': {
      fps: 12,
      quality: 15,
      scale: 60,
      workers: 2,
      repeat: 0,
      dither: 'Atkinson'
    }
  }

  function applyPreset(presetName: keyof typeof presets) {
    const preset = presets[presetName]
    fps = preset.fps
    quality = preset.quality
    scale = preset.scale
    workers = preset.workers
    repeat = preset.repeat
    dither = preset.dither
  }

  function handleConfirm() {
    const options: GifExportOptions = {
      fps,
      quality,
      scale: scale / 100,
      workers,
      repeat,
      dither: dither === 'false' ? false : dither,
      transparent
    }
    onConfirm(options)
    // Keep dialog open until export completes
  }

  function handleCancel() {
    if (!isExporting) {
      onClose()
      open = false
    }
  }

  // Get stage text
  const stageText = $derived(() => {
    if (!exportProgress) return ''
    switch (exportProgress.stage) {
      case 'preparing': return 'Preparing'
      case 'compositing': return 'Compositing Video'
      case 'encoding': return 'Extracting Frames'
      case 'muxing': return 'Adding Frames'
      case 'finalizing': return 'Rendering GIF'
      default: return exportProgress.stage
    }
  })

  // Calculate estimated output info
  const estimatedFrames = $derived(Math.ceil(videoDuration * fps))
  const estimatedWidth = $derived(Math.round(videoWidth * (scale / 100)))
  const estimatedHeight = $derived(Math.round(videoHeight * (scale / 100)))
  const estimatedSize = $derived(() => {
    // Rough estimate: approximately width * height * 0.5 bytes per frame
    const bytesPerFrame = estimatedWidth * estimatedHeight * 0.5
    const totalBytes = bytesPerFrame * estimatedFrames
    if (totalBytes < 1024 * 1024) {
      return `${Math.round(totalBytes / 1024)} KB`
    } else {
      return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
    }
  })

  const repeatText = $derived(repeat === -1 ? 'No loop' : repeat === 0 ? 'Loop forever' : `${repeat} time${repeat > 1 ? 's' : ''}`)
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
      class="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') handleCancel() }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
        <h2 class="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Film class="w-6 h-6 text-purple-600" />
          GIF Export Settings
        </h2>
        <button
          onclick={handleCancel}
          class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Close"
        >
          <X class="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <!-- Content -->
      <div class="px-6 py-4 space-y-6">
        <!-- Presets -->
        <div class="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4">
          <label class="block text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Target class="w-4 h-4" />
            Presets
          </label>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
            <button
              onclick={() => applyPreset('high-quality')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium flex items-center justify-center gap-1.5"
            >
              <Gem class="w-4 h-4" />
              High Quality
            </button>
            <button
              onclick={() => applyPreset('balanced')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium flex items-center justify-center gap-1.5"
            >
              <Scale class="w-4 h-4" />
              Balanced
            </button>
            <button
              onclick={() => applyPreset('small-size')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium flex items-center justify-center gap-1.5"
            >
              <FileDown class="w-4 h-4" />
              Small Size
            </button>
            <button
              onclick={() => applyPreset('smooth')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium flex items-center justify-center gap-1.5"
            >
              <Waves class="w-4 h-4" />
              Smooth
            </button>
            <button
              onclick={() => applyPreset('retro')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium flex items-center justify-center gap-1.5"
            >
              <Gamepad2 class="w-4 h-4" />
              Retro
            </button>
          </div>
        </div>

        <!-- Basic Settings -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Settings class="w-4 h-4" />
            Basic Settings
          </h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Frame Rate -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Frame Rate (FPS): <span class="font-semibold text-purple-600">{fps}</span>
              </label>
              <input
                type="range"
                bind:value={fps}
                min="5"
                max="30"
                step="1"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">Higher = smoother, but larger file size</p>
            </div>

            <!-- Quality -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Quality: <span class="font-semibold text-purple-600">{quality}</span>
              </label>
              <input
                type="range"
                bind:value={quality}
                min="1"
                max="30"
                step="1"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">1 = Best (slow) | 10 = Balanced | 30 = Fast (lower quality)</p>
            </div>

            <!-- Scale -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Scale: <span class="font-semibold text-purple-600">{scale}%</span>
              </label>
              <input
                type="range"
                bind:value={scale}
                min="25"
                max="100"
                step="5"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">Output size: {estimatedWidth}x{estimatedHeight}</p>
            </div>

            <!-- Worker Threads -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Worker Threads: <span class="font-semibold text-purple-600">{workers}</span>
              </label>
              <input
                type="range"
                bind:value={workers}
                min="1"
                max="8"
                step="1"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">More threads = faster encoding</p>
            </div>
          </div>
        </div>

        <!-- Advanced Settings -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Palette class="w-4 h-4" />
            Advanced Settings
          </h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Loop Count -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                Loop Count: <span class="font-semibold text-purple-600">{repeatText}</span>
              </label>
              <input
                type="range"
                bind:value={repeat}
                min="-1"
                max="10"
                step="1"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">-1 = No loop | 0 = Loop forever</p>
            </div>

            <!-- Dithering Algorithm -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">Dithering</label>
              <select
                bind:value={dither}
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="false">None</option>
                <option value="FloydSteinberg">Floyd-Steinberg</option>
                <option value="FalseFloydSteinberg">False Floyd-Steinberg</option>
                <option value="Stucki">Stucki</option>
                <option value="Atkinson">Atkinson</option>
                <option value="FloydSteinberg-serpentine">Floyd-Steinberg (Serpentine)</option>
              </select>
              <p class="text-xs text-gray-500 mt-1">Improves color transitions</p>
            </div>
          </div>
        </div>

        <!-- Estimated Output -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 class="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
            <BarChart3 class="w-4 h-4" />
            Estimated Output
          </h4>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span class="text-blue-600">Frames:</span>
              <span class="font-semibold ml-1">{estimatedFrames}</span>
            </div>
            <div>
              <span class="text-blue-600">Size:</span>
              <span class="font-semibold ml-1">{estimatedWidth}x{estimatedHeight}</span>
            </div>
            <div>
              <span class="text-blue-600">File Size:</span>
              <span class="font-semibold ml-1">{estimatedSize()}</span>
            </div>
            <div>
              <span class="text-blue-600">Duration:</span>
              <span class="font-semibold ml-1">{videoDuration.toFixed(1)}s</span>
            </div>
          </div>
        </div>

        <!-- Export Progress -->
        {#if isExporting && exportProgress}
          <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-sm font-semibold text-purple-900 flex items-center gap-2">
                <LoaderCircle class="w-4 h-4 animate-spin" />
                Exporting GIF...
              </h4>
              <span class="text-sm font-semibold text-purple-600">
                {Math.round(exportProgress.progress)}%
              </span>
            </div>

            <!-- Progress Bar -->
            <div class="w-full h-2 bg-purple-100 rounded-full overflow-hidden mb-3">
              <div
                class="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-300"
                style="width: {exportProgress.progress}%"
              ></div>
            </div>

            <!-- Details -->
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span class="text-purple-600">Stage:</span>
                <span class="font-semibold ml-1">{stageText()}</span>
              </div>
              <div>
                <span class="text-purple-600">Frames:</span>
                <span class="font-semibold ml-1">{exportProgress.currentFrame} / {exportProgress.totalFrames}</span>
              </div>
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
          class="px-6 py-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-lg hover:from-purple-600 hover:to-blue-600 transition-all font-medium shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if isExporting}
            <span class="flex items-center gap-2">
              <LoaderCircle class="w-4 h-4 animate-spin" />
              Exporting...
            </span>
          {:else}
            Start Export
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

