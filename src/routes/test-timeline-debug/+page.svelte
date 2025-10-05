<script lang="ts">
  import { onMount } from 'svelte'
  
  // 手动实现时间刻度生成逻辑
  let timelineMaxMs = $state(60000) // 1分钟
  let durationSec = $derived(timelineMaxMs / 1000)
  
  interface TimeMarker {
    timeSec: number
    timeMs: number
    timeLabel?: string
    isMajor: boolean
    position: number
  }
  
  function calculateTickInterval(durationSec: number): { major: number; minor: number } {
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
    const minTicks = 5
    const maxTicks = 10
    const idealTicks = 7

    let bestMajor = 1
    let bestScore = -Infinity

    for (const interval of candidates) {
      const tickCount = Math.ceil(durationSec / interval) + 1
      if (tickCount < minTicks || tickCount > maxTicks) continue

      let score = 0
      const tickDiff = Math.abs(tickCount - idealTicks)
      score += (1 - tickDiff / idealTicks) * 50

      const remainder = durationSec % interval
      const divisibilityScore = (1 - remainder / interval) * 30
      score += divisibilityScore

      const commonIntervals = [1, 2, 5, 10, 30, 60]
      if (commonIntervals.includes(interval)) {
        score += 20
      }

      if (score > bestScore) {
        bestScore = score
        bestMajor = interval
      }
    }

    let bestMinor: number
    if (bestMajor >= 10) {
      bestMinor = bestMajor / 5
    } else if (bestMajor >= 5) {
      bestMinor = bestMajor / 5
    } else {
      bestMinor = bestMajor / 2
    }

    return { major: bestMajor, minor: bestMinor }
  }
  
  function formatTimeSec(sec: number): string {
    const total = Math.max(0, sec)
    const mm = Math.floor(total / 60)
    const ss = Math.floor(total % 60)
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }
  
  const timeMarkers = $derived.by((): TimeMarker[] => {
    if (durationSec <= 0) {
      console.log('[Debug] No markers: durationSec =', durationSec)
      return []
    }
    
    const markers: TimeMarker[] = []
    const { major, minor } = calculateTickInterval(durationSec)
    
    console.log('[Debug] Generating markers:', {
      durationSec,
      major,
      minor,
      timelineMaxMs
    })
    
    // 生成主要刻度（带时间标签）
    for (let t = 0; t <= durationSec; t += major) {
      markers.push({
        timeSec: t,
        timeMs: t * 1000,
        timeLabel: formatTimeSec(t),
        isMajor: true,
        position: (t / durationSec) * 100
      })
    }

    // 确保最后一个刻度（视频结束点）总是存在
    const lastMarker = markers[markers.length - 1]
    const TOLERANCE = 0.01
    const endLabel = formatTimeSec(durationSec)

    if (!lastMarker) {
      markers.push({
        timeSec: durationSec,
        timeMs: durationSec * 1000,
        timeLabel: endLabel,
        isMajor: true,
        position: 100
      })
    } else {
      const timeDiff = durationSec - lastMarker.timeSec
      const labelDiff = lastMarker.timeLabel !== endLabel

      if (timeDiff > TOLERANCE && labelDiff) {
        markers.push({
          timeSec: durationSec,
          timeMs: durationSec * 1000,
          timeLabel: endLabel,
          isMajor: true,
          position: 100
        })
      }
    }

    // 生成次要刻度（不带标签）
    for (let t = minor; t < durationSec; t += minor) {
      if (t % major !== 0) {
        markers.push({
          timeSec: t,
          timeMs: t * 1000,
          isMajor: false,
          position: (t / durationSec) * 100
        })
      }
    }
    
    console.log('[Debug] Generated markers:', {
      total: markers.length,
      major: markers.filter(m => m.isMajor).length,
      minor: markers.filter(m => !m.isMajor).length,
      allMarkers: markers
    })
    
    return markers.sort((a, b) => a.timeSec - b.timeSec)
  })
  
  onMount(() => {
    console.log('[Debug] Component mounted')
    console.log('[Debug] timelineMaxMs:', timelineMaxMs)
    console.log('[Debug] durationSec:', durationSec)
    console.log('[Debug] timeMarkers:', timeMarkers)
    
    // 检查 DOM 元素
    setTimeout(() => {
      const container = document.querySelector('.time-markers')
      console.log('[Debug] Container:', container)
      const markers = document.querySelectorAll('.marker')
      console.log('[Debug] Marker elements:', markers.length)
      markers.forEach((el, i) => {
        console.log(`[Debug] Marker ${i}:`, {
          left: (el as HTMLElement).style.left,
          innerHTML: el.innerHTML,
          classList: el.classList.toString()
        })
      })
    }, 100)
  })
