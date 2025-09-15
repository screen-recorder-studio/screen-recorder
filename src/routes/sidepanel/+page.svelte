<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { TriangleAlert } from '@lucide/svelte'

  // 引入 Worker 系统
  import { recordingService } from '$lib/services/recording-service'
  import { recordingStore } from '$lib/stores/recording.svelte'
  import RecordButton from '$lib/components/RecordButton.svelte'
  import ElementRegionSelector from '$lib/components/ElementRegionSelector.svelte'
  import { elementRecordingIntegration, type ElementRecordingData } from '$lib/utils/element-recording-integration'
  import { recordingCache } from '$lib/services/recording-cache'
  import { recordingModeStore } from '$lib/stores/recording-mode.svelte'
  import { sendToBackground } from '$lib/utils/background'

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



  // ========= OPFS Writer (feature-flagged) =========
  const OPFS_WRITER_ENABLED = true // set true to enable OPFS side-write (dev only)
  let opfsWriter: Worker | null = null
  let opfsWriterReady = false
  let opfsSessionId: string | null = null
  let lastWorkerConfiguredConfig: any = null

  function ensureOpfsSessionId() {
    if (!opfsSessionId) opfsSessionId = `${Date.now()}`
    return opfsSessionId
  }

  async function initOpfsWriter(meta: { codec?: string; width?: number; height?: number; fps?: number }) {
    if (!OPFS_WRITER_ENABLED) return
    try {
      if (opfsWriter) return
      opfsWriterReady = false
      opfsWriter = new Worker(
        new URL('../../lib/workers/opfs-writer-worker.ts', import.meta.url),
        { type: 'module' }
      )
      const id = ensureOpfsSessionId()
      opfsWriter.onmessage = (ev: MessageEvent) => {
        const { type, id: rid } = ev.data || {}
        if (type === 'ready') {
          console.log('[OPFS] writer ready for', rid)
          opfsWriterReady = true
        } else if (type === 'progress') {
          const { bytesWrittenTotal, chunksWritten } = ev.data
          if (chunksWritten % 200 === 0) console.log('[OPFS] progress', { bytesWrittenTotal, chunksWritten })
        } else if (type === 'error') {
          console.warn('[OPFS] writer error', ev.data)
        } else if (type === 'finalized') {
          console.log('[OPFS] writer finalized for', rid)
        }
      }
      opfsWriter.postMessage({ type: 'init', id, meta })
    } catch (e) {
      console.warn('[OPFS] init failed (feature disabled or env unsupported):', e)
      opfsWriter = null
      opfsWriterReady = false
    }
  }

  function appendToOpfsFromEncodedChunk(d: { data: Uint8Array; timestamp?: number; type?: string; codedWidth?: number; codedHeight?: number; codec?: string }) {
    if (!OPFS_WRITER_ENABLED || !opfsWriter || !opfsWriterReady) return
    try {
      // Do NOT transfer the same buffer because we still need it for IndexedDB handoff
      const copy = new Uint8Array(d.data.byteLength)
      copy.set(d.data)
      opfsWriter.postMessage({
        type: 'append',
        buffer: copy.buffer,
        timestamp: d.timestamp || 0,
        chunkType: d.type === 'key' ? 'key' : 'delta',
        codedWidth: d.codedWidth,
        codedHeight: d.codedHeight,
        codec: d.codec,
        isKeyframe: d.type === 'key'
      }, [copy.buffer])
    } catch (e) {
      console.warn('[OPFS] append failed', e)
    }
  }

  async function finalizeOpfsWriter() {
    if (!OPFS_WRITER_ENABLED || !opfsWriter) return
    const writer = opfsWriter
    try {
      await new Promise<void>((resolve) => {
        let settled = false
        const onMsg = (ev: MessageEvent) => {
          const t = (ev.data || {}).type
          if (t === 'finalized' || t === 'error') {
            if (!settled) { settled = true; try { writer.removeEventListener('message', onMsg as any) } catch {}; resolve() }
          }
        }
        try { writer.addEventListener('message', onMsg as any) } catch {}
        try { writer.postMessage({ type: 'finalize' }) } catch {}
        // safety timeout
        setTimeout(() => { if (!settled) { settled = true; try { writer.removeEventListener('message', onMsg as any) } catch {}; resolve() } }, 1500)
      })
    } catch (e) {
      console.warn('[OPFS] finalize failed', e)
    } finally {
      try { writer.terminate() } catch {}
      if (opfsWriter === writer) { opfsWriter = null; opfsWriterReady = false; opfsSessionId = null }
    }
  }


	  // 跳转提示
	  let showHandoffNotice = $state(false)
	  let handoffText = $state('将转到 Studio 中...')


	  // 避免重复触发 handoff 的保护标记
	  let handoffInProgress = $state(false)


  // Worker 系统的计算属性
  const workerIsRecording = $derived(recordingStore.isRecording)
  const workerStatus = $derived(recordingStore.state.status)
  const workerErrorMessage = $derived(recordingStore.state.error)


  // Worker 系统函数 - 正确的 WebCodecs 架构
  async function startWorkerRecording() {
    try {
      console.log('🎬 [WORKER-MAIN] Starting Worker recording with WebCodecs...')

      // 1. 获取媒体流（主线程）
      console.log('📺 [WORKER-MAIN] Step 1: Requesting desktop capture...')
      const streamId = await requestDesktopCapture()
      if (!streamId) {
        throw new Error('DESKTOP_CAPTURE_CANCELLED')
      }
      console.log('✅ [WORKER-MAIN] Desktop capture granted, streamId:', streamId)

      console.log('🎥 [WORKER-MAIN] Step 2: Getting MediaStream from streamId...')
      const stream = await getUserMediaFromStreamId(streamId)
      if (!stream) {
        throw new Error('无法获取媒体流')
      }
      console.log('✅ [WORKER-MAIN] MediaStream obtained:', {
        id: stream.id,
        active: stream.active,
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length
      })

      // 2. 检查 WebCodecs 支持
      console.log('✅ [WORKER-MAIN] VideoEncoder available')

      // 3. 创建 MediaStreamTrackProcessor（主线程）
      console.log('🎞️ [WORKER-MAIN] Step 4: Creating MediaStreamTrackProcessor...')
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) {
        throw new Error('No video track found')
      }
      console.log('✅ [WORKER-MAIN] Video track found:', {
        id: videoTrack.id,
        kind: videoTrack.kind,
        label: videoTrack.label,
        enabled: videoTrack.enabled,
        readyState: videoTrack.readyState
      })

      console.log('✅ [WORKER-MAIN] MediaStreamTrackProcessor available')

      const processor = new MediaStreamTrackProcessor({ track: videoTrack })
      const reader = processor.readable.getReader()
      console.log('✅ [WORKER-MAIN] MediaStreamTrackProcessor created and reader obtained')

      // 4. 创建 Worker 进行 WebCodecs 编码
      console.log('👷 [WORKER-MAIN] Step 5: Creating WebCodecs Worker...')
      const worker = new Worker(
        new URL('../../lib/workers/webcodecs-worker.ts', import.meta.url),
        { type: 'module' }
      )
      console.log('✅ [WORKER-MAIN] Worker created successfully')

      // 5. 等待 Worker 配置完成的 Promise
      let workerConfigured = false
      let workerInitialized = false

      const workerReadyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('❌ [WORKER-MAIN] Worker configuration timeout after 10 seconds')
          console.error('❌ [WORKER-MAIN] Worker initialized:', workerInitialized)
          console.error('❌ [WORKER-MAIN] Worker configured:', workerConfigured)
          reject(new Error('Worker configuration timeout'))
        }, 10000) // 10秒超时

        worker.onmessage = (event) => {
          console.log('📨 [WORKER-MAIN] Received Worker message during setup:', event.data)

          if (event.data.type === 'initialized') {
            console.log('✅ [WORKER-MAIN] Worker initialized successfully')
            workerInitialized = true
          } else if (event.data.type === 'configured') {
            console.log('✅ [WORKER-MAIN] Worker configuration confirmed')
            workerConfigured = true
            // 保存实际配置，并在此时初始化 OPFS 写入（避免后续 handler 错过 configured 事件）
            const cfg = event.data.config
            lastWorkerConfiguredConfig = cfg
            if (OPFS_WRITER_ENABLED) {
              try {
                initOpfsWriter({
                  codec: cfg?.codec,
                  width: cfg?.width,
                  height: cfg?.height,
                  fps: cfg?.framerate
                })
              } catch (e) {
                console.warn('[OPFS] init during setup failed:', e)
              }
            }
            clearTimeout(timeout)
            resolve()
            // 配置完成后，设置正常的消息处理器
            setupWorkerMessageHandler(worker)
          } else if (event.data.type === 'error') {
            console.error('❌ [WORKER-MAIN] Worker error during setup:', event.data.data)
            clearTimeout(timeout)
            reject(new Error(`Worker setup error: ${event.data.data}`))
          }
        }

        worker.onerror = (error) => {
          console.error('❌ [WORKER-MAIN] Worker error event during setup:', error)
          clearTimeout(timeout)
          reject(new Error(`Worker error: ${error.message || 'Unknown error'}`))
        }
      })

      // 6. 配置 Worker
      // 依据采集轨道的自然尺寸配置编码器，避免拉伸变形
      const trackSettings = videoTrack.getSettings ? videoTrack.getSettings() : {}
      console.log('📐 [WORKER-MAIN] Track settings:', trackSettings)

      // 更可靠的尺寸获取策略
      let encoderWidth = 1920
      let encoderHeight = 1080

      // 策略1: 从 track settings 获取
      if (trackSettings?.width && trackSettings?.height) {
        encoderWidth = trackSettings.width
        encoderHeight = trackSettings.height
        console.log('✅ [WORKER-MAIN] Using track settings dimensions:', { encoderWidth, encoderHeight })
      } else {
        // 策略2: 从 track constraints 获取
        const constraints = videoTrack.getConstraints ? videoTrack.getConstraints() : {}
        console.log('📐 [WORKER-MAIN] Track constraints:', constraints)

        if (constraints?.width && constraints?.height) {
          encoderWidth = typeof constraints.width === 'object' ? constraints.width.ideal || constraints.width.max || 1920 : constraints.width
          encoderHeight = typeof constraints.height === 'object' ? constraints.height.ideal || constraints.height.max || 1080 : constraints.height
          console.log('✅ [WORKER-MAIN] Using track constraints dimensions:', { encoderWidth, encoderHeight })
        } else {
          console.warn('⚠️ [WORKER-MAIN] No reliable dimensions found, using defaults:', { encoderWidth, encoderHeight })
        }
      }

      // 验证尺寸合理性
      if (encoderWidth < 100 || encoderHeight < 100 || encoderWidth > 7680 || encoderHeight > 4320) {
        console.warn('⚠️ [WORKER-MAIN] Invalid dimensions detected, using safe defaults')
        encoderWidth = 1920
        encoderHeight = 1080
      }

      const encoderFps = Math.round(trackSettings?.frameRate || 30)

      const workerConfig = {
        codec: 'vp9',
        width: encoderWidth,
        height: encoderHeight,
        bitrate: 8000000,
        framerate: encoderFps
      }
      console.log('⚙️ [WORKER-MAIN] Step 6: Configuring Worker with:', workerConfig)
      worker.postMessage({
        type: 'configure',
        config: workerConfig
      })

      // 7. 等待配置完成
      console.log('⏳ [WORKER-MAIN] Waiting for Worker configuration...')
      await workerReadyPromise
      console.log('✅ [WORKER-MAIN] Worker is ready for encoding!')

      // 8. 传递 VideoFrame 到 Worker（只在配置完成后）
      let frameCount = 0
      const processFrames = async () => {
        try {
          console.log('🎞️ [WORKER-MAIN] Step 8: Starting frame processing loop...')

          // 确保 Worker 已配置
          if (!workerConfigured) {
            console.warn('⚠️ [WORKER-MAIN] Worker not configured yet, waiting...')
            await workerReadyPromise
          }

          console.log('✅ [WORKER-MAIN] Worker is ready, starting frame processing')

          // 与元素/区域录制一致：首帧 + 每 2 秒关键帧
          let frameIndex = 0
          while (true) {
            const { done, value: frame } = await reader.read()
            if (done) {
              console.log('🏁 [WORKER-MAIN] Frame reading completed, total frames:', frameCount)
              // 通知 Worker 停止编码
              worker.postMessage({ type: 'stop' })
              break
            }

            // 统计帧
            frameCount++
            if (frameCount % 30 === 0) { // 每秒日志一次（假设30fps）
              console.log(`📊 [WORKER-MAIN] Processing frame ${frameCount}, timestamp: ${frame.timestamp}`)
            }

            // 关键帧策略：首帧或每 2 秒强制关键帧
            const keyFrame = frameIndex === 0 || (frameIndex % (encoderFps * 2) === 0)

            // 传递 VideoFrame 到 Worker（Transferable Object）
            worker.postMessage({
              type: 'encode',
              frame: frame,
              keyFrame
            }, [frame])

            frameIndex++
          }
        } catch (error) {
          console.error('❌ [WORKER-MAIN] Frame processing error:', error)
        }
      }

      // 7. 设置 Worker 消息处理器的函数
      function setupWorkerMessageHandler(worker: Worker) {
        console.log('📡 [WORKER-MAIN] Setting up Worker message listener...')
        worker.onmessage = (event) => {
          const { type, data, config } = event.data
          console.log(`📨 [WORKER-MAIN] Received message from Worker:`, { type, data: data ? 'present' : 'none' })

          switch (type) {
            case 'configured':
              console.log('✅ [WORKER-MAIN] Worker configured successfully:', config)
              // Store actual configured config from worker
              lastWorkerConfiguredConfig = config
              // Initialize OPFS writer (feature-flagged)
              if (OPFS_WRITER_ENABLED) {
                initOpfsWriter({
                  codec: config?.codec,
                  width: config?.width,
                  height: config?.height,
                  fps: config?.framerate
                })
              }
              break
            case 'chunk':
              // 处理编码后的数据块
              console.log(`📦 [WORKER-MAIN] Received encoded chunk:`, {
                size: data.size,
                timestamp: data.timestamp,
                type: data.type,
                totalChunks: data.totalChunks
              })

              // 收集编码数据块
              if (data.data) {
                workerEncodedChunks.push({
                  data: data.data,
                  timestamp: data.timestamp,
                  type: data.type,
                  size: data.size,
                  // 添加分辨率信息（如果可用）
                  codedWidth: data.codedWidth || 1920,
                  codedHeight: data.codedHeight || 1080
                })
                console.log(`💾 [WORKER-MAIN] Collected chunk ${workerEncodedChunks.length}, total size: ${workerEncodedChunks.reduce((sum, chunk) => sum + chunk.size, 0)} bytes`)
                // Side-write to OPFS (does not transfer the same buffer)
                try { appendToOpfsFromEncodedChunk(data) } catch {}
              }
              break
            case 'complete':
              // 录制完成
              console.log('🎉 [WORKER-MAIN] Worker recording completed successfully!')
              break
            case 'error':
              console.error('❌ [WORKER-MAIN] Worker encoding error:', data)
              workerEnvironmentIssues = [data || 'Worker 编码错误']
              break
            default:
              console.warn('⚠️ [WORKER-MAIN] Unknown message type from Worker:', type)
          }
        }

        // Worker 错误处理
        worker.onerror = (error) => {
          console.error('❌ [WORKER-MAIN] Worker error:', error)
          workerEnvironmentIssues = ['Worker 运行错误']
        }
      }

      // 9. 开始处理帧
      console.log('🚀 [WORKER-MAIN] Step 9: Starting frame processing...')

      // 初始化录制状态
      workerEncodedChunks = [] // 清空之前的数据
      workerCurrentWorker = worker

      // 更新录制状态到 store（这样UI会更新）
      recordingStore.updateStatus('recording')
      recordingStore.setEngine('webcodecs')

      processFrames()

      workerSystemReady = true
      console.log('🎉 [WORKER-MAIN] ✅ Worker recording started successfully with WebCodecs!')
      console.log('📊 [WORKER-MAIN] System status: Ready for high-performance recording')

    } catch (error) {
      console.error('❌ [WORKER-MAIN] Worker recording failed:', error)
      workerEnvironmentIssues = [(error as Error).message || '录制失败']
    }
  }


  async function stopWorkerRecording() {
    try {
      console.log('🛑 Stopping Worker recording...')

      // 停止 Worker 录制
      if (workerCurrentWorker) {
        workerCurrentWorker.postMessage({ type: 'stop' })
      }

      // 更新录制状态
      recordingStore.updateStatus('stopping')

      // 处理收集到的编码数据
      console.log(`📊 [WORKER-MAIN] Recording stopped. Collected ${workerEncodedChunks.length} chunks`)
      const totalSize = workerEncodedChunks.reduce((sum, chunk) => sum + chunk.size, 0)
      console.log(`📊 [WORKER-MAIN] Total encoded data size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)

      if (workerEncodedChunks.length > 0) {
        try {
          // 标记完成状态
          recordingStore.updateStatus('completed')

          // 显示跳转提示
          console.log('🔄 [WORKER-MAIN] 录制完成，正在保存并跳转到 Studio...')

          // 自动跳转到 Studio
          await openInStudio()
        } catch (error) {
          console.error('❌ Failed to handoff to Studio page:', error)
        }
      } else {
        console.warn('⚠️ No encoded chunks to save')
        recordingStore.updateStatus('error', 'No encoded chunks to save')
      }

      // 清理 Worker 引用
      workerCurrentWorker = null


	      // Finalize OPFS writer if enabled
	      await finalizeOpfsWriter()

    } catch (error) {
      console.error('❌ Worker stop failed:', error)
    }
  }

  async function checkWorkerEnvironment() {
    try {
      const env = await recordingService.checkEnvironment()
      workerSystemReady = env.isReady
      workerEnvironmentIssues = env.issues
      console.log('🔍 Worker environment check:', env)
      return env.isReady
    } catch (error) {
      console.error('❌ Worker environment check failed:', error)
      workerSystemReady = false
      workerEnvironmentIssues = ['Worker 环境检查失败']
      return false
    }
  }

  // 处理元素录制数据
  async function handleElementRecordingData(message: any) {
    try {

      if (!message.encodedChunks || message.encodedChunks.length === 0) {
        console.warn('⚠️ [Sidepanel] No encoded chunks in element recording data')
        return
      }

      // 验证数据格式
      const firstChunk = message.encodedChunks[0];
      if (!Array.isArray(firstChunk.data)) {
        console.warn('⚠️ [Sidepanel] Unexpected data format, expected array');
      }

      // 预标准化：确保 chunk.data 为 Uint8Array、补全尺寸/时间戳
      const normalizedMeta = {
        ...(message.metadata || {}),
        mode: (message.metadata?.mode) || (message.metadata?.selectedRegion ? 'region' : 'element'),
        source: (message.metadata?.source) || 'element-recording'
      };
      const normalizedChunks = (message.encodedChunks || []).map((c: any) => {
        let data: any = c?.data;
        if (!(data instanceof Uint8Array)) {
          if (data instanceof ArrayBuffer) data = new Uint8Array(data);
          else if (Array.isArray(data)) data = new Uint8Array(data);
          else data = new Uint8Array(0);
        }
        const size = (typeof c?.size === 'number' && c.size > 0) ? c.size : (data?.byteLength || 0);
        const ts = (typeof c?.timestamp === 'number') ? c.timestamp : 0;
        return {
          data,
          timestamp: ts,
          type: c?.type === 'key' ? 'key' : 'delta',
          size,
          codedWidth: normalizedMeta.selectedRegion?.width,
          codedHeight: normalizedMeta.selectedRegion?.height,
          codec: c?.codec || normalizedMeta.codec || 'vp8'
        };
      });

      // 使用集成工具处理数据（已标准化）
      const recordingData: ElementRecordingData = {
        encodedChunks: normalizedChunks,
        metadata: normalizedMeta
      }

      // 通过集成工具处理
      elementRecordingIntegration.handleRecordingData(recordingData)

      // 将元素录制数据设置到主系统
      workerEncodedChunks = recordingData.encodedChunks

	    try {
        console.log('[Handoff][Sidepanel] calling openInStudio with chunks', workerEncodedChunks?.length)

        await openInStudio()
      } catch (e) {
        console.error('\u274c [Sidepanel] Auto handoff to Studio failed:', e)
      }

      // 更新录制状态为完成
      recordingStore.updateStatus('completed')
      recordingStore.setEngine('webcodecs')

      console.log('✅ [Sidepanel] Element recording data integrated successfully')

      // 显示成功通知
      const summary = elementRecordingIntegration.getRecordingSummary(recordingData)
      showIntegrationNotification(message.metadata, summary)

    } catch (error) {
      console.error('❌ [Sidepanel] Error handling element recording data:', error)
    }
  }

  // 处理元素录制就绪通知
  function handleElementRecordingReady(data: any) {
    try {
      console.log('🎬 [Sidepanel] Element recording ready notification:', data)

      if (data?.encodedChunks) {
        handleElementRecordingData(data)
      }
    } catch (error) {
      console.error('❌ [Sidepanel] Error handling element recording ready:', error)
    }
  }

  // 将当前录制数据保存并在新标签打开 Studio 页面
  async function openInStudio() {
    try {
      console.log('[Handoff][Sidepanel] openInStudio entered', { chunks: workerEncodedChunks?.length, handoffInProgress })
      if (!workerEncodedChunks || workerEncodedChunks.length === 0) {
        console.warn('⚠️ [Sidepanel] No chunks to handoff to Studio')
        return
      }
      if (handoffInProgress) {
        console.warn('⏳ [Sidepanel] Handoff already in progress', { chunks: workerEncodedChunks?.length })
        return
      }
      handoffInProgress = true
      const totalSize = workerEncodedChunks.reduce((s, c) => s + (c.size || 0), 0)
      const first = workerEncodedChunks[0] || {}
      // Use OPFS session ID when available to keep Studio URL consistent with OPFS directory
      let id = `rec_${Date.now()}`
      if (OPFS_WRITER_ENABLED && opfsSessionId) {
        id = `rec_${opfsSessionId}`
      }
      const meta = {
        width: first.codedWidth || 1920,
        height: first.codedHeight || 1080,
        fps: 30,
        codec: first.codec || 'vp9',
        engine: 'webcodecs',
        totalChunks: workerEncodedChunks.length,
        totalSize
      }
      console.log('💾 [Sidepanel] Saving recording to IndexedDB...', { id, meta })

      // await recordingCache.save(id, workerEncodedChunks, meta)

      // 打开扩展根目录下的 studio.html（按需加载 id）
      const targetUrl = (typeof chrome !== 'undefined' && chrome.runtime)
        ? chrome.runtime.getURL(`studio.html?id=${encodeURIComponent(id)}`)
        : `/studio.html?id=${encodeURIComponent(id)}`
      console.log('🧭 [Sidepanel] Opening Studio URL:', targetUrl)

      // 显示“将转到 Studio 中...”提示
      showHandoffNotice = true

      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
        chrome.tabs.create({ url: targetUrl }, () => {
          const err = chrome.runtime.lastError
          if (err) {
            console.error('❌ [Sidepanel] chrome.tabs.create failed:', err.message)
            // 失败则保留当前编辑态，提示仍显示片刻后隐藏
            setTimeout(() => { showHandoffNotice = false; handoffInProgress = false }, 1500)
          } else {
            console.log('✅ [Sidepanel] Studio tab opened')
            // 成功后复位 sidepanel，避免进入编辑模式
            workerEncodedChunks = []
            recordingStore.updateStatus('idle')
            showHandoffNotice = false
            handoffInProgress = false
          }
        })
      } else {
        // 非扩展环境（开发模式）回退
        window.open(targetUrl, '_blank')
        setTimeout(() => {
          workerEncodedChunks = []
          recordingStore.updateStatus('idle')
          showHandoffNotice = false
          handoffInProgress = false
        }, 300)
      }
    } catch (e) {
      console.error('❌ [Sidepanel] openInStudio failed:', e)
      showHandoffNotice = false
      handoffInProgress = false
    }
  }

  // 显示集成成功通知
  function showIntegrationNotification(metadata: any, summary?: any) {
    // 这里可以添加 UI 通知逻辑
    console.log('🎉 [Sidepanel] Element recording integrated:', {
      mode: metadata?.mode,
      element: metadata?.selectedElement,
      region: metadata?.selectedRegion,
      chunks: workerEncodedChunks.length,
      summary
    })
  }



  async function handleWorkerRecordButtonClick() {
    if (workerIsRecording) {
      await stopWorkerRecording()
    } else {
      await startWorkerRecording()
    }
  }
  // 从 ElementRegionSelector 移动过来的录制函数
  const recording = $derived(recordingModeStore.isRecording)
  const currentMode = $derived(recordingModeStore.currentMode)

  // 录制按钮显示逻辑
  const shouldShowElementRecordButton = $derived(currentMode === 'element' || currentMode === 'region')
  const shouldShowWebCodecsRecordButton = $derived(currentMode === 'tab' || currentMode === 'window' || currentMode === 'screen')

  // Element/Region 录制 UI 状态（显式准备阶段）
  let elementUIStatus = $state<'idle' | 'requesting' | 'recording' | 'stopping' | 'error' | 'completed'>('idle')

  async function handleStartCapture() {
    // 进入准备阶段，先构建必要通道/资源
    elementUIStatus = 'requesting'
    // 触发内容脚本真正开始采集
    await sendToBackground('START_CAPTURE')
  }

  async function handleStopCapture() {
    // 结束录制
    elementUIStatus = 'stopping'
    await sendToBackground('STOP_CAPTURE')
    // 回到初始状态：退出选择并清除已选
    await sendToBackground('EXIT_SELECTION')
    await sendToBackground('CLEAR_SELECTION')
    // 复位 UI 状态
    elementUIStatus = 'idle'
  }

  async function handleToggleCapture() {
    if (recording) {
      await handleStopCapture()
    } else {
      await handleStartCapture()
    }
  }





  // 处理录制错误
  function handleRecordingError(message: string) {
    errorMessage = message
    status = 'error'
    isRecording = false

    // 清理资源
    cleanup()

    // 3秒后重置错误状态
    setTimeout(() => {
      if (status === 'error') {
        status = 'idle'
        errorMessage = ''
      }
    }, 3000)
  }

  // 清理资源
  function cleanup() {
    if (mediaRecorder) {
      mediaRecorder = null
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      stream = null
    }

    recordedChunks = []
  }



  // 直接请求桌面捕获
  async function requestDesktopCapture(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!chrome?.desktopCapture) {
        reject(new Error('chrome.desktopCapture API not available'))
        return
      }

      console.log('📞 Calling chrome.desktopCapture.chooseDesktopMedia...')

      // 根据当前用户选择的模式确定 sources
      const currentSelectedMode = recordingModeStore.currentMode
      let sources: string[]

      if (currentSelectedMode === 'tab') {
        sources = ['tab']
      } else if (currentSelectedMode === 'window') {
        sources = ['window']
      } else if (currentSelectedMode === 'screen') {
        sources = ['screen']
      } else {
        // 默认情况（element/region 模式不应该调用这个函数，但作为后备）
        sources = ['screen', 'window', 'tab']
      }

      console.log('🎯 Using sources for mode:', currentSelectedMode, '→', sources)

      const requestId = chrome.desktopCapture.chooseDesktopMedia(
        sources,
        null as any, // 类型断言修复TypeScript错误
        (streamId, options) => {
          console.log('📞 Desktop capture callback:', { streamId, options })

          if (streamId) {
            console.log('✅ Desktop capture granted:', streamId)
            resolve(streamId)
          } else {
            console.log('❌ Desktop capture cancelled by user')
            reject(new Error('DESKTOP_CAPTURE_CANCELLED'))
          }
        }
      )

      console.log('📞 Desktop capture request ID:', requestId)
    })
  }

  // 从streamId获取MediaStream
  async function getUserMediaFromStreamId(streamId: string): Promise<MediaStream> {
    try {
      console.log('Getting media stream for streamId:', streamId)

      // 检查navigator.mediaDevices是否可用
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('navigator.mediaDevices.getUserMedia is not available')
      }

      // Chrome扩展的正确约束格式（回退到工作版本）
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: streamId
          }
        }
      }

      console.log('Using constraints:', constraints)
      console.log('Calling navigator.mediaDevices.getUserMedia...')

      // 使用 getUserMedia 获取媒体流
      const stream = await navigator.mediaDevices.getUserMedia(constraints as any)

      console.log('getUserMedia returned:', stream)

      if (!stream) {
        throw new Error('Failed to get media stream')
      }

      // 检查视频轨道
      const videoTracks = stream.getVideoTracks()
      if (videoTracks.length === 0) {
        throw new Error('No video tracks found in media stream')
      }

      // 检查视频轨道状态
      const videoTrack = videoTracks[0]
      if (videoTrack.readyState !== 'live') {
        throw new Error(`Video track not ready: ${videoTrack.readyState}`)
      }

      console.log('Media stream obtained successfully:', {
        id: stream.id,
        videoTracks: videoTracks.length,
        audioTracks: stream.getAudioTracks().length,
        videoTrackState: videoTrack.readyState,
        videoTrackLabel: videoTrack.label
      })

      return stream
    } catch (error) {
      console.error('Error getting media stream:', error)

      // 提供更详细的错误信息
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`AbortError: ${error.message}`)
        } else if (error.name === 'NotAllowedError') {
          throw new Error(`NotAllowedError: ${error.message}`)
        } else if (error.name === 'NotFoundError') {
          throw new Error(`NotFoundError: ${error.message}`)
        } else if (error.name === 'InvalidStateError') {
          throw new Error(`Invalid state: ${error.message}`)
        }
      }

      throw new Error(`Failed to get media stream: ${error}`)
    }
  }


  // 检查扩展环境和权限
  async function checkExtensionEnvironment() {
    try {
      // 检查Chrome扩展环境
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error('Chrome扩展环境不可用')
      }

      // 检查必要的API
      if (!chrome.runtime.sendMessage) {
        throw new Error('Chrome消息API不可用')
      }

      // 检查MediaRecorder支持
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('浏览器不支持MediaRecorder')
      }

      // 检查getUserMedia支持
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('浏览器不支持getUserMedia')
      }

      console.log('✅ Extension environment check passed')

    } catch (error) {
      console.error('❌ Extension environment check failed:', error)
      handleRecordingError(error instanceof Error ? error.message : '扩展环境检查失败')
    }
  }

  // 组件挂载时的初始化
  onMount(() => {
    console.log('📱 Sidepanel mounted with Worker system')

    // 检查扩展环境

/* LEGACY PORT BLOCK REMOVED START */
	    // 注册成为元素/区域编码流的消费者（通过 background 转发）
	    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.tabs) {
	      try {
	        /* legacy element-stream-consumer removed */

	        // 绑定当前活动标签页 id
	        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
	          const tabId = tabs?.[0]?.id
	          if (typeof tabId === 'number') {

	          }
	        })
	        // 监听转发过来的 start/meta/chunk/end
	        elementStreamPort.onMessage.addListener(async (msg: any) => {
	          switch (msg?.type) {
	            case 'start':
	              streamingChunks = []
                elementUIStatus = 'recording'
	              console.log('[Stream][Sidepanel] start received; reset chunks')
	              break
	            case 'meta':
	              streamingMeta = msg.metadata
	              console.log('[Stream][Sidepanel] meta received', { width: streamingMeta?.width, height: streamingMeta?.height, codec: streamingMeta?.codec, startTime: streamingMeta?.startTime })
	              break
	            case 'chunk': {
	              // try {
	              //   const buf: ArrayBuffer | undefined = msg.data
	              //   const view = buf
	              //   streamingChunks.push({
	              //     data: view,
	              //     timestamp: Number(msg.ts) || 0,
	              //     type: msg.kind === 'key' ? 'key' : 'delta',
	              //     size: (typeof msg.size === 'number' && msg.size > 0) ? msg.size : view.byteLength,
	              //     codedWidth: streamingMeta?.width || 1920,
	              //     codedHeight: streamingMeta?.height || 1080,
	              //     codec: streamingMeta?.codec || 'vp8'
	              //   })

	              // } catch (e) {
	              //   console.warn('[Sidepanel] failed to accumulate chunk', e)
	              // }
	              //   const n = streamingChunks.length
	              //   if (n <= 3 || n % 100 === 0) {
	              //     console.log('[Stream][Sidepanel] chunk received', { count: n, kind: msg.kind, size: msg.size })
	              //   }

	              break
	            }
	            case 'end':
	              console.log('[Stream][Sidepanel] end received', { chunks: streamingChunks.length, hasMeta: !!streamingMeta })

                elementUIStatus = 'completed';
                openInStudio();

	              // // 使用与“大包”一致的数据结构进行处理
	              // if (streamingChunks.length > 0) {

		            //   // finalize OPFS for element/region stream
		            //   // try { await finalizeOpfsWriter() } catch (e) { console.warn('[OPFS] finalize (element-stream) failed', e) }

	              //   handleElementRecordingData({ encodedChunks: streamingChunks, metadata: streamingMeta })
                //   elementUIStatus = 'completed'

	              // }
	              // streamingChunks = []


	              // streamingMeta = null
	              // break
	            default:
	              break
	          }
	        })
	      } catch (e) {
	        console.warn('element-stream-consumer connect failed', e)
	      }
/* LEGACY PORT BLOCK REMOVED END */
	    }

    checkExtensionEnvironment()

    // 检查 Worker 环境
    checkWorkerEnvironment()

    // 设置元素录制集成监听器
    const elementRecordingListener = (data: ElementRecordingData) => {
      console.log('🎬 [Sidepanel] Element recording integration callback:', data)

      // 转换并设置数据
      const compatibleChunks = elementRecordingIntegration.convertToMainSystemFormat(data)
      workerEncodedChunks = compatibleChunks

      // 更新状态
      recordingStore.updateStatus('completed')
      recordingStore.setEngine('webcodecs')

      // 获取摘要
      const summary = elementRecordingIntegration.getRecordingSummary(data)
      console.log('📊 [Sidepanel] Recording summary:', summary)
    }

    elementRecordingIntegration.onDataReceived(elementRecordingListener)

    // 监听来自background/contentscript的消息
    const messageListener = (message: any) => {
      if (message.action === 'downloadComplete') {
        console.log('✅ Download completed:', message.downloadId)
      } else if (message.type === 'ELEMENT_RECORDING_DATA') {
        // 处理元素录制数据
        handleElementRecordingData(message)
      } else if (message.type === 'ELEMENT_RECORDING_READY') {
        // 处理元素录制就绪通知
        handleElementRecordingReady(message.data)
      } else if (message.type === 'CAPTURE_FAILED') {
        console.warn('❌ [Sidepanel] Capture failed:', message.error)
        // 如果 UI 正处于请求中，回退到 idle
        if (elementUIStatus === 'requesting') elementUIStatus = 'idle'
      } else if (message.type === 'STATE_UPDATE') {
        // 仅在“请求中”时使用它来解除卡死
        if (elementUIStatus === 'requesting') {
          const rec = !!message.state?.recording
          // 如果后台未进入 recording，则回退到 idle
          if (!rec) elementUIStatus = 'idle'
        }
      } else if (message.type === 'STREAM_START') {
        elementUIStatus = 'recording'
      } else if (message.type === 'STREAM_END') {
        // 由 background 在 OPFS_RECORDING_READY 时打开 Studio；这里仅复位按钮
        elementUIStatus = 'idle'
      }
    }

    if (typeof chrome !== 'undefined' && chrome.runtime) {

      chrome.runtime.onMessage.addListener(messageListener)
    }

    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.removeListener(messageListener)
      }
      // 清理元素录制监听器
      elementRecordingIntegration.removeListener(elementRecordingListener)
    }
  })

  // 组件销毁时清理
  onDestroy(() => {
    console.log('📱 Sidepanel unmounted, cleaning up...')
    cleanup()
  })
</script>

<svelte:head>
  <title>屏幕录制</title>
</svelte:head>

<!-- 录制面板（无 mini 模式） -->
  <div class="flex flex-col items-center justify-center min-h-screen p-4 bg-gradient-to-br from-gray-50 to-gray-100 transition-all duration-300 ease-in-out">
{#if showHandoffNotice}
  <div class="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs shadow-lg">
    {handoffText}
  </div>
{/if}

    <!-- 简化的页面标题 -->
    <div class="text-center mb-8 animate-fade-in">
      <h1 class="text-2xl font-bold text-gray-800 mb-1 transition-colors duration-200">屏幕录制工具</h1>
      <p class="text-sm text-gray-600 transition-colors duration-200">高性能 WebCodecs 录制引擎</p>
    </div>

    <!-- 元素/区域选择面板 -->
    <div class="max-w-md w-full mb-6">
      <ElementRegionSelector />
    </div>

    <!-- 录制控制按钮 -->
    {#if shouldShowElementRecordButton}
      <!-- Element/Region 录制按钮 -->
      <div class="max-w-md w-full mb-6">
        <RecordButton
          isRecording={recording}
          status={elementUIStatus}
          onclick={handleToggleCapture}
        />
      </div>
    {:else if shouldShowWebCodecsRecordButton}
      <!-- Tab/Window/Screen 录制按钮 -->
      <div class="max-w-md w-full mb-6">
        <RecordButton
          isRecording={workerIsRecording}
          status={workerStatus}
          onclick={handleWorkerRecordButtonClick}
        />
      </div>
    {/if}

      <!-- 错误信息显示 -->
      {#if workerErrorMessage || workerEnvironmentIssues.length > 0}
        <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          {#if workerErrorMessage}
            <div class="flex items-start gap-2 mb-2">
              <TriangleAlert class="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <div class="text-sm font-medium text-red-800">录制错误</div>
                <div class="text-xs text-red-600 mt-1">{workerErrorMessage}</div>
              </div>
            </div>
          {/if}

          {#if workerEnvironmentIssues.length > 0}
            <div class="flex items-start gap-2">
              <TriangleAlert class="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <div class="text-sm font-medium text-red-800">环境问题</div>
                <ul class="text-xs text-red-600 mt-1 space-y-1">
                  {#each workerEnvironmentIssues as issue}
                    <li class="flex items-center gap-1">
                      <div class="w-1 h-1 bg-red-400 rounded-full"></div>
                      {issue}
                    </li>
                  {/each}
                </ul>
              </div>
            </div>
          {/if}
        </div>
      {/if}
  </div>

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

