<!-- Video aspect ratio configuration control -->
<script lang="ts">
  import { Monitor, Square, Smartphone, BookOpen } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'

  import { onMount } from 'svelte'

  // Current ratio configuration
  const currentRatio = $derived(backgroundConfigStore.config.outputRatio)

  // DOM references and slider state
  let buttonRefs: (HTMLButtonElement | null)[] = $state([])
  let sliderStyle = $state({ left: 0, width: 0, opacity: 0 })

  // Update slider position when ratio changes
  $effect(() => {
    // Dependency tracking
    const ratio = currentRatio
    
    // Find active index
    const index = PLATFORM_RATIOS.findIndex(p => p.ratio === ratio)
    if (index !== -1 && buttonRefs[index]) {
      const el = buttonRefs[index]
      sliderStyle = {
        left: el.offsetLeft,
        width: el.offsetWidth,
        opacity: 1
      }
    }
  })

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

<!-- Video aspect ratio configuration control - Segmented Control Style -->
<div class="flex justify-center">
  <div class="relative inline-flex bg-gray-100/80 p-1.5 rounded-xl shadow-inner gap-1 border border-gray-200/50">
    <!-- Animated Selection Slider -->
    <div
      class="absolute top-1.5 bottom-1.5 bg-white rounded-lg shadow-sm ring-1 ring-black/5 transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
      style="left: {sliderStyle.left}px; width: {sliderStyle.width}px; opacity: {sliderStyle.opacity};"
    ></div>

    {#each PLATFORM_RATIOS as platform, i}
      {@const IconComponent = platform.icon}
      {@const isSelected = isRatioSelected(platform.ratio)}
      <button
        bind:this={buttonRefs[i]}
        class="
          relative z-10 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200
          focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30
          {isSelected 
            ? 'text-gray-900' 
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
          }
        "
        onclick={() => handleRatioSelect(platform)}
        title="{platform.name} - {platform.description}"
      >
        <IconComponent class="w-4 h-4 {isSelected ? 'text-purple-600' : 'opacity-70'}" />
        <span class="{isSelected ? 'font-semibold' : ''}">{platform.ratio}</span>
      </button>
    {/each}
  </div>
</div>


