<!-- 视频比例配置控件 -->
<script lang="ts">
  import { Monitor, Square, Smartphone, BookOpen } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'

  // 当前比例配置
  const currentRatio = $derived(backgroundConfigStore.config.outputRatio)

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



  // 处理比例选择
  function handleRatioSelect(ratio: typeof PLATFORM_RATIOS[number]) {
    console.log('📐 [AspectRatioControl] Ratio selected:', ratio)
    backgroundConfigStore.updateOutputRatio(ratio.ratio)
  }

  // 检查是否为当前选中的比例
  function isRatioSelected(ratio: BackgroundConfig['outputRatio']) {
    return currentRatio === ratio
  }
</script>

<!-- 视频比例配置控件 - 四个小卡片居中布局 -->
<div class="flex justify-center">
  <div class="flex gap-3">
    {#each PLATFORM_RATIOS as platform}
      {@const IconComponent = platform.icon}
      <button
        class="flex items-center gap-3 px-3 py-2 border-2 rounded-lg cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 min-w-[140px]"
        class:border-purple-500={isRatioSelected(platform.ratio)}
        class:bg-purple-500={isRatioSelected(platform.ratio)}
        class:text-white={isRatioSelected(platform.ratio)}
        class:shadow-lg={isRatioSelected(platform.ratio)}
        class:border-gray-200={!isRatioSelected(platform.ratio)}
        class:bg-white={!isRatioSelected(platform.ratio)}
        class:text-gray-700={!isRatioSelected(platform.ratio)}
        class:hover:border-purple-400={!isRatioSelected(platform.ratio)}
        class:hover:bg-purple-50={!isRatioSelected(platform.ratio)}
        class:hover:shadow-md={!isRatioSelected(platform.ratio)}
        onclick={() => handleRatioSelect(platform)}
        title="{platform.description}"
      >
        <!-- 左侧图标 -->
        <div class="flex-shrink-0">
          <IconComponent class="w-5 h-5" />
        </div>
        <!-- 右侧文字信息 -->
        <div class="flex-1 text-left">
          <div class="text-xs font-semibold leading-tight">{platform.name}</div>
          <div class="text-xs opacity-80 font-medium leading-tight">{platform.ratio}</div>
        </div>
      </button>
    {/each}
  </div>
</div>


