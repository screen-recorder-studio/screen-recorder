(() => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const preview = document.getElementById('preview');
  const videoPlaceholder = document.getElementById('videoPlaceholder');
  const selectionBox = document.getElementById('selectionBox');
  const dragOverlay = document.getElementById('dragOverlay');
  const playground = document.getElementById('playground');
  const apiStatus = document.getElementById('apiStatus');

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentStream = null;
  let currentTrack = null;

  function updateApiStatus() {
    const parts = [];
    parts.push(typeof navigator.mediaDevices?.getDisplayMedia === 'function' ? '✅ getDisplayMedia' : '❌ getDisplayMedia');
    parts.push(typeof window.CropTarget !== 'undefined' ? '✅ CropTarget' : '❌ CropTarget');
    apiStatus.textContent = parts.join(' · ');
  }

  updateApiStatus();

  // Drag-to-select logic over the playground
  dragOverlay.addEventListener('mousedown', (e) => {
    // Only start when clicking inside the playground area
    const rect = playground.getBoundingClientRect();
    startX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    startY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    isDragging = true;
    selectionBox.hidden = false;
    // Initialize size/pos
    selectionBox.style.left = `${startX}px`;
    selectionBox.style.top = `${startY}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';

    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = playground.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);

    selectionBox.style.left = `${x}px`;
    selectionBox.style.top = `${y}px`;
    selectionBox.style.width = `${w}px`;
    selectionBox.style.height = `${h}px`;
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;

    // Enable start button only if we have a non-trivial rectangle
    const w = parseFloat(selectionBox.style.width || '0');
    const h = parseFloat(selectionBox.style.height || '0');
    const hasRect = (w >= 10 && h >= 10);
    startBtn.disabled = !hasRect;
    clearBtn.disabled = !hasRect;

    // After selection is finalized, allow interacting with the content
    dragOverlay.style.pointerEvents = 'none';

    if (!hasRect) {
      selectionBox.hidden = true;
    }
  });

  async function startCapture() {
    try {
      startBtn.disabled = true;

      const displayMediaOptions = {
        video: { displaySurface: 'window' },
        audio: false,
        preferCurrentTab: true,
      };

      currentStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      currentTrack = currentStream.getVideoTracks()[0];

      if (typeof window.CropTarget !== 'undefined') {
        // Crop to the selected rectangle element
        const cropTarget = await window.CropTarget.fromElement(selectionBox);
        await currentTrack.cropTo(cropTarget);
      }

      preview.srcObject = currentStream;
      preview.style.display = 'block';
      videoPlaceholder.style.display = 'none';

      stopBtn.disabled = false;
      clearBtn.disabled = true; // avoid changing selection during recording

      currentTrack.onended = () => {
        stopCapture();
      };
    } catch (err) {
      console.error('startCapture error:', err);
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }

  function stopCapture() {
    try {
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
      }
    } finally {
      currentStream = null;
      currentTrack = null;
      preview.srcObject = null;
      preview.style.display = 'none';
      videoPlaceholder.style.display = 'block';
      stopBtn.disabled = true;

      // Keep the dashed selection visible (fixed rectangle), but allow user to re-capture
      startBtn.disabled = false;
      clearBtn.disabled = false;
    }
  }

  function clearSelection() {
    // Hide and reset selection
    selectionBox.hidden = true;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';

    // Re-enable drag to select and disable actions
    dragOverlay.style.pointerEvents = 'auto';
    startBtn.disabled = true;
    clearBtn.disabled = true;
  }

  function initDemoUI() {
    // range display sync
    const rangeInput = document.querySelector('.form-range');
    const rangeValue = document.getElementById('rangeValue');
    if (rangeInput && rangeValue) {
      const sync = () => (rangeValue.textContent = rangeInput.value);
      rangeInput.addEventListener('input', sync);
      sync();
    }

    // progress bars animation
    const fills = document.querySelectorAll('.progress-fill');
    requestAnimationFrame(() => {
      fills.forEach((el, i) => {
        el.style.width = '0%';
        setTimeout(() => {
          const p = Math.max(0, Math.min(parseInt(el.dataset.progress || '0', 10), 100));
          el.style.width = p + '%';
        }, 60 + i * 120);
      });
    });

    // bar chart animation
    const bars = document.querySelectorAll('.bar-chart .bar');
    bars.forEach((bar, i) => {
      bar.style.height = '0%';
      bar.style.transition = 'height 800ms ease';
      setTimeout(() => {
        const h = Math.max(0, Math.min(parseInt(bar.dataset.height || '0', 10), 100));
        bar.style.height = h + '%';
      }, 100 + i * 140);
    });

    // circular progress animation
    const ring = document.querySelector('.progress-ring-fill');
    const text = document.querySelector('.progress-text');
    if (ring && text) {
      const r = 36; const C = 2 * Math.PI * r;
      ring.style.strokeDasharray = `${C} ${C}`;
      ring.style.strokeDashoffset = `${C}`;
      const val = parseInt((text.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0;
      const pct = Math.max(0, Math.min(val, 100));
      setTimeout(() => {
        ring.style.transition = 'stroke-dashoffset 1000ms ease';
        ring.style.strokeDashoffset = `${C * (1 - pct / 100)}`;
      }, 80);
    }

    // live metrics update
    const cpu = document.getElementById('cpuValue');
    const mem = document.getElementById('memValue');
    const net = document.getElementById('netValue');
    if (cpu && mem && net) {
      setInterval(() => {
        cpu.textContent = `${Math.floor(25 + Math.random() * 60)}%`;
        mem.textContent = `${Math.floor(40 + Math.random() * 50)}%`;
        net.textContent = `${Math.floor(10 + Math.random() * 70)}%`;
      }, 900);
    }

    // continuous updates for bar chart
    if (bars && bars.length) {
      setInterval(() => {
        bars.forEach((bar) => {
          const h = Math.floor(30 + Math.random() * 70);
          bar.style.height = h + '%';
        });
      }, 1500);
    }

    // live line canvas (continuous)
    (function startLiveLine() {
      const canvas = document.getElementById('liveLineCanvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      const data = new Array(W).fill(H / 2);
      let t = 0;

      function draw() {
        const val = H / 2 + Math.sin(t / 14) * H * 0.30 + (Math.random() - 0.5) * H * 0.12;
        data.push(Math.max(0, Math.min(H - 1, val)));
        data.shift();

        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = '#eef2f7';
        ctx.lineWidth = 1;
        for (let y = H / 4; y < H; y += H / 4) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

        ctx.beginPath();
        ctx.strokeStyle = '#0d6efd';
        ctx.lineWidth = 2;
        ctx.moveTo(0, H - data[0]);
        for (let x = 1; x < W; x++) ctx.lineTo(x, H - data[x]);
        ctx.stroke();

        t++;
        requestAnimationFrame(draw);
      }

      requestAnimationFrame(draw);
    })();

  }

  // Init rich demo UI
  initDemoUI();

  startBtn.addEventListener('click', startCapture);
  stopBtn.addEventListener('click', stopCapture);
  clearBtn.addEventListener('click', clearSelection);
})();

