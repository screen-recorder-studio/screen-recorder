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
    // 编码数据收集
    encodedChunks: [],
    recordingMetadata: null
  };

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
        report({ selectedDesc: undefined });
      } else {
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
    if (state.selectedElement) state.selectedElement.classList.remove('mcp-selected');
    state.selectedElement = el;
    el.classList.add('mcp-selected');
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

      // Try Element Capture first if element mode
      if (state.mode === 'element' && state.selectedElement && typeof window.RestrictionTarget !== 'undefined') {
        try {
          const rt = await window.RestrictionTarget.fromElement(state.selectedElement);
          await state.track.restrictTo(rt);
        } catch (e) { console.warn('restrictTo failed, fallback to crop', e); }
      }

      // Then try CropTarget (element or region box)
      if (typeof window.CropTarget !== 'undefined') {
        try {
          let targetEl = null;
          if (state.mode === 'element') targetEl = state.selectedElement;
          else if (state.mode === 'region') targetEl = state.selectionBox;
          if (targetEl) {
            const ct = await window.CropTarget.fromElement(targetEl);
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

        // 建立与 background 的 Port
        state.port = chrome.runtime.connect({ name: 'encoded-stream' });
        state.port.postMessage({ type: 'start', codec: 'vp8', width, height, framerate });

        // 初始化 Dedicated Worker 承担编码职责
        // 通过 fetch -> Blob URL 创建 Worker，避免跨源构造限制
        const workerUrl = chrome.runtime.getURL('encoder-worker.js');
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
        state.worker.onmessage = (ev) => {
          const msg = ev.data || {};
          switch (msg.type) {
            case 'configured':
              console.log('[encoder-worker] configured', { codec: 'vp8', width, height, framerate });
              break;
            case 'chunk':
              try {
                state.chunkCount += 1;
                state.byteCount += (msg.size || 0);

                // 收集编码数据块用于后续编辑
                if (msg.data && msg.ts !== undefined) {
                  // 将数据转换为数组格式以便通过 Chrome 消息系统传递
                  const uint8Data = new Uint8Array(msg.data);
                  const dataArray = Array.from(uint8Data); // 转换为普通数组

                  state.encodedChunks.push({
                    data: dataArray, // 使用数组而不是 ArrayBuffer/Uint8Array
                    timestamp: msg.ts,
                    type: msg.kind === 'key' ? 'key' : 'delta',
                    size: msg.size || 0,
                    codedWidth: width,
                    codedHeight: height,
                    codec: 'vp8'
                  });
                }

                state.port?.postMessage({
                  type: 'chunk', ts: msg.ts, kind: msg.kind,
                  size: msg.size, head: msg.head, data: msg.data
                }, msg.data ? [msg.data] : undefined);
              } catch (err) {
                console.error('forward chunk failed', err);
              }
              break;
            case 'end':
              state.port?.postMessage({ type: 'end', chunks: state.chunkCount, bytes: state.byteCount });
              console.log(`🎬 [Element Recording] Collected ${state.encodedChunks.length} encoded chunks for editing`);
              break;
            case 'error':
              console.error('[encoder-worker] error', msg.message);
              state.port?.postMessage({ type: 'error', message: msg.message });
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

        // 传递编码数据给主系统进行编辑
        if (state.encodedChunks.length > 0) {
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

  function clearSelection() {
    if (state.selectedElement) state.selectedElement.classList.remove('mcp-selected');
    state.selectedElement = null;
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
      default:
        break;
    }
  });
})();
