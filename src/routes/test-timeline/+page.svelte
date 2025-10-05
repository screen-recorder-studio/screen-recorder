<script lang="ts">
  import Timeline from '$lib/components/Timeline.svelte'
  
  // 测试不同时长的视频
  let testCases = [
    { name: '1秒视频', durationMs: 1000, currentMs: 500 },
    { name: '2秒视频', durationMs: 2000, currentMs: 1000 },
    { name: '3秒视频', durationMs: 3000, currentMs: 1500 },
    { name: '4秒视频', durationMs: 4000, currentMs: 2000 },
    { name: '5秒视频', durationMs: 5000, currentMs: 2500 },
    { name: '10秒视频', durationMs: 10000, currentMs: 5000 },
    { name: '30秒视频', durationMs: 30000, currentMs: 15000 },
    { name: '1分钟视频', durationMs: 60000, currentMs: 30000 },
    { name: '2分钟视频', durationMs: 120000, currentMs: 60000 },
    { name: '5分钟视频', durationMs: 300000, currentMs: 150000 },
    { name: '10分钟视频', durationMs: 600000, currentMs: 300000 },
    { name: '30分钟视频', durationMs: 1800000, currentMs: 900000 },
    { name: '1小时视频', durationMs: 3600000, currentMs: 1800000 },
  ]
  
  let selectedCase = $state(testCases[6]) // 默认1分钟
  let currentTimeMs = $state(0)
  let isPlaying = $state(false)

  // 当选择的测试用例改变时，更新当前时间
  $effect(() => {
    currentTimeMs = selectedCase.currentMs
  })

  function handleSeek(timeMs: number) {
    currentTimeMs = timeMs
    console.log('Seek to:', timeMs, 'ms')
  }

  function selectCase(testCase: typeof testCases[0]) {
    selectedCase = testCase
    currentTimeMs = testCase.currentMs
  }
</script>

<div class="container">
  <h1>Timeline 时间刻度测试</h1>
  
  <!-- 测试用例选择 -->
  <div class="test-cases">
    {#each testCases as testCase}
      <button
        class="test-case-btn"
        class:active={selectedCase === testCase}
        onclick={() => selectCase(testCase)}
      >
        {testCase.name}
      </button>
    {/each}
  </div>
  
  <!-- 当前测试信息 -->
  <div class="info">
    <div>视频时长: {selectedCase.durationMs}ms ({(selectedCase.durationMs / 1000).toFixed(1)}秒)</div>
    <div>当前时间: {currentTimeMs}ms ({(currentTimeMs / 1000).toFixed(1)}秒)</div>
  </div>
  
  <!-- Timeline 组件 -->
  <div class="timeline-wrapper">
    <Timeline
      timelineMaxMs={selectedCase.durationMs}
      currentTimeMs={currentTimeMs}
      frameRate={30}
      isPlaying={isPlaying}
      onSeek={handleSeek}
    />
  </div>
  
  <!-- 控制按钮 -->
  <div class="controls">
    <button onclick={() => isPlaying = !isPlaying}>
      {isPlaying ? '暂停' : '播放'}
    </button>
    <button onclick={() => currentTimeMs = 0}>跳到开始</button>
    <button onclick={() => currentTimeMs = selectedCase.durationMs}>跳到结束</button>
  </div>
  
  <!-- 调试信息 -->
  <div class="debug">
    <h3>调试信息</h3>
    <pre>{JSON.stringify({
      timelineMaxMs: selectedCase.durationMs,
      durationSec: selectedCase.durationMs / 1000,
      currentTimeMs,
      isPlaying
    }, null, 2)}</pre>

    <h3 style="margin-top: 1rem;">预期刻度（基于算法）</h3>
    <div class="expected-markers">
      {#if selectedCase.durationMs > 0}
        {@const durationSec = selectedCase.durationMs / 1000}
        {@const interval = durationSec <= 3 ? 1 : durationSec <= 10 ? 2 : durationSec <= 30 ? 5 : durationSec <= 120 ? 10 : durationSec <= 600 ? 30 : 60}
        {@const minorInterval = durationSec <= 3 ? 0.2 : durationSec <= 10 ? 0.5 : durationSec <= 30 ? 1 : durationSec <= 120 ? 2 : durationSec <= 600 ? 6 : 12}
        <div>时长: {durationSec}秒</div>
        <div>主刻度间隔: {interval}秒</div>
        <div>次刻度间隔: {minorInterval}秒</div>
        <div>预期主刻度数量: {Math.floor(durationSec / interval) + 1}</div>
        <div>预期次刻度数量: {Math.floor(durationSec / minorInterval) - Math.floor(durationSec / interval)}</div>
        <div>预期刻度位置:</div>
        <ul style="max-height: 200px; overflow-y: auto;">
          {#each Array.from({ length: Math.floor(durationSec / interval) + 1 }, (_, i) => i * interval) as t}
            <li>{t.toFixed(1)}秒 (位置: {((t / durationSec) * 100).toFixed(1)}%)</li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
    background: #1f2937;
    min-height: 100vh;
    color: white;
  }
  
  h1 {
    margin-bottom: 2rem;
    color: #60a5fa;
  }
  
  .test-cases {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }
  
  .test-case-btn {
    padding: 0.5rem 1rem;
    background: #374151;
    color: white;
    border: 2px solid #4b5563;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .test-case-btn:hover {
    background: #4b5563;
    border-color: #60a5fa;
  }
  
  .test-case-btn.active {
    background: #3b82f6;
    border-color: #60a5fa;
  }
  
  .info {
    background: #374151;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 2rem;
  }
  
  .info div {
    margin-bottom: 0.5rem;
  }
  
  .timeline-wrapper {
    background: #111827;
    padding: 2rem;
    border-radius: 0.5rem;
    margin-bottom: 2rem;
  }
  
  .controls {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
  }
  
  .controls button {
    padding: 0.75rem 1.5rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.2s;
  }
  
  .controls button:hover {
    background: #2563eb;
  }
  
  .debug {
    background: #374151;
    padding: 1rem;
    border-radius: 0.5rem;
  }
  
  .debug h3 {
    margin-bottom: 1rem;
    color: #9ca3af;
  }
  
  .debug pre {
    background: #1f2937;
    padding: 1rem;
    border-radius: 0.25rem;
    overflow-x: auto;
    font-size: 0.875rem;
  }
</style>

