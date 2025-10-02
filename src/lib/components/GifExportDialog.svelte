<script lang="ts">
  import { X, LoaderCircle } from '@lucide/svelte'

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

  // 默认设置
  let fps = $state(10)
  let quality = $state(10)
  let scale = $state(75)
  let workers = $state(2)
  let repeat = $state(0)
  let dither = $state<string>('false')
  let transparent = $state<string | null>(null)

  // 预设模板
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
    // 不关闭对话框，等待导出完成
  }

  function handleCancel() {
    if (!isExporting) {
      onClose()
      open = false
    }
  }

  // 获取阶段文本
  const stageText = $derived(() => {
    if (!exportProgress) return ''
    switch (exportProgress.stage) {
      case 'preparing': return '准备中'
      case 'compositing': return '合成视频'
      case 'encoding': return '提取帧'
      case 'muxing': return '添加帧'
      case 'finalizing': return '渲染 GIF'
      default: return exportProgress.stage
    }
  })

  // 计算预估信息
  const estimatedFrames = $derived(Math.ceil(videoDuration * fps))
  const estimatedWidth = $derived(Math.round(videoWidth * (scale / 100)))
  const estimatedHeight = $derived(Math.round(videoHeight * (scale / 100)))
  const estimatedSize = $derived(() => {
    // 粗略估算：每帧约 width * height * 0.5 字节
    const bytesPerFrame = estimatedWidth * estimatedHeight * 0.5
    const totalBytes = bytesPerFrame * estimatedFrames
    if (totalBytes < 1024 * 1024) {
      return `${Math.round(totalBytes / 1024)} KB`
    } else {
      return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
    }
  })

  const repeatText = $derived(repeat === -1 ? '不重复' : repeat === 0 ? '永远循环' : `${repeat} 次`)
</script>

{#if open}
  <!-- 遮罩层 -->
  <div 
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    onclick={handleCancel}
    role="presentation"
  >
    <!-- 对话框 -->
    <div
      class="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') handleCancel() }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- 头部 -->
      <div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
        <h2 class="text-xl font-semibold text-gray-900">🎬 GIF 导出设置</h2>
        <button
          onclick={handleCancel}
          class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="关闭"
        >
          <X class="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <!-- 内容 -->
      <div class="px-6 py-4 space-y-6">
        <!-- 预设模板 -->
        <div class="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4">
          <label class="block text-sm font-semibold text-gray-700 mb-3">🎯 预设模板</label>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
            <button
              onclick={() => applyPreset('high-quality')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium"
            >
              💎 高质量
            </button>
            <button
              onclick={() => applyPreset('balanced')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium"
            >
              ⚖️ 平衡
            </button>
            <button
              onclick={() => applyPreset('small-size')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium"
            >
              💾 小文件
            </button>
            <button
              onclick={() => applyPreset('smooth')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium"
            >
              🌊 流畅
            </button>
            <button
              onclick={() => applyPreset('retro')}
              class="px-3 py-2 bg-white border-2 border-purple-300 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all text-sm font-medium"
            >
              🕹️ 复古
            </button>
          </div>
        </div>

        <!-- 基础设置 -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-700">⚙️ 基础设置</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- 帧率 -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                帧率 (FPS): <span class="font-semibold text-purple-600">{fps}</span>
              </label>
              <input
                type="range"
                bind:value={fps}
                min="5"
                max="30"
                step="1"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">越高越流畅，但文件越大</p>
            </div>

            <!-- 质量 -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                采样质量: <span class="font-semibold text-purple-600">{quality}</span>
              </label>
              <input
                type="range"
                bind:value={quality}
                min="1"
                max="30"
                step="1"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">1=最佳(慢) | 10=均衡 | 30=最快(质量低)</p>
            </div>

            <!-- 缩放 -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                缩放比例: <span class="font-semibold text-purple-600">{scale}%</span>
              </label>
              <input
                type="range"
                bind:value={scale}
                min="25"
                max="100"
                step="5"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">输出尺寸: {estimatedWidth}x{estimatedHeight}</p>
            </div>

            <!-- 工作线程 -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                工作线程: <span class="font-semibold text-purple-600">{workers}</span>
              </label>
              <input
                type="range"
                bind:value={workers}
                min="1"
                max="8"
                step="1"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">更多线程 = 更快编码</p>
            </div>
          </div>
        </div>

        <!-- 高级设置 -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-700">🎨 高级设置</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- 重复次数 -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">
                重复次数: <span class="font-semibold text-purple-600">{repeatText}</span>
              </label>
              <input
                type="range"
                bind:value={repeat}
                min="-1"
                max="10"
                step="1"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
              <p class="text-xs text-gray-500 mt-1">-1=不重复 | 0=永远循环</p>
            </div>

            <!-- 抖动算法 -->
            <div>
              <label class="block text-sm text-gray-600 mb-2">抖动算法</label>
              <select
                bind:value={dither}
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="false">无抖动</option>
                <option value="FloydSteinberg">Floyd-Steinberg</option>
                <option value="FalseFloydSteinberg">False Floyd-Steinberg</option>
                <option value="Stucki">Stucki</option>
                <option value="Atkinson">Atkinson</option>
                <option value="FloydSteinberg-serpentine">Floyd-Steinberg (蛇形)</option>
              </select>
              <p class="text-xs text-gray-500 mt-1">抖动可改善颜色过渡</p>
            </div>
          </div>
        </div>

        <!-- 预估信息 -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 class="text-sm font-semibold text-blue-900 mb-2">📊 预估信息</h4>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span class="text-blue-600">帧数:</span>
              <span class="font-semibold ml-1">{estimatedFrames}</span>
            </div>
            <div>
              <span class="text-blue-600">尺寸:</span>
              <span class="font-semibold ml-1">{estimatedWidth}x{estimatedHeight}</span>
            </div>
            <div>
              <span class="text-blue-600">预估大小:</span>
              <span class="font-semibold ml-1">{estimatedSize()}</span>
            </div>
            <div>
              <span class="text-blue-600">时长:</span>
              <span class="font-semibold ml-1">{videoDuration.toFixed(1)}s</span>
            </div>
          </div>
        </div>

        <!-- 导出进度 -->
        {#if isExporting && exportProgress}
          <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-sm font-semibold text-purple-900 flex items-center gap-2">
                <LoaderCircle class="w-4 h-4 animate-spin" />
                正在导出 GIF...
              </h4>
              <span class="text-sm font-semibold text-purple-600">
                {Math.round(exportProgress.progress)}%
              </span>
            </div>

            <!-- 进度条 -->
            <div class="w-full h-2 bg-purple-100 rounded-full overflow-hidden mb-3">
              <div
                class="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-300"
                style="width: {exportProgress.progress}%"
              ></div>
            </div>

            <!-- 详细信息 -->
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span class="text-purple-600">阶段:</span>
                <span class="font-semibold ml-1">{stageText()}</span>
              </div>
              <div>
                <span class="text-purple-600">帧数:</span>
                <span class="font-semibold ml-1">{exportProgress.currentFrame} / {exportProgress.totalFrames}</span>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- 底部按钮 -->
      <div class="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3 rounded-b-xl">
        <button
          onclick={handleCancel}
          disabled={isExporting}
          class="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExporting ? '导出中...' : '取消'}
        </button>
        <button
          onclick={handleConfirm}
          disabled={isExporting}
          class="px-6 py-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-lg hover:from-purple-600 hover:to-blue-600 transition-all font-medium shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if isExporting}
            <span class="flex items-center gap-2">
              <LoaderCircle class="w-4 h-4 animate-spin" />
              导出中...
            </span>
          {:else}
            开始导出
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

