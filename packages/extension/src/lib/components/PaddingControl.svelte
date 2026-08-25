<!-- Padding configuration control -->
<script lang="ts">
  import { Move, Minimize2, Maximize2, SlidersHorizontal } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import { _t as t } from '$lib/utils/i18n'

  // Current padding value
  const currentPadding = $derived(backgroundConfigStore.config.padding ?? 60)

  // Preset padding values
  const PRESET_PADDING = [
    { name: 'No Padding', value: 0, icon: Minimize2 },
    { name: 'Small Padding', value: 30, icon: Move },
    { name: 'Medium Padding', value: 60, icon: Move },
    { name: 'Large Padding', value: 120, icon: Move },
    { name: 'Extra Large Padding', value: 200, icon: Maximize2 }
  ] as const

  // Handle slider change
  function handleSliderChange(event: Event) {
    const target = event.target as HTMLInputElement
    const value = parseInt(target.value)
    backgroundConfigStore.updatePadding(value)
  }

  // Handle preset selection
  function handlePresetSelect(preset: typeof PRESET_PADDING[number]) {
    console.log('🎨 [PaddingControl] Preset selected:', preset)
    backgroundConfigStore.updatePadding(preset.value)
  }

  // Check if preset is currently selected
  function isPresetSelected(value: number) {
    return currentPadding === value
  }

</script>

<!-- Padding configuration control -->
<div class="studio-panel-card p-4">
  <div class="flex items-center gap-2 mb-4">
    <SlidersHorizontal class="h-4 w-4 text-zinc-400" />
    <h3 class="studio-section-heading">{t('padding_title')}</h3>
  </div>

  <!-- Slider control -->
  <div class="flex items-center gap-3 mb-4">
    <input
      type="range"
      class="slider-thumb h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-zinc-700"
      min="0"
      max="200"
      step="5"
      value={currentPadding}
      oninput={handleSliderChange}
    />
    <div class="min-w-[60px] rounded-md border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-center text-xs font-semibold text-blue-300">
      {currentPadding}px
    </div>
  </div>

  <!-- Preset value quick selection -->
  <div class="flex gap-2 mb-4 flex-wrap">
    {#each PRESET_PADDING as preset}
      {@const IconComponent = preset.icon}
      {@const label = t(
        preset.name === 'No Padding' ? 'padding_none' :
        preset.name === 'Small Padding' ? 'padding_small' :
        preset.name === 'Medium Padding' ? 'padding_medium' :
        preset.name === 'Large Padding' ? 'padding_large' :
        'padding_xl'
      )}
      <button
        class="flex items-center gap-1.5 px-3 py-2 text-xs border rounded-md cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50"
        class:border-blue-500={isPresetSelected(preset.value)}
        class:bg-blue-500={isPresetSelected(preset.value)}
        class:text-white={isPresetSelected(preset.value)}
        class:border-zinc-700={!isPresetSelected(preset.value)}
        class:bg-zinc-900={!isPresetSelected(preset.value)}
        class:text-zinc-400={!isPresetSelected(preset.value)}
        class:hover:border-blue-400={!isPresetSelected(preset.value)}
        class:hover:bg-blue-950={!isPresetSelected(preset.value)}
        onclick={() => handlePresetSelect(preset)}
        aria-pressed={isPresetSelected(preset.value)}
        title="{label} ({preset.value}px)"
      >
        <IconComponent class="w-3 h-3" />
        <span>{label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  /* Shared Studio blue accent */
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
