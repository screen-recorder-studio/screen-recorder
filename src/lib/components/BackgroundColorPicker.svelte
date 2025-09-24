<!-- Background color picker - supports solid color and gradient switching -->
<script lang="ts">
  import { Palette, Layers, Image, Mountain, Upload, CircleAlert } from '@lucide/svelte'
  import {
    backgroundConfigStore,
    PRESET_COLORS,
    PRESET_SOLID_COLORS,
    PRESET_GRADIENTS
  } from '$lib/stores/background-config.svelte'
  import type {
    BackgroundConfig,
    SolidColorPreset,
    GradientPreset,
    ImagePreset
  } from '$lib/types/background'
  import { WALLPAPER_CATEGORIES } from '$lib/data/wallpaper-presets'

  // Background type options
  type BackgroundType = BackgroundConfig['type']

  // Currently selected background type and color (using Svelte 5 $derived)
  const currentConfig = $derived(backgroundConfigStore.config)
  const currentType = $derived(currentConfig.type)
  const currentColor = $derived(currentConfig.color)

  // Currently active Tab
  let activeTab = $state<BackgroundType>('wallpaper')

  // Wallpaper related state
  let selectedWallpaper = $state<string>('')

  // Image upload related state
  let fileInput = $state<HTMLInputElement>()
  let isUploading = $state(false)
  let uploadError = $state<string>('')

  // Initialize and sync current configuration type and selection state
  $effect(() => {
    // If current configuration is not wallpaper type, sync activeTab
    if (currentType !== 'wallpaper') {
      activeTab = currentType
    }

    // Set selection state based on current configuration
     if (currentType === 'wallpaper') {
       // If current is wallpaper type, set selected wallpaper ID
       if (currentConfig.wallpaper) {
         selectedWallpaper = currentConfig.wallpaper.imageId
       }
     }
     // If there's no current wallpaper but saved wallpaper configuration exists, also set selection state
     else if (backgroundConfigStore.lastWallpaperConfig) {
       selectedWallpaper = backgroundConfigStore.lastWallpaperConfig.imageId
     }
  })

  // Tab option configuration
  const tabOptions = [
    { value: 'wallpaper' as const, label: 'Wallpaper', icon: Mountain },
    { value: 'gradient' as const, label: 'Gradient', icon: Layers },
    { value: 'solid-color' as const, label: 'Solid Color', icon: Palette },
    { value: 'image' as const, label: 'Image', icon: Image },
  ] as const

  // Switch Tab
  function switchTab(type: BackgroundType) {
    activeTab = type

    // If switching to different type, try to restore previously saved configuration
    if (type !== currentType) {
      let restored = false

      if (type === 'solid-color') {
        // Switch to solid color, use current color
        backgroundConfigStore.updateBackgroundType('solid-color')
        restored = true
      } else if (type === 'gradient') {
        // Switch to gradient, try to restore previous gradient configuration
        restored = backgroundConfigStore.restoreGradientBackground()
        if (!restored) {
          backgroundConfigStore.updateBackgroundType('gradient')
        }
      } else if (type === 'image') {
        // Switch to image, try to restore previous image configuration
        if (!restored) {
          backgroundConfigStore.updateBackgroundType('image')
        }
      } else if (type === 'wallpaper') {
        // Switch to wallpaper, try to restore previous wallpaper configuration
        restored = backgroundConfigStore.restoreWallpaperBackground()
        if (!restored) {
          backgroundConfigStore.updateBackgroundType('wallpaper')
        }
      }

      console.log(`🔄 [BackgroundPicker] Switched to ${type}, restored: ${restored}`)
    }
  }

  // Select wallpaper
  async function selectWallpaper(wallpaper: ImagePreset) {
    try {
      selectedWallpaper = wallpaper.id

      // Use specialized wallpaper handling method
      await backgroundConfigStore.handleWallpaperSelection(wallpaper)

      console.log('🌄 [BackgroundPicker] Wallpaper selected:', wallpaper.name)
    } catch (error) {
      console.error('❌ [BackgroundPicker] Failed to load wallpaper:', error)
      uploadError = 'Failed to load wallpaper, please try again'
      setTimeout(() => { uploadError = '' }, 3000)
    }
  }

  // Color categories - 16 colors per category
  const colorCategories = [
    { key: 'basic', name: 'Basic Colors', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'basic'), icon: '⚫' },
    { key: 'light', name: 'Light Colors', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'light'), icon: '🌸' },
    { key: 'business', name: 'Business Colors', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'business'), icon: '💼' },
    { key: 'creative', name: 'Creative Colors', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'creative'), icon: '🎨' }
  ]

  // Custom color input value
  let customColorValue = $state('')

  // Color search functionality
  let colorSearchQuery = $state('')
  let showColorSearch = $state(false)

  // Sync custom color input value
  $effect(() => {
    if (currentType === 'solid-color') {
      customColorValue = currentColor
    }
  })

  // Filter color categories
  const filteredColorCategories = $derived(
    !colorSearchQuery.trim()
      ? colorCategories
      : colorCategories.map(category => ({
          ...category,
          colors: category.colors.filter(color =>
            color.name.toLowerCase().includes(colorSearchQuery.toLowerCase()) ||
            color.color.toLowerCase().includes(colorSearchQuery.toLowerCase()) ||
            color.id.toLowerCase().includes(colorSearchQuery.toLowerCase())
          )
        })).filter(category => category.colors.length > 0)
  )

  // Handle preset solid color selection
  function handlePresetSolidColorSelect(preset: SolidColorPreset) {
    console.log('🎨 [BackgroundColorPicker] Preset solid color selected:', preset)
    backgroundConfigStore.applyPresetSolidColor(preset)
  }

  // Check if preset solid color is selected
  function isPresetSolidColorSelected(preset: SolidColorPreset) {
    return currentType === 'solid-color' && currentColor === preset.color
  }

  // Handle HTML5 color picker change
  function handleColorPickerChange(event: Event) {
    const target = event.target as HTMLInputElement
    const color = target.value
    console.log('🎨 [BackgroundColorPicker] Color picker changed:', color)
    customColorValue = color
    backgroundConfigStore.updateColor(color)
  }

  // Handle text input color change
  function handleColorTextInput(event: Event) {
    const target = event.target as HTMLInputElement
    const color = target.value.trim()

    // Validate color format
    if (isValidColor(color)) {
      console.log('🎨 [BackgroundColorPicker] Color text input:', color)
      backgroundConfigStore.updateColor(color)
    }
  }

  // Validate color format
  function isValidColor(color: string): boolean {
    // Simple color format validation
    const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
    const rgbPattern = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/
    const rgbaPattern = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/

    return hexPattern.test(color) || rgbPattern.test(color) || rgbaPattern.test(color)
  }

  // Handle text input keyboard events
  function handleColorTextKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      const target = event.target as HTMLInputElement
      handleColorTextInput(event)
      target.blur() // Lose focus
    }
  }

  // === Gradient related functionality ===

  // Gradient categories - 4 types, 8 each
  const gradientCategories = [
    {
      key: 'linear',
      name: 'Linear Gradient',
      icon: '📐',
      description: 'Linear color transition',
      gradients: PRESET_GRADIENTS.filter(g => g.category === 'linear')
    },
    {
      key: 'radial',
      name: 'Radial Gradient',
      icon: '🎯',
      description: 'Color transition radiating from center',
      gradients: PRESET_GRADIENTS.filter(g => g.category === 'radial')
    },
    {
      key: 'conic',
      name: 'Conic Gradient',
      icon: '🌀',
      description: 'Color transition rotating around center',
      gradients: PRESET_GRADIENTS.filter(g => g.category === 'conic')
    },
    {
      key: 'multicolor',
      name: 'Multi-color Gradient',
      icon: '🌈',
      description: 'Rich and complex color transitions',
      gradients: PRESET_GRADIENTS.filter(g => g.category === 'multicolor')
    }
  ]

  // Handle preset gradient selection
  function handlePresetGradientSelect(preset: GradientPreset) {
    console.log('🌈 [BackgroundColorPicker] Preset gradient selected:', preset)
    backgroundConfigStore.applyPresetGradient(preset)
  }

  // Check if preset gradient is selected
  function isPresetGradientSelected(preset: GradientPreset) {
    if (currentType !== 'gradient' || !currentConfig.gradient) return false

    const current = currentConfig.gradient
    const target = preset.config

    // Compare if gradient configurations are the same
    return (
      current.type === target.type &&
      JSON.stringify(current.stops) === JSON.stringify(target.stops) &&
      (current.type === 'linear' ?
        (current as any).angle === (target as any).angle :
        current.type === 'radial' ?
        (current as any).centerX === (target as any).centerX &&
        (current as any).centerY === (target as any).centerY &&
        (current as any).radius === (target as any).radius :
        (current as any).centerX === (target as any).centerX &&
        (current as any).centerY === (target as any).centerY &&
        (current as any).angle === (target as any).angle
      )
    )
  }

  // Get current gradient CSS preview
  function getCurrentGradientPreview(): string {
    if (currentType === 'gradient' && currentConfig.gradient) {
      return backgroundConfigStore.generateGradientCSS(currentConfig.gradient)
    }
    return 'linear-gradient(45deg, #f3f4f6, #e5e7eb)'
  }

  // Handle image upload
  async function handleImageUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]

    if (!file) return

    isUploading = true
    uploadError = ''

    try {
      const result = await backgroundConfigStore.handleImageUpload(file)
      console.log('🖼️ [BackgroundColorPicker] Image uploaded successfully:', result.config.imageId)
    } catch (error) {
      console.error('🖼️ [BackgroundColorPicker] Image upload failed:', error)
      uploadError = error instanceof Error ? error.message : 'Image upload failed'
    } finally {
      isUploading = false
      // Clear input to allow selecting the same file again
      if (input) input.value = ''
    }
  }

  // Handle drag upload
  function handleDrop(event: DragEvent) {
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      const file = files[0]
      if (file.type.startsWith('image/')) {
        // Simulate input change event
        handleImageUpload({ target: { files: [file] } } as any)
      } else {
        uploadError = 'Please select an image file'
      }
    }
  }

  // Handle drag hover
  function handleDragOver(event: DragEvent) {
    event.preventDefault()
  }

  // Trigger file selection
  function triggerFileSelect() {
    fileInput?.click()
  }

  // Handle keyboard events
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      triggerFileSelect()
    }
  }

  // === User experience enhancement features ===

  // Keyboard navigation support
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

  // Color option keyboard navigation
  function handleColorKeydown(event: KeyboardEvent, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }

  // Copy color value to clipboard
  async function copyColorToClipboard(color: string) {
    try {
      await navigator.clipboard.writeText(color)
      console.log('🎨 [BackgroundColorPicker] Color copied to clipboard:', color)
      // Here you can add a temporary success notification
    } catch (error) {
      console.warn('🎨 [BackgroundColorPicker] Failed to copy color:', error)
    }
  }


