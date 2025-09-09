<!-- 背景色选择器 - 支持纯色和渐变色切换 -->
<script lang="ts">
  import { Palette, Layers, Image, Mountain, Upload, Check, CircleAlert } from '@lucide/svelte'
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

  // 背景类型选项
  type BackgroundType = BackgroundConfig['type']

  // 当前选中的背景类型和颜色 (使用 Svelte 5 $derived)
  const currentConfig = $derived(backgroundConfigStore.config)
  const currentType = $derived(currentConfig.type)
  const currentColor = $derived(currentConfig.color)

  // 当前激活的Tab
  let activeTab = $state<BackgroundType>('solid-color')

  // Wallpaper相关状态
  let selectedWallpaper = $state<string>('')

  // 图片上传相关状态
  let fileInput = $state<HTMLInputElement>()
  let isUploading = $state(false)
  let uploadError = $state<string>('')

  // 初始化时同步当前配置的类型和选择状态
  $effect(() => {
    activeTab = currentType

    // 根据当前配置设置选择状态
    if (currentType === 'wallpaper') {
      // 如果当前是壁纸类型，设置选中的壁纸ID
      if (currentConfig.wallpaper) {
        selectedWallpaper = currentConfig.wallpaper.imageId
      }
      // 如果当前没有壁纸但有保存的壁纸配置，也设置选择状态
      else if (backgroundConfigStore.lastWallpaperConfig) {
        selectedWallpaper = backgroundConfigStore.lastWallpaperConfig.imageId
      }
    }
  })

  // Tab选项配置
  const tabOptions = [
    { value: 'solid-color' as const, label: '纯色', icon: Palette },
    { value: 'gradient' as const, label: '渐变色', icon: Layers },
    { value: 'image' as const, label: '图片', icon: Image },
    { value: 'wallpaper' as const, label: '壁纸', icon: Mountain }
  ] as const

  // 切换Tab
  function switchTab(type: BackgroundType) {
    activeTab = type

    // 如果切换到不同类型，尝试恢复之前保存的配置
    if (type !== currentType) {
      let restored = false

      if (type === 'solid-color') {
        // 切换到纯色，使用当前颜色
        backgroundConfigStore.updateBackgroundType('solid-color')
        restored = true
      } else if (type === 'gradient') {
        // 切换到渐变，尝试恢复之前的渐变配置
        restored = backgroundConfigStore.restoreGradientBackground()
        if (!restored) {
          backgroundConfigStore.updateBackgroundType('gradient')
        }
      } else if (type === 'image') {
        // 切换到图片，尝试恢复之前的图片配置
        restored = backgroundConfigStore.restoreImageBackground()
        if (!restored) {
          backgroundConfigStore.updateBackgroundType('image')
        }
      } else if (type === 'wallpaper') {
        // 切换到壁纸，尝试恢复之前的壁纸配置
        restored = backgroundConfigStore.restoreWallpaperBackground()
        if (!restored) {
          backgroundConfigStore.updateBackgroundType('wallpaper')
        }
      }

      console.log(`🔄 [BackgroundPicker] Switched to ${type}, restored: ${restored}`)
    }
  }

  // 选择壁纸
  async function selectWallpaper(wallpaper: ImagePreset) {
    try {
      selectedWallpaper = wallpaper.id

      // 使用专门的壁纸处理方法
      await backgroundConfigStore.handleWallpaperSelection(wallpaper)

      console.log('🌄 [BackgroundPicker] Wallpaper selected:', wallpaper.name)
    } catch (error) {
      console.error('❌ [BackgroundPicker] Failed to load wallpaper:', error)
      uploadError = '壁纸加载失败，请重试'
      setTimeout(() => { uploadError = '' }, 3000)
    }
  }

  // 颜色分类
  const colorCategories = [
    { key: 'basic', name: '基础色', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'basic') },
    { key: 'light', name: '浅色系', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'light') },
    { key: 'dark', name: '深色系', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'dark') },
    { key: 'business', name: '商务色', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'business') },
    { key: 'creative', name: '创意色', colors: PRESET_SOLID_COLORS.filter(c => c.category === 'creative') }
  ]

  // 自定义颜色输入值
  let customColorValue = $state('')

  // 同步自定义颜色输入值
  $effect(() => {
    if (currentType === 'solid-color') {
      customColorValue = currentColor
    }
  })

  // 处理预设纯色选择
  function handlePresetSolidColorSelect(preset: SolidColorPreset) {
    console.log('🎨 [BackgroundColorPicker] Preset solid color selected:', preset)
    backgroundConfigStore.applyPresetSolidColor(preset)
  }

  // 检查预设纯色是否被选中
  function isPresetSolidColorSelected(preset: SolidColorPreset) {
    return currentType === 'solid-color' && currentColor === preset.color
  }

  // 处理HTML5颜色选择器变化
  function handleColorPickerChange(event: Event) {
    const target = event.target as HTMLInputElement
    const color = target.value
    console.log('🎨 [BackgroundColorPicker] Color picker changed:', color)
    customColorValue = color
    backgroundConfigStore.updateColor(color)
  }

  // 处理文本输入颜色变化
  function handleColorTextInput(event: Event) {
    const target = event.target as HTMLInputElement
    const color = target.value.trim()

    // 验证颜色格式
    if (isValidColor(color)) {
      console.log('🎨 [BackgroundColorPicker] Color text input:', color)
      backgroundConfigStore.updateColor(color)
    }
  }

  // 验证颜色格式
  function isValidColor(color: string): boolean {
    // 简单的颜色格式验证
    const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
    const rgbPattern = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/
    const rgbaPattern = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/

    return hexPattern.test(color) || rgbPattern.test(color) || rgbaPattern.test(color)
  }

  // 处理文本输入的键盘事件
  function handleColorTextKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      const target = event.target as HTMLInputElement
      handleColorTextInput(event)
      target.blur() // 失去焦点
    }
  }

  // === 渐变色相关功能 ===

  // 渐变分类
  const gradientCategories = [
    {
      key: 'linear',
      name: '线性渐变',
      gradients: PRESET_GRADIENTS.filter(g => g.config.type === 'linear')
    },
    {
      key: 'radial',
      name: '径向渐变',
      gradients: PRESET_GRADIENTS.filter(g => g.config.type === 'radial')
    },
    {
      key: 'conic',
      name: '圆锥渐变',
      gradients: PRESET_GRADIENTS.filter(g => g.config.type === 'conic')
    }
  ]

  // 处理预设渐变选择
  function handlePresetGradientSelect(preset: GradientPreset) {
    console.log('🌈 [BackgroundColorPicker] Preset gradient selected:', preset)
    backgroundConfigStore.applyPresetGradient(preset)
  }

  // 检查预设渐变是否被选中
  function isPresetGradientSelected(preset: GradientPreset) {
    if (currentType !== 'gradient' || !currentConfig.gradient) return false

    const current = currentConfig.gradient
    const target = preset.config

    // 比较渐变配置是否相同
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

  // 获取当前渐变的CSS预览
  function getCurrentGradientPreview(): string {
    if (currentType === 'gradient' && currentConfig.gradient) {
      return backgroundConfigStore.generateGradientCSS(currentConfig.gradient)
    }
    return 'linear-gradient(45deg, #f3f4f6, #e5e7eb)'
  }

  // 处理图片上传
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
      uploadError = error instanceof Error ? error.message : '图片上传失败'
    } finally {
      isUploading = false
      // 清空input以允许重复选择同一文件
      if (input) input.value = ''
    }
  }

  // 处理拖拽上传
  function handleDrop(event: DragEvent) {
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      const file = files[0]
      if (file.type.startsWith('image/')) {
        // 模拟input change事件
        handleImageUpload({ target: { files: [file] } } as any)
      } else {
        uploadError = '请选择图片文件'
      }
    }
  }

  // 处理拖拽悬停
  function handleDragOver(event: DragEvent) {
    event.preventDefault()
  }

  // 触发文件选择
  function triggerFileSelect() {
    fileInput?.click()
  }

  // 处理键盘事件
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      triggerFileSelect()
    }
  }

  // === 用户体验增强功能 ===

  // 键盘导航支持
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

  // 颜色选项键盘导航
  function handleColorKeydown(event: KeyboardEvent, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }

  // 复制颜色值到剪贴板
  async function copyColorToClipboard(color: string) {
    try {
      await navigator.clipboard.writeText(color)
      console.log('🎨 [BackgroundColorPicker] Color copied to clipboard:', color)
      // 这里可以添加一个临时的成功提示
    } catch (error) {
      console.warn('🎨 [BackgroundColorPicker] Failed to copy color:', error)
    }
  }


