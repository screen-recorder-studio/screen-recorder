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
      if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    } finally {
      state.stream = null; state.track = null; state.recording = false;
      hidePreview();
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
      case 'STATE_UPDATE':
        // no-op for now
        break;
      default:
        break;
    }
  });
})();