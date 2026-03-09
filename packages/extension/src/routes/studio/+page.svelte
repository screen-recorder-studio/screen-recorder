<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { HardDrive, Video, Github, MessageCircle, BookOpen, Sparkles } from "@lucide/svelte";

  import { recordingStore } from "$lib/stores/recording.svelte";
  import VideoPreviewComposite from "$lib/components/VideoPreviewComposite.svelte";
  import VideoExportPanel from "$lib/components/VideoExportPanel.svelte";
  import BackgroundPicker from "$lib/components/BackgroundPicker/index.svelte";
  import BorderRadiusControl from "$lib/components/BorderRadiusControl.svelte";
  import PaddingControl from "$lib/components/PaddingControl.svelte";
  import AspectRatioControl from "$lib/components/AspectRatioControl.svelte";
  import ShadowControl from "$lib/components/ShadowControl.svelte";
  import StudioEmptyState from "$lib/components/studio/StudioEmptyState.svelte";
  import StudioDriveOverlay from "$lib/components/studio/StudioDriveOverlay.svelte";
  import { _t as t, initI18n } from "$lib/utils/i18n";
  import { getLatestValidRecording, listRecordings, isRecordingUsable, invalidateRecordingsCache } from "$lib/utils/opfs-recordings";
  import { openControlWindow, openDrivePage } from "$lib/utils/window-navigation";
  import type { RecordingSummary } from "$lib/types/recordings";
  import { backgroundConfigStore } from "$lib/stores/background-config.svelte";
  import { getWallpaperById } from "$lib/data/wallpaper-presets";

  // Extension version
  let extensionVersion = $state('')

  // 当前会话的 OPFS 目录 id（用于导出时触发只读日志）
  let opfsDirId = $state("");

  // Studio shell state: resolving → ready | empty | error
  let showEmptyState = $state(false)
  let emptyStateReason = $state<'no-recording' | 'invalid-recording' | 'opfs-unavailable' | 'load-failed'>('no-recording')
  let isResolvingInitialRecording = $state(true)

  // Drive drawer state
  let showDriveDrawer = $state(false)
  let drawerRecordings = $state<RecordingSummary[]>([])
  let drawerLoading = $state(false)

  // Current recording id for drawer highlighting
  let currentRecordingId = $state('')

  // Default wallpaper enhancement: only apply once per Studio session
  let hasAppliedDefaultWallpaper = false

  // Worker 录制数据收集
  let workerEncodedChunks = $state<any[]>([]);
  let workerCurrentWorker: Worker | null = null;

  // 预取控制：拦截一次 range 回复供预取使用
  let isPrefetchingRange = false;
  let prefetchRangeResolver:
    | null
    | ((res: { start: number; chunks: any[] }) => void) = null;

  // 🆕 Single-frame GOP preview control
  let isFetchingSingleFrameGOP = false;
  let singleFrameGOPResolver:
    | null
    | ((res: { chunks: any[]; targetIndexInGOP: number } | null) => void) = null;

  // 时间轴与窗口（毫秒）
  let durationMs = $state(0);
  let windowStartMs = $state(0);
  let windowEndMs = $state(0);
  // 全局帧数与窗口起始全局索引
  let globalTotalFrames = $state(0);
  let windowStartIndex = $state(0);

  // Derived source FPS based on global total frames and duration
  const sourceFps = $derived(
    globalTotalFrames > 0 && durationMs > 0
      ? Math.max(1, Math.round(globalTotalFrames / (durationMs / 1000)))
      : 30,
  );

  // 关键帧与窗口计算相关类型
  type KeyframeInfo = {
    indices: number[];
    timestamps: number[];
    count: number;
    avgInterval: number;
  } | null;

  type WindowRequestMode = "play" | "seek" | "scrub" | "prefetch";

  interface FrameWindowParams {
    centerMs: number;
    beforeMs: number;
    afterMs: number;
    fps: number;
    totalFrames: number;
    keyframeInfo: KeyframeInfo;
    currentWindowStartIndex: number;
    mode: WindowRequestMode;
  }

  interface FrameWindowResult {
    startFrame: number;
    frameCount: number;
    skip: boolean;
  }

  // 统一的帧窗口计算函数：供连续播放 / 拖动预览 / 预取共用
  function computeFrameWindow(params: FrameWindowParams): FrameWindowResult {
    const {
      centerMs,
      beforeMs,
      afterMs,
      fps,
      totalFrames,
      keyframeInfo,
      currentWindowStartIndex,
      mode,
    } = params;

    if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
      return { startFrame: 0, frameCount: 0, skip: true };
    }

    const effectiveFps = Math.max(
      1,
      Math.floor(Number.isFinite(fps) && fps > 0 ? fps : 30),
    );
    const clampedCenterMs = Math.max(0, centerMs);
    const clampedBeforeMs = Math.max(0, beforeMs);
    const clampedAfterMs = Math.max(0, afterMs);

    const targetFrameIndex = Math.max(
      0,
      Math.floor((clampedCenterMs / 1000) * effectiveFps),
    );
    const framesBefore = Math.max(
      0,
      Math.floor((clampedBeforeMs / 1000) * effectiveFps),
    );
    const framesAfter = Math.max(
      0,
      Math.floor((clampedAfterMs / 1000) * effectiveFps),
    );

    // 基于时间范围预估理想窗口大小，然后再结合关键帧/边界进行裁剪
    const minWindowFrames = Math.min(
      totalFrames,
      mode === "prefetch" ? effectiveFps : effectiveFps * 2, // 预取至少1秒，其它模式至少2秒
    );
    const maxWindowFrames = Math.min(totalFrames, effectiveFps * 4); // 上限约4秒，避免单次窗口过大
    let desiredFramesFromTime = framesBefore + framesAfter;
    if (desiredFramesFromTime <= 0) {
      // 未给出明确时间范围时，默认使用2秒窗口
      desiredFramesFromTime = effectiveFps * 2;
    }

    let desiredWindowFrames = Math.min(
      maxWindowFrames,
      Math.max(minWindowFrames, desiredFramesFromTime),
    );
    let startFrame = 0;
    let frameCount = 0;

    if (keyframeInfo && keyframeInfo.indices.length > 0) {
      // 🔧 修复：连续播放模式下不做关键帧回退
      // 当 beforeMs === 0 且 mode === 'play' 时，表示连续播放的窗口切换
      // 此时应该从 targetFrameIndex 开始，让 OPFS Reader 负责关键帧对齐
      // 避免双重回退导致窗口起点错误
      const isForwardPlayback = mode === "play" && clampedBeforeMs === 0;

      if (isForwardPlayback) {
        startFrame = Math.max(0, targetFrameIndex);

        const avgInterval = keyframeInfo.avgInterval || effectiveFps;
        const keyframeSuggested = avgInterval * 2;
        desiredWindowFrames = Math.min(
          maxWindowFrames,
          Math.max(
            minWindowFrames,
            Math.max(desiredWindowFrames, keyframeSuggested),
          ),
        );
        frameCount = Math.min(
          desiredWindowFrames,
          Math.max(1, totalFrames - startFrame),
        );
      } else {
        // 🔧 Seek 模式：需要回退到关键帧以确保正确解码
        let prevKeyframeIndex = keyframeInfo.indices[0];
        for (const k of keyframeInfo.indices) {
          if (k <= targetFrameIndex) prevKeyframeIndex = k;
          else break;
        }

        startFrame = Math.max(0, prevKeyframeIndex);

        const avgInterval = keyframeInfo.avgInterval || effectiveFps;
        const keyframeSuggested = avgInterval * 2;
        desiredWindowFrames = Math.min(
          maxWindowFrames,
          Math.max(
            minWindowFrames,
            Math.max(desiredWindowFrames, keyframeSuggested),
          ),
        );
        frameCount = Math.min(
          desiredWindowFrames,
          Math.max(1, totalFrames - startFrame),
        );
      }
    } else {
      // 无关键帧信息时，退回纯时间推导：让窗口尽量覆盖 [target - before, target + after]
      startFrame = Math.max(0, targetFrameIndex - framesBefore);
      // 若靠近尾部，向前平移窗口保证仍能满足 desiredWindowFrames
      if (startFrame + desiredWindowFrames > totalFrames) {
        startFrame = Math.max(0, totalFrames - desiredWindowFrames);
      }
      frameCount = Math.max(
        1,
        Math.min(desiredWindowFrames, totalFrames - startFrame),
      );
    }

    // 连续播放模式下的“只前进不后退”保护：
    // - 仅在 play 模式 + 不需要加载历史（beforeMs === 0）时生效
    // - 如果新窗口起点不晚于当前窗口，则可以跳过（否则会出现尾部不断重复请求）
    let skip = false;
    if (
      mode === "play" &&
      clampedBeforeMs === 0 &&
      startFrame <= currentWindowStartIndex
    ) {
      skip = true;
    }

    return { startFrame, frameCount, skip };
  }

  // 🔧 智能窗口管理：关键帧信息
  let keyframeInfo = $state<KeyframeInfo>(null);

  // 主窗口请求处理：统一走 computeFrameWindow，支持连续播放 / Seek
  function handleWindowRequest(args: {
    centerMs: number;
    beforeMs: number;
    afterMs: number;
  }) {
    const { centerMs, beforeMs, afterMs } = args;

    if (!workerCurrentWorker) {
      console.warn("[progress] No worker available for window request");
      return;
    }

    const mode: WindowRequestMode = beforeMs === 0 ? "play" : "seek";
    const { startFrame, frameCount, skip } = computeFrameWindow({
      centerMs,
      beforeMs,
      afterMs,
      fps: sourceFps,
      totalFrames: globalTotalFrames,
      keyframeInfo,
      currentWindowStartIndex: windowStartIndex,
      mode,
    });

    if (skip) {
      return;
    }

    if (frameCount > 0 && startFrame < globalTotalFrames) {
      workerCurrentWorker?.postMessage({
        type: "getRange",
        start: startFrame,
        count: frameCount,
      });
    } else {
      workerCurrentWorker?.postMessage({
        type: "getWindowByTime",
        centerMs,
        beforeMs,
        afterMs,
      });
    }
  }

  // 预览容器尺寸测量（确保时间轴可见、画布自适应）
  let previewContainerEl = $state<HTMLDivElement | null>(null);
  let previewDisplayW = $state(0);
  let previewDisplayH = $state(0);

  // Reactively set up ResizeObserver when preview container mounts/unmounts
  $effect(() => {
    const el = previewContainerEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    previewDisplayW = Math.floor(rect.width);
    previewDisplayH = Math.floor(rect.height);
    const observer = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) {
        previewDisplayW = Math.floor(cr.width);
        previewDisplayH = Math.floor(cr.height);
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  });

  const workerStatus = $derived(recordingStore.state.status);

  /**
   * Async wallpaper enhancement: upgrade default gradient to a wallpaper image.
   * Only runs once per Studio session. Silently falls back on failure.
   */
  async function applyDefaultWallpaperEnhancement() {
    if (hasAppliedDefaultWallpaper) return
    hasAppliedDefaultWallpaper = true
    try {
      const preset = getWallpaperById('gradient-abstract-1')
      if (!preset) return
      await backgroundConfigStore.handleWallpaperSelection(preset)
    } catch (e) {
      console.warn('[Studio] Default wallpaper enhancement failed, keeping gradient:', e)
    }
  }

  /**
   * Load a recording by its OPFS directory id.
   * Extracted so it can be called from onMount *and* from the drawer switch.
   */
  function loadRecordingById(dirId: string) {
    // Clean up previous worker
    try { workerCurrentWorker?.postMessage({ type: "close" }) } catch {}
    workerCurrentWorker?.terminate?.()
    workerCurrentWorker = null

    // Reset state
    isResolvingInitialRecording = true
    workerEncodedChunks = []
    durationMs = 0
    windowStartMs = 0
    windowEndMs = 0
    globalTotalFrames = 0
    windowStartIndex = 0
    keyframeInfo = null
    isPrefetchingRange = false
    prefetchRangeResolver = null
    isFetchingSingleFrameGOP = false
    singleFrameGOPResolver = null

    opfsDirId = dirId
    currentRecordingId = dirId
    showEmptyState = false

    if (!dirId) {
      isResolvingInitialRecording = false
      return
    }

    const readerWorker = new Worker(
      new URL("$lib/workers/opfs-reader-worker.ts", import.meta.url),
      { type: "module" },
    );

    workerCurrentWorker = readerWorker;

    readerWorker.onmessage = (ev: MessageEvent<any>) => {
      const {
        type,
        summary,
        start,
        chunks,
        code,
        message,
        keyframeInfo: receivedKeyframeInfo,
      } = ev.data || {};

      if (isPrefetchingRange && type === "range") {
        isPrefetchingRange = false;
        prefetchRangeResolver?.({ start, chunks });
        prefetchRangeResolver = null;
        return;
      }

      if (isFetchingSingleFrameGOP && type === "singleFrameGOP") {
        const { targetIndexInGOP, chunks: gopChunks } = ev.data;
        isFetchingSingleFrameGOP = false;
        singleFrameGOPResolver?.({
          chunks: gopChunks || [],
          targetIndexInGOP: targetIndexInGOP ?? 0,
        });
        singleFrameGOPResolver = null;
        return;
      }

      if (type === "ready") {
        if (summary?.durationMs) durationMs = summary.durationMs;
        if (summary?.totalChunks) globalTotalFrames = summary.totalChunks;
        if (receivedKeyframeInfo) keyframeInfo = receivedKeyframeInfo;

        const initialFrameCount = Math.min(90, globalTotalFrames);
        readerWorker.postMessage({
          type: "getRange",
          start: 0,
          count: initialFrameCount,
        });
      } else if (type === "range") {
        if (Array.isArray(chunks) && chunks.length > 0) {
          workerEncodedChunks = chunks;
          windowStartIndex = typeof start === "number" ? start : 0;

          const firstGlobalTimestamp =
            summary?.firstTimestamp || chunks[0]?.timestamp || 0;
          const windowStartTimestamp = chunks[0]?.timestamp || 0;
          const windowEndTimestamp =
            chunks[chunks.length - 1]?.timestamp || 0;

          windowStartMs = Math.floor(
            (windowStartTimestamp - firstGlobalTimestamp) / 1000,
          );
          windowEndMs = Math.floor(
            (windowEndTimestamp - firstGlobalTimestamp) / 1000,
          );

          recordingStore.updateStatus("completed");
          recordingStore.setEngine("webcodecs");
          isResolvingInitialRecording = false

          // Async Layer 2: upgrade default gradient to wallpaper (once per session)
          applyDefaultWallpaperEnhancement()
        } else {
          console.warn("⚠️ [OPFSReader] Empty range received");
          isResolvingInitialRecording = false
        }
      } else if (type === "error") {
        console.error("❌ [OPFSReader] Error:", code, message);
        // Heuristic: classify as invalid-recording when the error relates to
        // data integrity (e.g. parse failures, missing index/meta). The worker
        // only sends a generic READER_ERROR code, so we inspect the message.
        const errMsg = typeof message === 'string' ? message.toLowerCase() : ''
        const isInvalidData = errMsg.includes('parse') || errMsg.includes('index') || errMsg.includes('meta') || errMsg.includes('invalid') || errMsg.includes('corrupt')
        showEmptyState = true
        emptyStateReason = isInvalidData ? 'invalid-recording' : 'load-failed'
        isResolvingInitialRecording = false
      }
    };

    readerWorker.postMessage({ type: "open", dirId });
  }

  /** Handle start-recording from empty state or drawer */
  function handleStartRecording() {
    void openControlWindow()
  }

  /** Handle open-drive from empty state */
  function handleOpenDrive() {
    void openDrivePage()
  }

  /** Open the drive drawer */
  async function openDrawer() {
    showDriveDrawer = true
    drawerLoading = true
    try {
      drawerRecordings = await listRecordings(true)
    } catch (e) {
      console.warn('[Studio] Failed to load drawer recordings:', e)
      drawerRecordings = []
    } finally {
      drawerLoading = false
    }
  }

  /** Switch to a different recording from the drawer */
  function handleDrawerSelect(recording: RecordingSummary) {
    showDriveDrawer = false
    loadRecordingById(recording.id)
    // Update URL without creating a new history entry
    try {
      history.replaceState(null, '', `/studio.html?id=${encodeURIComponent(recording.id)}`)
    } catch {}
  }

  /** Handle recording deletion from drawer */
  async function handleDrawerDelete(id: string) {
    try {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(id, { recursive: true })
      invalidateRecordingsCache()
      // Remove from drawer list
      drawerRecordings = drawerRecordings.filter(r => r.id !== id)
      // If deleted the current recording, switch to next or empty state
      if (id === currentRecordingId) {
        if (drawerRecordings.length > 0) {
          handleDrawerSelect(drawerRecordings[0])
        } else {
          showEmptyState = true
          emptyStateReason = 'no-recording'
          currentRecordingId = ''
          opfsDirId = ''
          workerEncodedChunks = []
          try { history.replaceState(null, '', '/studio.html') } catch {}
        }
      }
    } catch (e) {
      console.error('[Studio] Failed to delete recording:', e)
    }
  }

  // 组件挂载时的初始化
  onMount(() => {
    // Load extension version
    try { extensionVersion = chrome.runtime.getManifest().version } catch {}

    // Initialize i18n for web mode
    initI18n().catch(e => console.error('[Studio] i18n init failed:', e));

    // Recording resolution: check URL id first, then fallback to latest
    (async () => {
      try {
        const params = new URLSearchParams(location.search);
        const dirId = params.get("id") || "";

        if (dirId) {
          // Mode A: explicit id – validate usability before loading
          try {
            const allRecs = await listRecordings(true)
            const target = allRecs.find(r => r.id === dirId)
            if (target && !(await isRecordingUsable(target))) {
              showEmptyState = true
              emptyStateReason = 'invalid-recording'
              isResolvingInitialRecording = false
              return
            }
          } catch {
            // If listing fails, still attempt to load – worker will report errors
          }
          // isResolvingInitialRecording remains true; will be set false by worker callback
          loadRecordingById(dirId)
        } else {
          // Mode B: no id – try to find the latest usable recording
          try {
            const allRecs = await listRecordings(true)
            const latest = await getLatestValidRecording(true)
            if (latest) {
              loadRecordingById(latest.id)
              try {
                history.replaceState(null, '', `/studio.html?id=${encodeURIComponent(latest.id)}`)
              } catch {}
              // isResolvingInitialRecording remains true; will be set false by worker callback
            } else {
              // Distinguish: there are recordings but none are usable vs no recordings at all
              const hasAnyRecordings = allRecs.length > 0
              showEmptyState = true
              emptyStateReason = hasAnyRecordings ? 'invalid-recording' : 'no-recording'
              isResolvingInitialRecording = false
            }
          } catch (e) {
            console.error('[Studio] Failed to resolve latest recording:', e)
            showEmptyState = true
            emptyStateReason = (typeof navigator.storage?.getDirectory === 'function') ? 'no-recording' : 'opfs-unavailable'
            isResolvingInitialRecording = false
          }
        }
      } catch (error) {
        console.error("❌ [Studio] Failed to open OPFS recording:", error);
        showEmptyState = true
        emptyStateReason = 'load-failed'
        isResolvingInitialRecording = false
      }
    })()

    return () => {
      try {
        workerCurrentWorker?.postMessage({ type: "close" });
      } catch {}
      workerCurrentWorker?.terminate?.();
      workerCurrentWorker = null;
    };
  });

  // 供 VideoPreviewComposite 进行“只读预取”的数据拉取；不改变当前窗口
  async function fetchWindowData(args: {
    centerMs: number;
    beforeMs: number;
    afterMs: number;
  }): Promise<{ chunks: any[]; windowStartIndex: number }> {
    const { centerMs, beforeMs, afterMs } = args;
    if (!workerCurrentWorker) {
      console.warn(
        "[prefetch] No reader worker; returning empty prefetch result",
      );
      return { chunks: [], windowStartIndex: 0 };
    }
    if (isPrefetchingRange) {
      console.warn(
        "[prefetch] Already building; skip duplicate prefetch request",
      );
      return { chunks: [], windowStartIndex: 0 };
    }

    const { startFrame, frameCount } = computeFrameWindow({
      centerMs,
      beforeMs,
      afterMs,
      fps: sourceFps,
      totalFrames: globalTotalFrames,
      keyframeInfo,
      currentWindowStartIndex: windowStartIndex,
      mode: "prefetch",
    });

    if (frameCount <= 0 || startFrame >= globalTotalFrames) {
      console.warn(
        "[prefetch] Computed empty window for prefetch, skipping request",
        {
          centerMs,
          beforeMs,
          afterMs,
          startFrame,
          frameCount,
          totalFrames: globalTotalFrames,
        },
      );
      return { chunks: [], windowStartIndex: 0 };
    }

    return new Promise((resolve) => {
      isPrefetchingRange = true;
      let settled = false;
      prefetchRangeResolver = ({ start, chunks }) => {
        if (settled) return;
        settled = true;
        resolve({ chunks: chunks || [], windowStartIndex: start ?? 0 });
      };

      try {
        workerCurrentWorker!.postMessage({
          type: "getRange",
          start: startFrame,
          count: frameCount,
        });
      } catch (err) {
        console.warn("[prefetch] Failed to post prefetch request:", err);
        isPrefetchingRange = false;
        prefetchRangeResolver = null;
        resolve({ chunks: [], windowStartIndex: 0 });
        return;
      }

      // 超时保护，防止卡死
      setTimeout(() => {
        if (!settled) {
          console.warn("[prefetch] Prefetch timeout, returning empty");
          settled = true;
          isPrefetchingRange = false;
          prefetchRangeResolver = null;
          resolve({ chunks: [], windowStartIndex: 0 });
        }
      }, 4000);
    });
  }

  // 🆕 GOP data fetching for VideoPreviewComposite single-frame preview
  // Only read minimal GOP required for target frame (from nearest keyframe to target frame)
  async function fetchSingleFrameGOP(
    targetFrame: number
  ): Promise<{ chunks: any[]; targetIndexInGOP: number } | null> {
    if (!workerCurrentWorker) {
      console.warn("[preview] No reader worker; returning null");
      return null;
    }
    if (isFetchingSingleFrameGOP) {
      console.warn("[preview] Already fetching single frame GOP; skip");
      return null;
    }
    if (targetFrame < 0 || targetFrame >= globalTotalFrames) {
      console.warn("[preview] Target frame out of range:", {
        targetFrame,
        globalTotalFrames,
      });
      return null;
    }

    return new Promise((resolve) => {
      isFetchingSingleFrameGOP = true;
      let settled = false;
      singleFrameGOPResolver = (res) => {
        if (settled) return;
        settled = true;
        resolve(res);
      };

      try {
        workerCurrentWorker!.postMessage({
          type: "getSingleFrameGOP",
          targetFrame,
        });
      } catch (err) {
        console.warn("[preview] Failed to post single frame GOP request:", err);
        isFetchingSingleFrameGOP = false;
        singleFrameGOPResolver = null;
        resolve(null);
        return;
      }

      // Timeout protection (shorter since this is a preview operation)
      setTimeout(() => {
        if (!settled) {
          console.warn("[preview] Single frame GOP timeout, returning null");
          settled = true;
          isFetchingSingleFrameGOP = false;
          singleFrameGOPResolver = null;
          resolve(null);
        }
      }, 2000);
    });
  }

  // 组件销毁时清理
  onDestroy(() => {
    // cleanup
  });

