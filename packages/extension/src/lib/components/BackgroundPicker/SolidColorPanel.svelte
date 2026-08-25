<!-- Solid Color Panel - Color selection with category tabs -->
<script lang="ts">
  import { Circle, Sun, Briefcase, Palette } from '@lucide/svelte'
  import { backgroundConfigStore, PRESET_SOLID_COLORS } from '$lib/stores/background-config.svelte'
  import type { SolidColorPreset } from '$lib/types/background'
  import { _t as t } from '$lib/utils/i18n'

  // Current config from store
  const currentConfig = $derived(backgroundConfigStore.config)
  const currentType = $derived(currentConfig.type)
  const currentColor = $derived(currentConfig.color)

  // Category tabs with lucide icons
  const categories = [
    { key: 'basic', name: 'Basic', icon: Circle },
    { key: 'light', name: 'Light', icon: Sun },
    { key: 'business', name: 'Business', icon: Briefcase },
    { key: 'creative', name: 'Creative', icon: Palette }
  ] as const

  let activeCategory = $state<string>('basic')
  let customColorValue = $state('')

  // Get colors for active category
  const activeCategoryColors = $derived(
    PRESET_SOLID_COLORS.filter(c => c.category === activeCategory)
  )

  // Sync custom color input
  $effect(() => {
    if (currentType === 'solid-color') {
      customColorValue = currentColor
    }
  })

  // Handle preset color selection
  function selectPresetColor(preset: SolidColorPreset) {
    backgroundConfigStore.applyPresetSolidColor(preset)
  }

  // Check if color is selected
  function isSelected(preset: SolidColorPreset) {
    return currentType === 'solid-color' && currentColor === preset.color
  }

  // Validate color format
  function isValidColor(color: string): boolean {
    const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
    const rgbPattern = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/
    const rgbaPattern = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/
    return hexPattern.test(color) || rgbPattern.test(color) || rgbaPattern.test(color)
  }

  // Handle color picker change
  function handleColorPickerChange(event: Event) {
    const color = (event.target as HTMLInputElement).value
    customColorValue = color
    backgroundConfigStore.updateColor(color)
  }

  // Handle text input change
  function handleTextInputChange(event: Event) {
    const color = (event.target as HTMLInputElement).value.trim()
    if (isValidColor(color)) {
      backgroundConfigStore.updateColor(color)
    }
  }

  // Handle text input keydown
  function handleTextKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleTextInputChange(event)
      ;(event.target as HTMLInputElement).blur()
    }
  }

  // Copy color to clipboard
  async function copyColor(color: string) {
    try {
      await navigator.clipboard.writeText(color)
    } catch (e) {
      console.warn('Failed to copy color:', e)
    }
  }

</script>

<div class="space-y-3">
  <!-- Category tabs -->
  <div class="studio-segmented flex gap-0.5 p-1">
    {#each categories as cat}
      {@const categoryLabel = t(
        cat.key === 'basic' ? 'color_tab_basic' :
        cat.key === 'light' ? 'color_tab_light' :
        cat.key === 'business' ? 'color_tab_business' :
        'color_tab_creative'
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

  <!-- Color grid - 8 columns -->
  <div class="grid grid-cols-8 gap-1.5">
    {#each activeCategoryColors as preset}
      <button
        class="group relative aspect-square w-full cursor-pointer rounded-md border-2 transition-all
          {isSelected(preset)
            ? 'border-blue-400 ring-2 ring-blue-500/30 scale-105'
            : 'border-zinc-500 hover:border-white/30 hover:scale-105'}"
        style="background-color: {preset.color}"
        title="{preset.name} ({preset.color})"
        onclick={() => selectPresetColor(preset)}
        ondblclick={() => copyColor(preset.color)}
        type="button"
      >
        <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20">
          {preset.name}
        </div>
      </button>
    {/each}
  </div>

  <!-- Custom color picker -->
  <div class="flex items-center gap-2 border-t border-zinc-700 pt-2">
    <span class="text-xs text-zinc-400">{t('color_custom')}</span>
    <input
      type="color"
      class="h-7 w-7 cursor-pointer rounded border border-zinc-500 bg-zinc-950"
      value={customColorValue}
      onchange={handleColorPickerChange}
    />
    <input
      type="text"
      class="studio-field min-w-0 flex-1 px-2 py-1 text-xs"
      bind:value={customColorValue}
      placeholder="#ffffff"
      onchange={handleTextInputChange}
      onkeydown={handleTextKeydown}
    />
    <div
      class="h-7 w-7 rounded border border-zinc-500"
      style="background-color: {customColorValue}"
    ></div>
  </div>
</div>
