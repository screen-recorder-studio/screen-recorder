<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { ChromeAPIWrapper } from '$lib/utils/chrome-api'
  import { TriangleAlert, Activity } from '@lucide/svelte'

  // 引入 Worker 系统
  import { recordingService } from '$lib/services/recording-service'
  import { recordingStore } from '$lib/stores/recording.svelte'
  import VideoPreviewComposite from '$lib/components/VideoPreviewComposite.svelte'
  import VideoExportPanel from '$lib/components/VideoExportPanel.svelte'
  import BackgroundColorPicker from '$lib/components/BackgroundColorPicker.svelte'
  import BorderRadiusControl from '$lib/components/BorderRadiusControl.svelte'
  import PaddingControl from '$lib/components/PaddingControl.svelte'
  import AspectRatioControl from '$lib/components/AspectRatioControl.svelte'
  import ShadowControl from '$lib/components/ShadowControl.svelte'
  import RecordButton from '$lib/components/RecordButton.svelte'
  import ElementRegionSelector from '$lib/components/ElementRegionSelector.svelte'
  import { elementRecordingIntegration, type ElementRecordingData } from '$lib/utils/element-recording-integration'
  import { recordingCache } from '$lib/services/recording-cache'

  // 录制状态
  let isRecording = $state(false)
  let status = $state<'idle' | 'requesting' | 'recording' | 'stopping' | 'error'>('idle')
  let errorMessage = $state('')

  // 录制相关变量
  let mediaRecorder: MediaRecorder | null = null
  let recordedChunks: Blob[] = []
  let stream: MediaStream | null = null


  // Worker 系统状态
  let workerSystemReady = $state(false)
  let workerEnvironmentIssues = $state<string[]>([])


  // Worker 录制数据收集
  let workerEncodedChunks = $state<any[]>([])
  let workerCurrentWorker: Worker | null = null



  // 处理录制完成后的视频预览
  async function handleVideoPreview(chunks: any[]): Promise<void> {
    try {
      console.log('🎨 [VideoPreview] Preparing video preview with', chunks.length, 'chunks')

      // VideoPreview 组件会自动处理解码和渲染
      // 这里只需要设置状态，组件会响应 encodedChunks 的变化

    } catch (error) {
      console.error('❌ [VideoPreview] Error preparing video preview:', error)
    }
  }


  // Worker 系统的计算属性
  const workerIsRecording = $derived(recordingStore.isRecording)
  const workerStatus = $derived(recordingStore.state.status)
  const workerErrorMessage = $derived(recordingStore.state.error)

  // 界面模式判断
  const isMinimalMode = $derived(
    workerStatus !== 'completed' || workerEncodedChunks.length === 0
  )
  const isEditingMode = $derived(
    workerStatus === 'completed' && workerEncodedChunks.length > 0
  )

  // 组件挂载时的初始化
  onMount(() => {
    console.log('📱 Sidepanel mounted with Worker system')

    // 检查扩展环境
    // checkExtensionEnvironment()

    // 检查 Worker 环境
    // 如果 URL 携带 id，则从 IndexedDB 加载并进入编辑模式（通用入口）
    ;(async () => {
      try {
        const params = new URLSearchParams(location.search)
        const id = params.get('id')
        if (id && workerEncodedChunks.length === 0) {
          console.log('📦 [Studio] Loading recording from IndexedDB by id:', id)
          const result = await recordingCache.load(id)
          if (result?.chunks?.length) {
            workerEncodedChunks = result.chunks
            recordingStore.updateStatus('completed')
            recordingStore.setEngine('webcodecs')
            console.log('✅ [Studio] Loaded', result.chunks.length, 'chunks for editing', result.meta)
          } else {
            console.warn('⚠️ [Studio] No data found for id:', id)
          }
        }
      } catch (error) {
        console.error('❌ [Studio] Failed to load recording:', error)
      }
    })()

    // checkWorkerEnvironment()

	    // 如果作为新标签页打开并带有 studio=1，则从 IndexedDB 加载并进入编辑模式
	    ;(async () => {
	      try {
	        const params = new URLSearchParams(location.search)
	        if (params.get('studio') === '1') {
	          const id = params.get('id')
	          if (id) {
	            console.log('📦 [Sidepanel->Studio] Loading recording by id:', id)
	            const result = await recordingCache.load(id)
	            if (result?.chunks?.length) {
	              workerEncodedChunks = result.chunks
	              recordingStore.updateStatus('completed')
	              recordingStore.setEngine('webcodecs')
	              console.log('✅ [Sidepanel->Studio] Loaded', result.chunks.length, 'chunks', result.meta)
	            } else {
	              console.warn('⚠️ [Sidepanel->Studio] No data found for id:', id)
	            }
	          }
	        }
	      } catch (e) {
	        console.error('❌ [Sidepanel->Studio] Failed to load from IndexedDB:', e)
	      }
	    })()


 
    return () => {
      // if (typeof chrome !== 'undefined' && chrome.runtime) {
      //   chrome.runtime.onMessage.removeListener(messageListener)
      // }
      // 清理元素录制监听器
      // elementRecordingIntegration.removeListener(elementRecordingListener)
    }
  })

  // 组件销毁时清理
  onDestroy(() => {
    console.log('📱 Sidepanel unmounted, cleaning up...')
    // cleanup()
  })
</script>

<svelte:head>
  <title>屏幕录制</title>
</svelte:head>

