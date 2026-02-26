<script lang="ts">
  import { onMount } from 'svelte'

  interface ChunkRecord {
    offset: number
    size: number
    timestamp: number
    type: 'key' | 'delta'
    codedWidth?: number
    codedHeight?: number
    codec?: string
    isKeyframe?: boolean
  }

  interface AnalysisResult {
    totalChunks: number
    keyframeCount: number
    keyframeRatio: number
    avgKeyframeInterval: number
    firstTimestamp: number
    lastTimestamp: number
    durationMs: number
    chunks: ChunkRecord[]
    keyframeIndices: number[]
    keyframeDistribution: { index: number, timestamp: number, interval: number }[]
    diagnostics?: {
      typeKeyCount: number
      isKeyframeTrueCount: number
      isKeyframeFalseCount: number
      isKeyframeUndefinedCount: number
      inconsistentCount: number
    }
  }

  let recordingId = $state('1757663451349')
  let analysis: AnalysisResult | null = $state(null)
  let loading = $state(false)
  let error = $state('')
  let selectedChunk: ChunkRecord | null = $state(null)
  let showOnlyKeyframes = $state(false)

  async function analyzeRecording() {
    if (!recordingId.trim()) {
      error = '请输入录制ID'
      return
    }

    loading = true
    error = ''
    analysis = null

    try {
      // 获取OPFS根目录
      const opfsRoot = await navigator.storage.getDirectory()
      const recDir = await opfsRoot.getDirectoryHandle(`rec_${recordingId}`)
      
      // 读取index.jsonl文件
      const indexFile = await recDir.getFileHandle('index.jsonl')
      const file = await indexFile.getFile()
      const text = await file.text()
      
      // 解析每一行
      const lines = text.split(/\r?\n/).filter(Boolean)
      const chunks: ChunkRecord[] = []
      
      for (let i = 0; i < lines.length; i++) {
        try {
          const chunk = JSON.parse(lines[i]) as ChunkRecord
          chunks.push(chunk)
        } catch (parseError) {
          console.warn(`解析第${i + 1}行失败:`, parseError)
        }
      }

      if (chunks.length === 0) {
        throw new Error('没有找到有效的chunk记录')
      }

      // 分析关键帧
      const keyframeIndices: number[] = []
      const keyframeDistribution: { index: number, timestamp: number, interval: number }[] = []
      
      chunks.forEach((chunk, index) => {
        if (chunk.type === 'key' || chunk.isKeyframe === true) {
          keyframeIndices.push(index)
          
          const prevKeyframeIndex = keyframeDistribution.length > 0 ? 
            keyframeDistribution[keyframeDistribution.length - 1].index : 0
          const interval = index - prevKeyframeIndex
          
          keyframeDistribution.push({
            index,
            timestamp: chunk.timestamp,
            interval
          })
        }
      })

      const firstTimestamp = chunks[0]?.timestamp || 0
      const lastTimestamp = chunks[chunks.length - 1]?.timestamp || 0
      const durationMs = Math.round((lastTimestamp - firstTimestamp) / 1000) // 微秒转毫秒

      analysis = {
        totalChunks: chunks.length,
        keyframeCount: keyframeIndices.length,
        keyframeRatio: (keyframeIndices.length / chunks.length) * 100,
        avgKeyframeInterval: keyframeIndices.length > 1 ? 
          (keyframeIndices[keyframeIndices.length - 1] - keyframeIndices[0]) / (keyframeIndices.length - 1) : 0,
        firstTimestamp,
        lastTimestamp,
        durationMs,
        chunks,
        keyframeIndices,
        keyframeDistribution
      }

      // 诊断关键帧标注一致性
      const diagnostics = {
        typeKeyCount: chunks.filter(c => c.type === 'key').length,
        isKeyframeTrueCount: chunks.filter(c => c.isKeyframe === true).length,
        isKeyframeFalseCount: chunks.filter(c => c.isKeyframe === false).length,
        isKeyframeUndefinedCount: chunks.filter(c => c.isKeyframe === undefined).length,
        inconsistentCount: chunks.filter(c =>
          (c.type === 'key' && c.isKeyframe === false) ||
          (c.type === 'delta' && c.isKeyframe === true)
        ).length
      }

      analysis.diagnostics = diagnostics
      console.log('关键帧分析结果:', analysis)

    } catch (err: any) {
      error = `分析失败: ${err.message}`
      console.error('分析错误:', err)
    } finally {
      loading = false
    }
  }

  function formatTimestamp(timestamp: number): string {
    const ms = Math.round(timestamp / 1000)
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    const remainingMs = ms % 1000
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${remainingMs.toString().padStart(3, '0')}`
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const filteredChunks = $derived(() => {
    try {
      if (!analysis || !analysis.chunks || !Array.isArray(analysis.chunks)) return []
      if (!showOnlyKeyframes) return analysis.chunks
      return analysis.chunks.filter(chunk => chunk.type === 'key' || chunk.isKeyframe === true)
    } catch (error) {
      console.error('Error in filteredChunks:', error)
      return []
    }
  })

  // 生成关键帧可视化数据
  const keyframeVisualization = $derived(() => {
    try {
      if (!analysis || !analysis.keyframeDistribution || !Array.isArray(analysis.keyframeDistribution) || analysis.keyframeDistribution.length === 0) {
        return []
      }

      const intervals = analysis.keyframeDistribution.map(k => k.interval).filter(i => i > 0)
      if (intervals.length === 0) return []

      const maxInterval = Math.max(...intervals)
      const result = analysis.keyframeDistribution.map(keyframe => ({
        ...keyframe,
        normalizedInterval: maxInterval > 0 ? keyframe.interval / maxInterval : 0,
        color: keyframe.interval > analysis.avgKeyframeInterval * 1.5 ? 'red' :
               keyframe.interval < analysis.avgKeyframeInterval * 0.5 ? 'blue' : 'green'
      }))

      console.log('keyframeVisualization result:', result)
      return result
    } catch (error) {
      console.error('Error in keyframeVisualization:', error)
      return []
    }
  })

  onMount(() => {
    // 自动分析默认录制ID
    if (recordingId) {
      analyzeRecording()
    }
  })
</script>

<div class="container mx-auto p-6 max-w-7xl">
  <h1 class="text-3xl font-bold mb-6">关键帧分析器</h1>
  
  <!-- 输入区域 -->
  <div class="bg-white rounded-lg shadow-md p-6 mb-6">
    <div class="flex gap-4 items-end">
      <div class="flex-1">
        <label for="recording-id" class="block text-sm font-medium text-gray-700 mb-2">
          录制ID (不含 rec_ 前缀)
        </label>
        <input
          id="recording-id"
          type="text"
          bind:value={recordingId}
          placeholder="例如: 1757663451349"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <button
        onclick={analyzeRecording}
        disabled={loading}
        class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? '分析中...' : '分析'}
      </button>
    </div>
    
    {#if error}
      <div class="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
        {error}
      </div>
    {/if}
  </div>

  {#if analysis}
    <!-- 统计信息 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-lg shadow-md p-4">
        <h3 class="text-lg font-semibold text-gray-800">总帧数</h3>
        <p class="text-2xl font-bold text-blue-600">{analysis.totalChunks}</p>
      </div>
      
      <div class="bg-white rounded-lg shadow-md p-4">
        <h3 class="text-lg font-semibold text-gray-800">关键帧数量</h3>
        <p class="text-2xl font-bold text-green-600">{analysis.keyframeCount}</p>
        <p class="text-sm text-gray-500">{analysis.keyframeRatio.toFixed(1)}%</p>
      </div>
      
      <div class="bg-white rounded-lg shadow-md p-4">
        <h3 class="text-lg font-semibold text-gray-800">平均间隔</h3>
        <p class="text-2xl font-bold text-purple-600">{analysis.avgKeyframeInterval.toFixed(1)}</p>
        <p class="text-sm text-gray-500">帧</p>
      </div>
      
      <div class="bg-white rounded-lg shadow-md p-4">
        <h3 class="text-lg font-semibold text-gray-800">总时长</h3>
        <p class="text-2xl font-bold text-orange-600">{formatTimestamp(analysis.durationMs * 1000)}</p>
      </div>
    </div>

    <!-- 诊断信息 -->
    {#if analysis.diagnostics}
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 class="text-xl font-semibold mb-4">关键帧标注诊断</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div class="bg-blue-50 rounded-lg p-4">
            <h3 class="font-medium text-blue-800">type='key' 标记</h3>
            <p class="text-2xl font-bold text-blue-600">{analysis.diagnostics.typeKeyCount}</p>
          </div>

          <div class="bg-green-50 rounded-lg p-4">
            <h3 class="font-medium text-green-800">isKeyframe=true</h3>
            <p class="text-2xl font-bold text-green-600">{analysis.diagnostics.isKeyframeTrueCount}</p>
          </div>

          <div class="bg-gray-50 rounded-lg p-4">
            <h3 class="font-medium text-gray-800">isKeyframe=false</h3>
            <p class="text-2xl font-bold text-gray-600">{analysis.diagnostics.isKeyframeFalseCount}</p>
          </div>

          <div class="bg-yellow-50 rounded-lg p-4">
            <h3 class="font-medium text-yellow-800">isKeyframe=undefined</h3>
            <p class="text-2xl font-bold text-yellow-600">{analysis.diagnostics.isKeyframeUndefinedCount}</p>
          </div>

          <div class="bg-red-50 rounded-lg p-4">
            <h3 class="font-medium text-red-800">标注不一致</h3>
            <p class="text-2xl font-bold text-red-600">{analysis.diagnostics.inconsistentCount}</p>
            <p class="text-xs text-red-500">type与isKeyframe冲突</p>
          </div>

          <div class="bg-purple-50 rounded-lg p-4">
            <h3 class="font-medium text-purple-800">标注覆盖率</h3>
            <p class="text-2xl font-bold text-purple-600">
              {((analysis.totalChunks - analysis.diagnostics.isKeyframeUndefinedCount) / analysis.totalChunks * 100).toFixed(1)}%
            </p>
          </div>
        </div>

        {#if analysis.diagnostics.inconsistentCount > 0}
          <div class="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            ⚠️ 发现 {analysis.diagnostics.inconsistentCount} 个标注不一致的记录，建议检查数据质量
          </div>
        {/if}
      </div>
    {/if}

    <!-- 关键帧分布可视化 -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">关键帧分布可视化</h2>

      <!-- 间隔分布图 -->
      <div class="mb-6">
        <h3 class="text-lg font-medium mb-2">关键帧间隔分布</h3>
        {#if analysis.keyframeCount >= 2}
          <div class="h-32 bg-gray-50 rounded p-4 overflow-x-auto">
            <div class="flex items-end h-full min-w-max gap-1">
              {#each Array.isArray(keyframeVisualization) ? keyframeVisualization.slice(1, 50) : [] as keyframe, i}
                <div
                  class="flex flex-col items-center"
                  title="帧{keyframe.index}: 间隔{keyframe.interval}帧"
                >
                  <div
                    class="w-3 rounded-t transition-all hover:opacity-80"
                    style="height: {keyframe.normalizedInterval * 80}px; background-color: {keyframe.color};"
                  ></div>
                  <span class="text-xs text-gray-500 mt-1 transform -rotate-45 origin-top-left">
                    {keyframe.index}
                  </span>
                </div>
              {/each}
            </div>
          </div>
          <div class="flex justify-between text-xs text-gray-500 mt-2">
            <span>🔵 短间隔 (&lt;{(analysis.avgKeyframeInterval * 0.5).toFixed(0)})</span>
            <span>🟢 正常间隔</span>
            <span>🔴 长间隔 (&gt;{(analysis.avgKeyframeInterval * 1.5).toFixed(0)})</span>
          </div>
        {:else}
          <div class="h-32 bg-gray-50 rounded p-4 flex items-center justify-center">
            <div class="text-center text-gray-500">
              <p class="text-lg">⚠️ 关键帧数量不足</p>
              <p class="text-sm">需要至少2个关键帧才能显示间隔分布</p>
              <p class="text-xs mt-2">当前关键帧数量: {analysis.keyframeCount}</p>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- 关键帧分布表格 -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">关键帧分布详情</h2>
      <div class="overflow-x-auto">
        <table class="min-w-full table-auto">
          <thead>
            <tr class="bg-gray-50">
              <th class="px-4 py-2 text-left">序号</th>
              <th class="px-4 py-2 text-left">帧索引</th>
              <th class="px-4 py-2 text-left">时间戳</th>
              <th class="px-4 py-2 text-left">间隔</th>
              <th class="px-4 py-2 text-left">大小</th>
            </tr>
          </thead>
          <tbody>
            {#each Array.isArray(analysis.keyframeDistribution) ? analysis.keyframeDistribution.slice(0, 20) : [] as keyframe, i}
              <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-2">{i + 1}</td>
                <td class="px-4 py-2 font-mono">{keyframe.index}</td>
                <td class="px-4 py-2 font-mono">{formatTimestamp(keyframe.timestamp)}</td>
                <td class="px-4 py-2">{keyframe.interval} 帧</td>
                <td class="px-4 py-2">{formatBytes(analysis.chunks[keyframe.index]?.size || 0)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if analysis.keyframeDistribution.length > 20}
          <p class="text-sm text-gray-500 mt-2">
            显示前20个关键帧，共{analysis.keyframeDistribution.length}个
          </p>
        {/if}
      </div>
    </div>

    <!-- 详细记录 -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold">详细记录</h2>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            bind:checked={showOnlyKeyframes}
            class="rounded"
          />
          <span class="text-sm">仅显示关键帧</span>
        </label>
      </div>
      
      <div class="overflow-x-auto max-h-96 overflow-y-auto">
        <table class="min-w-full table-auto text-sm">
          <thead class="sticky top-0 bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left">索引</th>
              <th class="px-3 py-2 text-left">类型</th>
              <th class="px-3 py-2 text-left">关键帧</th>
              <th class="px-3 py-2 text-left">时间戳</th>
              <th class="px-3 py-2 text-left">大小</th>
              <th class="px-3 py-2 text-left">编码尺寸</th>
              <th class="px-3 py-2 text-left">编码器</th>
            </tr>
          </thead>
          <tbody>
            {#each Array.isArray(filteredChunks) ? filteredChunks.slice(0, 200) : [] as chunk, i}
              {@const isKeyframe = chunk.type === 'key' || chunk.isKeyframe === true}
              <tr 
                class="border-b hover:bg-gray-50 cursor-pointer {isKeyframe ? 'bg-green-50' : ''}"
                onclick={() => selectedChunk = chunk}
              >
                <td class="px-3 py-2 font-mono">{analysis.chunks.indexOf(chunk)}</td>
                <td class="px-3 py-2">
                  <span class="px-2 py-1 rounded text-xs {chunk.type === 'key' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
                    {chunk.type}
                  </span>
                </td>
                <td class="px-3 py-2">
                  {#if chunk.isKeyframe === true}
                    <span class="text-green-600">✓</span>
                  {:else if chunk.isKeyframe === false}
                    <span class="text-red-600">✗</span>
                  {:else}
                    <span class="text-gray-400">-</span>
                  {/if}
                </td>
                <td class="px-3 py-2 font-mono text-xs">{formatTimestamp(chunk.timestamp)}</td>
                <td class="px-3 py-2">{formatBytes(chunk.size)}</td>
                <td class="px-3 py-2 font-mono text-xs">
                  {chunk.codedWidth && chunk.codedHeight ? `${chunk.codedWidth}×${chunk.codedHeight}` : '-'}
                </td>
                <td class="px-3 py-2 text-xs">{chunk.codec || '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if filteredChunks.length > 200}
          <p class="text-sm text-gray-500 mt-2">
            显示前200条记录，共{filteredChunks.length}条
          </p>
        {/if}
      </div>
    </div>

    <!-- 选中记录详情 -->
    {#if selectedChunk}
      <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 class="text-lg font-semibold mb-4">记录详情</h3>
          <div class="space-y-2 text-sm">
            <div><strong>偏移量:</strong> {selectedChunk.offset}</div>
            <div><strong>大小:</strong> {formatBytes(selectedChunk.size)}</div>
            <div><strong>时间戳:</strong> {selectedChunk.timestamp} ({formatTimestamp(selectedChunk.timestamp)})</div>
            <div><strong>类型:</strong> {selectedChunk.type}</div>
            <div><strong>关键帧标记:</strong> {selectedChunk.isKeyframe ?? '未设置'}</div>
            <div><strong>编码尺寸:</strong> {selectedChunk.codedWidth && selectedChunk.codedHeight ? `${selectedChunk.codedWidth}×${selectedChunk.codedHeight}` : '未设置'}</div>
            <div><strong>编码器:</strong> {selectedChunk.codec || '未设置'}</div>
          </div>
          <button
            onclick={() => selectedChunk = null}
            class="mt-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            关闭
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .container {
    min-height: 100vh;
    background-color: #f9fafb;
  }
</style>
