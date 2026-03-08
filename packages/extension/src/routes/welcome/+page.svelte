<script lang="ts">
  import {
    Monitor,
    AppWindow,
    ScreenShare,
    Play,
    Pause,
    Square,
    LoaderCircle,
    Clock,
    CircleAlert,
    HardDrive,
    Zap,
    CircleCheck,
    X,
    Film,
    ShieldCheck,
    Sparkles,
    Puzzle,
    Video,
    Scissors,
    Download,
    ChevronRight
  } from '@lucide/svelte'
  import { onDestroy, onMount } from 'svelte'
  import { _t } from '$lib/utils/i18n'
  import { formatRecordingDuration, normalizeElapsedMs } from '$lib/utils/recording-duration'

  // Extension version
  let extensionVersion = $state('')

  // Recording state management
  let isRecording = $state(false)
  let isPaused = $state(false)
  let selectedMode = $state<'tab' | 'window' | 'screen'>('tab')
  let isLoading = $state(false)
  let errorMessage = $state('')
  let warningMessage = $state('')
  let elapsedBaseMs = $state(0)
  let elapsedAnchorAt = $state<number | null>(null)
  let displayElapsedMs = $state(0)
  let countdownActive = $state(false)
  let countdownValue = $state(0)
  let countdownTimer: ReturnType<typeof setTimeout> | null = null
  let elapsedTimer: ReturnType<typeof setInterval> | null = null
  const DEFAULT_COUNTDOWN_SECONDS = 3
  const MAX_COUNTDOWN_SECONDS = 10
  let countdownSeconds = $state(DEFAULT_COUNTDOWN_SECONDS)

  function sanitizeCountdown(seconds: number) {
    return Number.isFinite(seconds) ? Math.max(0, Math.min(MAX_COUNTDOWN_SECONDS, seconds)) : DEFAULT_COUNTDOWN_SECONDS
  }

  function clearError() {
    errorMessage = ''
  }

  function clearWarning() {
    warningMessage = ''
  }

  function clearElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
  }

  function syncElapsedDisplay() {
    if (isRecording && !isPaused && typeof elapsedAnchorAt === 'number') {
      displayElapsedMs = elapsedBaseMs + Math.max(0, Date.now() - elapsedAnchorAt)
      return
    }
    displayElapsedMs = elapsedBaseMs
  }

  function startElapsedTimer() {
    clearElapsedTimer()
    if (!isRecording || isPaused) return
    elapsedAnchorAt = typeof elapsedAnchorAt === 'number' ? elapsedAnchorAt : Date.now()
    syncElapsedDisplay()
    elapsedTimer = setInterval(syncElapsedDisplay, 250)
  }

  function setElapsedSnapshot(rawElapsedMs: unknown, options: { running?: boolean; fallbackStartTime?: unknown } = {}) {
    const running = options.running ?? (isRecording && !isPaused)
    const safeElapsedMs = normalizeElapsedMs(rawElapsedMs)
    const fallbackStartTime = typeof options.fallbackStartTime === 'number' && Number.isFinite(options.fallbackStartTime) && options.fallbackStartTime > 0
      ? options.fallbackStartTime
      : null

    elapsedBaseMs = safeElapsedMs > 0 || fallbackStartTime === null
      ? safeElapsedMs
      : Math.max(0, Date.now() - fallbackStartTime)

    elapsedAnchorAt = running ? Date.now() : null
    syncElapsedDisplay()

    if (running) startElapsedTimer()
    else clearElapsedTimer()
  }

  function resetElapsedDisplay() {
    elapsedBaseMs = 0
    elapsedAnchorAt = null
    displayElapsedMs = 0
    clearElapsedTimer()
  }

  const FALLBACK_MESSAGES: Record<string, string> = {
    appName: 'Screen Recorder Studio',
    welcome_pageTitle: 'Welcome to Screen Recorder Studio',
    welcome_headerSubtitle: 'Professional Browser Recording Tool',
    welcome_installSuccess: 'Installation Successful',
    welcome_headline: 'Record, Edit, and Export in Seconds. 🎉',
    welcome_subheadline: 'Capture hours of footage smoothly, then edit and export as high-quality Videos or GIFs—all processed securely in your browser.',
    welcome_proTrialActive: 'PRO Trial Activated',
    welcome_feat1Title: 'Private & Local',
    welcome_feat2Title: 'No Watermarks',
    welcome_feat3Title: 'Quick Editing',
    welcome_feat4Title: 'Video & GIF Export',
    welcome_trustNoWatermark: 'No Watermarks',
    welcome_trustHD: 'HD Quality',
    welcome_trustLocal: 'Private & Local',
    welcome_trustQuickEditing: 'Quick Editing',
    welcome_tryTitle: 'Start Your First Recording 🚀',
    welcome_trySubtitle: 'Pick what to capture and start recording—Studio opens when you stop.',
    control_modeTab: 'Tab',
    control_modeTabDesc: 'Record current tab',
    control_modeWindow: 'Window',
    control_modeWindowDesc: 'Record entire window',
    control_modeScreen: 'Screen',
    control_modeScreenDesc: 'Record entire screen',
    welcome_modeTabDetail: 'Perfect for web demos and tutorials',
    welcome_modeWindowDetail: 'Includes address bar and toolbar',
    welcome_modeScreenDetail: 'Best for cross-application workflows',
    control_btnStart: 'Start Recording',
    control_btnPause: 'Pause Recording',
    control_btnResume: 'Resume Recording',
    control_btnStop: 'Stop Recording',
    control_btnPreparing: 'Preparing...',
    control_statusPaused: 'Recording Paused',
    welcome_statusRecording: 'Recording in Progress',
    welcome_modeLabel: 'Mode',
    welcome_howTitle: 'Your Recording Journey',
    welcome_howDesc: 'From capturing to exporting, everything happens securely in your browser.',
    journey_step1Title: 'Pin to Toolbar',
    journey_step1Desc: 'Click the puzzle icon 🧩 and pin the extension for quick access to start capturing anytime.',
    journey_step2Title: 'Record',
    journey_step2Desc: 'Capture your tab, window, or entire screen. Enjoy unlimited recording time without lagging.',
    journey_step3Title: 'Quick Edit',
    journey_step3Desc: 'Trim out mistakes, crop to the perfect ratio, and zoom to highlight details.',
    journey_step4Title: 'Export Video & GIF',
    journey_step4Desc: 'Save instantly as high-quality MP4, WebM, or GIF. 100% processed locally—no uploads.',
    control_btnStarting: 'Starting in $1...',
    control_overlayRecordingStarts: 'Recording will begin after the countdown',
    control_btnSkipCountdown: 'Skip countdown',
    welcome_footerHelp: 'Need more control? Click the extension icon to access advanced recording and export settings.',
    welcome_footerMeta: 'Screen Recorder Studio • Made for professionals'
  }

  const t = (key: string, subs?: string | string[]) => _t(key, subs, FALLBACK_MESSAGES)

  // Recording mode configuration
  const recordingModes = [
    {
      id: 'tab' as const,
      nameKey: 'control_modeTab',
      descriptionKey: 'control_modeTabDesc',
      detailKey: 'welcome_modeTabDetail',
      icon: Monitor
    },
    {
      id: 'window' as const,
      nameKey: 'control_modeWindow',
      descriptionKey: 'control_modeWindowDesc',
      detailKey: 'welcome_modeWindowDetail',
      icon: AppWindow
    },
    {
      id: 'screen' as const,
      nameKey: 'control_modeScreen',
      descriptionKey: 'control_modeScreenDesc',
      detailKey: 'welcome_modeScreenDetail',
      icon: ScreenShare
    }
  ]

  // Initialize: sync background state and load settings
  onMount(async () => {
    try {
      extensionVersion = chrome.runtime.getManifest().version
    } catch {}

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'REQUEST_RECORDING_STATE' })
      isRecording = !!resp?.state?.isRecording
      isPaused = !!resp?.state?.isPaused
      if (isRecording) {
        setElapsedSnapshot(resp?.state?.elapsedMs, { running: !isPaused, fallbackStartTime: resp?.state?.startTime })
      } else {
        resetElapsedDisplay()
      }
    } catch (e) {
      console.warn('Failed to initialize recording state', e)
    }
    // Load user's countdown setting from storage
    try {
      const stored = await new Promise<any>((res) =>
        chrome.storage.local.get(['settings'], (r) => res(r))
      )
      const v = stored?.settings?.countdownSeconds
      if (typeof v === 'number' && v >= 1 && v <= 5) {
        countdownSeconds = v
      }
    } catch {}
  })

  // Listen for recording status updates
  onMount(() => {
    const handler = (msg: any) => {
      try {
        if (msg?.type === 'STREAM_META') {
          const meta = msg?.meta
          if (meta && typeof meta.paused === 'boolean') {
            const nextPaused = !!meta.paused
            if (nextPaused) {
              syncElapsedDisplay()
              isPaused = true
              setElapsedSnapshot(displayElapsedMs, { running: false })
            } else {
              isPaused = false
              setElapsedSnapshot(displayElapsedMs, { running: true })
            }
          }
          // Background signals countdown when preparing is true and countdown provides remaining seconds
          if (meta?.preparing && typeof meta.countdown === 'number') {
            startCountdown(meta.countdown)
          }
        }
        if (msg?.type === 'BADGE_TICK') {
          const badgeElapsedMs = typeof msg?.elapsedMs === 'number' || typeof msg?.elapsed === 'number'
            ? (msg?.elapsedMs ?? msg?.elapsed)
            : null
          if (badgeElapsedMs !== null) {
            isRecording = true
            setElapsedSnapshot(badgeElapsedMs, { running: !isPaused })
          }
        }
        if (msg?.type === 'STREAM_START') {
          isRecording = true
          isPaused = false
          isLoading = false
          resetCountdown()
          clearError()
          setElapsedSnapshot(0, { running: true })
        }
        if (msg?.type === 'STREAM_WARNING') {
          warningMessage = (typeof msg?.warning === 'string' && msg.warning.trim()) ? msg.warning : t('control_errorStorageLow')
        }
        if (msg?.type === 'STREAM_END' || msg?.type === 'RECORDING_COMPLETE' || msg?.type === 'OPFS_RECORDING_READY') {
          isRecording = false
          isPaused = false
          isLoading = false
          resetCountdown()
          clearWarning()
          resetElapsedDisplay()
        }
        if (msg?.type === 'STREAM_ERROR') {
          isRecording = false
          isPaused = false
          isLoading = false
          resetCountdown()
          clearWarning()
          resetElapsedDisplay()
          errorMessage = (typeof msg?.error === 'string' && msg.error.trim()) ? msg.error : t('control_errorRecordingFailed')
        }
      } catch (e) {
        // ignore handler errors
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  })

  // Handle mode selection
  function selectMode(mode: typeof selectedMode) {
    if (!isRecording) {
      selectedMode = mode
    }
  }

  // Start recording
  async function startRecording() {
    if (isLoading) return
    clearError()
    clearWarning()
    isLoading = true
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'REQUEST_START_RECORDING',
        payload: { options: { mode: selectedMode, video: true, audio: false, countdown: countdownSeconds } }
      })
      if (resp?.ok !== true) {
        errorMessage = (typeof resp?.error === 'string' && resp.error.trim()) ? resp.error : t('control_errorStartFailed')
        isLoading = false
      }
    } catch (error) {
      console.error('Failed to start recording:', error)
      errorMessage = t('control_errorStartFailed')
      isLoading = false
    }
  }

  // Pause/resume recording
  async function togglePause() {
    if (!isRecording || isLoading) return
    isLoading = true
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'REQUEST_TOGGLE_PAUSE' })
      if (resp && typeof resp.paused === 'boolean') {
        isPaused = resp.paused
      }
    } catch (e) {
      console.warn('Failed to toggle pause', e)
    } finally {
      isLoading = false
    }
  }

  // Stop recording - state reset handled by STREAM_END/STREAM_ERROR message handlers
  async function stopRecording() {
    try {
      await chrome.runtime.sendMessage({ type: 'REQUEST_STOP_RECORDING' })
    } catch (e) {
      console.warn('Failed to send stop recording message', e)
      // Only reset state on message failure since we won't receive STREAM_END
      isRecording = false
      isPaused = false
      resetElapsedDisplay()
    }
  }

  // Get button text
  function getButtonText() {
    if (countdownActive) return t('control_btnStarting', [String(countdownValue)])
    if (isLoading) return t('control_btnPreparing')
    if (isRecording) {
      return isPaused ? t('control_btnResume') : t('control_btnPause')
    }
    return t('control_btnStart')
  }

  // Get button icon
  function getButtonIcon() {
    if (isLoading) return LoaderCircle
    if (isRecording) {
      return isPaused ? Play : Pause
    }
    return Play
  }

  function getModeName(mode: typeof selectedMode) {
    const target = recordingModes.find(m => m.id === mode)
    return target ? t(target.nameKey) : ''
  }

  function startCountdown(seconds: number) {
    const safeSeconds = sanitizeCountdown(seconds)
    resetCountdown()
    countdownValue = safeSeconds
    if (countdownValue === 0) {
      notifyCountdownDone()
      return
    }
    countdownActive = true
    const endTime = Date.now() + countdownValue * 1000
    const tick = () => {
      const remainingMs = Math.max(0, endTime - Date.now())
      countdownValue = Math.ceil(remainingMs / 1000)
      if (remainingMs <= 0) {
        resetCountdown()
        notifyCountdownDone()
        return
      }
      countdownTimer = setTimeout(tick, Math.min(remainingMs, 500))
    }
    tick()
  }

  function notifyCountdownDone() {
    try {
      chrome.runtime.sendMessage({ type: 'COUNTDOWN_DONE' })
    } catch (e) {
      console.warn('Failed to send countdown completion message to background script', e)
    }
  }

  function skipCountdown() {
    resetCountdown()
    notifyCountdownDone()
  }

  function resetCountdown() {
    countdownActive = false
    countdownValue = 0
    if (countdownTimer) {
      clearTimeout(countdownTimer)
      countdownTimer = null
    }
  }

  onDestroy(() => {
    resetCountdown()
    clearElapsedTimer()
  })

