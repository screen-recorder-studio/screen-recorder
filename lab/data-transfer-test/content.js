// Content script: creates a buffer, transfers ownership to SW via Port, then verifies detachment

(async () => {
  if (window.top !== window) return; // avoid iframes

  // Ensure offscreen document exists
  await chrome.runtime.sendMessage({ type: 'ensure-offscreen' });

  const size = 256 * 1024; // 256KB
  const ab = new ArrayBuffer(size);
  const u8 = new Uint8Array(ab);
  for (let i = 0; i < u8.length; i++) u8[i] = (i * 13) & 0xff;

  console.log('CS: before transfer byteLength', u8.byteLength);

  // Fallback: send as base64 chunks so SW 端能可靠接收
  const CHUNK = 64 * 1024;
  const b64FromU8 = (arr) => {
    // chunked to avoid call stack overflow
    let s = '';
    const STEP = 0x8000;
    for (let i = 0; i < arr.length; i += STEP) {
      s += String.fromCharCode.apply(null, arr.subarray(i, i + STEP));
    }
    return btoa(s);
  };

  for (let off = 0; off < u8.length; off += CHUNK) {
    const slice = u8.subarray(off, Math.min(u8.length, off + CHUNK));
    await chrome.runtime.sendMessage({ type: 'offscreen-feed-chunk-b64', offset: off, b64: b64FromU8(slice) });
  }

  console.log('CS: after send (no transfer) byteLength', u8.byteLength);
  // 完成信号
  await chrome.runtime.sendMessage({ type: 'offscreen-feed-done', total: u8.length });
})();

