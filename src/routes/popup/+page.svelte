<script lang="ts">
  import {
    Monitor,
    MousePointer,
    Camera,
    FileText,
    AppWindow,
    ScreenShare,
    Play,
    Pause,
    Square,
    Loader2,
    AlertCircle,
    HardDrive,
    Clock
  } from '@lucide/svelte'
  import { onMount } from 'svelte'

  // Recording state management
  let isRecording = $state(false)
  let isPaused = $state(false)
  let selectedMode = $state<'area' | 'element' | 'camera' | 'tab' | 'window' | 'screen'>('tab')
  let isLoading = $state(false)
  // Countdown seconds (1-5)
  let countdownSeconds = $state(3)

  function clampCountdown(v:number){
    if (isNaN(v)) return 3; return Math.min(5, Math.max(1, v));
  }
  async function saveCountdown(newVal:number){
    try {
      const v = clampCountdown(newVal);
      countdownSeconds = v;
      const stored = await new Promise<any>(res => chrome.storage.local.get(['settings'], r => res(r)));
      const settings = stored?.settings || {};
      settings.countdownSeconds = v;
      await new Promise(r => chrome.storage.local.set({ settings }, () => r(null)));
    } catch(e) {
      console.warn('Failed to persist countdownSeconds', e);
    }
  }

  // Capability state: whether the current page allows content script injection (affects element/area mode availability)
  let contentScriptAvailable = $state<boolean | null>(null)
  let capabilityReason = $state<string | undefined>(undefined)
  let currentTabId = $state<number | null>(null)

  function isModeDisabledLocal(modeId: typeof selectedMode) {
    const restricted = (modeId === 'element' || modeId === 'area') && contentScriptAvailable === false
    const blockedByRecording = isRecording && selectedMode !== modeId
    const comingSoon = modeId === 'camera' // Disable camera mode
    return restricted || blockedByRecording || comingSoon
  }

  // Initialize: sync background state
  onMount(async () => {
    try {
      // Load settings to restore countdownSeconds
      try {
        const stored = await new Promise<any>(res => chrome.storage.local.get(['settings'], r => res(r)));
        const v = stored?.settings?.countdownSeconds;
        if (typeof v === 'number') countdownSeconds = clampCountdown(v);
      } catch {}
      const resp = await chrome.runtime.sendMessage({ type: 'REQUEST_RECORDING_STATE' })
      isRecording = !!resp?.state?.isRecording
      isPaused = !!resp?.state?.isPaused
    } catch (e) {
      console.warn('Failed to initialize recording state', e)
    }
    // Initialize current tab capabilities
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      currentTabId = (tabs && tabs[0] && typeof tabs[0].id === 'number') ? tabs[0].id : null
      if (currentTabId != null) {
        const st = await chrome.runtime.sendMessage({ type: 'GET_STATE', tabId: currentTabId })
        const caps = st?.state?.capabilities
        if (caps) {
          contentScriptAvailable = !!caps.contentScriptAvailable
          capabilityReason = caps.reason
        }
        // Restore previously selected mode
        const uiMode = st?.state?.uiSelectedMode
        const legacyMode = st?.state?.mode
        if (uiMode === 'element' || uiMode === 'area' || uiMode === 'camera' || uiMode === 'tab' || uiMode === 'window' || uiMode === 'screen') {
          selectedMode = uiMode
        } else if (legacyMode === 'region' || legacyMode === 'element') {
          selectedMode = legacyMode === 'region' ? 'area' : 'element'
        }
        
        // Check if currently selected mode is disabled, if so switch to available tab mode
        if (isModeDisabledLocal(selectedMode)) {
          selectedMode = 'tab'
          // Sync update to background
          try { 
            await chrome.runtime.sendMessage({ type: 'SET_SELECTED_MODE', uiMode: 'tab', tabId: currentTabId }) 
          } catch {}
        }
        // If not recording globally but tab level records as recording (element/area pipeline), sync as recording
        if (!isRecording && typeof st?.state?.recording === 'boolean' && st.state.recording) {
          isRecording = true
        }
      }
    } catch (e) {
      // ignore init errors
    }
  })

  // Listen for stream status from background/offscreen to ensure sync stop when browser "Stop sharing"
  onMount(() => {
    const handler = (msg: any) => {
      try {
        if (msg?.type === 'STREAM_META' && msg?.meta && typeof msg.meta.paused === 'boolean') {
          console.log('[stop-share] popup: STREAM_META', msg.meta)
          isPaused = !!msg.meta.paused
        }
        if (msg?.type === 'STREAM_START') {
          console.log('[stop-share] popup: STREAM_START', msg)
          isRecording = true
          isPaused = false
          isLoading = false
        }
        if (msg?.type === 'STREAM_END' || msg?.type === 'STREAM_ERROR' || msg?.type === 'RECORDING_COMPLETE' || msg?.type === 'OPFS_RECORDING_READY') {
          console.log('[stop-share] popup: received', msg?.type)
          isRecording = false
          isPaused = false
          isLoading = false
        }
        if (msg?.type === 'STATE_UPDATE' && msg?.state) {
          console.log('[stop-share] popup: STATE_UPDATE', msg.state)
          if (typeof msg.state.recording === 'boolean') {
            isRecording = !!msg.state.recording
            if (!isRecording) isPaused = false
          }
          if (msg.state.capabilities) {
            contentScriptAvailable = !!msg.state.capabilities.contentScriptAvailable
            capabilityReason = msg.state.capabilities.reason
          }
          // Sync selected mode (prioritize uiSelectedMode)
          const uiMode = msg.state.uiSelectedMode
          const legacyMode = msg.state.mode
          if (uiMode === 'element' || uiMode === 'area' || uiMode === 'camera' || uiMode === 'tab' || uiMode === 'window' || uiMode === 'screen') {
            selectedMode = uiMode
          } else if (legacyMode === 'region' || legacyMode === 'element') {
            selectedMode = legacyMode === 'region' ? 'area' : 'element'
          }
        }
      } catch (e) {
        // ignore handler errors
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  })

  // Recording mode configuration
  const recordingModes = [
    {
      id: 'tab' as const,
      name: 'Tab',
      icon: FileText,
      description: 'Record current tab'
    },
    {
      id: 'window' as const,
      name: 'Window',
      icon: AppWindow,
      description: 'Record entire window'
    },
    {
      id: 'screen' as const,
      name: 'Screen',
      icon: ScreenShare,
      description: 'Record entire screen'
    },
    {
      id: 'area' as const,
      name: 'Area',
      icon: MousePointer,
      description: 'Select screen area to record'
    },
    {
      id: 'element' as const,
      name: 'Element',
      icon: Monitor,
      description: 'Select page element to record'
    },
    {
      id: 'camera' as const,
      name: 'Camera',
      icon: Camera,
      description: 'Record camera feed'
    }
  ]

  // Handle mode selection
  async function selectMode(mode: typeof selectedMode) {
    if (isModeDisabledLocal(mode)) return
    if (!isRecording) {
      const prev = selectedMode
      selectedMode = mode

      // Get current active tabId
      let tabId = currentTabId
      try {
        if (tabId == null) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
          tabId = (tabs && tabs[0] && typeof tabs[0].id === 'number') ? tabs[0].id : null
        }
      } catch {}

      // Record UI selected mode to background for restoration on next open
      try { await chrome.runtime.sendMessage({ type: 'SET_SELECTED_MODE', uiMode: selectedMode, tabId }) } catch {}

      // If switching from element/area to other types (tab/window/screen), clear page selection and exit selection state
      const isElemOrArea = (m: typeof selectedMode) => m === 'element' || m === 'area'
      if (isElemOrArea(prev) && !isElemOrArea(mode) && tabId != null) {
        try {
          await chrome.runtime.sendMessage({ type: 'CLEAR_SELECTION', tabId })
          await chrome.runtime.sendMessage({ type: 'EXIT_SELECTION', tabId })
        } catch {}
      }

      // If switching to element/area: clear old selection first (avoid cross-mode residue), then enter new mode selection
      if (isElemOrArea(mode) && tabId != null) {
        try { await chrome.runtime.sendMessage({ type: 'CLEAR_SELECTION', tabId }) } catch {}
        const mapped = mode === 'area' ? 'region' : 'element'
        await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: mapped, tabId }).catch(() => {})
        await chrome.runtime.sendMessage({ type: 'ENTER_SELECTION', tabId }).catch(() => {})
      }
    }
  }

  // Start recording
  async function startRecording() {
    if (isLoading) return
    isLoading = true
    try {
      if (selectedMode === 'element' || selectedMode === 'area') {
        // Element/area uses content script START_CAPTURE
        let tabId = currentTabId
        try {
          if (tabId == null) {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
            tabId = (tabs && tabs[0] && typeof tabs[0].id === 'number') ? tabs[0].id : null
          }
        } catch {}
        if (tabId != null) {
            await chrome.runtime.sendMessage({ type: 'START_CAPTURE', tabId, countdown: countdownSeconds })
          // Wait for STREAM_START/STATE_UPDATE confirmation before updating isRecording/isPaused
        } else {
          throw new Error('Failed to get active tab, cannot start recording')
        }
      } else {
        // Other modes use offscreen pipeline
        const mode = (['tab','window','screen'] as const).includes(selectedMode as any) ? (selectedMode as 'tab'|'window'|'screen') : 'screen'
        await chrome.runtime.sendMessage({
          type: 'REQUEST_START_RECORDING',
          payload: { options: { mode, video: true, audio: false, countdown: countdownSeconds } }
        })
        // Wait for STREAM_START/STATE_UPDATE confirmation before updating isRecording/isPaused
      }
    } catch (error) {
      console.error('Failed to start recording:', error)
    } finally {
      isLoading = false
    }
  }

  // Pause/resume recording
  async function togglePause() {
    if (!isRecording || isLoading) return
    isLoading = true
    try {
      const payload: any = { type: 'REQUEST_TOGGLE_PAUSE' }
      if (selectedMode === 'element' || selectedMode === 'area') {
        let tabId = currentTabId
        try {
          if (tabId == null) {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
            tabId = (tabs && tabs[0] && typeof tabs[0].id === 'number') ? tabs[0].id : null
          }
        } catch {}
        if (tabId != null) payload.tabId = tabId
      }
      const resp = await chrome.runtime.sendMessage(payload)
      if (resp && typeof resp.paused === 'boolean') {
        // Offscreen path returns paused, use return value directly
        isPaused = resp.paused
      }
      // Element/area path doesn't do optimistic update, wait for STREAM_META sync
    } catch (e) {
      console.warn('Failed to toggle pause', e)
    } finally {
      isLoading = false
    }
  }

  // Stop recording
  async function stopRecording() {
    try {
      if (selectedMode === 'element' || selectedMode === 'area') {
        let tabId = currentTabId
        try {
          if (tabId == null) {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
            tabId = (tabs && tabs[0] && typeof tabs[0].id === 'number') ? tabs[0].id : null
          }
        } catch {}
        if (tabId != null) {
          await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId })
        } else {
          console.warn('Failed to get active tab, cannot stop recording');
        }
      } else {
        await chrome.runtime.sendMessage({ type: 'REQUEST_STOP_RECORDING' })
      }
    } catch (e) {
      console.warn('Failed to send stop recording message', e)
    }
    isRecording = false
    isPaused = false
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
  <title>Screen Recording Extension</title>
