// WebCodecs encoder worker for streaming encoded chunks out of content script

let encoder = null;
let pendingConfig = null;
let configured = false;

function postError(err) {
  try {
    postMessage({ type: 'error', message: (err && err.message) ? err.message : String(err) });
  } catch (_) {}
}

function handleChunk(chunk /* EncodedVideoChunk */, metadata) {
  try {
    const buf = new ArrayBuffer(chunk.byteLength);
    // In some implementations, copyTo accepts a Uint8Array destination
    chunk.copyTo(new Uint8Array(buf));
    postMessage({
      type: 'chunk',
      buf,
      timestamp: chunk.timestamp ?? 0,
      duration: chunk.duration ?? 0,
      isKey: chunk.type === 'key'
    }, [buf]);
  } catch (e) {
    postError(e);
  }
}

function ensureConfigured(frame /* VideoFrame */) {
  if (configured) return;
  const width = frame?.displayWidth || frame?.codedWidth || pendingConfig?.width || 1920;
  const height = frame?.displayHeight || frame?.codedHeight || pendingConfig?.height || 1080;
  const cfg = pendingConfig || {};
  const codec = cfg.codec || 'vp09'; // try VP9 first; fallback behavior is handled by browser
  const bitrate = cfg.bitrate || 8_000_000; // 8 Mbps default
  const framerate = cfg.framerate || 30;

  try {
    encoder = new VideoEncoder({
      output: handleChunk,
      error: (err) => postError(err)
    });

    encoder.configure({
      codec,
      width,
      height,
      bitrate,
      framerate
    });

    configured = true;
    postMessage({ type: 'configured', config: { codec, width, height, bitrate, framerate } });
  } catch (e) {
    postError(e);
  }
}

onmessage = async (e) => {
  const data = e.data || {};
  const type = data.type;

  try {
    if (type === 'configure') {
      pendingConfig = data.config || null;
      return;
    }

    if (type === 'encode') {
      const frame = data.frame; // ownership transferred
      if (!encoder || !configured) ensureConfigured(frame);
      if (encoder) {
        // Optionally, you could force keyframes on interval using encoder.encode(frame, { keyFrame: condition })
        encoder.encode(frame);
      } else {
        // If configuration failed, close the frame to avoid leaks
        try { frame.close?.(); } catch (_) {}
      }
      return;
    }

    if (type === 'stop') {
      if (encoder) {
        try { await encoder.flush(); } catch (_) {}
        try { encoder.close(); } catch (_) {}
      }
      encoder = null;
      configured = false;
      pendingConfig = null;
      postMessage({ type: 'complete' });
      return;
    }
  } catch (err) {
    postError(err);
  }
};

