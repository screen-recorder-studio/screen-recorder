<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { HardDrive, Video } from '@lucide/svelte'

  import { recordingStore } from '$lib/stores/recording.svelte'
  import VideoPreviewComposite from '$lib/components/VideoPreviewComposite.svelte'
  import VideoExportPanel from '$lib/components/VideoExportPanel.svelte'
  import BackgroundColorPicker from '$lib/components/BackgroundColorPicker.svelte'
  import BorderRadiusControl from '$lib/components/BorderRadiusControl.svelte'
  import PaddingControl from '$lib/components/PaddingControl.svelte'
  import AspectRatioControl from '$lib/components/AspectRatioControl.svelte'
  import ShadowControl from '$lib/components/ShadowControl.svelte'

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

	  // Derived source FPS based on global total frames and duration
	  const sourceFps = $derived(
	    globalTotalFrames > 0 && durationMs > 0
	      ? Math.max(1, Math.round(globalTotalFrames / (durationMs / 1000)))
	      : 30
	  )


  // 🔧 智能窗口管理：关键帧信息
  let keyframeInfo = $state<{
    indices: number[]
    timestamps: number[]
    count: number
    avgInterval: number
  } | null>(null)



  // 预览容器尺寸测量（确保时间轴可见、画布自适应）
  let previewContainerEl: HTMLDivElement | null = null
  let previewDisplayW = $state(0)
  let previewDisplayH = $state(0)
  let resizeObserver: ResizeObserver | null = null


  const workerStatus = $derived(recordingStore.state.status)

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




    // 测量预览容器实际尺寸，驱动自适应布局（确保时间轴始终可见）
    try {
      if (previewContainerEl) {
        const rect = previewContainerEl.getBoundingClientRect()
        previewDisplayW = Math.floor(rect.width)
        previewDisplayH = Math.floor(rect.height)
        resizeObserver = new ResizeObserver((entries) => {
          const cr = entries[0]?.contentRect
          if (cr) {
            previewDisplayW = Math.floor(cr.width)
            previewDisplayH = Math.floor(cr.height)
          }
        })
        resizeObserver.observe(previewContainerEl)
      }
    } catch (e) {
      console.warn('[layout] ResizeObserver setup failed:', e)
    }

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
      try { resizeObserver?.disconnect?.() } catch {}
      resizeObserver = null
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

      // 计算期望的帧范围：与 onRequestWindow 保持一致的“前关键帧对齐”（保证连续播放不漏帧）
      const estimatedFps = 30
      const targetFrameIndex = Math.floor((centerMs / 1000) * estimatedFps)
      let startFrame: number
      let frameCount: number

      if (keyframeInfo && keyframeInfo.indices.length > 0) {
        // 连续播放/预取：选择最后一个 <= target 的关键帧，确保不会跳过 target 之前的帧
        let prevKeyframeIndex = keyframeInfo.indices[0]
        for (let i = 0; i < keyframeInfo.indices.length; i++) {
          const k = keyframeInfo.indices[i]
          if (k <= targetFrameIndex) prevKeyframeIndex = k
          else break
        }
        startFrame = Math.max(0, prevKeyframeIndex)
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
  <title>Screen Recording Studio</title>
</svelte:head>

<div class="flex h-screen bg-gray-50">
  <!-- Left main preview player - no scrolling, full height 100vh -->
  <div class="flex-1 min-h-0 flex flex-col h-full overflow-hidden">
    <!-- Preview area header -->
    <div class="flex-shrink-0 p-6 border-b border-gray-200 bg-white">
      <div class="flex items-center justify-between relative">
        <!-- Left title -->
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <Video class="w-6 h-6 text-blue-600" />
            <h1 class="text-xl font-bold text-gray-800">Screen Recorder Studio</h1>
          </div>
          <span class="px-2 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold rounded-full shadow-sm">
            PRO TRIAL
          </span>
        </div>

        <!-- Center video aspect ratio control -->
        <div class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <AspectRatioControl />
        </div>

        <!-- Right Drive button -->
        <button
          class="p-2 rounded-lg border border-gray-300 hover:border-blue-400 hover:bg-white/70 hover:shadow-sm transition-all duration-200 group"
          onclick={() => window.open('/drive.html', '_blank')}
          title="Open Recording File Manager"
        >
          <HardDrive class="w-5 h-5 text-gray-600 group-hover:text-blue-600 transition-colors duration-200" />
        </button>
      </div>
    </div>

    <!-- Preview player content area -->
    <div class="flex-1 min-h-0 flex flex-col relative">
      <!-- Using new VideoPreviewComposite component -->
      <div class="flex-1 min-h-0 flex items-stretch justify-center" bind:this={previewContainerEl}>
        <VideoPreviewComposite
          encodedChunks={workerEncodedChunks}
          isRecordingComplete={workerStatus === 'completed' || workerStatus === 'idle'}
          displayWidth={previewDisplayW}
          displayHeight={previewDisplayH}
          showControls={true}
          showTimeline={true}
          durationMs={durationMs}
          windowStartMs={windowStartMs}
          windowEndMs={windowEndMs}
          totalFramesAll={globalTotalFrames}
          windowStartIndex={windowStartIndex}
          keyframeInfo={keyframeInfo}
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
              // 🔧 使用关键帧信息进行连续播放窗口切换（前关键帧对齐）：选择最后一个 <= target 的关键帧，确保不漏帧
              let prevKeyframeIndex = keyframeInfo.indices[0]
              for (let i = 0; i < keyframeInfo.indices.length; i++) {
                const k = keyframeInfo.indices[i]
                if (k <= targetFrameIndex) prevKeyframeIndex = k
                else break
              }

              // 基于关键帧间隔计算合适的窗口大小
              const avgKeyframeInterval = keyframeInfo.avgInterval || 30
              const windowSize = Math.min(120, Math.max(60, avgKeyframeInterval * 2)) // 2-4个关键帧间隔

              startFrame = Math.max(0, prevKeyframeIndex)
              frameCount = Math.min(windowSize, globalTotalFrames - startFrame)

              console.log('[progress] Parent component - keyframe-based window (prev):', {
                targetFrameIndex,
                prevKeyframeIndex,
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

            // Guard: 在连续播放路径（beforeMs === 0）下，若起点不比当前窗口更靠后，则忽略请求，避免尾端自我重复
            if (beforeMs === 0 && startFrame <= windowStartIndex) {
              console.log('[progress] Ignoring non-forward window request (startFrame<=current):', { startFrame, windowStartIndex, beforeMs })
              return
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
    </div>
  </div>

  <!-- Right editing panel - allows scrolling -->
  <div class="w-100 bg-white border-l border-gray-200 flex flex-col h-full">
    <!-- Editing panel header -->
    <div class="flex-shrink-0 p-6 border-b border-gray-200">
      <VideoExportPanel
          encodedChunks={workerEncodedChunks}
          isRecordingComplete={workerStatus === 'completed' || workerStatus === 'idle'}
          totalFramesAll={globalTotalFrames}
          opfsDirId={opfsDirId}
          sourceFps={sourceFps}
          className="export-panel"
        />
    </div>

    <!-- Scrollable editing content area -->
    <div class="flex-1 overflow-y-auto">
      <div class="p-6 space-y-6">
        <!-- Video configuration blocks -->

        <!-- Background color selection -->
          <div class="col-span-2 lg:col-span-1">
            <BackgroundColorPicker />
          </div>

          <!-- Border radius configuration -->
          <div>
            <BorderRadiusControl />
          </div>

          <!-- Padding configuration -->
          <div>
            <PaddingControl />
          </div>

          <!-- Video aspect ratio configuration -->
          <div class="col-span-2 lg:col-span-1">
            <!-- <AspectRatioControl /> -->
          </div>

          <!-- Shadow configuration -->
          <div class="col-span-2 lg:col-span-1">
            <ShadowControl />
          </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* Custom animation classes */
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