</svelte:head>

<div class="w-[320px] bg-white font-sans">
  <!-- Header -->
  <div class="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Monitor class="w-5 h-5 text-blue-600" />
          Screen Recorder
        </h1>
        <p class="text-sm text-gray-600 mt-1">Select recording mode and start recording</p>
      </div>
      <button
        class="p-2 rounded-lg border border-gray-300 hover:border-blue-400 hover:bg-white/70 hover:shadow-sm transition-all duration-200 group"
        onclick={() => window.open('/drive.html', '_blank')}
        title="Open recording file manager"
      >
        <HardDrive class="w-5 h-5 text-gray-600 group-hover:text-blue-600 transition-colors duration-200" />
      </button>
    </div>
  </div>

  <!-- Recording mode selection -->
  <div class="p-4">
    <h2 class="text-sm font-medium text-gray-700 mb-3">Recording Mode</h2>
    <div class="grid grid-cols-3 gap-2">
      {#each recordingModes as mode}
        {@const IconComponent = mode.icon}
        <button
          class="group relative flex flex-col items-center p-3 rounded-lg border-2 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          class:border-blue-500={selectedMode === mode.id}
          class:bg-blue-50={selectedMode === mode.id}
          class:border-gray-200={selectedMode !== mode.id}
          class:bg-white={selectedMode !== mode.id}
          class:hover:border-gray-300={selectedMode !== mode.id && !isModeDisabledLocal(mode.id)}
          class:opacity-50={isModeDisabledLocal(mode.id)}
          class:cursor-not-allowed={isModeDisabledLocal(mode.id)}
          onclick={() => selectMode(mode.id)}
          disabled={isModeDisabledLocal(mode.id)}
          title={mode.id === 'camera' ? 'Coming Soon' : (mode.id==='element'||mode.id==='area') && contentScriptAvailable===false ? 'This page is restricted, cannot use this mode' : mode.description}
        >
          <!-- Selection indicator -->
          {#if selectedMode === mode.id}
            <div class="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white"></div>
          {/if}

          <!-- Coming Soon label -->
          {#if mode.id === 'camera'}
            <div class="absolute -top-1 -right-1 bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">
              Coming Soon
            </div>
          {/if}

          <!-- Icon -->
          <IconComponent
            class={`w-6 h-6 mb-2 transition-colors duration-200 ${
              selectedMode === mode.id ? 'text-blue-600' : 'text-gray-600'
            }`}
          />

          <!-- Label -->
          <span
            class="text-xs font-medium transition-colors duration-200"
            class:text-blue-700={selectedMode === mode.id}
            class:text-gray-700={selectedMode !== mode.id}
          >
            {mode.name}
          </span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Recording status display -->
  {#if isRecording}
    <div class="px-4 py-3 bg-red-50 border-t border-red-100">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
          <span class="text-sm font-medium text-red-700">
            {isPaused ? 'Recording Paused' : 'Recording'}
          </span>
        </div>
        <div class="text-xs text-red-600">
          {recordingModes.find(m => m.id === selectedMode)?.name}
        </div>
      </div>
    </div>
  {/if}

  <!-- Control buttons -->
  <div class="p-4 border-t border-gray-200 bg-gray-50">
    <div class="space-y-2">
      <!-- Main control button -->
      <button
        class="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <!-- Button icon -->
        <!-- Button icon -->
        <div class="flex items-center justify-center w-5 h-5">
          {#if isLoading}
            <Loader2 class="w-5 h-5 animate-spin" />
          {:else}
            {@const ButtonIcon = getButtonIcon()}
            <ButtonIcon class="w-5 h-5" />
          {/if}
        </div>

        <!-- Button text -->
        <span class="font-semibold">
          {getButtonText()}
        </span>
      </button>

      <!-- Stop recording button -->
      {#if isRecording}
        <button
          class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          onclick={stopRecording}
        >
          <Square class="w-4 h-4" />
          <span>Stop Recording</span>
        </button>
      {/if}
    </div>

    <!-- Tips -->
    <div class="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
      <div class="flex items-start gap-2">
        <AlertCircle class="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <div class="text-xs text-blue-700">
          {#if !isRecording}
            <p class="font-medium mb-1">Recording Tips:</p>
            <p>Selected <strong>{recordingModes.find(m => m.id === selectedMode)?.name}</strong> mode, click Start Recording to begin.</p>
          {:else if isPaused}
            <p class="font-medium">Recording is paused, click Resume Recording to continue.</p>
          {:else}
            <p class="font-medium">Recording in progress, click Pause to pause recording.</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
<!-- Countdown setting (outside main button to avoid nested button issue) -->
      {#if !isRecording}
      <div class="flex items-center gap-2 mt-3 p-2 bg-white border border-gray-200 rounded-lg">
        <label class="text-xs font-medium text-gray-600 flex items-center gap-1">
          <Clock class="w-3 h-3 text-gray-500" /> Countdown
        </label>
        <div class="flex items-center gap-1">
          {#each [1,2,3,4,5] as v}
            <button
              class="px-2 py-1 text-xs rounded-md border transition-colors"
              class:bg-blue-600={countdownSeconds===v}
              class:text-white={countdownSeconds===v}
              class:border-blue-600={countdownSeconds===v}
              class:border-gray-300={countdownSeconds!==v}
              class:hover:border-blue-400={countdownSeconds!==v}
              onclick={() => saveCountdown(v)}
            >{v}s</button>
          {/each}
        </div>
        <input
          type="number"
          min="1"
          max="5"
          class="w-14 px-1 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          bind:value={countdownSeconds}
          onchange={(e:any)=> saveCountdown(clampCountdown(parseInt(e.target.value,10)))}
        />
      </div>
      {/if}

</div>