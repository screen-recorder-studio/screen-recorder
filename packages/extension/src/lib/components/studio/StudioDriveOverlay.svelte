<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { X, HardDrive, ExternalLink, Trash2, LoaderCircle, Play, TriangleAlert } from '@lucide/svelte'
  import { _t as t } from '$lib/utils/i18n'
  import type { RecordingSummary } from '$lib/types/recordings'

  interface Props {
    recordings: RecordingSummary[]
    isLoading: boolean
    selectedRecordingId: string
    onSelect: (recording: RecordingSummary) => void
    onDelete: (id: string) => void | Promise<void>
    onClose: () => void
    onOpenDriveFull: () => void
  }

  let {
    recordings,
    isLoading,
    selectedRecordingId,
    onSelect,
    onDelete,
    onClose,
    onOpenDriveFull,
  }: Props = $props()

  let deletingId = $state<string | null>(null)
  let confirmDeleteId = $state<string | null>(null)
  let panelEl: HTMLDivElement | null = null

  // Thumbnail state per recording
  let thumbnails = $state<Record<string, { url: string | null; loading: boolean; error: boolean }>>({})

  const uiLocale =
    (typeof chrome !== 'undefined' && typeof chrome.i18n?.getUILanguage === 'function'
      ? chrome.i18n.getUILanguage()
      : navigator.language) || 'en'

  const relativeTimeFormatter = (() => {
    try {
      return new Intl.RelativeTimeFormat(uiLocale, { numeric: 'auto' })
    } catch {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    }
  })()

  const dateFormatter = (() => {
    try {
      return new Intl.DateTimeFormat(uiLocale, { dateStyle: 'medium' })
    } catch {
      return new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
    }
  })()

  function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds))
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  function formatRelativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 1) return t('drive_drawerJustNow')
    if (diffMin < 60) return relativeTimeFormatter.format(-diffMin, 'minute')
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return relativeTimeFormatter.format(-diffHr, 'hour')
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 7) return relativeTimeFormatter.format(-diffDay, 'day')
    return dateFormatter.format(new Date(timestamp))
  }

  function revokeThumbnailUrl(url: string | null | undefined) {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }

  function setThumbnailState(recId: string, next: { url: string | null; loading: boolean; error: boolean }) {
    const previousUrl = thumbnails[recId]?.url
    if (previousUrl && previousUrl !== next.url) {
      revokeThumbnailUrl(previousUrl)
    }
    thumbnails[recId] = next
  }

  function cleanupRemovedThumbnails(validIds: Set<string>) {
    let changed = false
    for (const id of Object.keys(thumbnails)) {
      if (!validIds.has(id)) {
        revokeThumbnailUrl(thumbnails[id]?.url)
        delete thumbnails[id]
        changed = true
      }
    }

    if (changed) {
      thumbnails = { ...thumbnails }
    }
  }

  function revokeAllThumbnailUrls() {
    for (const thumbnail of Object.values(thumbnails)) {
      revokeThumbnailUrl(thumbnail.url)
    }
  }

  function handlePanelKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (confirmDeleteId) {
        closeDeleteConfirm()
        return
      }

      onClose()
    }
  }

  function requestDelete(e: Event, id: string) {
    e.stopPropagation()
    if (deletingId) return
    confirmDeleteId = id
  }

  function closeDeleteConfirm() {
    if (deletingId) return
    confirmDeleteId = null
  }

  async function handleDelete() {
    if (!confirmDeleteId || deletingId) return

    const id = confirmDeleteId
    if (deletingId) return
    deletingId = id
    try {
      await onDelete(id)
    } finally {
      deletingId = null
      confirmDeleteId = null
    }
  }

  // Read cached cover from OPFS
  async function readCachedCover(recId: string): Promise<string | null> {
    try {
      if (!navigator.storage?.getDirectory) return null
      const root = await navigator.storage.getDirectory()
      const recDir = await root.getDirectoryHandle(recId)
      const candidates = ['cover.webp', 'cover.jpg', 'cover.png']
      for (const name of candidates) {
        try {
          const fh = await recDir.getFileHandle(name)
          const file = await fh.getFile()
          return URL.createObjectURL(file)
        } catch { /* try next */ }
      }
      return null
    } catch {
      return null
    }
  }

  // Generate thumbnail from first frame using WebCodecs
  async function generateThumbnail(rec: RecordingSummary): Promise<string | null> {
    try {
      if (!navigator.storage?.getDirectory) return null
      const root = await navigator.storage.getDirectory()
      const recDir = await root.getDirectoryHandle(rec.id)

      let indexHandle: FileSystemFileHandle
      try {
        indexHandle = await recDir.getFileHandle('index.jsonl')
      } catch {
        return null
      }

      const indexFile = await indexHandle.getFile()
      const indexText = await indexFile.text()
      const lines = indexText.split('\n').filter(Boolean)
      if (lines.length === 0) return null

      const firstChunk = JSON.parse(lines[0])

      let dataHandle: FileSystemFileHandle
      try {
        dataHandle = await recDir.getFileHandle('data.bin')
      } catch {
        return null
      }

      const dataFile = await dataHandle.getFile()
      if (typeof firstChunk.offset !== 'number' || typeof firstChunk.size !== 'number') return null
      if (firstChunk.offset + firstChunk.size > dataFile.size) return null

      const buffer = await dataFile.arrayBuffer()
      const chunkData = buffer.slice(firstChunk.offset, firstChunk.offset + firstChunk.size)
      if (chunkData.byteLength === 0) return null

      if (!('VideoDecoder' in window)) return null

      return await decodeFirstFrame(chunkData, firstChunk, rec)
    } catch {
      return null
    }
  }

  /** Shape of a single chunk entry from index.jsonl */
  interface ChunkEntry {
    offset: number
    size: number
    codec?: string
    type?: 'key' | 'delta'
    timestamp?: number
    codedWidth?: number
    codedHeight?: number
  }

  function decodeFirstFrame(chunkData: ArrayBuffer, chunkInfo: ChunkEntry, rec: RecordingSummary): Promise<string> {
    return new Promise((resolve, reject) => {
      let resolved = false
      let decoder: VideoDecoder | null = null
      const maxEdge = 320

      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; try { decoder?.close() } catch {}; reject(new Error('Thumbnail generation timed out after 5s')) }
      }, 5000)

      decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (resolved) { frame.close(); return }
          resolved = true
          clearTimeout(timeout)
          try {
            const srcW = frame.codedWidth, srcH = frame.codedHeight
            const maxSide = Math.max(srcW, srcH)
            const ratio = maxSide > maxEdge ? (maxEdge / maxSide) : 1
            const dstW = Math.max(1, Math.round(srcW * ratio))
            const dstH = Math.max(1, Math.round(srcH * ratio))
            const canvas = document.createElement('canvas')
            canvas.width = dstW; canvas.height = dstH
            const ctx = canvas.getContext('2d')
            if (!ctx) { frame.close(); reject(new Error('Canvas 2d context unavailable')); return }
            ctx.drawImage(frame, 0, 0, dstW, dstH)
            frame.close()
            // Try WebP first (smaller), fallback to JPEG if unsupported
            let dataUrl = ''
            try { dataUrl = canvas.toDataURL('image/webp', 0.7) } catch {}
            if (!dataUrl.startsWith('data:image/webp')) {
              dataUrl = canvas.toDataURL('image/jpeg', 0.7)
            }
            try { decoder?.close() } catch {}

            // Cache to OPFS (async, don't block)
            writeCachedCover(rec.id, dataUrl).catch(() => {})

            resolve(dataUrl)
          } catch (e) { frame.close(); try { decoder?.close() } catch {}; reject(e) }
        },
        error: (err: DOMException) => {
          if (!resolved) { resolved = true; clearTimeout(timeout); try { decoder?.close() } catch {}; reject(err) }
        }
      })

      try {
        decoder.configure({
          codec: chunkInfo.codec || 'vp8',
          codedWidth: chunkInfo.codedWidth || rec.meta?.width || 1920,
          codedHeight: chunkInfo.codedHeight || rec.meta?.height || 1080
        })
        decoder.decode(new EncodedVideoChunk({
          type: chunkInfo.type || 'key',
          timestamp: chunkInfo.timestamp || 0,
          data: chunkData
        }))
        decoder.flush().catch((e: DOMException) => {
          if (!resolved) { resolved = true; clearTimeout(timeout); try { decoder?.close() } catch {}; reject(e) }
        })
      } catch (e) {
        if (!resolved) { resolved = true; clearTimeout(timeout); try { decoder?.close() } catch {}; reject(e) }
      }
    })
  }

  async function writeCachedCover(recId: string, dataUrl: string): Promise<void> {
    try {
      if (!navigator.storage?.getDirectory) return
      const root = await navigator.storage.getDirectory()
      const recDir = await root.getDirectoryHandle(recId)
      const ext = dataUrl.startsWith('data:image/webp') ? 'cover.webp' : 'cover.jpg'
      const fh = await recDir.getFileHandle(ext, { create: true })
      const writable = await fh.createWritable()
      const [header, base64] = dataUrl.split(',')
      const mimeMatch = header.match(/data:(.*);base64/)
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
      const binary = atob(base64)
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
      await writable.write(new Blob([bytes], { type: mime }))
      await writable.close()
    } catch { /* ignore cache write failures */ }
  }

  // Load thumbnails for all recordings
  async function loadThumbnails() {
    const validIds = new Set(recordings.map((rec) => rec.id))
    cleanupRemovedThumbnails(validIds)

    for (const rec of recordings) {
      if (thumbnails[rec.id]) continue
      setThumbnailState(rec.id, { url: null, loading: true, error: false })

      try {
        // Try cached first
        const cached = await readCachedCover(rec.id)
        if (cached) {
          setThumbnailState(rec.id, { url: cached, loading: false, error: false })
          continue
        }
        // Generate
        const url = await generateThumbnail(rec)
        setThumbnailState(rec.id, { url, loading: false, error: !url })
      } catch {
        setThumbnailState(rec.id, { url: null, loading: false, error: true })
      }
    }
  }

  onMount(() => {
    queueMicrotask(() => panelEl?.focus())
  })

  onDestroy(() => {
    revokeAllThumbnailUrls()
  })

  const confirmDeleteRecording = $derived(
    confirmDeleteId ? recordings.find((recording) => recording.id === confirmDeleteId) ?? null : null
  )

  // Watch for recordings changes
  $effect(() => {
    if (recordings.length > 0) {
      loadThumbnails()
      return
    }

    cleanupRemovedThumbnails(new Set())
  })
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center"
  role="presentation"
