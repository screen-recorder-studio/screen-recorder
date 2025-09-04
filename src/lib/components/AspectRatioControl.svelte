<!-- 视频比例配置控件 -->
<script lang="ts">
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'
  import type { BackgroundConfig } from '$lib/types/background'

  // 当前比例配置
  const currentRatio = $derived(backgroundConfigStore.config.outputRatio)
  const customWidth = $derived(backgroundConfigStore.config.customWidth || 1920)
  const customHeight = $derived(backgroundConfigStore.config.customHeight || 1080)

  // 热门平台标准比例
  const PLATFORM_RATIOS = [
    {
      name: 'YouTube 横屏',
      ratio: '16:9' as const,
      description: 'YouTube、B站、爱奇艺等',
      icon: '📺',
      dimensions: '1920×1080'
    },
    {
      name: 'Instagram 方形',
      ratio: '1:1' as const,
      description: 'Instagram 帖子、微信朋友圈',
      icon: '📷',
      dimensions: '1080×1080'
    },
    {
      name: 'TikTok 竖屏',
      ratio: '9:16' as const,
      description: 'TikTok、抖音、快手',
      icon: '📱',
      dimensions: '1080×1920'
    },
    {
      name: 'Instagram Story',
      ratio: '4:5' as const,
      description: 'Instagram 故事、小红书',
      icon: '📖',
      dimensions: '1080×1350'
    }
  ] as const

  // 自定义尺寸输入
  let customWidthInput = $state(1920)
  let customHeightInput = $state(1080)
  let showCustomInput = $state(false)

  // 处理比例选择
  function handleRatioSelect(ratio: typeof PLATFORM_RATIOS[number]) {
    console.log('📐 [AspectRatioControl] Ratio selected:', ratio)
    backgroundConfigStore.updateOutputRatio(ratio.ratio)
    showCustomInput = false
  }

  // 处理自定义比例
  function handleCustomRatio() {
    console.log('📐 [AspectRatioControl] Custom ratio selected')
    showCustomInput = true
    backgroundConfigStore.updateOutputRatio('custom', customWidthInput, customHeightInput)
  }

  // 处理自定义尺寸变化
  function handleCustomSizeChange() {
    if (currentRatio === 'custom') {
      backgroundConfigStore.updateOutputRatio('custom', customWidthInput, customHeightInput)
    }
  }

  // 检查是否为当前选中的比例
  function isRatioSelected(ratio: BackgroundConfig['outputRatio']) {
    return currentRatio === ratio
  }

  // 获取当前比例的显示信息
  function getCurrentRatioInfo() {
    if (currentRatio === 'custom') {
      return {
        name: '自定义尺寸',
        dimensions: `${customWidth}×${customHeight}`,
        aspectRatio: (customWidth / customHeight).toFixed(2)
      }
    }
    
    const platform = PLATFORM_RATIOS.find(p => p.ratio === currentRatio)
    return platform ? {
      name: platform.name,
      dimensions: platform.dimensions,
      aspectRatio: currentRatio
    } : null
  }

  // 响应自定义尺寸的变化
  $effect(() => {
    if (currentRatio === 'custom') {
      customWidthInput = customWidth
      customHeightInput = customHeight
    }
  })
</script>

