<!-- 颜色和壁纸测试页面 -->
<script lang="ts">
  import BackgroundColorPicker from '$lib/components/BackgroundColorPicker.svelte'
  import { PRESET_SOLID_COLORS, PRESET_GRADIENTS } from '$lib/stores/background-config.svelte'
  import { WALLPAPER_CATEGORIES, getWallpaperStats } from '$lib/data/wallpaper-presets'
  import { getColorStats } from '$lib/utils/color-utils'

  // 获取统计信息
  const colorStats = getColorStats()
  const wallpaperStats = getWallpaperStats()

  // 渐变统计
  const gradientStats = {
    total: PRESET_GRADIENTS.length,
    byCategory: {
      linear: PRESET_GRADIENTS.filter(g => g.category === 'linear').length,
      radial: PRESET_GRADIENTS.filter(g => g.category === 'radial').length,
      conic: PRESET_GRADIENTS.filter(g => g.category === 'conic').length,
      multicolor: PRESET_GRADIENTS.filter(g => g.category === 'multicolor').length
    }
  }
</script>

<svelte:head>
  <title>颜色和壁纸测试 - Video Record</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 py-8">
  <div class="max-w-6xl mx-auto px-4">
    <!-- 页面标题 -->
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">颜色和壁纸测试</h1>
      <p class="text-gray-600">测试扩展后的颜色选择器和壁纸功能</p>
    </div>

    <!-- 统计信息 -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <!-- 颜色统计 -->
      <div class="bg-white rounded-lg shadow-sm border p-6">
        <h2 class="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          🎨 颜色统计
        </h2>
        <div class="space-y-3">
          <div class="flex justify-between">
            <span class="text-gray-600">总颜色数量:</span>
            <span class="font-medium text-blue-600">{colorStats.total}</span>
          </div>
          {#each Object.entries(colorStats.byCategory) as [category, count]}
            <div class="flex justify-between">
              <span class="text-gray-600 capitalize">{category}:</span>
              <span class="font-medium">{count}种</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- 渐变统计 -->
      <div class="bg-white rounded-lg shadow-sm border p-6">
        <h2 class="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          🌈 渐变统计
        </h2>
        <div class="space-y-3">
          <div class="flex justify-between">
            <span class="text-gray-600">总渐变数量:</span>
            <span class="font-medium text-purple-600">{gradientStats.total}</span>
          </div>
          {#each Object.entries(gradientStats.byCategory) as [category, count]}
            <div class="flex justify-between">
              <span class="text-gray-600 capitalize">{category}:</span>
              <span class="font-medium">{count}个</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- 壁纸统计 -->
      <div class="bg-white rounded-lg shadow-sm border p-6">
        <h2 class="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          🖼️ 壁纸统计
        </h2>
        <div class="space-y-3">
          <div class="flex justify-between">
            <span class="text-gray-600">总壁纸数量:</span>
            <span class="font-medium text-blue-600">{wallpaperStats.total}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">分类数量:</span>
            <span class="font-medium">{wallpaperStats.categories}</span>
          </div>
          {#each Object.entries(wallpaperStats.byCategory) as [category, count]}
            <div class="flex justify-between">
              <span class="text-gray-600 capitalize">{category}:</span>
              <span class="font-medium">{count}张</span>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- 颜色分类预览 -->
    <div class="bg-white rounded-lg shadow-sm border p-6 mb-8">
      <h2 class="text-xl font-semibold text-gray-900 mb-4">颜色分类预览</h2>
      <div class="space-y-6">
        {#each ['basic', 'light', 'dark', 'business', 'creative'] as category}
          {@const categoryColors = PRESET_SOLID_COLORS.filter(c => c.category === category)}
          <div class="space-y-2">
            <h3 class="text-lg font-medium text-gray-700 capitalize">{category} ({categoryColors.length}种)</h3>
            <div class="grid grid-cols-8 gap-2 mb-4">
              {#each categoryColors as color}
                <div
                  class="w-12 h-12 rounded-lg border-2 border-gray-300 flex items-center justify-center group relative hover:border-gray-400 transition-colors duration-200"
                  style="background-color: {color.color}"
                  title="{color.name} - {color.color}"
                >
                  <!-- 提示显示在上方避免被遮挡 -->
                  <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    {color.name}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- 壁纸分类预览 -->
    <div class="bg-white rounded-lg shadow-sm border p-6 mb-8">
      <h2 class="text-xl font-semibold text-gray-900 mb-4">壁纸分类预览</h2>
      <div class="space-y-6">
        {#each Object.entries(WALLPAPER_CATEGORIES) as [, category]}
          <div class="space-y-3">
            <h3 class="text-lg font-medium text-gray-700 flex items-center gap-2">
              <span class="text-xl">{category.icon}</span>
              {category.name} ({category.wallpapers.length}张)
            </h3>
            {#if category.description}
              <p class="text-sm text-gray-600">{category.description}</p>
            {/if}
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {#each category.wallpapers.slice(0, 6) as wallpaper}
                <div class="aspect-video bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                  <img
                    src={wallpaper.imageUrl}
                    alt={wallpaper.name}
                    loading="lazy"
                    class="w-full h-full object-cover"
                  />
                </div>
              {/each}
              {#if category.wallpapers.length > 6}
                <div class="aspect-video bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                  <span class="text-sm text-gray-500">+{category.wallpapers.length - 6}张</span>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- 渐变分类预览 -->
    <div class="bg-white rounded-lg shadow-sm border p-6 mb-8">
      <h2 class="text-xl font-semibold text-gray-900 mb-4">渐变分类预览</h2>
      <div class="space-y-6">
        {#each ['linear', 'radial', 'conic', 'multicolor'] as category}
          {@const categoryGradients = PRESET_GRADIENTS.filter(g => g.category === category)}
          {@const categoryInfo = {
            linear: { name: '线性渐变', icon: '📐' },
            radial: { name: '径向渐变', icon: '🎯' },
            conic: { name: '圆锥渐变', icon: '🌀' },
            multicolor: { name: '多色渐变', icon: '🌈' }
          }[category] || { name: '未知', icon: '❓' }}
          <div class="space-y-3">
            <h3 class="text-lg font-medium text-gray-700 flex items-center gap-2">
              <span class="text-xl">{categoryInfo.icon}</span>
              {categoryInfo.name} ({categoryGradients.length}个)
            </h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
              {#each categoryGradients.slice(0, 4) as gradient}
                <div class="space-y-2">
                  <div class="relative group">
                    <div
                      class="aspect-video bg-gray-100 rounded-lg border-2 border-gray-200 overflow-hidden hover:border-gray-400 transition-colors duration-200"
                      style="background: {gradient.preview}"
                      title="{gradient.name} - {gradient.description}"
                    >
                    </div>
                    <!-- 悬停时显示渐变名称 - 移到上方避免被遮挡 -->
                    <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-20">
                      {gradient.name}
                    </div>
                  </div>
                  <div class="text-xs text-center">
                    <div class="font-medium text-gray-700">{gradient.name}</div>
                    <div class="text-gray-500">{gradient.config.stops.length}色</div>
                  </div>
                </div>
              {/each}
              {#if categoryGradients.length > 4}
                <div class="aspect-video bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                  <span class="text-sm text-gray-500">+{categoryGradients.length - 4}个</span>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- 背景选择器组件测试 -->
    <div class="bg-white rounded-lg shadow-sm border p-6">
      <h2 class="text-xl font-semibold text-gray-900 mb-4">背景选择器测试</h2>
      <BackgroundColorPicker />
    </div>
  </div>
</div>
