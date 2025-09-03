<script lang="ts">
  import { ChromeAPIWrapper } from '$lib/utils/chrome-api'
  
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

<div class="popup-container">
  <h2>屏幕录制扩展</h2>
  <p>点击下方按钮打开录制面板</p>
  
  {#if error}
    <div class="error-message">
      {error}
    </div>
  {/if}
  
  <button 
    on:click={openSidePanel} 
    class="open-panel-button"
    disabled={isLoading}
  >
    {#if isLoading}
      正在打开...
    {:else}
      打开录制面板
    {/if}
  </button>
  
  <div class="info">
    <p class="version">版本 1.0.0</p>
    <p class="description">支持高质量屏幕录制</p>
  </div>
</div>

<style>
  .popup-container {
    width: 300px;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  
  h2 {
    margin: 0 0 12px 0;
    font-size: 16px;
    font-weight: 600;
    color: #1f2937;
  }
  
  p {
    margin: 0 0 16px 0;
    font-size: 14px;
    color: #6b7280;
    line-height: 1.5;
  }
  
  .open-panel-button {
    width: 100%;
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    background: #3b82f6;
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .open-panel-button:hover:not(:disabled) {
    background: #2563eb;
  }
  
  .open-panel-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .error-message {
    background: #fef2f2;
    color: #dc2626;
    padding: 8px 12px;
    border-radius: 4px;
    border: 1px solid #fecaca;
    font-size: 12px;
    margin-bottom: 12px;
  }
  
  .info {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid #e5e7eb;
  }
  
  .info p {
    margin: 4px 0;
    font-size: 12px;
    color: #9ca3af;
  }
  
  .version {
    font-weight: 500;
  }
</style>