<!-- 视频比例配置控件 -->
<div class="aspect-ratio-control">
  <h3 class="control-title">输出比例</h3>
  
  <!-- 平台比例选择 -->
  <div class="ratio-grid">
    {#each PLATFORM_RATIOS as platform}
      <button
        class="ratio-card"
        class:selected={isRatioSelected(platform.ratio)}
        onclick={() => handleRatioSelect(platform)}
        title="{platform.description}"
      >
        <div class="ratio-icon">{platform.icon}</div>
        <div class="ratio-info">
          <div class="ratio-name">{platform.name}</div>
          <div class="ratio-desc">{platform.ratio}</div>
          <div class="ratio-size">{platform.dimensions}</div>
        </div>
      </button>
    {/each}
    
    <!-- 自定义比例 -->
    <button
      class="ratio-card custom-card"
      class:selected={isRatioSelected('custom')}
      onclick={handleCustomRatio}
      title="自定义尺寸"
    >
      <div class="ratio-icon">⚙️</div>
      <div class="ratio-info">
        <div class="ratio-name">自定义</div>
        <div class="ratio-desc">Custom</div>
        <div class="ratio-size">自定义尺寸</div>
      </div>
    </button>
  </div>
  
  <!-- 自定义尺寸输入 -->
  {#if showCustomInput || currentRatio === 'custom'}
    <div class="custom-input-section">
      <h4 class="custom-title">自定义尺寸</h4>
      <div class="custom-inputs">
        <div class="input-group">
          <label for="custom-width">宽度</label>
          <input
            id="custom-width"
            type="number"
            min="480"
            max="4096"
            step="1"
            bind:value={customWidthInput}
            oninput={handleCustomSizeChange}
          />
          <span class="input-unit">px</span>
        </div>
        <div class="input-separator">×</div>
        <div class="input-group">
          <label for="custom-height">高度</label>
          <input
            id="custom-height"
            type="number"
            min="480"
            max="4096"
            step="1"
            bind:value={customHeightInput}
            oninput={handleCustomSizeChange}
          />
          <span class="input-unit">px</span>
        </div>
      </div>
    </div>
  {/if}
  
  <!-- 当前选择显示 -->
  <div class="current-selection">
    {#if getCurrentRatioInfo()}
      {@const info = getCurrentRatioInfo()}
      <div class="selection-info">
        <span class="selection-label">当前比例:</span>
        <span class="selection-name">{info.name}</span>
        <span class="selection-size">{info.dimensions}</span>
        <span class="selection-ratio">({info.aspectRatio})</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .aspect-ratio-control {
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
  }

  .control-title {
    margin: 0 0 16px 0;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  .ratio-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-bottom: 16px;
  }

  .ratio-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    background: white;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
  }

  .ratio-card:hover {
    border-color: #8b5cf6;
    background: #faf5ff;
  }

  .ratio-card.selected {
    border-color: #8b5cf6;
    background: #8b5cf6;
    color: white;
  }

  .ratio-icon {
    font-size: 20px;
    flex-shrink: 0;
  }

  .ratio-info {
    flex: 1;
    min-width: 0;
  }

  .ratio-name {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 2px;
  }

  .ratio-desc {
    font-size: 11px;
    opacity: 0.8;
    margin-bottom: 2px;
  }

  .ratio-size {
    font-size: 10px;
    opacity: 0.7;
  }

  .custom-input-section {
    margin-bottom: 16px;
    padding: 12px;
    background: #f9fafb;
    border-radius: 6px;
  }

  .custom-title {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
  }

  .custom-inputs {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .input-group label {
    font-size: 11px;
    color: #6b7280;
    font-weight: 500;
  }

  .input-group input {
    padding: 6px 8px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 12px;
    text-align: center;
  }

  .input-group input:focus {
    outline: none;
    border-color: #8b5cf6;
    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.1);
  }

  .input-unit {
    font-size: 10px;
    color: #6b7280;
    text-align: center;
  }

  .input-separator {
    font-size: 14px;
    color: #6b7280;
    margin-top: 16px;
  }

  .current-selection {
    padding: 8px;
    background: #f3f4f6;
    border-radius: 6px;
    font-size: 12px;
  }

  .selection-info {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .selection-label {
    color: #6b7280;
    font-weight: 500;
  }

  .selection-name {
    color: #8b5cf6;
    font-weight: 600;
  }

  .selection-size {
    color: #374151;
    font-weight: 500;
  }

  .selection-ratio {
    color: #6b7280;
    font-size: 11px;
  }
</style>
