<!-- 视频比例配置控件 -->
<script lang="ts">
  import { Monitor, Square, Smartphone, BookOpen, Settings } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'

  // 当前比例配置
  const currentRatio = $derived(backgroundConfigStore.config.outputRatio)
  const customWidth = $derived(backgroundConfigStore.config.customWidth || 1920)
  const customHeight = $derived(backgroundConfigStore.config.customHeight || 1080)

  // 热门平台标准比例
  const PLATFORM_RATIOS = [
    {
      name: 'YouTube 横屏',
      ratio: '16:9' as const,
      description: 'YouTube、B站、爱奇艺等',
      icon: Monitor,
      dimensions: '1920×1080'
    },
    {
      name: 'Instagram 方形',
      ratio: '1:1' as const,
      description: 'Instagram 帖子、微信朋友圈',
      icon: Square,
      dimensions: '1080×1080'
    },
    {
      name: 'TikTok 竖屏',
      ratio: '9:16' as const,
      description: 'TikTok、抖音、快手',
      icon: Smartphone,
      dimensions: '1080×1920'
    },
    {
      name: 'Instagram Story',
      ratio: '4:5' as const,
      description: 'Instagram 故事、小红书',
      icon: BookOpen,
      dimensions: '1080×1350'
    }
  ] as const

  // 自定义尺寸输入
  let customWidthInput = $state(1920)
  let customHeightInput = $state(1080)
  let showCustomInput = $state(false)

  // 输入验证状态
  let isValidWidth = $derived(customWidthInput >= 480 && customWidthInput <= 4096)
  let isValidHeight = $derived(customHeightInput >= 480 && customHeightInput <= 4096)

  // 当前比例信息
  let currentRatioInfo = $derived(getCurrentRatioInfo())

  // 处理比例选择
  function handleRatioSelect(ratio: typeof PLATFORM_RATIOS[number]) {
    console.log('📐 [AspectRatioControl] Ratio selected:', ratio)
    backgroundConfigStore.updateOutputRatio(ratio.ratio)
    showCustomInput = false
  }

  // 处理自定义比例
  function handleCustomRatio() {
    console.log('📐 [AspectRatioControl] Custom ratio selected')
    showCustomInput = true
    backgroundConfigStore.updateOutputRatio('custom', customWidthInput, customHeightInput)
  }

  // 处理自定义尺寸变化
  function handleCustomSizeChange() {
    if (currentRatio === 'custom') {
      backgroundConfigStore.updateOutputRatio('custom', customWidthInput, customHeightInput)
    }
  }

  // 检查是否为当前选中的比例
  function isRatioSelected(ratio: BackgroundConfig['outputRatio']) {
    return currentRatio === ratio
  }

  // 获取当前比例的显示信息
  function getCurrentRatioInfo() {
    if (currentRatio === 'custom') {
      return {
        name: '自定义尺寸',
        dimensions: `${customWidth}×${customHeight}`,
        aspectRatio: (customWidth / customHeight).toFixed(2)
      }
    }

    const platform = PLATFORM_RATIOS.find(p => p.ratio === currentRatio)
    if (platform) {
      return {
        name: platform.name,
        dimensions: platform.dimensions,
        aspectRatio: currentRatio
      }
    }

    return {
      name: '未知比例',
      dimensions: '未知',
      aspectRatio: '未知'
    }
  }

  // 响应自定义尺寸的变化
  $effect(() => {
    if (currentRatio === 'custom') {
      customWidthInput = customWidth
      customHeightInput = customHeight
    }
  })
</script>

