// Offscreen document script: receives encoded-stream messages via background
// and writes into OPFS using src/lib/workers/opfs-writer-worker.ts
// Other logic in the system remains unchanged.

// This script runs in the Offscreen Document context (chrome.offscreen.createDocument)
// It connects back to background with a dedicated Port and accepts forwarded
// messages from the content script's encoded-stream.

// State
let writer: Worker | null = null;
let writerReady = false;
let sessionId: string | null = null;
let lastMeta: any = null; // carries codec/width/height/fps
const pendingChunks: Array<{ data: any; timestamp?: number; type?: string; codedWidth?: number; codedHeight?: number; codec?: string }> = [];
let endPending = false;

function ensureSessionId() {
  if (!sessionId) sessionId = `${Date.now()}`;
  return sessionId;
}

function normalizeMeta(m: any) {
  if (!m) return {} as any;
  return {
    codec: m.codec || 'vp8',
    width: m.width || m.codedWidth || 1920,
    height: m.height || m.codedHeight || 1080,
    fps: m.framerate || m.fps || 30,
  };
}

function initOpfsWriter(meta?: any) {
  if (writer) return;
  writerReady = false;
  lastMeta = normalizeMeta(meta || lastMeta);
  try {
    // Load the OPFS writer worker from the built asset in the extension package
    writer = new Worker((chrome.runtime as any).getURL('opfs-writer-worker.js'), { type: 'module' });
    const id = ensureSessionId();
    writer.onmessage = (ev: MessageEvent) => {
      const d: any = ev.data || {};
      if (d.type === 'ready') {
        // Writer initialized
        writerReady = true;
        console.log('[Offscreen][OPFS] writer ready for', id);
        flushPendingIfReady();
      } else if (d.type === 'progress') {
        const { bytesWrittenTotal, chunksWritten } = d;
        if (chunksWritten % 200 === 0) console.log('[Offscreen][OPFS] progress', { bytesWrittenTotal, chunksWritten });
      } else if (d.type === 'finalized') {
        console.log('[Offscreen][OPFS] writer finalized for', id);
      } else if (d.type === 'error') {
        console.warn('[Offscreen][OPFS] writer error', d);
      }
    };
    writer.postMessage({ type: 'init', id, meta: lastMeta });
  } catch (e) {
    console.warn('[Offscreen] failed to start OPFS writer worker:', e);
    writer = null;
    writerReady = false;
  }
}
function flushPendingIfReady() {
  if (!writer || !writerReady) return;
  while (pendingChunks.length) {
    const c = pendingChunks.shift()!;
    appendToOpfsChunk(c);
  }
  if (endPending) {
    endPending = false;
    void finalizeOpfsWriter();
  }
}


function appendToOpfsChunk(d: { data: any; timestamp?: number; type?: string; codedWidth?: number; codedHeight?: number; codec?: string }) {
  if (!writer || !writerReady) { pendingChunks.push(d); return; }

  try {
    const raw: any = d.data;
    let u8: Uint8Array | null = null;

    if (raw instanceof ArrayBuffer) {
      // Raw ArrayBuffer
      u8 = new Uint8Array(raw);
    } else if (raw && ArrayBuffer.isView(raw) && typeof raw.byteLength === 'number') {
      // Any TypedArray/DataView
      const view = raw as ArrayBufferView & { byteOffset?: number };
      u8 = new Uint8Array(view.buffer, (view as any).byteOffset || 0, view.byteLength);
    } else if (raw && typeof raw.copyTo === 'function' && typeof raw.byteLength === 'number') {
      // EncodedVideoChunk (WebCodecs)
      const tmp = new Uint8Array(raw.byteLength);
      try { raw.copyTo(tmp); } catch {}
      u8 = tmp;
    } else if (raw instanceof Blob) {
      // Blob -> async convert to ArrayBuffer then retry
      raw.arrayBuffer().then((ab) => {
        appendToOpfsChunk({ ...d, data: ab });
      }).catch((e) => console.warn('[Offscreen] blob to buffer failed', e));
      return;
    } else if (Array.isArray(raw)) {
      // Array<number>
      u8 = new Uint8Array(raw as number[]);
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      // Handle serialized Uint8Array from Chrome messaging: {0: 145, 1: 218, 2: 3, ...}
      const keys = Object.keys(raw);
      const isIndexedObject = keys.length > 0 && keys.every(k => /^\d+$/.test(k));

      if (isIndexedObject) {
        const maxIndex = Math.max(...keys.map(k => parseInt(k, 10)));
        const bytes = new Array(maxIndex + 1);
        for (let i = 0; i <= maxIndex; i++) {
          bytes[i] = raw[i] || 0;
        }
        u8 = new Uint8Array(bytes);
      }
    }

    if (!u8) {
      console.warn('[Offscreen] Unsupported chunk data type', raw && Object.prototype.toString.call(raw));
      return;
    }

    // Prefer zero-copy transfer when view covers the whole buffer; otherwise slice to exact range
    const transferBuf = (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength)
      ? u8.buffer
      : u8.slice().buffer;

    // Light logging for early chunks
    if ((window as any).__opfs_log_count == null) (window as any).__opfs_log_count = 0;
    if ((window as any).__opfs_log_count < 5) {
      (window as any).__opfs_log_count++;
      console.log('[Offscreen] append size', u8.byteLength, 'ts', d.timestamp, 'type', d.type);
    }

    writer.postMessage({
      type: 'append',
      buffer: transferBuf,
      timestamp: d.timestamp || 0,
      chunkType: d.type === 'key' ? 'key' : 'delta',
      codedWidth: d.codedWidth || lastMeta?.width,
      codedHeight: d.codedHeight || lastMeta?.height,
      codec: d.codec || lastMeta?.codec,
      isKeyframe: d.type === 'key'
    }, [transferBuf]);
  } catch (e) {
    console.warn('[Offscreen] append failed', e);
  }
}

