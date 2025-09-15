// Iframe page: receive ArrayBuffer with image bytes and WebCodecs VideoFrame
// via postMessage (with transfer list). Display both.

(function(){
  console.log('IFRAME: viewer loaded');
  const imgEl = document.getElementById('img');
  const metaEl = document.getElementById('meta');
  if (!imgEl || !metaEl) console.warn('IFRAME: missing DOM elements', { img: !!imgEl, meta: !!metaEl });

  function setMeta(lines){ if (metaEl) metaEl.textContent = lines.join('\n'); }

  // Handshake support to help timing issues
  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    if (data.type === 'ping') {
      try { ev.source?.postMessage({ type: 'viewer-ready' }, '*'); } catch (e) {}
      console.log('IFRAME: got ping, replied viewer-ready');
      return;
    }
  });

  // Debug log for any incoming message types
  window.addEventListener('message', (ev) => {
    try { console.log('IFRAME: message recv', { origin: ev.origin, keys: Object.keys(ev.data || {}) }); } catch (_) {}
  });

  // Handle image bytes (ArrayBuffer)
  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    if (data.type !== 'image' || !(data.ab instanceof ArrayBuffer)) return;
    const mime = data.mime || 'application/octet-stream';

    const ab = data.ab; // transferred into this context
    const u8 = new Uint8Array(ab);

    let checksum = 0; for (let i = 0; i < u8.length; i++) checksum = (checksum + u8[i]) >>> 0;
    setMeta([
      `Image: ${u8.length} bytes`,
      `MIME: ${mime}`,
      `Checksum: ${checksum}`
    ]);

    const blob = new Blob([ab], { type: mime });
    const url = URL.createObjectURL(blob);
    if (imgEl) {
      imgEl.onload = () => { URL.revokeObjectURL(url); };
      imgEl.src = url;
    }

    console.log('IFRAME: image displayed', { bytes: u8.length, mime, checksum });
  });

  // Handle WebCodecs VideoFrame
  window.addEventListener('message', async (ev) => {
    const data = ev.data || {};
    if (data.type !== 'vf') return;
    const vf = data.vf;
    if (typeof VideoFrame !== 'function' || !(vf instanceof VideoFrame)) {
      console.warn('IFRAME: received vf but VideoFrame unsupported or wrong type');
      return;
    }
    try {
      // Collect detailed info
      const info = {};
      try { info.displayWidth = vf.displayWidth; } catch (e) { info.displayWidth = `(err ${e})`; }
      try { info.displayHeight = vf.displayHeight; } catch (e) { info.displayHeight = `(err ${e})`; }
      try { info.codedWidth = vf.codedWidth; } catch (e) { info.codedWidth = `(err ${e})`; }
      try { info.codedHeight = vf.codedHeight; } catch (e) { info.codedHeight = `(err ${e})`; }
      try { info.format = vf.format; } catch (e) { info.format = `(err ${e})`; }
      try { info.timestamp = vf.timestamp; } catch (e) { info.timestamp = `(err ${e})`; }
      try { info.duration = vf.duration; } catch (e) { info.duration = `(err ${e})`; }
      console.log('IFRAME: vf received', info);

      const w = vf.displayWidth, h = vf.displayHeight;
      setMeta([
        `VideoFrame: ${w}x${h}`,
        `format: ${vf.format || '(n/a)'}
      `]);
      // Draw to a canvas
      let canvas = document.getElementById('vf-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'vf-canvas';
        canvas.style.border = '1px solid #ddd';
        canvas.style.maxWidth = '100%';
        canvas.style.maxHeight = '220px';
        imgEl?.insertAdjacentElement('afterend', canvas);
      }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx.drawImage) {
        ctx.drawImage(vf, 0, 0);
      } else {
        const bmp = await createImageBitmap(vf);
        ctx.drawImage(bmp, 0, 0);
        bmp.close?.();
      }
      console.log('IFRAME: VideoFrame drawn');
    } catch (e) {
      console.error('IFRAME: failed to draw VideoFrame', e);
    } finally {
      try { vf.close(); console.log('IFRAME: VideoFrame closed'); } catch (_) {}
      try {
        // Access after close to confirm state
        const _w = vf.displayWidth; console.warn('IFRAME: vf still accessible after close', { displayWidth: _w });
      } catch (eClose) {
        console.log('IFRAME: vf access after close throws (expected)', String(eClose));
      }
    }
  });

  // Handle ImageBitmap fallback
  window.addEventListener('message', async (ev) => {
    const data = ev.data || {};
    if (data.type !== 'bmp') return;
    const bmp = data.bmp;
    if (!bmp || typeof createImageBitmap !== 'function' || typeof bmp.close !== 'function') {
      console.warn('IFRAME: received bmp but not an ImageBitmap (or missing close)');
      return;
    }
    try {
      const w = bmp.width, h = bmp.height;
      let canvas = document.getElementById('vf-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'vf-canvas';
        canvas.style.border = '1px solid #ddd';
        canvas.style.maxWidth = '100%';
        canvas.style.maxHeight = '220px';
        imgEl?.insertAdjacentElement('afterend', canvas);
      }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      console.log('IFRAME: ImageBitmap drawn');
    } catch (e) {
      console.error('IFRAME: failed to draw ImageBitmap', e);
    } finally {
      try { bmp.close(); } catch (_) {}
    }
  });
})();

