<!-- Shadow configuration control -->
<script lang="ts">
  import { Zap, Palette, Move, Focus, Sun, Moon, Sparkles } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'
  import { _t as t } from '$lib/utils/i18n'

  // Current shadow configuration
  const currentShadow = $derived(backgroundConfigStore.config.shadow)
  const isEnabled = $derived(!!currentShadow)

  // Shadow parameter states
  let offsetX = $state(8)
  let offsetY = $state(8)
  let blur = $state(16)
  let color = $state('#000000')
  let opacity = $state(0.3)

  // Preset shadow effects
  const SHADOW_PRESETS = [
    {
      name: 'Light Shadow',
      offsetX: 4,
      offsetY: 4,
      blur: 8,
      color: '#000000',
      opacity: 0.2,
      icon: Sun
    },
    {
      name: 'Standard Shadow',
      offsetX: 8,
      offsetY: 8,
      blur: 16,
      color: '#000000',
      opacity: 0.3,
      icon: Moon
    },
    {
      name: 'Deep Shadow',
      offsetX: 12,
      offsetY: 12,
      blur: 24,
      color: '#000000',
      opacity: 0.4,
      icon: Focus
    },
    {
      name: 'Distant Shadow',
      offsetX: 16,
      offsetY: 16,
      blur: 32,
      color: '#000000',
      opacity: 0.25,
      icon: Sparkles
    }
  ] as const

  // Toggle shadow switch
  function toggleShadow() {
    if (isEnabled) {
      // Turn off shadow
      backgroundConfigStore.updateShadow(undefined)
    } else {
      // Turn on shadow, use current parameters
      updateShadowConfig()
    }
  }

  // Update shadow configuration
  function updateShadowConfig() {
    const shadowConfig: BackgroundConfig['shadow'] = {
      offsetX,
      offsetY,
      blur,
      color: hexToRgba(color, opacity)
    }
    backgroundConfigStore.updateShadow(shadowConfig)
  }

  // Apply preset shadow
  function applyPreset(preset: typeof SHADOW_PRESETS[number]) {
    console.log('🎨 [ShadowControl] Applying preset:', preset.name)
    offsetX = preset.offsetX
    offsetY = preset.offsetY
    blur = preset.blur
    color = preset.color
    opacity = preset.opacity
    
    if (isEnabled) {
      updateShadowConfig()
    }
  }

  // Color conversion utility
  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  // Handle parameter changes
  function handleParameterChange() {
    if (isEnabled) {
      updateShadowConfig()
    }
  }

  // Sync current configuration on initialization
  $effect(() => {
    if (currentShadow) {
      // Parse current shadow configuration
      offsetX = currentShadow.offsetX
      offsetY = currentShadow.offsetY
      blur = currentShadow.blur
      
      // Parse color and opacity
      const colorMatch = currentShadow.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
      if (colorMatch) {
        const [, r, g, b, a] = colorMatch
        color = `#${parseInt(r).toString(16).padStart(2, '0')}${parseInt(g).toString(16).padStart(2, '0')}${parseInt(b).toString(16).padStart(2, '0')}`
        opacity = a ? parseFloat(a) : 1
      }
    }
  })

</script>