</script>

<!-- 背景色选择器 - 两行布局 -->
<div class="p-4 border border-gray-200 rounded-lg bg-white flex flex-col gap-4">
  <!-- 第一行：Tab切换器 -->
  <div class="flex flex-col gap-3">
    <h3 class="text-sm font-semibold text-gray-700 m-0">背景设置</h3>
    <div class="flex bg-gray-100 rounded-md p-0.5 gap-0.5" role="tablist" aria-label="背景类型选择">
      {#each tabOptions as tab}
        <button
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border-none rounded text-gray-600 text-xs font-medium cursor-pointer transition-all duration-200 {activeTab === tab.value ? 'bg-white text-blue-600 shadow-sm' : 'bg-transparent hover:bg-gray-200 hover:text-gray-700'}"
          onclick={() => switchTab(tab.value)}
          onkeydown={handleTabKeydown}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.value}
          aria-controls="content-area"
          tabindex={activeTab === tab.value ? 0 : -1}
        >
          <tab.icon class="w-3.5 h-3.5" aria-hidden="true" />
          <span class="font-medium">{tab.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- 第二行：内容区域 -->
  <div
    class="min-h-0"
    id="content-area"
    role="tabpanel"
    aria-labelledby="tab-{activeTab}"
  >
    {#if activeTab === 'solid-color'}
      <!-- 纯色选择器 -->
      <div class="space-y-4">
        <!-- 预设颜色分类 -->
        {#each colorCategories as category}
          {#if category.colors.length > 0}
            <div class="space-y-2">
              <h4 class="text-sm font-medium text-gray-700 m-0">{category.name}</h4>
              <div class="grid grid-cols-8 gap-2">
                {#each category.colors as preset}
                  <button
                    class="w-8 h-8 rounded-md border-2 cursor-pointer transition-all duration-200 relative {isPresetSolidColorSelected(preset) ? 'border-blue-500 border-3 shadow-md' : 'border-gray-300 hover:border-gray-400'}"
                    style="background-color: {preset.color}"
                    title="{preset.name} - 双击复制颜色值"
                    onclick={() => handlePresetSolidColorSelect(preset)}
                    ondblclick={() => copyColorToClipboard(preset.color)}
                    onkeydown={(e) => handleColorKeydown(e, () => handlePresetSolidColorSelect(preset))}
                    type="button"
                    aria-label="{preset.name}，颜色值：{preset.color}"
                    tabindex="0"
                  >
                    {#if isPresetSolidColorSelected(preset)}
                      <div class="absolute top-0.5 right-0.5 bg-blue-500 text-white w-4 h-4 rounded-full flex items-center justify-center text-xs" aria-hidden="true">
                        <Check class="w-2.5 h-2.5" />
                      </div>
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- 自定义颜色选择器 -->
        <div class="space-y-3">
          <h4 class="text-sm font-medium text-gray-700 m-0">自定义颜色</h4>
          <div class="flex gap-3">
            <!-- HTML5颜色选择器 -->
            <div class="flex flex-col gap-1">
              <label class="text-xs text-gray-600" for="color-picker-input">颜色选择器</label>
              <input
                id="color-picker-input"
                type="color"
                class="w-12 h-8 border border-gray-300 rounded cursor-pointer"
                value={customColorValue}
                onchange={handleColorPickerChange}
              />
            </div>

            <!-- 颜色值输入 -->
            <div class="flex flex-col gap-1 flex-1">
              <label class="text-xs text-gray-600" for="color-text-input">颜色值</label>
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

          <!-- 颜色预览 -->
          <div class="flex items-center gap-2">
            <div class="text-xs text-gray-600">预览</div>
            <div
              class="w-8 h-6 border border-gray-300 rounded"
              style="background-color: {customColorValue}"
            ></div>
          </div>
        </div>
      </div>
    {:else if activeTab === 'image'}
      <!-- 图片背景选择器 -->
      <div class="space-y-4">
        <!-- 隐藏的文件输入 -->
        <input
          type="file"
          accept="image/*"
          bind:this={fileInput}
          onchange={handleImageUpload}
          class="hidden"
        />

        <!-- 上传区域 -->
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
                <span class="text-sm text-blue-600">正在处理图片...</span>
              </div>
            {:else}
              <div class="flex flex-col items-center gap-3">
                <Upload class="w-8 h-8 text-gray-400" />
                <div class="space-y-1">
                  <div class="text-sm font-medium text-gray-700">点击选择图片</div>
                  <div class="text-xs text-gray-500">或拖拽图片到此处</div>
                </div>
                <div class="text-xs text-gray-400">支持 JPEG、PNG、WebP、GIF 格式，最大 5MB</div>
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

        <!-- 当前用户上传图片预览 -->
        {#if activeTab === 'image' && currentType === 'image' && currentConfig.image}
          <div class="space-y-3">
            <h4 class="text-sm font-medium text-gray-700 m-0">当前图片</h4>
            <div class="flex gap-3">
              <div
                class="w-16 h-16 border border-gray-300 rounded-lg bg-cover bg-center flex-shrink-0"
                style="background-image: url({backgroundConfigStore.getCurrentBackgroundStyle().replace('url(', '').replace(')', '')});"
              ></div>
              <div class="flex flex-col gap-1 text-xs text-gray-600">
                <div>ID: {currentConfig.image.imageId}</div>
                <div>适应: {currentConfig.image.fit}</div>
                <div>位置: {currentConfig.image.position}</div>
                {#if currentConfig.image.opacity !== undefined && currentConfig.image.opacity < 1}
                  <div>透明度: {Math.round(currentConfig.image.opacity * 100)}%</div>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </div>
    {:else if activeTab === 'wallpaper'}
      <!-- 壁纸背景选择器 -->
      <div class="space-y-4">
        <!-- 壁纸分类 -->
        {#each Object.entries(WALLPAPER_CATEGORIES) as [, category]}
          {#if category.wallpapers.length > 0}
            <div class="space-y-2">
              <h4 class="text-sm font-medium text-gray-700 m-0 flex items-center gap-1.5">
                <span class="text-base">{category.icon}</span>
                {category.name}
              </h4>
              <div class="grid grid-cols-2 gap-3">
                {#each category.wallpapers as wallpaper}
                  <button
                    class="relative group border-2 rounded-lg overflow-hidden cursor-pointer transition-all duration-200 {selectedWallpaper === wallpaper.id ? 'border-blue-500 shadow-md' : 'border-gray-300 hover:border-gray-400'}"
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
                    {#if selectedWallpaper === wallpaper.id}
                      <div class="absolute top-1 right-1 bg-blue-500 text-white w-5 h-5 rounded-full flex items-center justify-center">
                        <Check class="w-3 h-3" />
                      </div>
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- 当前壁纸预览 -->
        {#if activeTab === 'wallpaper' && currentType === 'wallpaper' && currentConfig.wallpaper}
          <div class="mt-4 p-3 bg-gray-50 rounded-lg border">
            <h4 class="text-sm font-medium text-gray-700 mb-2 m-0">当前壁纸</h4>
            <div class="flex gap-3">
              <div
                class="w-20 h-15 bg-gray-200 rounded-md overflow-hidden flex-shrink-0"
                style="background-image: url({backgroundConfigStore.getCurrentBackgroundStyle().replace('url(', '').replace(')', '')}); background-size: cover; background-position: center;"
              ></div>
              <div class="flex flex-col gap-1 text-xs text-gray-600">
                <div>ID: {currentConfig.wallpaper.imageId}</div>
                <div>适应: {currentConfig.wallpaper.fit}</div>
                <div>位置: {currentConfig.wallpaper.position}</div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {:else if activeTab === 'gradient'}
      <!-- 渐变色选择器 -->
      <div class="space-y-4">
        <!-- 预设渐变分类 -->
        {#each gradientCategories as category}
          {#if category.gradients.length > 0}
            <div class="space-y-2">
              <h4 class="text-sm font-medium text-gray-700 m-0">{category.name}</h4>
              <div class="grid grid-cols-4 gap-2">
                {#each category.gradients as preset}
                  <button
                    class="relative h-12 rounded-md border-2 cursor-pointer transition-all duration-200 overflow-hidden {isPresetGradientSelected(preset) ? 'border-blue-500 shadow-md' : 'border-gray-300 hover:border-gray-400'}"
                    style="background: {preset.preview || 'linear-gradient(45deg, #f3f4f6, #e5e7eb)'}"
                    title="{preset.name} - {preset.description || ''}"
                    onclick={() => handlePresetGradientSelect(preset)}
                    onkeydown={(e) => handleColorKeydown(e, () => handlePresetGradientSelect(preset))}
                    type="button"
                    aria-label="{preset.name}渐变，{preset.description || ''}"
                    tabindex="0"
                  >
                    {#if isPresetGradientSelected(preset)}
                      <div class="absolute top-1 right-1 bg-blue-500 text-white w-4 h-4 rounded-full flex items-center justify-center" aria-hidden="true">
                        <Check class="w-2.5 h-2.5" />
                      </div>
                    {/if}
                    <div class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs px-1 py-0.5 truncate">
                      {preset.name}
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- 当前渐变预览 -->
        <div class="mt-4 p-3 bg-gray-50 rounded-lg border">
          <h4 class="text-sm font-medium text-gray-700 mb-2 m-0">当前渐变</h4>
          <div class="flex gap-3">
            <div
              class="w-20 h-12 rounded-md border border-gray-300 flex-shrink-0"
              style="background: {getCurrentGradientPreview()}"
            ></div>
            <div class="flex flex-col gap-1 text-xs text-gray-600">
              {#if currentType === 'gradient' && currentConfig.gradient}
                <div>
                  类型: {currentConfig.gradient.type === 'linear' ? '线性' :
                        currentConfig.gradient.type === 'radial' ? '径向' : '圆锥'}渐变
                </div>
                <div>
                  颜色数: {currentConfig.gradient.stops.length}
                </div>
              {:else}
                <div class="text-gray-500">请选择一个渐变效果</div>
              {/if}
            </div>
          </div>
        </div>

        <!-- 渐变参数调整 (未来扩展) -->
        <div class="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <h4 class="text-sm font-medium text-blue-700 mb-2 m-0">参数调整</h4>
          <div class="text-center py-4">
            <p class="text-sm text-blue-600 mb-1">🎛️ 高级参数调整功能</p>
            <p class="text-xs text-blue-500">即将支持自定义渐变角度、位置和颜色停止点</p>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- 当前选择状态显示 -->
  <div class="mt-4 p-3 bg-gray-50 rounded-lg border flex items-center gap-3">
    <span class="text-sm font-medium text-gray-700">当前设置:</span>
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
            {currentConfig.gradient.type === 'linear' ? '线性' :
             currentConfig.gradient.type === 'radial' ? '径向' : '圆锥'}渐变
          {:else}
            渐变背景
          {/if}
        </span>
      {/if}
    </div>
  </div>
</div>
