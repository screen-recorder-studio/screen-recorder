<!-- Padding configuration control -->
<script lang="ts">
  import { Move, Minimize2, Maximize2, Eye, SlidersHorizontal } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'

  // Current padding value
  const currentPadding = $derived(backgroundConfigStore.config.padding || 60)

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

  // Calculate preview padding - use smaller ratio and set maximum value
  const previewPadding = $derived(Math.min(Math.round(currentPadding * 0.2), 40))

  // Determine display text based on padding size
  const displayText = $derived(currentPadding > 150 ? 'Video' : 'Video Area')
  const showPaddingValue = $derived(currentPadding <= 120)
</script>

<!-- Padding configuration control -->
<div class="p-4 border border-gray-200 rounded-lg bg-white">
  <div class="flex items-center gap-2 mb-4">
    <SlidersHorizontal class="w-4 h-4 text-gray-600" />
    <h3 class="text-sm font-semibold text-gray-700">Video Padding</h3>
  </div>

  <!-- Slider control -->
  <div class="flex items-center gap-3 mb-4">
    <input
      type="range"
      class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
      min="0"
      max="200"
      step="5"
      value={currentPadding}
      oninput={handleSliderChange}
    />
    <div class="min-w-[60px] text-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
      {currentPadding}px
    </div>
  </div>

  <!-- Preset value quick selection -->
  <div class="flex gap-2 mb-4 flex-wrap">
    {#each PRESET_PADDING as preset}
      {@const IconComponent = preset.icon}
      <button
        class="flex items-center gap-1.5 px-3 py-2 text-xs border rounded-md cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50"
        class:border-emerald-500={isPresetSelected(preset.value)}
        class:bg-emerald-500={isPresetSelected(preset.value)}
        class:text-white={isPresetSelected(preset.value)}
        class:border-gray-300={!isPresetSelected(preset.value)}
        class:bg-white={!isPresetSelected(preset.value)}
        class:text-gray-700={!isPresetSelected(preset.value)}
        class:hover:border-emerald-400={!isPresetSelected(preset.value)}
        class:hover:bg-emerald-50={!isPresetSelected(preset.value)}
        onclick={() => handlePresetSelect(preset)}
        title="{preset.name} ({preset.value}px)"
      >
        <IconComponent class="w-3 h-3" />
        <span>{preset.name}</span>
      </button>
    {/each}
  </div>

  <!-- Visual preview -->
  <div class="mt-4">
    <div class="flex items-center gap-2 mb-2">
      <Eye class="w-3 h-3 text-gray-600" />
      <div class="text-xs text-gray-600 font-medium">Preview Effect:</div>
    </div>
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-center p-6 bg-gray-50 rounded-md">
        <div
          class="w-48 h-32 bg-gray-200 border-2 border-gray-300 rounded flex items-center justify-center transition-all duration-300"
          style="padding: {previewPadding}px"
        >
          <div class="bg-emerald-500 text-white font-medium rounded flex items-center justify-center w-full h-full min-w-[60px] min-h-[40px]"
               class:text-xs={currentPadding > 150}
               class:text-sm={currentPadding <= 150}
               class:p-1={currentPadding > 150}
               class:p-2={currentPadding > 100 && currentPadding <= 150}
               class:p-3={currentPadding <= 100}>
            <span class="text-center leading-tight overflow-hidden">
              {displayText}
              {#if showPaddingValue}
                <br>
                <span class="text-xs opacity-90">{currentPadding}px</span>
              {/if}
            </span>
          </div>
        </div>
      </div>
      <div class="text-xs text-gray-600 text-center font-medium">
        Padding: {currentPadding}px
      </div>
    </div>
  </div>
</div>

<style>
  /* Custom slider styles - using green theme */
  .slider-thumb::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    background: #10b981;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .slider-thumb::-webkit-slider-thumb:hover {
    background: #059669;
    transform: scale(1.1);
  }

  .slider-thumb::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #10b981;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .slider-thumb::-moz-range-thumb:hover {
    background: #059669;
    transform: scale(1.1);
  }
</style>
