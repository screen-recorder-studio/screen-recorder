<script lang="ts">
  import { tick } from 'svelte'
  import { AlertTriangle, CheckSquare, FolderOpen, RefreshCw, Trash2, Video } from '@lucide/svelte'
  import RecordingCard from './RecordingCard.svelte'
  import { RECORDING_MANAGER_THEME_CONTRACT, resolveRecordingManagerMode } from '$lib/drive/recording-manager-theme'
  import { _t as t } from '$lib/utils/i18n'
  import type { RecordingSummary } from '$lib/types/recordings'

  interface Props {
    recordings: RecordingSummary[]
    isLoading: boolean
    errorMessage: string
    onStartRecording: () => void | Promise<void>
    onRefresh: () => void
    onDeleteRecording: (id: string) => Promise<void>
    onDeleteSelected: (ids: string[]) => Promise<void>
    onClearError: () => void
  }

  let {
    recordings,
    isLoading,
    errorMessage,
    onStartRecording,
    onRefresh,
    onDeleteRecording,
    onDeleteSelected,
    onClearError
  }: Props = $props()

  let selectedRecordings = $state<Set<string>>(new Set())
  let showDeleteConfirm = $state(false)
  let deleteTarget = $state<string | 'selected'>('')
  let isDeleting = $state(false)
  let listContentEl = $state<HTMLDivElement | null>(null)
  let deleteDialogEl = $state<HTMLDivElement | null>(null)
  let cancelDeleteEl = $state<HTMLButtonElement | null>(null)
  let deleteTriggerEl: HTMLElement | null = null

  const managerMode = $derived(resolveRecordingManagerMode(selectedRecordings.size))
  const allSelected = $derived(recordings.length > 0 && selectedRecordings.size === recordings.length)
  const partiallySelected = $derived(selectedRecordings.size > 0 && selectedRecordings.size < recordings.length)

  function toggleSelection(recordingId: string) {
    if (selectedRecordings.has(recordingId)) {
      selectedRecordings.delete(recordingId)
    } else {
      selectedRecordings.add(recordingId)
    }
    selectedRecordings = new Set(selectedRecordings)
  }

  function toggleSelectAll() {
    selectedRecordings = allSelected ? new Set() : new Set(recordings.map((recording) => recording.id))
  }

  function clearSelection() {
    selectedRecordings = new Set()
  }

  function confirmDelete(target: string | 'selected') {
    const activeElement = document.activeElement
    deleteTriggerEl = activeElement instanceof HTMLElement ? activeElement : null
    deleteTarget = target
    showDeleteConfirm = true
    void tick().then(() => cancelDeleteEl?.focus())
  }

  function closeDeleteConfirm() {
    if (isDeleting) return
    const trigger = deleteTriggerEl
    showDeleteConfirm = false
    deleteTarget = ''
    deleteTriggerEl = null
    void tick().then(() => {
      if (trigger?.isConnected) trigger.focus()
      else listContentEl?.focus()
    })
  }

  async function executeDelete() {
    if (!deleteTarget || isDeleting) return
    isDeleting = true

    try {
      if (deleteTarget === 'selected') {
        await onDeleteSelected(Array.from(selectedRecordings))
        selectedRecordings = new Set()
      } else {
        await onDeleteRecording(deleteTarget)
        selectedRecordings.delete(deleteTarget)
        selectedRecordings = new Set(selectedRecordings)
      }
    } catch (error) {
      console.error('Delete failed:', error)
    } finally {
      isDeleting = false
      showDeleteConfirm = false
      deleteTarget = ''
      deleteTriggerEl = null
      void tick().then(() => listContentEl?.focus())
    }
  }

  function handleDeleteDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDeleteConfirm()
      return
    }

    if (event.key !== 'Tab' || !deleteDialogEl) return
    const focusable = Array.from(deleteDialogEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ))
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && (document.activeElement === first || document.activeElement === deleteDialogEl)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  $effect(() => {
    const validIds = new Set(recordings.map((recording) => recording.id))
    const filteredSelection = new Set([...selectedRecordings].filter((id) => validIds.has(id)))
    if (filteredSelection.size !== selectedRecordings.size) {
      selectedRecordings = filteredSelection
    }
  })
</script>

<div
  bind:this={listContentEl}
  class="mx-auto px-5 py-6 focus:outline-none sm:py-8"
  style="max-width: var(--recording-manager-max-width)"
  data-mode={managerMode}
  aria-busy={isLoading}
  aria-hidden={showDeleteConfirm ? 'true' : undefined}
  inert={showDeleteConfirm}
  tabindex="-1"
