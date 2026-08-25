<script lang="ts">
  import { onMount } from 'svelte'
  import { FolderOpen, Video } from '@lucide/svelte'
  import RecordingList from '$lib/components/drive/RecordingList.svelte'
  import { RECORDING_MANAGER_THEME_CONTRACT } from '$lib/drive/recording-manager-theme'
  import { _t as t, initI18n, isI18nInitialized } from '$lib/utils/i18n'
  import { listRecordings, invalidateRecordingsCache } from '$lib/utils/opfs-recordings'
  import { openControlWindow } from '$lib/utils/window-navigation'
  import type { RecordingSummary } from '$lib/types/recordings'

  // State management
  let recordings = $state<RecordingSummary[]>([])
  let isLoading = $state(true)
  let errorMessage = $state('')
  let i18nReady = $state(isI18nInitialized())

  // Load all recordings using shared OPFS layer
  async function loadRecordings() {
    try {
      isLoading = true
      errorMessage = ''
      invalidateRecordingsCache()
      recordings = await listRecordings(true)
    } catch (error: any) {
      console.error('Failed to load recordings:', error)
      errorMessage = error.message || t('drive_errorLoad')
    } finally {
      isLoading = false
    }
  }

  // Delete recording
  async function deleteRecording(recordingId: string) {
    try {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(recordingId, { recursive: true })
      
      // Remove from list
      recordings = recordings.filter(r => r.id !== recordingId)
      invalidateRecordingsCache()
      
      console.log(t('drive_logDeleted', recordingId))
    } catch (error: any) {
      console.error('Failed to delete recording:', error)
      errorMessage = t('drive_errorDelete', error.message)
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
      console.log(t('drive_logBatchDelete', String(successCount)))
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

  /** Open the Control page so users can start a new recording from the empty state. */
  function handleStartRecording() {
    void openControlWindow()
  }

  // Load data when component mounts
  onMount(async () => {
    // Ensure i18n is initialized before loading
    await initI18n()
    i18nReady = true
    loadRecordings()
  })
</script>

<svelte:head>
  <title>{t('drive_pageTitle')}</title>
</svelte:head>

<div
  class="browser-surface recording-manager-theme min-h-screen"
  data-surface="browser"
  style={`--recording-manager-max-width: ${RECORDING_MANAGER_THEME_CONTRACT.contentMaxWidthPx}px`}
>
  <header class="browser-header-surface sticky top-0 z-40 px-5">
    <div class="mx-auto flex h-full items-center justify-between gap-4" style="max-width: var(--recording-manager-max-width)">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-300 bg-blue-50 text-blue-700">
          <FolderOpen class="h-4.5 w-4.5" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="truncate text-sm font-semibold tracking-tight text-zinc-100">{t('drive_headerTitle')}</h1>
            <span class="rounded-full border border-white/8 bg-white/5 px-2 py-0.5 text-xs font-medium text-zinc-400">
              {recordings.length}
            </span>
          </div>
          <p class="hidden truncate text-xs text-zinc-500 sm:block">{t('drive_sort_hint')}</p>
        </div>
      </div>

      <button
        type="button"
        class="browser-primary-action inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold"
        onclick={handleStartRecording}
      >
        <Video class="h-4 w-4" />
        {t('drive_start_recording_btn')}
      </button>
    </div>
  </header>

  <main>
    <RecordingList
      {recordings}
      {isLoading}
      {errorMessage}
      onStartRecording={handleStartRecording}
      onRefresh={refreshRecordings}
      onDeleteRecording={deleteRecording}
      onDeleteSelected={deleteSelectedRecordings}
      onClearError={clearError}
    />
  </main>
</div>
