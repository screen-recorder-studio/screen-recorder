<script lang="ts">
  import { Monitor, MousePointer } from '@lucide/svelte';
  // 根页面 - 重定向到 sidepanel
</script>

<svelte:head>
  <title>屏幕录制扩展</title>
</svelte:head>

<div class="max-w-2xl mx-auto py-16 px-6 text-center">
  <div class="mb-8">
    <Monitor class="w-16 h-16 mx-auto mb-4 text-blue-600" />
    <h1 class="text-3xl font-bold text-gray-900 mb-4">屏幕录制扩展</h1>
    <p class="text-lg text-gray-600 leading-relaxed">请通过 Chrome 扩展的 sidepanel 使用此应用。</p>
  </div>

  <div class="flex flex-col sm:flex-row gap-4 justify-center">
    <a href="/sidepanel" class="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors">
      <Monitor class="w-5 h-5" />
      Sidepanel 页面
    </a>
    <a href="/popup" class="inline-flex items-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors">
      <MousePointer class="w-5 h-5" />
      Popup 页面
    </a>
    <a href="/lab/editor" class="inline-flex items-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors">
      Lab Editor（自动播放）
    </a>

  </div>
</div>

