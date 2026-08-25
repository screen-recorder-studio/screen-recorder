<!-- Gradient Panel - Gradient selection with category tabs -->
<script lang="ts">
  import { ArrowRight, Target, RefreshCw, Rainbow } from '@lucide/svelte'
  import { backgroundConfigStore, PRESET_GRADIENTS } from '$lib/stores/background-config.svelte'
  import type { GradientPreset } from '$lib/types/background'
  import { _t as t } from '$lib/utils/i18n'

  // Current config from store
  const currentConfig = $derived(backgroundConfigStore.config)
  const currentType = $derived(currentConfig.type)

  // Category tabs with lucide icons
  const categories = [
    { key: 'linear', name: 'Linear', icon: ArrowRight },
    { key: 'radial', name: 'Radial', icon: Target },
    { key: 'conic', name: 'Conic', icon: RefreshCw },
    { key: 'multicolor', name: 'Multi', icon: Rainbow }
  ] as const

  let activeCategory = $state<string>('linear')

  // Get gradients for active category
  const activeCategoryGradients = $derived(
    PRESET_GRADIENTS.filter(g => g.category === activeCategory)
  )

  // Handle gradient selection
  function selectGradient(preset: GradientPreset) {
    backgroundConfigStore.applyPresetGradient(preset)
  }

  // Check if gradient is selected
  function isSelected(preset: GradientPreset) {
    if (currentType !== 'gradient' || !currentConfig.gradient) return false
    
    const current = currentConfig.gradient
    const target = preset.config
    
    return (
      current.type === target.type &&
      JSON.stringify(current.stops) === JSON.stringify(target.stops)
    )
  }

  // Get current gradient CSS
  function getCurrentGradientCSS(): string {
    if (currentType === 'gradient' && currentConfig.gradient) {
      return backgroundConfigStore.generateGradientCSS(currentConfig.gradient)
    }
    return 'linear-gradient(45deg, #f3f4f6, #e5e7eb)'
  }

</script>

<div class="space-y-3">
  <!-- Category tabs -->
  <div class="studio-segmented flex gap-0.5 p-1">
    {#each categories as cat}
      {@const categoryLabel = t(
        cat.key === 'linear' ? 'gradient_tab_linear' :
        cat.key === 'radial' ? 'gradient_tab_radial' :
        cat.key === 'conic' ? 'gradient_tab_conic' :
        'gradient_tab_multi'
      )}
      <button
        class="flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-all
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

  <!-- Gradient grid - 6 columns, larger rectangles -->
  <div class="grid grid-cols-6 gap-2">
    {#each activeCategoryGradients as preset}
      <button
        class="w-full h-9 rounded-md border-2 cursor-pointer transition-all relative group
          {isSelected(preset)
            ? 'border-blue-400 ring-2 ring-blue-500/30 scale-105'
            : 'border-zinc-500 hover:border-white/30 hover:scale-105'}"
        style="background: {preset.preview || 'linear-gradient(45deg, #f3f4f6, #e5e7eb)'}"
        title="{preset.name}"
        onclick={() => selectGradient(preset)}
        type="button"
      >
        <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20">
          {preset.name}
        </div>
      </button>
    {/each}
  </div>

  <!-- Current gradient preview -->
  <div class="flex items-center gap-2 border-t border-zinc-700 pt-2">
    <span class="text-xs text-zinc-400">{t('gradient_current')}</span>
    <div
      class="h-7 flex-1 rounded border border-zinc-500"
      style="background: {getCurrentGradientCSS()}"
    ></div>
    {#if currentType === 'gradient' && currentConfig.gradient}
      <span class="text-xs text-zinc-400">
        {currentConfig.gradient.type} · {currentConfig.gradient.stops.length} {t('gradient_colors_suffix')}
      </span>
    {:else}
      <span class="text-xs text-zinc-400">{t('gradient_select_hint')}</span>
    {/if}
  </div>
</div>
