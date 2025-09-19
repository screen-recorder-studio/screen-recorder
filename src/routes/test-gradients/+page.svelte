<!-- 渐变测试页面 -->
<script lang="ts">
  import { PRESET_GRADIENTS } from '$lib/stores/background-config.svelte'

  // 按分类组织渐变
  const gradientCategories = [
    {
      key: 'linear',
      name: '线性渐变',
      icon: '📐',
      description: '直线方向的颜色过渡',
      gradients: PRESET_GRADIENTS.filter(g => g.category === 'linear')
    },
    {
      key: 'radial',
      name: '径向渐变',
      icon: '🎯',
      description: '从中心向外辐射的颜色过渡',
      gradients: PRESET_GRADIENTS.filter(g => g.category === 'radial')
    },
    {
      key: 'conic',
      name: '圆锥渐变',
      icon: '🌀',
      description: '围绕中心旋转的颜色过渡',
      gradients: PRESET_GRADIENTS.filter(g => g.category === 'conic')
    },
    {
      key: 'multicolor',
      name: '多色渐变',
      icon: '🌈',
      description: '丰富多彩的复杂颜色过渡',
      gradients: PRESET_GRADIENTS.filter(g => g.category === 'multicolor')
    }
  ]

  // 统计信息
  const totalGradients = PRESET_GRADIENTS.length
  const categoryStats = gradientCategories.map(cat => ({
    ...cat,
    count: cat.gradients.length
  }))
</script>

<svelte:head>
  <title>渐变测试 - Video Record</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 py-8">
  <div class="max-w-6xl mx-auto px-4">
    <!-- 页面标题 -->
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">渐变效果测试</h1>
      <p class="text-gray-600">展示4种类别，共{totalGradients}个精美渐变效果</p>
    </div>

    <!-- 统计信息 -->
    <div class="bg-white rounded-lg shadow-sm border p-6 mb-8">
      <h2 class="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
        📊 渐变统计
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        {#each categoryStats as category}
          <div class="text-center p-4 bg-gray-50 rounded-lg">
            <div class="text-2xl mb-2">{category.icon}</div>
            <div class="text-lg font-semibold text-gray-900">{category.count}</div>
            <div class="text-sm text-gray-600">{category.name}</div>
          </div>
        {/each}
      </div>
    </div>

    <!-- 渐变分类展示 -->
    {#each gradientCategories as category}
      <div class="bg-white rounded-lg shadow-sm border p-6 mb-8">
        <div class="mb-6">
          <h2 class="text-xl font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span class="text-2xl">{category.icon}</span>
            {category.name}
            <span class="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
              {category.gradients.length}个
            </span>
          </h2>
          <p class="text-gray-600">{category.description}</p>
        </div>

        <!-- 渐变网格 -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          {#each category.gradients as gradient}
            <div class="space-y-2">
              <!-- 渐变预览 -->
              <div class="relative group">
                <div
                  class="aspect-video rounded-lg border-2 border-gray-200 overflow-hidden cursor-pointer hover:border-gray-300 transition-all duration-200"
                  style="background: {gradient.preview}"
                  title="{gradient.name} - {gradient.description}"
                >
                </div>
                <!-- 悬停时显示渐变名称 - 移到上方避免被遮挡 -->
                <div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-20">
                  {gradient.name}
                </div>
              </div>

              <!-- 渐变信息 -->
              <div class="space-y-1">
                <h3 class="text-sm font-medium text-gray-900">{gradient.name}</h3>
                <p class="text-xs text-gray-500">{gradient.description}</p>
                <div class="text-xs text-gray-400">
                  {gradient.config.type} • {gradient.config.stops.length}色
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}

    <!-- 大尺寸预览 -->
    <div class="bg-white rounded-lg shadow-sm border p-6">
      <h2 class="text-xl font-semibold text-gray-900 mb-4">大尺寸预览</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        {#each PRESET_GRADIENTS.slice(0, 4) as gradient}
          <div class="space-y-3">
            <h3 class="text-lg font-medium text-gray-900 flex items-center gap-2">
              {gradient.name}
              <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                {gradient.category}
              </span>
            </h3>
            <div
              class="h-32 rounded-lg border border-gray-200"
              style="background: {gradient.preview}"
            ></div>
            <p class="text-sm text-gray-600">{gradient.description}</p>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  /* 确保渐变在所有浏览器中正确显示 */
  .aspect-video {
    aspect-ratio: 16 / 9;
  }
</style>
