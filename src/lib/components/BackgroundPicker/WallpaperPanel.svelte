<!-- Wallpaper Panel - Wallpaper selection with category tabs -->
<script lang="ts">
  import { Sparkles, Circle, Leaf, Briefcase, Cpu } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { WALLPAPER_CATEGORIES } from '$lib/data/wallpaper-presets'
  import type { ImagePreset } from '$lib/types/background'

  // Current config from store
  const currentConfig = $derived(backgroundConfigStore.config)
  const currentType = $derived(currentConfig.type)

  // Category icon mapping
  const categoryIcons: Record<string, typeof Sparkles> = {
    abstract: Sparkles,
    minimal: Circle,
    nature: Leaf,
    business: Briefcase,
    tech: Cpu
  }

  // Category tabs from wallpaper presets with lucide icons
  const categories = Object.entries(WALLPAPER_CATEGORIES).map(([key, cat]) => ({
    key,
    name: cat.name.split(' ')[0], // Use short name
    icon: categoryIcons[key] || Sparkles,
    wallpapers: cat.wallpapers
  }))

  let activeCategory = $state<string>('abstract')
  let selectedWallpaperId = $state<string>('')
  let loadError = $state<string>('')

  // Get wallpapers for active category
  const activeCategoryWallpapers = $derived(
    categories.find(c => c.key === activeCategory)?.wallpapers || []
  )

  // Sync selected wallpaper with current config
  $effect(() => {
    if (currentType === 'wallpaper' && currentConfig.wallpaper) {
      selectedWallpaperId = currentConfig.wallpaper.imageId
    } else if (backgroundConfigStore.lastWallpaperConfig) {
      selectedWallpaperId = backgroundConfigStore.lastWallpaperConfig.imageId
    }
  })

  // Handle wallpaper selection
  async function selectWallpaper(wallpaper: ImagePreset) {
    try {
      selectedWallpaperId = wallpaper.id
      loadError = ''
      await backgroundConfigStore.handleWallpaperSelection(wallpaper)
      console.log('🌄 [WallpaperPanel] Selected:', wallpaper.name)
    } catch (error) {
      console.error('❌ [WallpaperPanel] Failed to load:', error)
      loadError = 'Failed to load wallpaper'
      setTimeout(() => loadError = '', 3000)
    }
  }

  // Check if wallpaper is selected
  function isSelected(wallpaper: ImagePreset) {
    return selectedWallpaperId === wallpaper.id
  }
</script>

<div class="space-y-3">
  <!-- Category tabs -->
  <div class="flex bg-gray-100 rounded p-0.5 gap-0.5 overflow-x-auto">
    {#each categories as cat}
      <button
        class="flex-1 min-w-fit flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded transition-all whitespace-nowrap
          {activeCategory === cat.key
            ? 'bg-white text-gray-800 shadow-sm'
            : 'text-gray-600 hover:bg-gray-200'}"
        onclick={() => activeCategory = cat.key}
        type="button"
      >
        <cat.icon class="w-3 h-3" />
        <span>{cat.name}</span>
      </button>
    {/each}
  </div>

  <!-- Wallpaper grid - 6 columns, larger rectangles -->
  <div class="grid grid-cols-6 gap-2">
    {#each activeCategoryWallpapers as wallpaper}
      <button
        class="w-full h-9 rounded-md border-2 cursor-pointer transition-all relative group overflow-hidden
          {isSelected(wallpaper)
            ? 'border-blue-500 ring-2 ring-blue-200 scale-105'
            : 'border-gray-300 hover:border-gray-400 hover:scale-105'}"
        onclick={() => selectWallpaper(wallpaper)}
        type="button"
      >
        <img
          src={wallpaper.imageUrl}
          alt={wallpaper.name}
          loading="lazy"
          class="w-full h-full object-cover"
        />
        <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20">
          {wallpaper.name}
        </div>
      </button>
    {/each}
  </div>

  <!-- Error message -->
  {#if loadError}
    <div class="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
      {loadError}
    </div>
  {/if}

  <!-- Stats -->
  <div class="flex items-center justify-between text-xs text-gray-500 pt-1 border-t border-gray-200">
    <span>{activeCategoryWallpapers.length} wallpapers in this category</span>
    <span>{Object.values(WALLPAPER_CATEGORIES).reduce((t, c) => t + c.wallpapers.length, 0)} total</span>
  </div>
</div>