<!-- 完整编辑模式 -->
{#if isEditingMode}

<!-- new layout -->
<div class="flex h-screen bg-gray-50">
  <!-- 左侧主预览播放器 - 不允许滚动，高度占满 100vh -->
  <div class="flex-1 flex flex-col h-full overflow-hidden">
    <!-- 预览区域标题 -->
    <div class="flex-shrink-0 p-6 border-b border-gray-200 bg-white">
      <!-- <h1 class="text-2xl font-bold text-gray-800">视频预览播放器</h1>
      <p class="text-sm text-gray-600 mt-1">主预览区域 - 固定高度，不滚动</p> -->
      <AspectRatioControl />
    </div>

    <!-- 预览播放器内容区域 -->
    <div class="flex-1 flex flex-col p-6 relative">
      <!-- 使用新的 VideoPreviewComposite 组件 -->
      <div class="flex-1 flex items-center justify-center">
        <VideoPreviewComposite
          encodedChunks={workerEncodedChunks}
          isRecordingComplete={workerStatus === 'completed' || workerStatus === 'idle'}
          displayWidth={1200}
          displayHeight={800}
          showControls={true}
          showTimeline={true}
          className="worker-video-preview w-full h-full"
        />
      </div>

      {#if workerEncodedChunks.length > 0}
        <div class="absolute bottom-6 left-6 flex items-center gap-2 px-3 py-2 bg-blue-500/20 border border-blue-400/30 rounded-lg text-sm text-blue-200 backdrop-blur-sm">
          <Activity class="w-4 h-4" />
          <span>已收集 {workerEncodedChunks.length} 个编码块</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- 右侧编辑面板 - 允许滚动 -->
  <div class="w-100 bg-white border-l border-gray-200 flex flex-col h-full">
    <!-- 编辑面板标题 -->
    <div class="flex-shrink-0 p-6 border-b border-gray-200">
      <!-- <h2 class="text-lg font-semibold text-gray-800">编辑面板</h2>
      <p class="text-sm text-gray-600 mt-1">配置和导出选项</p> -->
      <VideoExportPanel
          encodedChunks={workerEncodedChunks}
          isRecordingComplete={workerStatus === 'completed' || workerStatus === 'idle'}
          className="export-panel"
        />
    </div>

    <!-- 可滚动的编辑内容区域 -->
    <div class="flex-1 overflow-y-auto">
      <div class="p-6 space-y-6">
        <!-- 视频配置区块 -->

        <!-- 背景颜色选择 -->
          <div class="col-span-2 lg:col-span-1">
            <BackgroundColorPicker />
          </div>

          <!-- 圆角配置 -->
          <div>
            <BorderRadiusControl />
          </div>

          <!-- 边距配置 -->
          <div>
            <PaddingControl />
          </div>

          <!-- 视频比例配置 -->
          <div class="col-span-2 lg:col-span-1">
            <!-- <AspectRatioControl /> -->
          </div>

          <!-- 阴影配置 -->
          <div class="col-span-2 lg:col-span-1">
            <ShadowControl />
          </div>

        <!-- <div class="bg-gray-50 rounded-lg p-4">
          <h3 class="font-medium text-gray-800 mb-3">视频配置</h3>
          <div class="space-y-3">
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">背景颜色选择器</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">圆角控制</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">边距控制</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">宽高比控制</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">阴影控制</span>
            </div>
          </div>
        </div> -->

        <!-- 导出配置区块 -->
        <!-- <div class="bg-gray-50 rounded-lg p-4">
          <h3 class="font-medium text-gray-800 mb-3">导出设置</h3>
          <div class="space-y-3">
            <div class="h-12 bg-blue-500 rounded text-white flex items-center justify-center">
              <span class="text-sm font-medium">导出 WebM</span>
            </div>
            <div class="h-12 bg-green-500 rounded text-white flex items-center justify-center">
              <span class="text-sm font-medium">导出 MP4</span>
            </div>
          </div>
        </div> -->

        <!-- 额外配置区块 - 用于测试滚动 -->
        <!-- <div class="bg-gray-50 rounded-lg p-4">
          <h3 class="font-medium text-gray-800 mb-3">高级设置</h3>
          <div class="space-y-3">
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">质量设置</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">编码选项</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">水印设置</span>
            </div>
          </div>
        </div> -->

        <!-- 更多配置区块 - 确保有足够内容测试滚动 -->
        <!-- <div class="bg-gray-50 rounded-lg p-4">
          <h3 class="font-medium text-gray-800 mb-3">其他选项</h3>
          <div class="space-y-3">
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">帧率设置</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">分辨率选择</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">音频设置</span>
            </div>
            <div class="h-10 bg-white rounded border border-gray-200 flex items-center px-3">
              <span class="text-sm text-gray-500">元数据编辑</span>
            </div>
          </div>
        </div> -->
      </div>
    </div>
  </div>
</div>
<!-- end layout -->
{/if}

<style>
  /* 自定义动画类 */
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-fade-in {
    animation: fade-in 0.5s ease-out;
  }

  /* 优化滚动条样式 */
  :global(.overflow-y-auto::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.overflow-y-auto::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(.overflow-y-auto::-webkit-scrollbar-thumb) {
    background: rgba(156, 163, 175, 0.5);
    border-radius: 3px;
  }

  :global(.overflow-y-auto::-webkit-scrollbar-thumb:hover) {
    background: rgba(156, 163, 175, 0.8);
  }
</style>

