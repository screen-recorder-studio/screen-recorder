<script lang="ts">
  import { onMount } from 'svelte'
  import { Folder } from '@lucide/svelte'
  import RecordingList from '$lib/components/drive/RecordingList.svelte'
  import { formatBytes, formatTime, formatDate } from '$lib/utils/format'

  // 录制记录类型定义
  interface RecordingSummary {
    id: string
    displayName: string
    createdAt: number
    duration: number
    resolution: string
    size: number
    totalChunks: number
    codec?: string
    fps?: number
    thumbnail?: string
    meta?: any
  }

  // 状态管理
  let recordings = $state<RecordingSummary[]>([])
  let isLoading = $state(true)
  let errorMessage = $state('')

  // 获取所有录制记录
  async function loadRecordings() {
    try {
      isLoading = true
      errorMessage = ''
      
      // 检查OPFS支持
      if (!navigator.storage?.getDirectory) {
        throw new Error('您的浏览器不支持 OPFS 存储功能')
      }

      const root = await navigator.storage.getDirectory()
      const recordingList: RecordingSummary[] = []

      // 遍历所有 rec_ 开头的目录（使用 values() 以兼容 TS DOM 类型）
      for await (const handle of (root as any).values()) {
        const name = (handle as any).name as string
        if (name?.startsWith('rec_') && handle.kind === 'directory') {
          try {
            const meta = await readMetaJson(handle as FileSystemDirectoryHandle)
            const summary = await createRecordingSummary(name, meta, handle as FileSystemDirectoryHandle)
            recordingList.push(summary)
          } catch (error) {
            console.warn(`读取录制 ${name} 失败:`, error)
          }
        }
      }

      // 按创建时间倒序排列
      recordings = recordingList.sort((a, b) => b.createdAt - a.createdAt)
      
    } catch (error: any) {
      console.error('加载录制记录失败:', error)
      errorMessage = error.message || '加载录制记录时发生错误'
    } finally {
      isLoading = false
    }
  }

  // 读取meta.json文件（若不存在则抛错，避免从 index.jsonl 推断造成卡顿/崩溃）
  async function readMetaJson(dirHandle: FileSystemDirectoryHandle): Promise<any> {
    try {
      const metaHandle = await dirHandle.getFileHandle('meta.json')
      const file = await metaHandle.getFile()
      const text = await file.text()
      return JSON.parse(text)
    } catch (error) {
      // 仅依赖 meta.json，缺失则交由调用方跳过该目录
      throw new Error('meta.json 不存在')
    }
  }

  // 从index.jsonl推断元数据（保留但不再被调用）
  async function inferMetaFromIndex(dirHandle: FileSystemDirectoryHandle): Promise<any> {
    try {
      const indexHandle = await dirHandle.getFileHandle('index.jsonl')
      const file = await indexHandle.getFile()
      const text = await file.text()
      const lines = text.split('\n').filter(Boolean)
      if (lines.length === 0) throw new Error('空的录制文件')
      const firstEntry = JSON.parse(lines[0])
      const lastEntry = JSON.parse(lines[lines.length - 1])
      return {
        id: dirHandle.name,
        createdAt: Date.now(),
        completed: true,
        width: firstEntry.codedWidth || 1920,
        height: firstEntry.codedHeight || 1080,
        codec: firstEntry.codec || 'vp8',
        totalChunks: lines.length,
        duration: (lastEntry.timestamp - firstEntry.timestamp) / 1000000,
        fps: inferFPS(lines.slice(0, Math.min(60, lines.length)))
      }
    } catch (error) {
      throw new Error('无法读取录制元数据')
    }
  }

  // 创建录制摘要（优先使用 meta.json 中的 totalBytes，缺失时再读取 data.bin 大小）
  async function createRecordingSummary(
    dirName: string,
    meta: any,
    dirHandle: FileSystemDirectoryHandle
  ): Promise<RecordingSummary> {
    // 优先 meta.totalBytes，避免额外 I/O
    let totalSize = typeof meta.totalBytes === 'number' ? Number(meta.totalBytes) : 0
    if (!totalSize) {
      try {
        const dataHandle = await dirHandle.getFileHandle('data.bin')
        const dataFile = await dataHandle.getFile()
        totalSize = dataFile.size
      } catch (error) {
        console.warn('无法获取数据文件大小:', error)
      }
    }

    const createdAt = Number(meta.createdAt) || Date.now()
    const width = Number(meta.width) || 1920
    const height = Number(meta.height) || 1080
    const totalChunks = Number(meta.totalChunks) || 0
    const fps = Number(meta.fps) || 30
    const duration = typeof meta.duration === 'number' ? Number(meta.duration) : (totalChunks && fps ? Math.round(totalChunks / fps) : 0)

    const displayName = generateDisplayName(createdAt)

    return {
      id: dirName,
      displayName,
      createdAt,
      duration,
      resolution: `${width}×${height}`,
      size: totalSize,
      totalChunks,
      codec: meta.codec || 'vp8',
      fps,
      meta
    }
  }

  // 推断帧率
  function inferFPS(lines: string[]): number {
    if (lines.length < 2) return 30
    
    const deltas: number[] = []
    for (let i = 1; i < Math.min(lines.length, 61); i++) {
      const prev = JSON.parse(lines[i - 1])
      const curr = JSON.parse(lines[i])
      deltas.push((curr.timestamp - prev.timestamp) / 1000) // 微秒转毫秒
    }
    
    deltas.sort((a, b) => a - b)
    const medianMs = deltas[Math.floor(deltas.length / 2)] || 33.3
    return Math.max(1, Math.min(120, Math.round(1000 / Math.max(1, medianMs))))
  }

  // 生成友好的显示名称
  function generateDisplayName(timestamp: number): string {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    const second = String(date.getSeconds()).padStart(2, '0')
    
    return `屏幕录制 ${year}-${month}-${day} ${hour}:${minute}:${second}`
  }

  // 删除录制
  async function deleteRecording(recordingId: string) {
    try {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(recordingId, { recursive: true })
      
      // 从列表中移除
      recordings = recordings.filter(r => r.id !== recordingId)
      
      console.log(`录制 ${recordingId} 已删除`)
    } catch (error: any) {
      console.error('删除录制失败:', error)
      errorMessage = `删除失败: ${error.message}`
    }
  }

  // 批量删除选中的录制
  async function deleteSelectedRecordings(recordingIds: string[]) {
    let successCount = 0
    
    for (const id of recordingIds) {
      try {
        await deleteRecording(id)
        successCount++
      } catch (error) {
        console.error(`删除 ${id} 失败:`, error)
      }
    }
    
    if (successCount > 0) {
      console.log(`成功删除 ${successCount} 个录制`)
    }
  }

  // 清空错误信息
  function clearError() {
    errorMessage = ''
  }

  // 刷新列表
  function refreshRecordings() {
    loadRecordings()
  }

  // 组件挂载时加载数据
  onMount(() => {
    loadRecordings()
  })
</script>

<svelte:head>
  <title>录制记录 - 屏幕录制扩展</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
  <!-- 头部 -->
  <div class="bg-white border-b border-gray-200 px-6 py-4">
    <div class="max-w-6xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Folder class="w-6 h-6 text-gray-700" />
        <h1 class="text-2xl font-bold text-gray-900">录制管理</h1>
      </div>
    </div>
  </div>

  <!-- 录制列表组件 -->
  <RecordingList 
    {recordings}
    {isLoading}
    {errorMessage}
    onRefresh={refreshRecordings}
    onDeleteRecording={deleteRecording}
    onDeleteSelected={deleteSelectedRecordings}
    onClearError={clearError}
  />
</div>