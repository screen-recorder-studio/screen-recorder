<script lang="ts">
  import { onMount } from 'svelte'
  import { Edit, Trash2, Info } from '@lucide/svelte'
  import VideoPreview from '$lib/components/VideoPreview.svelte'

  // New status: control metadata display (no longer needed, changed to hover display)
  // let showMetadata = $state(false)

  // Component properties
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

  // State management
  let thumbnailLoaded = $state(false)
  let thumbnailError = $state(false)
  let isIncomplete = $state(false)  // Recording is incomplete (missing required files)
  let showPreview = $state(false)
  let previewComponent = $state<VideoPreview | null>(null)
  // New: complete data and loading status required for preview
  let encodedChunks = $state<any[]>([])
  let isDecoding = $state(false)
  let hasLoadedFullData = $state(false)
  let loadError = $state<string | null>(null)

  // Format file size
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // Format time: unify as mm:ss (e.g. 00:07, 01:23), consistent with Studio timeline
  function formatTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds))
    const minutes = Math.floor(total / 60)
    const remainingSeconds = total % 60
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  }

  // Format date
  function formatDate(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return t('card_date_today', date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }))
    } else if (diffDays === 1) {
      return t('card_date_yesterday', date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }))
    } else if (diffDays < 7) {
      return t('card_date_days_ago', String(diffDays))
    } else {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    }
  }

  // i18n helper
  function t(key: string, subs?: string | string[]) {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      return chrome.i18n.getMessage(key, subs) || key
    }
    return key
  }

  // Generate thumbnail
  async function generateThumbnail(): Promise<string | null> {
    try {
      // Check OPFS support
      if (!navigator.storage?.getDirectory) {
        throw new Error('OPFS not supported')
      }

      const root = await navigator.storage.getDirectory()

      // Try to get recording directory
      let recordingDir: FileSystemDirectoryHandle
      try {
        recordingDir = await root.getDirectoryHandle(recording.id)
      } catch (e) {
        throw new Error(`Recording directory "${recording.id}" not found`)
      }

      // Check if index.jsonl exists
      let indexHandle: FileSystemFileHandle
      try {
        indexHandle = await recordingDir.getFileHandle('index.jsonl')
      } catch (e) {
        // Mark as incomplete recording
        isIncomplete = true
        throw new Error(`index.jsonl not found in ${recording.id}`)
      }

      const indexFile = await indexHandle.getFile()
      const indexText = await indexFile.text()
      const lines = indexText.split('\n').filter(Boolean)

      if (lines.length === 0) {
        throw new Error('index.jsonl is empty - no video chunks')
      }

      const firstChunk = JSON.parse(lines[0])

      // Check if data.bin exists
      let dataHandle: FileSystemFileHandle
      try {
        dataHandle = await recordingDir.getFileHandle('data.bin')
      } catch (e) {
        // Mark as incomplete recording
        isIncomplete = true
        throw new Error(`data.bin not found in ${recording.id}`)
      }

      const dataFile = await dataHandle.getFile()

      // Validate chunk offset and size
      if (typeof firstChunk.offset !== 'number' || typeof firstChunk.size !== 'number') {
        throw new Error('Invalid chunk metadata: missing offset or size')
      }

      if (firstChunk.offset + firstChunk.size > dataFile.size) {
        throw new Error(`Chunk data out of bounds: offset=${firstChunk.offset}, size=${firstChunk.size}, fileSize=${dataFile.size}`)
      }

      const buffer = await dataFile.arrayBuffer()

      // Extract first frame data
      const chunkData = buffer.slice(firstChunk.offset, firstChunk.offset + firstChunk.size)

      if (chunkData.byteLength === 0) {
        throw new Error('First chunk data is empty')
      }

      // Use VideoDecoder to decode first frame
      if ('VideoDecoder' in window) {
        return await decodeFirstFrame(chunkData, firstChunk)
      } else {
        throw new Error('WebCodecs not supported')
      }

    } catch (error) {
      // Provide detailed error message for debugging
      // For incomplete recordings (missing files), silently fail since UI already shows the state
      if (isIncomplete) {
        return null
      }

      // For other errors, log for debugging
      let errorMsg = 'Unknown error'
      if (error instanceof Error) {
        errorMsg = error.message
      } else if (error instanceof DOMException) {
        errorMsg = `${error.name}: ${error.message}`
      } else if (typeof error === 'object' && error !== null) {
        errorMsg = JSON.stringify(error)
      }
      console.warn(`Failed to generate thumbnail for ${recording.id}:`, errorMsg)
      return null
    }
  }

  // Thumbnail size limit (long edge)
  const MAX_THUMBNAIL_LONG_EDGE = 480

  // Decode first frame
  async function decodeFirstFrame(chunkData: ArrayBuffer, chunkInfo: any): Promise<string> {
    return new Promise((resolve, reject) => {
      let resolved = false
      let decoder: VideoDecoder | null = null

      // Timeout to prevent hanging if decoder never outputs a frame
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          try { decoder?.close() } catch {}
          reject(new Error('Thumbnail generation timeout (5s)'))
        }
      }, 5000)

      const cleanup = () => {
        clearTimeout(timeout)
        try { decoder?.close() } catch {}
      }

      decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (resolved) {
            frame.close()
            return
          }
          resolved = true
          clearTimeout(timeout)

          try {
            // Scale size based on long edge limit to reduce storage and memory usage
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

            // Draw directly at target size, browser will perform interpolation scaling
            ctx.drawImage(frame, 0, 0, dstW, dstH)
            frame.close()

            // Prefer WEBP (smaller), fallback to JPEG if not supported
            let dataUrl = ''
            try {
              dataUrl = canvas.toDataURL('image/webp', 0.75)
            } catch {}
            if (!dataUrl.startsWith('data:image/webp')) {
              dataUrl = canvas.toDataURL('image/jpeg', 0.75)
            }
            try { decoder?.close() } catch {}
            resolve(dataUrl)
          } catch (error) {
            frame.close()
            cleanup()
            reject(error)
          }
        },
        error: (error: DOMException) => {
          if (!resolved) {
            resolved = true
            cleanup()
            // Extract detailed error message from DOMException
            const errorMsg = error.message || error.name || 'Unknown decoder error'
            reject(new Error(`VideoDecoder error: ${errorMsg}`))
          }
        }
      })

      try {
        const codec = chunkInfo.codec || 'vp8'
        const codedWidth = chunkInfo.codedWidth || recording.meta?.width || 1920
        const codedHeight = chunkInfo.codedHeight || recording.meta?.height || 1080

        // Check if codec is supported before configuring
        // Configure decoder
        decoder.configure({
          codec,
          codedWidth,
          codedHeight
        })

        // Verify decoder state after configure
        if (decoder.state === 'closed') {
          throw new Error('Decoder closed unexpectedly after configure')
        }

        // Decode first frame
        const chunk = new EncodedVideoChunk({
          type: chunkInfo.type || 'key',
          timestamp: chunkInfo.timestamp || 0,
          data: chunkData
        })

        decoder.decode(chunk)

        // Properly await flush to ensure decode completes
        decoder.flush().catch((flushError: DOMException) => {
          if (!resolved) {
            resolved = true
            cleanup()
            const errorMsg = flushError.message || flushError.name || 'Flush failed'
            reject(new Error(`VideoDecoder flush error: ${errorMsg}`))
          }
        })
      } catch (error) {
        if (!resolved) {
          resolved = true
          cleanup()
          // Handle DOMException with better error message
          if (error instanceof DOMException) {
            reject(new Error(`VideoDecoder config error: ${error.message || error.name}`))
          } else {
            reject(error)
          }
        }
      }
    })
  }

  // Convert dataURL to Blob
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

  // Choose cover filename based on dataURL mime type
  function pickCoverFilename(dataUrl: string): string {
    if (dataUrl.startsWith('data:image/webp')) return 'cover.webp'
    if (dataUrl.startsWith('data:image/png')) return 'cover.png'
    return 'cover.jpg'
  }

  // OPFS: Write cover to cache (write with appropriate extension based on mime)
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
      console.warn('Failed to write cover cache:', e)
    }
  }

  // Load full preview data (index.jsonl + data.bin)
  async function loadFullData() {
    if (hasLoadedFullData || isDecoding) return
    try {
      isDecoding = true
      loadError = null

      if (!navigator.storage?.getDirectory) {
        throw new Error('Current environment does not support OPFS')
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
          try { return JSON.parse(line) } catch (e) { console.warn(`Failed to parse line ${i} in index.jsonl`, e); return null }
        })
        .filter(Boolean) as any[]

      if (entries.length === 0) {
        throw new Error('index.jsonl is empty')
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
      console.error('Failed to load full data:', e)
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      isDecoding = false
    }
  }

  // Open preview
  function openPreview() {
    showPreview = true
    if (!hasLoadedFullData) {
      // Lazy load full data to avoid blocking first screen
      loadFullData()
    }
  }

  // Close preview
  function closePreview() {
    showPreview = false
  }

  // Play recording -> changed to edit recording
  function editRecording() {
    // Navigate to studio page for editing
    window.open(`/studio.html?id=${recording.id}`, '_blank')
  }

  // OPFS: Read cached cover image (cover.jpg / cover.webp / cover.png)
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

  // Generate/read thumbnail on component mount (with OPFS cache)
  onMount(async () => {
    try {
      // 1) First try to read cached cover from OPFS
      const cached = await readCachedCover()
      if (cached) {
        recording.thumbnail = cached
        thumbnailLoaded = true
        return
      }
    } catch (e) {
      console.warn('Failed to read cover cache:', e)
    }

    if (recording.thumbnail) {
      // Already has thumbnail (e.g. provided externally)
      thumbnailLoaded = true
      return
    }

    // 2) Generate first frame cover and write to OPFS cache
    try {
      const thumbnail = await generateThumbnail()
      if (thumbnail) {
        recording.thumbnail = thumbnail
        thumbnailLoaded = true
        // Async cache to disk (don't block rendering)
        writeCachedCoverFromDataURL(thumbnail)
      } else {
        thumbnailError = true
      }
    } catch (error) {
      console.warn('Thumbnail generation failed:', error)
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
      <!-- Metadata Tooltip - show on hover over i icon -->
      <div class="metadata-tooltip">
        <div class="tooltip-content">
          <div class="meta-row">
            <span class="label">ID:</span>
            <span class="value">{recording.id}</span>
          </div>
          <div class="meta-row">
            <span class="label">{t('card_label_created')}</span>
            <span class="value">{formatDate(recording.createdAt)}</span>
          </div>
          <div class="meta-row">
            <span class="label">{t('card_label_status')}</span>
            <span class="value">{recording.meta?.completed ? t('card_status_completed') : t('card_status_incomplete')}</span>
          </div>
          {#if recording.codec || recording.meta?.codec}
            <div class="meta-row">
              <span class="label">{t('card_label_codec')}</span>
              <span class="value">{(recording.codec || recording.meta?.codec)?.toUpperCase()}</span>
            </div>
          {/if}
          <div class="meta-row">
            <span class="label">{t('card_label_resolution')}</span>
            <span class="value">{recording.meta?.width || 0} × {recording.meta?.height || 0}</span>
          </div>
          {#if recording.fps || recording.meta?.fps}
            <div class="meta-row">
              <span class="label">{t('card_label_fps')}</span>
              <span class="value">{recording.fps || recording.meta?.fps} FPS</span>
            </div>
          {/if}
          <div class="meta-row">
            <span class="label">{t('card_label_size')}</span>
            <span class="value">{formatBytes(recording.meta?.totalBytes || recording.size)}</span>
          </div>
          <div class="meta-row">
            <span class="label">{t('card_label_frames')}</span>
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
    aria-label={`Play recording: ${recording.displayName}`}
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
        alt="Recording thumbnail"
        class="thumbnail"
      />
    {:else if isIncomplete}
      <div class="thumbnail-placeholder incomplete">
        <span class="icon">⚠️</span>
        <span class="text">{t('card_incomplete_title')}</span>
        <span class="subtext">{t('card_incomplete_desc')}</span>
      </div>
    {:else if thumbnailError}
      <div class="thumbnail-placeholder error">
        <span class="icon">📹</span>
        <span class="text">{t('card_preview_error')}</span>
      </div>
    {:else}
      <div class="thumbnail-placeholder loading">
        <div class="spinner"></div>
        <span class="text">{t('card_preview_loading')}</span>
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
    <button
      class="btn btn-primary"
      onclick={editRecording}
      disabled={isIncomplete}
      title={isIncomplete ? t('card_edit_disabled_tooltip') : t('card_edit_tooltip')}
    >
      <Edit class="w-4 h-4" />
      {t('card_btn_edit')}
    </button>
    <button class="btn btn-danger" onclick={onDelete}>
      <Trash2 class="w-4 h-4" />
      {t('card_btn_delete')}
    </button>
  </div>
</div>

{#if showPreview}
  <div
    class="preview-modal"
    role="button"
    tabindex="0"
    aria-label="Close preview"
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
          <div class="error-banner">{t('card_preview_load_error', loadError)}</div>
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

  .thumbnail-placeholder.incomplete {
    @apply bg-amber-50 text-amber-600;
  }

  .thumbnail-placeholder .icon {
    @apply text-3xl;
  }

  .thumbnail-placeholder .text {
    @apply text-sm font-medium;
  }

  .thumbnail-placeholder .subtext {
    @apply text-xs opacity-75;
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

  .btn-primary:hover:not(:disabled) {
    @apply bg-blue-600;
  }

  .btn-primary:disabled {
    @apply opacity-50 cursor-not-allowed;
  }

  /* Preview modal */
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