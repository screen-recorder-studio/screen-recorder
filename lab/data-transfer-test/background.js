// MV3 Service Worker: receives transferred buffers and writes to OPFS

async function ensureOffscreen() {
  try {
    const has = await chrome.offscreen.hasDocument?.();
    if (!has) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Test transferable via postMessage in offscreen doc'
      });
    }
  } catch (e) {
    console.warn('SW: ensureOffscreen error', e);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'ensure-offscreen') {
    (async () => {
      await ensureOffscreen();
      sendResponse({ ok: true });
    })();
    return true; // async response from SW
  }
  // For offscreen-feed-* and other messages, do nothing here;
  // Offscreen document will receive chrome.runtime messages directly and respond.
  return false;
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'opfs-xfer') return;
  console.log('SW: port connected');

  let total = 0;
  let chunks = 0;
  let fileHandle = null;
  let fileName = null;

  const wsPromise = (async () => {
    const root = await navigator.storage.getDirectory(); // Extension OPFS
    const ts = Date.now();
    fileName = `recv-${ts}.bin`;
    fileHandle = await root.getFileHandle(fileName, { create: true });
    const ws = await fileHandle.createWritable();
    return ws;
  })();

  port.onMessage.addListener(async msg => {
    if (msg && msg.done) {
      try {
        const ws = await wsPromise;
        await ws.close();
        const file = await fileHandle.getFile();
        console.log('SW: done. saved', fileName, 'size', file.size, 'bytes; chunks', chunks);
      } catch (e) {
        console.error('SW: finalize error', e);
      }
      return;
    }

    // Diagnose message shape and coerce to Uint8Array when possible
    const tag = Object.prototype.toString.call(msg); // e.g. [object ArrayBuffer]
    const ctor = msg?.constructor?.name;
    const isView = msg && typeof msg === 'object' && ArrayBuffer.isView(msg);
    console.log('SW: msg diag', { type: typeof msg, tag, ctor, isView, hasByteLength: !!msg?.byteLength });

    // Helper: base64 -> Uint8Array
    const u8FromB64 = (b64) => {
      const bin = atob(b64);
      const len = bin.length;
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
      return out;
    };

    let u8;
    if (msg && msg.type === 'chunk-b64' && typeof msg.b64 === 'string') {
      u8 = u8FromB64(msg.b64);
    } else if (msg instanceof ArrayBuffer) {
      u8 = new Uint8Array(msg);
    } else if (isView) {
      u8 = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
    } else if (msg instanceof Blob) {
      const ab = await msg.arrayBuffer();
      u8 = new Uint8Array(ab);
    } else if (msg && typeof msg === 'object' && (msg.data || msg.payload)) {
      const inner = msg.data ?? msg.payload;
      if (inner && inner.type === 'chunk-b64' && typeof inner.b64 === 'string') {
        u8 = u8FromB64(inner.b64);
      } else if (inner instanceof ArrayBuffer) {
        u8 = new Uint8Array(inner);
      } else if (ArrayBuffer.isView(inner)) {
        u8 = new Uint8Array(inner.buffer, inner.byteOffset, inner.byteLength);
      } else if (inner instanceof Blob) {
        const ab = await inner.arrayBuffer();
        u8 = new Uint8Array(ab);
      }
    }

    if (!u8) {
      console.warn('SW: unexpected message shape; cannot coerce');
      return;
    }

    total += u8.byteLength;
    chunks++;

    // Simple checksum to show data integrity
    let sum = 0;
    for (let i = 0; i < u8.length; i++) sum = (sum + u8[i]) >>> 0;
    console.log('SW: chunk', chunks, 'len', u8.length, 'checksum', sum, 'running total', total);

    try {
      const ws = await wsPromise;
      await ws.write(u8);
    } catch (e) {
      console.error('SW: write error', e);
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('SW: port disconnected');
  });
});

