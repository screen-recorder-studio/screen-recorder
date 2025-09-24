<script lang="ts">
  import { RefreshCw, Trash2, AlertTriangle, Folder } from '@lucide/svelte'
  import RecordingCard from './RecordingCard.svelte'

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

  // Props
  interface Props {
    recordings: RecordingSummary[]
    isLoading: boolean
    errorMessage: string
    onRefresh: () => void
    onDeleteRecording: (id: string) => Promise<void>
    onDeleteSelected: (ids: string[]) => Promise<void>
    onClearError: () => void
  }

  let { 
    recordings, 
    isLoading, 
    errorMessage, 
    onRefresh, 
    onDeleteRecording, 
    onDeleteSelected,
    onClearError 
  }: Props = $props()

  // Local state management
  let selectedRecordings = $state<Set<string>>(new Set())
  let showDeleteConfirm = $state(false)
  let deleteTarget = $state<string | 'selected'>('')

  // Toggle selection
  function toggleSelection(recordingId: string) {
    if (selectedRecordings.has(recordingId)) {
      selectedRecordings.delete(recordingId)
    } else {
      selectedRecordings.add(recordingId)
    }
    selectedRecordings = new Set(selectedRecordings) // Trigger reactive update
  }

  // Select all/deselect all
  function toggleSelectAll() {
    if (selectedRecordings.size === recordings.length) {
      selectedRecordings = new Set()
    } else {
      selectedRecordings = new Set(recordings.map(r => r.id))
    }
  }

  // Clear selection
  function clearSelection() {
    selectedRecordings = new Set()
  }

  // Confirm delete
  function confirmDelete(target: string | 'selected') {
    deleteTarget = target
    showDeleteConfirm = true
  }

  // Execute delete
  async function executeDelete() {
    try {
      if (deleteTarget === 'selected') {
        const toDelete = Array.from(selectedRecordings)
        await onDeleteSelected(toDelete)
        selectedRecordings = new Set()
      } else if (typeof deleteTarget === 'string') {
        await onDeleteRecording(deleteTarget)
        selectedRecordings.delete(deleteTarget)
        selectedRecordings = new Set(selectedRecordings)
      }
    } catch (error) {
      console.error('Delete failed:', error)
    } finally {
      showDeleteConfirm = false
      deleteTarget = ''
    }
  }

  // Clean up invalid selections when recording list changes
  $effect(() => {
    const validIds = new Set(recordings.map(r => r.id))
    const filteredSelection = new Set([...selectedRecordings].filter(id => validIds.has(id)))
    if (filteredSelection.size !== selectedRecordings.size) {
      selectedRecordings = filteredSelection
    }
  })
</script>

<div class="max-w-6xl mx-auto px-6 py-6">
  <!-- Action bar -->
  <div class="mb-6 flex items-center justify-between">
    <div class="flex items-center gap-3">
      {#if selectedRecordings.size > 0}
        <button
          onclick={() => confirmDelete('selected')}
          disabled={isLoading}
          class="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Trash2 class="w-4 h-4" />
          Delete Selected ({selectedRecordings.size})
        </button>
        <button
          onclick={clearSelection}
          class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
        >
          Clear Selection
        </button>
      {/if}
    </div>
    
    <button
      onclick={onRefresh}
      disabled={isLoading}
      class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <RefreshCw class="w-4 h-4 {isLoading ? 'animate-spin' : ''}" />
      Refresh
    </button>
  </div>

  <!-- Error message -->
  {#if errorMessage}
    <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
      <div class="flex items-center gap-2 text-red-800">
        <AlertTriangle class="w-5 h-5" />
        <span class="font-medium">Error</span>
      </div>
      <p class="mt-1 text-red-700">{errorMessage}</p>
      <button onclick={onClearError} class="mt-2 text-sm text-red-600 hover:text-red-800">Close</button>
    </div>
  {/if}

  <!-- Loading state -->
  {#if isLoading}
    <div class="flex items-center justify-center py-12">
      <div class="flex items-center gap-3 text-gray-600">
        <RefreshCw class="w-5 h-5 animate-spin" />
        <span>Loading recordings...</span>
      </div>
    </div>
  {:else if recordings.length === 0}
    <!-- Empty state -->
    <div class="text-center py-12">
      <Folder class="w-16 h-16 text-gray-300 mx-auto mb-4" />
      <h3 class="text-lg font-medium text-gray-900 mb-2">No recordings yet</h3>
      <p class="text-gray-500 mb-4">You don't have any screen recordings yet.</p>
      <p class="text-gray-500 mb-6">Start recording your screen and your recordings will appear here.</p>
      <a href="/sidepanel" class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Start Recording</a>
    </div>
  {:else}
    <!-- Recording list -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input 
            type="checkbox" 
            checked={selectedRecordings.size === recordings.length && recordings.length > 0}
            indeterminate={selectedRecordings.size > 0 && selectedRecordings.size < recordings.length}
            onchange={toggleSelectAll}
            class="w-4 h-4"
          />
          <span class="text-gray-700">Select All ({recordings.length} recordings)</span>
        </label>
      </div>
      <div class="text-sm text-gray-500">
        Sorted by time (newest first)
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {#each recordings as recording (recording.id)}
        <RecordingCard 
          {recording}
          selected={selectedRecordings.has(recording.id)}
          onToggleSelect={() => toggleSelection(recording.id)}
          onDelete={() => confirmDelete(recording.id)}
        />
      {/each}
    </div>
  {/if}
</div>

<!-- Delete confirmation dialog -->
{#if showDeleteConfirm}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
      <div class="flex items-center gap-3 mb-4">
        <AlertTriangle class="w-6 h-6 text-red-500" />
        <h3 class="text-lg font-semibold text-gray-900">Confirm Delete</h3>
      </div>
      
      <p class="text-gray-700 mb-6">
        {#if deleteTarget === 'selected'}
          Are you sure you want to delete the selected {selectedRecordings.size} recordings?
        {:else}
          Are you sure you want to delete this recording?
        {/if}
        This action cannot be undone.
      </p>
      
      <div class="flex justify-end gap-3">
        <button
          onclick={() => showDeleteConfirm = false}
          class="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
        >
          Cancel
        </button>
        <button
          onclick={executeDelete}
          class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
{/if}