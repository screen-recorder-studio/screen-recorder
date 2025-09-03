<script lang="ts">
  // Sidepanel 主页面
  let isRecording = false
  let duration = 0
  let status = 'idle'
</script>

<svelte:head>
  <title>屏幕录制</title>
</svelte:head>

<div class="sidepanel-container">
  <h1>屏幕录制</h1>
  
  <div class="status-section">
    <div class="status-indicator" class:recording={isRecording}>
      {#if isRecording}
        录制中 - {duration}s
      {:else}
        就绪
      {/if}
    </div>
  </div>
  
  <div class="controls">
    <button 
      class="record-button" 
      class:recording={isRecording}
      disabled={status === 'requesting' || status === 'stopping'}
    >
      {#if isRecording}
        停止录制
      {:else}
        开始录制
      {/if}
    </button>
  </div>
</div>

<style>
  .sidepanel-container {
    padding: 16px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  
  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1f2937;
  }
  
  .status-section {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .status-indicator {
    padding: 8px 12px;
    border-radius: 6px;
    background: #f3f4f6;
    color: #6b7280;
    font-size: 14px;
    font-weight: 500;
  }
  
  .status-indicator.recording {
    background: #fef2f2;
    color: #dc2626;
  }
  
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .record-button {
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    background: #3b82f6;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .record-button:hover:not(:disabled) {
    background: #2563eb;
  }
  
  .record-button.recording {
    background: #dc2626;
  }
  
  .record-button.recording:hover:not(:disabled) {
    background: #b91c1c;
  }
  
  .record-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>