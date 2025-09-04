<!-- 阴影配置控件 -->
<script lang="ts">
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'

  // 当前阴影配置
  const currentShadow = $derived(backgroundConfigStore.config.shadow)
  const isEnabled = $derived(!!currentShadow)

  // 阴影参数状态
  let offsetX = $state(8)
  let offsetY = $state(8)
  let blur = $state(16)
  let color = $state('#000000')
  let opacity = $state(0.3)

  // 预设阴影效果
  const SHADOW_PRESETS = [
    {
      name: '轻微阴影',
      offsetX: 4,
      offsetY: 4,
      blur: 8,
      color: '#000000',
      opacity: 0.2
    },
    {
      name: '标准阴影',
      offsetX: 8,
      offsetY: 8,
      blur: 16,
      color: '#000000',
      opacity: 0.3
    },
    {
      name: '深度阴影',
      offsetX: 12,
      offsetY: 12,
      blur: 24,
      color: '#000000',
      opacity: 0.4
    },
    {
      name: '远距阴影',
      offsetX: 16,
      offsetY: 16,
      blur: 32,
      color: '#000000',
      opacity: 0.25
    }
  ] as const

  // 切换阴影开关
  function toggleShadow() {
    if (isEnabled) {
      // 关闭阴影
      backgroundConfigStore.updateShadow(undefined)
    } else {
      // 开启阴影，使用当前参数
      updateShadowConfig()
    }
  }

  // 更新阴影配置
  function updateShadowConfig() {
    const shadowConfig: BackgroundConfig['shadow'] = {
      offsetX,
      offsetY,
      blur,
      color: hexToRgba(color, opacity)
    }
    backgroundConfigStore.updateShadow(shadowConfig)
  }

  // 应用预设阴影
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

  // 颜色转换工具
  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  // 处理参数变化
  function handleParameterChange() {
    if (isEnabled) {
      updateShadowConfig()
    }
  }

  // 初始化时同步当前配置
  $effect(() => {
    if (currentShadow) {
      // 解析当前阴影配置
      offsetX = currentShadow.offsetX
      offsetY = currentShadow.offsetY
      blur = currentShadow.blur
      
      // 解析颜色和透明度
      const colorMatch = currentShadow.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
      if (colorMatch) {
        const [, r, g, b, a] = colorMatch
        color = `#${parseInt(r).toString(16).padStart(2, '0')}${parseInt(g).toString(16).padStart(2, '0')}${parseInt(b).toString(16).padStart(2, '0')}`
        opacity = a ? parseFloat(a) : 1
      }
    }
  })
</script>

