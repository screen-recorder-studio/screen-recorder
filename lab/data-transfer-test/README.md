# OPFS Transfer & Offscreen PostMessage Test (MV3)

This extension demonstrates two things:
- Content script to background/offscreen via chrome.runtime messaging cannot transfer ownership (ArrayBuffer isn’t detached)
- Inside the offscreen document, window.postMessage with a transfer list does detach the sender’s buffer

## Files
- manifest.json — MV3 config (includes offscreen + web_accessible_resources)
- background.js — ensures offscreen, forwards messages to it; still contains the earlier OPFS writer via Port for reference
- content.js — creates a buffer, sends Base64 chunks to offscreen (via background), logs no-detach
- offscreen.html/.js — rebuilds data, posts ArrayBuffer to iframe with transfer list, logs detach before/after
- child.html/.js — receives the transferred ArrayBuffer, logs size/checksum

## How to load
1. Open chrome://extensions and enable Developer mode
2. Click “Load unpacked” and select this folder: `lab/data-transfer-test`
3. Open any page (matches are <all_urls>) and open DevTools Console on that page:
   - You should see from content script:
     - `CS: before transfer byteLength 262144`
     - `CS: after send (no transfer) byteLength 262144`
4. In chrome://extensions, click your extension’s “Service worker” (Inspect views) to open its console
5. In the “Offscreen” (Inspect views) console (it will appear once created), you should see:
   - `OFF: chunk recv ...` repeated
   - `OFF: reassembled 262144 expected 262144`
   - `OFF: before postMessage transfer, sender view length 262144`
   - `OFF: after postMessage transfer, sender view length 0`  ← ownership transferred inside offscreen → iframe
6. In the “Offscreen” child iframe (same Inspect window) Console, you should see from child.js:
   - `CHILD: received { isArrayBuffer: true, byteLength: 262144 }`
   - `CHILD: checksum ...`

## Notes
- chrome.runtime Port/sendMessage do not support transferable objects; buffers are cloned and the sender’s buffer is not detached
- Offscreen document allows us to test window.postMessage with a transfer list (which does detach)
- The Service Worker still contains a OPFS write path via Port from earlier experiments, but the current data flow uses offscreen

