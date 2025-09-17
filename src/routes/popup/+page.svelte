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
    AlertCircle
  } from '@lucide/svelte'
  import { onMount } from 'svelte'

  // 录制状态管理
  let isRecording = $state(false)
  let isPaused = $state(false)
  let selectedMode = $state<'area' | 'element' | 'camera' | 'tab' | 'window' | 'screen'>('area')
  let isLoading = $state(false)

  // 能力状态：当前页面是否允许注入内容脚本（影响元素/区域模式是否可用）
  let contentScriptAvailable = $state<boolean | null>(null)
  let capabilityReason = $state<string | undefined>(undefined)
  let currentTabId = $state<number | null>(null)

  function isModeDisabledLocal(modeId: typeof selectedMode) {
    const restricted = (modeId === 'element' || modeId === 'area') && contentScriptAvailable === false
    const blockedByRecording = isRecording && selectedMode !== modeId
    return restricted || blockedByRecording
  }

  // 初始化：同步后台状态
  onMount(async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'REQUEST_RECORDING_STATE' })
      isRecording = !!resp?.state?.isRecording
      isPaused = !!resp?.state?.isPaused
    } catch (e) {
      console.warn('初始化录制状态失败', e)
    }
    // 初始化获取当前标签页能力
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
        // 恢复上次选择的模式
        const uiMode = st?.state?.uiSelectedMode
        const legacyMode = st?.state?.mode
        if (uiMode === 'element' || uiMode === 'area' || uiMode === 'camera' || uiMode === 'tab' || uiMode === 'window' || uiMode === 'screen') {
          selectedMode = uiMode
        } else if (legacyMode === 'region' || legacyMode === 'element') {
          selectedMode = legacyMode === 'region' ? 'area' : 'element'
        }
        // 若全局未在录制，但 tab 层记录为录制中（元素/区域链路），也同步为录制中
        if (!isRecording && typeof st?.state?.recording === 'boolean' && st.state.recording) {
          isRecording = true
        }
      }
    } catch (e) {
      // ignore init errors
    }
  })

  // 监听后台/离屏发来的流状态，确保浏览器“Stop sharing”时能同步停止
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
          // 同步选择的模式（优先使用 uiSelectedMode）
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



  // 录制模式配置
  const recordingModes = [
    {
      id: 'area' as const,
      name: '区域',
      icon: MousePointer,
      description: '选择屏幕区域录制'
    },
    {
      id: 'element' as const,
      name: '元素',
      icon: Monitor,
      description: '选择页面元素录制'
    },
    {
      id: 'camera' as const,
      name: '摄像头',
      icon: Camera,
      description: '录制摄像头画面'
    },
    {
      id: 'tab' as const,
      name: 'Tab',
      icon: FileText,
      description: '录制当前标签页'
    },
    {
      id: 'window' as const,
      name: 'Window',
      icon: AppWindow,
      description: '录制整个窗口'
    },
    {
      id: 'screen' as const,
      name: 'Screen',
      icon: ScreenShare,
      description: '录制整个屏幕'
    }
  ]

  // 处理模式选择
  async function selectMode(mode: typeof selectedMode) {
    if (isModeDisabledLocal(mode)) return
    if (!isRecording) {
      const prev = selectedMode
      selectedMode = mode

      // 拿到当前活动 tabId
      let tabId = currentTabId
      try {
        if (tabId == null) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
          tabId = (tabs && tabs[0] && typeof tabs[0].id === 'number') ? tabs[0].id : null
        }
      } catch {}


      // 记录 UI 选择的模式到后台，便于下次打开恢复
      try { await chrome.runtime.sendMessage({ type: 'SET_SELECTED_MODE', uiMode: selectedMode, tabId }) } catch {}

      // 若从 元素/区域 切到 其它类型（tab/window/screen），清除页面上的选区并退出选择态
      const isElemOrArea = (m: typeof selectedMode) => m === 'element' || m === 'area'
      if (isElemOrArea(prev) && !isElemOrArea(mode) && tabId != null) {
        try {
          await chrome.runtime.sendMessage({ type: 'CLEAR_SELECTION', tabId })
          await chrome.runtime.sendMessage({ type: 'EXIT_SELECTION', tabId })
        } catch {}
      }

      // 若切换到 元素/区域：先清除旧选区（避免跨模式残留），再进入新模式选择
      if (isElemOrArea(mode) && tabId != null) {
        try { await chrome.runtime.sendMessage({ type: 'CLEAR_SELECTION', tabId }) } catch {}
        const mapped = mode === 'area' ? 'region' : 'element'
        await chrome.runtime.sendMessage({ type: 'SET_MODE', mode: mapped, tabId }).catch(() => {})
        await chrome.runtime.sendMessage({ type: 'ENTER_SELECTION', tabId }).catch(() => {})
      }
    }
  }

  // 开始录制
  async function startRecording() {
    if (isLoading) return
    isLoading = true
    try {
      if (selectedMode === 'element' || selectedMode === 'area') {
        // 元素/区域走内容脚本 START_CAPTURE
        let tabId = currentTabId
        try {
          if (tabId == null) {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
            tabId = (tabs && tabs[0] && typeof tabs[0].id === 'number') ? tabs[0].id : null
          }
        } catch {}
        if (tabId != null) {
          await chrome.runtime.sendMessage({ type: 'START_CAPTURE', tabId })
          // 等待 STREAM_START/STATE_UPDATE 确认后再更新 isRecording/isPaused
        } else {
          throw new Error('未获取到活动标签页，无法开始录制')
        }
      } else {
        // 其它模式沿用 offscreen 管线
        const mode = (['tab','window','screen'] as const).includes(selectedMode as any) ? (selectedMode as 'tab'|'window'|'screen') : 'screen'
        await chrome.runtime.sendMessage({
          type: 'REQUEST_START_RECORDING',
          payload: { options: { mode, video: true, audio: false } }
        })
        // 等待 STREAM_START/STATE_UPDATE 确认后再更新 isRecording/isPaused
      }
    } catch (error) {
      console.error('开始录制失败:', error)
    } finally {
      isLoading = false
    }
  }

  // 暂停/恢复录制
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
        // offscreen 路径会返回 paused，直接采用返回值
        isPaused = resp.paused
      }
      // 元素/区域路径不做乐观更新，等待 STREAM_META 同步
    } catch (e) {
      console.warn('切换暂停失败', e)
    } finally {
      isLoading = false
    }
  }

  // 停止录制
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
          console.warn('未获取到活动标签页，无法停止录制');
        }
      } else {
        await chrome.runtime.sendMessage({ type: 'REQUEST_STOP_RECORDING' })
      }
    } catch (e) {
      console.warn('发送停止录制消息失败', e)
    }
    isRecording = false
    isPaused = false
  }

  // 获取按钮文本
  function getButtonText() {
    if (isLoading) return '准备中...'
    if (isRecording) {
      return isPaused ? '恢复录制' : '暂停录制'
    }
    return '开始录制'
  }

  // 获取按钮图标
  function getButtonIcon() {
    if (isLoading) return Loader2
    if (isRecording) {
      return isPaused ? Play : Pause
    }
    return Play
  }
