<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { MousePointer, Crop, Eraser, Monitor, RectangleEllipsis } from '@lucide/svelte'
  import {
    sendToBackground,
    onBackgroundMessage,
    initBackgroundState
  } from '$lib/utils/background'
  import { recordingModeStore } from '$lib/stores/recording-mode.svelte'

  // 本地状态管理（非全局状态）
  let selectedDesc = $state<string | undefined>(undefined)
  let capabilities = $state<any>(null)

  // 从全局 store 获取状态
  const mode = $derived(recordingModeStore.currentMode)
  // const selecting = $derived(recordingModeStore.isSelecting)
  const recording = $derived(recordingModeStore.isRecording)
  const canUseElementRegion = $derived(capabilities?.contentScriptAvailable !== false)
  const contentScriptBlocked = $derived(capabilities?.contentScriptAvailable === false)

  // 当从可注入页面切换到受保护页面时，若当前为 element/region，则自动切换为 tab
  $effect(() => {
    if (contentScriptBlocked && (mode === 'element' || mode === 'region')) {
      recordingModeStore.setMode('tab')
    }
  })


  // 设置UI状态
  function setUIState(state: any) {
    if (state.selectedDesc !== undefined) selectedDesc = state.selectedDesc
    if (state.recording !== undefined) recordingModeStore.setRecording(state.recording)
    if (state.selecting !== undefined) recordingModeStore.setSelecting(state.selecting)
    if (state.mode !== undefined) recordingModeStore.setMode(state.mode)
    if (state.capabilities !== undefined) {
      capabilities = state.capabilities
    }
  }

  // 初始化
  async function init() {
    const state = await initBackgroundState()
    setUIState(state)
  }

  // 事件处理函数
  async function handleModeChange(newMode: 'element' | 'region') {
    recordingModeStore.setMode(newMode)
    await sendToBackground('SET_MODE', { mode: newMode })
  }

  async function handleEnterElementSelection() {
    // 快速切换前，退出并清理当前选区（严格顺序）
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    // 切换到元素模式
    await handleModeChange('element')
    // 进入选择
    await sendToBackground('ENTER_SELECTION')
  }

  async function handleEnterRegionSelection() {
    // 快速切换前，退出并清理当前选区（严格顺序）
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    // 切换到区域模式
    await handleModeChange('region')
    // 进入选择
    await sendToBackground('ENTER_SELECTION')
  }

  // 新增：处理 tab、window、screen 模式选择
  async function handleTabSelection() {
    recordingModeStore.setMode('tab')
    if (selectedDesc) {
       // 快速切换前，退出并清理当前选区（严格顺序）
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    }


  }

  async function handleWindowSelection() {
    recordingModeStore.setMode('window')
     if (selectedDesc) {
       // 快速切换前，退出并清理当前选区（严格顺序）
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    }

  }

  async function handleScreenSelection() {
    recordingModeStore.setMode('screen')
     if (selectedDesc) {
       // 快速切换前，退出并清理当前选区（严格顺序）
       await sendToBackground('EXIT_SELECTION')
       await sendToBackground('CLEAR_SELECTION')
     }

  }


  async function handleClearSelection() {
    // 合并：先退出选择，再清空已选（严格顺序）
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
  }

  // 监听来自 background 的消息
  let removeMessageListener: (() => void) | null = null

  onMount(() => {
    init()

    // 设置消息监听器
    removeMessageListener = onBackgroundMessage((msg: any) => {
      if (msg.type === 'STATE_UPDATE') {
        const st = msg.state || {}
        setUIState(st)
      }
    })
  })

  onDestroy(() => {
    // 清理消息监听器
    if (removeMessageListener) {
      removeMessageListener()
    }
  })
</script>

<!-- 录制模式选择控制面板 -->
<div class="element-region-selector bg-white border border-gray-200 rounded-2xl p-6 shadow-lg transition-all duration-300 ease-in-out hover:shadow-xl">
  <div class="flex items-center gap-2 mb-6">
    <div class="w-2 h-2 bg-orange-500 rounded-full transition-colors duration-200"></div>
    <h2 class="text-lg font-semibold text-gray-800 transition-colors duration-200">录制模式选择</h2>
  </div>


  <!-- 控制按钮 -->
  <div class="space-y-3">
    {#if canUseElementRegion}
      <button
        onclick={handleEnterElementSelection}
        class="w-full px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
        disabled={recording}
        title={recording ? '录制中不可用' : undefined}
      >
        <MousePointer class="w-4 h-4" />
        录制元素
      </button>

      <button
        onclick={handleEnterRegionSelection}
        class="w-full px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
        disabled={recording}
        title={recording ? '录制中不可用' : undefined}
      >
        <Crop class="w-4 h-4" />
        录制区域
      </button>
    {/if}

    {#if selectedDesc}
      <button
        onclick={handleClearSelection}
        class="w-full px-3 py-2 text-sm bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
        disabled={recording}
        title={recording ? '录制中不可用' : undefined}
      >
        <Eraser class="w-4 h-4" />
        清除选择
      </button>
    {/if}

    <!-- 分隔线 -->
    <div class="border-t border-gray-200 my-2"></div>

    <!-- Tab/Window/Screen 录制按钮 -->
    <button
      onclick={handleTabSelection}
      class="w-full px-3 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
      disabled={recording}
      title={recording ? '录制中不可用' : undefined}
    >
      <RectangleEllipsis class="w-4 h-4" />
      录制标签页
    </button>

    <button
      onclick={handleWindowSelection}
      class="w-full px-3 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
      disabled={recording}
      title={recording ? '录制中不可用' : undefined}
    >
      <RectangleEllipsis class="w-4 h-4" />
      录制窗口
    </button>

    <button
      onclick={handleScreenSelection}
      class="w-full px-3 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400 disabled:shadow-none disabled:opacity-80 flex items-center justify-center gap-2"
      disabled={recording}
      title={recording ? '录制中不可用' : undefined}
    >
      <Monitor class="w-4 h-4" />
      录制屏幕
    </button>




  </div>

  <!-- 状态显示 -->
  <div class="mt-4 space-y-2 text-sm">
    <div class="text-blue-600">
      <strong>选择状态:</strong> {selectedDesc || '未选择'}
    </div>
    <div class="text-gray-700">
      <strong>录制状态:</strong> {recording ? '录制中' : '未录制'}
    </div>
    <div class="text-green-600">
      <strong>当前模式:</strong> {mode}
    </div>
  </div>
</div>


