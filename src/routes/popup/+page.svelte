<script lang="ts">
  // Popup 页面（可选）
  function openSidePanel() {
    // 这里将实现打开 sidepanel 的逻辑
    console.log('Opening side panel...')
  }
</script>

<svelte:head>
  <title>屏幕录制扩展</title>
</svelte:head>

<div class="popup-container">
  <h2>屏幕录制扩展</h2>
  <p>点击下方按钮打开录制面板</p>
  
  <button on:click={openSidePanel} class="open-panel-button">
    打开录制面板
  </button>
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
  
  .open-panel-button:hover {
    background: #2563eb;
  }
</style>