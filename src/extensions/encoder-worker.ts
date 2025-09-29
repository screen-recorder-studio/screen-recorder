// @ts-nocheck

// encoder-worker.js (classic worker)
// H.264-first WebCodecs encoder with auto-detection, realtime params, backpressure, and GOP keyframes.
// Receives VideoFrame objects and posts EncodedVideoChunk payloads (ArrayBuffer) back to the content script.

import { tryConfigureBestEncoder, computeBitrate } from '../lib/utils/webcodecs-config'

let encoder = null;
let configured = false;
let stats = { chunks: 0, bytes: 0 };
let cfg = { codec: 'auto', width: 1280, height: 720, framerate: 30, bitrate: 4_000_000 };
let selectedCodec = 'unknown';
let gopFrames = 60; // default ~2s at 30fps, will be recalculated on configure
let frameCounter = 0;
const BACKPRESSURE_MAX = 8; // drop frames if encode queue grows beyond this

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
        // Merge and sanitize
        cfg = {
          codec: (msg.codec ?? cfg.codec) || 'auto',
          width: msg.width || cfg.width,
          height: msg.height || cfg.height,
          framerate: msg.framerate || cfg.framerate,
          bitrate: msg.bitrate || cfg.bitrate,
        };
        // Recalculate GOP based on fps
        const fps = Math.max(1, cfg.framerate|0);
        gopFrames = Math.max(30, Math.round(fps * 1.5)); // ~1.5s
        frameCounter = 0;
        stats = { chunks: 0, bytes: 0 };

        try {
          ensureEncoder();
          const { applied, selectedCodec: sel } = await tryConfigureBestEncoder(encoder, cfg);
          configured = true;
          selectedCodec = sel;
          const report = { ...applied, codec: sel };
          try { postMessage({ type: 'configured', config: report }); } catch {}
        } catch (e) {
          postError('configure failed: ' + (e?.message || String(e)));
        }
        break;
      }

      case 'frame': {
        if (!configured || !encoder) { try { msg.frame?.close?.(); } catch {}; return; }
        const frame = msg.frame; // VideoFrame ownership transferred

        // Backpressure: drop if queue too long
        try {
          if (encoder.encodeQueueSize != null && encoder.encodeQueueSize > BACKPRESSURE_MAX) {
            try { frame?.close?.(); } catch {}
            break;
          }
        } catch {}

        const externalKey = !!msg.keyFrame;
        frameCounter = (frameCounter + 1) >>> 0;
        const forceKey = externalKey || (gopFrames > 0 && (frameCounter % gopFrames === 0));
        try {
          encoder.encode(frame, forceKey ? { keyFrame: true } : {});
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

