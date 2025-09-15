// Content script: create a visible iframe page, generate a PNG image in-memory
// and a WebCodecs VideoFrame from canvas; transfer both to the iframe via
// postMessage with transfer list to verify ownership transfer.

(async () => {
  if (window.top !== window) return; // avoid running in iframes

  // 1) Create a visible iframe that loads our viewer page
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed; bottom:12px; right:12px; width:480px; height:320px; border:1px solid #999; z-index:2147483647; background:#fff;';
  iframe.src = chrome.runtime.getURL('viewer.html');
  document.documentElement.appendChild(iframe);
  await new Promise(r => iframe.onload = r);
  console.log('CS: viewer iframe ready');
  // Handshake to ensure viewer's message listeners are ready
  await new Promise((resolve) => {
    const onMsg = (ev) => {
      if (ev.source === iframe.contentWindow && ev.data && ev.data.type === 'viewer-ready') {
        window.removeEventListener('message', onMsg);
        resolve();
      }
    };
    window.addEventListener('message', onMsg);
    iframe.contentWindow.postMessage({ type: 'ping' }, '*');
    // Fallback: auto-resolve after 1s even if no reply (best-effort)
    setTimeout(() => { window.removeEventListener('message', onMsg); resolve(); }, 1000);
  });

  // 2) Render a canvas (used for both PNG and VideoFrame)
  function renderCanvas() {
    const w = 320, h = 180;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#4e54c8');
    grad.addColorStop(1, '#8f94fb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Transfer via postMessage', 16, 40);
    ctx.fillText(new Date().toLocaleTimeString(), 16, 70);
    return canvas;
  }

  const canvas = renderCanvas();

  // 3) Make PNG bytes and transfer ArrayBuffer ownership to iframe
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  const pngAb = await blob.arrayBuffer();
  const view = new Uint8Array(pngAb);
  console.log('CS: before transfer image bytes', view.byteLength);
  iframe.contentWindow.postMessage({ type: 'image', mime: 'image/png', ab: pngAb }, '*', [pngAb]);
  console.log('CS: after transfer image bytes', view.byteLength); // expect 0

  // 4) Create a WebCodecs VideoFrame from the same canvas and transfer
  if (typeof VideoFrame === 'function') {
    try {
      // Create from ImageBitmap for better compatibility
      const bmp = await createImageBitmap(canvas);
      console.log('CS: ImageBitmap prepared', { width: bmp.width, height: bmp.height });
      const vf = new VideoFrame(bmp, { timestamp: performance.now() * 1000 /*us*/ });
      // Collect VideoFrame info safely
      const vfInfo = {};
      try { vfInfo.displayWidth = vf.displayWidth; } catch (e) { vfInfo.displayWidth = `(err ${e})`; }
      try { vfInfo.displayHeight = vf.displayHeight; } catch (e) { vfInfo.displayHeight = `(err ${e})`; }
      try { vfInfo.codedWidth = vf.codedWidth; } catch (e) { vfInfo.codedWidth = `(err ${e})`; }
      try { vfInfo.codedHeight = vf.codedHeight; } catch (e) { vfInfo.codedHeight = `(err ${e})`; }
      try { vfInfo.format = vf.format; } catch (e) { vfInfo.format = `(err ${e})`; }
      try { vfInfo.timestamp = vf.timestamp; } catch (e) { vfInfo.timestamp = `(err ${e})`; }
      try { vfInfo.duration = vf.duration; } catch (e) { vfInfo.duration = `(err ${e})`; }
      console.log('CS: vf before transfer', vfInfo);
      try {
        iframe.contentWindow.postMessage({ type: 'vf', vf }, '*', [vf]);
        console.log('CS: posted VideoFrame, testing detach...');
        // After transfer, attempts to access properties should fail
        try {
          // Access again to verify detach
          const afterW = vf.displayWidth;
          console.warn('CS: vf still accessible after transfer (transfer likely not applied)', { displayWidth: afterW });
        } catch (e2) {
          console.log('CS: vf after transfer is detached (expected)', String(e2));
        }
      } catch (pmErr) {
        console.error('CS: postMessage(VideoFrame) failed, falling back to ImageBitmap', { name: pmErr?.name, message: pmErr?.message, err: pmErr });
        try {
          iframe.contentWindow.postMessage({ type: 'bmp', bmp }, '*', [bmp]);
          console.log('CS: sent ImageBitmap fallback', { width: bmp.width, height: bmp.height });
        } catch (pmBmpErr) {
          console.error('CS: postMessage(ImageBitmap) also failed', { name: pmBmpErr?.name, message: pmBmpErr?.message, err: pmBmpErr });
          try { bmp.close?.(); } catch (_) {}
        }
      }
    } catch (e) {
      console.error('CS: create VideoFrame from canvas failed', { name: e?.name, message: e?.message, err: e });
    }
  } else {
    console.warn('CS: VideoFrame not supported in this browser');
  }
})();

