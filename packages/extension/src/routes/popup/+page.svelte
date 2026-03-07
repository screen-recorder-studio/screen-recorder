<script lang="ts">
  import { Video, HardDrive, CircleDot, ChevronRight, X } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { _t as t, initI18n } from '$lib/utils/i18n'

  let extensionVersion = $state('')
  let actionInProgress = $state<string | null>(null)

  onMount(async () => {
    try { extensionVersion = chrome.runtime.getManifest().version } catch {}
    await initI18n()
  })

  async function openRecord() {
    if (actionInProgress) return
    actionInProgress = 'record'
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_CONTROL_WINDOW' })
      window.close()
    } catch (e) {
      console.error('Failed to open control window:', e)
      actionInProgress = null
    }
  }

  async function openDrive() {
    if (actionInProgress) return
    actionInProgress = 'drive'
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_DRIVE' })
      window.close()
    } catch (e) {
      console.error('Failed to open drive:', e)
      actionInProgress = null
    }
  }

  async function openStudio() {
    if (actionInProgress) return
    actionInProgress = 'studio'
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_LATEST_RECORDING' })
      window.close()
    } catch (e) {
      console.error('Failed to open studio:', e)
      actionInProgress = null
    }
  }
</script>

<svelte:head>
  <title>{t('launcher_pageTitle')}</title>
</svelte:head>

<div class="w-[320px] bg-white font-sans select-none">
  <!-- Header -->
  <div class="px-5 pt-5 pb-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-base font-semibold text-gray-900">
          {t('launcher_title')}
        </h1>
        <p class="text-xs text-gray-500 mt-0.5">
          {t('launcher_subtitle')}
        </p>
      </div>
      <button
        type="button"
        class="-mr-1 -mt-1 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        aria-label={t('drive_close_error')}
        title={t('drive_close_error')}
        onclick={() => window.close()}
      >
        <X class="w-4 h-4" />
      </button>
    </div>
  </div>

  <!-- Action cards -->
  <div class="px-4 pb-4 space-y-2">
    <!-- Record card -->
    <button
      class="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-all duration-150 group text-left"
      class:opacity-60={actionInProgress !== null && actionInProgress !== 'record'}
      disabled={actionInProgress !== null}
      onclick={openRecord}
    >
      <div class="flex-shrink-0 w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center">
        <CircleDot class="w-5 h-5 text-red-600" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">
          {t('launcher_record')}
        </div>
        <div class="text-xs text-gray-500 truncate">
          {t('launcher_recordDesc')}
        </div>
      </div>
      <ChevronRight class="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
    </button>

    <!-- Drive card -->
    <button
      class="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-all duration-150 group text-left"
      class:opacity-60={actionInProgress !== null && actionInProgress !== 'drive'}
      disabled={actionInProgress !== null}
      onclick={openDrive}
    >
      <div class="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
        <HardDrive class="w-5 h-5 text-amber-600" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">
          {t('launcher_drive')}
        </div>
        <div class="text-xs text-gray-500 truncate">
          {t('launcher_driveDesc')}
        </div>
      </div>
      <ChevronRight class="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
    </button>

    <!-- Studio card -->
    <button
      class="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-all duration-150 group text-left"
      class:opacity-60={actionInProgress !== null && actionInProgress !== 'studio'}
      disabled={actionInProgress !== null}
      onclick={openStudio}
    >
      <div class="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
        <Video class="w-5 h-5 text-blue-600" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">
          {t('launcher_studio')}
        </div>
        <div class="text-xs text-gray-500 truncate">
          {t('launcher_studioDesc')}
        </div>
      </div>
      <ChevronRight class="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
    </button>
  </div>

  <!-- Footer -->
  <div class="px-5 pb-3 pt-1 border-t border-gray-100">
    <p class="text-[10px] text-gray-400 text-center">
      Screen Recorder Studio{#if extensionVersion}&nbsp;v{extensionVersion}{/if}
    </p>
  </div>
</div>