async function finalizeOpfsWriter() {
  if (!writer) return;
  const w = writer;
  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const onMsg = (ev: MessageEvent) => {
        const t = (ev.data || {}).type;
        if (t === 'finalized' || t === 'error') {
          if (!settled) { settled = true; try { w.removeEventListener('message', onMsg as any) } catch {}; resolve(); }
        }
      };
      try { w.addEventListener('message', onMsg as any); } catch {}
      try { w.postMessage({ type: 'finalize' }); } catch {}
      setTimeout(() => { if (!settled) { settled = true; try { w.removeEventListener('message', onMsg as any) } catch {}; resolve(); } }, 1500);
    });
  } catch (e) {
    console.warn('[Offscreen] finalize failed', e);
  } finally {
    try { w.terminate(); } catch {}
    if (writer === w) { writer = null; writerReady = false; sessionId = null; }
  }
}

// Connect to background and receive forwarded encoded-stream messages
(function connectToBackground() {
  try {
    const port = chrome.runtime.connect({ name: 'opfs-writer-sink' });
    console.log('[Offscreen] connected to background as opfs-writer-sink');

    port.onMessage.addListener(async (msg: any) => {
      try {
        switch (msg?.type) {
          case 'start':
            lastMeta = normalizeMeta({ codec: msg.codec, width: msg.width, height: msg.height, framerate: msg.framerate });
            initOpfsWriter(lastMeta);
            break;
          case 'meta':
            lastMeta = normalizeMeta(msg.metadata);
            if (!writer) initOpfsWriter(lastMeta);
            break;
          case 'chunk': {
            if (!writer) initOpfsWriter(lastMeta);

            console.log('chunk received', msg.data);
            appendToOpfsChunk({
              data: msg.data,
              timestamp: Number(msg.ts) || 0,
              type: msg.kind === 'key' ? 'key' : 'delta',
              codedWidth: lastMeta?.width,
              codedHeight: lastMeta?.height,
              codec: lastMeta?.codec
            });
            break;
          }
          case 'end':
          case 'end-request':
            console.log('[Offscreen] end received; finalizing OPFS writer');
            if (!writerReady || pendingChunks.length > 0) {
              endPending = true;
            } else {
              await finalizeOpfsWriter();
            }
            break;
          case 'error':
            console.warn('[Offscreen] upstream error:', msg?.message);
            break;
          default:
            break;
        }
      } catch (e) {
        console.warn('[Offscreen] handler error', e);
      }
    });

    // Optional: notify background this sink is ready (not strictly needed)
    try { port.postMessage({ type: 'sink-ready' }); } catch {}
  } catch (e) {
    console.warn('[Offscreen] failed to connect to background', e);
  }
})();

