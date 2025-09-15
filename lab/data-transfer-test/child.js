// Child iframe: receives ArrayBuffer via window.postMessage with transfer list

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'from-offscreen') return;
  const ab = msg.ab;
  const isAB = ab instanceof ArrayBuffer;
  const len = isAB ? ab.byteLength : -1;
  console.log('CHILD: received', { isArrayBuffer: isAB, byteLength: len });

  if (isAB) {
    const u8 = new Uint8Array(ab);
    let sum = 0;
    for (let i = 0; i < u8.length; i++) sum = (sum + u8[i]) >>> 0;
    console.log('CHILD: checksum', sum);
  }
});

