// Page receiver script (runs in page JS context)
// Listens for messages from the content script, receives ArrayBuffer via
// window.postMessage transfer list, and logs results.
(function () {
  function checksum(u8) {
    let s = 0; for (let i = 0; i < u8.length; i++) s = (s + u8[i]) >>> 0; return s;
  }

  // Handshake: respond to content script when ready
  window.addEventListener('message', (ev) => {
    if (ev?.data && ev.data.type === 'cs-ping') {
      window.postMessage({ type: 'page-ready' }, '*');
    }
  });

  // Receive the transferred buffer
  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (!msg || msg.type !== 'from-cs') return;
    const ab = msg.ab;
    const ok = ab instanceof ArrayBuffer;
    const len = ok ? ab.byteLength : -1;
    console.log('PAGE: received', { isArrayBuffer: ok, byteLength: len });
    if (ok) {
      const u8 = new Uint8Array(ab);
      console.log('PAGE: checksum', checksum(u8));
    }
  });
})();

