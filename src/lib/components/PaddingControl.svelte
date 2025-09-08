<!-- 边距配置控件 -->
<script lang="ts">
  import { backgroundConfigStore } from '$lib/stores/background-config.svelte'

  // 当前边距值
  const currentPadding = $derived(backgroundConfigStore.config.padding || 60)

  // 预设边距值
  const PRESET_PADDING = [
    { name: '无边距', value: 0 },
    { name: '小边距', value: 30 },
    { name: '中边距', value: 60 },
    { name: '大边距', value: 120 },
    { name: '超大边距', value: 200 }
  ] as const

  // 处理滑块变化
  function handleSliderChange(event: Event) {
    const target = event.target as HTMLInputElement
    const value = parseInt(target.value)
    backgroundConfigStore.updatePadding(value)
  }

  // 处理预设值选择
  function handlePresetSelect(preset: typeof PRESET_PADDING[number]) {
    console.log('🎨 [PaddingControl] Preset selected:', preset)
    backgroundConfigStore.updatePadding(preset.value)
  }

  // 检查是否为当前选中的预设
  function isPresetSelected(value: number) {
    return currentPadding === value
  }
</script>

<!-- 边距配置控件 -->
<div class="padding-control">
  <h3 class="control-title">视频边距</h3>
  
  <!-- 滑块控制 -->
  <div class="slider-container">
    <input
      type="range"
      class="padding-slider"
      min="0"
      max="250"
      step="5"
      value={currentPadding}
      oninput={handleSliderChange}
    />
    <div class="slider-value">
      {currentPadding}px
    </div>
  </div>
  
  <!-- 预设值快速选择 -->
  <div class="preset-buttons">
    {#each PRESET_PADDING as preset}
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
    <div class="preview-wrapper">
      <div 
        class="preview-background"
        style="padding: {Math.round(currentPadding * 0.3)}px"
      >
        <div class="preview-video">
          视频区域
        </div>
      </div>
      <div class="preview-info">
        边距: {currentPadding}px
      </div>
    </div>
  </div>
</div>

<style>
  .padding-control {
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

  .padding-slider {
    flex: 1;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .padding-slider::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    background: #10b981;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .padding-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #10b981;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .slider-value {
    min-width: 50px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    color: #10b981;
    background: #ecfdf5;
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
    border-color: #10b981;
    color: #10b981;
  }

  .preset-btn.selected {
    background: #10b981;
    border-color: #10b981;
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

  .preview-wrapper {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .preview-background {
    width: 120px;
    height: 68px;
    background: #f3f4f6;
    border: 2px solid #d1d5db;
    border-radius: 4px;
    transition: padding 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-video {
    background: #10b981;
    color: white;
    font-size: 10px;
    text-align: center;
    padding: 8px;
    border-radius: 2px;
    flex: 1;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-info {
    font-size: 11px;
    color: #6b7280;
    text-align: center;
  }
</style>
