<script lang="ts">
  import {
    Monitor,
    AppWindow,
    ScreenShare,
    Play,
    Pause,
    Square,
    Loader2,
    Zap,
    ArrowRight,
    CheckCircle2
  } from '@lucide/svelte'
  import { onDestroy, onMount } from 'svelte'
  import { _t } from '$lib/utils/i18n'

  // Recording state management
  let isRecording = $state(false)
  let isPaused = $state(false)
  let selectedMode = $state<'tab' | 'window' | 'screen'>('tab')
  let isLoading = $state(false)
  let countdownActive = $state(false)
  let countdownValue = $state(0)
  let countdownTimer: ReturnType<typeof setTimeout> | null = null
  const COUNTDOWN_SECONDS = 3
  const MAX_COUNTDOWN_SECONDS = 10

  function sanitizeCountdown(seconds: number) {
    return Number.isFinite(seconds) ? Math.max(0, Math.min(MAX_COUNTDOWN_SECONDS, seconds)) : COUNTDOWN_SECONDS
  }

  const FALLBACK_MESSAGES: Record<string, string> = {
    appName: 'Screen Recorder Studio',
    welcome_pageTitle: 'Welcome to Screen Recorder Studio',
    welcome_headerSubtitle: 'Professional Browser Recording Tool',
    welcome_installSuccess: 'Installation Successful',
    welcome_headline: 'Welcome to Screen Recorder Studio! 🎉',
    welcome_subheadline: 'Ready to create your first recording? It only takes seconds to get started!',
    welcome_tryTitle: 'Try It Now! 🚀',
    welcome_trySubtitle: 'Select your recording mode and hit the button below',
    welcome_tryFeatures: 'No setup required • $SECONDS$-second countdown • Professional quality',
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
    welcome_readyTitle: '🎬 Everything is Ready!',
    welcome_readyDesc: "You've selected $MODE$ mode. Click the big blue button above to start your first recording!",
    welcome_readyTip: '$SECONDS$-second countdown before recording starts',
    welcome_howTitle: 'How It Works',
    welcome_howDesc: 'Three simple steps to get the most out of your extension',
    welcome_step1Title: 'Pin Extension',
    welcome_step1Desc: 'Click the puzzle icon 🧩 in your browser toolbar and pin this extension for quick access anytime',
    welcome_step2Title: 'Choose Your Target',
    welcome_step2Desc: 'Select what to record: current tab, entire window, or full screen - whatever fits your needs',
    welcome_step3Title: 'Hit Record',
    welcome_step3Desc: 'Click "$BTN$" and get ready - a $SECONDS$-second countdown gives you time to prepare!',
    welcome_advancedTitle: 'Need More Control?',
    welcome_advancedDesc: 'Click the extension icon in your browser toolbar to access the full control panel',
    welcome_openControl: 'Open Full Control Panel',
    control_btnStarting: 'Starting in $1...',
    control_overlayRecordingStarts: 'Recording will begin after the countdown',
    control_btnSkipCountdown: 'Skip countdown',
    welcome_footerHelp: 'Need help? Click the extension icon for the control panel with advanced features.',
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

  // Initialize: sync background state
  onMount(async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'REQUEST_RECORDING_STATE' })
      isRecording = !!resp?.state?.isRecording
      isPaused = !!resp?.state?.isPaused
    } catch (e) {
      console.warn('Failed to initialize recording state', e)
    }
  })

  // Listen for recording status updates
  onMount(() => {
    const handler = (msg: any) => {
      try {
        if (msg?.type === 'STREAM_META') {
          const meta = msg?.meta
          if (meta && typeof meta.paused === 'boolean') {
            isPaused = !!meta.paused
          }
          // Background signals countdown when preparing is true and countdown provides remaining seconds
          if (meta?.preparing && typeof meta.countdown === 'number') {
            startCountdown(meta.countdown)
          }
        }
        if (msg?.type === 'STREAM_START') {
          isRecording = true
          isPaused = false
          isLoading = false
          resetCountdown()
        }
        if (msg?.type === 'STREAM_END' || msg?.type === 'STREAM_ERROR' || msg?.type === 'RECORDING_COMPLETE' || msg?.type === 'OPFS_RECORDING_READY') {
          isRecording = false
          isPaused = false
          isLoading = false
          resetCountdown()
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
    isLoading = true
    try {
      await chrome.runtime.sendMessage({
        type: 'REQUEST_START_RECORDING',
        payload: { options: { mode: selectedMode, video: true, audio: false, countdown: COUNTDOWN_SECONDS } }
      })
    } catch (error) {
      console.error('Failed to start recording:', error)
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

  // Stop recording
  async function stopRecording() {
    try {
      await chrome.runtime.sendMessage({ type: 'REQUEST_STOP_RECORDING' })
    } catch (e) {
      console.warn('Failed to send stop recording message', e)
    }
    isRecording = false
    isPaused = false
  }

  // Open control panel (popup)
  function openControlPanel() {
    // Open popup in new window for better visibility
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 380,
      height: 600
    })
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
    if (isLoading) return Loader2
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

  <div class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
    <!-- Header -->
    <header class="bg-white/80 backdrop-blur-md sticky top-0 z-30 border-b border-slate-200/60 shadow-sm">
      <div class="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="relative">
             <div class="absolute inset-0 bg-blue-500/20 blur-lg rounded-full"></div>
             <img src="/assets/icon.svg" alt={t('appName')} class="w-8 h-8 relative z-10" />
          </div>
          <div>
            <h1 class="text-lg font-bold text-slate-900 tracking-tight leading-none">{t('appName')}</h1>
            <p class="text-xs text-slate-500 font-medium tracking-wide">{t('welcome_headerSubtitle')}</p>
          </div>
        </div>
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-6 py-12 space-y-16">
      <!-- Welcome Banner -->
      <section class="text-center space-y-6 max-w-3xl mx-auto">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs font-semibold shadow-sm animate-fade-in-down">
          <CheckCircle2 class="w-3.5 h-3.5" />
          {t('welcome_installSuccess')}
        </div>
        
        <div class="space-y-4">
          <h2 class="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
            {t('welcome_headline')}
          </h2>
          <p class="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            {t('welcome_subheadline')}
          </p>
        </div>
      </section>

      <!-- Main Action Area -->
      <section class="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden ring-1 ring-slate-900/5">
        <div class="p-6 md:p-8">
          <div class="text-center mb-6">
            <h3 class="text-2xl font-bold text-slate-900 mb-2">{t('welcome_tryTitle')}</h3>
            <p class="text-slate-600 mb-2">
              {t('welcome_trySubtitle')}
            </p>
            <p class="text-xs font-medium text-slate-400 uppercase tracking-wider">
              {t('welcome_tryFeatures', String(COUNTDOWN_SECONDS))}
            </p>
          </div>
        
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {#each recordingModes as mode}
              {@const IconComponent = mode.icon}
              <button
                class="group relative flex flex-col items-center p-4 rounded-2xl border-2 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] outline-none"
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
                  <div class="absolute -top-3 -right-3 bg-blue-500 text-white p-1 rounded-full shadow-md ring-4 ring-white">
                    <CheckCircle2 class="w-4 h-4" />
                  </div>
                {/if}

                <!-- Icon -->
                <div class="w-12 h-12 mb-3 rounded-2xl flex items-center justify-center transition-colors duration-300"
                      class:bg-white={true}
                      class:text-blue-600={selectedMode === mode.id}
                      class:shadow-sm={selectedMode === mode.id}
                      class:text-slate-400={selectedMode !== mode.id}
                      class:group-hover:text-blue-500={selectedMode !== mode.id && !isRecording}>
                  <IconComponent class="w-6 h-6" />
                </div>

                <!-- Label -->
                <h4 class="text-base font-bold mb-1 transition-colors duration-200"
                    class:text-blue-900={selectedMode === mode.id}
                    class:text-slate-700={selectedMode !== mode.id}
                    class:group-hover:text-blue-800={selectedMode !== mode.id && !isRecording}>
                  {t(mode.nameKey)}
                </h4>
                
                <!-- Description -->
                <p class="text-sm text-slate-500 mb-2 text-center leading-snug">{t(mode.descriptionKey)}</p>
                <div class="mt-auto pt-2 border-t border-slate-200/50 w-full text-center">
                    <p class="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{t(mode.detailKey)}</p>
                </div>
              </button>
            {/each}
          </div>

          <!-- Recording Controls -->
          <div class="max-w-md mx-auto space-y-4">
            <!-- Main control button -->
            <button
              class={`w-full group relative flex items-center justify-center gap-3 px-8 py-3 rounded-2xl font-bold text-lg text-white transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-xl hover:shadow-2xl active:scale-[0.98] ${
                !isRecording
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 focus:ring-blue-500 shadow-blue-500/30'
                  : 'bg-red-500 hover:bg-red-600 focus:ring-red-500 shadow-red-500/30'
              }`}
              onclick={isRecording ? stopRecording : startRecording}
              disabled={isLoading}
            >
              <div class="relative flex items-center justify-center">
                {#if isLoading}
                  <Loader2 class="w-6 h-6 animate-spin" />
                {:else if isRecording}
                   <Square class="w-6 h-6 fill-current" />
                {:else}
                  {@const ButtonIcon = getButtonIcon()}
                  <ButtonIcon class="w-6 h-6 group-hover:scale-110 transition-transform" />
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
                <div class="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20"></div>
              {/if}
            </button>

            <!-- Secondary button (Pause/Resume) -->
            {#if isRecording}
              <button
                class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1 shadow-sm"
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

          <!-- Recording status display -->
          {#if isRecording}
            <div class="mt-6 p-4 bg-orange-50/50 border border-orange-100 rounded-xl max-w-md mx-auto">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <span class="relative flex h-3 w-3">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                  <span class="text-sm font-semibold text-orange-900">
                    {isPaused ? t('control_statusPaused') : t('welcome_statusRecording')}
                  </span>
                </div>
                <div class="px-3 py-1 bg-white border border-orange-200/60 rounded-full text-xs font-medium text-orange-800 shadow-sm">
                  {getModeName(selectedMode)} {t('welcome_modeLabel')}
                </div>
              </div>
            </div>
          {:else}
            <div class="mt-6 p-4 bg-slate-50 border border-slate-100 rounded-xl max-w-md mx-auto">
              <div class="flex items-start gap-4">
                <div class="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Play class="w-5 h-5 ml-0.5" />
                </div>
                <div class="flex-1">
                  <p class="font-bold text-slate-900 mb-1 text-sm">{t('welcome_readyTitle')}</p>
                  <p class="text-xs text-slate-500 mb-2 leading-relaxed">
                    {t('welcome_readyDesc', getModeName(selectedMode))}
                  </p>
                  <div class="flex items-center gap-2 text-xs text-blue-600 font-medium">
                    <CheckCircle2 class="w-3.5 h-3.5" />
                    <span>{t('welcome_readyTip', String(COUNTDOWN_SECONDS))}</span>
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </section>

      <!-- Quick Start Guide -->
      <section>
        <div class="text-center mb-10">
          <h3 class="text-2xl font-bold text-slate-900 mb-3">{t('welcome_howTitle')}</h3>
          <p class="text-slate-500 max-w-xl mx-auto">{t('welcome_howDesc')}</p>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <!-- Step 1 -->
          <div class="relative group">
            <div class="absolute inset-0 bg-white rounded-2xl shadow-sm border border-slate-200 transform transition-transform group-hover:-translate-y-1"></div>
            <div class="relative p-6 text-center">
              <div class="w-14 h-14 bg-slate-100 text-slate-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl font-bold shadow-inner">1</div>
              <h4 class="text-lg font-bold text-slate-900 mb-2">{t('welcome_step1Title')}</h4>
              <p class="text-sm text-slate-500 leading-relaxed">
                {t('welcome_step1Desc')}
              </p>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="relative group">
            <div class="absolute inset-0 bg-white rounded-2xl shadow-sm border border-slate-200 transform transition-transform group-hover:-translate-y-1"></div>
            <div class="relative p-6 text-center">
              <div class="w-14 h-14 bg-slate-100 text-slate-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl font-bold shadow-inner">2</div>
              <h4 class="text-lg font-bold text-slate-900 mb-2">{t('welcome_step2Title')}</h4>
              <p class="text-sm text-slate-500 leading-relaxed">
                {t('welcome_step2Desc')}
              </p>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="relative group">
            <div class="absolute inset-0 bg-white rounded-2xl shadow-sm border border-slate-200 transform transition-transform group-hover:-translate-y-1"></div>
            <div class="relative p-6 text-center">
              <div class="w-14 h-14 bg-slate-100 text-slate-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl font-bold shadow-inner">3</div>
              <h4 class="text-lg font-bold text-slate-900 mb-2">{t('welcome_step3Title')}</h4>
              <p class="text-sm text-slate-500 leading-relaxed">
                {t('welcome_step3Desc', [t('control_btnStart'), String(COUNTDOWN_SECONDS)])}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Advanced Features Guide -->
      <section class="relative overflow-hidden rounded-3xl bg-slate-900 shadow-2xl">
        <!-- Decorative background elements -->
        <div class="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl"></div>
        <div class="absolute bottom-0 left-0 -mb-10 -ml-10 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl"></div>
        
        <div class="relative p-8 md:p-10 flex flex-col md:flex-row items-center gap-8 md:gap-12">
           <div class="flex-shrink-0 w-20 h-20 bg-white/10 rounded-3xl flex items-center justify-center backdrop-blur-sm border border-white/10 shadow-inner">
             <Zap class="w-10 h-10 text-yellow-400" />
           </div>
           
           <div class="flex-1 text-center md:text-left">
             <h3 class="text-2xl md:text-3xl font-bold text-white mb-3 tracking-tight">{t('welcome_advancedTitle')}</h3>
             <p class="text-slate-300 text-lg leading-relaxed">
               {t('welcome_advancedDesc')}
             </p>
           </div>
           
           <div class="flex-shrink-0 w-full md:w-auto">
             <button
               class="w-full md:w-auto flex items-center justify-center gap-2 px-8 py-4 bg-white text-slate-900 hover:bg-blue-50 rounded-xl font-bold transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 group"
               onclick={openControlPanel}
             >
               <span>{t('welcome_openControl')}</span>
               <ArrowRight class="w-5 h-5 group-hover:translate-x-1 transition-transform" />
             </button>
           </div>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-200 bg-white/50 backdrop-blur-sm mt-12">
      <div class="max-w-5xl mx-auto px-6 py-8">
        <div class="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <p>{t('welcome_footerHelp')}</p>
          <div class="flex items-center gap-6">
            <span class="font-medium text-slate-400">{t('welcome_footerMeta')}</span>
          </div>
        </div>
      </div>
    </footer>
  </div>