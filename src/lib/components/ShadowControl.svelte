<!-- 阴影配置控件 -->
<script lang="ts">
  import { Zap, Eye, Palette, Move, Focus, Sun, Moon, Sparkles, SlidersHorizontal } from '@lucide/svelte'
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
      opacity: 0.2,
      icon: Sun
    },
    {
      name: '标准阴影',
      offsetX: 8,
      offsetY: 8,
      blur: 16,
      color: '#000000',
      opacity: 0.3,
      icon: Moon
    },
    {
      name: '深度阴影',
      offsetX: 12,
      offsetY: 12,
      blur: 24,
      color: '#000000',
      opacity: 0.4,
      icon: Focus
    },
    {
      name: '远距阴影',
      offsetX: 16,
      offsetY: 16,
      blur: 32,
      color: '#000000',
      opacity: 0.25,
      icon: Sparkles
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
<div class="p-4 border border-gray-200 rounded-lg bg-white">
  <div class="flex justify-between items-center mb-4">
    <div class="flex items-center gap-2">
      <Zap class="w-4 h-4 text-gray-600" />
      <h3 class="text-sm font-semibold text-gray-700">视频阴影</h3>
    </div>
    <label class="relative inline-block w-11 h-6">
      <input
        type="checkbox"
        class="opacity-0 w-0 h-0"
        checked={isEnabled}
        onchange={toggleShadow}
      />
      <span class="absolute cursor-pointer top-0 left-0 right-0 bottom-0 bg-gray-300 transition-all duration-300 rounded-full before:absolute before:content-[''] before:h-4 before:w-4 before:left-1 before:bottom-1 before:bg-white before:transition-all before:duration-300 before:rounded-full"
            class:bg-amber-500={isEnabled}
            class:before:translate-x-5={isEnabled}></span>
    </label>
  </div>

  {#if isEnabled}
    <!-- 预设阴影选择 -->
    <div class="mb-4">
      <h4 class="text-xs font-semibold text-gray-600 mb-3">预设效果</h4>
      <div class="grid grid-cols-2 gap-2">
        {#each SHADOW_PRESETS as preset}
          {@const IconComponent = preset.icon}
          <button
            class="flex flex-col items-center gap-2 p-3 border border-gray-300 rounded-md bg-white cursor-pointer transition-all duration-200 hover:border-amber-400 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-opacity-50"
            onclick={() => applyPreset(preset)}
            title={preset.name}
          >
            <div class="w-10 h-6 bg-gray-100 rounded flex items-center justify-center">
              <div
                class="w-6 h-4 bg-amber-500 rounded-sm"
                style="
                  box-shadow: {preset.offsetX}px {preset.offsetY}px {preset.blur}px {hexToRgba(preset.color, preset.opacity)};
                "
              ></div>
            </div>
            <div class="flex items-center gap-1">
              <IconComponent class="w-3 h-3 text-gray-600" />
              <span class="text-xs text-gray-700 font-medium">{preset.name}</span>
            </div>
          </button>
        {/each}
      </div>
    </div>

    <!-- 自定义参数 -->
    <div class="mb-4">
      <h4 class="text-xs font-semibold text-gray-600 mb-3">自定义参数</h4>

      <!-- X偏移 -->
      <div class="mb-3">
        <div class="flex items-center gap-2 mb-1">
          <Move class="w-3 h-3 text-gray-600" />
          <label class="text-xs text-gray-700 font-medium" for="shadow-offset-x">X偏移: {offsetX}px</label>
        </div>
        <input
          id="shadow-offset-x"
          type="range"
          class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
          min="-20"
          max="20"
          step="1"
          bind:value={offsetX}
          oninput={handleParameterChange}
        />
      </div>

      <!-- Y偏移 -->
      <div class="mb-3">
        <div class="flex items-center gap-2 mb-1">
          <Move class="w-3 h-3 text-gray-600 rotate-90" />
          <label class="text-xs text-gray-700 font-medium" for="shadow-offset-y">Y偏移: {offsetY}px</label>
        </div>
        <input
          id="shadow-offset-y"
          type="range"
          class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
          min="-20"
          max="20"
          step="1"
          bind:value={offsetY}
          oninput={handleParameterChange}
        />
      </div>

      <!-- 模糊半径 -->
      <div class="mb-3">
        <div class="flex items-center gap-2 mb-1">
          <Focus class="w-3 h-3 text-gray-600" />
          <label class="text-xs text-gray-700 font-medium" for="shadow-blur">模糊: {blur}px</label>
        </div>
        <input
          id="shadow-blur"
          type="range"
          class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
          min="0"
          max="40"
          step="1"
          bind:value={blur}
          oninput={handleParameterChange}
        />
      </div>

      <!-- 颜色和透明度 -->
      <div class="flex gap-3">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <Palette class="w-3 h-3 text-gray-600" />
            <label class="text-xs text-gray-700 font-medium" for="shadow-color">颜色</label>
          </div>
          <input
            id="shadow-color"
            type="color"
            class="w-full h-8 border border-gray-300 rounded cursor-pointer"
            bind:value={color}
            oninput={handleParameterChange}
          />
        </div>
        <div class="flex-2">
          <label class="text-xs text-gray-700 font-medium block mb-1" for="shadow-opacity">透明度: {Math.round(opacity * 100)}%</label>
          <input
            id="shadow-opacity"
            type="range"
            class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
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
    <div class="mt-4">
      <div class="flex items-center gap-2 mb-2">
        <Eye class="w-3 h-3 text-gray-600" />
        <h4 class="text-xs font-semibold text-gray-600">预览效果</h4>
      </div>
      <div class="flex justify-center p-4 bg-gray-50 rounded-md">
        <div
          class="w-20 h-12 bg-amber-500 rounded flex items-center justify-center text-white text-xs font-semibold"
          style="
            box-shadow: {offsetX}px {offsetY}px {blur}px {hexToRgba(color, opacity)};
          "
        >
          视频区域
        </div>
      </div>
    </div>
  {:else}
    <div class="text-center text-gray-600 text-xs p-6 bg-gray-50 rounded-md">
      开启阴影开关以配置阴影效果
    </div>
  {/if}
</div>

<style>
  /* 自定义滑块样式 - 使用橙色主题 */
  .slider-thumb::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    background: #f59e0b;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .slider-thumb::-webkit-slider-thumb:hover {
    background: #d97706;
    transform: scale(1.1);
  }

  .slider-thumb::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: #f59e0b;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .slider-thumb::-moz-range-thumb:hover {
    background: #d97706;
    transform: scale(1.1);
  }
</style>
