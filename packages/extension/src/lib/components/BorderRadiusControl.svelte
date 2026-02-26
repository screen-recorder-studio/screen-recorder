<!-- Border radius configuration control -->

<script lang="ts">
  import { Square, Circle, SlidersHorizontal } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { _t as t } from '$lib/utils/i18n'

  // Current border radius value
  const currentRadius = $derived(backgroundConfigStore.config.borderRadius || 0)

  // Preset border radius values - increased range for more visible effects
  const PRESET_RADIUS = [
    { name: 'No Radius', value: 0, icon: Square },
    { name: 'Small Radius', value: 20, icon: Circle },
    { name: 'Medium Radius', value: 40, icon: Circle },
    { name: 'Large Radius', value: 60, icon: Circle },
    { name: 'Extra Large Radius', value: 80, icon: Circle }
  ] as const

  // Handle slider changes
  function handleSliderChange(event: Event) {
    const target = event.target as HTMLInputElement
    const value = parseInt(target.value)
    backgroundConfigStore.updateBorderRadius(value)
  }

  // Handle preset value selection
  function handlePresetSelect(preset: typeof PRESET_RADIUS[number]) {
    console.log('🎨 [BorderRadiusControl] Preset selected:', preset)
    backgroundConfigStore.updateBorderRadius(preset.value)
  }

  // Check if current preset is selected
  function isPresetSelected(value: number) {
    return currentRadius === value
  }

</script>

<!-- Video border radius configuration control -->
<div class="p-4 border border-gray-200 rounded-lg bg-white">
  <div class="flex items-center gap-2 mb-4">
    <SlidersHorizontal class="w-4 h-4 text-gray-600" />
    <h3 class="text-sm font-semibold text-gray-700">{t('radius_title')}</h3>
  </div>

  <!-- Slider control -->
  <div class="flex items-center gap-3 mb-4">
    <input
      type="range"
      class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
      min="0"
      max="100"
      step="2"
      value={currentRadius}
      oninput={handleSliderChange}
    />
    <div class="min-w-[50px] text-center text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">
      {currentRadius}px
    </div>
  </div>

  <!-- Preset value quick selection -->
  <div class="flex gap-2 mb-4 flex-wrap">
    {#each PRESET_RADIUS as preset}
      {@const IconComponent = preset.icon}
      {@const label = t(
        preset.name === 'No Radius' ? 'radius_none' :
        preset.name === 'Small Radius' ? 'radius_small' :
        preset.name === 'Medium Radius' ? 'radius_medium' :
        preset.name === 'Large Radius' ? 'radius_large' :
        'radius_xl'
      )}
      <button
        class="flex items-center gap-1.5 px-3 py-2 text-xs border rounded-md cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
        class:border-blue-500={isPresetSelected(preset.value)}
        class:bg-blue-500={isPresetSelected(preset.value)}
        class:text-white={isPresetSelected(preset.value)}
        class:border-gray-300={!isPresetSelected(preset.value)}
        class:bg-white={!isPresetSelected(preset.value)}
        class:text-gray-700={!isPresetSelected(preset.value)}
        class:hover:border-blue-400={!isPresetSelected(preset.value)}
        class:hover:bg-blue-50={!isPresetSelected(preset.value)}
        onclick={() => handlePresetSelect(preset)}
        title="{label} ({preset.value}px)"
      >
        <IconComponent class="w-3 h-3" />
        <span>{label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  /* Custom slider styles */
  .slider-thumb::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .slider-thumb::-webkit-slider-thumb:hover {
    background: #2563eb;
    transform: scale(1.1);
  }

  .slider-thumb::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .slider-thumb::-moz-range-thumb:hover {
    background: #2563eb;
    transform: scale(1.1);
  }
</style>
