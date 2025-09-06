<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  // 状态管理
  let mode = $state<'element' | 'region'>('element')
  let selecting = $state(false)
  let recording = $state(false)
  let selectedDesc = $state<string | undefined>(undefined)
  let capabilities = $state<any>(null)
  let apiStatus = $state('检测 API...')

  // Chrome 扩展环境检测
  const hasExt = typeof chrome !== 'undefined' && chrome?.runtime && chrome?.tabs

  // 获取当前活动标签页ID
  function getActiveTabId(): Promise<number | undefined> {
    if (!hasExt) return Promise.resolve(undefined)
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0]?.id)
      })
    })
  }

  // 发送消息到 background script
  async function sendToBackground(type: string, extra: any = {}) {
    if (!hasExt) return
    const tabId = await getActiveTabId()
    return chrome.runtime.sendMessage({ type, tabId, ...extra })
  }

  // 更新 API 状态显示
  function updateApiStatus() {
    if (!hasExt) {
      apiStatus = '预览模式：无 Chrome 扩展 API 环境'
      return
    }
    if (!capabilities) {
      apiStatus = '等待页面脚本报告能力...'
      return
    }
    const parts = []
    parts.push(`getDisplayMedia: ${capabilities.getDisplayMedia ? '✓' : '×'}`)
    parts.push(`RestrictionTarget: ${capabilities.restrictionTarget ? '✓' : '×'}`)
    parts.push(`CropTarget: ${capabilities.cropTarget ? '✓' : '×'}`)
    apiStatus = parts.join(' | ')
  }

  // 设置UI状态
  function setUIState(state: any) {
    if (state.selectedDesc !== undefined) selectedDesc = state.selectedDesc
    if (state.recording !== undefined) recording = state.recording
    if (state.selecting !== undefined) selecting = state.selecting
    if (state.mode !== undefined) mode = state.mode
    if (state.capabilities !== undefined) {
      capabilities = state.capabilities
      updateApiStatus()
    }
  }

  // 初始化
  async function init() {
    updateApiStatus()
    if (!hasExt) {
      setUIState({ mode: 'element', selecting: false, recording: false })
      return
    }
    const tabId = await getActiveTabId()
    chrome.runtime.sendMessage({ type: 'GET_STATE', tabId }, (resp) => {
      const st = resp?.state || { mode: 'element', selecting: false, recording: false }
      setUIState(st)
    })
  }

  // 事件处理函数
  async function handleModeChange(newMode: 'element' | 'region') {
    mode = newMode
    await sendToBackground('SET_MODE', { mode: newMode })
  }

  async function handleEnterSelection() {
    await sendToBackground('ENTER_SELECTION')
  }

  async function handleExitSelection() {
    await sendToBackground('EXIT_SELECTION')
  }

  async function handleStartCapture() {
    await sendToBackground('START_CAPTURE')
  }

  async function handleStopCapture() {
    await sendToBackground('STOP_CAPTURE')
  }

  async function handleClearSelection() {
    await sendToBackground('CLEAR_SELECTION')
  }

  // 监听来自 background 的消息
  let messageListener: ((msg: any) => void) | null = null

  onMount(() => {
    init()
    
    if (hasExt) {
      messageListener = (msg: any) => {
        if (msg.type === 'STATE_UPDATE') {
          const st = msg.state || {}
          setUIState(st)
        }
      }
      chrome.runtime.onMessage.addListener(messageListener)
    }
  })

  onDestroy(() => {
    if (hasExt && messageListener) {
      chrome.runtime.onMessage.removeListener(messageListener)
    }
  })
</script>

<!-- 元素/区域选择控制面板 -->
<div class="element-region-selector bg-white border border-gray-200 rounded-2xl p-6 shadow-lg transition-all duration-300 ease-in-out hover:shadow-xl">
  <div class="flex items-center gap-2 mb-6">
    <div class="w-2 h-2 bg-orange-500 rounded-full transition-colors duration-200"></div>
    <h2 class="text-lg font-semibold text-gray-800 transition-colors duration-200">元素/区域录制</h2>
  </div>

  <!-- 模式选择 -->
  <div class="mb-4">
    <div class="block text-sm font-medium text-gray-700 mb-2">录制模式：</div>
    <div class="flex gap-4">
      <label class="flex items-center">
        <input
          type="radio"
          name="mode"
          value="element"
          checked={mode === 'element'}
          onchange={() => handleModeChange('element')}
          class="mr-2"
        />
        <span class="text-sm">元素选择</span>
      </label>
      <label class="flex items-center">
        <input
          type="radio"
          name="mode"
          value="region"
          checked={mode === 'region'}
          onchange={() => handleModeChange('region')}
          class="mr-2"
        />
        <span class="text-sm">选区选择</span>
      </label>
    </div>
  </div>

  <!-- 控制按钮 -->
  <div class="space-y-3">
    <div class="flex gap-2">
      <button 
        onclick={handleEnterSelection}
        class="flex-1 px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        disabled={selecting}
      >
        进入选择
      </button>
      <button 
        onclick={handleExitSelection}
        class="flex-1 px-3 py-2 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
        disabled={!selecting}
      >
        退出选择
      </button>
    </div>
    
    <div class="flex gap-2">
      <button 
        onclick={handleStartCapture}
        class="flex-1 px-3 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
        disabled={recording}
      >
        开始录制
      </button>
      <button 
        onclick={handleStopCapture}
        class="flex-1 px-3 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
        disabled={!recording}
      >
        停止录制
      </button>
    </div>
    
    <button 
      onclick={handleClearSelection}
      class="w-full px-3 py-2 text-sm bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
    >
      清除选区
    </button>
  </div>

  <!-- 状态显示 -->
  <div class="mt-4 space-y-2 text-sm">
    <div class="text-gray-600">
      <strong>API状态:</strong> <span class="text-xs">{apiStatus}</span>
    </div>
    <div class="text-blue-600">
      <strong>选择状态:</strong> {selectedDesc || '未选择'}
    </div>
    <div class="text-gray-700">
      <strong>录制状态:</strong> {recording ? '录制中' : '未录制'}
    </div>
  </div>
</div>


