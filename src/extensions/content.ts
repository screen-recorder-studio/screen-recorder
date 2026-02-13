// @ts-nocheck

// content.js - injected on demand
(() => {
  if (window.__mcp_injected) return;
  window.__mcp_injected = true;

  const state = {
    mode: 'element',
    selecting: false,
    recording: false,
    paused: false,
    selectedElement: null,
    selectionBox: null,
    maskOverlay: null,
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
    chunkCount: 0,
    byteCount: 0,
    worker: null,
    workerBlobUrl: null,
    // iframe sink (probe) window for direct ArrayBuffer transfer logging
    sinkWin: null,
    sinkStarted: false,
    // 编码数据收集
    encodedChunks: [],
    recordingMetadata: null,
    // Countdown overlay for delayed start
    countdownOverlay: null,
    countdownTimer: null,
    countdownPending: false
  };

  // --- Selection Tips (popup triggers ENTER_SELECTION) ---
  let selectionTipEl = null as HTMLElement | null
  let selectionTipTimer: any = null
  function showSelectionTip(mode: 'element' | 'region') {
    try { hideSelectionTip() } catch {}
    const el = document.createElement('div')
    el.className = 'mcp-selection-tip'
    el.textContent = mode === 'element'
      ? '提示：点击页面中的一个元素完成选择，然后回到扩展弹窗点击“开始录制”。'
      : '提示：按住鼠标拖拽选择一个区域，然后回到扩展弹窗点击“开始录制”。'
    el.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'background:rgba(17,24,39,0.9)', 'color:#fff',
      'padding:8px 12px', 'border-radius:8px', 'font-size:12px', 'box-shadow:0 8px 24px rgba(0,0,0,.25)'
    ].join(';')
    document.documentElement.appendChild(el)
    selectionTipEl = el
    try { if (selectionTipTimer) clearTimeout(selectionTipTimer) } catch {}
    selectionTipTimer = setTimeout(() => { try { hideSelectionTip() } catch {} }, 3500)
  }
  function hideSelectionTip() {
    try { if (selectionTipTimer) clearTimeout(selectionTipTimer); selectionTipTimer = null } catch {}
    if (selectionTipEl) { try { selectionTipEl.remove() } catch {}; selectionTipEl = null }
  }


  // --- Bottom-centered floating control bar (for element/region recording) ---
  // lightweight state extensions
  (state as any).controlBar = null;
  (state as any).controlBarVisible = false;
  ;(state as any).barHideTimer = null as any;
  const BAR_BOTTOM_THRESHOLD = 64; // px from bottom to reveal while recording
  const BAR_HIDE_DELAY = 1500; // ms delay before hiding while recording

  function isInputLike(target: any): boolean {
    if (!(target instanceof Element)) return false;
    const tag = target.tagName?.toLowerCase() || '';
    if (['input','textarea','select','button'].includes(tag)) return true;
    // contentEditable or within editable
    if ((target as HTMLElement).isContentEditable) return true;
    const editable = (el: any) => !!el && (el.getAttribute && (el.getAttribute('contenteditable') === 'true'));
    return editable(target) || (!!target.closest && !!target.closest('[contenteditable="true"]'));
  }

  function ensureControlBar() {
    // If a control bar element already exists in DOM, reuse it
    const existing = document.querySelector('.mcp-control-bar') as HTMLElement | null;
    if (existing) { (state as any).controlBar = existing; return existing; }
    // Or reuse previously created if still connected under documentElement
    if ((state as any).controlBar && document.documentElement.contains((state as any).controlBar)) return (state as any).controlBar;

    const bar = document.createElement('div');
    bar.className = 'mcp-control-bar';
    bar.innerHTML = [
      '<div class="info"><span class="mode">—</span><span class="sp"> · </span><span class="desc">未选择</span></div>',
      '<button class="btn btn-pick-region">选区域</button>',
      '<button class="btn btn-pick-element">选元素</button>',
      '<button class="btn primary btn-start">开始录制</button>',
      '<button class="btn btn-pause" style="display:none">暂停</button>',
      '<button class="btn btn-resume" style="display:none">继续</button>',
      '<button class="btn danger btn-stop" style="display:none">停止</button>',
      '<button class="btn btn-close" style="display:none">关闭</button>'
    ].join('');
    // Append to body if available; fallback to documentElement
    const host = document.body || document.documentElement;
    host.appendChild(bar);
    (state as any).controlBar = bar;

    const onStart = () => { try { onBarStart(); } catch {} };
    const onPause = () => { try { onBarTogglePause(); } catch {} };
    const onResume = () => { try { onBarTogglePause(); } catch {} };
    const onStop = () => { try { onBarStop(); } catch {} };
    bar.querySelector('.btn-pick-region')?.addEventListener('click', onBarPickRegion);
    bar.querySelector('.btn-pick-element')?.addEventListener('click', onBarPickElement);
    bar.querySelector('.btn-start')?.addEventListener('click', onBarPrimary);
    bar.querySelector('.btn-pause')?.addEventListener('click', onPause);
    bar.querySelector('.btn-resume')?.addEventListener('click', onResume);
    bar.querySelector('.btn-stop')?.addEventListener('click', onStop);
    bar.querySelector('.btn-close')?.addEventListener('click', onBarClose);

    return bar;
  }

  function updateControlBar() {
    const bar = ensureControlBar();
    // info text
    try {
      const modeText = state.mode === 'region' ? '区域' : '元素';
      const desc = (state.mode === 'region' && state.selectionBox && state.selectionBox.style.display !== 'none')
        ? `${Math.round(parseFloat(state.selectionBox.style.width||'0'))}×${Math.round(parseFloat(state.selectionBox.style.height||'0'))}`
        : (state.selectedElement ? getElDesc(state.selectedElement) : (state.mode === 'region' && state.regionContainer ? '已选择区域' : '未选择'));
      bar.querySelector('.mode')!.textContent = modeText;
      bar.querySelector('.desc')!.textContent = desc || '未选择';
    } catch {}

    const btnStart = bar.querySelector('.btn-start') as HTMLButtonElement | null;
    const btnPause = bar.querySelector('.btn-pause') as HTMLButtonElement | null;
    const btnResume = bar.querySelector('.btn-resume') as HTMLButtonElement | null;
    const btnStop = bar.querySelector('.btn-stop') as HTMLButtonElement | null;
    const btnPickRegion = bar.querySelector('.btn-pick-region') as HTMLButtonElement | null;
    const btnPickElement = bar.querySelector('.btn-pick-element') as HTMLButtonElement | null;
    const btnClose = bar.querySelector('.btn-close') as HTMLButtonElement | null;

    const hasSelection = !!(state.elementRecordingTarget || state.regionRecordingTarget);

    if (!state.recording) {
      if (btnStart) { btnStart.style.display = 'inline-flex'; btnStart.disabled = !hasSelection; btnStart.textContent = '开始录制'; }
      if (btnPause) btnPause.style.display = 'none';
      if (btnResume) btnResume.style.display = 'none';
      if (btnStop) { btnStop.style.display = 'none'; }
      if (btnPickRegion) { btnPickRegion.style.display = 'inline-flex'; btnPickRegion.disabled = false; }
      if (btnPickElement) { btnPickElement.style.display = 'inline-flex'; btnPickElement.disabled = false; }
      if (btnClose) { btnClose.style.display = 'inline-flex'; }
    } else {
      if (btnStart) { btnStart.style.display = 'inline-flex'; btnStart.disabled = false; btnStart.textContent = '停止录制'; }
      if (state.paused) {
        if (btnPause) btnPause.style.display = 'none';
        if (btnResume) btnResume.style.display = 'inline-flex';
      } else {
        if (btnPause) { btnPause.style.display = 'inline-flex'; btnPause.disabled = false; }
        if (btnResume) btnResume.style.display = 'none';
      }
      if (btnStop) { btnStop.style.display = 'none'; }
      if (btnPickRegion) btnPickRegion.style.display = 'none';
      if (btnPickElement) btnPickElement.style.display = 'none';
      if (btnClose) btnClose.style.display = 'none';
    }
  }

  function showControlBar(forceVisible = false) {
    const bar = ensureControlBar();
    if (!(state as any).controlBarVisible || forceVisible) {
      bar.classList.add('visible');
      (state as any).controlBarVisible = true;
      updateControlBar();
    }
  }

  function hideControlBar(immediate = false) {
    const bar = ensureControlBar();
    if (immediate) {
      bar.classList.remove('visible');
      (state as any).controlBarVisible = false;
      return;
    }
    // animate hide
    bar.classList.remove('visible');
    (state as any).controlBarVisible = false;
  }

  function scheduleBarAutoHide() {
    try { if ((state as any).barHideTimer) clearTimeout((state as any).barHideTimer) } catch {}
    if (state.recording && !state.paused) {
      (state as any).barHideTimer = setTimeout(() => hideControlBar(false), BAR_HIDE_DELAY);
    }
  }

  function onMouseMoveReveal(e: MouseEvent) {
    // During recording, keep control bar visible (no auto-hide)
    if (!state.recording) return;
    showControlBar(true);
  }

  function onHotkeys(e: KeyboardEvent) {
    if (isInputLike(e.target)) return; // don't interfere with typing
    // ESC handled by existing onEscKey
    if ((e.key === 'Enter' || e.code === 'Enter') && !state.recording) {
      const hasSelection = !!(state.elementRecordingTarget || state.regionRecordingTarget);
      if (!hasSelection) return;
      e.preventDefault(); onBarStart(); return;
    }
    if ((e.key === ' ' || e.code === 'Space') && state.recording) {
      e.preventDefault(); onBarTogglePause(); return;
    }
    if ((e.key?.toLowerCase?.() === 's' || e.code === 'KeyS') && (e.shiftKey || e.altKey) && state.recording) {
      // Use Shift+S or Alt+S to avoid clashing with browser save
      e.preventDefault(); onBarStop(); return;
    }
  }

  function onBarPrimary() {
    if (!state.recording) { try { onBarStart(); } catch {} }
    else { try { onBarStop(); } catch {} }
  }
  function onBarStart() {
    if (!state.recording) { try { startCapture(); } catch {} }
  }
  function onBarTogglePause() {
    if (state.recording) { try { setPaused(!state.paused); updateControlBar(); } catch {} }
  }
  function onBarStop() {
    if (state.recording) { try { stopCapture(); } catch {} }
  }
  function onBarPickRegion() {
    if (state.recording) return;
    try { clearSelection(); } catch {}
    state.mode = 'region';
    try { enterSelection(); } catch {}
    try { showControlBar(true); updateControlBar(); } catch {}
  }
  function onBarPickElement() {
    if (state.recording) return;
    try { clearSelection(); } catch {}
    state.mode = 'element';
    try { enterSelection(); } catch {}
    try { showControlBar(true); updateControlBar(); } catch {}
  }
  function onBarClose() {
    try { hideControlBar(true); } catch {}
  }

  // attach global listeners once
  window.addEventListener('mousemove', onMouseMoveReveal, { passive: true });
  window.addEventListener('keydown', onHotkeys, true);

	  // keep element container synced on scroll/resize while selected
	  window.addEventListener('scroll', () => { try { syncElementContainer(); } catch {} }, true);
	  window.addEventListener('resize', () => { try { syncElementContainer(); } catch {} });



	  // 流式累积是否就绪（sidepanel注册后由 background 通知）
	  let streamingReady = false;


  // Root overlay
  const root = document.createElement('div');
  root.className = 'mcp-ext-root';
  document.documentElement.appendChild(root);
  state.root = root;

  // --- Tab annotation overlay (toolbar + canvas) ---
  let annotationCanvas = null;
  let annotationToolbar = null;
  let isAnnotationMode = false;
  let annotations = [] as any[];
  let currentTool = 'arrow';
  let currentColor = '#ff0000';
  let currentLineWidth = 3;
  let isDrawing = false;
  let startPoint = { x: 0, y: 0 };
  let currentPath: any[] = [];

  function selectTool(tool: string) {
    currentTool = tool;
  }

  function clearAllAnnotations() {
    annotations = [];
    if (annotationCanvas) {
      const ctx = annotationCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    }
  }

  function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, lineWidth: number) {
    const headLength = 15;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  function createMosaicPattern(ctx: CanvasRenderingContext2D) {
    // Create a small offscreen canvas to generate the pattern
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 10;
    patternCanvas.height = 10;
    const pCtx = patternCanvas.getContext('2d');
    if (!pCtx) return null;

    // Fill with random grey squares to simulate censorship mosaic
    for (let x = 0; x < 10; x += 5) {
      for (let y = 0; y < 10; y += 5) {
        const grey = Math.floor(Math.random() * 55 + 200); // Light grey range
        pCtx.fillStyle = `rgb(${grey}, ${grey}, ${grey})`;
        pCtx.fillRect(x, y, 5, 5);
      }
    }
    return ctx.createPattern(patternCanvas, 'repeat');
  }

  function redrawAllAnnotations() {
    if (!annotationCanvas) return;
    const ctx = annotationCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

    for (const ann of annotations) {
      if (ann.tool === 'rectangle') {
        const [p1, p2] = ann.points;
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.lineWidth;
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      } else if (ann.tool === 'circle') {
        const [p1, p2] = ann.points;
        const radius = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.lineWidth;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ann.tool === 'arrow') {
        const [p1, p2] = ann.points;
        drawArrow(ctx, p1.x, p1.y, p2.x, p2.y, ann.color, ann.lineWidth);
      } else if (ann.tool === 'freehand') {
        ctx.strokeStyle = ann.color;
        ctx.lineWidth = ann.lineWidth;
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.stroke();
      } else if (ann.tool === 'text') {
        ctx.fillStyle = ann.color;
        ctx.font = '24px Arial';
        ctx.fillText(ann.text || '', ann.points[0].x, ann.points[0].y);
      } else if (ann.tool === 'highlight') {
        const [p1, p2] = ann.points;
        ctx.fillStyle = ann.color + '40';
        ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      } else if (ann.tool === 'blur') {
        const [p1, p2] = ann.points;
        const pattern = createMosaicPattern(ctx);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
          // Add a border to define the area
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 1;
          ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        } else {
          // Fallback
          ctx.fillStyle = '#000000';
          ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        }
      }
    }
  }

  function ensureAnnotationCanvas() {
    if (annotationCanvas && document.body.contains(annotationCanvas)) return annotationCanvas;
    const canvas = document.createElement('canvas');
    canvas.id = 'screen-recorder-annotation-canvas';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 2147483646;
      pointer-events: none;
      display: none;
      cursor: default;
    `;

    const host = document.body || document.documentElement;
    host.appendChild(canvas);
    annotationCanvas = canvas;

    if (!(canvas as any).__annotationBound) {
      canvas.addEventListener('mousedown', (e) => {
        if (!isAnnotationMode) return;
        isDrawing = true;
        startPoint = { x: e.clientX, y: e.clientY };
        currentPath = [{ x: e.clientX, y: e.clientY }];

        if (currentTool === 'text') {
          // Modern floating input instead of prompt
          const input = document.createElement('div');
          input.contentEditable = 'true';
          input.style.cssText = `
            position: fixed;
            left: ${e.clientX}px;
            top: ${e.clientY - 12}px; /* Center vertically relative to mouse */
            z-index: 2147483650;
            color: ${currentColor};
            font: 24px Arial;
            background: rgba(0, 0, 0, 0.1);
            border: 1px dashed rgba(255, 255, 255, 0.5);
            padding: 4px;
            min-width: 20px;
            outline: none;
            white-space: nowrap;
            cursor: text;
          `;
          
          document.body.appendChild(input);
          
          // Use setTimeout to ensure element is mounted before focusing
          setTimeout(() => input.focus(), 0);

          const finish = () => {
            const text = input.innerText.trim();
            if (text) {
              annotations.push({
                tool: 'text',
                points: [{ x: e.clientX, y: e.clientY }],
                color: currentColor,
                lineWidth: currentLineWidth,
                text
              });
              redrawAllAnnotations();
            }
            cleanup();
          };

          const cleanup = () => {
            if (input.parentNode) input.parentNode.removeChild(input);
          };

          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              input.blur(); // Triggers blur handler
            } else if (ev.key === 'Escape') {
              cleanup();
            }
          });

          input.addEventListener('blur', () => {
            finish();
          });

          isDrawing = false;
        }
      });

      canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || !isAnnotationMode) return;
        if (currentTool === 'freehand') {
          currentPath.push({ x: e.clientX, y: e.clientY });
        }
        redrawAllAnnotations();
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        const width = e.clientX - startPoint.x;
        const height = e.clientY - startPoint.y;

        if (currentTool === 'rectangle') {
          // Draw outline
          ctx.strokeStyle = currentColor;
          ctx.lineWidth = currentLineWidth;
          ctx.strokeRect(startPoint.x, startPoint.y, width, height);
          
          // Enhanced preview: Fill with transparent color to mimic "Highlight" feel
          ctx.fillStyle = currentColor + '20'; 
          ctx.fillRect(startPoint.x, startPoint.y, width, height);

        } else if (currentTool === 'circle') {
          const radius = Math.sqrt(width * width + height * height);
          
          ctx.beginPath();
          ctx.arc(startPoint.x, startPoint.y, radius, 0, Math.PI * 2);
          
          // Enhanced preview: Fill with transparent color
          ctx.fillStyle = currentColor + '20';
          ctx.fill();
          
          // Draw outline
          ctx.strokeStyle = currentColor;
          ctx.lineWidth = currentLineWidth;
          ctx.stroke();

        } else if (currentTool === 'arrow') {
          drawArrow(ctx, startPoint.x, startPoint.y, e.clientX, e.clientY, currentColor, currentLineWidth);
        } else if (currentTool === 'freehand') {
          ctx.strokeStyle = currentColor;
          ctx.lineWidth = currentLineWidth;
          ctx.beginPath();
          ctx.moveTo(currentPath[0].x, currentPath[0].y);
          for (let i = 1; i < currentPath.length; i++) {
            ctx.lineTo(currentPath[i].x, currentPath[i].y);
          }
          ctx.stroke();
        } else if (currentTool === 'highlight') {
          ctx.fillStyle = currentColor + '40';
          ctx.fillRect(startPoint.x, startPoint.y, width, height);
        } else if (currentTool === 'blur') {
          // Real-time preview for blur/block tool
          // Use semi-transparent black to show the area being masked
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(startPoint.x, startPoint.y, width, height);
          
          // Optional: Add a thin dashed outline for better visibility against dark backgrounds
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(startPoint.x, startPoint.y, width, height);
        }
        ctx.restore();
      });

      canvas.addEventListener('mouseup', (e) => {
        if (!isDrawing || !isAnnotationMode) return;
        isDrawing = false;

        if (currentTool === 'rectangle') {
          annotations.push({
            tool: 'rectangle',
            points: [startPoint, { x: e.clientX, y: e.clientY }],
            color: currentColor,
            lineWidth: currentLineWidth
          });
        } else if (currentTool === 'circle') {
          annotations.push({
            tool: 'circle',
            points: [startPoint, { x: e.clientX, y: e.clientY }],
            color: currentColor,
            lineWidth: currentLineWidth
          });
        } else if (currentTool === 'arrow') {
          annotations.push({
            tool: 'arrow',
            points: [startPoint, { x: e.clientX, y: e.clientY }],
            color: currentColor,
            lineWidth: currentLineWidth
          });
        } else if (currentTool === 'freehand') {
          annotations.push({
            tool: 'freehand',
            points: currentPath,
            color: currentColor,
            lineWidth: currentLineWidth
          });
        } else if (currentTool === 'highlight') {
          annotations.push({
            tool: 'highlight',
            points: [startPoint, { x: e.clientX, y: e.clientY }],
            color: currentColor,
            lineWidth: currentLineWidth
          });
        } else if (currentTool === 'blur') {
          annotations.push({
            tool: 'blur',
            points: [startPoint, { x: e.clientX, y: e.clientY }],
            color: '#000000',
            lineWidth: 0
          });
        }

        redrawAllAnnotations();
      });

      (canvas as any).__annotationBound = true;
    }

    return canvas;
  }

  function ensureAnnotationToolbar() {
    if (annotationToolbar && document.body.contains(annotationToolbar)) return annotationToolbar;
    const toolbar = document.createElement('div');
    toolbar.id = 'screen-recorder-annotation-toolbar';
    toolbar.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(20, 20, 20, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 8px 12px;
      display: none;
      align-items: center;
      gap: 4px;
      backdrop-filter: blur(16px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      transition: opacity 0.2s;
    `;

    // SVG Icons
    const icons = {
      cursor: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/></svg>',
      effect: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
      arrow: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
      rectangle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
      circle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>',
      freehand: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
      text: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>',
      highlight: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 2-2.6 2.6a1 1 0 0 1-1.4 0l-2-2a1 1 0 0 1 0-1.4L18.6 2a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4Z"/></svg>',
      blur: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>',
      undo: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
      clear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
      close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
    };

    // --- Cursor Effects Logic ---
    let cursorEffectsActive = false;
    let haloEl: HTMLDivElement | null = null;
    let styleEl: HTMLStyleElement | null = null;

    const toggleCursorEffects = (enable?: boolean) => {
      const shouldEnable = enable !== undefined ? enable : !cursorEffectsActive;
      
      if (shouldEnable) {
        if (cursorEffectsActive) return; // Already active
        cursorEffectsActive = true;

        // 1. Inject Styles
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.textContent = `
            .mcp-cursor-halo {
              position: fixed;
              top: 0; left: 0;
              width: 40px; height: 40px;
              margin-left: -20px; margin-top: -20px;
              background: rgba(255, 215, 0, 0.4);
              border: 2px solid rgba(255, 215, 0, 0.8);
              border-radius: 50%;
              pointer-events: none;
              z-index: 2147483645; /* Below canvas, above page */
              box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
              will-change: transform;
            }
            .mcp-click-ripple {
              position: fixed;
              border-radius: 50%;
              background: transparent;
              border: 3px solid rgba(255, 215, 0, 0.8);
              transform: scale(0.2);
              opacity: 1;
              pointer-events: none;
              z-index: 2147483645;
              will-change: transform, opacity, border-width;
              animation: mcp-ripple 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
              box-shadow: 0 0 8px rgba(255, 215, 0, 0.4);
            }
            @keyframes mcp-ripple {
              to { 
                transform: scale(3.0); 
                opacity: 0; 
                border-width: 0px;
              }
            }
          `;
          document.head.appendChild(styleEl);
        }

        // 2. Create Halo
        haloEl = document.createElement('div');
        haloEl.className = 'mcp-cursor-halo';
        // Initialize off-screen
        haloEl.style.display = 'none';
        document.body.appendChild(haloEl);

        // 3. Event Listeners
        let mouseX = 0, mouseY = 0;
        let rAFId: number | null = null;

        const updateHalo = () => {
          if (!haloEl) return;
          haloEl.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
          rAFId = null;
        };

        const onMove = (e: MouseEvent) => {
          if (!haloEl) return;
          if (haloEl.style.display === 'none') haloEl.style.display = 'block';
          
          mouseX = e.clientX;
          mouseY = e.clientY;

          if (rAFId === null) {
            rAFId = requestAnimationFrame(updateHalo);
          }
        };

        const onClick = (e: MouseEvent) => {
          const ripple = document.createElement('div');
          ripple.className = 'mcp-click-ripple';
          const size = 30;
          ripple.style.width = `${size}px`;
          ripple.style.height = `${size}px`;
          ripple.style.left = `${e.clientX - size/2}px`;
          ripple.style.top = `${e.clientY - size/2}px`;
          document.body.appendChild(ripple);
          ripple.addEventListener('animationend', () => ripple.remove());
        };

        window.addEventListener('mousemove', onMove, { passive: true, capture: true });
        window.addEventListener('mousedown', onClick, { passive: true, capture: true });

        // Store cleanup function on the DOM element for retrieval
        (haloEl as any).__cleanup = () => {
          window.removeEventListener('mousemove', onMove, { capture: true });
          window.removeEventListener('mousedown', onClick, { capture: true });
          if (rAFId !== null) cancelAnimationFrame(rAFId);
          if (haloEl) haloEl.remove();
          if (styleEl) styleEl.remove();
          haloEl = null;
          styleEl = null;
        };

      } else {
        if (!cursorEffectsActive) return; // Already inactive
        cursorEffectsActive = false;
        if (haloEl && (haloEl as any).__cleanup) {
          (haloEl as any).__cleanup();
        }
      }
    };

    // Override disableAnnotationMode to also clean up effects
    const originalDisable = disableAnnotationMode;
    disableAnnotationMode = () => {
      toggleCursorEffects(false); // Force disable effects
      originalDisable();
    };


    const tools = [
      { name: 'cursor', icon: icons.cursor, title: chrome.i18n.getMessage('annotation_tool_cursor'), isToggle: false },
      // New Effect Button
      { name: 'effect', icon: icons.effect, title: chrome.i18n.getMessage('annotation_tool_effect'), isToggle: true },
      { name: 'arrow', icon: icons.arrow, title: chrome.i18n.getMessage('annotation_tool_arrow'), isToggle: false },
      { name: 'rectangle', icon: icons.rectangle, title: chrome.i18n.getMessage('annotation_tool_rectangle'), isToggle: false },
      { name: 'circle', icon: icons.circle, title: chrome.i18n.getMessage('annotation_tool_circle'), isToggle: false },
      { name: 'freehand', icon: icons.freehand, title: chrome.i18n.getMessage('annotation_tool_freehand'), isToggle: false },
      { name: 'text', icon: icons.text, title: chrome.i18n.getMessage('annotation_tool_text'), isToggle: false },
      { name: 'highlight', icon: icons.highlight, title: chrome.i18n.getMessage('annotation_tool_highlight'), isToggle: false },
      { name: 'blur', icon: icons.blur, title: chrome.i18n.getMessage('annotation_tool_blur'), isToggle: false }
    ];

    let activeBtn: HTMLButtonElement | null = null;
    currentTool = 'cursor'; // Reset to cursor on init

    // 1. Drawing Tools Group
    tools.forEach(tool => {
      const btn = document.createElement('button');
      btn.innerHTML = tool.icon;
      btn.title = tool.title;
      btn.style.cssText = `
        width: 40px;
        height: 40px;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.6);
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      `;
      
      btn.onmouseenter = () => { 
        if (tool.isToggle && cursorEffectsActive) return; // Don't change background if active toggle
        if(activeBtn !== btn) btn.style.background = 'rgba(255,255,255,0.1)'; 
      };
      btn.onmouseleave = () => { 
        if (tool.isToggle && cursorEffectsActive) return; // Don't change background if active toggle
        if(activeBtn !== btn) btn.style.background = 'transparent'; 
      };

      if (tool.name === currentTool) {
        btn.style.background = 'rgba(255, 255, 255, 0.2)';
        btn.style.color = '#fff';
        activeBtn = btn;
      }

      btn.onclick = () => {
        // Special handling for Effect toggle
        if (tool.isToggle) {
          toggleCursorEffects();
          if (cursorEffectsActive) {
            btn.style.background = 'rgba(255, 215, 0, 0.2)'; // Gold tint for active effect
            btn.style.color = '#ffd700';
          } else {
            btn.style.background = 'transparent';
            btn.style.color = 'rgba(255, 255, 255, 0.6)';
          }
          return;
        }

        selectTool(tool.name);
        
        if (annotationCanvas) {
          if (tool.name === 'cursor') {
            annotationCanvas.style.pointerEvents = 'none';
            annotationCanvas.style.cursor = 'default';
          } else {
            annotationCanvas.style.pointerEvents = 'auto';
            annotationCanvas.style.cursor = 'crosshair';
          }
        }

        if (activeBtn) {
          activeBtn.style.background = 'transparent';
          activeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
        }
        btn.style.background = 'rgba(255, 255, 255, 0.2)';
        btn.style.color = '#fff';
        activeBtn = btn;
      };
      toolbar.appendChild(btn);
    });

    // Separator
    const sep = document.createElement('div');
    sep.style.cssText = `
      width: 1px;
      height: 24px;
      background: rgba(255, 255, 255, 0.15);
      margin: 0 6px;
    `;
    toolbar.appendChild(sep);

    // 2. Color Picker
    const colorWrapper = document.createElement('div');
    colorWrapper.style.cssText = `
      position: relative;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      overflow: hidden;
      border: 2px solid rgba(255,255,255,0.2);
      cursor: pointer;
      margin-right: 4px;
    `;
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = '#ff0000';
    colorPicker.style.cssText = `
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      cursor: pointer;
      border: none;
      padding: 0;
      margin: 0;
    `;
    colorPicker.onchange = (e) => {
      currentColor = (e.target as HTMLInputElement).value;
      colorWrapper.style.borderColor = currentColor;
    };
    colorWrapper.appendChild(colorPicker);
    toolbar.appendChild(colorWrapper);

    // 3. Utility Buttons (Undo, Clear, Close)
    const createUtilBtn = (icon: string, title: string, action: () => void, isDestructive = false) => {
      const btn = document.createElement('button');
      btn.innerHTML = icon;
      btn.title = title;
      btn.style.cssText = `
        width: 40px;
        height: 40px;
        border: none;
        background: transparent;
        color: ${isDestructive ? '#ff6b6b' : 'rgba(255, 255, 255, 0.6)'};
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      `;
      btn.onmouseenter = () => btn.style.background = isDestructive ? 'rgba(255, 107, 107, 0.1)' : 'rgba(255, 255, 255, 0.1)';
      btn.onmouseleave = () => btn.style.background = 'transparent';
      btn.onclick = action;
      return btn;
    };

    toolbar.appendChild(createUtilBtn(icons.undo, chrome.i18n.getMessage('annotation_tool_undo'), () => {
      annotations.pop();
      redrawAllAnnotations();
    }));

    toolbar.appendChild(createUtilBtn(icons.clear, chrome.i18n.getMessage('annotation_tool_clear'), () => clearAllAnnotations(), true));
    
    // Separator
    const sep2 = document.createElement('div');
    sep2.style.cssText = `
      width: 1px;
      height: 24px;
      background: rgba(255, 255, 255, 0.15);
      margin: 0 6px;
    `;
    toolbar.appendChild(sep2);

    // Close Button
    toolbar.appendChild(createUtilBtn(icons.close, chrome.i18n.getMessage('annotation_tool_close'), () => disableAnnotationMode()));

    const host = document.body || document.documentElement;
    host.appendChild(toolbar);
    annotationToolbar = toolbar;
    return toolbar;
  }

  function handleAnnotationResize() {
    if (!annotationCanvas) return;
    annotationCanvas.width = window.innerWidth;
    annotationCanvas.height = window.innerHeight;
    redrawAllAnnotations();
  }

  function enableAnnotationMode() {
    const canvas = ensureAnnotationCanvas();
    const toolbar = ensureAnnotationToolbar();
    isAnnotationMode = true;
    if (canvas) {
      canvas.style.display = 'block';
      handleAnnotationResize();
      redrawAllAnnotations();
    }
    if (toolbar) toolbar.style.display = 'flex';
  }

  function disableAnnotationMode() {
    isAnnotationMode = false;
    isDrawing = false;
    currentPath = [];
    clearAllAnnotations();
    if (annotationCanvas) annotationCanvas.style.display = 'none';
    if (annotationToolbar) annotationToolbar.style.display = 'none';
  }

  window.addEventListener('resize', () => {
    if (isAnnotationMode) handleAnnotationResize();
  });

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
  // Safe messaging helpers: background via sendMessage; sink via window.postMessage
  function safePortPost(msg: any) {
    try { chrome.runtime.sendMessage(msg); }
    catch (e) { console.warn('[Stream][Content] sendMessage failed', e); }
  }
  function safeSinkPost(msg: any, transfer?: Transferable[]) {
    try {
      if (transfer && transfer.length) { state.sinkWin?.postMessage(msg, '*', transfer); }
      else { state.sinkWin?.postMessage(msg, '*'); }
    } catch (e) { console.warn('[Stream][Content] sink post failed', e); }

	  // Badge elapsed timer for element/region recording; drives BADGE_TICK for background
	  let badgeTicker: any = null;
	  let badgeAccumMs = 0;
	  let badgeLastStart: number | null = null;

	  function resetBadgeTicker() {
	    try { if (badgeTicker) clearInterval(badgeTicker); } catch {}
	    badgeTicker = null;
	    badgeAccumMs = 0;
	    badgeLastStart = null;
	  }

	  function startBadgeTicker() {
	    resetBadgeTicker();
	    badgeLastStart = Date.now();
	    try { safePortPost({ type: 'BADGE_TICK', elapsedMs: 0, source: 'content', mode: state.mode }); } catch {}
	    badgeTicker = setInterval(() => {
	      if (!state.recording) return;
	      const extra = (!state.paused && badgeLastStart != null) ? Date.now() - badgeLastStart : 0;
	      const elapsedMs = badgeAccumMs + extra;
	      try { safePortPost({ type: 'BADGE_TICK', elapsedMs, source: 'content', mode: state.mode }); } catch {}
	    }, 1000);
	  }

	  function pauseBadgeTicker() {
	    if (badgeLastStart != null) {
	      badgeAccumMs += Date.now() - badgeLastStart;
	      badgeLastStart = null;
	    }
	  }

	  function resumeBadgeTicker() {
	    if (badgeLastStart == null) badgeLastStart = Date.now();
	  }

	  function stopBadgeTicker() {
	    resetBadgeTicker();
	  }

  }

  // Badge elapsed timer for element/region recording; drives BADGE_TICK for background
  let badgeTickerContent: any = null;
  let badgeAccumMsContent = 0;
  let badgeLastStartContent: number | null = null;

  function resetBadgeTimerContent() {
    try { if (badgeTickerContent) clearInterval(badgeTickerContent); } catch {}
    badgeTickerContent = null;
    badgeAccumMsContent = 0;
    badgeLastStartContent = null;
  }

  function startBadgeTimerContent() {
    resetBadgeTimerContent();
    badgeLastStartContent = Date.now();
    try { safePortPost({ type: 'BADGE_TICK', elapsedMs: 0, source: 'content', mode: state.mode }); } catch {}
    badgeTickerContent = setInterval(() => {
      if (!state.recording) return;
      const extra = (!state.paused && badgeLastStartContent != null) ? Date.now() - badgeLastStartContent : 0;
      const elapsedMs = badgeAccumMsContent + extra;
      try { safePortPost({ type: 'BADGE_TICK', elapsedMs, source: 'content', mode: state.mode }); } catch {}
    }, 1000);
  }

  function pauseBadgeTimerContent() {
    if (badgeLastStartContent != null) {
      badgeAccumMsContent += Date.now() - badgeLastStartContent;
      badgeLastStartContent = null;
    }
  }

  function resumeBadgeTimerContent() {
    if (badgeLastStartContent == null) badgeLastStartContent = Date.now();
  }

  function stopBadgeTimerContent() {
    resetBadgeTimerContent();
  }

  // Pause/Resume helper for element/region recording
  function setPaused(p) {
    try {
      if (!state.recording) return;
      state.paused = !!p;
      if (state.paused) {
        pauseBadgeTimerContent();
      } else {
        resumeBadgeTimerContent();
      }
      // Control MediaRecorder path if used
      if (!state.usingWebCodecs && state.mediaRecorder) {
        try {
          if (state.paused && state.mediaRecorder.state === 'recording') {
            state.mediaRecorder.pause();
          } else if (!state.paused && state.mediaRecorder.state === 'paused') {
            state.mediaRecorder.resume();
          }
        } catch {}
      }
      // Update control bar visibility/state (always visible during recording)
      try { showControlBar(true); updateControlBar(); } catch {}
      // Notify background/popup about pause state
      safePortPost({ type: 'STREAM_META', meta: { paused: state.paused } });
    } catch {}
  }




  // Ensure extension iframe sink (offscreen.html?mode=iframe) is present and handshaked
  async function ensureSinkIframe() {
    try {
      if (state.sinkWin && typeof state.sinkWin.postMessage === 'function') return state.sinkWin;
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:1px; height:1px; opacity:0; border:0; z-index:2147483647;';
      iframe.src = chrome.runtime.getURL('opfs-writer.html?mode=iframe');
      document.documentElement.appendChild(iframe);
      await new Promise((r) => iframe.onload = r);
      const win = iframe.contentWindow;
      if (!win) return null;
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 4000);
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
    try { updateMaskRect(rect.left, rect.top, rect.width, rect.height); } catch {}
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


  // --- Mask overlay (visual background dim with a rectangular hole) ---
  function ensureMaskOverlay() {
    try {
      if (state.maskOverlay && document.documentElement.contains(state.maskOverlay)) return state.maskOverlay;
      const el = document.createElement('div');
      el.className = 'mcp-mask-overlay';
      el.style.cssText = [
        'position:fixed', 'inset:0',
        // Visual dim
        'background:rgba(0,0,0,0.35)',
        // Keep it below selection containers and control bar
        'z-index:2147482998',
        // Visual-only by default; avoid interfering with existing handlers
        'pointer-events:none',
        // -webkit-mask: full-screen minus hole at (--mcp-mask-x, --mcp-mask-y) sized (--mcp-mask-w x --mcp-mask-h)
        '-webkit-mask-image:linear-gradient(#fff 0 0),linear-gradient(#fff 0 0)',
        '-webkit-mask-size:cover,var(--mcp-mask-w,0px) var(--mcp-mask-h,0px)',
        '-webkit-mask-position:0 0,var(--mcp-mask-x,-99999px) var(--mcp-mask-y,-99999px)',
        '-webkit-mask-repeat:no-repeat',
        // Subtract second mask from the first (Chromium)
        '-webkit-mask-composite:xor'
      ].join(';');
      state.root.appendChild(el);
      state.maskOverlay = el;
      return el;
    } catch (_) { return null; }
  }
  function showMask() {
    try { const el = ensureMaskOverlay(); if (el) el.style.display = 'block'; } catch {}
  }
  function hideMask() {
    try { if (state.maskOverlay) { state.maskOverlay.style.display = 'none'; } } catch {}
  }
  function updateMaskRect(x, y, w, h) {
    try {
      const el = ensureMaskOverlay(); if (!el) return;
      el.style.setProperty('--mcp-mask-x', `${Math.max(0, Math.round(x))}px`);
      el.style.setProperty('--mcp-mask-y', `${Math.max(0, Math.round(y))}px`);
      el.style.setProperty('--mcp-mask-w', `${Math.max(0, Math.round(w))}px`);
      el.style.setProperty('--mcp-mask-h', `${Math.max(0, Math.round(h))}px`);
      showMask();
    } catch {}
  }
  function updateMaskForElement(el) {
    try {
      if (!el || !(el instanceof Element)) return;
      const r = el.getBoundingClientRect();
      updateMaskRect(r.left, r.top, r.width, r.height);
    } catch {}
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
      try { updateMaskRect(state.startX, state.startY, 0, 0); } catch {}
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
      try { updateMaskRect(x, y, w, h); } catch {}
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

        // 固定遮罩洞到选区
        try { updateMaskRect(x, y, w, h); showMask(); } catch {}
        report({ selectedDesc: `区域 ${Math.round(w)}×${Math.round(h)}` });
        // 区域选择完成后，自动退出选择态，并移除拖拽遮罩，防止继续选中内部
        state.selecting = false;
        if (dragOverlay) { try { dragOverlay.remove(); } catch(_){} dragOverlay = null; }
        report({ selecting: false });
        hideSelectionTip();
        // 预热通信 iframe，降低 startCapture 阶段等待
        ensureSinkIframe().catch(() => {});
        // 显示底部控制条，便于直接开始/暂停/停止
        try { showControlBar(true); } catch {}

      }
    }, true);

    return overlay;
  }

  let dragOverlay = null;

  function enterSelection() {
    // 清理可能重复的监听，避免切换模式时重复绑定
    document.removeEventListener('mouseover', onHover, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('click', onClick, true);

    state.selecting = true;
    try { ensureMaskOverlay(); showMask(); updateMaskRect(-99999, -99999, 0, 0); } catch {}
    if (state.mode === 'region') {
      dragOverlay = dragOverlay || addDragOverlay();
    } else {
      // element mode: highlight on hover
      document.addEventListener('mouseover', onHover, true);
      document.addEventListener('mouseout', onOut, true);
      document.addEventListener('click', onClick, true);
    }
    showSelectionTip(state.mode === 'region' ? 'region' : 'element');
    report({});
  }

  function exitSelection() {
    state.selecting = false;
    try { hideMask(); } catch {}
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
    hideSelectionTip();
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
    try { updateMaskForElement(el); } catch {}
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
    try { updateMaskForElement(el); showMask(); } catch {}
    // 选择完成后自动退出选择态，避免继续在内部再次选择
    state.selecting = false;
    document.removeEventListener('mouseover', onHover, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('click', onClick, true);

	  // Badge elapsed timer for element/region recording; drives BADGE_TICK for background
	  let badgeTickerContent: any = null;
	  let badgeAccumMsContent = 0;
	  let badgeLastStartContent: number | null = null;

	  function resetBadgeTimerContent() {
	    try { if (badgeTickerContent) clearInterval(badgeTickerContent); } catch {}
	    badgeTickerContent = null;
	    badgeAccumMsContent = 0;
	    badgeLastStartContent = null;
	  }

	  function startBadgeTimerContent() {
	    resetBadgeTimerContent();
	    badgeLastStartContent = Date.now();
	    try { safePortPost({ type: 'BADGE_TICK', elapsedMs: 0, source: 'content', mode: state.mode }); } catch {}
	    badgeTickerContent = setInterval(() => {
	      if (!state.recording) return;
	      const extra = (!state.paused && badgeLastStartContent != null) ? Date.now() - badgeLastStartContent : 0;
	      const elapsedMs = badgeAccumMsContent + extra;
	      try { safePortPost({ type: 'BADGE_TICK', elapsedMs, source: 'content', mode: state.mode }); } catch {}
	    }, 1000);
	  }

	  function pauseBadgeTimerContent() {
	    if (badgeLastStartContent != null) {
	      badgeAccumMsContent += Date.now() - badgeLastStartContent;
	      badgeLastStartContent = null;
	    }
	  }

	  function resumeBadgeTimerContent() {
	    if (badgeLastStartContent == null) badgeLastStartContent = Date.now();
	  }

	  function stopBadgeTimerContent() {
	    resetBadgeTimerContent();
	  }

    report({ selecting: false });
    // 显示底部控制条，便于直接开始/暂停/停止
    try { showControlBar(true); } catch {}

    hideSelectionTip();
    // 预热通信 iframe，降低 startCapture 阶段等待
    ensureSinkIframe().catch(() => {});
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
    report({ selectedDesc: `Element ${getElDesc(el)}` });
  }


  // (inline countdown helpers removed - unified popup countdown handled by background)

  async function startCapture() {
    if (state.recording) return;
    try {
      state.recording = true;
      startBadgeTimerContent();
      // Show control bar and update state during recording (no auto-hide)
      try { showControlBar(true); updateControlBar(); } catch {}

      // reset per-session counters and sink session flag for repeat recording
      state.chunkCount = 0;
      state.byteCount = 0;
      state.sinkStarted = false;
      const displayMediaOptions = { video: { displaySurface: 'window' }, audio: false, preferCurrentTab: true };
      state.stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

      // After user grants capture (stream available), open centralized countdown via background
      const requestedCountdown = (window as any).__mcpRequestedCountdown;
      const totalCountdown = (typeof requestedCountdown === 'number' && requestedCountdown >= 1 && requestedCountdown <= 5) ? requestedCountdown : 3;
      // Include mode in meta for focus management
      const contentMode = state.mode === 'region' ? 'area' : (state.mode === 'element' ? 'element' : 'tab');
      try { chrome.runtime.sendMessage({ type: 'STREAM_META', meta: { preparing: true, countdown: totalCountdown, mode: contentMode } }); } catch {}
      // Then wait for unified countdown gate from background (use dynamic timeout based on configured countdown)
      await new Promise((resolve) => {
        const to = setTimeout(resolve, (totalCountdown + 2) * 1000);
        function onMsg(msg) { if (msg?.type === 'COUNTDOWN_DONE_BROADCAST') { try { clearTimeout(to) } catch {}; try { chrome.runtime.onMessage.removeListener(onMsg) } catch {}; resolve(null); } }
        try { chrome.runtime.onMessage.addListener(onMsg) } catch {}
      });
      // Extra guard to avoid capturing the last compositor frame of countdown window
      await new Promise((r) => setTimeout(r, 140));

      state.track = state.stream.getVideoTracks()[0];
      try { } catch {}

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

  // (removed legacy inline countdown helpers cancelStartCountdown/showStartCountdown)

      // WebCodecs 可用则使用 VideoEncoder 管道，否则回退到 MediaRecorder
      const canWebCodecs = typeof window.VideoEncoder !== 'undefined' && typeof window.MediaStreamTrackProcessor !== 'undefined';
      if (canWebCodecs) {
        state.usingWebCodecs = true;
        const settings = state.track.getSettings ? state.track.getSettings() : {};
        // Prefer the selected region/element size in device pixels (even-aligned), fallback to track settings
        const dpr = (window.devicePixelRatio || 1);
        let cssW = 0, cssH = 0;
        try {
          const rt = state.mode === 'element' ? state.elementRecordingTarget : (state.mode === 'region' ? state.regionRecordingTarget : null);
          if (rt && typeof rt.getBoundingClientRect === 'function') {
            const r = rt.getBoundingClientRect(); cssW = r.width || 0; cssH = r.height || 0;
          } else if (state.mode === 'region' && state.selectionBox) {
            cssW = parseFloat(state.selectionBox.style.width || '0') || 0;
            cssH = parseFloat(state.selectionBox.style.height || '0') || 0;
          }
        } catch {}
        let width = Math.max(2, Math.floor(cssW * dpr));
        let height = Math.max(2, Math.floor(cssH * dpr));
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 2 || height <= 2) {
          width = settings.width || 1920;
          height = settings.height || 1080;
        }
        // enforce even dimensions for better encoder compatibility
        if (width % 2) width -= 1;
        if (height % 2) height -= 1;
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
          codec: 'auto',
          width,
          height,
          framerate
        };


        // 使用一次性消息向 background 报告会话开始
        safePortPost({ type: 'STREAM_START', codec: 'auto', width, height, framerate, startTime: state.recordingMetadata?.startTime || Date.now() });

        // 初始化 Dedicated Worker 承担编码职责
        // 通过 fetch -> Blob URL 创建 Worker，避免跨源构造限制

        const workerUrl = chrome.runtime.getURL('encoder-worker.js');

	        safePortPost({ type: 'STREAM_META', metadata: state.recordingMetadata });

        // Ensure iframe sink is ready BEFORE starting encoder/frames to avoid dropping initial chunks
        try {
          const ok = await ensureSinkIframe();
          if (ok && state.sinkWin && !state.sinkStarted) {
            try {
              // 预启动时使用 auto，占位，实际 codec 在 configured 后再覆盖并 start（若未启动）或 meta 更新
              state.sinkWin.postMessage({ type: 'start', codec: 'auto', width, height, framerate }, '*');
              state.sinkWin.postMessage({ type: 'meta', metadata: state.recordingMetadata }, '*');
              state.sinkStarted = true;
            } catch (e) { console.warn('[Stream][Content] sink pre-start failed', e); }
          }
        } catch (e) { console.warn('[Stream][Content] ensureSinkIframe failed (pre-start)', e); }


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
          state.usingWebCodecs = false;
          state.recording = false;
          // reset sink session and counters for next recording
          state.sinkStarted = false;
          state.chunkCount = 0;
          state.byteCount = 0;
          state.recordingMetadata = null;
          hidePreview();
          // Clear selection upon stop as requested
          try { clearSelection(); } catch {}
          report({ recording: false });
          // After stop, show control bar (idle) with reselect buttons and close
          try { showControlBar(true); updateControlBar(); } catch {}
        };



        state.worker.onmessage = (ev) => {
          const msg = ev.data || {};

          switch (msg.type) {
            case 'configured':
              try {
                const cfg = msg.config || {};
                if (cfg && (cfg.width || cfg.height || cfg.framerate || cfg.codec)) {
                  if (typeof cfg.width === 'number') state.recordingMetadata.width = cfg.width;
                  if (typeof cfg.height === 'number') state.recordingMetadata.height = cfg.height;
                  if (typeof cfg.framerate === 'number') state.recordingMetadata.framerate = cfg.framerate;
                  if (typeof cfg.codec === 'string') state.recordingMetadata.codec = cfg.codec;
                }
              } catch {}
              // Ensure sink has been started once; if not, start now with current metadata
              try { ensureSinkIframe().then(() => {
                try {
                  if (state.sinkWin && !state.sinkStarted) {
                    state.sinkWin.postMessage({ type: 'start', codec: state.recordingMetadata?.codec || 'auto', width: state.recordingMetadata?.width, height: state.recordingMetadata?.height, framerate: state.recordingMetadata?.framerate }, '*');
                    state.sinkWin.postMessage({ type: 'meta', metadata: state.recordingMetadata }, '*');
                    state.sinkStarted = true;
                  } else if (state.sinkWin) {
                    // 若已启动，则仅更新 meta，通知 codec 变更
                    state.sinkWin.postMessage({ type: 'meta', metadata: state.recordingMetadata }, '*');
                  }
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
              // Notify sink first to ensure OPFS finalization even if background is asleep
              safeSinkPost({ type: 'end', chunks: state.chunkCount, bytes: state.byteCount });
              // Then notify background (non-fatal)
              safePortPost({ type: 'STREAM_END', chunks: state.chunkCount, bytes: state.byteCount });
              // worker 已完成，执行清理
              finalizeStop();
              break;
            case 'error':
              console.error('[encoder-worker] error', msg.message);
              safePortPost({ type: 'STREAM_ERROR', message: msg.message });
              // 出错也进行清理，避免悬挂
              finalizeStop();
              break;
            default:
              break;
          }
        };
        state.worker.postMessage({ type: 'configure', codec: 'auto', width, height, framerate, bitrate: 8_000_000 });

        // 建立逐帧处理，逐帧转交给 worker 编码（转移所有权零拷贝）
        state.processor = new MediaStreamTrackProcessor({ track: state.track });
        state.reader = state.processor.readable.getReader();
        let frameIndex = 0;
        (async () => {
          try {
            for (;;) {
              const { done, value: frame } = await state.reader.read();
              if (done) break;
              if (state.paused) { try { frame?.close?.() } catch {} await new Promise((r) => setTimeout(r, 60)); continue; }
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
          // Clear selection upon stop as requested
          try { clearSelection(); } catch {}
          report({ recording: false, hasVideo: true, videoSize: state.videoBlob.size, videoUrl });
          // After stop (fallback path), show control bar (idle) with reselect buttons and close
          try { showControlBar(true); updateControlBar(); } catch {}
        };

        state.mediaRecorder.start(1000);
      }

      showPreview();
      state.track.onended = () => { try { stopCapture(); } catch (err) { console.warn('[Stream][Content] stopCapture error from onended', err); } };
      report({ recording: true });
      // Ensure control bar reflects recording state
      try { showControlBar(true); updateControlBar(); } catch {}

    } catch (e) {
      // Ensure control bar label reflects recording state promptly
      try { showControlBar(true); updateControlBar(); } catch {}

      const name = e?.name || '';
      const message = e?.message || '';
      const stack = e?.stack || '';
      console.error('startCapture error', e, { name, message, stack, usingWebCodecs: state.usingWebCodecs, recording: state.recording, chunkCount: state.chunkCount, byteCount: state.byteCount });

      // Try fallback to MediaRecorder if we already obtained a stream but WebCodecs setup failed
      try {
        if (state.stream && !state.mediaRecorder) {
          console.warn('[Stream][Content] Falling back to MediaRecorder...');
          state.recordedChunks = [];
          state.mediaRecorder = new MediaRecorder(state.stream, { mimeType: 'video/webm;codecs=vp9' });
          state.mediaRecorder.ondataavailable = (event) => { if (event?.data?.size > 0) state.recordedChunks.push(event.data); };
          state.mediaRecorder.onstop = () => {
            try {
              state.videoBlob = new Blob(state.recordedChunks, { type: 'video/webm' });
              const videoUrl = URL.createObjectURL(state.videoBlob);
              try { clearSelection(); } catch {}
              report({ recording: false, hasVideo: true, videoSize: state.videoBlob.size, videoUrl });
              try { showControlBar(true); updateControlBar(); } catch {}
            } catch (err) {
              console.error('[Stream][Content] MediaRecorder onstop error', err);
            }
          };
          state.mediaRecorder.start(1000);
          state.recording = true;
          try { showPreview(); } catch {}
          report({ recording: true });
          try { showControlBar(true); updateControlBar(); } catch {}
          return; // fallback succeeded, exit startCapture
        }
      } catch (fallbackErr) {
        console.warn('[Stream][Content] MediaRecorder fallback failed', fallbackErr);
      }


      state.recording = false;
      // 通知 sidepanel 失败，避免 UI 卡在“正在请求权限”
      try { chrome.runtime.sendMessage({ type: 'CAPTURE_FAILED', error: name || message || String(e) }); } catch {}
      report({ recording: false });
    }
  }

  function stopCapture() {
    stopBadgeTimerContent();
    try {
      if (state.usingWebCodecs) {
        try { state.reader?.cancel(); } catch {}
        try { state.worker?.postMessage({ type: 'stop' }); } catch {}
        Promise.resolve(state.encoder?.flush?.()).catch(() => {}).finally(() => {
          try { state.encoder?.close?.(); } catch {}
        });
        // Proactively notify sink even before worker 'end' to avoid missing finalization
        safeSinkPost({ type: 'end-request' });
        // And notify background (non-fatal)
        safePortPost({ type: 'STREAM_END_REQUEST' });

        // 传递编码数据给主系统进行编辑（仅在未建立流式通道时兜底一次性传递）

    // If user stops during countdown/pre-start (no worker/mediaRecorder yet)
    if (!state.worker && !state.mediaRecorder) {
      // legacy inline countdown cancel hook removed (no-op now)
      try { state.stream && state.stream.getTracks().forEach(t => t.stop()); } catch {}
      state.stream = null; state.track = null; state.usingWebCodecs = false;
      state.recording = false;
      try { hidePreview(); } catch {}
      try { clearSelection(); } catch {}
      report({ recording: false });
      try { showControlBar(true); updateControlBar(); } catch {}
      return;
    }

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
        state.usingWebCodecs = false;
        state.recording = false;
        // reset sink session and counters for next recording
        state.sinkStarted = false;
        state.chunkCount = 0;
        state.byteCount = 0;
        state.recordingMetadata = null;
        hidePreview();
        // WebCodecs 路径：主动报告
        report({ recording: false });
        try { disableAnnotationMode(); } catch {}
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

    try { hideMask(); } catch {}
    hideSelectionTip();
    // 隐藏底部控制条（无选区时不需要显示）
    try { hideControlBar(true); } catch {}

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
    const title = document.createElement('div'); title.className = 'title'; title.textContent = 'Recording Preview';
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

      // 准备传递给主系统的数据（数据已经是数组格式，可以直接传递）
      const transferData = {
        type: 'ELEMENT_RECORDING_COMPLETE',
        data: {
          encodedChunks: state.encodedChunks, // 直接使用数组格式的数据
          metadata: state.recordingMetadata,
          source: 'element-recording'
        }
      };


      // 通过 background script 传递给主系统
      chrome.runtime.sendMessage(transferData, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ [Element Recording] Failed to transfer data:', chrome.runtime.lastError);
          return;
        }

        if (response?.success) {
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
        if (typeof msg.countdown === 'number') { (window as any).__mcpRequestedCountdown = msg.countdown; }
        startCapture(); break;
      case 'STOP_CAPTURE':
        stopCapture(); break;
      case 'CLEAR_SELECTION':
        clearSelection(); break;
      case 'DOWNLOAD_VIDEO':
        downloadVideo(); break;
      case 'TOGGLE_PAUSE':
        if (state.recording) setPaused(!state.paused);
        break;
      case 'ENABLE_TAB_ANNOTATION':
        enableAnnotationMode();
        break;
      case 'DISABLE_TAB_ANNOTATION':
        disableAnnotationMode();
        break;
      case 'STATE_UPDATE':
        // no-op for now
        break;
      case 'STREAMING_READY':
        streamingReady = true;
        break;
      default:
        break;
    }
  });
})();
