<!-- 圆角配置控件 -->
<script lang="ts">
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'

  // 当前圆角值
  const currentRadius = $derived(backgroundConfigStore.config.borderRadius || 0)

  // 预设圆角值
  const PRESET_RADIUS = [
    { name: '无圆角', value: 0 },
    { name: '小圆角', value: 8 },
    { name: '中圆角', value: 16 },
    { name: '大圆角', value: 24 },
    { name: '超大圆角', value: 32 }
  ] as const

  // 处理滑块变化
  function handleSliderChange(event: Event) {
    const target = event.target as HTMLInputElement
    const value = parseInt(target.value)
    backgroundConfigStore.updateBorderRadius(value)
  }

  // 处理预设值选择
  function handlePresetSelect(preset: typeof PRESET_RADIUS[number]) {
    console.log('🎨 [BorderRadiusControl] Preset selected:', preset)
    backgroundConfigStore.updateBorderRadius(preset.value)
  }

  // 检查是否为当前选中的预设
  function isPresetSelected(value: number) {
    return currentRadius === value
  }
</script>

<!-- 圆角配置控件 -->
<div class="border-radius-control">
  <h3 class="control-title">视频圆角</h3>
  
  <!-- 滑块控制 -->
  <div class="slider-container">
    <input
      type="range"
      class="radius-slider"
      min="0"
      max="50"
      step="1"
      value={currentRadius}
      oninput={handleSliderChange}
    />
    <div class="slider-value">
      {currentRadius}px
    </div>
  </div>
  
  <!-- 预设值快速选择 -->
  <div class="preset-buttons">
    {#each PRESET_RADIUS as preset}
      <button
        class="preset-btn"
        class:selected={isPresetSelected(preset.value)}
        onclick={() => handlePresetSelect(preset)}
        title="{preset.name} ({preset.value}px)"
      >
        {preset.name}
      </button>
    {/each}
  </div>
  
  <!-- 视觉预览 -->
  <div class="preview-container">
    <div class="preview-label">预览效果:</div>
    <div 
      class="preview-box"
      style="border-radius: {currentRadius}px"
    >
      <div class="preview-content">
        视频区域
      </div>
    </div>
  </div>
</div>

<style>
  .border-radius-control {
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

  .slider-container {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  .radius-slider {
    flex: 1;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .radius-slider::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .radius-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .slider-value {
    min-width: 40px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    color: #3b82f6;
    background: #eff6ff;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .preset-buttons {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .preset-btn {
    padding: 6px 12px;
    font-size: 11px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: white;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .preset-btn:hover {
    border-color: #3b82f6;
    color: #3b82f6;
  }

  .preset-btn.selected {
    background: #3b82f6;
    border-color: #3b82f6;
    color: white;
  }

  .preview-container {
    margin-top: 16px;
  }

  .preview-label {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 8px;
  }

  .preview-box {
    width: 120px;
    height: 68px;
    background: #f3f4f6;
    border: 2px solid #d1d5db;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-radius 0.2s ease;
    overflow: hidden;
  }

  .preview-content {
    font-size: 11px;
    color: #6b7280;
    text-align: center;
  }
</style>
