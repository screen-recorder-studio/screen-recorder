<script lang="ts">
  import {
    AlertCircle,
    AppWindow,
    ArrowRight,
    CircleDot,
    HardDrive,
    LoaderCircle,
    Monitor,
    Pause,
    Play,
    Settings2,
    ScanLine,
    Square,
    Video,
    X
  } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { _t as t, initI18n } from '$lib/utils/i18n'
  import {
    deriveRecordingPopupModel,
    getDisplayedElapsedMs
  } from '$lib/recording/recording-popup-model'
  import {
    createIdleRecordingSession,
    type RecordingMode,
    type RecordingSessionState
  } from '$lib/recording/recording-session'
  import { normalizeRecordingCountdown } from '$lib/recording/recording-startup'
  import { formatRecordingDuration } from '$lib/utils/recording-duration'
  import { emitJourneyEvent } from '$lib/observability/journey-events'

  const modes: Array<{ id: RecordingMode; icon: typeof Monitor; label: string; description: string }> = [
    { id: 'tab', icon: Monitor, label: 'control_modeTab', description: 'control_modeTabDesc' },
    { id: 'window', icon: AppWindow, label: 'control_modeWindow', description: 'control_modeWindowDesc' },
    { id: 'screen', icon: CircleDot, label: 'control_modeScreen', description: 'control_modeScreenDesc' }
  ]

  const gifFallbackMessages = {
    gifArea_title: 'Record GIF',
    gifArea_description: 'Select a page area · Opens in Studio',
    gifArea_preparing: 'Opening area selector…',
    gifArea_selecting: 'Select an area on the page',
    gifArea_selectingHelp: 'Finish on the page, or press Esc to cancel.',
    gifArea_cancel: 'Cancel area selection',
    gifArea_recording: 'Recording GIF area',
    gifArea_paused: 'GIF area recording paused',
    gifArea_saving: 'Saving GIF recording…',
    gifArea_badge: 'GIF · Area',
    gifArea_choose: 'Choose a recording',
    gifArea_videoSection: 'Video recording',
    gifArea_startVideo: 'Start video recording',
    gifArea_moreOptions: 'More recording options'
  }

  function gifText(key: keyof typeof gifFallbackMessages) {
    return t(key, undefined, gifFallbackMessages)
  }

  let extensionVersion = $state('')
  let session = $state<RecordingSessionState>(createIdleRecordingSession())
  let selectedMode = $state<RecordingMode>('tab')
  let countdownSeconds = $state(3)
  let actionInProgress = $state<string | null>(null)
  let commandError = $state('')
  let displayElapsedMs = $state(0)
  let model = $derived(deriveRecordingPopupModel(session))

  function applySession(next: unknown) {
    if (!next || typeof next !== 'object') return
    const candidate = next as RecordingSessionState
    if (!['idle', 'selecting', 'requesting', 'countdown', 'recording', 'paused', 'stopping', 'finalizing', 'failed'].includes(candidate.phase)) return
    session = candidate
    if (candidate.mode !== 'area') selectedMode = candidate.mode
    displayElapsedMs = getDisplayedElapsedMs(candidate)
    actionInProgress = null
  }

  async function initialize() {
    try { extensionVersion = chrome.runtime.getManifest().version } catch {}
    await initI18n()
    try {
      const stored = await new Promise<any>((resolve) => {
        chrome.storage.local.get(['settings'], (value) => resolve(value))
      })
      const configured = stored?.settings?.countdownSeconds
      countdownSeconds = normalizeRecordingCountdown(configured)
    } catch {}
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REQUEST_RECORDING_SESSION' })
      if (response?.ok) {
        applySession(response.state)
        if (response.state?.phase === 'idle' || response.state?.phase === 'failed') {
          emitJourneyEvent({ name: 'recording.entry_opened', context: 'popup' })
        }
      }
    } catch {
      commandError = t('control_errorRecordingFailed')
    }
  }

  onMount(() => {
    void initialize()
    const elapsedTimer = setInterval(() => {
      displayElapsedMs = getDisplayedElapsedMs(session)
    }, 250)
    const runtimeMessages = globalThis.chrome?.runtime?.onMessage
    const messageHandler = (message: any) => {
      if (message?.target === 'recording-ui' && message?.type === 'RECORDING_SESSION_UPDATED') {
        applySession(message.state)
      }
    }
    runtimeMessages?.addListener(messageHandler)
    return () => {
      clearInterval(elapsedTimer)
      runtimeMessages?.removeListener(messageHandler)
    }
  })

  async function persistCountdown(value: number) {
    countdownSeconds = normalizeRecordingCountdown(value)
    try {
      // Native select menus can close an action popup as soon as the option is
      // chosen. Dispatch persistence to the long-lived service worker before
      // yielding instead of depending on this disposable document.
      await chrome.runtime.sendMessage({
        type: 'SET_RECORDING_COUNTDOWN',
        value: countdownSeconds
      })
    } catch {}
  }

  async function startRecording() {
    if (!model.canStart || actionInProgress) return
    actionInProgress = 'start'
    commandError = ''
    try {
      let targetTabId: number | undefined
      if (selectedMode === 'tab') {
        const [targetTab] = await chrome.tabs.query({ active: true, currentWindow: true })
        targetTabId = targetTab?.id
      }
      const response = await chrome.runtime.sendMessage({
        type: 'REQUEST_START_RECORDING',
        payload: {
          options: {
            mode: selectedMode,
            video: true,
            audio: false,
            countdown: countdownSeconds,
            ...(targetTabId ? { targetTabId } : {})
          }
        }
      })
      if (!response?.ok) throw new Error(response?.error || t('control_errorStartFailed'))
      if (response.state) applySession(response.state)
    } catch (error) {
      commandError = error instanceof Error && error.message ? error.message : t('control_errorStartFailed')
      actionInProgress = null
      try {
        const stateResponse = await chrome.runtime.sendMessage({ type: 'REQUEST_RECORDING_SESSION' })
        if (stateResponse?.ok) applySession(stateResponse.state)
      } catch {}
    }
  }

  async function startGifAreaSelection() {
    if (!model.canStart || actionInProgress) return
    actionInProgress = 'gif-area'
    commandError = ''
    try {
      const [targetTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!targetTab?.id) throw new Error('No active page is available')
      const response = await chrome.runtime.sendMessage({
        type: 'REQUEST_GIF_AREA_SELECTION',
        targetTabId: targetTab.id,
        countdown: countdownSeconds
      })
      if (!response?.ok) throw new Error(response?.error || t('control_errorStartFailed'))
      window.close()
    } catch (error) {
      commandError = error instanceof Error && error.message ? error.message : t('control_errorStartFailed')
      actionInProgress = null
    }
  }

  async function cancelAreaSelection() {
    if (!model.canCancelSelection || actionInProgress) return
    actionInProgress = 'cancel-area'
    commandError = ''
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REQUEST_CANCEL_AREA_SELECTION' })
      if (!response?.ok) throw new Error(response?.error || t('control_errorRecordingFailed'))
      if (response.state) applySession(response.state)
    } catch (error) {
      commandError = error instanceof Error ? error.message : t('control_errorRecordingFailed')
      actionInProgress = null
    }
  }

  async function togglePause() {
    if (!model.canTogglePause || actionInProgress) return
    actionInProgress = 'pause'
    commandError = ''
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REQUEST_TOGGLE_PAUSE' })
      if (!response?.ok) throw new Error(response?.error || t('control_errorRecordingFailed'))
      if (response.state) applySession(response.state)
    } catch (error) {
      commandError = error instanceof Error ? error.message : t('control_errorRecordingFailed')
      actionInProgress = null
    }
  }

  async function stopRecording() {
    if (!model.canStop || actionInProgress) return
    actionInProgress = 'stop'
    commandError = ''
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REQUEST_STOP_RECORDING' })
      if (!response?.ok) throw new Error(response?.error || t('control_errorRecordingFailed'))
      if (response.state) applySession(response.state)
    } catch (error) {
      commandError = error instanceof Error ? error.message : t('control_errorRecordingFailed')
      actionInProgress = null
    }
  }

  async function openExtensionPage(type: 'OPEN_DRIVE' | 'OPEN_LATEST_RECORDING') {
    if (actionInProgress) return
    actionInProgress = type
    try {
      await chrome.runtime.sendMessage({ type })
      window.close()
    } catch {
      actionInProgress = null
    }
  }

  async function openLegacyControls() {
    if (actionInProgress) return
    actionInProgress = 'legacy'
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_CONTROL_WINDOW' })
      window.close()
    } catch {
      actionInProgress = null
    }
  }

  function statusText() {
    if (model.activeWorkflow === 'gif-area') {
      switch (session.phase) {
        case 'selecting': return gifText('gifArea_selecting')
        case 'recording': return gifText('gifArea_recording')
        case 'paused': return gifText('gifArea_paused')
        case 'stopping':
        case 'finalizing': return gifText('gifArea_saving')
      }
    }
    switch (session.phase) {
      case 'requesting': return t('control_tipsPreparing')
      case 'countdown': return t('control_btnStarting', String(session.countdownRemaining))
      case 'recording': return t('control_statusRecording')
      case 'paused': return t('control_statusPaused')
      case 'stopping':
      case 'finalizing': return t('control_statusSaving')
      case 'failed': return t('control_errorRecordingFailed')
      default: return t('launcher_recordDesc')
    }
  }
