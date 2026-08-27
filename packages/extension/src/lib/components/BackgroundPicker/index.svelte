<!-- Background Picker - Main container with tab navigation -->
<script lang="ts">
  import { Palette, Layers, Image, Mountain, PaintBucket } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'
  import { _t as t } from '$lib/utils/i18n'

  import SolidColorPanel from './SolidColorPanel.svelte'
  import GradientPanel from './GradientPanel.svelte'
  import WallpaperPanel from './WallpaperPanel.svelte'
  import ImageUploadPanel from './ImageUploadPanel.svelte'

  // Background type options
  type BackgroundType = BackgroundConfig['type']

  // Current configuration from store
  const currentConfig = $derived(backgroundConfigStore.config)
  const currentType = $derived(currentConfig.type)
  const backgroundEnabled = $derived(currentConfig.enabled !== false)

  // Active tab state
  let activeTab = $state<BackgroundType>('wallpaper')

  // Tab options configuration
  const tabOptions = [
    { value: 'wallpaper' as const, label: 'Wallpaper', icon: Mountain },
    { value: 'gradient' as const, label: 'Gradient', icon: Layers },
    { value: 'solid-color' as const, label: 'Solid', icon: Palette },
    { value: 'image' as const, label: 'Image', icon: Image },
  ] as const

  // Sync activeTab with current config type
  $effect(() => {
    activeTab = currentType
  })

  // Switch tab and update background type
  function switchTab(type: BackgroundType) {
    activeTab = type

    if (type !== currentType) {
      let restored = false

      if (type === 'solid-color') {
        backgroundConfigStore.updateBackgroundType('solid-color')
        restored = true
      } else if (type === 'gradient') {
        restored = backgroundConfigStore.restoreGradientBackground()
        if (!restored) backgroundConfigStore.updateBackgroundType('gradient')
      } else if (type === 'image') {
        backgroundConfigStore.updateBackgroundType('image')
      } else if (type === 'wallpaper') {
        restored = backgroundConfigStore.restoreWallpaperBackground()
        if (!restored) backgroundConfigStore.updateBackgroundType('wallpaper')
      }

      console.log(`🔄 [BackgroundPicker] Switched to ${type}, restored: ${restored}`)
    }
  }

  // Keyboard navigation for tabs
  function handleTabKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const currentIndex = tabOptions.findIndex(tab => tab.value === activeTab)
      const nextIndex = event.key === 'ArrowRight'
        ? (currentIndex + 1) % tabOptions.length
        : (currentIndex - 1 + tabOptions.length) % tabOptions.length
      switchTab(tabOptions[nextIndex].value)
    }
  }

</script>

<div class="studio-panel-card flex flex-col gap-4 p-4">
  <!-- Header and Tab navigation -->
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <PaintBucket class="h-4 w-4 text-zinc-400" />
      <h3 class="studio-section-heading">{t('bg_title')}</h3>
    </div>

    <div class="studio-segmented grid grid-cols-2 gap-0.5 p-1" role="group" aria-label="Canvas presentation">
      <button
        type="button"
        class="rounded px-2.5 py-2 text-xs font-semibold transition-colors
          {!backgroundEnabled
            ? 'bg-zinc-700 text-zinc-100 shadow-sm ring-1 ring-white/10'
            : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}"
        aria-pressed={!backgroundEnabled}
        onclick={() => backgroundConfigStore.updateEnabled(false)}
      >
        Original frame
      </button>
      <button
        type="button"
        class="rounded px-2.5 py-2 text-xs font-semibold transition-colors
          {backgroundEnabled
            ? 'bg-zinc-700 text-blue-200 shadow-sm ring-1 ring-white/10'
            : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}"
        aria-pressed={backgroundEnabled}
        onclick={() => backgroundConfigStore.updateEnabled(true)}
      >
        Styled canvas
      </button>
    </div>

    {#if backgroundEnabled}
    <div class="studio-segmented flex gap-0.5 p-1" role="tablist">
      {#each tabOptions as tab}
        {@const tabLabel = t(
          tab.value === 'wallpaper' ? 'bg_tab_wallpaper' :
          tab.value === 'gradient' ? 'bg_tab_gradient' :
          tab.value === 'solid-color' ? 'bg_tab_solid' :
          'bg_tab_image'
        )}
        <button
          class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-all
            {activeTab === tab.value 
              ? 'bg-zinc-700 text-blue-300 shadow-sm ring-1 ring-white/10'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}"
          onclick={() => switchTab(tab.value)}
          onkeydown={handleTabKeydown}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.value}
          aria-label={tabLabel}
          title={tabLabel}
          tabindex={activeTab === tab.value ? 0 : -1}
        >
          <tab.icon class="w-3.5 h-3.5" />
          <span class={activeTab === tab.value ? '' : 'sr-only'}>{tabLabel}</span>
        </button>
      {/each}
    </div>
    {/if}
  </div>

  <!-- Content panels -->
  {#if backgroundEnabled}
  <div class="min-h-0" role="tabpanel">
    {#if activeTab === 'solid-color'}
      <SolidColorPanel />
    {:else if activeTab === 'gradient'}
      <GradientPanel />
    {:else if activeTab === 'wallpaper'}
      <WallpaperPanel />
    {:else if activeTab === 'image'}
      <ImageUploadPanel />
    {/if}
  </div>
  {:else}
    <div class="rounded-lg border border-blue-400/20 bg-blue-500/5 px-3 py-3 text-xs leading-5 text-zinc-300">
      The recording fills the canvas directly. Background, padding, rounded corners, and shadow are omitted.
    </div>
  {/if}
</div>
