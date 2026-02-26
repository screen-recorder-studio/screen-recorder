'use strict';
(function(){
  try { console.log('[Offscreen] page loaded'); } catch (e) {}
  try {
    // Step 2: simple message logger, no heavy logic
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.target !== 'offscreen') return;
      console.log('[Offscreen] message:', msg.type, msg);
      try { sendResponse && sendResponse({ ok: true, echoed: msg.type }); } catch (e) {}
      return true;
    });
  } catch (e) {
    console.warn('[Offscreen] onMessage unavailable?', e);
  }
})();

