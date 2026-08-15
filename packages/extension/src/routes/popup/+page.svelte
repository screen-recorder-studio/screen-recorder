<script lang="ts">
  import {
    AlertCircle,
    AppWindow,
    CircleDot,
    HardDrive,
    LoaderCircle,
    Monitor,
    Pause,
    Play,
    Settings2,
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
  import { formatRecordingDuration } from '$lib/utils/recording-duration'
  import { emitJourneyEvent } from '$lib/observability/journey-events'

  const modes: Array<{ id: RecordingMode; icon: typeof Monitor; label: string; description: string }> = [
    { id: 'tab', icon: Monitor, label: 'control_modeTab', description: 'control_modeTabDesc' },
    { id: 'window', icon: AppWindow, label: 'control_modeWindow', description: 'control_modeWindowDesc' },
    { id: 'screen', icon: CircleDot, label: 'control_modeScreen', description: 'control_modeScreenDesc' }
  ]

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
    if (!['idle', 'requesting', 'countdown', 'recording', 'paused', 'stopping', 'finalizing', 'failed'].includes(candidate.phase)) return
    session = candidate
    selectedMode = candidate.mode
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
      if (typeof configured === 'number' && configured >= 1 && configured <= 5) {
        countdownSeconds = Math.floor(configured)
      }
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
    const messageHandler = (message: any) => {
      if (message?.target === 'recording-ui' && message?.type === 'RECORDING_SESSION_UPDATED') {
        applySession(message.state)
      }
    }
    chrome.runtime.onMessage.addListener(messageHandler)
    return () => {
      clearInterval(elapsedTimer)
      chrome.runtime.onMessage.removeListener(messageHandler)
    }
  })

  async function persistCountdown(value: number) {
    countdownSeconds = Math.min(5, Math.max(1, Math.floor(value)))
    try {
      const stored = await new Promise<any>((resolve) => {
        chrome.storage.local.get(['settings'], (value) => resolve(value))
      })
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({
          settings: { ...(stored?.settings || {}), countdownSeconds }
        }, () => resolve())
      })
    } catch {}
  }

  async function startRecording() {
    if (!model.canStart || actionInProgress) return
    actionInProgress = 'start'
    commandError = ''
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REQUEST_START_RECORDING',
        payload: {
          options: {
            mode: selectedMode,
            video: true,
            audio: false,
            countdown: countdownSeconds
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

<div class="w-[360px] bg-white font-sans text-gray-900 select-none">
  <header class="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
    <div class="flex min-w-0 items-center gap-2">
      <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-600">
        <CircleDot class="h-5 w-5" />
      </span>
      <div>
        <h1 class="text-base font-semibold leading-tight">{t('control_headerTitle')}</h1>
        <p class="mt-0.5 text-xs text-gray-500">{statusText()}</p>
      </div>
    </div>
    <button
      type="button"
      class="-mr-1 -mt-1 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      aria-label={t('common_close')}
      title={t('common_close')}
      onclick={() => window.close()}
    >
      <X class="h-4 w-4" />
    </button>
  </header>

  <main class="px-4 pb-4">
    <section aria-labelledby="recording-mode-label">
      <div class="mb-2 flex items-center justify-between px-1">
        <h2 id="recording-mode-label" class="text-xs font-medium text-gray-600">{t('control_recordingMode')}</h2>
        <label class="flex items-center gap-1.5 text-xs text-gray-500">
          <span>{t('control_countdownLabel')}</span>
          <select
            class="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 outline-none focus:border-blue-400"
            disabled={!model.canSelectMode}
            value={countdownSeconds}
            onchange={(event) => persistCountdown(Number(event.currentTarget.value))}
          >
            <option value="1">1s</option>
            <option value="3">3s</option>
            <option value="5">5s</option>
          </select>
        </label>
      </div>

      <div class="grid grid-cols-3 gap-2">
        {#each modes as mode}
          {@const ModeIcon = mode.icon}
          <button
            type="button"
            class="rounded-xl border px-2 py-3 text-center transition-all hover:border-blue-300"
            class:border-blue-500={selectedMode === mode.id}
            class:bg-blue-50={selectedMode === mode.id}
            class:text-blue-700={selectedMode === mode.id}
            class:border-gray-200={selectedMode !== mode.id}
            class:text-gray-600={selectedMode !== mode.id}
            class:opacity-60={!model.canSelectMode && selectedMode !== mode.id}
            disabled={!model.canSelectMode}
            title={t(mode.description)}
            onclick={() => { selectedMode = mode.id }}
          >
            <ModeIcon class="mx-auto mb-1.5 h-5 w-5" />
            <span class="block text-xs font-medium">{t(mode.label)}</span>
          </button>
        {/each}
      </div>
    </section>

    <section class="mt-4">
      {#if session.phase === 'recording' || session.phase === 'paused'}
        <div class="mb-3 flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <div class="flex items-center gap-2 text-sm font-medium text-red-700">
            <span class="h-2.5 w-2.5 rounded-full bg-red-500" class:animate-pulse={session.phase === 'recording'}></span>
            {session.phase === 'paused' ? t('control_statusPaused') : t('control_statusRecording')}
          </div>
          <span class="font-mono text-lg font-semibold tabular-nums text-red-700">{formatRecordingDuration(displayElapsedMs)}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-60"
            disabled={!!actionInProgress}
            onclick={togglePause}
          >
            {#if session.phase === 'paused'}<Play class="h-4 w-4" />{:else}<Pause class="h-4 w-4" />{/if}
            {session.phase === 'paused' ? t('control_btnResume') : t('control_btnPause')}
          </button>
          <button
            type="button"
            class="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            disabled={!!actionInProgress}
            onclick={stopRecording}
          >
            <Square class="h-4 w-4 fill-current" />
            {t('control_btnStop')}
          </button>
        </div>
      {:else if model.tone === 'busy'}
        <div class="flex items-center justify-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm font-medium text-blue-700">
          <LoaderCircle class="h-5 w-5 animate-spin" />
          <span>{statusText()}</span>
        </div>
      {:else}
        {#if session.phase === 'failed' || commandError}
          <div class="mb-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            <AlertCircle class="mt-0.5 h-4 w-4 flex-none" />
            <span>{commandError || session.errorCode || t('control_errorRecordingFailed')}</span>
          </div>
        {/if}
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60"
          disabled={!model.canStart || !!actionInProgress}
          onclick={startRecording}
        >
          {#if actionInProgress === 'start'}
            <LoaderCircle class="h-5 w-5 animate-spin" />
            {t('control_btnPreparing')}
          {:else}
            <Play class="h-5 w-5 fill-current" />
            {t('control_btnStart')}
          {/if}
        </button>
      {/if}
    </section>

    <button
      type="button"
      class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
      disabled={!!actionInProgress}
      onclick={openLegacyControls}
    >
      <Settings2 class="h-3.5 w-3.5" />
      {t('control_headerDesc')}
    </button>
  </main>

  <footer class="flex items-center justify-between border-t border-gray-100 px-4 py-3">
    <div class="flex gap-1">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100"
        onclick={() => openExtensionPage('OPEN_DRIVE')}
      >
        <HardDrive class="h-3.5 w-3.5" />{t('launcher_drive')}
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100"
        onclick={() => openExtensionPage('OPEN_LATEST_RECORDING')}
      >
        <Video class="h-3.5 w-3.5" />{t('launcher_studio')}
      </button>
    </div>
    {#if extensionVersion}<span class="text-[10px] text-gray-400">v{extensionVersion}</span>{/if}
  </footer>
</div>
