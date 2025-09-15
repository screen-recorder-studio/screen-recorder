// @ts-nocheck

// content.js - injected on demand
(() => {
  if (window.__mcp_injected) return;
  window.__mcp_injected = true;

  const state = {
    mode: 'element',
    selecting: false,
    recording: false,
    selectedElement: null,
    selectionBox: null,
    isDragging: false,
    startX: 0,
    startY: 0,
    stream: null,
    track: null,
    root: null,
    preview: null,
    // 容器样式分离相关字段
    elementContainer: null,
    elementRecordingTarget: null,
    regionContainer: null,
    regionRecordingTarget: null,
    // MediaRecorder fallback fields
    mediaRecorder: null,
    recordedChunks: [],
    videoBlob: null,
    // WebCodecs pipeline fields
    usingWebCodecs: false,
    encoder: null,
    processor: null,
    reader: null,
    port: null,
    chunkCount: 0,
    byteCount: 0,
    worker: null,
    workerBlobUrl: null,
    // iframe sink (probe) window for direct ArrayBuffer transfer logging
    sinkWin: null,
    // 编码数据收集
    encodedChunks: [],
    recordingMetadata: null
  };

	  // 流式累积是否就绪（sidepanel注册后由 background 通知）
	  let streamingReady = false;


  // Root overlay
  const root = document.createElement('div');
  root.className = 'mcp-ext-root';
  document.documentElement.appendChild(root);
  state.root = root;

  // Report capability support once injected
  try {
    const caps = {
      getDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
      restrictionTarget: typeof window.RestrictionTarget !== 'undefined',
      cropTarget: typeof window.CropTarget !== 'undefined',
    };
    chrome.runtime.sendMessage({ type: 'CONTENT_REPORT', partial: { capabilities: caps } });
  } catch (e) {}

  function report(partial) {
    chrome.runtime.sendMessage({ type: 'CONTENT_REPORT', partial });
  }

  // Ensure extension iframe sink (offscreen.html?mode=iframe) is present and handshaked
  async function ensureSinkIframe() {
    try {
      if (state.sinkWin && typeof state.sinkWin.postMessage === 'function') return state.sinkWin;
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:1px; height:1px; opacity:0; border:0; z-index:2147483647;';
      iframe.src = chrome.runtime.getURL('offscreen.html?mode=iframe');
      document.documentElement.appendChild(iframe);
      await new Promise((r) => iframe.onload = r);
      const win = iframe.contentWindow;
      if (!win) return null;
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 1000);
        function onMsg(ev) {
          if (ev.source === win && ev.data && ev.data.type === 'sink-ready') {
            clearTimeout(timer);
            window.removeEventListener('message', onMsg);
            resolve(true);
          }
        }
        window.addEventListener('message', onMsg);
        try { win.postMessage({ type: 'ping' }, '*'); } catch {}
      });
      if (ok) state.sinkWin = win;
      return ok ? win : null;
    } catch (e) {
      return null;
    }
  }

  // 创建元素容器和录制目标
  function createElementContainer(targetElement) {
    // 1. 创建样式容器
    const container = document.createElement('div');
    container.className = 'mcp-element-container';

    // 2. 创建录制目标（透明，无样式）
    const recordingTarget = document.createElement('div');
    recordingTarget.className = 'mcp-recording-target';

    // 3. 容器定位到目标元素
    const rect = targetElement.getBoundingClientRect();

    container.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: none;
      z-index: 2147483001;
    `;

    // 4. 录制目标填满容器内部（避开边框）
    recordingTarget.style.cssText = `
      position: absolute;
      left: 5px;
      top: 5px;
      right: 5px;
      bottom: 5px;
      background: transparent;
      border: none;
      outline: none;
      pointer-events: none;
    `;

    container.appendChild(recordingTarget);
    return { container, recordingTarget };
  }

  // 创建区域容器和录制目标
  function createRegionContainer(x, y, width, height) {
    // 1. 外层：样式容器
    const container = document.createElement('div');
    container.className = 'mcp-region-container';
    container.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      pointer-events: none;
      z-index: 2147483001;
    `;

    // 2. 内层：录制目标
    const recordingTarget = document.createElement('div');
    recordingTarget.className = 'mcp-recording-target';
    recordingTarget.style.cssText = `
      position: absolute;
      left: 2px;
      top: 2px;
      right: 2px;
      bottom: 2px;
      background: transparent;
      border: none;
      outline: none;
      pointer-events: none;
    `;

    container.appendChild(recordingTarget);
    return { container, recordingTarget };
  }

  // 同步元素容器位置
  function syncElementContainer() {
    if (!state.selectedElement || !state.elementContainer) return;

    const rect = state.selectedElement.getBoundingClientRect();
    state.elementContainer.style.left = rect.left + 'px';
    state.elementContainer.style.top = rect.top + 'px';
    state.elementContainer.style.width = rect.width + 'px';
    state.elementContainer.style.height = rect.height + 'px';
  }

  // 清理元素选择
  function clearElementSelection() {
    if (state.elementContainer) {
      state.elementContainer.remove();
      state.elementContainer = null;
      state.elementRecordingTarget = null;
    }
    if (state.selectedElement) {
      state.selectedElement.classList.remove('mcp-selected');
      state.selectedElement = null;
    }
  }

  // 清理区域选择
  function clearRegionSelection() {
    if (state.regionContainer) {
      state.regionContainer.remove();
      state.regionContainer = null;
      state.regionRecordingTarget = null;
    }
    if (state.selectionBox) {
      state.selectionBox.style.display = 'none';
      state.selectionBox = null;
    }
  }

  function ensureSelectionBox() {
    if (!state.selectionBox) {
      state.selectionBox = document.createElement('div');
      state.selectionBox.className = 'mcp-selection-box';
      state.selectionBox.style.left = '0px';
      state.selectionBox.style.top = '0px';
      state.selectionBox.style.width = '0px';
      state.selectionBox.style.height = '0px';
      state.selectionBox.style.display = 'none';
      root.appendChild(state.selectionBox);
    }
    return state.selectionBox;
  }

  function addDragOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'mcp-drag-overlay';
    root.appendChild(overlay);

    overlay.addEventListener('mousedown', (e) => {
      if (state.mode !== 'region') return;
      state.isDragging = true;
      const sb = ensureSelectionBox();
      sb.style.display = 'block';
      state.startX = e.clientX; state.startY = e.clientY;
      sb.style.left = `${state.startX}px`;
      sb.style.top = `${state.startY}px`;
      sb.style.width = '0px'; sb.style.height = '0px';
      e.preventDefault();
      e.stopPropagation();
    }, true);

    window.addEventListener('mousemove', (e) => {
      if (!state.isDragging || state.mode !== 'region') return;
      const sb = ensureSelectionBox();
      const x = Math.min(state.startX, e.clientX);
      const y = Math.min(state.startY, e.clientY);
      const w = Math.abs(e.clientX - state.startX);
      const h = Math.abs(e.clientY - state.startY);
      sb.style.left = `${x}px`; sb.style.top = `${y}px`; sb.style.width = `${w}px`; sb.style.height = `${h}px`;
    }, true);

    window.addEventListener('mouseup', () => {
      if (!state.isDragging || state.mode !== 'region') return;
      state.isDragging = false;
      const sb = ensureSelectionBox();
      const w = parseFloat(sb.style.width||'0');
      const h = parseFloat(sb.style.height||'0');
      if (w < 10 || h < 10) {
        sb.style.display = 'none';
        clearRegionSelection();
        report({ selectedDesc: undefined });
      } else {
        // 创建区域容器和录制目标
        const x = parseFloat(sb.style.left||'0');
        const y = parseFloat(sb.style.top||'0');
        const { container, recordingTarget } = createRegionContainer(x, y, w, h);

        // 保存状态
        state.regionContainer = container;
        state.regionRecordingTarget = recordingTarget;

        // 添加到页面
        root.appendChild(container);

        // 隐藏原来的选择框
        sb.style.display = 'none';

        report({ selectedDesc: `区域 ${Math.round(w)}×${Math.round(h)}` });
        // 区域选择完成后，自动退出选择态，并移除拖拽遮罩，防止继续选中内部
        state.selecting = false;
        if (dragOverlay) { try { dragOverlay.remove(); } catch(_){} dragOverlay = null; }
        report({ selecting: false });
      }
    }, true);

    return overlay;
  }

  let dragOverlay = null;

  function enterSelection() {
    state.selecting = true;
    if (state.mode === 'region') {
      dragOverlay = dragOverlay || addDragOverlay();
    } else {
      // element mode: highlight on hover
      document.addEventListener('mouseover', onHover, true);
      document.addEventListener('mouseout', onOut, true);
      document.addEventListener('click', onClick, true);
    }
    report({});
  }

  function exitSelection() {
    state.selecting = false;
    // remove overlays/listeners
    if (dragOverlay) {
      dragOverlay.remove();
      dragOverlay = null;
    }
    if (state.selectionBox) {
      state.selectionBox.remove();
      state.selectionBox = null;
    }
    clearHighlight();
    document.removeEventListener('mouseover', onHover, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('click', onClick, true);
  }

  function isOwnNode(node) {
    return node === root || root.contains(node) || (state.preview && (node === state.preview || state.preview.contains(node)));
  }

  function onHover(e) {
    if (!state.selecting || state.mode !== 'element') return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (isOwnNode(el)) return;
    clearHighlight();
    el.classList.add('mcp-highlight');
  }

  function onOut(e) {
    if (!state.selecting || state.mode !== 'element') return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    el.classList.remove('mcp-highlight');
  }

  function onClick(e) {
    if (!state.selecting || state.mode !== 'element') return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (isOwnNode(el)) return;
    e.preventDefault(); e.stopPropagation();
    selectElement(el);
    // 选择完成后自动退出选择态，避免继续在内部再次选择
    state.selecting = false;
    document.removeEventListener('mouseover', onHover, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('click', onClick, true);
    report({ selecting: false });
  }

  function clearHighlight() {
    document.querySelectorAll('.mcp-highlight').forEach((n) => n.classList.remove('mcp-highlight'));
  }

  function getElDesc(el) {
    if (!el) return '';
    const tag = el.tagName?.toLowerCase() || 'el';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    return `${tag}${id}${cls}`;
  }

  function selectElement(el) {
    // 清理之前的选择
    clearElementSelection();

    // 创建容器和录制目标
    const { container, recordingTarget } = createElementContainer(el);

    // 保存状态
    state.selectedElement = el;
    state.elementContainer = container;
    state.elementRecordingTarget = recordingTarget;

    // 添加到页面
    root.appendChild(container);

    clearHighlight();
    report({ selectedDesc: `元素 ${getElDesc(el)}` });
  }

  async function startCapture() {
    if (state.recording) return;
    try {
      state.recording = true;
      const displayMediaOptions = { video: { displaySurface: 'window' }, audio: false, preferCurrentTab: true };
      state.stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      state.track = state.stream.getVideoTracks()[0];

      // Try Element Capture first if element mode (使用原始元素)
      if (state.mode === 'element' && state.selectedElement && typeof window.RestrictionTarget !== 'undefined') {
        try {
          const rt = await window.RestrictionTarget.fromElement(state.selectedElement);
          await state.track.restrictTo(rt);
        } catch (e) { console.warn('restrictTo failed, fallback to crop', e); }
      }

      // Then try CropTarget (使用录制目标而不是样式容器)
      if (typeof window.CropTarget !== 'undefined') {
        try {
          let recordingTarget = null;
          if (state.mode === 'element') {
            recordingTarget = state.elementRecordingTarget;
          } else if (state.mode === 'region') {
            recordingTarget = state.regionRecordingTarget;
          }

          if (recordingTarget) {
            const ct = await window.CropTarget.fromElement(recordingTarget);
            await state.track.cropTo(ct);
          }
        } catch (e) { console.warn('cropTo failed', e); }
      }

      // WebCodecs 可用则使用 VideoEncoder 管道，否则回退到 MediaRecorder
      const canWebCodecs = typeof window.VideoEncoder !== 'undefined' && typeof window.MediaStreamTrackProcessor !== 'undefined';
      if (canWebCodecs) {
        state.usingWebCodecs = true;
        const settings = state.track.getSettings ? state.track.getSettings() : {};
        const width = settings.width || 1920;
        const height = settings.height || 1080;
        const framerate = Math.round((settings.frameRate || 30));

        // 保存录制元数据
        state.recordingMetadata = {
          mode: state.mode,
          selectedElement: state.selectedElement ? getElDesc(state.selectedElement) : null,
          selectedRegion: state.mode === 'region' && state.selectionBox ? {
            width: parseFloat(state.selectionBox.style.width || '0'),
            height: parseFloat(state.selectionBox.style.height || '0'),
            x: parseFloat(state.selectionBox.style.left || '0'),
            y: parseFloat(state.selectionBox.style.top || '0')
          } : null,
          startTime: Date.now(),
          codec: 'vp8',
          width,
          height,
          framerate
        };

        console.log('[Stream][Content] recordingMetadata prepared', {
          startTime: state.recordingMetadata.startTime,
          width: state.recordingMetadata.width,
          height: state.recordingMetadata.height,
          framerate: state.recordingMetadata.framerate,
          selection: state.recordingMetadata.selection
        });

        // 建立与 background 的 Port
        state.port = chrome.runtime.connect({ name: 'encoded-stream' });
        state.port.postMessage({ type: 'start', codec: 'vp8', width, height, framerate });

        // 初始化 Dedicated Worker 承担编码职责
        // 通过 fetch -> Blob URL 创建 Worker，避免跨源构造限制
        console.log('[Stream][Content] port connected; sending start', { width, height, framerate });

        const workerUrl = chrome.runtime.getURL('encoder-worker.js');

	        //    
	        state.port?.postMessage({ type: 'meta', metadata: state.recordingMetadata });

        console.log('[Stream][Content] meta posted to background', { startTime: state.recordingMetadata?.startTime });


        let workerText = '';
        try {
          const res = await fetch(workerUrl, { cache: 'no-cache' });
          workerText = await res.text();
        } catch (e) {
          console.error('Failed to fetch worker script', e);
          throw e;
        }
        const workerBlob = new Blob([workerText], { type: 'text/javascript' });
        state.workerBlobUrl = URL.createObjectURL(workerBlob);
        state.worker = new Worker(state.workerBlobUrl);

        // 清理函数：确保只执行一次
        let cleanedUp = false;
        const finalizeStop = () => {
          if (cleanedUp) return; cleanedUp = true;
          try { state.stream && state.stream.getTracks().forEach(t => t.stop()); } catch {}
          try { state.worker?.terminate(); } catch {}
          if (state.workerBlobUrl) { try { URL.revokeObjectURL(state.workerBlobUrl); } catch {} }
          state.worker = null;
          state.workerBlobUrl = null;
          state.port = null;
          state.usingWebCodecs = false;
          state.recording = false;
          hidePreview();
          report({ recording: false });
        };

        state.worker.onmessage = (ev) => {
          const msg = ev.data || {};

          console.log('worker message bbb', msg.data);
          switch (msg.type) {
            case 'configured':
              console.log('[encoder-worker] configured', { codec: 'vp8', width, height, framerate });
              // Initialize probe iframe sink for logging (no pipeline changes)
              try { ensureSinkIframe().then(() => {
                try {
                  state.sinkWin?.postMessage({ type: 'start', codec: 'vp8', width, height, framerate }, '*');
                  state.sinkWin?.postMessage({ type: 'meta', metadata: state.recordingMetadata }, '*');
                } catch {}
              }); } catch {}
              break;
            case 'chunk':
              try {
                state.chunkCount += 1;
                state.byteCount += (msg.size || 0);

                // 不再累计 encodedChunks；仅通过 iframe sink 零拷贝写入 OPFS

                // Transfer to iframe sink via zero-copy (new pipeline; no background forwarding of chunk)
                try {
                  const sink = state.sinkWin || null;
                  if (sink && msg.data) {
                    sink.postMessage({ type: 'chunk', ts: msg.ts, kind: msg.kind, data: msg.data }, '*', [msg.data]);
                  }
                } catch (_) {}
              } catch (err) {
                console.error('forward chunk failed', err);
              }
              break;
            case 'end':
              state.port?.postMessage({ type: 'end', chunks: state.chunkCount, bytes: state.byteCount });
              try { state.sinkWin?.postMessage({ type: 'end', chunks: state.chunkCount, bytes: state.byteCount }, '*'); } catch {}
              console.log(`🎬 [Element Recording] Collected ${state.encodedChunks.length} encoded chunks for editing`);
              // worker 已完成，执行清理
              finalizeStop();
              break;
            case 'error':
              console.error('[encoder-worker] error', msg.message);
              state.port?.postMessage({ type: 'error', message: msg.message });
              // 出错也进行清理，避免悬挂
              finalizeStop();
              break;
            default:
              break;
          }
        };
        state.worker.postMessage({ type: 'configure', codec: 'vp8', width, height, framerate, bitrate: 4_000_000 });

        // 建立逐帧处理，逐帧转交给 worker 编码（转移所有权零拷贝）
        state.processor = new MediaStreamTrackProcessor({ track: state.track });
        state.reader = state.processor.readable.getReader();
        let frameIndex = 0;
        (async () => {
          try {
            for (;;) {
              const { done, value: frame } = await state.reader.read();
              if (done) break;
              const keyFrame = frameIndex === 0 || (frameIndex % (framerate * 2) === 0);
              state.worker?.postMessage({ type: 'frame', frame, keyFrame, i: frameIndex }, [frame]);
              frameIndex++;
            }
            // 读尽后通知 worker 刷新并结束
            state.worker?.postMessage({ type: 'stop' });
          } catch (err) {
            console.error('frame pump error', err);
          }
        })();

      } else {
        // 初始化 MediaRecorder 进行录制（回退）
        state.recordedChunks = [];
        state.mediaRecorder = new MediaRecorder(state.stream, {
          mimeType: 'video/webm;codecs=vp9'
        });
        state.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            state.recordedChunks.push(event.data);
          }
        };
        state.mediaRecorder.onstop = () => {
          state.videoBlob = new Blob(state.recordedChunks, { type: 'video/webm' });
          const videoUrl = URL.createObjectURL(state.videoBlob);
          report({ recording: false, hasVideo: true, videoSize: state.videoBlob.size, videoUrl });
        };
        state.mediaRecorder.start(1000);
      }

      showPreview();
      state.track.onended = stopCapture;
      report({ recording: true });
    } catch (e) {
      console.error('startCapture error', e);
      state.recording = false;
      report({ recording: false });
    }
  }

  function stopCapture() {
    try {
      if (state.usingWebCodecs) {
        try { state.reader?.cancel(); } catch {}
        try { state.worker?.postMessage({ type: 'stop' }); } catch {}
        Promise.resolve(state.encoder?.flush?.()).catch(() => {}).finally(() => {
          try { state.encoder?.close?.(); } catch {}
        });
        state.port?.postMessage({ type: 'end-request' });

        // 传递编码数据给主系统进行编辑（仅在未建立流式通道时兜底一次性传递）
        console.log('[Stream][Content] end-request posted', { streamingReady, encodedChunks: state.encodedChunks.length });
        console.log('[Stream][Content] awaiting worker "end" to finalize...');

        if (!streamingReady && state.encodedChunks.length > 0) {
          transferToMainSystem();
        }
      } else {
        // 停止 MediaRecorder
        if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
          state.mediaRecorder.stop();
        }
      }
      // 停止媒体流
      if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    } finally {
      // WebCodecs 路径下不在此处立即清理，等待 worker 'end' 回调中 finalizeStop 执行
      if (!state.usingWebCodecs) {
        state.stream = null;
        state.track = null;
        state.mediaRecorder = null;
        state.encoder = null;
        state.processor = null;
        state.reader = null;
        try { state.worker?.terminate(); } catch {}
        if (state.workerBlobUrl) { try { URL.revokeObjectURL(state.workerBlobUrl); } catch {} }
        state.worker = null;
        state.workerBlobUrl = null;
        state.port = null;
        state.usingWebCodecs = false;
        state.recording = false;
        hidePreview();
        // WebCodecs 路径：主动报告
        report({ recording: false });
      }
    }
  }

  function clearSelection() {
    // 清理元素选择
    clearElementSelection();

    // 清理区域选择
    clearRegionSelection();

    // 清理原有的选择框
    if (state.selectionBox) {
      state.selectionBox.style.display = 'none';
      state.selectionBox.style.width = '0px';
      state.selectionBox.style.height = '0px';
    }

    report({ selectedDesc: undefined });
  }

  function downloadVideo() {
    if (!state.videoBlob) {
      console.warn('No video blob available for download');
      return;
    }

    // 创建下载链接
    const url = URL.createObjectURL(state.videoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `element-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // 清理 blob 数据
    state.videoBlob = null;
    state.recordedChunks = [];
    report({ hasVideo: false, videoUrl: null });
  }

  function showPreview() {
    if (state.preview) return;
    const box = document.createElement('div');
    box.className = 'mcp-preview';
    const bar = document.createElement('div'); bar.className = 'bar';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = '录制预览';
    const btns = document.createElement('div'); btns.className = 'btns';
    const btnMin = document.createElement('div'); btnMin.className = 'btn'; btnMin.textContent = '—';
    const btnClose = document.createElement('div'); btnClose.className = 'btn'; btnClose.textContent = '×';
    btns.append(btnMin, btnClose); bar.append(title, btns);
    const video = document.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true;
    video.srcObject = state.stream;
    box.append(bar, video);
    document.documentElement.appendChild(box);
    state.preview = box;

    // drag move
    let dragging = false; let dx=0, dy=0;
    bar.addEventListener('mousedown', (e) => {
      dragging = true; const r = box.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return; box.style.left = `${e.clientX - dx}px`; box.style.top = `${e.clientY - dy}px`; box.style.right = 'auto'; box.style.bottom = 'auto'; box.style.position = 'fixed';
    });
    window.addEventListener('mouseup', () => dragging = false);

    btnMin.addEventListener('click', () => {
      box.classList.toggle('min');
    });
    btnClose.addEventListener('click', () => {
      stopCapture();
    });
  }

  function hidePreview() {
    if (state.preview) {
      try { state.preview.remove(); } catch {}
      state.preview = null;
    }
  }

  // 传递录制数据给主系统进行编辑
  function transferToMainSystem() {
    try {
      console.log('🔄 [Element Recording] Transferring data to main system...', {
        chunks: state.encodedChunks.length,
        metadata: state.recordingMetadata
      });

      // 准备传递给主系统的数据（数据已经是数组格式，可以直接传递）
      const transferData = {
        type: 'ELEMENT_RECORDING_COMPLETE',
        data: {
          encodedChunks: state.encodedChunks, // 直接使用数组格式的数据
          metadata: state.recordingMetadata,
          source: 'element-recording'
        }
      };

      console.log('📤 [Element Recording] Transferring', state.encodedChunks.length, 'chunks');

      // 通过 background script 传递给主系统
      chrome.runtime.sendMessage(transferData, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ [Element Recording] Failed to transfer data:', chrome.runtime.lastError);
          return;
        }

        if (response?.success) {
          console.log('✅ [Element Recording] Data transferred successfully');
          // 清理本地数据
          state.encodedChunks = [];
          state.recordingMetadata = null;

          // 通知用户切换到编辑模式
          showEditingNotification();
        } else {
          console.error('❌ [Element Recording] Transfer failed:', response?.error);
        }
      });

    } catch (error) {
      console.error('❌ [Element Recording] Transfer error:', error);
    }
  }

  // 显示编辑模式通知
  function showEditingNotification() {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = 'mcp-edit-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <div class="notification-icon">🎬</div>
        <div class="notification-text">
          <div class="notification-title">录制完成</div>
          <div class="notification-desc">数据已传递到编辑系统，请在侧边栏查看</div>
        </div>
        <button class="notification-close">×</button>
      </div>
    `;

    // 添加样式
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 320px;
      animation: slideIn 0.3s ease-out;
    `;

    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      .notification-content {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }
      .notification-icon {
        font-size: 24px;
        flex-shrink: 0;
      }
      .notification-text {
        flex: 1;
      }
      .notification-title {
        font-weight: 600;
        font-size: 14px;
        margin-bottom: 4px;
      }
      .notification-desc {
        font-size: 12px;
        opacity: 0.9;
        line-height: 1.4;
      }
      .notification-close {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s;
      }
      .notification-close:hover {
        background-color: rgba(255,255,255,0.2);
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(notification);

    // 关闭按钮事件
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
      notification.remove();
      style.remove();
    });

    // 自动关闭
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
        style.remove();
      }
    }, 5000);
  }

  // 添加位置同步监听器
  window.addEventListener('scroll', syncElementContainer, { passive: true });
  window.addEventListener('resize', syncElementContainer, { passive: true });


  // ESC 取消：退出并清除选择
  function onEscKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      const hasSel = state.selecting || !!state.elementContainer || !!state.regionContainer || (state.selectionBox && state.selectionBox.style.display !== 'none');
      if (!hasSel) return;
      try { exitSelection(); } catch {}
      try { clearSelection(); } catch {}
      report({ selecting: false, selectedDesc: undefined });
      e.stopPropagation();
      e.preventDefault();
    }
  }
  window.addEventListener('keydown', onEscKey, true);

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'ENTER_SELECTION':
        state.mode = msg.mode || state.mode; enterSelection(); break;
      case 'EXIT_SELECTION':
        exitSelection(); break;
      case 'START_CAPTURE':
        startCapture(); break;
      case 'STOP_CAPTURE':
        stopCapture(); break;
      case 'CLEAR_SELECTION':
        clearSelection(); break;
      case 'DOWNLOAD_VIDEO':
        downloadVideo(); break;
      case 'STATE_UPDATE':
        // no-op for now
        break;
      case 'STREAMING_READY':
        streamingReady = true;
        console.log('[Stream][Content] STREAMING_READY received', { startTime: state.recordingMetadata?.startTime });
        break;
      default:
        break;
    }
  });
})();
