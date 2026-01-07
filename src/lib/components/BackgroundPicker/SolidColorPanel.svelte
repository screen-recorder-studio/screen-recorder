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
  <div class="flex bg-gray-100 rounded p-0.5 gap-0.5">
    {#each categories as cat}
      <button
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded transition-all
          {activeCategory === cat.key
            ? 'bg-white text-gray-800 shadow-sm'
            : 'text-gray-600 hover:bg-gray-200'}"
        onclick={() => activeCategory = cat.key}
        type="button"
      >
        <cat.icon class="w-3 h-3" />
        <span>{t(
          cat.key === 'basic' ? 'color_tab_basic' :
          cat.key === 'light' ? 'color_tab_light' :
          cat.key === 'business' ? 'color_tab_business' :
          'color_tab_creative'
        )}</span>
      </button>
    {/each}
  </div>

  <!-- Color grid - 8 columns -->
  <div class="grid grid-cols-8 gap-1.5">
    {#each activeCategoryColors as preset}
      <button
        class="w-8 h-8 rounded-md border-2 cursor-pointer transition-all relative group
          {isSelected(preset)
            ? 'border-blue-500 ring-2 ring-blue-200 scale-105'
            : 'border-gray-300 hover:border-gray-400 hover:scale-105'}"
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
  <div class="flex items-center gap-2 pt-2 border-t border-gray-200">
    <span class="text-xs text-gray-600">{t('color_custom')}</span>
    <input
      type="color"
      class="w-7 h-7 border border-gray-300 rounded cursor-pointer"
      value={customColorValue}
      onchange={handleColorPickerChange}
    />
    <input
      type="text"
      class="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
      bind:value={customColorValue}
      placeholder="#ffffff"
      onchange={handleTextInputChange}
      onkeydown={handleTextKeydown}
    />
    <div
      class="w-7 h-7 border border-gray-300 rounded"
      style="background-color: {customColorValue}"
    ></div>
  </div>
</div>