</script>

<svelte:head>
  <title>{t('welcome_pageTitle')}</title>
</svelte:head>

  {#if countdownActive}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md">
      <div
        class="text-center space-y-6"
        role="status"
        aria-live="polite"
        aria-label={`Countdown timer, recording starts in ${countdownValue} seconds`}
      >
        <div class="relative">
          <div class="text-9xl font-black text-white tabular-nums drop-shadow-2xl">
            {countdownValue}
          </div>
          <div class="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full -z-10 animate-pulse"></div>
        </div>
        <p class="text-white/80 text-xl font-medium tracking-wide">{t('control_overlayRecordingStarts')}</p>
        <button
          class="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold backdrop-blur-sm transition-all duration-200 border border-white/20 hover:border-white/40 active:scale-95"
          type="button"
          onclick={skipCountdown}
        >
          {t('control_btnSkipCountdown')}
        </button>
      </div>
    </div>
  {/if}

  <div class="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
    <!-- Header -->
    <header class="bg-white/80 border-b border-slate-200/60 shadow-sm flex-shrink-0">
      <div class="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="relative">
             <div class="absolute inset-0 bg-blue-500/20 blur-lg rounded-full"></div>
             <img src="/assets/icon.svg" alt={t('appName')} class="w-7 h-7 relative z-10" />
          </div>
          <div>
            <h1 class="text-lg font-bold text-slate-900 tracking-tight leading-none flex items-center gap-2">
              {t('appName')}
              {#if extensionVersion}<span class="text-xs font-normal text-slate-400">v{extensionVersion}</span>{/if}
            </h1>
          </div>
        </div>
        <div class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60 rounded-full text-[10px] shadow-sm">
          <Sparkles class="w-3.5 h-3.5 text-amber-500" />
          <span class="bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent font-bold tracking-widest uppercase">{t('welcome_proTrialActive')}</span>
        </div>
      </div>
    </header>

    <main class="flex-1 flex flex-col justify-center max-w-6xl mx-auto px-6 py-4 w-full gap-6">
      <!-- Welcome Banner & Features Wrapper to keep them compact -->
      <div class="space-y-6">
        <!-- Welcome Banner -->
        <section class="text-center space-y-4 max-w-4xl mx-auto animate-fade-in-down pt-4">
          <div class="inline-flex items-center gap-1.5 px-4 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs font-semibold shadow-sm">
            <CircleCheck class="w-4 h-4" />
            {t('welcome_installSuccess')}
          </div>
          
          <div class="space-y-2">
            <h2 class="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
              {t('welcome_headline')}
            </h2>
            <p class="text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
              {t('welcome_subheadline')}
            </p>
          </div>
        </section>

        <!-- Core Features Highlight -->
        <section class="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-4xl mx-auto w-full animate-fade-in-up">
          <div class="flex items-center justify-center gap-2.5 bg-white p-3 rounded-2xl shadow-sm border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all cursor-default group">
            <div class="p-2 bg-blue-50 rounded-xl text-blue-600 group-hover:scale-110 group-hover:bg-blue-100 transition-all flex-shrink-0">
              <ShieldCheck class="w-5 h-5" />
            </div>
            <span class="text-xs font-bold text-slate-800 tracking-wide leading-tight">{t('welcome_feat1Title')}</span>
          </div>
          <div class="flex items-center justify-center gap-2.5 bg-white p-3 rounded-2xl shadow-sm border border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all cursor-default group">
            <div class="p-2 bg-emerald-50 rounded-xl text-emerald-600 group-hover:scale-110 group-hover:bg-emerald-100 transition-all flex-shrink-0">
              <Sparkles class="w-5 h-5" />
            </div>
            <span class="text-xs font-bold text-slate-800 tracking-wide leading-tight">{t('welcome_feat2Title')}</span>
          </div>
          <div class="flex items-center justify-center gap-2.5 bg-white p-3 rounded-2xl shadow-sm border border-slate-200 hover:border-purple-300 hover:shadow-md transition-all cursor-default group">
            <div class="p-2 bg-purple-50 rounded-xl text-purple-600 group-hover:scale-110 group-hover:bg-purple-100 transition-all flex-shrink-0">
              <Zap class="w-5 h-5" />
            </div>
            <span class="text-xs font-bold text-slate-800 tracking-wide leading-tight">{t('welcome_feat3Title')}</span>
          </div>
          <div class="flex items-center justify-center gap-2.5 bg-white p-3 rounded-2xl shadow-sm border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all cursor-default group">
            <div class="p-2 bg-amber-50 rounded-xl text-amber-600 group-hover:scale-110 group-hover:bg-amber-100 transition-all flex-shrink-0">
              <Film class="w-5 h-5" />
            </div>
            <span class="text-xs font-bold text-slate-800 tracking-wide leading-tight">{t('welcome_feat4Title')}</span>
          </div>
        </section>
      </div>

      <!-- Main Action Area (Recording Controls) -->
      <section class="bg-white rounded-3xl shadow-xl shadow-blue-900/5 border border-slate-200/60 overflow-hidden relative max-w-[40rem] mx-auto w-full">
        <div class="p-5 md:p-6">
          <div class="text-center mb-5">
            <h3 class="text-lg font-bold text-slate-900 mb-1.5">{t('welcome_tryTitle')}</h3>
            <p class="text-sm text-slate-600">
              {t('welcome_trySubtitle')}
            </p>
          </div>

          {#if warningMessage}
            <div class="mb-6 max-w-3xl mx-auto rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div class="flex items-start gap-3">
                <HardDrive class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                <p class="flex-1 text-sm text-amber-800">{warningMessage}</p>
                <button
                  class="rounded p-1 text-amber-600 transition-colors hover:bg-amber-100"
                  type="button"
                  onclick={clearWarning}
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
            </div>
          {/if}

          {#if errorMessage}
            <div class="mb-6 max-w-3xl mx-auto rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <div class="flex items-start gap-3">
                <CircleAlert class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                <p class="flex-1 text-sm text-red-700">{errorMessage}</p>
                <button
                  class="rounded p-1 text-red-500 transition-colors hover:bg-red-100"
                  type="button"
                  onclick={clearError}
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
            </div>
          {/if}
        
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {#each recordingModes as mode}
              {@const IconComponent = mode.icon}
              <button
                class="group relative flex flex-col items-center p-3 rounded-xl border-2 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] outline-none"
                class:border-blue-500={selectedMode === mode.id}
                class:bg-blue-50={selectedMode === mode.id && !isRecording}
                class:shadow-blue-100={selectedMode === mode.id}
                class:shadow-lg={selectedMode === mode.id}
                class:border-slate-100={selectedMode !== mode.id}
                class:bg-slate-50={selectedMode !== mode.id}
                class:hover:border-blue-200={selectedMode !== mode.id && !isRecording}
                class:hover:bg-white={selectedMode !== mode.id && !isRecording}
                class:hover:shadow-md={selectedMode !== mode.id && !isRecording}
                class:opacity-50={isRecording && selectedMode !== mode.id}
                class:cursor-not-allowed={isRecording && selectedMode !== mode.id}
                onclick={() => selectMode(mode.id)}
                disabled={isRecording && selectedMode !== mode.id}
              >
                <!-- Selection indicator -->
                {#if selectedMode === mode.id}
                  <div class="absolute -top-2 -right-2 bg-blue-500 text-white p-0.5 rounded-full shadow-md ring-2 ring-white">
                    <CircleCheck class="w-3.5 h-3.5" />
                  </div>
                {/if}

                <!-- Icon -->
                <div class="w-10 h-10 mb-2 rounded-xl flex items-center justify-center transition-colors duration-300"
                      class:bg-white={true}
                      class:text-blue-600={selectedMode === mode.id}
                      class:shadow-sm={selectedMode === mode.id}
                      class:text-slate-400={selectedMode !== mode.id}
                      class:group-hover:text-blue-500={selectedMode !== mode.id && !isRecording}>
                  <IconComponent class="w-5 h-5" />
                </div>

                <!-- Label -->
                <h4 class="text-sm font-bold mb-1 transition-colors duration-200"
                    class:text-blue-900={selectedMode === mode.id}
                    class:text-slate-700={selectedMode !== mode.id}
                    class:group-hover:text-blue-800={selectedMode !== mode.id && !isRecording}>
                  {t(mode.nameKey)}
                </h4>
                
                <!-- Description -->
                <p class="text-[11px] text-slate-500 mb-1.5 text-center leading-snug">{t(mode.descriptionKey)}</p>
                <div class="mt-auto pt-1.5 border-t border-slate-200/50 w-full text-center">
                    <p class="text-[9px] font-medium text-slate-400 uppercase tracking-wide">{t(mode.detailKey)}</p>
                </div>
              </button>
            {/each}
          </div>

          <!-- Recording Controls -->
          <div class="max-w-sm mx-auto space-y-3">
            <!-- Main control button -->
            <button
              class={`w-full group relative flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl font-bold text-base text-white transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-xl hover:shadow-2xl active:scale-[0.98] ${
                !isRecording
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 focus:ring-blue-500 shadow-blue-500/30'
                  : 'bg-red-500 hover:bg-red-600 focus:ring-red-500 shadow-red-500/30'
              }`}
              onclick={isRecording ? stopRecording : startRecording}
              disabled={isLoading}
            >
              <div class="relative flex items-center justify-center">
                {#if isLoading}
                  <LoaderCircle class="w-5 h-5 animate-spin" />
                {:else if isRecording}
                   <Square class="w-5 h-5 fill-current" />
                {:else}
                  {@const ButtonIcon = getButtonIcon()}
                  <ButtonIcon class="w-5 h-5 group-hover:scale-110 transition-transform" />
                {/if}
              </div>
              
              <span class="tracking-wide">
                {#if isRecording}
                    {t('control_btnStop')}
                {:else}
                    {getButtonText()}
                {/if}
              </span>
              
              <!-- Shine effect -->
              {#if !isRecording}
                <div class="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20"></div>
              {/if}
            </button>

            <!-- Secondary button (Pause/Resume) -->
            {#if isRecording}
              <button
                class="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1 shadow-sm"
                onclick={togglePause}
                disabled={isLoading}
              >
                {#if isPaused}
                    <Play class="w-4 h-4 fill-current" />
                    <span>{t('control_btnResume')}</span>
                {:else}
                    <Pause class="w-4 h-4 fill-current" />
                    <span>{t('control_btnPause')}</span>
                {/if}
              </button>
            {/if}
          </div>

          <!-- Reassurance Microcopy -->
          {#if !isRecording && !isLoading}
          <div class="mt-5 flex flex-wrap sm:flex-nowrap items-center justify-center gap-x-3 gap-y-2 text-xs font-semibold text-slate-500 bg-slate-50 py-2.5 px-3 rounded-xl border border-slate-100 max-w-lg mx-auto">
            <div class="flex items-center gap-1.5"><HardDrive class="w-4 h-4 text-emerald-500"/> {t('welcome_trustLocal')}</div>
            <div class="flex items-center gap-1.5"><ShieldCheck class="w-4 h-4 text-emerald-500"/> {t('welcome_trustNoWatermark')}</div>
            <div class="flex items-center gap-1.5"><Film class="w-4 h-4 text-emerald-500"/> {t('welcome_trustHD')}</div>
            <div class="flex items-center gap-1.5"><Zap class="w-4 h-4 text-emerald-500"/> {t('welcome_trustQuickEditing')}</div>
          </div>
          {/if}

          <!-- Recording status display -->
          {#if isRecording}
            <div class={isPaused
              ? 'mt-6 max-w-md mx-auto rounded-xl border p-4 bg-amber-50/70 border-amber-200'
              : 'mt-6 max-w-md mx-auto rounded-xl border p-4 bg-red-50/70 border-red-100'}>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span class="relative flex h-3 w-3">
                    {#if !isPaused}
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    {/if}
                    <span
                      class="relative inline-flex h-3 w-3 rounded-full"
                      class:bg-amber-500={isPaused}
                      class:bg-red-500={!isPaused}
                    ></span>
                  </span>
                  <span
                    class="text-sm font-semibold"
                    class:text-amber-900={isPaused}
                    class:text-red-800={!isPaused}
                  >
                    {isPaused ? t('control_statusPaused') : t('welcome_statusRecording')}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <div
                    class="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-xs font-semibold shadow-sm"
                    class:border-amber-200={isPaused}
                    class:text-amber-800={isPaused}
                    class:border-red-200={!isPaused}
                    class:text-red-700={!isPaused}
                  >
                    <Clock class="h-3.5 w-3.5" />
                    <span class="tabular-nums">{formatRecordingDuration(displayElapsedMs)}</span>
                  </div>
                  <div
                    class="rounded-full border bg-white px-3 py-1 text-xs font-medium shadow-sm"
                    class:border-amber-200={isPaused}
                    class:text-amber-800={isPaused}
                    class:border-red-200={!isPaused}
                    class:text-red-700={!isPaused}
                  >
                    {getModeName(selectedMode)} {t('welcome_modeLabel')}
                  </div>
                </div>
              </div>
              <div class="mt-4 pt-3 border-t text-center text-xs font-medium opacity-80" 
                   class:border-amber-200={isPaused} class:text-amber-800={isPaused} 
                   class:border-red-200={!isPaused} class:text-red-800={!isPaused}>
                💡 Tip: Click the extension icon 🧩 to stop recording from any page.
              </div>
            </div>
          {/if}
        </div>
      </section>

      <div class="flex-1"></div> <!-- Spacer to push lower content down -->

      <!-- Quick Start Guide (User Journey) -->
      <section class="max-w-5xl mx-auto w-full mt-auto pt-8">
        <div class="text-center mb-10">
          <h3 class="text-2xl font-bold text-slate-900 mb-3">{t('welcome_howTitle')}</h3>
          <p class="text-slate-500 max-w-xl mx-auto">{t('welcome_howDesc')}</p>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
          <!-- Step 1 -->
          <div class="relative group transition-transform duration-300 hover:-translate-y-1">
            <div class="absolute inset-0 bg-white rounded-2xl shadow-sm border border-slate-200 z-0"></div>
            <div class="relative p-6 text-center z-10 flex flex-col items-center">
              <div class="w-14 h-14 bg-slate-50 text-slate-600 rounded-2xl flex items-center justify-center mb-4 shadow-inner ring-1 ring-slate-200 group-hover:bg-slate-100 group-hover:text-slate-700 transition-colors">
                <Puzzle class="w-6 h-6" />
              </div>
              <h4 class="text-lg font-bold text-slate-900 mb-2">{t('journey_step1Title')}</h4>
              <p class="text-sm text-slate-500 leading-relaxed">
                {t('journey_step1Desc')}
              </p>
            </div>
            <!-- Chevron pointing right (desktop only) -->
            <div class="hidden md:flex absolute top-1/2 -right-3 translate-x-1/2 -translate-y-1/2 z-20 text-slate-200 group-hover:text-blue-300 transition-colors pointer-events-none">
              <ChevronRight class="w-6 h-6" />
            </div>
          </div>

          <!-- Step 2 -->
          <div class="relative group transition-transform duration-300 hover:-translate-y-1">
            <div class="absolute inset-0 bg-white rounded-2xl shadow-sm border border-slate-200 z-0"></div>
            <div class="relative p-6 text-center z-10 flex flex-col items-center">
              <div class="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-inner ring-1 ring-blue-200 group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                <Video class="w-6 h-6" />
              </div>
              <h4 class="text-lg font-bold text-slate-900 mb-2">{t('journey_step2Title')}</h4>
              <p class="text-sm text-slate-500 leading-relaxed">
                {t('journey_step2Desc')}
              </p>
            </div>
            <!-- Chevron pointing right (desktop only) -->
            <div class="hidden md:flex absolute top-1/2 -right-3 translate-x-1/2 -translate-y-1/2 z-20 text-slate-200 group-hover:text-purple-300 transition-colors pointer-events-none">
              <ChevronRight class="w-6 h-6" />
            </div>
          </div>

          <!-- Step 3 -->
          <div class="relative group transition-transform duration-300 hover:-translate-y-1">
            <div class="absolute inset-0 bg-white rounded-2xl shadow-sm border border-slate-200 z-0"></div>
            <div class="relative p-6 text-center z-10 flex flex-col items-center">
              <div class="w-14 h-14 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center mb-4 shadow-inner ring-1 ring-purple-200 group-hover:bg-purple-100 group-hover:text-purple-700 transition-colors">
                <Scissors class="w-6 h-6" />
              </div>
              <h4 class="text-lg font-bold text-slate-900 mb-2">{t('journey_step3Title')}</h4>
              <p class="text-sm text-slate-500 leading-relaxed">
                {t('journey_step3Desc')}
              </p>
            </div>
            <!-- Chevron pointing right (desktop only) -->
            <div class="hidden md:flex absolute top-1/2 -right-3 translate-x-1/2 -translate-y-1/2 z-20 text-slate-200 group-hover:text-emerald-300 transition-colors pointer-events-none">
              <ChevronRight class="w-6 h-6" />
            </div>
          </div>

          <!-- Step 4 -->
          <div class="relative group transition-transform duration-300 hover:-translate-y-1">
            <div class="absolute inset-0 bg-white rounded-2xl shadow-sm border border-slate-200 z-0"></div>
            <div class="relative p-6 text-center z-10 flex flex-col items-center">
              <div class="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 shadow-inner ring-1 ring-emerald-200 group-hover:bg-emerald-100 group-hover:text-emerald-700 transition-colors">
                <Download class="w-6 h-6" />
              </div>
              <h4 class="text-lg font-bold text-slate-900 mb-2">{t('journey_step4Title')}</h4>
              <p class="text-sm text-slate-500 leading-relaxed">
                {t('journey_step4Desc')}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-200 bg-white/50 backdrop-blur-sm mt-12">
      <div class="max-w-6xl mx-auto px-6 py-8">
        <div class="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <p>{t('welcome_footerHelp')}</p>
          <div class="flex items-center gap-6">
            <span class="font-medium text-slate-400">{t('welcome_footerMeta')}</span>
          </div>
        </div>
      </div>
    </footer>
  </div>
