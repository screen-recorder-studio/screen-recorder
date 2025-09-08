<!-- 简单的背景色选择器 - 用于验证配置同步 -->
<script lang="ts">
  import { backgroundConfigStore, PRESET_COLORS } from '$lib/stores/background-config.svelte'

  // 当前选中的颜色
  $: currentColor = backgroundConfigStore.config.color

  // 处理颜色选择
  function handleColorSelect(presetColor: typeof PRESET_COLORS[number]) {
    console.log('🎨 [BackgroundColorPicker] Color selected:', presetColor)
    backgroundConfigStore.applyPresetColor(presetColor)
  }

  // 检查是否为当前选中的颜色
  function isSelected(color: string) {
    return currentColor === color
  }
</script>

<!-- 背景色选择器 -->
<div class="background-color-picker">
  <h3 class="picker-title">背景颜色</h3>
  
  <div class="color-grid">
    {#each PRESET_COLORS as presetColor}
      <button
        class="color-option"
        class:selected={isSelected(presetColor.color)}
        style="background-color: {presetColor.color}"
        title={presetColor.name}
        onclick={() => handleColorSelect(presetColor)}
      >
        {#if isSelected(presetColor.color)}
          <div class="selected-indicator">✓</div>
        {/if}
      </button>
    {/each}
  </div>
  
  <!-- 当前选中颜色显示 -->
  <div class="current-selection">
    <span class="current-label">当前颜色:</span>
    <div class="current-color" style="background-color: {currentColor}"></div>
    <span class="current-name">
      {PRESET_COLORS.find(p => p.color === currentColor)?.name || currentColor}
    </span>
  </div>
</div>

<style>
  .background-color-picker {
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
  }

  .picker-title {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }

  .color-option {
    width: 48px;
    height: 48px;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
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
    font-size: 16px;
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
  }

  .current-selection {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: #f9fafb;
    border-radius: 6px;
    font-size: 12px;
  }

  .current-label {
    color: #6b7280;
    font-weight: 500;
  }

  .current-color {
    width: 20px;
    height: 20px;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
  }

  .current-name {
    color: #374151;
    font-weight: 500;
  }
</style>
