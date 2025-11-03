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

  // Recording state management
  let isRecording = $state(false)
  let isPaused = $state(false)
  let selectedMode = $state<'tab' | 'window' | 'screen'>('tab')
  let isLoading = $state(false)
  const COUNTDOWN_SECONDS = 3

  // Recording mode configuration
  const recordingModes = [
    {
      id: 'tab' as const,
      name: 'Tab',
      icon: Monitor,
      description: 'Record the current browser tab',
      detail: 'Perfect for web demos and tutorials'
    },
    {
      id: 'window' as const,
      name: 'Window',
      icon: AppWindow,
      description: 'Record the entire browser window',
      detail: 'Includes address bar and toolbar'
    },
    {
      id: 'screen' as const,
      name: 'Screen',
      icon: ScreenShare,
      description: 'Record your entire screen',
      detail: 'Best for cross-application workflows'
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
    if (isLoading) return 'Preparing...'
    if (isRecording) {
      return isPaused ? 'Resume Recording' : 'Pause Recording'
    }
    return 'Start Recording'
  }

  // Get button icon
  function getButtonIcon() {
    if (isLoading) return Loader2
    if (isRecording) {
      return isPaused ? Play : Pause
    }
    return Play
  }
</script>

<svelte:head>
  <title>Welcome to Screen Recorder Studio</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
  <!-- Header -->
  <div class="bg-white border-b border-gray-200 shadow-sm">
    <div class="max-w-6xl mx-auto px-6 py-4">
      <div class="flex items-center gap-3">
        <img src="/assets/icon.svg" alt="Screen Recorder Studio" class="w-10 h-10" />
        <div>
          <h1 class="text-xl font-bold text-gray-900">Screen Recorder Studio</h1>
          <p class="text-sm text-gray-600">Professional Browser Recording Tool</p>
        </div>
      </div>
    </div>
  </div>

  <div class="max-w-6xl mx-auto px-6 py-12">
    <!-- Welcome Banner -->
    <div class="text-center mb-12">
      <div class="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-full text-sm font-medium mb-6">
        <CheckCircle2 class="w-4 h-4" />
        Installation Successful
      </div>
      <h2 class="text-4xl font-bold text-gray-900 mb-4">
        Welcome to Screen Recorder Studio! 🎉
      </h2>
      <p class="text-xl text-gray-600 max-w-2xl mx-auto">
        Ready to create your first recording? It only takes seconds to get started!
      </p>
    </div>

    <!-- Recording Mode Selection (Moved up) -->
    <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-xl p-8 mb-12 border-2 border-blue-200">
      <div class="text-center mb-6">
        <h3 class="text-3xl font-bold text-gray-900 mb-3">Try It Now! 🚀</h3>
        <p class="text-lg text-gray-700 mb-2">
          Select your recording mode and hit the button below
        </p>
        <p class="text-sm text-gray-600">
          No setup required • 3-second countdown • Professional quality
        </p>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {#each recordingModes as mode}
          {@const IconComponent = mode.icon}
          <button
            class="group relative flex flex-col items-center p-6 rounded-xl border-2 transition-all duration-200 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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
              <div class="absolute -top-2 -right-2 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center border-4 border-white">
                <CheckCircle2 class="w-5 h-5 text-white" />
              </div>
            {/if}

            <!-- Icon -->
            <div class="w-16 h-16 mb-4 rounded-full flex items-center justify-center"
                 class:bg-blue-100={selectedMode === mode.id}
                 class:bg-gray-100={selectedMode !== mode.id}
                 class:group-hover:bg-blue-50={selectedMode !== mode.id && !isRecording}>
              <IconComponent
                class={`w-8 h-8 transition-colors duration-200 ${
                  selectedMode === mode.id ? 'text-blue-600' : 'text-gray-600'
                }`}
              />
            </div>

            <!-- Label -->
            <h4 class="text-lg font-semibold mb-2 transition-colors duration-200"
                class:text-blue-700={selectedMode === mode.id}
                class:text-gray-900={selectedMode !== mode.id}>
              {mode.name}
            </h4>
            
            <!-- Description -->
            <p class="text-sm text-gray-600 mb-1 text-center">{mode.description}</p>
            <p class="text-xs text-gray-500 text-center">{mode.detail}</p>
          </button>
        {/each}
      </div>

      <!-- Recording Controls -->
      <div class="space-y-3">
        <!-- Main control button -->
        <button
          class="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-semibold text-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
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
          <div class="flex items-center justify-center w-6 h-6">
            {#if isLoading}
              <Loader2 class="w-6 h-6 animate-spin" />
            {:else}
              {@const ButtonIcon = getButtonIcon()}
              <ButtonIcon class="w-6 h-6" />
            {/if}
          </div>
          <span>{getButtonText()}</span>
        </button>

        <!-- Stop recording button -->
        {#if isRecording}
          <button
            class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-md hover:shadow-lg"
            onclick={stopRecording}
          >
            <Square class="w-5 h-5" />
            <span>Stop Recording</span>
          </button>
        {/if}
      </div>

      <!-- Recording status display -->
      {#if isRecording}
        <div class="mt-6 p-4 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-xl">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>
              <span class="text-lg font-semibold text-red-700">
                {isPaused ? 'Recording Paused' : 'Recording in Progress'}
              </span>
            </div>
            <div class="px-3 py-1 bg-white rounded-full text-sm font-medium text-gray-700">
              {recordingModes.find(m => m.id === selectedMode)?.name} Mode
            </div>
          </div>
        </div>
      {:else}
        <div class="mt-6 p-5 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0">
              <div class="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                <Play class="w-5 h-5 text-white" />
              </div>
            </div>
            <div class="flex-1">
              <p class="font-bold text-gray-900 mb-2 text-lg">🎬 Everything is Ready!</p>
              <p class="text-sm text-gray-700 mb-3">
                You've selected <strong class="text-green-700">{recordingModes.find(m => m.id === selectedMode)?.name}</strong> mode. 
                Click the big blue button above to start your first recording!
              </p>
              <div class="flex items-center gap-2 text-xs text-gray-600">
                <CheckCircle2 class="w-4 h-4 text-green-600" />
                <span>3-second countdown before recording starts</span>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Quick Start Guide (Moved down) -->
    <div class="bg-white rounded-2xl shadow-lg p-8 mb-12">
      <div class="text-center mb-6">
        <h3 class="text-2xl font-bold text-gray-900 mb-2">How It Works</h3>
        <p class="text-gray-600">Three simple steps to get the most out of your extension</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Step 1 -->
        <div class="flex flex-col items-center text-center">
          <div class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <span class="text-2xl font-bold text-blue-600">1</span>
          </div>
          <h4 class="text-lg font-semibold text-gray-900 mb-2">Pin Extension</h4>
          <p class="text-sm text-gray-600">
            Click the puzzle icon 🧩 in your browser toolbar and pin this extension for quick access anytime
          </p>
        </div>

        <!-- Step 2 -->
        <div class="flex flex-col items-center text-center">
          <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <span class="text-2xl font-bold text-green-600">2</span>
          </div>
          <h4 class="text-lg font-semibold text-gray-900 mb-2">Choose Your Target</h4>
          <p class="text-sm text-gray-600">
            Select what to record: current tab, entire window, or full screen - whatever fits your needs
          </p>
        </div>

        <!-- Step 3 -->
        <div class="flex flex-col items-center text-center">
          <div class="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4">
            <span class="text-2xl font-bold text-purple-600">3</span>
          </div>
          <h4 class="text-lg font-semibold text-gray-900 mb-2">Hit Record</h4>
          <p class="text-sm text-gray-600">
            Click "Start Recording" and get ready - a 3-second countdown gives you time to prepare!
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
          <h3 class="text-2xl font-bold mb-2">Need More Control?</h3>
          <p class="text-blue-100">
            Click the extension icon in your browser toolbar to access the full control panel
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="bg-white/10 backdrop-blur-sm rounded-xl p-4">
          <div class="flex items-center gap-2 mb-2">
            <Mouse class="w-5 h-5" />
            <h4 class="font-semibold">Element Recording</h4>
          </div>
          <p class="text-sm text-blue-100">
            Select specific page elements to record with precision
          </p>
        </div>

        <div class="bg-white/10 backdrop-blur-sm rounded-xl p-4">
          <div class="flex items-center gap-2 mb-2">
            <Monitor class="w-5 h-5" />
            <h4 class="font-semibold">Area Selection</h4>
          </div>
          <p class="text-sm text-blue-100">
            Draw custom recording areas on any webpage
          </p>
        </div>
      </div>

      <button
        class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-white text-blue-600 hover:bg-blue-50 rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
        onclick={openControlPanel}
      >
        <span>Open Full Control Panel</span>
        <ArrowRight class="w-5 h-5" />
      </button>
    </div>
  </div>

  <!-- Footer -->
  <div class="border-t border-gray-200 bg-white mt-12">
    <div class="max-w-6xl mx-auto px-6 py-6">
      <div class="text-center text-sm text-gray-600">
        <p>Need help? Click the extension icon for the control panel with advanced features.</p>
        <p class="mt-1 text-gray-500">Screen Recorder Studio v0.6.0 • Made for professionals</p>
      </div>
    </div>
  </div>
</div>
