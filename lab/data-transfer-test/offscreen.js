// Offscreen document: receives b64 chunks via chrome.runtime messaging,
// rebuilds an ArrayBuffer, then posts it to an iframe via window.postMessage
// with transfer list to validate ownership transfer (detach in sender).

const log = (...a) => console.log('OFF:', ...a);

let chunks = [];
let totalExpected = null;

async function ensureChildFrame() {
  return new Promise(resolve => {
    let iframe = document.getElementById('child');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'child';
      iframe.src = chrome.runtime.getURL('child.html');
      iframe.onload = () => resolve(iframe);
      document.body.appendChild(iframe);
    } else if (iframe.contentWindow) {
      resolve(iframe);
    } else {
      iframe.onload = () => resolve(iframe);
    }
  });
}

function concatU8(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function u8FromB64(b64) {
  const bin = atob(b64);
  const n = bin.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return out;
}

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'offscreen-feed-chunk-b64') {
    const u8 = u8FromB64(msg.b64);
    chunks.push(u8);
    log('chunk recv', u8.length);
    sendResponse({ ok: true });
  }
  else if (msg.type === 'offscreen-feed-done') {
    totalExpected = msg.total;
    const data = concatU8(chunks);
    log('reassembled', data.length, 'expected', totalExpected);

    const iframe = await ensureChildFrame();
    const ab = data.buffer; // Shared underlying buffer
    const view = new Uint8Array(ab);
    log('before postMessage transfer, sender view length', view.byteLength);

    iframe.contentWindow.postMessage({ type: 'from-offscreen', ab }, '*', [ab]);

    // After transfer, this view should become detached (length 0)
    log('after postMessage transfer, sender view length', view.byteLength);

    // Optionally, write to OPFS here if needed
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('offscreen_recv.bin', { create: true });
      const ws = await fh.createWritable();
      await ws.write(new Uint8Array([])); // just touch file for visibility
      await ws.close();
      log('touched OPFS file offscreen_recv.bin');
    } catch (e) {
      log('OPFS touch error', e);
    }

    chunks = []; totalExpected = null;
    sendResponse({ ok: true, len: data.length });
  }
});

log('offscreen loaded');

