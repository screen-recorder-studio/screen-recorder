<script lang="ts">
  import { onMount } from 'svelte'
  import { Edit, Trash2, Info } from '@lucide/svelte'
  import VideoPreview from '$lib/components/VideoPreview.svelte'

  // 新增状态：控制元数据显示（已不需要，改为 hover 显示）
  // let showMetadata = $state(false)

  // 组件属性
  interface Props {
    recording: {
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
    selected: boolean
    onToggleSelect: () => void
    onDelete: () => void
  }

  let { recording, selected, onToggleSelect, onDelete }: Props = $props()

  // 状态管理
  let thumbnailLoaded = $state(false)
  let thumbnailError = $state(false)
  let showPreview = $state(false)
  let previewComponent = $state<VideoPreview | null>(null)
  // 新增：预览需要的完整数据与加载状态
  let encodedChunks = $state<any[]>([])
  let isDecoding = $state(false)
  let hasLoadedFullData = $state(false)
  let loadError = $state<string | null>(null)

  // 格式化文件大小
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // 格式化时间
  function formatTime(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}秒`
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = Math.round(seconds % 60)
      return remainingSeconds > 0 ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`
    } else {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
    }
  }

  // 格式化日期
  function formatDate(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return '今天 ' + date.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    } else if (diffDays === 1) {
      return '昨天 ' + date.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    } else if (diffDays < 7) {
      return `${diffDays}天前`
    } else {
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    }
  }

  // 生成缩略图
  async function generateThumbnail(): Promise<string | null> {
    try {
      // 检查OPFS支持
      if (!navigator.storage?.getDirectory) {
        throw new Error('OPFS not supported')
      }

      const root = await navigator.storage.getDirectory()
      const recordingDir = await root.getDirectoryHandle(recording.id)
      
      // 读取第一个视频块
      const indexHandle = await recordingDir.getFileHandle('index.jsonl')
      const indexFile = await indexHandle.getFile()
      const indexText = await indexFile.text()
      const lines = indexText.split('\n').filter(Boolean)
      
      if (lines.length === 0) {
        throw new Error('No video chunks found')
      }

      const firstChunk = JSON.parse(lines[0])
      
      // 读取数据文件
      const dataHandle = await recordingDir.getFileHandle('data.bin')
      const dataFile = await dataHandle.getFile()
      const buffer = await dataFile.arrayBuffer()
      
      // 提取第一帧数据
      const chunkData = buffer.slice(firstChunk.offset, firstChunk.offset + firstChunk.size)
      
      // 使用 VideoDecoder 解码第一帧
      if ('VideoDecoder' in window) {
        return await decodeFirstFrame(chunkData, firstChunk)
      } else {
        throw new Error('WebCodecs not supported')
      }
      
    } catch (error) {
      console.warn('生成缩略图失败:', error)
      return null
    }
  }

  // 预览图尺寸上限（长边）
  const MAX_THUMBNAIL_LONG_EDGE = 480

  // 解码第一帧
  async function decodeFirstFrame(chunkData: ArrayBuffer, chunkInfo: any): Promise<string> {
    return new Promise((resolve, reject) => {
      let resolved = false
      
      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (resolved) {
            frame.close()
            return
          }
          resolved = true
          
          try {
            // 根据长边限制缩放尺寸，减少存储与内存占用
            const srcW = frame.codedWidth
            const srcH = frame.codedHeight
            const maxSide = Math.max(srcW, srcH)
            const ratio = maxSide > MAX_THUMBNAIL_LONG_EDGE ? (MAX_THUMBNAIL_LONG_EDGE / maxSide) : 1
            const dstW = Math.max(1, Math.round(srcW * ratio))
            const dstH = Math.max(1, Math.round(srcH * ratio))

            const canvas = document.createElement('canvas')
            canvas.width = dstW
            canvas.height = dstH
            const ctx = canvas.getContext('2d')!
            
            // 直接按目标尺寸绘制，浏览器会进行插值缩放
            ctx.drawImage(frame, 0, 0, dstW, dstH)
            frame.close()
            
            // 优先使用 WEBP（更小），不支持时回落到 JPEG
            let dataUrl = ''
            try {
              dataUrl = canvas.toDataURL('image/webp', 0.75)
            } catch {}
            if (!dataUrl.startsWith('data:image/webp')) {
              dataUrl = canvas.toDataURL('image/jpeg', 0.75)
            }
            resolve(dataUrl)
          } catch (error) {
            frame.close()
            reject(error)
          }
        },
        error: (error: Error) => {
          if (!resolved) {
            resolved = true
            reject(error)
          }
        }
      })

      try {
        // 配置解码器
        decoder.configure({
          codec: chunkInfo.codec || 'vp8',
          codedWidth: chunkInfo.codedWidth || recording.meta?.width || 1920,
          codedHeight: chunkInfo.codedHeight || recording.meta?.height || 1080
        })

        // 解码第一帧
        const chunk = new EncodedVideoChunk({
          type: chunkInfo.type || 'key',
          timestamp: chunkInfo.timestamp || 0,
          data: chunkData
        })

        decoder.decode(chunk)
        decoder.flush()
      } catch (error) {
        if (!resolved) {
          resolved = true
          reject(error)
        }
      }
    })
  }

  // 将 dataURL 转为 Blob
  function dataURLToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',')
    const mimeMatch = header.match(/data:(.*);base64/)
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }

  // 根据 dataURL 的 mime 选择封面文件名
  function pickCoverFilename(dataUrl: string): string {
    if (dataUrl.startsWith('data:image/webp')) return 'cover.webp'
    if (dataUrl.startsWith('data:image/png')) return 'cover.png'
    return 'cover.jpg'
  }

  // OPFS: 将封面写入缓存（根据 mime 写对应扩展名）
  async function writeCachedCoverFromDataURL(dataUrl: string): Promise<void> {
    try {
      if (!navigator.storage?.getDirectory) return
      const root = await navigator.storage.getDirectory()
      const recDir = await root.getDirectoryHandle(recording.id)
      const filename = pickCoverFilename(dataUrl)
      const fh = await recDir.getFileHandle(filename, { create: true })
      const writable = await fh.createWritable()
      const blob = dataURLToBlob(dataUrl)
      await writable.write(blob)
      await writable.close()
    } catch (e) {
      console.warn('写入封面缓存失败:', e)
    }
  }

  // 新增：加载完整预览数据（index.jsonl + data.bin）
  async function loadFullData() {
    if (hasLoadedFullData || isDecoding) return
    try {
      isDecoding = true
      loadError = null

      if (!navigator.storage?.getDirectory) {
        throw new Error('当前环境不支持 OPFS')
      }

      const root = await navigator.storage.getDirectory()
      const recDir = await root.getDirectoryHandle(recording.id)

      const [indexHandle, dataHandle] = await Promise.all([
        recDir.getFileHandle('index.jsonl'),
        recDir.getFileHandle('data.bin')
      ])

      const [indexFile, dataFile] = await Promise.all([
        indexHandle.getFile(),
        dataHandle.getFile()
      ])

      const [indexText, dataBuffer] = await Promise.all([
        indexFile.text(),
        dataFile.arrayBuffer()
      ])

      const lines = indexText.split('\n').filter(Boolean)
      const entries = lines
        .map((line, i) => {
          try { return JSON.parse(line) } catch (e) { console.warn(`index.jsonl 第 ${i} 行解析失败`, e); return null }
        })
        .filter(Boolean) as any[]

      if (entries.length === 0) {
        throw new Error('index.jsonl 为空')
      }

      const chunks = entries.map((ent: any) => {
        const offset = Number(ent.offset) || 0
        const size = Number(ent.size) || 0
        const ts = Number(ent.timestamp) || 0
        const slice = dataBuffer.slice(offset, offset + size)
        return {
          type: ent.type === 'key' ? 'key' : 'delta',
          timestamp: ts,
          data: slice,
          codedWidth: ent.codedWidth || recording.meta?.width,
          codedHeight: ent.codedHeight || recording.meta?.height,
          codec: ent.codec || recording.codec || recording.meta?.codec
        }
      })

      encodedChunks = chunks
      hasLoadedFullData = true
    } catch (e) {
      console.error('加载完整数据失败:', e)
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      isDecoding = false
    }
  }

  // 打开预览
  function openPreview() {
    showPreview = true
    if (!hasLoadedFullData) {
      // 懒加载完整数据，避免首屏阻塞
      loadFullData()
    }
  }

  // 关闭预览
  function closePreview() {
    showPreview = false
  }

  // 播放录制 -> 改为编辑录制
  function editRecording() {
    // 跳转到 studio 页面进行编辑
    window.open(`/studio.html?id=${recording.id}`, '_blank')
  }

  // OPFS: 读取已缓存的封面图片（cover.jpg / cover.webp / cover.png）
  async function readCachedCover(): Promise<string | null> {
    try {
      if (!navigator.storage?.getDirectory) return null
      const root = await navigator.storage.getDirectory()
      const recDir = await root.getDirectoryHandle(recording.id)

      const candidates = ['cover.jpg', 'cover.webp', 'cover.png']
      for (const name of candidates) {
        try {
          const fh = await recDir.getFileHandle(name)
          const file = await fh.getFile()
          const url = URL.createObjectURL(file)
          return url
        } catch {}
      }
      return null
    } catch {
      return null
    }
  }

  // 组件挂载时生成/读取缩略图（带 OPFS 缓存）
  onMount(async () => {
    try {
      // 1) 优先尝试从 OPFS 读取已缓存封面
      const cached = await readCachedCover()
      if (cached) {
        recording.thumbnail = cached
        thumbnailLoaded = true
        return
      }
    } catch (e) {
      console.warn('读取封面缓存失败:', e)
    }

    if (recording.thumbnail) {
      // 已有缩略图（例如外部提供）
      thumbnailLoaded = true
      return
    }

    // 2) 生成首帧封面，并写入 OPFS 缓存
    try {
      const thumbnail = await generateThumbnail()
      if (thumbnail) {
        recording.thumbnail = thumbnail
        thumbnailLoaded = true
        // 异步落盘缓存（不阻塞渲染）
        writeCachedCoverFromDataURL(thumbnail)
      } else {
        thumbnailError = true
      }
    } catch (error) {
      console.warn('缩略图生成失败:', error)
      thumbnailError = true
    }
  })