<!-- Video shadow configuration control -->
<div class="studio-panel-card p-4">
  <div class="flex justify-between items-center mb-4">
    <div class="flex items-center gap-2">
      <Zap class="h-4 w-4 text-zinc-400" />
      <h3 class="studio-section-heading">{t('shadow_title')}</h3>
    </div>
    <label class="relative inline-block w-11 h-6">
      <input
        type="checkbox"
        class="opacity-0 w-0 h-0"
        checked={isEnabled}
        onchange={toggleShadow}
      />
      <span class="absolute bottom-0 left-0 right-0 top-0 cursor-pointer rounded-full bg-zinc-700 transition-all duration-300 before:absolute before:bottom-1 before:left-1 before:h-4 before:w-4 before:rounded-full before:bg-white before:content-[''] before:transition-all before:duration-300"
            class:bg-blue-500={isEnabled}
            class:before:translate-x-5={isEnabled}></span>
    </label>
  </div>

  {#if isEnabled}
    <!-- Preset shadow selection -->
    <div class="mb-4">
      <h4 class="mb-3 text-xs font-semibold text-zinc-400">{t('shadow_preset_title')}</h4>
      <div class="grid grid-cols-2 gap-2">
        {#each SHADOW_PRESETS as preset}
          {@const IconComponent = preset.icon}
          {@const label = t(
            preset.name === 'Light Shadow' ? 'shadow_light' :
            preset.name === 'Standard Shadow' ? 'shadow_standard' :
            preset.name === 'Deep Shadow' ? 'shadow_deep' :
            'shadow_distant'
          )}
          <button
            class="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-zinc-500 bg-zinc-900 p-3 transition-all duration-200 hover:border-blue-400 hover:bg-blue-500/10 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            onclick={() => applyPreset(preset)}
            title={label}
          >
            <div class="flex h-6 w-10 items-center justify-center rounded bg-zinc-800">
              <div
                class="h-4 w-6 rounded-sm bg-blue-500"
                style="
                  box-shadow: {preset.offsetX}px {preset.offsetY}px {preset.blur}px {hexToRgba(preset.color, preset.opacity)};
                "
              ></div>
            </div>
            <div class="flex items-center gap-1">
              <IconComponent class="h-3 w-3 text-zinc-400" />
              <span class="text-xs font-medium text-zinc-300">{label}</span>
            </div>
          </button>
        {/each}
      </div>
    </div>

    <!-- Custom parameters -->
    <div class="mb-4">
      <h4 class="mb-3 text-xs font-semibold text-zinc-400">{t('shadow_custom_title')}</h4>

      <!-- X offset -->
      <div class="mb-3">
        <div class="flex items-center gap-2 mb-1">
          <Move class="h-3 w-3 text-zinc-400" />
          <label class="text-xs font-medium text-zinc-400" for="shadow-offset-x">{t('shadow_offset_x')}: {offsetX}px</label>
        </div>
        <input
          id="shadow-offset-x"
          type="range"
          class="slider-thumb h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-700"
          min="-20"
          max="20"
          step="1"
          bind:value={offsetX}
          oninput={handleParameterChange}
        />
      </div>

      <!-- Y offset -->
      <div class="mb-3">
        <div class="flex items-center gap-2 mb-1">
          <Move class="h-3 w-3 rotate-90 text-zinc-400" />
          <label class="text-xs font-medium text-zinc-400" for="shadow-offset-y">{t('shadow_offset_y')}: {offsetY}px</label>
        </div>
        <input
          id="shadow-offset-y"
          type="range"
          class="slider-thumb h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-700"
          min="-20"
          max="20"
          step="1"
          bind:value={offsetY}
          oninput={handleParameterChange}
        />
      </div>

      <!-- Blur radius -->
      <div class="mb-3">
        <div class="flex items-center gap-2 mb-1">
          <Focus class="h-3 w-3 text-zinc-400" />
          <label class="text-xs font-medium text-zinc-400" for="shadow-blur">{t('shadow_blur')}: {blur}px</label>
        </div>
        <input
          id="shadow-blur"
          type="range"
          class="slider-thumb h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-700"
          min="0"
          max="40"
          step="1"
          bind:value={blur}
          oninput={handleParameterChange}
        />
      </div>

      <!-- Color and opacity -->
      <div class="flex gap-3">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <Palette class="h-3 w-3 text-zinc-400" />
            <label class="text-xs font-medium text-zinc-400" for="shadow-color">{t('shadow_color')}</label>
          </div>
          <input
            id="shadow-color"
            type="color"
            class="h-8 w-full cursor-pointer rounded border border-zinc-500 bg-zinc-950"
            bind:value={color}
            oninput={handleParameterChange}
          />
        </div>
        <div class="flex-2">
          <label class="mb-1 block text-xs font-medium text-zinc-400" for="shadow-opacity">{t('shadow_opacity')}: {Math.round(opacity * 100)}%</label>
          <input
            id="shadow-opacity"
            type="range"
            class="slider-thumb h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-700"
            min="0"
            max="1"
            step="0.05"
            bind:value={opacity}
            oninput={handleParameterChange}
          />
        </div>
      </div>
    </div>
  {:else}
    <div class="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-center text-xs text-zinc-400">
      {t('shadow_empty_state')}
    </div>
  {/if}
</div>

<style>
  /* Shared Studio blue accent */
  .slider-thumb::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
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
    width: 18px;
    height: 18px;
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
