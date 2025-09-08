<script lang="ts">
  import { ChromeAPIWrapper } from '$lib/utils/chrome-api'
  import { Monitor, AlertCircle, Loader2 } from '@lucide/svelte'
  
  let isLoading = false
  let error = ''

  async function openSidePanel() {
    try {
      isLoading = true
      error = ''
      
      await ChromeAPIWrapper.openSidePanel()
      
      // 关闭 popup
      window.close()
    } catch (err) {
      error = err instanceof Error ? err.message : '打开面板失败'
      console.error('Failed to open sidepanel:', err)
    } finally {
      isLoading = false
    }
  }

  async function checkPermissions() {
    try {
      const permissions = await ChromeAPIWrapper.checkPermissions()
      console.log('Permissions:', permissions)
    } catch (err) {
      console.error('Failed to check permissions:', err)
    }
  }

  // 页面加载时检查权限（仅在浏览器环境中）
  import { browser } from '$app/environment'
  
  if (browser) {
    checkPermissions()
  }
</script>

<svelte:head>
  <title>屏幕录制扩展</title>
</svelte:head>

<div class="w-[300px] p-5 font-sans">
  <div class="flex items-center gap-2 mb-3">
    <Monitor class="w-5 h-5 text-blue-600" />
    <h2 class="text-base font-semibold text-gray-900">屏幕录制扩展</h2>
  </div>
  <p class="text-sm text-gray-600 leading-relaxed mb-4">点击下方按钮打开录制面板</p>

  {#if error}
    <div class="flex items-center gap-2 bg-red-50 text-red-600 px-3 py-2 rounded border border-red-200 text-xs mb-3">
      <AlertCircle class="w-4 h-4 flex-shrink-0" />
      {error}
    </div>
  {/if}

  <button
    on:click={openSidePanel}
    class="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    disabled={isLoading}
  >
    {#if isLoading}
      <Loader2 class="w-4 h-4 animate-spin" />
      正在打开...
    {:else}
      <Monitor class="w-4 h-4" />
      打开录制面板
    {/if}
  </button>

  <div class="mt-4 pt-3 border-t border-gray-200">
    <p class="text-xs text-gray-500 font-medium mb-1">版本 1.0.0</p>
    <p class="text-xs text-gray-500">支持高质量屏幕录制</p>
  </div>
</div>