</script>

<div class="recording-card" class:selected>
  <div class="card-header">
    <label class="checkbox-label">
      <input 
        type="checkbox" 
        checked={selected}
        onchange={onToggleSelect}
        onclick={(e) => e.stopPropagation()}
      />
    </label>
    <div class="info-btn-container">
      <button class="info-btn" onclick={(e) => { e.stopPropagation() }}>
        <Info class="w-4 h-4" />
      </button>
      <!-- 元数据 Tooltip - hover i 图标时显示 -->
      <div class="metadata-tooltip">
        <div class="tooltip-content">
          <div class="meta-row">
            <span class="label">ID:</span>
            <span class="value">{recording.id}</span>
          </div>
          <div class="meta-row">
            <span class="label">创建时间:</span>
            <span class="value">{formatDate(recording.createdAt)}</span>
          </div>
          <div class="meta-row">
            <span class="label">完成状态:</span>
            <span class="value">{recording.meta?.completed ? '已完成' : '未完成'}</span>
          </div>
          {#if recording.codec || recording.meta?.codec}
            <div class="meta-row">
              <span class="label">编码:</span>
              <span class="value">{(recording.codec || recording.meta?.codec)?.toUpperCase()}</span>
            </div>
          {/if}
          <div class="meta-row">
            <span class="label">分辨率:</span>
            <span class="value">{recording.meta?.width || 0} × {recording.meta?.height || 0}</span>
          </div>
          {#if recording.fps || recording.meta?.fps}
            <div class="meta-row">
              <span class="label">帧率:</span>
              <span class="value">{recording.fps || recording.meta?.fps} FPS</span>
            </div>
          {/if}
          <div class="meta-row">
            <span class="label">文件大小:</span>
            <span class="value">{formatBytes(recording.meta?.totalBytes || recording.size)}</span>
          </div>
          <div class="meta-row">
            <span class="label">总帧数:</span>
            <span class="value">{(recording.meta?.totalChunks || recording.totalChunks).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div
    class="thumbnail-container"
    role="button"
    tabindex="0"
    aria-label={`播放录制：${recording.displayName}`}
    onclick={editRecording}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        editRecording();
      }
    }}
  >
    
   {#if thumbnailLoaded && recording.thumbnail}
      <img 
        src={recording.thumbnail} 
        alt="录制缩略图"
        class="thumbnail"
      />
    {:else if thumbnailError}
      <div class="thumbnail-placeholder error">
        <span class="icon">📹</span>
        <span class="text">无法加载预览</span>
      </div>
    {:else}
      <div class="thumbnail-placeholder loading">
        <div class="spinner"></div>
        <span class="text">生成预览中...</span>
      </div>
    {/if}
    
    <div class="play-overlay">
      <div class="play-button">▶️</div>
    </div>
    
    <div class="duration-badge">
      {formatTime(recording.duration)}
    </div>
  </div>

  <div class="card-content">
    <h3 class="recording-title" title={recording.displayName}>
      {recording.displayName}
    </h3>
  </div>

  <div class="card-actions">
    <button class="btn btn-primary" onclick={editRecording}>
      <Edit class="w-4 h-4" />
      编辑
    </button>
    <button class="btn btn-danger" onclick={onDelete}>
      <Trash2 class="w-4 h-4" />
      删除
    </button>
  </div>
</div>

{#if showPreview}
  <div
    class="preview-modal"
    role="button"
    tabindex="0"
    aria-label="关闭预览"
    onclick={closePreview}
    onkeydown={(e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        closePreview();
      }
    }}
  >
    <div
      class="preview-container"
      role="dialog"
      aria-modal="true"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      tabindex="0"
    >
      <div class="preview-header">
        <h3>{recording.displayName}</h3>
        <button class="close-btn" onclick={closePreview}>✕</button>
      </div>
      <div class="preview-content">
        {#if loadError}
          <div class="error-banner">预览数据加载失败：{loadError}</div>
        {/if}
        <VideoPreview 
          bind:this={previewComponent}
          showControls={true}
          showTimeline={true}
          {encodedChunks}
          isDecoding={isDecoding}
        />
      </div>
    </div>
  </div>
{/if}

<style>
  @reference "tailwindcss";
  
  .recording-card {
    @apply bg-white border-2 border-gray-200 rounded-xl overflow-hidden transition-all duration-200 cursor-pointer relative;
  }

  .recording-card:hover {
    @apply border-blue-500 shadow-lg;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
  }

  .recording-card.selected {
    @apply border-blue-500 bg-blue-50;
  }

  .card-header {
    @apply absolute top-2 left-2 right-2 flex justify-between z-10;
  }

  .checkbox-label {
    @apply flex items-center bg-white/90 rounded-md p-1 backdrop-blur-sm;
  }

  .checkbox-label input[type="checkbox"] {
    @apply w-4 h-4 cursor-pointer;
  }

  .info-btn-container {
    @apply relative;
  }

  .info-btn {
    @apply bg-blue-500/90 text-white border-none rounded-md px-2 py-1 cursor-pointer text-sm backdrop-blur-sm transition-colors duration-200;
  }

  .info-btn:hover {
    @apply bg-blue-600/95;
  }

  .info-btn-container .metadata-tooltip {
    @apply absolute top-8 right-0 bg-white rounded-lg shadow-lg border border-gray-200 z-30 min-w-48 opacity-0 pointer-events-none transition-opacity duration-200;
  }

  .info-btn-container:hover .metadata-tooltip {
    @apply opacity-100 pointer-events-auto;
  }

  .thumbnail-container {
    @apply relative aspect-video bg-gray-100 overflow-hidden;
  }

  .thumbnail {
    @apply w-full h-full object-cover;
  }

  .thumbnail-placeholder {
    @apply w-full h-full flex flex-col items-center justify-center text-gray-500 gap-2;
  }

  .thumbnail-placeholder.error {
    @apply bg-red-50 text-red-600;
  }

  .thumbnail-placeholder .icon {
    @apply text-3xl;
  }

  .thumbnail-placeholder .text {
    @apply text-sm;
  }

  .spinner {
    @apply w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin;
  }

  .play-overlay {
    @apply absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 transition-opacity duration-200;
  }

  .recording-card:hover .play-overlay {
    @apply opacity-100;
  }

  .play-button {
    @apply bg-white/90 rounded-full w-12 h-12 flex items-center justify-center text-xl backdrop-blur-sm;
  }

  .duration-badge {
    @apply absolute bottom-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-xs font-medium;
  }

  .tooltip-content {
    @apply p-3;
  }

  .card-content {
    @apply p-4;
  }

  .recording-title {
    @apply m-0 mb-3 text-base font-semibold text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis;
  }

  .meta-row {
    @apply flex justify-between text-sm;
  }

  .meta-row .label {
    @apply text-gray-500 font-medium;
  }

  .meta-row .value {
    @apply text-gray-700;
  }

  .card-actions {
    @apply px-4 pb-4 flex gap-2;
  }

  .btn {
    @apply flex-1 px-3 py-2 border-none rounded-md text-sm font-medium cursor-pointer transition-all duration-200 flex items-center justify-center gap-1;
  }

  .btn-primary {
    @apply bg-blue-500 text-white;
  }

  .btn-primary:hover {
    @apply bg-blue-600;
  }

  /* 预览模态框 */
  .preview-modal {
    @apply fixed inset-0 bg-black/80 flex items-center justify-center z-50;
  }

  .preview-container {
    @apply bg-white rounded-xl max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col;
  }

  .preview-header {
    @apply flex justify-between items-center px-5 py-4 border-b border-gray-200;
  }

  .preview-header h3 {
    @apply m-0 text-lg font-semibold text-gray-800;
  }

  .close-btn {
    @apply bg-transparent border-none text-xl cursor-pointer text-gray-500 p-0 w-6 h-6;
  }

  .preview-content {
    @apply p-5 min-h-96;
  }

  .error-banner {
    @apply mb-3 px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm;
  }
</style>