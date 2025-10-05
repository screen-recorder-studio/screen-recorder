<script lang="ts">
  import Timeline from '$lib/components/Timeline.svelte'
  
  // 模拟 Studio 环境的 4秒视频
  let timelineMaxMs = $state(4000)  // 4秒视频
  let currentTimeMs = $state(0)
  let frameRate = $state(30)
  let isPlaying = $state(false)

  // 模拟不同的 timelineMaxMs 计算方式
  let calculationMethod = $state<'frames-30' | 'frames-29.97' | 'frames-121' | 'duration'>('frames-30')

  // 模拟 Studio 的计算逻辑
  const totalFramesAll = $derived.by(() => {
    if (calculationMethod === 'frames-30') {
      return 120  // 4秒 @ 30fps
    } else if (calculationMethod === 'frames-29.97') {
      return 120  // 4.004秒 @ 29.97fps
    } else if (calculationMethod === 'frames-121') {
      return 121  // 4.033秒 @ 30fps
    }
    return 0
  })

  // 动态帧率
  $effect(() => {
    if (calculationMethod === 'frames-29.97') {
      frameRate = 29.97
    } else {
      frameRate = 30
    }
  })
  
  const durationMs = $derived.by(() => {
    if (calculationMethod === 'duration') {
      return 4000
    }
    return 0
  })
  
  // 模拟 VideoPreviewComposite 的 timelineMaxMs 计算
  const calculatedTimelineMaxMs = $derived.by(() => {
    let result: number
    
    // Priority 1: Use global duration (based on global frame count)
    if (totalFramesAll > 0 && frameRate > 0) {
      result = Math.max(1, Math.floor((totalFramesAll / frameRate) * 1000))
      console.log('[Test] timelineMaxMs: using global frames:', {
        totalFramesAll,
        frameRate,
        result
      })
    }
    // Priority 2: Use passed real duration
    else if (durationMs > 0) {
      result = Math.max(1, Math.floor(durationMs))
      console.log('[Test] timelineMaxMs: using durationMs:', { durationMs, result })
    }
    // Fallback
    else {
      result = 1000
      console.log('[Test] timelineMaxMs: using fallback:', { result })
    }
    
    return result
  })
  
  // 更新 timelineMaxMs
  $effect(() => {
    timelineMaxMs = calculatedTimelineMaxMs
  })
  
  function handleSeek(timeMs: number) {
    currentTimeMs = timeMs
    console.log('[Test] Seek to:', timeMs)
  }
  
  function togglePlay() {
    isPlaying = !isPlaying
  }
</script>

<div class="p-8 bg-gray-900 min-h-screen text-white">
  <h1 class="text-3xl font-bold mb-6">Studio Timeline 测试 - 4秒视频</h1>
  
  <!-- 计算方式选择 -->
  <div class="mb-6 p-4 bg-gray-800 rounded">
    <h3 class="text-lg font-semibold mb-3">timelineMaxMs 计算方式</h3>
    <div class="grid grid-cols-2 gap-3">
      <label class="flex items-center gap-2">
        <input
          type="radio"
          bind:group={calculationMethod}
          value="frames-30"
          class="w-4 h-4"
        />
        <span>120帧 @ 30fps (4.000秒)</span>
      </label>
      <label class="flex items-center gap-2 text-yellow-400">
        <input
          type="radio"
          bind:group={calculationMethod}
          value="frames-29.97"
          class="w-4 h-4"
        />
        <span>120帧 @ 29.97fps (4.004秒) ⚠️</span>
      </label>
      <label class="flex items-center gap-2 text-yellow-400">
        <input
          type="radio"
          bind:group={calculationMethod}
          value="frames-121"
          class="w-4 h-4"
        />
        <span>121帧 @ 30fps (4.033秒) ⚠️</span>
      </label>
      <label class="flex items-center gap-2">
        <input
          type="radio"
          bind:group={calculationMethod}
          value="duration"
          class="w-4 h-4"
        />
        <span>直接时长 (4000ms)</span>
      </label>
    </div>
    <div class="mt-2 text-sm text-gray-400">
      ⚠️ 标记的选项可能产生重复刻度（修复前）
    </div>
  </div>
  
  <!-- 调试信息 -->
  <div class="mb-6 p-4 bg-gray-800 rounded">
    <h3 class="text-lg font-semibold mb-3">调试信息</h3>
    <div class="grid grid-cols-2 gap-2 text-sm font-mono">
      <div>计算方式: {calculationMethod}</div>
      <div>totalFramesAll: {totalFramesAll}</div>
      <div>frameRate: {frameRate}</div>
      <div>durationMs: {durationMs}</div>
      <div class="col-span-2 text-yellow-400">
        calculatedTimelineMaxMs: {calculatedTimelineMaxMs}ms ({calculatedTimelineMaxMs / 1000}秒)
      </div>
      <div>currentTimeMs: {currentTimeMs}ms</div>
      <div>isPlaying: {isPlaying}</div>
    </div>
  </div>
  
  <!-- 预期刻度 -->
  <div class="mb-6 p-4 bg-gray-800 rounded">
    <h3 class="text-lg font-semibold mb-3">预期刻度</h3>
    <div class="text-sm">
      {#if calculationMethod === 'frames-30'}
        <div>应该显示: <span class="text-green-400">00:00, 00:01, 00:02, 00:03, 00:04</span></div>
      {:else if calculationMethod === 'frames-29.97'}
        <div>应该显示: <span class="text-green-400">00:00, 00:01, 00:02, 00:03, 00:04</span></div>
        <div class="text-yellow-400 mt-1">注意: 4.004秒，最后刻度不应重复</div>
      {:else if calculationMethod === 'frames-121'}
        <div>应该显示: <span class="text-green-400">00:00, 00:01, 00:02, 00:03, 00:04</span></div>
        <div class="text-yellow-400 mt-1">注意: 4.033秒，最后刻度不应重复</div>
      {:else}
        <div>应该显示: <span class="text-green-400">00:00, 00:01, 00:02, 00:03, 00:04</span></div>
      {/if}
      <div class="text-red-400 mt-2">⚠️ 问题: 时间线最后没有显示刻度</div>
    </div>
  </div>
  
  <!-- Timeline 组件 -->
  <div class="bg-gray-800 p-6 rounded">
    <div class="flex justify-between items-center mb-4">
      <button 
        onclick={togglePlay}
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
      >
        {isPlaying ? '暂停' : '播放'}
      </button>
      <div class="text-sm">
        当前时间: {(currentTimeMs / 1000).toFixed(2)}秒
      </div>
    </div>
    
    <Timeline
      {timelineMaxMs}
      {currentTimeMs}
      {frameRate}
      {isPlaying}
      onSeek={handleSeek}
    />
  </div>
  
  <!-- 刻度检查 -->
  <div class="mt-6 p-4 bg-gray-800 rounded">
    <h3 class="text-lg font-semibold mb-3">刻度检查</h3>
    <div class="text-sm text-gray-400">
      打开浏览器控制台，查看 [Timeline] Generated markers 日志
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
  }
</style>

