<!-- 背景色选择器 - 支持纯色和渐变色切换 -->
<script lang="ts">
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
    GradientConfig,
    ImagePreset
  } from '$lib/types/background'
  import { WALLPAPER_PRESETS, WALLPAPER_CATEGORIES } from '$lib/data/wallpaper-presets'

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
    { value: 'solid-color' as const, label: '纯色', icon: '🎨' },
    { value: 'gradient' as const, label: '渐变色', icon: '🌈' },
    { value: 'image' as const, label: '图片', icon: '🖼️' },
    { value: 'wallpaper' as const, label: '壁纸', icon: '🌄' }
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

  // 获取颜色的可读性信息
  function getColorAccessibility(color: string): { contrast: 'high' | 'medium' | 'low', readable: boolean } {
    // 简单的颜色亮度计算
    const hex = color.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)

    // 计算相对亮度
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

    return {
      contrast: luminance > 0.7 ? 'high' : luminance > 0.4 ? 'medium' : 'low',
      readable: luminance > 0.5 || luminance < 0.3
    }
  }
</script>

<!-- 背景色选择器 - 两行布局 -->
<div class="background-color-picker">
  <!-- 第一行：Tab切换器 -->
  <div class="tab-header">
    <h3 class="picker-title">背景设置</h3>
    <div class="tab-switcher" role="tablist" aria-label="背景类型选择">
      {#each tabOptions as tab}
        <button
          class="tab-button"
          class:active={activeTab === tab.value}
          onclick={() => switchTab(tab.value)}
          onkeydown={handleTabKeydown}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.value}
          aria-controls="content-area"
          tabindex={activeTab === tab.value ? 0 : -1}
        >
          <span class="tab-icon" aria-hidden="true">{tab.icon}</span>
          <span class="tab-label">{tab.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- 第二行：内容区域 -->
  <div
    class="content-area"
    id="content-area"
    role="tabpanel"
    aria-labelledby="tab-{activeTab}"
  >
    {#if activeTab === 'solid-color'}
      <!-- 纯色选择器 -->
      <div class="solid-color-section">
        <!-- 预设颜色分类 -->
        {#each colorCategories as category}
          {#if category.colors.length > 0}
            <div class="color-category">
              <h4 class="category-title">{category.name}</h4>
              <div class="color-grid">
                {#each category.colors as preset}
                  <button
                    class="color-option"
                    class:selected={isPresetSolidColorSelected(preset)}
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
                      <div class="selected-indicator" aria-hidden="true">✓</div>
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- 自定义颜色选择器 -->
        <div class="custom-color-section">
          <h4 class="category-title">自定义颜色</h4>
          <div class="custom-color-controls">
            <!-- HTML5颜色选择器 -->
            <div class="color-picker-group">
              <label class="color-picker-label" for="color-picker-input">颜色选择器</label>
              <input
                id="color-picker-input"
                type="color"
                class="color-picker"
                value={customColorValue}
                onchange={handleColorPickerChange}
              />
            </div>

            <!-- 颜色值输入 -->
            <div class="color-input-group">
              <label class="color-input-label" for="color-text-input">颜色值</label>
              <input
                id="color-text-input"
                type="text"
                class="color-text-input"
                bind:value={customColorValue}
                placeholder="#ffffff"
                onchange={handleColorTextInput}
                onkeydown={handleColorTextKeydown}
              />
            </div>
          </div>

          <!-- 颜色预览 -->
          <div class="color-preview-section">
            <div class="color-preview-label">预览</div>
            <div
              class="color-preview-box"
              style="background-color: {customColorValue}"
            ></div>
          </div>
        </div>
      </div>
    {:else if activeTab === 'image'}
      <!-- 图片背景选择器 -->
      <div class="image-section">
        <!-- 隐藏的文件输入 -->
        <input
          type="file"
          accept="image/*"
          bind:this={fileInput}
          onchange={handleImageUpload}
          style="display: none;"
        />

        <!-- 上传区域 -->
        <div class="image-upload-area">
          <div
            class="drop-zone"
            class:uploading={isUploading}
            onclick={triggerFileSelect}
            ondrop={handleDrop}
            ondragover={handleDragOver}
            onkeydown={handleKeydown}
            role="button"
            tabindex="0"
          >
            {#if isUploading}
              <div class="upload-loading">
                <div class="spinner"></div>
                <span>正在处理图片...</span>
              </div>
            {:else}
              <div class="upload-content">
                <div class="upload-icon">🖼️</div>
                <div class="upload-text">
                  <div class="upload-primary">点击选择图片</div>
                  <div class="upload-secondary">或拖拽图片到此处</div>
                </div>
                <div class="upload-hint">支持 JPEG、PNG、WebP、GIF 格式，最大 5MB</div>
              </div>
            {/if}
          </div>

          {#if uploadError}
            <div class="upload-error">
              ⚠️ {uploadError}
            </div>
          {/if}
        </div>

        <!-- 当前用户上传图片预览 -->
        {#if activeTab === 'image' && currentType === 'image' && currentConfig.image}
          <div class="current-image-section">
            <h4 class="category-title">当前图片</h4>
            <div class="current-image-preview">
              <div
                class="image-preview-large"
                style="background-image: url({backgroundConfigStore.getCurrentBackgroundStyle().replace('url(', '').replace(')', '')}); background-size: cover; background-position: center;"
              ></div>
              <div class="image-info">
                <div class="image-id">ID: {currentConfig.image.imageId}</div>
                <div class="image-fit">适应: {currentConfig.image.fit}</div>
                <div class="image-position">位置: {currentConfig.image.position}</div>
                {#if currentConfig.image.opacity !== undefined && currentConfig.image.opacity < 1}
                  <div class="image-opacity">透明度: {Math.round(currentConfig.image.opacity * 100)}%</div>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </div>
    {:else if activeTab === 'wallpaper'}
      <!-- 壁纸背景选择器 -->
      <div class="wallpaper-section">
        <!-- 壁纸分类 -->
        {#each Object.entries(WALLPAPER_CATEGORIES) as [categoryKey, category]}
          {#if category.wallpapers.length > 0}
            <div class="wallpaper-category">
              <h4 class="category-title">
                <span class="category-icon">{category.icon}</span>
                {category.name}
              </h4>
              <div class="wallpaper-grid">
                {#each category.wallpapers as wallpaper}
                  <button
                    class="wallpaper-item"
                    class:selected={selectedWallpaper === wallpaper.id}
                    onclick={() => selectWallpaper(wallpaper)}
                    type="button"
                    title={wallpaper.description}
                  >
                    <div class="wallpaper-preview">
                      <img
                        src={wallpaper.imageUrl}
                        alt={wallpaper.name}
                        loading="lazy"
                      />
                    </div>
                    <div class="wallpaper-info">
                      <div class="wallpaper-name">{wallpaper.name}</div>
                      {#if wallpaper.tags && wallpaper.tags.length > 0}
                        <div class="wallpaper-tags">
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

        <!-- 当前壁纸预览 -->
        {#if activeTab === 'wallpaper' && currentType === 'wallpaper' && currentConfig.wallpaper}
          <div class="current-wallpaper-section">
            <h4 class="category-title">当前壁纸</h4>
            <div class="current-wallpaper-preview">
              <div
                class="wallpaper-preview-large"
                style="background-image: url({backgroundConfigStore.getCurrentBackgroundStyle().replace('url(', '').replace(')', '')}); background-size: cover; background-position: center;"
              ></div>
              <div class="wallpaper-info">
                <div class="wallpaper-id">ID: {currentConfig.wallpaper.imageId}</div>
                <div class="wallpaper-fit">适应: {currentConfig.wallpaper.fit}</div>
                <div class="wallpaper-position">位置: {currentConfig.wallpaper.position}</div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {:else if activeTab === 'gradient'}
      <!-- 渐变色选择器 -->
      <div class="gradient-section">
        <!-- 预设渐变分类 -->
        {#each gradientCategories as category}
          {#if category.gradients.length > 0}
            <div class="gradient-category">
              <h4 class="category-title">{category.name}</h4>
              <div class="gradient-grid">
                {#each category.gradients as preset}
                  <button
                    class="gradient-option"
                    class:selected={isPresetGradientSelected(preset)}
                    style="background: {preset.preview || 'linear-gradient(45deg, #f3f4f6, #e5e7eb)'}"
                    title="{preset.name} - {preset.description || ''}"
                    onclick={() => handlePresetGradientSelect(preset)}
                    onkeydown={(e) => handleColorKeydown(e, () => handlePresetGradientSelect(preset))}
                    type="button"
                    aria-label="{preset.name}渐变，{preset.description || ''}"
                    tabindex="0"
                  >
                    {#if isPresetGradientSelected(preset)}
                      <div class="selected-indicator" aria-hidden="true">✓</div>
                    {/if}
                    <div class="gradient-name">{preset.name}</div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <!-- 当前渐变预览 -->
        <div class="current-gradient-section">
          <h4 class="category-title">当前渐变</h4>
          <div class="current-gradient-preview">
            <div
              class="gradient-preview-large"
              style="background: {getCurrentGradientPreview()}"
            ></div>
            <div class="gradient-info">
              {#if currentType === 'gradient' && currentConfig.gradient}
                <div class="gradient-type">
                  类型: {currentConfig.gradient.type === 'linear' ? '线性' :
                        currentConfig.gradient.type === 'radial' ? '径向' : '圆锥'}渐变
                </div>
                <div class="gradient-stops">
                  颜色数: {currentConfig.gradient.stops.length}
                </div>
              {:else}
                <div class="gradient-placeholder-text">请选择一个渐变效果</div>
              {/if}
            </div>
          </div>
        </div>

        <!-- 渐变参数调整 (未来扩展) -->
        <div class="gradient-controls-section">
          <h4 class="category-title">参数调整</h4>
          <div class="gradient-controls-placeholder">
            <p class="controls-placeholder-text">🎛️ 高级参数调整功能</p>
            <p class="controls-placeholder-desc">即将支持自定义渐变角度、位置和颜色停止点</p>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- 当前选择状态显示 -->
  <div class="current-selection">
    <span class="current-label">当前设置:</span>
    <div class="current-preview">
      {#if currentType === 'solid-color'}
        <div class="current-color" style="background-color: {currentColor}"></div>
        <span class="current-name">
          {PRESET_COLORS.find(p => p.color === currentColor)?.name || currentColor}
        </span>
      {:else if currentType === 'gradient'}
        <div
          class="current-gradient"
          style="background: {getCurrentGradientPreview()}"
        ></div>
        <span class="current-name">
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

<style>
  /* 主容器 */
  .background-color-picker {
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* 第一行：Tab头部 */
  .tab-header {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .picker-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  /* Tab切换器 */
  .tab-switcher {
    display: flex;
    background: #f3f4f6;
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }

  .tab-button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #6b7280;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .tab-button:hover {
    background: #e5e7eb;
    color: #374151;
  }

  .tab-button.active {
    background: white;
    color: #3b82f6;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .tab-icon {
    font-size: 14px;
  }

  .tab-label {
    font-weight: 500;
  }

  /* 第二行：内容区域 */
  .content-area {
    min-height: 200px;
  }

  /* 纯色选择器部分 */
  .solid-color-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* 颜色分类 */
  .color-category {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .category-title {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
  }

  .color-option {
    width: 40px;
    height: 40px;
    border: 2px solid #e5e7eb;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
  }

  .color-option:hover {
    border-color: #3b82f6;
    transform: scale(1.05);
  }

  .color-option.selected {
    border-color: #3b82f6;
    border-width: 3px;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .selected-indicator {
    color: white;
    font-weight: bold;
    font-size: 14px;
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
  }

  /* 自定义颜色选择器 */
  .custom-color-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
  }

  .custom-color-controls {
    display: flex;
    gap: 16px;
    align-items: flex-end;
  }

  .color-picker-group,
  .color-input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .color-picker-label,
  .color-input-label {
    font-size: 11px;
    font-weight: 500;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .color-picker {
    width: 40px;
    height: 40px;
    border: 2px solid #e5e7eb;
    border-radius: 6px;
    cursor: pointer;
    background: none;
    padding: 0;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
    border: none;
    border-radius: 4px;
  }

  .color-picker::-webkit-color-swatch {
    border: none;
    border-radius: 4px;
  }

  .color-text-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 13px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    background: white;
    transition: border-color 0.2s ease;
  }

  .color-text-input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }

  /* 颜色预览 */
  .color-preview-section {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }

  .color-preview-label {
    font-size: 11px;
    font-weight: 500;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    min-width: 40px;
  }

  .color-preview-box {
    width: 60px;
    height: 32px;
    border: 2px solid #e5e7eb;
    border-radius: 6px;
    transition: border-color 0.2s ease;
  }

  .color-preview-box:hover {
    border-color: #3b82f6;
  }

  /* 渐变色部分 */
  .gradient-section {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 200px;
  }

  /* 渐变分类 */
  .gradient-category {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .gradient-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }

  .gradient-option {
    position: relative;
    height: 80px;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding: 8px;
    background: none;
    overflow: hidden;
  }

  .gradient-option:hover {
    border-color: #3b82f6;
    transform: scale(1.02);
  }

  .gradient-option.selected {
    border-color: #3b82f6;
    border-width: 3px;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .gradient-name {
    background: rgba(255, 255, 255, 0.9);
    color: #374151;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
    backdrop-filter: blur(4px);
    text-align: center;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gradient-option .selected-indicator {
    position: absolute;
    top: 6px;
    right: 6px;
    background: rgba(59, 130, 246, 0.9);
    color: white;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: bold;
  }

  /* 当前渐变预览 */
  .current-gradient-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
  }

  .current-gradient-preview {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .gradient-preview-large {
    width: 120px;
    height: 60px;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .gradient-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .gradient-type,
  .gradient-stops {
    font-size: 12px;
    color: #6b7280;
  }

  .gradient-placeholder-text {
    font-size: 13px;
    color: #9ca3af;
    font-style: italic;
  }

  /* 渐变控制面板 */
  .gradient-controls-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
  }

  .gradient-controls-placeholder {
    text-align: center;
    padding: 20px;
    background: #f9fafb;
    border-radius: 8px;
    border: 1px dashed #d1d5db;
  }

  .controls-placeholder-text {
    margin: 0 0 4px 0;
    font-size: 14px;
    font-weight: 500;
    color: #6b7280;
  }

  .controls-placeholder-desc {
    margin: 0;
    font-size: 12px;
    color: #9ca3af;
  }

  /* 当前选择状态 */
  .current-selection {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: #f9fafb;
    border-radius: 6px;
    font-size: 12px;
    border-top: 1px solid #e5e7eb;
  }

  .current-label {
    color: #6b7280;
    font-weight: 500;
  }

  .current-preview {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .current-color {
    width: 20px;
    height: 20px;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
  }

  .current-gradient {
    width: 20px;
    height: 20px;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .current-name {
    color: #374151;
    font-weight: 500;
  }

  /* 加载和过渡动画 */
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes scaleIn {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes shimmer {
    0% {
      background-position: -200px 0;
    }
    100% {
      background-position: calc(200px + 100%) 0;
    }
  }

  .content-area {
    animation: fadeIn 0.3s ease-out;
  }

  .color-category,
  .gradient-category {
    animation: fadeIn 0.4s ease-out;
  }

  .color-option,
  .gradient-option {
    animation: scaleIn 0.2s ease-out;
  }

  .current-selection {
    animation: fadeIn 0.5s ease-out;
  }

  /* 悬停增强效果 */
  .tab-button {
    position: relative;
    overflow: hidden;
  }

  .tab-button::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.2),
      transparent
    );
    transition: left 0.5s;
  }

  .tab-button:hover::before {
    left: 100%;
  }

  .color-option,
  .gradient-option {
    position: relative;
    overflow: hidden;
  }

  .color-option::after,
  .gradient-option::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    transition: width 0.3s ease, height 0.3s ease;
  }

  .color-option:hover::after,
  .gradient-option:hover::after {
    width: 100%;
    height: 100%;
  }

  /* 响应式设计增强 */
  @media (max-width: 768px) {
    .background-color-picker {
      padding: 12px;
      gap: 12px;
    }

    .tab-switcher {
      padding: 1px;
    }

    .tab-button {
      padding: 6px 8px;
      font-size: 12px;
    }

    .tab-icon {
      font-size: 12px;
    }

    .color-grid {
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
    }

    .gradient-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .color-option {
      width: 36px;
      height: 36px;
    }

    .gradient-option {
      height: 60px;
    }

    .custom-color-controls {
      flex-direction: column;
      gap: 12px;
    }

    .current-gradient-preview {
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
    }

    .gradient-preview-large {
      width: 100%;
      height: 40px;
    }
  }

  @media (max-width: 480px) {
    .background-color-picker {
      padding: 8px;
      gap: 8px;
    }

    .color-grid {
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }

    .gradient-grid {
      grid-template-columns: repeat(1, 1fr);
    }

    .color-option {
      width: 32px;
      height: 32px;
    }

    .gradient-option {
      height: 50px;
    }

    .category-title {
      font-size: 11px;
    }

    .current-selection {
      padding: 8px;
      font-size: 11px;
    }

    .current-color,
    .current-gradient {
      width: 16px;
      height: 16px;
    }
  }

  /* 无障碍访问增强 */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* 高对比度模式支持 */
  @media (prefers-contrast: high) {
    .background-color-picker {
      border-width: 2px;
      border-color: #000;
    }

    .tab-button {
      border: 1px solid #000;
    }

    .tab-button.active {
      background: #000;
      color: #fff;
    }

    .color-option,
    .gradient-option {
      border-width: 3px;
      border-color: #000;
    }

    .color-option.selected,
    .gradient-option.selected {
      border-width: 4px;
    }
  }

  /* 深色模式支持 */
  @media (prefers-color-scheme: dark) {
    .background-color-picker {
      background: #1f2937;
      border-color: #374151;
    }

    .picker-title,
    .category-title {
      color: #e5e7eb;
    }

    .tab-switcher {
      background: #374151;
    }

    .tab-button {
      color: #9ca3af;
    }

    .tab-button:hover {
      background: #4b5563;
      color: #e5e7eb;
    }

    .tab-button.active {
      background: #1f2937;
      color: #3b82f6;
    }

    .current-selection {
      background: #374151;
      border-color: #4b5563;
    }

    .current-label {
      color: #9ca3af;
    }

    .current-name {
      color: #e5e7eb;
    }

    .custom-color-section {
      border-color: #4b5563;
    }

    .color-text-input {
      background: #374151;
      border-color: #4b5563;
      color: #e5e7eb;
    }

    .color-text-input:focus {
      border-color: #3b82f6;
    }

    .gradient-controls-placeholder {
      background: #374151;
      border-color: #4b5563;
    }

    .controls-placeholder-text {
      color: #9ca3af;
    }

    .controls-placeholder-desc {
      color: #6b7280;
    }
  }

  /* 图片背景样式 */
  .image-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .image-upload-area {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .drop-zone {
    border: 2px dashed var(--border-color);
    border-radius: 12px;
    padding: 32px 16px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease;
    background: var(--bg-primary);
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .drop-zone:hover {
    border-color: var(--accent-color);
    background: var(--bg-hover);
  }

  .drop-zone:focus {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }

  .drop-zone.uploading {
    border-color: var(--accent-color);
    background: var(--bg-hover);
    cursor: wait;
  }

  .upload-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .upload-icon {
    font-size: 32px;
    opacity: 0.6;
  }

  .upload-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .upload-primary {
    font-weight: 500;
    color: var(--text-primary);
  }

  .upload-secondary {
    font-size: 14px;
    color: var(--text-secondary);
  }

  .upload-hint {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .upload-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--accent-color);
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-color);
    border-top: 2px solid var(--accent-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .upload-error {
    padding: 8px 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #dc2626;
    font-size: 14px;
  }

  .current-image-section {
    padding: 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }

  .current-image-preview {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .image-preview-large {
    width: 80px;
    height: 60px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .image-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  /* 壁纸背景样式 */
  .wallpaper-section {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 200px;
  }

  .wallpaper-category {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .wallpaper-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }

  .wallpaper-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: 2px solid transparent;
    border-radius: 8px;
    background: var(--bg-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
  }

  .wallpaper-item:hover {
    border-color: var(--accent-color);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .wallpaper-item.selected {
    border-color: var(--accent-color);
    background: var(--accent-color-light);
  }

  .wallpaper-preview {
    width: 100%;
    height: 80px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-tertiary);
  }

  .wallpaper-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s ease;
  }

  .wallpaper-item:hover .wallpaper-preview img {
    transform: scale(1.05);
  }

  .wallpaper-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .wallpaper-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.2;
  }

  .wallpaper-tags {
    font-size: 10px;
    color: var(--text-secondary);
    line-height: 1.2;
  }

  .current-wallpaper-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }

  .current-wallpaper-preview {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .wallpaper-preview-large {
    width: 80px;
    height: 60px;
    border-radius: 6px;
    background-size: cover;
    background-position: center;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .wallpaper-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }
</style>
