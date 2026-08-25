<script lang="ts">
  import { onMount } from 'svelte'
  import { Edit, Trash2, Info } from '@lucide/svelte'
  import { _t as t } from '$lib/utils/i18n'

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
  let cardEl = $state<HTMLElement | null>(null)
  let cachedThumbnailObjectUrl: string | null = null

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
          cachedThumbnailObjectUrl = URL.createObjectURL(file)
          return cachedThumbnailObjectUrl
        } catch {}
      }
      return null
    } catch {
      return null
    }
  }

  async function loadThumbnail() {
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
  }

  // Large libraries must not read OPFS and construct VideoDecoders for every
  // card at once. Load only when a card approaches the viewport.
  onMount(() => {
    if (!cardEl || typeof IntersectionObserver === 'undefined') {
      void loadThumbnail()
      return () => {
        if (cachedThumbnailObjectUrl) URL.revokeObjectURL(cachedThumbnailObjectUrl)
      }
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void loadThumbnail()
    }, { rootMargin: '240px 0px' })

    observer.observe(cardEl)
    return () => {
      observer.disconnect()
      if (cachedThumbnailObjectUrl) URL.revokeObjectURL(cachedThumbnailObjectUrl)
    }
  })
</script>

<div bind:this={cardEl} class="recording-card" class:selected>
  <div class="card-header">
    <label class="checkbox-label">
      <input 
        type="checkbox" 
        checked={selected}
        aria-label={t('card_select_recording', recording.displayName)}
        onchange={onToggleSelect}
        onclick={(e) => e.stopPropagation()}
      />
    </label>
    <div class="info-btn-container">
      <button
        type="button"
        class="info-btn"
        aria-label={t('card_recording_info', recording.displayName)}
        title={t('card_recording_info', recording.displayName)}
        onclick={(e) => { e.stopPropagation() }}
      >
        <Info class="w-4 h-4" />
      </button>
      <!-- Metadata Tooltip - show on hover over i icon -->
      <div class="metadata-tooltip" role="tooltip">
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
    aria-label={`${t('card_btn_edit')}: ${recording.displayName}`}
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
        alt={recording.displayName}
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
      <div class="play-button"><Edit class="h-5 w-5" /></div>
    </div>
    
    <div class="duration-badge">
      {formatTime(recording.duration)}
    </div>
  </div>

  <div class="card-content">
    <h3 class="recording-title" title={recording.displayName}>
      {recording.displayName}
    </h3>
    <p class="recording-meta">
      <span>{formatDate(recording.createdAt)}</span>
      <span aria-hidden="true">·</span>
      <span>{recording.resolution}</span>
      <span aria-hidden="true">·</span>
      <span>{formatBytes(recording.size)}</span>
    </p>
  </div>

  <div class="card-actions">
    <button
      type="button"
      class="btn btn-primary"
      onclick={editRecording}
      disabled={isIncomplete}
      title={isIncomplete ? t('card_edit_disabled_tooltip') : t('card_edit_tooltip')}
    >
      <Edit class="w-4 h-4" />
      {t('card_btn_edit')}
    </button>
    <button type="button" class="btn btn-danger" onclick={onDelete}>
      <Trash2 class="w-4 h-4" />
      {t('card_btn_delete')}
    </button>
  </div>
</div>

