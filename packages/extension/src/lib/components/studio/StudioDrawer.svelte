<script lang="ts">
  import { X, HardDrive, ExternalLink, Trash2, LoaderCircle } from '@lucide/svelte'
  import { _t as t } from '$lib/utils/i18n'
  import type { RecordingSummary } from '$lib/types/recordings'

  interface Props {
    recordings: RecordingSummary[]
    isLoading: boolean
    selectedRecordingId: string
    onSelect: (recording: RecordingSummary) => void
    onDelete: (id: string) => void
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

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${m}:00`
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
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 7) return `${diffDay}d ago`
    return new Date(timestamp).toLocaleDateString()
  }

  async function handleDelete(e: Event, id: string) {
    e.stopPropagation()
    if (deletingId) return
    deletingId = id
    try {
      await onDelete(id)
    } finally {
      deletingId = null
    }
  }
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex justify-end"
  onkeydown={(e) => { if (e.key === 'Escape') onClose() }}
>
  <!-- Overlay -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="absolute inset-0 bg-black/30" onclick={onClose}></div>

  <!-- Drawer panel -->
  <div class="relative w-80 max-w-full bg-white shadow-xl flex flex-col h-full animate-slide-in">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
      <div class="flex items-center gap-2">
        <HardDrive class="w-4 h-4 text-gray-600" />
        <h2 class="text-sm font-semibold text-gray-900">
          {t('drive_drawerTitle')}
        </h2>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          onclick={onOpenDriveFull}
          title={t('drive_drawerOpenFull')}
        >
          <ExternalLink class="w-4 h-4" />
        </button>
        <button
          class="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          onclick={onClose}
        >
          <X class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- List -->
    <div class="flex-1 overflow-y-auto">
      {#if isLoading}
        <div class="flex items-center justify-center py-12">
          <LoaderCircle class="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      {:else if recordings.length === 0}
        <div class="px-4 py-12 text-center">
          <p class="text-sm text-gray-500">{t('drive_drawerEmpty')}</p>
        </div>
      {:else}
        <div class="py-1">
          {#each recordings as rec (rec.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors border-l-2"
              class:border-blue-500={rec.id === selectedRecordingId}
              class:bg-blue-50={rec.id === selectedRecordingId}
              class:border-transparent={rec.id !== selectedRecordingId}
              onclick={() => onSelect(rec)}
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900 truncate">{rec.displayName}</p>
                <p class="text-xs text-gray-500 mt-0.5">
                  {formatRelativeTime(rec.createdAt)} · {formatDuration(rec.duration)} · {formatSize(rec.size)}
                </p>
              </div>
              <button
                class="flex-shrink-0 p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                onclick={(e) => handleDelete(e, rec.id)}
                disabled={deletingId === rec.id}
                title={t('drive_drawerDelete')}
              >
                {#if deletingId === rec.id}
                  <LoaderCircle class="w-3.5 h-3.5 animate-spin" />
                {:else}
                  <Trash2 class="w-3.5 h-3.5" />
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .animate-slide-in {
    animation: slide-in 0.2s ease-out;
  }
</style>
