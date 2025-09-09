<!-- 边距配置控件 -->
<script lang="ts">
  import { Move, Minimize2, Maximize2, Eye, SlidersHorizontal } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'

  // 当前边距值
  const currentPadding = $derived(backgroundConfigStore.config.padding || 60)

  // 预设边距值
  const PRESET_PADDING = [
    { name: '无边距', value: 0, icon: Minimize2 },
    { name: '小边距', value: 30, icon: Move },
    { name: '中边距', value: 60, icon: Move },
    { name: '大边距', value: 120, icon: Move },
    { name: '超大边距', value: 200, icon: Maximize2 }
  ] as const

  // 处理滑块变化
  function handleSliderChange(event: Event) {
    const target = event.target as HTMLInputElement
    const value = parseInt(target.value)
    backgroundConfigStore.updatePadding(value)
  }

  // 处理预设值选择
  function handlePresetSelect(preset: typeof PRESET_PADDING[number]) {
    console.log('🎨 [PaddingControl] Preset selected:', preset)
    backgroundConfigStore.updatePadding(preset.value)
  }

  // 检查是否为当前选中的预设
  function isPresetSelected(value: number) {
    return currentPadding === value
  }

  // 计算预览边距 - 使用更小的比例并设置最大值
  const previewPadding = $derived(Math.min(Math.round(currentPadding * 0.2), 40))

  // 根据边距大小决定文字显示内容
  const displayText = $derived(currentPadding > 150 ? '视频' : '视频区域')
  const showPaddingValue = $derived(currentPadding <= 120)
</script>

<!-- 边距配置控件 -->
<div class="p-4 border border-gray-200 rounded-lg bg-white">
  <div class="flex items-center gap-2 mb-4">
    <SlidersHorizontal class="w-4 h-4 text-gray-600" />
    <h3 class="text-sm font-semibold text-gray-700">视频边距</h3>
  </div>

  <!-- 滑块控制 -->
  <div class="flex items-center gap-3 mb-4">
    <input
      type="range"
      class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
      min="0"
      max="200"
      step="5"
      value={currentPadding}
      oninput={handleSliderChange}
    />
    <div class="min-w-[60px] text-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
      {currentPadding}px
    </div>
  </div>

  <!-- 预设值快速选择 -->
  <div class="flex gap-2 mb-4 flex-wrap">
    {#each PRESET_PADDING as preset}
      {@const IconComponent = preset.icon}
      <button
        class="flex items-center gap-1.5 px-3 py-2 text-xs border rounded-md cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50"
        class:border-emerald-500={isPresetSelected(preset.value)}
        class:bg-emerald-500={isPresetSelected(preset.value)}
        class:text-white={isPresetSelected(preset.value)}
        class:border-gray-300={!isPresetSelected(preset.value)}
        class:bg-white={!isPresetSelected(preset.value)}
        class:text-gray-700={!isPresetSelected(preset.value)}
        class:hover:border-emerald-400={!isPresetSelected(preset.value)}
        class:hover:bg-emerald-50={!isPresetSelected(preset.value)}
        onclick={() => handlePresetSelect(preset)}
        title="{preset.name} ({preset.value}px)"
      >
        <IconComponent class="w-3 h-3" />
        <span>{preset.name}</span>
      </button>
    {/each}
  </div>

  <!-- 视觉预览 -->
  <div class="mt-4">
    <div class="flex items-center gap-2 mb-2">
      <Eye class="w-3 h-3 text-gray-600" />
      <div class="text-xs text-gray-600 font-medium">预览效果:</div>
    </div>
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-center p-6 bg-gray-50 rounded-md">
        <div
          class="w-48 h-32 bg-gray-200 border-2 border-gray-300 rounded flex items-center justify-center transition-all duration-300"
          style="padding: {previewPadding}px"
        >
          <div class="bg-emerald-500 text-white font-medium rounded flex items-center justify-center w-full h-full min-w-[60px] min-h-[40px]"
               class:text-xs={currentPadding > 150}
               class:text-sm={currentPadding <= 150}
               class:p-1={currentPadding > 150}
               class:p-2={currentPadding > 100 && currentPadding <= 150}
               class:p-3={currentPadding <= 100}>
            <span class="text-center leading-tight overflow-hidden">
              {displayText}
              {#if showPaddingValue}
                <br>
                <span class="text-xs opacity-90">{currentPadding}px</span>
              {/if}
            </span>
          </div>
        </div>
      </div>
      <div class="text-xs text-gray-600 text-center font-medium">
        边距: {currentPadding}px
      </div>
    </div>
  </div>
</div>

<style>
  /* 自定义滑块样式 - 使用绿色主题 */
  .slider-thumb::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    background: #10b981;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .slider-thumb::-webkit-slider-thumb:hover {
    background: #059669;
    transform: scale(1.1);
  }

  .slider-thumb::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #10b981;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .slider-thumb::-moz-range-thumb:hover {
    background: #059669;
    transform: scale(1.1);
  }
</style>
