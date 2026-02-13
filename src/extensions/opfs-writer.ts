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
const __mode = (() => { try { return new URL(self.location.href).searchParams.get('mode') || ''; } catch { return ''; } })();
const __isProbe = (__mode === 'probe');
const __isIframeSink = (__mode === 'iframe');

function ensureSessionId() {
  if (!sessionId) sessionId = `${Date.now()}`;
  return sessionId;
}

function normalizeMeta(m: any) {
  if (!m) return {} as any;
  const metaW = (typeof m.width === 'number') ? m.width : (m.codedWidth);
  const metaH = (typeof m.height === 'number') ? m.height : (m.codedHeight);
  const selW = (typeof m?.selectedRegion?.width === 'number') ? m.selectedRegion.width : undefined;
  const selH = (typeof m?.selectedRegion?.height === 'number') ? m.selectedRegion.height : undefined;
  return {
    codec: m.codec || 'vp8',
    // Prefer actual encoded/meta width/height; fallback to selectedRegion, then defaults
    width: metaW ?? selW ?? 1920,
    height: metaH ?? selH ?? 1080,
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
        flushPendingIfReady();
      } else if (d.type === 'progress') {
        const { bytesWrittenTotal, chunksWritten } = d;
      } else if (d.type === 'finalized') {
        try {
          const recId = (d && d.id != null) ? `rec_${d.id}` : `rec_${ensureSessionId()}`
          chrome.runtime?.sendMessage({ type: 'OPFS_RECORDING_READY', id: recId, meta: lastMeta })
        } catch (e) {
          console.warn('[Offscreen] failed to notify background of OPFS recording', e)
        }
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

// Iframe sink mode: receive messages from content and write directly to OPFS (no background)
if (__isIframeSink) {
  (function iframeSink() {
    try {
      let started = false;
      window.addEventListener('message', (ev) => {
        const d: any = ev.data || {};
        switch (d.type) {
          case 'ping':
            try { (ev.source as WindowProxy | null)?.postMessage({ type: 'sink-ready' }, '*'); } catch {}
            break;
          case 'start':
            lastMeta = normalizeMeta({ codec: d.codec, width: d.width, height: d.height, framerate: d.framerate });
            initOpfsWriter(lastMeta);
            started = true;
            break;
          case 'meta':
            lastMeta = normalizeMeta(d.metadata);
            if (!writer) initOpfsWriter(lastMeta);
            break;
          case 'chunk': {
            if (!writer) initOpfsWriter(lastMeta);
            appendToOpfsChunk({
              data: d.data,
              timestamp: Number(d.ts) || 0,
              type: d.kind === 'key' ? 'key' : 'delta',
              codedWidth: lastMeta?.width,
              codedHeight: lastMeta?.height,
              codec: lastMeta?.codec
            });
            break;
          }
          case 'end':
          case 'end-request':

            // ✅ 延迟200ms确保所有chunks到达
            setTimeout(() => {
              if (!writerReady || pendingChunks.length > 0) {
                endPending = true;
              } else {
                void finalizeOpfsWriter();
              }
            }, 200);
            break;
        }
      });
    } catch (e) {
      console.warn('[Offscreen] iframe sink error', e);
    }
  })();

// Connect to background and receive forwarded encoded-stream messages (disabled in probe or iframe mode)
} else if (!__isProbe) {
  (function connectToBackground() {
    try {
      const port = chrome.runtime.connect({ name: 'opfs-writer-sink' });

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
} else {
  // Probe mode: accept direct messages from content via window.postMessage, log only
  try {
    let __probe_log_count = 0;
    function __headHex(u8: Uint8Array, n = 16) {
      const len = Math.min(n, u8.length); const out = new Array(len);
      for (let i = 0; i < len; i++) out[i] = u8[i].toString(16).padStart(2, '0');
      return out.join(' ');
    }
    function __tailHex(u8: Uint8Array, n = 8) {
      const len = Math.min(n, u8.length); const out = new Array(len);
      for (let i = 0; i < len; i++) { const idx = u8.length - len + i; out[i] = u8[idx].toString(16).padStart(2, '0'); }
      return out.join(' ');
    }
    function __sum32(u8: Uint8Array) {
      let s = 0 >>> 0; for (let i = 0; i < u8.length; i++) { s = (s + u8[i]) >>> 0; } return s >>> 0;
    }

    window.addEventListener('message', (ev) => {
      const d: any = ev.data || {};
      if (d.type === 'ping') {
        try { (ev.source as WindowProxy | null)?.postMessage({ type: 'sink-ready' }, '*'); } catch {}
        return;
      }
      if (d.type === 'start' || d.type === 'meta' || d.type === 'end') {
        if (__probe_log_count < 10) { __probe_log_count++; }
        return;
      }
      if (d.type === 'chunk') {
        if (__probe_log_count < 10) {
          const raw = d.data;
          const size = (raw && ((raw as any).byteLength ?? (raw as any).length)) || 0;
          let u8: Uint8Array | null = null;
          if (raw instanceof ArrayBuffer) u8 = new Uint8Array(raw);
          else if (raw && ArrayBuffer.isView(raw) && typeof raw.byteLength === 'number') {
            const view = raw as ArrayBufferView & { byteOffset?: number };
            u8 = new Uint8Array(view.buffer, (view as any).byteOffset || 0, view.byteLength);
          } else if (Array.isArray(raw)) u8 = new Uint8Array(raw as number[]);
          const head16 = u8 ? __headHex(u8, 16) : undefined;
          const tail8 = u8 ? __tailHex(u8, 8) : undefined;
          const sum32 = u8 ? ('0x' + __sum32(u8).toString(16).padStart(8, '0')) : undefined;
          __probe_log_count++;
        }
        return;
      }
    });
  } catch (e) {
    console.warn('[Offscreen] probe mode error', e);
  }
}

