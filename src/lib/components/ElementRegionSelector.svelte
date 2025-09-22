<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { MousePointer, Crop, Eraser, Monitor, RectangleEllipsis } from '@lucide/svelte'
  import {
    sendToBackground,
    onBackgroundMessage,
    initBackgroundState
  } from '$lib/utils/background'
  import { recordingModeStore } from '$lib/stores/recording-mode.svelte'

  // Local state management (non-global state)
  let selectedDesc = $state<string | undefined>(undefined)
  let capabilities = $state<any>(null)

  // Get state from global store
  const mode = $derived(recordingModeStore.currentMode)
  // const selecting = $derived(recordingModeStore.isSelecting)
  const recording = $derived(recordingModeStore.isRecording)
  const canUseElementRegion = $derived(capabilities?.contentScriptAvailable !== false)
  const contentScriptBlocked = $derived(capabilities?.contentScriptAvailable === false)

  // When switching from injectable page to protected page, if current mode is element/region, automatically switch to tab
  $effect(() => {
    if (contentScriptBlocked && (mode === 'element' || mode === 'region')) {
      recordingModeStore.setMode('tab')
    }
  })


  // Set UI state
  function setUIState(state: any) {
    if (state.selectedDesc !== undefined) selectedDesc = state.selectedDesc
    if (state.recording !== undefined) recordingModeStore.setRecording(state.recording)
    if (state.selecting !== undefined) recordingModeStore.setSelecting(state.selecting)
    if (state.mode !== undefined) recordingModeStore.setMode(state.mode)
    if (state.capabilities !== undefined) {
      capabilities = state.capabilities
    }
  }

  // Initialization
  async function init() {
    const state = await initBackgroundState()
    setUIState(state)
  }

  // Event handling functions
  async function handleModeChange(newMode: 'element' | 'region') {
    recordingModeStore.setMode(newMode)
    await sendToBackground('SET_MODE', { mode: newMode })
  }

  async function handleEnterElementSelection() {
    // Quick switch before, exit and clear current selection (strict order)
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    // Switch to element mode
    await handleModeChange('element')
    // Enter selection
    await sendToBackground('ENTER_SELECTION')
  }

  async function handleEnterRegionSelection() {
    // Quick switch before, exit and clear current selection (strict order)
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    // Switch to region mode
    await handleModeChange('region')
    // Enter selection
    await sendToBackground('ENTER_SELECTION')
  }

  // New: handle tab, window, screen mode selection
  async function handleTabSelection() {
    recordingModeStore.setMode('tab')
    if (selectedDesc) {
       // Quick switch before, exit and clear current selection (strict order)
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    }


  }

  async function handleWindowSelection() {
    recordingModeStore.setMode('window')
     if (selectedDesc) {
       // Quick switch before, exit and clear current selection (strict order)
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    }

  }

  async function handleScreenSelection() {
    recordingModeStore.setMode('screen')
     if (selectedDesc) {
       // Quick switch before, exit and clear current selection (strict order)
       await sendToBackground('EXIT_SELECTION')
       await sendToBackground('CLEAR_SELECTION')
     }

  }


  async function handleClearSelection() {
    // Merge: first exit selection, then clear selected (strict order)
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
  }

  // Listen to messages from background
  let removeMessageListener: (() => void) | null = null

  onMount(() => {
    init()

    // Set message listener
    removeMessageListener = onBackgroundMessage((msg: any) => {
      if (msg.type === 'STATE_UPDATE') {
        const st = msg.state || {}
        setUIState(st)
      }
    })
  })

  onDestroy(() => {
    // Clean up message listener
    if (removeMessageListener) {
      removeMessageListener()
    }
  })
</script>

<!-- Recording mode selection control panel -->
<div class="element-region-selector bg-white border border-gray-200 rounded-2xl p-6 shadow-lg transition-all duration-300 ease-in-out hover:shadow-xl">
  <div class="flex items-center gap-2 mb-6">
    <div class="w-2 h-2 bg-orange-500 rounded-full transition-colors duration-200"></div>
    <h2 class="text-lg font-semibold text-gray-800 transition-colors duration-200">Recording Mode Selection</h2>
  </div>


  <!-- Control buttons -->
  <div class="space-y-3">
    {#if canUseElementRegion}
      <button
        onclick={handleEnterElementSelection}
        class="w-full px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
        disabled={recording}
        title={recording ? 'Not available during recording' : undefined}
      >
        <MousePointer class="w-4 h-4" />
        Record Element
      </button>

      <button
        onclick={handleEnterRegionSelection}
        class="w-full px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
        disabled={recording}
        title={recording ? 'Not available during recording' : undefined}
      >
        <Crop class="w-4 h-4" />
        Record Region
      </button>
    {/if}

    {#if selectedDesc}
      <button
        onclick={handleClearSelection}
        class="w-full px-3 py-2 text-sm bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
        disabled={recording}
        title={recording ? 'Not available during recording' : undefined}
      >
        <Eraser class="w-4 h-4" />
        Clear Selection
      </button>
    {/if}

    <!-- Separator -->
    <div class="border-t border-gray-200 my-2"></div>

    <!-- Tab/Window/Screen recording buttons -->
    <button
      onclick={handleTabSelection}
      class="w-full px-3 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
      disabled={recording}
      title={recording ? 'Not available during recording' : undefined}
    >
      <RectangleEllipsis class="w-4 h-4" />
      Record Tab
    </button>

    <button
      onclick={handleWindowSelection}
      class="w-full px-3 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
      disabled={recording}
      title={recording ? 'Not available during recording' : undefined}
    >
      <RectangleEllipsis class="w-4 h-4" />
      Record Window
    </button>

    <button
      onclick={handleScreenSelection}
      class="w-full px-3 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
      disabled={recording}
      title={recording ? 'Not available during recording' : undefined}
    >
      <Monitor class="w-4 h-4" />
      Record Screen
    </button>




  </div>

  <!-- Status display -->
  <div class="mt-4 space-y-2 text-sm">
    <div class="text-blue-600">
      <strong>Selection Status:</strong> {selectedDesc || 'Not selected'}
    </div>
    <div class="text-gray-700">
      <strong>Recording Status:</strong> {recording ? 'Recording' : 'Not recording'}
    </div>
    <div class="text-green-600">
      <strong>Current Mode:</strong> {mode}
    </div>
  </div>
</div>


