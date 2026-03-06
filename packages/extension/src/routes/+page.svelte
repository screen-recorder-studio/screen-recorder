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
</div>

