<script lang="ts">
  // 根页面 - 重定向到 sidepanel
</script>

<svelte:head>
  <title>屏幕录制扩展</title>
</svelte:head>

<div class="container">
  <h1>屏幕录制扩展</h1>
  <p>请通过 Chrome 扩展的 sidepanel 使用此应用。</p>
  
  <div class="links">
    <a href="/sidepanel">Sidepanel 页面</a>
    <a href="/popup">Popup 页面</a>
  </div>
</div>

<style>
  .container {
    max-width: 600px;
    margin: 0 auto;
    padding: 40px 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    text-align: center;
  }
  
  h1 {
    margin: 0 0 16px 0;
    font-size: 24px;
    font-weight: 600;
    color: #1f2937;
  }
  
  p {
    margin: 0 0 32px 0;
    font-size: 16px;
    color: #6b7280;
    line-height: 1.6;
  }
  
  .links {
    display: flex;
    gap: 16px;
    justify-content: center;
  }
  
  .links a {
    padding: 10px 20px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    text-decoration: none;
    color: #374151;
    font-weight: 500;
    transition: all 0.2s;
  }
  
  .links a:hover {
    background: #f9fafb;
    border-color: #9ca3af;
  }
</style>