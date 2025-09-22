<!-- Video aspect ratio configuration control -->
<script lang="ts">
  import { Monitor, Square, Smartphone, BookOpen } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'

  // Current ratio configuration
  const currentRatio = $derived(backgroundConfigStore.config.outputRatio)

  // Popular platform standard ratios
  const PLATFORM_RATIOS = [
    {
      name: 'YouTube Landscape',
      ratio: '16:9' as const,
      description: 'YouTube, Bilibili, iQiyi, etc.',
      icon: Monitor,
      dimensions: '1920×1080'
    },
    {
      name: 'Instagram Square',
      ratio: '1:1' as const,
      description: 'Instagram posts, WeChat Moments',
      icon: Square,
      dimensions: '1080×1080'
    },
    {
      name: 'TikTok Portrait',
      ratio: '9:16' as const,
      description: 'TikTok, Douyin, Kuaishou',
      icon: Smartphone,
      dimensions: '1080×1920'
    },
    {
      name: 'Instagram Story',
      ratio: '4:5' as const,
      description: 'Instagram Stories, Xiaohongshu',
      icon: BookOpen,
      dimensions: '1080×1350'
    }
  ] as const



  // Handle ratio selection
  function handleRatioSelect(ratio: typeof PLATFORM_RATIOS[number]) {
    console.log('📐 [AspectRatioControl] Ratio selected:', ratio)
    backgroundConfigStore.updateOutputRatio(ratio.ratio)
  }

  // Check if it's the currently selected ratio
  function isRatioSelected(ratio: BackgroundConfig['outputRatio']) {
    return currentRatio === ratio
  }
</script>

<!-- Video aspect ratio configuration control - Four small cards centered layout -->
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
        <!-- Left icon -->
        <div class="flex-shrink-0">
          <IconComponent class="w-5 h-5" />
        </div>
        <!-- Right text information -->
        <div class="flex-1 text-left">
          <div class="text-xs font-semibold leading-tight">{platform.name}</div>
          <div class="text-xs opacity-80 font-medium leading-tight">{platform.ratio}</div>
        </div>
      </button>
    {/each}
  </div>
</div>


