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
  // 当前会话的 OPFS 目录 id（用于导出时触发只读日志）
  let opfsDirId = $state('')


  // Worker 录制数据收集
  let workerEncodedChunks = $state<any[]>([])
  let workerCurrentWorker: Worker | null = null


  // 预取控制：拦截一次 range 回复供预取使用
  let isPrefetchingRange = false
  let prefetchRangeResolver: null | ((res: { start: number; chunks: any[] }) => void) = null

  // 时间轴与窗口（毫秒）
  let durationMs = $state(0)
  let windowStartMs = $state(0)
  let windowEndMs = $state(0)
  // 全局帧数与窗口起始全局索引
  let globalTotalFrames = $state(0)
  let windowStartIndex = $state(0)

  // 🔧 智能窗口管理：关键帧信息
  let keyframeInfo = $state<{
    indices: number[]
    timestamps: number[]
    count: number
    avgInterval: number
  } | null>(null)



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

    // 基于 OPFSReaderWorker 打开录制并获取首批编码块
    try {
      const params = new URLSearchParams(location.search)
      const dirId = params.get('id') || ''
      opfsDirId = dirId
      if (dirId && workerEncodedChunks.length === 0) {
        console.log('� [Studio] Opening OPFS recording by dirId:', dirId)
        const readerWorker = new Worker(
          new URL('$lib/workers/opfs-reader-worker.ts', import.meta.url),
          { type: 'module' }
        )

        workerCurrentWorker = readerWorker


        // 监听 Reader 事件
        readerWorker.onmessage = (ev: MessageEvent<any>) => {
          const { type, summary, meta, start, count, chunks, code, message, keyframeInfo: receivedKeyframeInfo } = ev.data || {}

          // 拦截：如果是预取模式下收到的 range，则只交给预取 resolver，不更新UI状态
          if (isPrefetchingRange && type === 'range') {
            console.log('[prefetch] Reader returned range (prefetch):', { start, count, chunks: chunks?.length })
            isPrefetchingRange = false
            prefetchRangeResolver?.({ start, chunks })
            prefetchRangeResolver = null
            return
          }

          if (type === 'ready') {
            console.log('✅ [OPFSReader] Ready:', { summary, meta, keyframeInfo: receivedKeyframeInfo })
            if (summary?.durationMs) durationMs = summary.durationMs
            if (summary?.totalChunks) globalTotalFrames = summary.totalChunks
            if (receivedKeyframeInfo) keyframeInfo = receivedKeyframeInfo

            console.log('[progress] Parent component - OPFS data loaded:', {
              durationMs,
              globalTotalFrames,
              summary,
              meta,
              keyframeInfo
            })

            // 🔧 修复：使用帧范围而不是时间范围进行初始加载
            const initialFrameCount = Math.min(90, globalTotalFrames) // 前90帧（约3秒@30fps）
            console.log('[progress] Parent component - requesting initial frames:', {
              start: 0,
              count: initialFrameCount,
              totalFrames: globalTotalFrames
            })
            readerWorker.postMessage({
              type: 'getRange',
              start: 0,
              count: initialFrameCount
            })
          } else if (type === 'range') {
            console.log('📦 [OPFSReader] Received range:', { start, count })
            if (Array.isArray(chunks) && chunks.length > 0) {
              workerEncodedChunks = chunks
              windowStartIndex = typeof start === 'number' ? start : 0

              // 🔧 修复：计算相对时间戳
              const firstGlobalTimestamp = summary?.firstTimestamp || chunks[0]?.timestamp || 0
              const windowStartTimestamp = chunks[0]?.timestamp || 0
              const windowEndTimestamp = chunks[chunks.length - 1]?.timestamp || 0

              windowStartMs = Math.floor((windowStartTimestamp - firstGlobalTimestamp) / 1000)
              windowEndMs = Math.floor((windowEndTimestamp - firstGlobalTimestamp) / 1000)

              console.log('[progress] Parent component - window data updated:', {
                chunksLength: chunks.length,
                windowStartIndex,
                windowStartMs,
                windowEndMs,
                firstGlobalTimestamp,
                windowStartTimestamp,
                windowEndTimestamp,
                relativeStartMs: windowStartMs,
                relativeEndMs: windowEndMs
              })
              recordingStore.updateStatus('completed')
              recordingStore.setEngine('webcodecs')
              console.log('🎬 [Studio] Prepared', chunks.length, 'chunks from OPFS for preview')
            } else {
              console.warn('⚠️ [OPFSReader] Empty range received')
            }
          } else if (type === 'error') {
            console.error('❌ [OPFSReader] Error:', code, message)
          }
        }

        // 打开目录
        readerWorker.postMessage({ type: 'open', dirId })
      }
    } catch (error) {
      console.error('❌ [Studio] Failed to open OPFS recording:', error)
    }

    // 结束 OPFSReader 初始化



    return () => {
      // if (typeof chrome !== 'undefined' && chrome.runtime) {
      //   chrome.runtime.onMessage.removeListener(messageListener)
      // }
      // 清理元素录制监听器
      // elementRecordingIntegration.removeListener(elementRecordingListener)
      try {
        workerCurrentWorker?.postMessage({ type: 'close' })
      } catch {}
      workerCurrentWorker?.terminate?.()
      workerCurrentWorker = null
    }
  })

  // 供 VideoPreviewComposite 进行“只读预取”的数据拉取；不改变当前窗口
  async function fetchWindowData(args: { centerMs: number; beforeMs: number; afterMs: number }): Promise<{ chunks: any[]; windowStartIndex: number }> {
    const { centerMs, beforeMs, afterMs } = args
    if (!workerCurrentWorker) {
      console.warn('[prefetch] No reader worker; returning empty prefetch result')
      return { chunks: [], windowStartIndex: 0 }
    }
    if (isPrefetchingRange) {
      console.warn('[prefetch] Already building; skip duplicate prefetch request')
      return { chunks: [], windowStartIndex: 0 }
    }

    return new Promise((resolve) => {
      isPrefetchingRange = true
      let settled = false
      prefetchRangeResolver = ({ start, chunks }) => {
        if (settled) return
        settled = true
        resolve({ chunks: chunks || [], windowStartIndex: start ?? 0 })
      }

      // 计算期望的帧范围：尽量与 onRequestWindow 的关键帧对齐策略一致
      const estimatedFps = 30
      const targetFrameIndex = Math.floor((centerMs / 1000) * estimatedFps)
      let startFrame: number
      let frameCount: number

      if (keyframeInfo && keyframeInfo.indices.length > 0) {
        // 预取面向“下一窗口”：选择第一个 >= target 的关键帧，避免回落到当前窗口
        let forwardKeyframeIndex = keyframeInfo.indices[keyframeInfo.indices.length - 1]
        for (let i = 0; i < keyframeInfo.indices.length; i++) {
          if (keyframeInfo.indices[i] >= targetFrameIndex) {
            forwardKeyframeIndex = keyframeInfo.indices[i]
            break
          }
        }
        startFrame = Math.max(0, forwardKeyframeIndex)
      } else {
        // 无关键帧信息：直接从 target 开始（不再回退 beforeMs）
        startFrame = Math.max(0, targetFrameIndex)
      }

      // afterMs -> 帧数（至少1帧）
      const framesAfter = Math.max(1, Math.floor((afterMs / 1000) * estimatedFps))
      frameCount = Math.min(framesAfter, Math.max(1, globalTotalFrames - startFrame))

      try {
        workerCurrentWorker!.postMessage({ type: 'getRange', start: startFrame, count: frameCount })
      } catch (err) {
        console.warn('[prefetch] Failed to post prefetch request:', err)
        isPrefetchingRange = false
        prefetchRangeResolver = null
        resolve({ chunks: [], windowStartIndex: 0 })
        return
      }

      // 超时保护，防止卡死
      setTimeout(() => {
        if (!settled) {
          console.warn('[prefetch] Prefetch timeout, returning empty')
          settled = true
          isPrefetchingRange = false
          prefetchRangeResolver = null
          resolve({ chunks: [], windowStartIndex: 0 })
        }
      }, 4000)
    })
  }


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
      <div class="flex-1 flex items-stretch justify-center">
        <VideoPreviewComposite
          encodedChunks={workerEncodedChunks}
          isRecordingComplete={workerStatus === 'completed' || workerStatus === 'idle'}
          displayWidth={1200}
          displayHeight={800}
          showControls={true}
          showTimeline={true}
          durationMs={durationMs}
          windowStartMs={windowStartMs}
          windowEndMs={windowEndMs}
          totalFramesAll={globalTotalFrames}
          windowStartIndex={windowStartIndex}
          onRequestWindow={({ centerMs, beforeMs, afterMs }) => {
            console.log('[progress] Parent component - window request:', { centerMs, beforeMs, afterMs })

            if (!workerCurrentWorker) {
              console.warn('[progress] No worker available for window request')
              return
            }

            // 🔧 智能窗口请求：基于关键帧信息优化
            const estimatedFps = 30 // TODO: 从meta中获取实际fps
            const targetFrameIndex = Math.floor((centerMs / 1000) * estimatedFps)

            let startFrame: number
            let frameCount: number

            if (keyframeInfo && keyframeInfo.indices.length > 0) {
              // 🔧 使用关键帧信息进行智能窗口切换（前瞻对齐）：选择第一个 >= target 的关键帧
              let forwardKeyframeIndex = keyframeInfo.indices[keyframeInfo.indices.length - 1]
              for (let i = 0; i < keyframeInfo.indices.length; i++) {
                if (keyframeInfo.indices[i] >= targetFrameIndex) {
                  forwardKeyframeIndex = keyframeInfo.indices[i]
                  break
                }
              }

              // 基于关键帧间隔计算合适的窗口大小
              const avgKeyframeInterval = keyframeInfo.avgInterval || 30
              const windowSize = Math.min(120, Math.max(60, avgKeyframeInterval * 2)) // 2-4个关键帧间隔

              startFrame = Math.max(0, forwardKeyframeIndex)
              frameCount = Math.min(windowSize, globalTotalFrames - startFrame)

              console.log('[progress] Parent component - keyframe-based window (forward):', {
                targetFrameIndex,
                forwardKeyframeIndex,
                avgKeyframeInterval,
                windowSize,
                startFrame,
                frameCount,
                totalKeyframes: keyframeInfo.indices.length,
                firstKeyframes: keyframeInfo.indices.slice(0, 5),
                lastKeyframes: keyframeInfo.indices.slice(-5),
                keyframesAroundTarget: keyframeInfo.indices.filter(k => Math.abs(k - targetFrameIndex) <= 100)
              })
            } else {
              // 回退到基于时间的计算
              const framesBefore = Math.floor((beforeMs / 1000) * estimatedFps)
              const framesAfter = Math.floor((afterMs / 1000) * estimatedFps)
              startFrame = Math.max(0, targetFrameIndex - framesBefore)
              const endFrame = Math.min(globalTotalFrames - 1, targetFrameIndex + framesAfter)
              frameCount = endFrame - startFrame + 1

              console.log('[progress] Parent component - time-based window:', {
                targetFrameIndex,
                framesBefore,
                framesAfter,
                startFrame,
                frameCount
              })
            }

            // 🔧 使用帧范围请求
            if (frameCount > 0 && startFrame < globalTotalFrames) {
              console.log('[progress] Using optimized frame range request')
              workerCurrentWorker.postMessage({
                type: 'getRange',
                start: startFrame,
                count: frameCount
              })
            } else {
              console.log('[progress] Falling back to time range request')
              workerCurrentWorker.postMessage({
                type: 'getWindowByTime',
                centerMs,
                beforeMs,
                afterMs
              })
            }
          }}
          fetchWindowData={fetchWindowData}
          className="worker-video-preview w-full h-full"
        />
      </div>

      <!-- {#if workerEncodedChunks.length > 0}
        <div class="absolute bottom-6 left-6 flex items-center gap-2 px-3 py-2 bg-blue-500/20 border border-blue-400/30 rounded-lg text-sm text-blue-200 backdrop-blur-sm">
          <Activity class="w-4 h-4" />
          <span>已收集 {workerEncodedChunks.length} 个编码块</span>
        </div>
      {/if} -->
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
          totalFramesAll={globalTotalFrames}
          opfsDirId={opfsDirId}
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