</script>

<svelte:head>
  <title>{t('launcher_pageTitle')}</title>
</svelte:head>

<div class="browser-surface recording-entry-theme w-[360px] font-sans select-none" data-surface="browser">
  <header class="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
    <div class="flex min-w-0 items-center gap-2">
      <span
        class="flex h-8 w-8 items-center justify-center rounded-xl"
        class:bg-violet-100={model.activeWorkflow === 'gif-area'}
        class:text-violet-700={model.activeWorkflow === 'gif-area'}
        class:bg-red-50={model.activeWorkflow !== 'gif-area'}
        class:text-red-600={model.activeWorkflow !== 'gif-area'}
      >
        {#if model.activeWorkflow === 'gif-area'}
          <ScanLine class="h-5 w-5" />
        {:else}
          <CircleDot class="h-5 w-5" />
        {/if}
      </span>
      <div>
        <h1 class="text-base font-semibold leading-tight">{t('control_headerTitle')}</h1>
        <p class="mt-0.5 text-xs text-gray-500" aria-live="polite">{statusText()}</p>
      </div>
    </div>
    <button
      type="button"
      class="-mr-1 -mt-1 cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      aria-label={t('common_close')}
      title={t('common_close')}
      onclick={() => window.close()}
    >
      <X class="h-4 w-4" />
    </button>
  </header>

  <main class="px-4 pt-4 pb-4">
    {#if model.showSetup}
    <section aria-labelledby="recording-choice-label">
      <div class="mb-3 flex items-center justify-between px-1">
        <h2 id="recording-choice-label" class="text-xs font-semibold text-gray-700">{gifText('gifArea_choose')}</h2>
        <label class="flex items-center gap-1.5 text-xs text-gray-500">
          <span>{t('control_countdownLabel')}</span>
          <select
            class="cursor-pointer rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 outline-none focus:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed"
            disabled={!model.canSelectMode}
            bind:value={countdownSeconds}
            onchange={() => persistCountdown(countdownSeconds)}
          >
            <option value={0}>0s</option>
            <option value={1}>1s</option>
            <option value={3}>3s</option>
            <option value={5}>5s</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-3 text-left text-gray-900 transition-colors hover:border-violet-500 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        disabled={!!actionInProgress}
        aria-busy={actionInProgress === 'gif-area'}
        onclick={startGifAreaSelection}
      >
        <span class="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-violet-100 text-violet-700">
          {#if actionInProgress === 'gif-area'}
            <LoaderCircle class="h-4.5 w-4.5 animate-spin" />
          {:else}
            <ScanLine class="h-4.5 w-4.5" />
          {/if}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold">
            {actionInProgress === 'gif-area' ? gifText('gifArea_preparing') : gifText('gifArea_title')}
          </span>
          <span class="mt-0.5 block text-xs leading-4 text-gray-500">{gifText('gifArea_description')}</span>
        </span>
        {#if actionInProgress !== 'gif-area'}
          <ArrowRight class="h-4 w-4 flex-none text-violet-600" />
        {/if}
      </button>

      <div class="my-4 flex items-center gap-2">
        <span class="h-px flex-1 bg-gray-100" aria-hidden="true"></span>
        <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{gifText('gifArea_videoSection')}</h3>
        <span class="h-px flex-1 bg-gray-100" aria-hidden="true"></span>
      </div>

      <div class="grid grid-cols-3 gap-2">
        {#each modes as mode}
          {@const ModeIcon = mode.icon}
          <button
            type="button"
            class="cursor-pointer rounded-xl border px-2 py-3 text-center transition-all hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
            class:border-blue-500={selectedMode === mode.id}
            class:bg-blue-50={selectedMode === mode.id}
            class:text-blue-700={selectedMode === mode.id}
            class:border-gray-200={selectedMode !== mode.id}
            class:text-gray-600={selectedMode !== mode.id}
            class:opacity-60={!model.canSelectMode && selectedMode !== mode.id}
            disabled={!model.canSelectMode}
            aria-pressed={selectedMode === mode.id}
            title={t(mode.description)}
            onclick={() => { selectedMode = mode.id }}
          >
            <ModeIcon class="mx-auto mb-1.5 h-5 w-5" />
            <span class="block text-xs font-medium">{t(mode.label)}</span>
          </button>
        {/each}
      </div>

    </section>
    {/if}

    <section class={model.showSetup ? 'mt-3' : 'mt-0'} aria-live="polite">
      {#if session.phase === 'recording' || session.phase === 'paused'}
        <div class="mb-3 flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <div class="flex items-center gap-2.5 text-sm font-medium text-red-700">
            <span class="h-2.5 w-2.5 rounded-full bg-red-500" class:animate-pulse={session.phase === 'recording'}></span>
            <span>
              {#if model.activeWorkflow === 'gif-area'}
                <span class="block text-xs font-bold uppercase tracking-[0.12em] text-violet-700">{gifText('gifArea_badge')}</span>
              {/if}
              <span class="block">{session.phase === 'paused' ? t('control_statusPaused') : t('control_statusRecording')}</span>
            </span>
          </div>
          <span class="font-mono text-lg font-semibold tabular-nums text-red-700">{formatRecordingDuration(displayElapsedMs)}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-gray-900 px-3 py-3 text-xs font-semibold text-white transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            disabled={!!actionInProgress}
            onclick={togglePause}
          >
            {#if session.phase === 'paused'}<Play class="h-4 w-4" />{:else}<Pause class="h-4 w-4" />{/if}
            {session.phase === 'paused' ? t('control_btnResume') : t('control_btnPause')}
          </button>
          <button
            type="button"
            class="flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-red-600 px-3 py-3 text-xs font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            disabled={!!actionInProgress}
            onclick={stopRecording}
          >
            <Square class="h-4 w-4 fill-current" />
            {t('control_btnStop')}
          </button>
        </div>
      {:else if session.phase === 'selecting'}
        <div class="mb-3 flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-3 text-violet-950" role="status">
          <span class="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-violet-600 text-white">
            <ScanLine class="h-4.5 w-4.5" />
          </span>
          <span class="min-w-0">
            <span class="block text-xs font-bold uppercase tracking-[0.12em] text-violet-600">{gifText('gifArea_badge')}</span>
            <span class="mt-0.5 block text-sm font-semibold">{gifText('gifArea_selecting')}</span>
            <span class="mt-0.5 block text-[11px] leading-4 text-violet-700">{gifText('gifArea_selectingHelp')}</span>
          </span>
        </div>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          disabled={!!actionInProgress}
          onclick={cancelAreaSelection}
        >
          {#if actionInProgress === 'cancel-area'}<LoaderCircle class="h-5 w-5 animate-spin" />{:else}<X class="h-4 w-4" />{/if}
          {gifText('gifArea_cancel')}
        </button>
      {:else if model.tone === 'busy'}
        <div
          class="flex items-center justify-center gap-3 rounded-xl border px-4 py-4 text-sm font-medium"
          class:border-violet-200={model.activeWorkflow === 'gif-area'}
          class:bg-violet-50={model.activeWorkflow === 'gif-area'}
          class:text-violet-700={model.activeWorkflow === 'gif-area'}
          class:border-blue-100={model.activeWorkflow !== 'gif-area'}
          class:bg-blue-50={model.activeWorkflow !== 'gif-area'}
          class:text-blue-700={model.activeWorkflow !== 'gif-area'}
          role="status"
          aria-busy="true"
        >
          <LoaderCircle class="h-5 w-5 animate-spin" />
          <span>{statusText()}</span>
        </div>
      {:else}
        {#if session.phase === 'failed' || commandError}
          <div class="mb-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700" role="alert">
            <AlertCircle class="mt-0.5 h-4 w-4 flex-none" />
            <span>{commandError || session.errorCode || t('control_errorRecordingFailed')}</span>
          </div>
        {/if}
        <button
          type="button"
          class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          disabled={!model.canStart || !!actionInProgress}
          onclick={startRecording}
        >
          {#if actionInProgress === 'start'}
            <LoaderCircle class="h-5 w-5 animate-spin" />
            {t('control_btnPreparing')}
          {:else}
            <Play class="h-5 w-5 fill-current" />
            {gifText('gifArea_startVideo')}
          {/if}
        </button>
      {/if}
    </section>

    {#if model.showSetup}
    <button
      type="button"
      class="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      disabled={!!actionInProgress}
      onclick={openLegacyControls}
    >
      <Settings2 class="h-3.5 w-3.5" />
      {gifText('gifArea_moreOptions')}
    </button>
    {/if}
  </main>

  {#if model.showSetup}
  <footer class="flex items-center justify-between border-t border-gray-100 px-4 py-3">
    <div class="flex gap-1">
      <button
        type="button"
        class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onclick={() => openExtensionPage('OPEN_DRIVE')}
      >
        <HardDrive class="h-3.5 w-3.5" />{t('launcher_drive')}
      </button>
      <button
        type="button"
        class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onclick={() => openExtensionPage('OPEN_LATEST_RECORDING')}
      >
        <Video class="h-3.5 w-3.5" />{t('launcher_studio')}
      </button>
    </div>
    {#if extensionVersion}<span class="text-xs text-gray-500">v{extensionVersion}</span>{/if}
  </footer>
  {/if}
</div>
