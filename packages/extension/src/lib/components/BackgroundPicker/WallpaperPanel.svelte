<!-- Wallpaper Panel - Wallpaper selection with category tabs -->
<script lang="ts">
  import { Sparkles, Circle, Leaf, Briefcase, Cpu } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { WALLPAPER_CATEGORIES } from '$lib/data/wallpaper-presets'
  import type { ImagePreset } from '$lib/types/background'
  import { _t as t } from '$lib/utils/i18n'

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
    name: cat.name, // Use the key from data
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
  <div class="studio-segmented studio-scrollbar flex gap-0.5 overflow-x-auto p-1">
    {#each categories as cat}
      {@const categoryLabel = t(cat.name)}
      <button
        class="flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition-all
          {activeCategory === cat.key
            ? 'bg-zinc-700 text-zinc-100 shadow-sm ring-1 ring-white/10'
            : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}"
        onclick={() => activeCategory = cat.key}
        type="button"
        aria-label={categoryLabel}
        title={categoryLabel}
      >
        <cat.icon class="w-3 h-3" />
        <span class={activeCategory === cat.key ? '' : 'sr-only'}>{categoryLabel}</span>
      </button>
    {/each}
  </div>

  <!-- Wallpaper grid - 6 columns, larger rectangles -->
  <div class="grid grid-cols-6 gap-2">
    {#each activeCategoryWallpapers as wallpaper}
      <button
        class="w-full h-9 rounded-md border-2 cursor-pointer transition-all relative group overflow-hidden
          {isSelected(wallpaper)
            ? 'border-blue-400 ring-2 ring-blue-500/30 scale-105'
            : 'border-zinc-500 hover:border-white/30 hover:scale-105'}"
        onclick={() => selectWallpaper(wallpaper)}
        type="button"
      >
        <img
          src={wallpaper.imageUrl}
          alt={t(wallpaper.name)}
          loading="lazy"
          class="w-full h-full object-cover"
        />
        <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20">
          {t(wallpaper.name)}
        </div>
      </button>
    {/each}
  </div>

  <!-- Error message -->
  {#if loadError}
    <div class="rounded border border-red-400/20 bg-red-500/10 px-2 py-1 text-xs text-red-300">
      {t('wallpaper_error')}
    </div>
  {/if}

  <!-- Stats -->
  <div class="flex items-center justify-between border-t border-zinc-700 pt-1 text-xs text-zinc-400">
    <span>{t('wallpaper_stats', String(activeCategoryWallpapers.length))}</span>
    <span>{t('wallpaper_total', String(Object.values(WALLPAPER_CATEGORIES).reduce((t, c) => t + c.wallpapers.length, 0)))}</span>
  </div>
</div>
