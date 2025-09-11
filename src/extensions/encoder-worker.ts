// @ts-nocheck

// encoder-worker.js (classic worker)
// Receives VideoFrame objects from content script, encodes with WebCodecs VideoEncoder,
// and posts EncodedVideoChunk payloads (ArrayBuffer) back to the content script.

let encoder = null;
let configured = false;
let stats = { chunks: 0, bytes: 0 };
let cfg = { codec: 'vp8', width: 1280, height: 720, framerate: 30, bitrate: 4_000_000 };

function postError(message) {
  try { postMessage({ type: 'error', message }); } catch {}
}

function ensureEncoder() {
  if (encoder) return encoder;
  try {
    encoder = new VideoEncoder({
      output: (chunk) => {
        try {
          const buf = new Uint8Array(chunk.byteLength);
          chunk.copyTo(buf);
          stats.chunks += 1;
          stats.bytes += buf.byteLength;
          const head = buf.subarray(0, Math.min(16, buf.byteLength));
          postMessage({
            type: 'chunk', ts: chunk.timestamp, kind: chunk.type,
            size: buf.byteLength, head: Array.from(head), data: buf.buffer
          }, [buf.buffer]);
        } catch (err) {
          postError('copy encoded chunk failed: ' + (err?.message || String(err)));
        }
      },
      error: (e) => postError('VideoEncoder error: ' + (e?.message || String(e)))
    });
  } catch (e) {
    postError('create VideoEncoder failed: ' + (e?.message || String(e)));
  }
  return encoder;
}

async function flushAndClose() {
  try { await encoder?.flush?.(); } catch {}
  try { encoder?.close?.(); } catch {}
  encoder = null;
  configured = false;
}

onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    switch (msg.type) {
      case 'configure': {
        cfg = {
          codec: msg.codec || cfg.codec,
          width: msg.width || cfg.width,
          height: msg.height || cfg.height,
          framerate: msg.framerate || cfg.framerate,
          bitrate: msg.bitrate || cfg.bitrate,
        };
        const enc = ensureEncoder();
        if (!enc) return;
        enc.configure({ codec: cfg.codec, width: cfg.width, height: cfg.height, bitrate: cfg.bitrate, framerate: cfg.framerate });
        configured = true;
        stats = { chunks: 0, bytes: 0 };
        postMessage({ type: 'configured' });
        break;
      }
      case 'frame': {
        if (!configured) return;
        const frame = msg.frame; // ownership transferred
        const keyFrame = !!msg.keyFrame;
        try {
          encoder.encode(frame, { keyFrame });
        } catch (e) {
          postError('encode error: ' + (e?.message || String(e)));
        } finally {
          try { frame?.close?.(); } catch {}
        }
        break;
      }
      case 'stop': {
        await flushAndClose();
        postMessage({ type: 'end', chunks: stats.chunks, bytes: stats.bytes });
        break;
      }
      default:
        break;
    }
  } catch (e) {
    postError('worker onmessage error: ' + (e?.message || String(e)));
  }
};

