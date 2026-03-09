<script lang="ts">
  import { onMount } from 'svelte'
  import { Folder } from '@lucide/svelte'
  import RecordingList from '$lib/components/drive/RecordingList.svelte'
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

<div class="min-h-screen bg-gray-50">
  <!-- Header -->
  <div class="bg-white border-b border-gray-200 px-6 py-4">
    <div class="max-w-6xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Folder class="w-6 h-6 text-gray-700" />
        <h1 class="text-2xl font-bold text-gray-900">{t('drive_headerTitle')}</h1>
      </div>
    </div>
  </div>

  <!-- Recording list component -->
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
</div>
