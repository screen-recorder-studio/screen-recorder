(function(){
  const imgEl = document.getElementById('img');
  const imgMeta = document.getElementById('img-meta');
  const canvas = document.getElementById('canvas');
  const cMeta = document.getElementById('canvas-meta');
  const logEl = document.getElementById('log');
  const portMeta = document.getElementById('port-meta');
  const sumBody = document.getElementById('summary-body');
  const TYPES = [
    { key: 'ab',   label: 'ArrayBuffer' },
    { key: 'blob', label: 'Blob' },
    { key: 'bmp',  label: 'ImageBitmap' },
    { key: 'oc',   label: 'OffscreenCanvas' },
    { key: 'vf',   label: 'VideoFrame' },
    { key: 'port', label: 'MessagePort' },
  ];
  const summary = Object.create(null);
  function initSummary() {
    if (!sumBody) return;
    sumBody.innerHTML = '';
    for (const t of TYPES) {
      summary[t.key] = { received: false, ok: null, note: 'Waiting...' };
      const tr = document.createElement('tr');
      tr.dataset.type = t.key;
      tr.innerHTML = `
        <td style="padding:4px 6px; border-bottom:1px solid #eee;">${t.label}</td>
        <td style="padding:4px 6px; border-bottom:1px solid #eee;">No</td>
        <td style="padding:4px 6px; border-bottom:1px solid #eee;">—</td>
        <td style="padding:4px 6px; border-bottom:1px solid #eee;">Waiting...</td>
      `;
      sumBody.appendChild(tr);
    }
  }
  function updateSummary(key, patch) {
    if (!(key in summary)) return;
    Object.assign(summary[key], patch || {});
    const tr = sumBody?.querySelector(`tr[data-type="${key}"]`);
    if (!tr) return;
    const tds = tr.querySelectorAll('td');
    const s = summary[key];
    if (tds[1]) tds[1].textContent = s.received ? 'Yes' : 'No';
    if (tds[2]) tds[2].textContent = s.ok === true ? 'PASS' : (s.ok === false ? 'FAIL' : '—');
    if (tds[3]) tds[3].textContent = s.note ?? '';
  }
  initSummary();


  function log(...args){
    console.log('VIEWER:', ...args);
    try { logEl.textContent += '\n' + args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); } catch (_) {}
  }
  function set(el, lines){ if (el) el.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines); }

  log('loaded');

  // Handshake
  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    if (data.type === 'ping') {
      try { ev.source?.postMessage({ type: 'viewer-ready' }, '*'); } catch (_) {}
      log('got ping, replied viewer-ready');
      return;
    }
  });

  // Debug any message
  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    const keys = Object.keys(data);
    log('message', { origin: ev.origin, keys });
  });

  // ArrayBuffer image bytes
  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    if (data.type !== 'ab' || !(data.ab instanceof ArrayBuffer)) return;
    const mime = data.mime || 'image/png';
    const ab = data.ab;
    const u8 = new Uint8Array(ab);
    let checksum = 0; for (let i = 0; i < u8.length; i++) checksum = (checksum + u8[i]) >>> 0;
    set(imgMeta, [`ArrayBuffer bytes=${u8.length}`, `mime=${mime}`, `checksum=${checksum}`]);
    const blob = new Blob([ab], { type: mime });
    const url = URL.createObjectURL(blob);
    imgEl.onload = () => URL.revokeObjectURL(url);
    imgEl.src = url;
    log('ab displayed', { bytes: u8.length, mime, checksum });
    updateSummary('ab', { received: true, ok: true, note: `bytes=${u8.length}, checksum=${checksum}` });
  });

  // Blob image
  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    if (data.type !== 'blob' || !(data.blob instanceof Blob)) return;
    const mime = data.blob.type || 'application/octet-stream';
    set(imgMeta, [`Blob size=${data.blob.size}`, `mime=${mime}`]);
    const url = URL.createObjectURL(data.blob);
    imgEl.onload = () => URL.revokeObjectURL(url);
    imgEl.src = url;
    log('blob displayed', { size: data.blob.size, mime });
    updateSummary('blob', { received: true, ok: true, note: `size=${data.blob.size}` });
  });

  // ImageBitmap
  window.addEventListener('message', async (ev) => {
    const data = ev.data || {};
    if (data.type !== 'bmp') return;
    const bmp = data.bmp;
    if (!bmp || typeof bmp.width !== 'number') return;
    const ctx = canvas.getContext('2d');
    canvas.width = bmp.width; canvas.height = bmp.height;
    ctx.drawImage(bmp, 0, 0);
    try { bmp.close?.(); } catch (_) {}
    set(cMeta, [`ImageBitmap ${canvas.width}x${canvas.height}`]);
    log('bitmap drawn', { w: canvas.width, h: canvas.height });
    updateSummary('bmp', { received: true, ok: true, note: `${canvas.width}x${canvas.height}` });
  });

  // OffscreenCanvas
  window.addEventListener('message', async (ev) => {
    const data = ev.data || {};
    if (data.type !== 'oc') return;
    const oc = data.oc;
    if (!oc || typeof oc.width !== 'number') return;
    updateSummary('oc', { received: true, ok: null, note: `received ${oc.width}x${oc.height}` });
    // Draw after transfer (create rendering context on the receiver side)
    try {
      const ocCtx = oc.getContext('2d');
      ocCtx.fillStyle = '#222'; ocCtx.fillRect(0, 0, oc.width, oc.height);
      ocCtx.fillStyle = '#0f0'; ocCtx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ocCtx.fillText('OffscreenCanvas (drawn in iframe)', 12, 28);
    } catch (e) {
      log('offscreen getContext/draw failed', { name: e?.name, message: e?.message });
      updateSummary('oc', { ok: false, note: `getContext/draw: ${e?.name||''} ${e?.message||''}` });
    }
    const bmp = oc.transferToImageBitmap();
    const ctx = canvas.getContext('2d');
    canvas.width = bmp.width; canvas.height = bmp.height;
    ctx.drawImage(bmp, 0, 0);
    try { bmp.close?.(); } catch (_) {}
    set(cMeta, [`OffscreenCanvas -> ImageBitmap ${canvas.width}x${canvas.height}`]);
    log('offscreen drawn', { w: canvas.width, h: canvas.height });
    updateSummary('oc', { ok: true, note: `${canvas.width}x${canvas.height}` });
  });

  // VideoFrame
  window.addEventListener('message', async (ev) => {
    const data = ev.data || {};
    if (data.type !== 'vf') return;
    const vf = data.vf;
    updateSummary('vf', { received: true, ok: null, note: 'received' });
    if (typeof VideoFrame !== 'function' || !(vf instanceof VideoFrame)) { log('vf wrong type'); updateSummary('vf', { ok: false, note: 'wrong type' }); return; }
    const info = {};
    try { info.displayWidth = vf.displayWidth; } catch (e) { info.displayWidth = String(e); }
    try { info.displayHeight = vf.displayHeight; } catch (e) { info.displayHeight = String(e); }
    try { info.codedWidth = vf.codedWidth; } catch (e) { info.codedWidth = String(e); }
    try { info.codedHeight = vf.codedHeight; } catch (e) { info.codedHeight = String(e); }
    try { info.format = vf.format; } catch (e) { info.format = String(e); }
    try { info.timestamp = vf.timestamp; } catch (e) { info.timestamp = String(e); }
    try { info.duration = vf.duration; } catch (e) { info.duration = String(e); }
    log('vf received', info);
    try {
      const w = vf.displayWidth, h = vf.displayHeight;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx.drawImage) ctx.drawImage(vf, 0, 0);
      else { const bmp = await createImageBitmap(vf); ctx.drawImage(bmp, 0, 0); bmp.close?.(); }
      set(cMeta, [`VideoFrame ${w}x${h}`, `format=${vf.format||'(n/a)'} `]);
      log('vf drawn');
      updateSummary('vf', { ok: true, note: `${w}x${h} format=${vf.format||'(n/a)'}` });
    } catch (e) {
      log('vf draw error', { name: e?.name, message: e?.message });
      updateSummary('vf', { ok: false, note: `${e?.name||''}: ${e?.message||''}` });
    } finally {
      try { vf.close(); log('vf closed'); } catch (_) {}
      try { const t = vf.displayWidth; log('vf still accessible after close', { t }); } catch (e) { log('vf post-close access throws (expected)'); }
    }
  });

  // MessagePort (via MessageChannel)
  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    if (data.type !== 'port') return;
    const port = data.port;
    if (!port || typeof port.postMessage !== 'function') return;
    updateSummary('port', { received: true, ok: null, note: 'port received' });
    port.onmessage = (e) => {
      log('port got', e.data);
      set(portMeta, `port msg: ${JSON.stringify(e.data)}`);
      port.postMessage({ from: 'viewer', ok: true });
      updateSummary('port', { ok: true, note: 'roundtrip ok' });
    };
    port.start?.();
    log('port received');
  });
})();