<style>
  .recording-card {
    position: relative;
    isolation: isolate;
    overflow: visible;
    border: 1px solid var(--surface-border);
    border-radius: 0.875rem;
    background: var(--surface-panel);
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.06);
    transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
  }

  .recording-card:hover,
  .recording-card:focus-within {
    z-index: 2;
    border-color: var(--surface-blue);
    box-shadow: 0 18px 42px rgba(15, 23, 42, 0.14);
    transform: translateY(-2px);
  }

  .recording-card.selected {
    border-color: var(--surface-blue);
    background: var(--surface-blue-soft);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.16), 0 18px 42px rgba(15, 23, 42, 0.14);
  }

  .card-header {
    position: absolute;
    top: 0.625rem;
    right: 0.625rem;
    left: 0.625rem;
    z-index: 10;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    pointer-events: none;
  }

  .checkbox-label,
  .info-btn-container {
    pointer-events: auto;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    border: 1px solid var(--surface-border-interactive);
    border-radius: 0.5rem;
    padding: 0.3rem;
    background: color-mix(in srgb, var(--surface-panel) 90%, transparent);
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.14);
    backdrop-filter: blur(10px);
  }

  .checkbox-label input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    cursor: pointer;
    accent-color: var(--surface-blue);
  }

  .info-btn-container {
    position: relative;
  }

  .info-btn {
    display: flex;
    width: 1.875rem;
    height: 1.875rem;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--surface-border-interactive);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--surface-panel) 90%, transparent);
    color: var(--surface-muted);
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.14);
    backdrop-filter: blur(10px);
    transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
  }

  .info-btn:hover,
  .info-btn:focus-visible {
    border-color: var(--surface-blue);
    background: var(--surface-blue-soft);
    color: var(--surface-blue);
  }

  .metadata-tooltip {
    position: absolute;
    top: 2.25rem;
    right: 0;
    z-index: 30;
    width: min(15.5rem, calc(100vw - 3rem));
    pointer-events: none;
    opacity: 0;
    border: 1px solid var(--surface-border-interactive);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--surface-panel) 98%, transparent);
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
    transform: translateY(-4px);
    transition: opacity 150ms ease, transform 150ms ease;
    backdrop-filter: blur(16px);
  }

  .info-btn-container:hover .metadata-tooltip,
  .info-btn-container:focus-within .metadata-tooltip {
    pointer-events: auto;
    opacity: 1;
    transform: translateY(0);
  }

  .thumbnail-container {
    position: relative;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    cursor: pointer;
    border-radius: 0.8rem 0.8rem 0 0;
    background: #09090b;
  }

  .thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumbnail-placeholder {
    display: flex;
    width: 100%;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    color: #a1a1aa;
  }

  .thumbnail-placeholder.error {
    background: rgba(239, 68, 68, 0.08);
    color: #fca5a5;
  }

  .thumbnail-placeholder.incomplete {
    background: rgba(245, 158, 11, 0.08);
    color: #fcd34d;
  }

  .thumbnail-placeholder .icon {
    font-size: 1.75rem;
  }

  .thumbnail-placeholder .text {
    font-size: 0.8rem;
    font-weight: 600;
  }

  .thumbnail-placeholder .subtext {
    font-size: 0.7rem;
    opacity: 0.75;
  }

  .spinner {
    width: 1.5rem;
    height: 1.5rem;
    animation: spin 0.8s linear infinite;
    border: 2px solid #71717a;
    border-top-color: #60a5fa;
    border-radius: 999px;
  }

  .play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.38);
    opacity: 0;
    transition: opacity 160ms ease;
  }

  .recording-card:hover .play-overlay,
  .thumbnail-container:focus-visible .play-overlay {
    opacity: 1;
  }

  .play-button {
    display: flex;
    width: 2.75rem;
    height: 2.75rem;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    background: rgba(244, 244, 245, 0.92);
    color: #18181b;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(10px);
  }

  .duration-badge {
    position: absolute;
    right: 0.625rem;
    bottom: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.4rem;
    padding: 0.2rem 0.45rem;
    background: rgba(0, 0, 0, 0.76);
    color: #fff;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .tooltip-content {
    display: grid;
    gap: 0.45rem;
    padding: 0.875rem;
  }

  .card-content {
    padding: 0.875rem 0.95rem 0.75rem;
  }

  .recording-title {
    margin: 0;
    overflow: hidden;
    color: var(--surface-text);
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.25rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recording-meta {
    display: flex;
    margin: 0.3rem 0 0;
    overflow: hidden;
    align-items: center;
    gap: 0.35rem;
    color: var(--surface-muted);
    font-size: 0.75rem;
    line-height: 1rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    color: var(--surface-muted);
    font-size: 0.75rem;
  }

  .meta-row .label {
    flex-shrink: 0;
    color: var(--surface-muted);
    font-weight: 500;
  }

  .meta-row .value {
    overflow: hidden;
    color: var(--surface-text);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-actions {
    display: flex;
    gap: 0.5rem;
    border-top: 1px solid var(--surface-border);
    padding: 0.7rem 0.8rem 0.8rem;
  }

  .btn {
    display: inline-flex;
    min-width: 0;
    flex: 1;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: 1px solid transparent;
    border-radius: 0.55rem;
    padding: 0.55rem 0.7rem;
    font-size: 0.75rem;
    font-weight: 600;
    transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
  }

  .btn-primary {
    border-color: var(--surface-blue);
    background: var(--surface-blue);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--surface-blue-hover);
  }

  .btn-primary:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn-danger {
    border-color: var(--surface-red);
    background: var(--surface-red-soft);
    color: var(--surface-red-text);
  }

  .btn-danger:hover:not(:disabled) {
    border-color: var(--surface-red-hover);
    background: color-mix(in srgb, var(--surface-red) 16%, var(--surface-panel));
    color: var(--surface-red-text);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .recording-card,
    .metadata-tooltip,
    .play-overlay {
      transition: none;
    }
  }
</style>