<!-- 视频比例配置控件 -->
<div class="p-4 border border-gray-200 rounded-lg bg-white">
  <h3 class="mb-4 text-sm font-semibold text-gray-700">输出比例</h3>

  <!-- 平台比例选择 -->
  <div class="grid grid-cols-2 gap-2 mb-4">
    {#each PLATFORM_RATIOS as platform}
      {@const IconComponent = platform.icon}
      <button
        class="flex items-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50"
        class:border-purple-500={isRatioSelected(platform.ratio)}
        class:bg-purple-500={isRatioSelected(platform.ratio)}
        class:text-white={isRatioSelected(platform.ratio)}
        class:border-gray-200={!isRatioSelected(platform.ratio)}
        class:bg-white={!isRatioSelected(platform.ratio)}
        class:text-gray-700={!isRatioSelected(platform.ratio)}
        class:hover:border-purple-400={!isRatioSelected(platform.ratio)}
        class:hover:bg-purple-50={!isRatioSelected(platform.ratio)}
        onclick={() => handleRatioSelect(platform)}
        title="{platform.description}"
      >
        <div class="flex-shrink-0">
          <IconComponent class="w-5 h-5" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold mb-0.5">{platform.name}</div>
          <div class="text-xs opacity-80 mb-0.5">{platform.ratio}</div>
          <div class="text-xs opacity-70">{platform.dimensions}</div>
        </div>
      </button>
    {/each}

    <!-- 自定义比例 -->
    <button
      class="flex items-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50"
      class:border-purple-500={isRatioSelected('custom')}
      class:bg-purple-500={isRatioSelected('custom')}
      class:text-white={isRatioSelected('custom')}
      class:border-gray-200={!isRatioSelected('custom')}
      class:bg-white={!isRatioSelected('custom')}
      class:text-gray-700={!isRatioSelected('custom')}
      class:hover:border-purple-400={!isRatioSelected('custom')}
      class:hover:bg-purple-50={!isRatioSelected('custom')}
      onclick={handleCustomRatio}
      title="自定义尺寸"
    >
      <div class="flex-shrink-0">
        <Settings class="w-5 h-5" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-semibold mb-0.5">自定义</div>
        <div class="text-xs opacity-80 mb-0.5">Custom</div>
        <div class="text-xs opacity-70">自定义尺寸</div>
      </div>
    </button>
  </div>

  <!-- 自定义尺寸输入 -->
  {#if showCustomInput || currentRatio === 'custom'}
    <div class="mb-4 p-3 bg-gray-50 rounded-md">
      <h4 class="mb-3 text-xs font-semibold text-gray-600">自定义尺寸</h4>
      <div class="flex items-center gap-2">
        <div class="flex flex-col gap-1 flex-1">
          <label for="custom-width" class="text-xs text-gray-600 font-medium">宽度</label>
          <input
            id="custom-width"
            type="number"
            min="480"
            max="4096"
            step="1"
            bind:value={customWidthInput}
            oninput={handleCustomSizeChange}
            class="px-2 py-1.5 border rounded text-xs text-center focus:outline-none focus:ring-2 focus:ring-opacity-20 transition-colors duration-200"
            class:border-gray-300={isValidWidth}
            class:border-red-300={!isValidWidth}
            class:focus:border-purple-500={isValidWidth}
            class:focus:ring-purple-500={isValidWidth}
            class:focus:border-red-500={!isValidWidth}
            class:focus:ring-red-500={!isValidWidth}
          />
          <span class="text-xs text-gray-600 text-center">px</span>
        </div>
        <div class="text-sm text-gray-600 mt-4">×</div>
        <div class="flex flex-col gap-1 flex-1">
          <label for="custom-height" class="text-xs text-gray-600 font-medium">高度</label>
          <input
            id="custom-height"
            type="number"
            min="480"
            max="4096"
            step="1"
            bind:value={customHeightInput}
            oninput={handleCustomSizeChange}
            class="px-2 py-1.5 border rounded text-xs text-center focus:outline-none focus:ring-2 focus:ring-opacity-20 transition-colors duration-200"
            class:border-gray-300={isValidHeight}
            class:border-red-300={!isValidHeight}
            class:focus:border-purple-500={isValidHeight}
            class:focus:ring-purple-500={isValidHeight}
            class:focus:border-red-500={!isValidHeight}
            class:focus:ring-red-500={!isValidHeight}
          />
          <span class="text-xs text-gray-600 text-center">px</span>
        </div>
      </div>
    </div>
  {/if}

  <!-- 当前选择显示 -->
  <div class="p-2 bg-gray-50 rounded-md text-xs">
    <div class="flex items-center gap-1.5 flex-wrap">
      <span class="text-gray-600 font-medium">当前比例:</span>
      <span class="text-purple-600 font-semibold">{currentRatioInfo.name}</span>
      <span class="text-gray-700 font-medium">{currentRatioInfo.dimensions}</span>
      <span class="text-gray-500 text-xs">({currentRatioInfo.aspectRatio})</span>
    </div>
  </div>
</div>