</script>

<svelte:head>
  <title>屏幕录制扩展</title>
</svelte:head>

<div class="w-[320px] bg-white font-sans">
  <!-- 头部 -->
  <div class="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
    <h1 class="text-lg font-semibold text-gray-800 flex items-center gap-2">
      <Monitor class="w-5 h-5 text-blue-600" />
      屏幕录制
    </h1>
    <p class="text-sm text-gray-600 mt-1">选择录制模式并开始录制</p>
  </div>

  <!-- 录制模式选择 -->
  <div class="p-4">
    <h2 class="text-sm font-medium text-gray-700 mb-3">录制模式</h2>
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
          title={(mode.id==='element'||mode.id==='area') && contentScriptAvailable===false ? '此页面受限制，无法使用该模式' : mode.description}
        >
          <!-- 选中指示器 -->
          {#if selectedMode === mode.id}
            <div class="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white"></div>
          {/if}

          <!-- 图标 -->
          <IconComponent
            class={`w-6 h-6 mb-2 transition-colors duration-200 ${
              selectedMode === mode.id ? 'text-blue-600' : 'text-gray-600'
            }`}
          />

          <!-- 标签 -->
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

  <!-- 录制状态显示 -->
  {#if isRecording}
    <div class="px-4 py-3 bg-red-50 border-t border-red-100">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
          <span class="text-sm font-medium text-red-700">
            {isPaused ? '录制已暂停' : '正在录制'}
          </span>
        </div>
        <div class="text-xs text-red-600">
          {recordingModes.find(m => m.id === selectedMode)?.name}
        </div>
      </div>
    </div>
  {/if}

  <!-- 控制按钮 -->
  <div class="p-4 border-t border-gray-200 bg-gray-50">
    <div class="space-y-2">
      <!-- 主要控制按钮 -->
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
        <!-- 按钮图标 -->
        <div class="flex items-center justify-center w-5 h-5">
          {#if isLoading}
            <Loader2 class="w-5 h-5 animate-spin" />
          {:else}
            {@const ButtonIcon = getButtonIcon()}
            <ButtonIcon class="w-5 h-5" />
          {/if}
        </div>

        <!-- 按钮文本 -->
        <span class="font-semibold">
          {getButtonText()}
        </span>
      </button>

      <!-- 停止录制按钮 -->
      {#if isRecording}
        <button
          class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          onclick={stopRecording}
        >
          <Square class="w-4 h-4" />
          <span>停止录制</span>
        </button>
      {/if}
    </div>

    <!-- 提示信息 -->
    <div class="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
      <div class="flex items-start gap-2">
        <AlertCircle class="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <div class="text-xs text-blue-700">
          {#if !isRecording}
            <p class="font-medium mb-1">录制提示：</p>
            <p>选择 <strong>{recordingModes.find(m => m.id === selectedMode)?.name}</strong> 模式，点击开始录制按钮开始录制。</p>
          {:else if isPaused}
            <p class="font-medium">录制已暂停，点击恢复录制继续。</p>
          {:else}
            <p class="font-medium">正在录制中，点击暂停可暂停录制。</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>