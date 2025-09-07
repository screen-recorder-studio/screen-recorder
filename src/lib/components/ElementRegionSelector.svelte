<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  // 状态管理
  let mode = $state<'element' | 'region'>('element')
  let selecting = $state(false)
  let recording = $state(false)
  let selectedDesc = $state<string | undefined>(undefined)
  let capabilities = $state<any>(null)
  let apiStatus = $state('检测 API...')
  let hasVideo = $state(false)
  let videoSize = $state<number>(0)
  let videoUrl = $state<string | null>(null)

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
    if (state.hasVideo !== undefined) hasVideo = state.hasVideo
    if (state.videoSize !== undefined) videoSize = state.videoSize
    if (state.videoUrl !== undefined) videoUrl = state.videoUrl
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

  async function handleDownloadVideo() {
    await sendToBackground('DOWNLOAD_VIDEO')
  }

  async function handleSwitchToEdit() {
    // 停止当前录制并切换到编辑模式
    if (recording) {
      await sendToBackground('STOP_CAPTURE')
    }

    // 通知用户切换到编辑模式
    console.log('🎬 [ElementSelector] Switching to edit mode...')
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
    // 清理视频 URL
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl)
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

    <!-- 切换到编辑按钮 -->
    {#if recording}
      <button
        onclick={handleSwitchToEdit}
        class="w-full px-3 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center justify-center gap-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
        </svg>
        暂停并切换到编辑
      </button>
    {/if}
    
    <button
      onclick={handleClearSelection}
      class="w-full px-3 py-2 text-sm bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
    >
      清除选区
    </button>

    <!-- 视频预览区域 -->
    {#if hasVideo && videoUrl}
      <div class="w-full bg-gray-50 rounded-lg p-3 border border-gray-200">
        <div class="flex items-center gap-2 mb-2">
          <svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
          </svg>
          <span class="text-sm font-medium text-gray-700">录制预览</span>
          <span class="text-xs text-gray-500">({(videoSize / 1024 / 1024).toFixed(1)}MB)</span>
        </div>
        <video
          src={videoUrl}
          controls
          class="w-full rounded border border-gray-300 bg-black"
          style="max-height: 200px;"
          preload="metadata"
        >
          <track kind="captions" />
          您的浏览器不支持视频播放
        </video>
      </div>
    {/if}

    <!-- 下载按钮 -->
    {#if hasVideo}
      <button
        onclick={handleDownloadVideo}
        class="w-full px-3 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center justify-center gap-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
        </svg>
        下载录制视频
      </button>
    {/if}
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
    {#if hasVideo}
      <div class="text-purple-600">
        <strong>视频状态:</strong> 已录制完成，可下载
      </div>
    {/if}
  </div>
</div>