<!-- 阴影配置控件 -->
<div class="shadow-control">
  <div class="control-header">
    <h3 class="control-title">视频阴影</h3>
    <label class="shadow-toggle">
      <input
        type="checkbox"
        checked={isEnabled}
        onchange={toggleShadow}
      />
      <span class="toggle-slider"></span>
    </label>
  </div>

  {#if isEnabled}
    <!-- 预设阴影选择 -->
    <div class="preset-section">
      <h4 class="section-title">预设效果</h4>
      <div class="preset-grid">
        {#each SHADOW_PRESETS as preset}
          <button
            class="preset-card"
            onclick={() => applyPreset(preset)}
            title={preset.name}
          >
            <div class="preset-preview">
              <div 
                class="preview-shadow"
                style="
                  box-shadow: {preset.offsetX}px {preset.offsetY}px {preset.blur}px {hexToRgba(preset.color, preset.opacity)};
                "
              ></div>
            </div>
            <span class="preset-name">{preset.name}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- 自定义参数 -->
    <div class="custom-section">
      <h4 class="section-title">自定义参数</h4>
      
      <!-- X偏移 -->
      <div class="parameter-group">
        <label class="parameter-label" for="shadow-offset-x">X偏移: {offsetX}px</label>
        <input
          id="shadow-offset-x"
          type="range"
          class="parameter-slider"
          min="-20"
          max="20"
          step="1"
          bind:value={offsetX}
          oninput={handleParameterChange}
        />
      </div>

      <!-- Y偏移 -->
      <div class="parameter-group">
        <label class="parameter-label" for="shadow-offset-y">Y偏移: {offsetY}px</label>
        <input
          id="shadow-offset-y"
          type="range"
          class="parameter-slider"
          min="-20"
          max="20"
          step="1"
          bind:value={offsetY}
          oninput={handleParameterChange}
        />
      </div>

      <!-- 模糊半径 -->
      <div class="parameter-group">
        <label class="parameter-label" for="shadow-blur">模糊: {blur}px</label>
        <input
          id="shadow-blur"
          type="range"
          class="parameter-slider"
          min="0"
          max="40"
          step="1"
          bind:value={blur}
          oninput={handleParameterChange}
        />
      </div>

      <!-- 颜色和透明度 -->
      <div class="color-group">
        <div class="color-input">
          <label class="parameter-label" for="shadow-color">颜色</label>
          <input
            id="shadow-color"
            type="color"
            class="color-picker"
            bind:value={color}
            oninput={handleParameterChange}
          />
        </div>
        <div class="opacity-input">
          <label class="parameter-label" for="shadow-opacity">透明度: {Math.round(opacity * 100)}%</label>
          <input
            id="shadow-opacity"
            type="range"
            class="parameter-slider"
            min="0"
            max="1"
            step="0.05"
            bind:value={opacity}
            oninput={handleParameterChange}
          />
        </div>
      </div>
    </div>

    <!-- 实时预览 -->
    <div class="preview-section">
      <h4 class="section-title">预览效果</h4>
      <div class="preview-container">
        <div 
          class="preview-box"
          style="
            box-shadow: {offsetX}px {offsetY}px {blur}px {hexToRgba(color, opacity)};
          "
        >
          视频区域
        </div>
      </div>
    </div>
  {:else}
    <div class="disabled-message">
      开启阴影开关以配置阴影效果
    </div>
  {/if}
</div>

<style>
  .shadow-control {
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
  }

  .control-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .control-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  .shadow-toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }

  .shadow-toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #d1d5db;
    transition: 0.3s;
    border-radius: 24px;
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }

  input:checked + .toggle-slider {
    background-color: #f59e0b;
  }

  input:checked + .toggle-slider:before {
    transform: translateX(20px);
  }

  .section-title {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
  }

  .preset-section {
    margin-bottom: 16px;
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .preset-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: white;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .preset-card:hover {
    border-color: #f59e0b;
    background: #fffbeb;
  }

  .preset-preview {
    width: 40px;
    height: 24px;
    background: #f3f4f6;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-shadow {
    width: 24px;
    height: 16px;
    background: #f59e0b;
    border-radius: 2px;
  }

  .preset-name {
    font-size: 10px;
    color: #6b7280;
    text-align: center;
  }

  .custom-section {
    margin-bottom: 16px;
  }

  .parameter-group {
    margin-bottom: 12px;
  }

  .parameter-label {
    display: block;
    font-size: 11px;
    color: #6b7280;
    margin-bottom: 4px;
    font-weight: 500;
  }

  .parameter-slider {
    width: 100%;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .parameter-slider::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    background: #f59e0b;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .parameter-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: #f59e0b;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .color-group {
    display: flex;
    gap: 12px;
  }

  .color-input {
    flex: 1;
  }

  .opacity-input {
    flex: 2;
  }

  .color-picker {
    width: 100%;
    height: 32px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    cursor: pointer;
  }

  .preview-section {
    margin-bottom: 8px;
  }

  .preview-container {
    display: flex;
    justify-content: center;
    padding: 16px;
    background: #f9fafb;
    border-radius: 6px;
  }

  .preview-box {
    width: 80px;
    height: 48px;
    background: #f59e0b;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: white;
    font-weight: 600;
  }

  .disabled-message {
    text-align: center;
    color: #6b7280;
    font-size: 12px;
    padding: 24px;
    background: #f9fafb;
    border-radius: 6px;
  }
</style>