>
  <!-- Overlay -->
  <button
    type="button"
    class="absolute inset-0 bg-black/40"
    aria-label={t('drive_close_error')}
    tabindex="-1"
    onclick={onClose}
  ></button>

  <!-- Floating panel -->
  <div
    bind:this={panelEl}
    class="relative bg-white rounded-2xl shadow-2xl flex flex-col animate-overlay-in
      w-[90vw] max-w-4xl max-h-[80vh] focus:outline-none"
    role="dialog"
    aria-modal="true"
    aria-labelledby="studio-drive-overlay-title"
    tabindex="-1"
    onkeydown={handlePanelKeydown}
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 flex-shrink-0">
      <div class="flex items-center gap-2">
        <HardDrive class="w-5 h-5 text-blue-600" />
        <h2 id="studio-drive-overlay-title" class="text-base font-semibold text-gray-900">
          {t('drive_drawerTitle')}
        </h2>
        <span class="text-xs text-gray-400">{recordings.length}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          onclick={onOpenDriveFull}
          title={t('drive_drawerOpenFull')}
        >
          <ExternalLink class="w-3.5 h-3.5" />
          {t('drive_drawerOpenFull')}
        </button>
        <button
          type="button"
          class="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label={t('drive_close_error')}
          onclick={onClose}
        >
          <X class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-4">
      {#if isLoading}
        <div class="flex items-center justify-center py-16">
          <LoaderCircle class="w-7 h-7 text-blue-500 animate-spin" />
        </div>
      {:else if recordings.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <HardDrive class="w-10 h-10 text-gray-300 mb-3" />
          <p class="text-sm text-gray-500">{t('drive_drawerEmpty')}</p>
        </div>
      {:else}
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {#each recordings as rec (rec.id)}
            <article
              class="group relative rounded-xl border-2 cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-md
                {rec.id === selectedRecordingId ? 'border-blue-500 bg-blue-50/50 shadow-sm' : 'border-gray-200 hover:border-blue-300'}"
            >
              <button
                type="button"
                class="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-inset"
                aria-pressed={rec.id === selectedRecordingId}
                onclick={() => onSelect(rec)}
              >
                <!-- Thumbnail -->
                <div class="aspect-video bg-gray-100 relative overflow-hidden">
                  {#if thumbnails[rec.id]?.url}
                    <img
                      src={thumbnails[rec.id].url}
                      alt={rec.displayName}
                      class="w-full h-full object-cover"
                    />
                  {:else if thumbnails[rec.id]?.loading}
                    <div class="absolute inset-0 flex items-center justify-center">
                      <LoaderCircle class="w-5 h-5 text-gray-300 animate-spin" />
                    </div>
                  {:else}
                    <div class="absolute inset-0 flex items-center justify-center">
                      <Play class="w-6 h-6 text-gray-300" />
                    </div>
                  {/if}

                  <!-- Play overlay on hover -->
                  <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <div class="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-sm">
                      <Play class="w-4 h-4 text-gray-700 ml-0.5" />
                    </div>
                  </div>

                  <!-- Duration badge -->
                  <div class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/70 text-white text-[10px] font-medium rounded">
                    {formatDuration(rec.duration)}
                  </div>

                  <!-- Active indicator -->
                  {#if rec.id === selectedRecordingId}
                    <div class="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white"></div>
                  {/if}
                </div>

                <!-- Info -->
                <div class="px-2.5 py-2">
                  <p class="text-xs font-medium text-gray-800 truncate leading-tight">{rec.displayName}</p>
                  <p class="text-[10px] text-gray-400 mt-0.5 truncate">
                    {formatRelativeTime(rec.createdAt)} · {rec.resolution} · {formatSize(rec.size)}
                  </p>
                </div>
              </button>

              <!-- Delete button (appears on hover) -->
              <button
                type="button"
                class="absolute top-1.5 right-1.5 p-1 rounded-md bg-white/80 text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                aria-label={t('drive_drawerDelete')}
                onclick={(e) => requestDelete(e, rec.id)}
                disabled={deletingId === rec.id}
                title={t('drive_drawerDelete')}
              >
                {#if deletingId === rec.id}
                  <LoaderCircle class="w-3.5 h-3.5 animate-spin" />
                {:else}
                  <Trash2 class="w-3.5 h-3.5" />
                {/if}
              </button>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if confirmDeleteId}
    <div class="absolute inset-0 z-10 flex items-center justify-center p-4">
      <button
        type="button"
        class="absolute inset-0 bg-black/30"
        aria-label={t('drive_cancel')}
        onclick={closeDeleteConfirm}
      ></button>

      <div
        class="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="studio-drive-delete-title"
        aria-describedby="studio-drive-delete-description"
      >
        <div class="flex items-start gap-3">
          <div class="mt-0.5 rounded-full bg-red-50 p-2 text-red-500">
            <TriangleAlert class="w-5 h-5" />
          </div>
          <div class="min-w-0 flex-1">
            <h3 id="studio-drive-delete-title" class="text-base font-semibold text-gray-900">
              {t('drive_confirm_delete_title')}
            </h3>
            <p id="studio-drive-delete-description" class="mt-2 text-sm text-gray-600">
              {t('drive_confirm_delete_single')}
              <span class="mt-1 block truncate font-medium text-gray-800">
                {confirmDeleteRecording?.displayName}
              </span>
              <span class="mt-1 block">{t('drive_action_undone')}</span>
            </p>
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-3">
          <button
            type="button"
            class="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
            onclick={closeDeleteConfirm}
            disabled={Boolean(deletingId)}
          >
            {t('drive_cancel')}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={handleDelete}
            disabled={Boolean(deletingId)}
          >
            {#if deletingId === confirmDeleteId}
              <LoaderCircle class="w-4 h-4 animate-spin" />
            {/if}
            {t('drive_delete')}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes overlay-in {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  .animate-overlay-in {
    animation: overlay-in 0.2s ease-out;
  }
</style>
