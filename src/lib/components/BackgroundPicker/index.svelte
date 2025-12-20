<!-- Background Picker - Main container with tab navigation -->
<script lang="ts">
  import { Palette, Layers, Image, Mountain, PaintBucket } from '@lucide/svelte'
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'

  import SolidColorPanel from './SolidColorPanel.svelte'
  import GradientPanel from './GradientPanel.svelte'
  import WallpaperPanel from './WallpaperPanel.svelte'
  import ImageUploadPanel from './ImageUploadPanel.svelte'

  // Background type options
  type BackgroundType = BackgroundConfig['type']

  // Current configuration from store
  const currentConfig = $derived(backgroundConfigStore.config)
  const currentType = $derived(currentConfig.type)

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
    if (currentType !== 'wallpaper') {
      activeTab = currentType
    }
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

<div class="p-4 border border-gray-200 rounded-lg bg-white flex flex-col gap-4">
  <!-- Header and Tab navigation -->
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <PaintBucket class="w-4 h-4 text-gray-600" />
      <h3 class="text-sm font-semibold text-gray-700">Background</h3>
    </div>
    <div class="flex bg-gray-100 rounded-md p-0.5 gap-0.5" role="tablist">
      {#each tabOptions as tab}
        <button
          class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-all
            {activeTab === tab.value 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-600 hover:bg-gray-200 hover:text-gray-700'}"
          onclick={() => switchTab(tab.value)}
          onkeydown={handleTabKeydown}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.value}
          tabindex={activeTab === tab.value ? 0 : -1}
        >
          <tab.icon class="w-3.5 h-3.5" />
          <span>{tab.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Content panels -->
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
</div>

