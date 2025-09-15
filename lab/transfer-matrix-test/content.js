// Content script: create a visible extension iframe (viewer.html),
// then attempt to transfer various types to it via window.postMessage.
// We log sender-side before/after to detect detachment.

(async () => {
  if (window.top !== window) return;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed; bottom:12px; right:12px; width:680px; height:420px; border:1px solid #999; z-index:2147483647; background:#fff;';
  iframe.src = chrome.runtime.getURL('viewer.html');
  document.documentElement.appendChild(iframe);
  await new Promise(r => iframe.onload = r);
  console.log('CS: viewer iframe ready');

  // Handshake ensure viewer listeners ready
  await new Promise((resolve) => {
    const onMsg = (ev) => {
      if (ev.source === iframe.contentWindow && ev.data && ev.data.type === 'viewer-ready') {
        window.removeEventListener('message', onMsg);
        resolve();
      }
    };
    window.addEventListener('message', onMsg);
    iframe.contentWindow.postMessage({ type: 'ping' }, '*');
    setTimeout(() => { window.removeEventListener('message', onMsg); resolve(); }, 800);
  });

  const target = iframe.contentWindow;
  const origin = '*'; // can be tightened to the extension origin

  // Helper: canvas with simple gradient
  function makeCanvas(w = 320, h = 180) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#4e54c8'); g.addColorStop(1,'#8f94fb');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(new Date().toLocaleTimeString(), 12, 28);
    return c;
  }

  // 1) ArrayBuffer (transferable)
  {
    const ab = new ArrayBuffer(128 * 1024);
    const u8 = new Uint8Array(ab);
    for (let i=0;i<u8.length;i++) u8[i] = i & 0xff;
    console.log('CS: AB before', { byteLength: u8.byteLength });
    target.postMessage({ type: 'ab', mime: 'image/png', ab }, origin, [ab]);
    console.log('CS: AB after', { byteLength: u8.byteLength }); // expect 0
  }

  // 2) Blob (not transferable; cloned)
  {
    const canvas = makeCanvas();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    console.log('CS: Blob before', { size: blob.size, type: blob.type });
    target.postMessage({ type: 'blob', blob }, origin);
    console.log('CS: Blob after (unchanged)', { size: blob.size });
  }

  // 3) ImageBitmap (transferable)
  {
    const canvas = makeCanvas();
    const bmp = await createImageBitmap(canvas);
    console.log('CS: BMP before', { width: bmp.width, height: bmp.height });
    try {
      target.postMessage({ type: 'bmp', bmp }, origin, [bmp]);
      try {
        console.warn('CS: BMP after transfer access', { width: bmp.width, height: bmp.height });
      } catch (e2) {
        console.log('CS: BMP detached (expected)', String(e2));
      }
    } catch (e) {
      console.error('CS: postMessage(ImageBitmap) failed', { name: e?.name, message: e?.message });
    }
  }

  // 4) OffscreenCanvas (transferable) — note: cannot transfer if it already has a rendering context
  if (typeof OffscreenCanvas === 'function') {
    try {
      const oc = new OffscreenCanvas(320, 180);
      console.log('CS: OC before (no context yet)', { width: oc.width, height: oc.height });
      target.postMessage({ type: 'oc', oc }, origin, [oc]);
      console.log('CS: OC posted (sender cannot easily probe detach)');
    } catch (e) {
      console.error('CS: OffscreenCanvas failed', { name: e?.name, message: e?.message });
    }
  } else {
    console.warn('CS: OffscreenCanvas not supported');
  }

  // 5) MessagePort (transferable)
  {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (e) => { console.log('CS: port1 got', e.data); };
    port1.start?.();
    console.log('CS: Port before send');
    target.postMessage({ type: 'port', port: port2 }, origin, [port2]);
    port1.postMessage({ from: 'cs', hello: true });
  }

  // 6) VideoFrame (transferable in many contexts; may be restricted on some sites)
  if (typeof VideoFrame === 'function') {
    try {
      const canvas = makeCanvas();
      const bmp = await createImageBitmap(canvas);
      console.log('CS: VF bmp prepared', { width: bmp.width, height: bmp.height });
      const vf = new VideoFrame(bmp, { timestamp: performance.now()*1000 });
      const info = {};
      try { info.displayWidth = vf.displayWidth; } catch (e) { info.displayWidth = String(e); }
      try { info.displayHeight = vf.displayHeight; } catch (e) { info.displayHeight = String(e); }
      try { info.codedWidth = vf.codedWidth; } catch (e) { info.codedWidth = String(e); }
      try { info.codedHeight = vf.codedHeight; } catch (e) { info.codedHeight = String(e); }
      try { info.format = vf.format; } catch (e) { info.format = String(e); }
      try { info.timestamp = vf.timestamp; } catch (e) { info.timestamp = String(e); }
      try { info.duration = vf.duration; } catch (e) { info.duration = String(e); }
      console.log('CS: VF before', info);
      try {
        target.postMessage({ type: 'vf', vf }, origin, [vf]);
        console.log('CS: VF posted, check detach...');
        try { const w = vf.displayWidth; console.warn('CS: VF after transfer accessible', { displayWidth: w }); }
        catch (e) { console.log('CS: VF detached (expected)', String(e)); }
      } catch (pmErr) {
        console.error('CS: postMessage(VideoFrame) failed', { name: pmErr?.name, message: pmErr?.message });
      }
    } catch (e) {
      console.error('CS: create VideoFrame failed', { name: e?.name, message: e?.message });
    }
  } else {
    console.warn('CS: VideoFrame not supported');
  }
})();