</script>

<div class="container">
  <h1>Timeline 刻度调试</h1>
  
  <div class="controls">
    <label>
      时长 (毫秒):
      <input type="number" bind:value={timelineMaxMs} step="1000" min="1000" />
    </label>
    <div>时长: {durationSec}秒</div>
  </div>
  
  <div class="info">
    <h3>计算信息</h3>
    <div>durationSec: {durationSec}</div>
    <div>刻度间隔: {JSON.stringify(calculateTickInterval(durationSec))}</div>
    <div>生成的刻度数量: {timeMarkers.length}</div>
    <div>主刻度数量: {timeMarkers.filter(m => m.isMajor).length}</div>
    <div>次刻度数量: {timeMarkers.filter(m => !m.isMajor).length}</div>
  </div>
  
  <div class="timeline-wrapper">
    <h3>时间轴渲染</h3>
    
    <!-- 手动实现的时间刻度 -->
    <div class="time-markers">
      {#each timeMarkers as marker (marker.timeMs)}
        <div 
          class="marker" 
          class:major={marker.isMajor}
          style="left: {marker.position}%"
        >
          {#if marker.isMajor && marker.timeLabel}
            <span class="marker-label">{marker.timeLabel}</span>
          {/if}
        </div>
      {/each}
    </div>
    
    <!-- 时间轴轨道 -->
    <div class="timeline-track"></div>
  </div>
  
  <div class="marker-list">
    <h3>刻度列表</h3>
    <table>
      <thead>
        <tr>
          <th>索引</th>
          <th>时间(秒)</th>
          <th>标签</th>
          <th>类型</th>
          <th>位置(%)</th>
        </tr>
      </thead>
      <tbody>
        {#each timeMarkers as marker, i}
          <tr>
            <td>{i}</td>
            <td>{marker.timeSec}</td>
            <td>{marker.timeLabel || '-'}</td>
            <td>{marker.isMajor ? '主' : '次'}</td>
            <td>{marker.position.toFixed(2)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
    background: #1f2937;
    min-height: 100vh;
    color: white;
  }
  
  h1, h3 {
    color: #60a5fa;
    margin-bottom: 1rem;
  }
  
  .controls {
    background: #374151;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }
  
  .controls label {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  
  .controls input {
    padding: 0.5rem;
    background: #1f2937;
    color: white;
    border: 1px solid #4b5563;
    border-radius: 0.25rem;
  }
  
  .info {
    background: #374151;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
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
  
  /* 时间刻度样式 - 复制自 Timeline.svelte */
  .time-markers {
    position: relative;
    width: 100%;
    height: 2.5rem;
    margin-bottom: 0.5rem;
    background: rgba(255, 255, 255, 0.05); /* 添加背景以便查看 */
  }
  
  .marker {
    position: absolute;
    bottom: 0;
    transform: translateX(-50%);
  }
  
  .marker.major {
    height: 0.5rem;
    border-left: 1px solid #9ca3af;
  }
  
  .marker-label {
    position: absolute;
    bottom: 0.75rem;
    left: 50%;
    transform: translateX(-50%);
    width: 3rem;
    text-align: center;
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
    color: #9ca3af;
    white-space: nowrap;
  }
  
  .marker:not(.major) {
    height: 0.25rem;
    border-left: 1px solid #4b5563;
  }
  
  .timeline-track {
    position: relative;
    width: 100%;
    height: 2rem;
    background-color: #374151;
    border-radius: 0.25rem;
  }
  
  .marker-list {
    background: #374151;
    padding: 1rem;
    border-radius: 0.5rem;
  }
  
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
  }
  
  th, td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid #4b5563;
  }
  
  th {
    background: #1f2937;
    font-weight: 600;
  }
  
  tr:hover {
    background: #1f2937;
  }
</style>

