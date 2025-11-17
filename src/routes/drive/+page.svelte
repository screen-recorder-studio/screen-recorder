<script lang="ts">
  import { onMount } from 'svelte'
  import { Folder } from '@lucide/svelte'
  import RecordingList from '$lib/components/drive/RecordingList.svelte'
  import { formatBytes, formatTime, formatDate } from '$lib/utils/format'

  // Recording summary type definition
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

  // State management
  let recordings = $state<RecordingSummary[]>([])
  let isLoading = $state(true)
  let errorMessage = $state('')

  // Load all recordings
  async function loadRecordings() {
    try {
      isLoading = true
      errorMessage = ''
      
      // Check OPFS support
      if (!navigator.storage?.getDirectory) {
        throw new Error('Your browser does not support OPFS storage')
      }

      const root = await navigator.storage.getDirectory()
      const recordingList: RecordingSummary[] = []

      // Iterate through all directories starting with 'rec_' (using values() for TS DOM compatibility)
      for await (const handle of (root as any).values()) {
        const name = (handle as any).name as string
        if (name?.startsWith('rec_') && handle.kind === 'directory') {
          try {
            const meta = await readMetaJson(handle as FileSystemDirectoryHandle)
            const summary = await createRecordingSummary(name, meta, handle as FileSystemDirectoryHandle)
            recordingList.push(summary)
          } catch (error) {
            console.warn(`Failed to read recording ${name}:`, error)
          }
        }
      }

      // Sort by creation time (newest first)
      recordings = recordingList.sort((a, b) => b.createdAt - a.createdAt)
      
    } catch (error: any) {
      console.error('Failed to load recordings:', error)
      errorMessage = error.message || 'An error occurred while loading recordings'
    } finally {
      isLoading = false
    }
  }

  // Read meta.json file (throw error if not found to avoid performance issues from index.jsonl inference)
  async function readMetaJson(dirHandle: FileSystemDirectoryHandle): Promise<any> {
    try {
      const metaHandle = await dirHandle.getFileHandle('meta.json')
      const file = await metaHandle.getFile()
      const text = await file.text()
      return JSON.parse(text)
    } catch (error) {
      // Only rely on meta.json, skip directory if missing
      throw new Error('meta.json not found')
    }
  }

  // Infer metadata from index.jsonl (preserved but no longer called)
  async function inferMetaFromIndex(dirHandle: FileSystemDirectoryHandle): Promise<any> {
    try {
      const indexHandle = await dirHandle.getFileHandle('index.jsonl')
      const file = await indexHandle.getFile()
      const text = await file.text()
      const lines = text.split('\n').filter(Boolean)
      if (lines.length === 0) throw new Error('Empty recording file')
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
      throw new Error('Unable to read recording metadata')
    }
  }

  // Create recording summary (prioritize meta.totalBytes to avoid extra I/O)
  async function createRecordingSummary(
    dirName: string,
    meta: any,
    dirHandle: FileSystemDirectoryHandle
  ): Promise<RecordingSummary> {
    // Prioritize meta.totalBytes to avoid extra I/O
    let totalSize = typeof meta.totalBytes === 'number' ? Number(meta.totalBytes) : 0
    if (!totalSize) {
      try {
        const dataHandle = await dirHandle.getFileHandle('data.bin')
        const dataFile = await dataHandle.getFile()
        totalSize = dataFile.size
      } catch (error) {
        console.warn('Unable to get data file size:', error)
      }
    }

    const createdAt = Number(meta.createdAt) || Date.now()
    const width = Number(meta.width) || 1920
    const height = Number(meta.height) || 1080
    const totalChunks = Number(meta.totalChunks) || 0
    const fps = Number(meta.fps) || 30

    // 优先使用时间戳差值计算真实时长（与 Studio 时间线保持一致）
    let duration = 0
    const firstTimestamp = typeof meta.firstTimestamp === 'number' ? Number(meta.firstTimestamp) : null
    const lastTimestamp = typeof meta.lastTimestamp === 'number' ? Number(meta.lastTimestamp) : null

    if (firstTimestamp != null && lastTimestamp != null && lastTimestamp > firstTimestamp) {
      // writer 以微秒存储时间戳，这里转换为秒
      duration = Math.round((lastTimestamp - firstTimestamp) / 1_000_000)
    } else if (typeof meta.duration === 'number' && !Number.isNaN(meta.duration)) {
      const raw = Number(meta.duration)
      if (raw > 0) {
        const daySec = 24 * 60 * 60
        if (raw < daySec) {
          // 旧版本：直接存秒
          duration = Math.round(raw)
        } else if (raw < daySec * 1000) {
          // 旧版本：毫秒
          duration = Math.round(raw / 1000)
        } else {
          // 新版本：微秒（或更大的时间戳），统一按微秒处理
          duration = Math.round(raw / 1_000_000)
        }
      }
    }

    // 最后兜底：根据总帧数和 fps 估算（用于极少数缺失时间戳的旧录制）
    if (!duration && totalChunks && fps) {
      duration = Math.round(totalChunks / fps)
    }

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

  // Infer frame rate
  function inferFPS(lines: string[]): number {
    if (lines.length < 2) return 30
    
    const deltas: number[] = []
    for (let i = 1; i < Math.min(lines.length, 61); i++) {
      const prev = JSON.parse(lines[i - 1])
      const curr = JSON.parse(lines[i])
      deltas.push((curr.timestamp - prev.timestamp) / 1000) // Convert microseconds to milliseconds
    }
    
    deltas.sort((a, b) => a - b)
    const medianMs = deltas[Math.floor(deltas.length / 2)] || 33.3
    return Math.max(1, Math.min(120, Math.round(1000 / Math.max(1, medianMs))))
  }

  // Generate friendly display name
  function generateDisplayName(timestamp: number): string {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    const second = String(date.getSeconds()).padStart(2, '0')
    
    return `Screen Recording ${year}-${month}-${day} ${hour}:${minute}:${second}`
  }

  // Delete recording
  async function deleteRecording(recordingId: string) {
    try {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(recordingId, { recursive: true })
      
      // Remove from list
      recordings = recordings.filter(r => r.id !== recordingId)
      
      console.log(`Recording ${recordingId} deleted`)
    } catch (error: any) {
      console.error('Failed to delete recording:', error)
      errorMessage = `Delete failed: ${error.message}`
    }
  }

  // Batch delete selected recordings
  async function deleteSelectedRecordings(recordingIds: string[]) {
    let successCount = 0
    
    for (const id of recordingIds) {
      try {
        await deleteRecording(id)
        successCount++
      } catch (error) {
        console.error(`Failed to delete ${id}:`, error)
      }
    }
    
    if (successCount > 0) {
      console.log(`Successfully deleted ${successCount} recordings`)
    }
  }

  // Clear error message
  function clearError() {
    errorMessage = ''
  }

  // Refresh list
  function refreshRecordings() {
    loadRecordings()
  }

  // Load data when component mounts
  onMount(() => {
    loadRecordings()
  })
</script>

<svelte:head>
  <title>Recordings - Screen Recorder Extension</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
  <!-- Header -->
  <div class="bg-white border-b border-gray-200 px-6 py-4">
    <div class="max-w-6xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Folder class="w-6 h-6 text-gray-700" />
        <h1 class="text-2xl font-bold text-gray-900">Recording Manager</h1>
      </div>
    </div>
  </div>

  <!-- Recording list component -->
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