</script>

<svelte:head>
  <title>{t('studio_pageTitle')}</title>
</svelte:head>

<div class="flex h-screen bg-gray-50">
  <!-- Left main preview player - no scrolling, full height 100vh -->
  <div class="flex-1 min-h-0 flex flex-col h-full overflow-hidden">
    <!-- Preview area header -->
    <div class="flex-shrink-0 px-4 py-2 border-b border-gray-200 bg-white">
      <div class="flex items-center justify-between relative">
        <!-- Left title + license badge -->
        <div class="flex items-center gap-2">
          <Video class="w-6 h-6 text-blue-600" />
          <h1 class="text-xl font-bold text-gray-800">
            {t('studio_headerTitle')}
            {#if extensionVersion}<span class="text-xs font-normal text-gray-400 ml-1">v{extensionVersion}</span>{/if}
          </h1>
          <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md bg-blue-50 text-blue-600 border border-blue-200">
            <Sparkles class="w-3 h-3" />
            {t('export_panel_tier_trial')}
          </span>
        </div>

        <!-- Center video aspect ratio control -->
        <div
          class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2"
        >
          <AspectRatioControl />
        </div>

        <!-- Right action buttons -->
        <div class="flex items-center gap-2">
          <a
            href="https://github.com/screen-recorder-studio/screen-recorder"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 hover:border-blue-400 hover:bg-white/70 hover:shadow-sm transition-all duration-200 group text-sm"
            title={t('studio_githubTooltip')}
          >
            <Github
              class="w-4 h-4 text-gray-600 group-hover:text-blue-600 transition-colors duration-200"
            />
            <span class="text-gray-600 group-hover:text-blue-600 transition-colors duration-200">{t('studio_githubText')}</span>
          </a>
          <a
            href="https://github.com/screen-recorder-studio/screen-recorder/issues"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 hover:border-blue-400 hover:bg-white/70 hover:shadow-sm transition-all duration-200 group text-sm"
            title={t('studio_feedbackTooltip')}
          >
            <MessageCircle
              class="w-4 h-4 text-gray-600 group-hover:text-blue-600 transition-colors duration-200"
            />
            <span class="text-gray-600 group-hover:text-blue-600 transition-colors duration-200">{t('studio_feedbackText')}</span>
          </a>
          <a
            href="https://www.screenrecorder.studio/"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 hover:border-blue-400 hover:bg-white/70 hover:shadow-sm transition-all duration-200 group text-sm"
            title={t('studio_helpTooltip')}
          >
            <BookOpen
              class="w-4 h-4 text-gray-600 group-hover:text-blue-600 transition-colors duration-200"
            />
            <span class="text-gray-600 group-hover:text-blue-600 transition-colors duration-200">{t('studio_helpText')}</span>
          </a>
        </div>
      </div>
    </div>

    <!-- Preview player content area -->
    <div class="flex-1 min-h-0 flex flex-col relative">
      {#if isResolvingInitialRecording}
        <!-- Loading state while resolving initial recording -->
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p class="text-sm text-gray-500">{t('studio_loading')}</p>
          </div>
        </div>
      {:else if showEmptyState}
        <StudioEmptyState
          reason={emptyStateReason}
          onStartRecording={handleStartRecording}
          onOpenDrive={handleOpenDrive}
        />
      {:else}
        <!-- Using new VideoPreviewComposite component -->
        <div
          class="flex-1 min-h-0 flex items-stretch justify-center"
          bind:this={previewContainerEl}
        >
          <VideoPreviewComposite
            encodedChunks={workerEncodedChunks}
            isRecordingComplete={workerStatus === "completed" ||
              workerStatus === "idle"}
            displayWidth={previewDisplayW}
            displayHeight={previewDisplayH}
            showControls={true}
            showTimeline={true}
            {durationMs}
            {windowStartMs}
            {windowEndMs}
            totalFramesAll={globalTotalFrames}
            {windowStartIndex}
            {keyframeInfo}
            onRequestWindow={handleWindowRequest}
            {fetchWindowData}
            {fetchSingleFrameGOP}
            className="worker-video-preview w-full h-full"
          />
        </div>
      {/if}
    </div>
  </div>

  <!-- Right editing panel - allows scrolling -->
  {#if !showEmptyState && !isResolvingInitialRecording}
  <div class="w-100 bg-white border-l border-gray-200 flex flex-col h-full">
    <!-- Right panel header: Drive button + Export button -->
    <div class="flex-shrink-0 px-4 py-2">
      <div class="flex items-center justify-between gap-3">
        <!-- Drive button (replaces license badge position) -->
        <button
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 shadow-sm hover:border-blue-300 hover:bg-blue-100 hover:text-blue-800 transition-all duration-200 whitespace-nowrap"
          onclick={openDrawer}
          title={t('studio_driveTooltip')}
        >
          <HardDrive class="w-4 h-4 text-blue-600" />
          {t('studio_recentRecordings')}
        </button>
        <!-- Export button -->
        <VideoExportPanel
          encodedChunks={workerEncodedChunks}
          isRecordingComplete={workerStatus === "completed" ||
            workerStatus === "idle"}
          totalFramesAll={globalTotalFrames}
          {opfsDirId}
          {sourceFps}
          licenseTier="pro-trial"
          showLicenseBadge={false}
        />
      </div>
    </div>

    <!-- Scrollable editing content area -->
    <div class="flex-1 overflow-y-auto">
      <div class="px-4 pt-1 pb-2 space-y-4">
        <!-- Video configuration blocks -->

        <!-- Background color selection -->
        <div class="col-span-2 lg:col-span-1">
          <BackgroundPicker />
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
  {/if}
</div>

<!-- Drive overlay -->
{#if showDriveDrawer}
  <StudioDriveOverlay
    recordings={drawerRecordings}
    isLoading={drawerLoading}
    selectedRecordingId={currentRecordingId}
    onSelect={handleDrawerSelect}
    onDelete={handleDrawerDelete}
    onClose={() => { showDriveDrawer = false }}
    onOpenDriveFull={() => { window.open('/drive.html', '_blank') }}
  />
{/if}

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
