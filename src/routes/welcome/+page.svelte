<script lang="ts">
  import {
    Monitor,
    AppWindow,
    ScreenShare,
    Play,
    Pause,
    Square,
    Loader2,
    AlertCircle,
    Zap,
    Sparkles,
    ArrowRight,
    CheckCircle2,
    Mouse
  } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { _t } from '$lib/utils/i18n'

  // Recording state management
  let isRecording = $state(false)
  let isPaused = $state(false)
  let selectedMode = $state<'tab' | 'window' | 'screen'>('tab')
  let isLoading = $state(false)
  const COUNTDOWN_SECONDS = 3

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
    welcome_featureElementTitle: 'Element Recording',
    welcome_featureElementDesc: 'Select specific page elements to record with precision',
    welcome_featureAreaTitle: 'Area Selection',
    welcome_featureAreaDesc: 'Draw custom recording areas on any webpage',
    welcome_openControl: 'Open Full Control Panel',
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
        if (msg?.type === 'STREAM_META' && msg?.meta && typeof msg.meta.paused === 'boolean') {
          isPaused = !!msg.meta.paused
        }
        if (msg?.type === 'STREAM_START') {
          isRecording = true
          isPaused = false
          isLoading = false
        }
        if (msg?.type === 'STREAM_END' || msg?.type === 'STREAM_ERROR' || msg?.type === 'RECORDING_COMPLETE' || msg?.type === 'OPFS_RECORDING_READY') {
          isRecording = false
          isPaused = false
          isLoading = false
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

</script>

<svelte:head>
  <title>{t('welcome_pageTitle')}</title>
</svelte:head>

  <div class="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
    <!-- Header -->
    <div class="bg-white border-b border-gray-200 shadow-sm">
      <div class="max-w-6xl mx-auto px-6 py-4">
        <div class="flex items-center gap-3">
          <img src="/assets/icon.svg" alt={t('appName')} class="w-10 h-10" />
          <div>
            <h1 class="text-xl font-bold text-gray-900">{t('appName')}</h1>
            <p class="text-sm text-gray-600">{t('welcome_headerSubtitle')}</p>
          </div>
        </div>
      </div>
    </div>

  <div class="max-w-6xl mx-auto px-6 py-8">
    <!-- Welcome Banner -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-full text-sm font-medium mb-4">
        <CheckCircle2 class="w-4 h-4" />
        {t('welcome_installSuccess')}
      </div>
      <h2 class="text-3xl font-bold text-gray-900 mb-3">
        {t('welcome_headline')}
      </h2>
      <p class="text-lg text-gray-600 max-w-2xl mx-auto">
        {t('welcome_subheadline')}
      </p>
    </div>

    <!-- Recording Mode Selection (Moved up) -->
    <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-xl p-6 mb-8 border-2 border-blue-200">
      <div class="text-center mb-4">
        <h3 class="text-2xl font-bold text-gray-900 mb-2">{t('welcome_tryTitle')}</h3>
        <p class="text-base text-gray-700 mb-1">
          {t('welcome_trySubtitle')}
        </p>
        <p class="text-xs text-gray-500">
          {t('welcome_tryFeatures', String(COUNTDOWN_SECONDS))}
        </p>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {#each recordingModes as mode}
          {@const IconComponent = mode.icon}
          <button
            class="group relative flex flex-col items-center p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            class:border-blue-500={selectedMode === mode.id}
            class:bg-blue-50={selectedMode === mode.id}
            class:border-gray-200={selectedMode !== mode.id}
            class:bg-white={selectedMode !== mode.id}
            class:hover:border-blue-300={selectedMode !== mode.id && !isRecording}
            class:opacity-50={isRecording && selectedMode !== mode.id}
            class:cursor-not-allowed={isRecording && selectedMode !== mode.id}
            onclick={() => selectMode(mode.id)}
            disabled={isRecording && selectedMode !== mode.id}
          >
            <!-- Selection indicator -->
            {#if selectedMode === mode.id}
              <div class="absolute -top-2 -right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center border-2 border-white">
                <CheckCircle2 class="w-4 h-4 text-white" />
              </div>
            {/if}

            <!-- Icon -->
             <div class="w-12 h-12 mb-3 rounded-full flex items-center justify-center"
                  class:bg-blue-100={selectedMode === mode.id}
                  class:bg-gray-100={selectedMode !== mode.id}
                  class:group-hover:bg-blue-50={selectedMode !== mode.id && !isRecording}>
               <IconComponent
                 class={`w-6 h-6 transition-colors duration-200 ${
                  selectedMode === mode.id ? 'text-blue-600' : 'text-gray-600'
                }`}
              />
            </div>

            <!-- Label -->
            <h4 class="text-base font-semibold mb-1 transition-colors duration-200"
                class:text-blue-700={selectedMode === mode.id}
                class:text-gray-900={selectedMode !== mode.id}>
              {t(mode.nameKey)}
            </h4>
            
            <!-- Description -->
            <p class="text-xs text-gray-600 mb-1 text-center">{t(mode.descriptionKey)}</p>
            <p class="text-[10px] text-gray-500 text-center">{t(mode.detailKey)}</p>
          </button>
        {/each}
      </div>

      <!-- Recording Controls -->
      <div class="space-y-3">
        <!-- Main control button -->
        <button
          class="w-full flex items-center justify-center gap-3 px-6 py-3 rounded-xl font-semibold text-base transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
          class:bg-gradient-to-r={!isRecording}
          class:from-blue-500={!isRecording}
          class:to-blue-600={!isRecording}
          class:text-white={!isRecording}
          class:hover:from-blue-600={!isRecording && !isLoading}
          class:hover:to-blue-700={!isRecording && !isLoading}
          class:focus:ring-blue-500={!isRecording}
          class:bg-orange-500={isRecording && !isPaused}
          class:hover:bg-orange-600={isRecording && !isPaused && !isLoading}
          class:focus:ring-orange-500={isRecording && !isPaused}
          class:bg-green-500={isRecording && isPaused}
          class:hover:bg-green-600={isRecording && isPaused && !isLoading}
          class:focus:ring-green-500={isRecording && isPaused}
          onclick={isRecording ? togglePause : startRecording}
          disabled={isLoading}
        >
          <div class="flex items-center justify-center w-5 h-5">
            {#if isLoading}
              <Loader2 class="w-5 h-5 animate-spin" />
            {:else}
              {@const ButtonIcon = getButtonIcon()}
              <ButtonIcon class="w-5 h-5" />
            {/if}
          </div>
          <span>{getButtonText()}</span>
        </button>

        <!-- Stop recording button -->
        {#if isRecording}
          <button
            class="w-full flex items-center justify-center gap-2 px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-md hover:shadow-lg"
            onclick={stopRecording}
          >
            <Square class="w-4 h-4" />
            <span>{t('control_btnStop')}</span>
          </button>
        {/if}
      </div>

      <!-- Recording status display -->
      {#if isRecording}
        <div class="mt-4 p-4 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-xl">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
              <span class="text-base font-semibold text-red-700">
                {isPaused ? t('control_statusPaused') : t('welcome_statusRecording')}
              </span>
            </div>
            <div class="px-3 py-1 bg-white rounded-full text-xs font-medium text-gray-700">
              {getModeName(selectedMode)} {t('welcome_modeLabel')}
            </div>
          </div>
        </div>
      {:else}
        <div class="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0">
              <div class="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                <Play class="w-4 h-4 text-white" />
              </div>
            </div>
            <div class="flex-1">
              <p class="font-bold text-gray-900 mb-1 text-base">{t('welcome_readyTitle')}</p>
              <p class="text-xs text-gray-700 mb-2">
                {t('welcome_readyDesc', getModeName(selectedMode))}
              </p>
              <div class="flex items-center gap-2 text-xs text-gray-600">
                <CheckCircle2 class="w-3 h-3 text-green-600" />
                <span>{t('welcome_readyTip', String(COUNTDOWN_SECONDS))}</span>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Quick Start Guide (Moved down) -->
    <div class="bg-white rounded-2xl shadow-lg p-6 mb-8">
      <div class="text-center mb-6">
        <h3 class="text-2xl font-bold text-gray-900 mb-2">{t('welcome_howTitle')}</h3>
        <p class="text-gray-600">{t('welcome_howDesc')}</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Step 1 -->
        <div class="flex flex-col items-center text-center">
          <div class="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3">
            <span class="text-xl font-bold text-blue-600">1</span>
          </div>
          <h4 class="text-base font-semibold text-gray-900 mb-1">{t('welcome_step1Title')}</h4>
          <p class="text-xs text-gray-600">
            {t('welcome_step1Desc')}
          </p>
        </div>

        <!-- Step 2 -->
        <div class="flex flex-col items-center text-center">
          <div class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-3">
            <span class="text-xl font-bold text-green-600">2</span>
          </div>
          <h4 class="text-base font-semibold text-gray-900 mb-1">{t('welcome_step2Title')}</h4>
          <p class="text-xs text-gray-600">
            {t('welcome_step2Desc')}
          </p>
        </div>

        <!-- Step 3 -->
        <div class="flex flex-col items-center text-center">
          <div class="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-3">
            <span class="text-xl font-bold text-purple-600">3</span>
          </div>
          <h4 class="text-base font-semibold text-gray-900 mb-1">{t('welcome_step3Title')}</h4>
          <p class="text-xs text-gray-600">
            {t('welcome_step3Desc', [t('control_btnStart'), String(COUNTDOWN_SECONDS)])}
          </p>
        </div>
      </div>
    </div>

    <!-- Advanced Features Guide -->
    <div class="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl shadow-2xl p-8 text-white">
      <div class="flex items-start gap-4 mb-6">
        <div class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <Zap class="w-6 h-6" />
        </div>
        <div>
          <h3 class="text-2xl font-bold mb-2">{t('welcome_advancedTitle')}</h3>
          <p class="text-blue-100">
            {t('welcome_advancedDesc')}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="bg-white/10 backdrop-blur-sm rounded-xl p-4">
          <div class="flex items-center gap-2 mb-2">
            <Mouse class="w-5 h-5" />
            <h4 class="font-semibold">{t('welcome_featureElementTitle')}</h4>
          </div>
          <p class="text-sm text-blue-100">
            {t('welcome_featureElementDesc')}
          </p>
        </div>

        <div class="bg-white/10 backdrop-blur-sm rounded-xl p-4">
          <div class="flex items-center gap-2 mb-2">
            <Monitor class="w-5 h-5" />
            <h4 class="font-semibold">{t('welcome_featureAreaTitle')}</h4>
          </div>
          <p class="text-sm text-blue-100">
            {t('welcome_featureAreaDesc')}
          </p>
        </div>
      </div>

      <button
        class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white text-blue-600 hover:bg-blue-50 rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
        onclick={openControlPanel}
      >
        <span>{t('welcome_openControl')}</span>
        <ArrowRight class="w-5 h-5" />
      </button>
    </div>
  </div>

  <!-- Footer -->
  <div class="border-t border-gray-200 bg-white mt-12">
    <div class="max-w-6xl mx-auto px-6 py-6">
      <div class="text-center text-sm text-gray-600">
        <p>{t('welcome_footerHelp')}</p>
        <p class="mt-1 text-gray-500">{t('welcome_footerMeta')}</p>
      </div>
    </div>
  </div>
</div>