</script>

<!-- Background color picker - two-row layout -->
<div class="p-4 border border-gray-200 rounded-lg bg-white flex flex-col gap-4">
  <!-- First row: Tab switcher with horizontal scroll support -->
  <div class="flex flex-col gap-3">
    <h3 class="text-sm font-semibold text-gray-700 m-0">Background Settings</h3>
    <!-- Tab container with horizontal scroll -->
    <div class="tab-container">
      <div class="tab-wrapper" role="tablist" aria-label="Background type selection">
        {#each tabOptions as tab}
          <button
            class="tab-button {activeTab === tab.value ? 'tab-active' : 'tab-inactive'}"
            onclick={() => switchTab(tab.value)}
            onkeydown={handleTabKeydown}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            aria-controls="content-area"
            tabindex={activeTab === tab.value ? 0 : -1}
          >
            <!-- <tab.icon class="w-3.5 h-3.5" aria-hidden="true" /> -->
            <span class="font-medium">{tab.label}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- Second row: Content area -->
  <div
    class="min-h-0"
    id="content-area"
    role="tabpanel"
    aria-labelledby="tab-{activeTab}"
  >
    {#if activeTab === 'solid-color'}
      <!-- Solid color selector -->
      <div class="space-y-4">
        <!-- Color search -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-medium text-gray-700 m-0">Color Search</h4>
              <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {PRESET_SOLID_COLORS.length} colors total
              </span>
            </div>
            {#if colorSearchQuery.trim()}
              <button
                class="text-xs text-blue-600 hover:text-blue-800 underline"
                onclick={() => colorSearchQuery = ''}
                type="button"
              >
                Clear Search
              </button>
            {/if}
          </div>
          <input
            type="text"
            class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Search color names or color values..."
            bind:value={colorSearchQuery}
          />
          {#if colorSearchQuery.trim()}
            <div class="text-xs text-gray-600">
              Found {filteredColorCategories.reduce((total, cat) => total + cat.colors.length, 0)} matching colors
            </div>
          {/if}
        </div>

        <!-- Preset color categories -->
        {#each filteredColorCategories as category}
          {#if category.colors.length > 0}
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-gray-700 m-0 flex items-center gap-2">
                <span class="text-base">{category.icon}</span>
                {category.name}
                <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {category.colors.length} colors
                </span>
              </h4>
              <!-- 16 colors using 8x2 grid layout -->
              <div class="grid grid-cols-8 gap-2 mb-4">
                {#each category.colors as preset}
                  <button
                    class="w-9 h-9 rounded-lg border-3 cursor-pointer transition-all duration-200 relative group {isPresetSolidColorSelected(preset) ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' : 'border-gray-300 hover:border-gray-400 hover:scale-105'}"
                    style="background-color: {preset.color}"
                    title="{preset.name} ({preset.color}) - Click to select, double-click to copy color value"
                    onclick={() => handlePresetSolidColorSelect(preset)}
                    ondblclick={() => copyColorToClipboard(preset.color)}
                    onkeydown={(e) => handleColorKeydown(e, () => handlePresetSolidColorSelect(preset))}
                    type="button"
                    aria-label="{preset.name}, color value: {preset.color}"
                    tabindex="0"
                  >
                    <!-- Show color name on hover - moved to top to avoid being covered -->
                    <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-20">
                      {preset.name}
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- Custom color picker -->
        <div class="space-y-3">
          <h4 class="text-sm font-medium text-gray-700 m-0">Custom Color</h4>
          <div class="flex gap-3">
            <!-- HTML5 color picker -->
            <div class="flex flex-col gap-1">
              <label class="text-xs text-gray-600" for="color-picker-input">Color Picker</label>
              <input
                id="color-picker-input"
                type="color"
                class="w-12 h-8 border border-gray-300 rounded cursor-pointer"
                value={customColorValue}
                onchange={handleColorPickerChange}
              />
            </div>

            <!-- Color value input -->
            <div class="flex flex-col gap-1 flex-1">
              <label class="text-xs text-gray-600" for="color-text-input">Color Value</label>
              <input
                id="color-text-input"
                type="text"
                class="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                bind:value={customColorValue}
                placeholder="#ffffff"
                onchange={handleColorTextInput}
                onkeydown={handleColorTextKeydown}
              />
            </div>
          </div>

          <!-- Color preview -->
          <div class="flex items-center gap-2">
            <div class="text-xs text-gray-600">Preview</div>
            <div
              class="w-8 h-6 border border-gray-300 rounded"
              style="background-color: {customColorValue}"
            ></div>
          </div>
        </div>
      </div>
    {:else if activeTab === 'image'}
      <!-- Image background selector -->
      <div class="space-y-4">
        <!-- Hidden file input -->
        <input
          type="file"
          accept="image/*"
          bind:this={fileInput}
          onchange={handleImageUpload}
          class="hidden"
        />

        <!-- Upload area -->
        <div class="space-y-3">
          <div
            class="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer transition-colors duration-200 {isUploading ? 'border-blue-400 bg-blue-50' : 'hover:border-gray-400 hover:bg-gray-50'}"
            onclick={triggerFileSelect}
            ondrop={handleDrop}
            ondragover={handleDragOver}
            onkeydown={handleKeydown}
            role="button"
            tabindex="0"
          >
            {#if isUploading}
              <div class="flex flex-col items-center gap-2">
                <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span class="text-sm text-blue-600">Processing image...</span>
              </div>
            {:else}
              <div class="flex flex-col items-center gap-3">
                <Upload class="w-8 h-8 text-gray-400" />
                <div class="space-y-1">
                  <div class="text-sm font-medium text-gray-700">Click to select image</div>
                  <div class="text-xs text-gray-500">or drag image here</div>
                </div>
                <div class="text-xs text-gray-400">Supports JPEG, PNG, WebP, GIF formats, max 5MB</div>
              </div>
            {/if}
          </div>

          {#if uploadError}
            <div class="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <CircleAlert class="w-4 h-4 text-red-500 flex-shrink-0" />
              <span class="text-sm text-red-700">{uploadError}</span>
            </div>
          {/if}
        </div>

        <!-- Current user uploaded image preview -->
        {#if activeTab === 'image' && currentType === 'image' && currentConfig.image}
          <div class="space-y-3">
            <h4 class="text-sm font-medium text-gray-700 m-0">Current Image</h4>
            <div class="flex gap-3">
              <div
                class="w-16 h-16 border border-gray-300 rounded-lg bg-cover bg-center flex-shrink-0"
                style="background-image: url({backgroundConfigStore.getCurrentBackgroundStyle().replace('url(', '').replace(')', '')});"
              ></div>
              <div class="flex flex-col gap-1 text-xs text-gray-600">
                <div>ID: {currentConfig.image.imageId}</div>
                <div>Fit: {currentConfig.image.fit}</div>
                <div>Position: {currentConfig.image.position}</div>
                {#if currentConfig.image.opacity !== undefined && currentConfig.image.opacity < 1}
                  <div>Opacity: {Math.round(currentConfig.image.opacity * 100)}%</div>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </div>
    {:else if activeTab === 'wallpaper'}
      <!-- Wallpaper background selector -->
      <div class="space-y-4">
        <!-- Wallpaper statistics -->
        <div class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-blue-700">Wallpaper Library</span>
              <span class="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                {Object.values(WALLPAPER_CATEGORIES).reduce((total, cat) => total + cat.wallpapers.length, 0)} total
              </span>
            </div>
            <div class="text-xs text-blue-600">
              {Object.keys(WALLPAPER_CATEGORIES).length} categories
            </div>
          </div>
        </div>

        <!-- Wallpaper categories -->
        {#each Object.entries(WALLPAPER_CATEGORIES) as [, category]}
          {#if category.wallpapers.length > 0}

            <div class="space-y-3">
              <h4 class="text-sm font-medium text-gray-700 m-0 flex items-center gap-2">
                <span class="text-base">{category.icon}</span>
                {category.name}
                <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {category.wallpapers.length} colors
                </span>
              </h4>
              {#if category.description}
                <p class="text-xs text-gray-500 m-0">{category.description}</p>
              {/if}
              <div class="grid grid-cols-2 gap-3">
                {#each category.wallpapers as wallpaper}
                  <button
                    class="relative group border-3 rounded-lg overflow-hidden cursor-pointer transition-all duration-200 {selectedWallpaper === wallpaper.id ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' : 'border-gray-300 hover:border-gray-400'}"
                    onclick={() => selectWallpaper(wallpaper)}
                    type="button"
                    title={wallpaper.description}
                  >
                    <div class="aspect-video bg-gray-100">
                      <img
                        src={wallpaper.imageUrl}
                        alt={wallpaper.name}
                        loading="lazy"
                        class="w-full h-full object-cover"
                      />
                    </div>
                    <div class="p-2 bg-white">
                      <div class="text-xs font-medium text-gray-700 truncate">{wallpaper.name}</div>
                      {#if wallpaper.tags && wallpaper.tags.length > 0}
                        <div class="text-xs text-gray-500 truncate">
                          {wallpaper.tags.slice(0, 2).join(', ')}
                        </div>
                      {/if}
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- Current wallpaper preview -->
        {#if activeTab === 'wallpaper' && currentType === 'wallpaper' && currentConfig.wallpaper}
          <div class="mt-4 p-3 bg-gray-50 rounded-lg border">
            <h4 class="text-sm font-medium text-gray-700 mb-2 m-0">Current wallpaper</h4>
            <div class="flex gap-3">
              <div
                class="w-20 h-15 bg-gray-200 rounded-md overflow-hidden flex-shrink-0"
                style="background-image: url({backgroundConfigStore.getCurrentBackgroundStyle().replace('url(', '').replace(')', '')}); background-size: cover; background-position: center;"
              ></div>
              <div class="flex flex-col gap-1 text-xs text-gray-600">
                <div>ID: {currentConfig.wallpaper.imageId}</div>
                <div>Fit: {currentConfig.wallpaper.fit}</div>
                <div>Position: {currentConfig.wallpaper.position}</div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {:else if activeTab === 'gradient'}
      <!-- Gradient background selector -->
      <div class="space-y-4">
        <!-- Gradient statistics -->
        <div class="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-purple-700">Gradient Library</span>
              <span class="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                {PRESET_GRADIENTS.length} total
              </span>
            </div>
            <div class="text-xs text-purple-600">
              {gradientCategories.length} categories
            </div>
          </div>
        </div>

        <!-- Preset gradient categories -->
        {#each gradientCategories as category}
          {#if category.gradients.length > 0}
            <div class="space-y-3">
              <h4 class="text-sm font-medium text-gray-700 m-0 flex items-center gap-2">
                <span class="text-base">{category.icon}</span>
                {category.name}
                <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {category.gradients.length} colors
                </span>
              </h4>
              {#if category.description}
                <p class="text-xs text-gray-500 m-0">{category.description}</p>
              {/if}
              <!-- 8 colors using 4x2 grid layout -->
              <div class="grid grid-cols-4 gap-2 mb-4">
                {#each category.gradients as preset}
                  <div class="relative group">
                    <button
                      class="w-full h-12 rounded-md border-3 cursor-pointer transition-all duration-200 overflow-hidden {isPresetGradientSelected(preset) ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' : 'border-gray-300 hover:border-gray-400 hover:scale-105'}"
                      style="background: {preset.preview || 'linear-gradient(45deg, #f3f4f6, #e5e7eb)'}"
                      title="{preset.name} - {preset.description || ''}"
                      onclick={() => handlePresetGradientSelect(preset)}
                      onkeydown={(e) => handleColorKeydown(e, () => handlePresetGradientSelect(preset))}
                      type="button"
                      aria-label="{preset.name} gradient, {preset.description || ''}"
                      tabindex="0"
                    >
                    </button>
                    <!-- Show gradient name on hover - moved to top to avoid being covered -->
                    <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-20">
                      {preset.name}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- Current gradient preview -->
        <div class="mt-4 p-3 bg-gray-50 rounded-lg border">
          <h4 class="text-sm font-medium text-gray-700 mb-2 m-0">Current gradient</h4>
          <div class="flex gap-3">
            <div
              class="w-20 h-12 rounded-md border border-gray-300 flex-shrink-0"
              style="background: {getCurrentGradientPreview()}"
            ></div>
            <div class="flex flex-col gap-1 text-xs text-gray-600">
              {#if currentType === 'gradient' && currentConfig.gradient}
                <div>
                  Type: {currentConfig.gradient.type === 'linear' ? 'Linear' :
                         currentConfig.gradient.type === 'radial' ? 'Radial' : 'Conic'} Gradient
                </div>
                <div>
                  Colors: {currentConfig.gradient.stops.length}
                </div>
              {:else}
                <div class="text-gray-500">Please select a gradient effect</div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Gradient parameter adjustment (future extension) -->
        <div class="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <h4 class="text-sm font-medium text-blue-700 mb-2 m-0">Parameter Adjustment</h4>
          <div class="text-center py-4">
            <p class="text-sm text-blue-600 mb-1">🎛️ Advanced parameter adjustment features</p>
            <p class="text-xs text-blue-500">Coming soon: support for custom gradient angles, positions and color stops</p>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Current selection status display -->
  <div class="mt-4 p-3 bg-gray-50 rounded-lg border flex items-center gap-3">
    <span class="text-sm font-medium text-gray-700">Current setting:</span>
    <div class="flex items-center gap-2">
      {#if currentType === 'solid-color'}
        <div class="w-6 h-6 rounded border border-gray-300" style="background-color: {currentColor}"></div>
        <span class="text-sm text-gray-600">
          {PRESET_COLORS.find(p => p.color === currentColor)?.name || currentColor}
        </span>
      {:else if currentType === 'gradient'}
        <div
          class="w-6 h-6 rounded border border-gray-300"
          style="background: {getCurrentGradientPreview()}"
        ></div>
        <span class="text-sm text-gray-600">
          {#if currentConfig.gradient}
            {currentConfig.gradient.type === 'linear' ? 'Linear' :
             currentConfig.gradient.type === 'radial' ? 'Radial' : 'Conic'} Gradient
          {:else}
            Gradient Background
          {/if}
        </span>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Tab container with horizontal scroll support */
  .tab-container {
    position: relative;
    width: 100%;
  }

  .tab-wrapper {
    display: flex;
    background-color: #f3f4f6; /* bg-gray-100 */
    border-radius: 0.375rem; /* rounded-md */
    padding: 0.125rem; /* p-0.5 */
    gap: 0.125rem; /* gap-0.5 */
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
    scroll-behavior: smooth;
    /* Add padding to prevent content from being cut off */
    padding-right: 0.5rem;
  }

  /* Hide scrollbar for WebKit browsers */
  .tab-wrapper::-webkit-scrollbar {
    display: none;
  }

  /* Tab button styles */
  .tab-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem; /* gap-1.5 */
    padding: 0.5rem 0.75rem; /* px-3 py-2 */
    border: none;
    border-radius: 0.25rem; /* rounded */
    color: #4b5563; /* text-gray-600 */
    font-size: 0.75rem; /* text-xs */
    font-weight: 500; /* font-medium */
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: fit-content;
  }

  .tab-active {
    background-color: white;
    color: #2563eb; /* text-blue-600 */
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); /* shadow-sm */
  }

  .tab-inactive {
    background-color: transparent;
  }

  .tab-inactive:hover {
    background-color: #e5e7eb; /* hover:bg-gray-200 */
    color: #374151; /* hover:text-gray-700 */
  }

  /* Responsive adjustments */
  @media (max-width: 640px) {
    .tab-button {
      padding: 0.375rem 0.5rem; /* Smaller padding on mobile */
      font-size: 0.6875rem; /* Smaller text on mobile */
    }
    
    .tab-button span {
      display: none; /* Hide text labels on very small screens, show only icons */
    }
  }

  @media (max-width: 480px) {
    .tab-button {
      padding: 0.25rem 0.375rem;
      min-width: 2.5rem;
    }
  }

  /* Add subtle scroll indicators */
  .tab-container::before,
  .tab-container::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1rem;
    pointer-events: none;
    z-index: 1;
    transition: opacity 0.2s ease-in-out;
  }

  .tab-container::before {
    left: 0;
    background: linear-gradient(to right, #f3f4f6, transparent);
    border-radius: 0.375rem 0 0 0.375rem;
  }

  .tab-container::after {
    right: 0;
    background: linear-gradient(to left, #f3f4f6, transparent);
    border-radius: 0 0.375rem 0.375rem 0;
  }

  /* Show scroll indicators only when content overflows */
  .tab-wrapper:not(:hover)::before,
  .tab-wrapper:not(:hover)::after {
    opacity: 0.7;
  }
</style>