>
  <section class="studio-panel-card mb-5 flex min-h-14 flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
    <div class="flex min-w-0 flex-wrap items-center gap-2.5">
      {#if recordings.length > 0}
        <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/5">
          <input
            type="checkbox"
            checked={allSelected}
            indeterminate={partiallySelected}
            onchange={toggleSelectAll}
            class="h-4 w-4 rounded border-white/20 bg-zinc-950 accent-blue-500"
          />
          <span>{t('drive_select_all', String(recordings.length))}</span>
        </label>
      {/if}

      {#if selectedRecordings.size > 0}
        <span class="hidden h-5 w-px bg-white/10 sm:block"></span>
        <span class="inline-flex items-center gap-1.5 rounded-lg border border-blue-400/20 bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-200">
          <CheckSquare class="h-3.5 w-3.5" />
          {selectedRecordings.size}
        </span>
        <button
          type="button"
          onclick={() => confirmDelete('selected')}
          disabled={isLoading}
          class="inline-flex items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 class="h-3.5 w-3.5" />
          {t('drive_delete_selected_btn', String(selectedRecordings.size))}
        </button>
        <button
          type="button"
          onclick={clearSelection}
          class="browser-muted-action px-2.5 py-1.5 text-xs font-medium"
        >
          {t('drive_clear_selection')}
        </button>
      {/if}
    </div>

    <button
      type="button"
      onclick={onRefresh}
      disabled={isLoading}
      class="browser-muted-action inline-flex items-center gap-2 px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshCw class="h-3.5 w-3.5 {isLoading ? 'animate-spin' : ''}" />
      {t('drive_refresh')}
    </button>
  </section>

  {#if errorMessage}
    <section class="mb-5 rounded-xl border border-red-400/20 bg-red-500/10 p-4" role="alert">
      <div class="flex items-center gap-2 text-red-200">
        <AlertTriangle class="h-4 w-4" />
        <span class="text-sm font-semibold">{t('drive_error_title')}</span>
      </div>
      <p class="mt-1.5 text-sm text-red-300/80">{errorMessage}</p>
      <button type="button" onclick={onClearError} class="mt-3 text-xs font-medium text-red-300 hover:text-red-100">
        {t('drive_close_error')}
      </button>
    </section>
  {/if}

  {#if isLoading}
    <section class="studio-panel-card flex min-h-72 items-center justify-center" role="status">
      <div class="flex flex-col items-center gap-3 text-zinc-500">
        <div class="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10">
          <RefreshCw class="h-5 w-5 animate-spin text-blue-300" />
        </div>
        <span class="text-sm text-zinc-500">{t('drive_loading')}</span>
      </div>
    </section>
  {:else if recordings.length === 0}
    <section class="studio-panel-card flex min-h-[420px] flex-col items-center justify-center px-6 py-16 text-center">
      <div class="studio-dialog-leading mb-5 flex h-16 w-16 items-center justify-center rounded-2xl">
        <FolderOpen class="h-7 w-7" />
      </div>
      <h2 class="text-lg font-semibold text-zinc-100">{t('drive_empty_title')}</h2>
      <p class="mt-2 max-w-md text-sm leading-6 text-zinc-400">{t('drive_empty_desc1')}</p>
      <p class="max-w-md text-sm leading-6 text-zinc-400">{t('drive_empty_desc2')}</p>
      <button
        type="button"
        class="browser-primary-action mt-6 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold"
        onclick={() => void onStartRecording()}
      >
        <Video class="h-4 w-4" />
        {t('drive_start_recording_btn')}
      </button>
    </section>
  {:else}
    <section
      class="grid gap-4"
      aria-label={t('drive_headerTitle')}
      style={`grid-template-columns: repeat(auto-fill, minmax(min(100%, ${RECORDING_MANAGER_THEME_CONTRACT.cardMinWidthPx}px), 1fr))`}
    >
      {#each recordings as recording (recording.id)}
        <RecordingCard
          {recording}
          selected={selectedRecordings.has(recording.id)}
          onToggleSelect={() => toggleSelection(recording.id)}
          onDelete={() => confirmDelete(recording.id)}
        />
      {/each}
    </section>
  {/if}
</div>

{#if showDeleteConfirm}
  <div class="studio-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      type="button"
      class="absolute inset-0 bg-transparent"
      aria-label={t('drive_cancel')}
      tabindex="-1"
      onclick={closeDeleteConfirm}
    ></button>

    <div
      bind:this={deleteDialogEl}
      class="studio-dialog-panel relative w-full max-w-sm p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="recording-manager-delete-title"
      aria-describedby="recording-manager-delete-description"
      tabindex="-1"
      onkeydown={handleDeleteDialogKeydown}
    >
      <div class="flex items-start gap-3">
        <div class="mt-0.5 rounded-xl border border-red-400/20 bg-red-500/10 p-2 text-red-300">
          <AlertTriangle class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 id="recording-manager-delete-title" class="text-base font-semibold text-zinc-100">
            {t('drive_confirm_delete_title')}
          </h2>
          <p id="recording-manager-delete-description" class="mt-2 text-sm leading-6 text-zinc-400">
            {#if deleteTarget === 'selected'}
              {t('drive_confirm_delete_selected', String(selectedRecordings.size))}
            {:else}
              {t('drive_confirm_delete_single')}
            {/if}
            <span class="block text-zinc-400">{t('drive_action_undone')}</span>
          </p>
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-3">
        <button
          bind:this={cancelDeleteEl}
          type="button"
          onclick={closeDeleteConfirm}
          class="browser-muted-action px-4 py-2 text-sm font-medium"
          disabled={isDeleting}
        >
          {t('drive_cancel')}
        </button>
        <button
          type="button"
          onclick={executeDelete}
          class="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isDeleting}
        >
          {#if isDeleting}
            <RefreshCw class="h-4 w-4 animate-spin" />
          {:else}
            <Trash2 class="h-4 w-4" />
          {/if}
          {t('drive_delete')}
        </button>
      </div>
    </div>
  </div>
{/if}
