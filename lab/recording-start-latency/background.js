const OFFSCREEN_URL = 'offscreen.html'

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  })
  if (contexts.length > 0) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['DISPLAY_MEDIA', 'USER_MEDIA', 'WORKERS'],
    justification: 'Measure capture warm-up and the first post-countdown frame'
  })
}

function sendToOffscreen(message) {
  return chrome.runtime.sendMessage({ ...message, target: 'latency-offscreen' })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === 'latency-offscreen' || message?.target === 'latency-surface') return false

  if (message?.target === 'latency-background' && message?.type === 'SAVE_LATENCY_STATE') {
    chrome.storage.session.set(message.values || {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  if (message?.type === 'OPEN_SURFACE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('surface.html') })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  if (message?.type === 'START_LATENCY_PROBE') {
    ;(async () => {
      try {
        await ensureOffscreen()
        let streamId
        if (message.mode === 'tab') {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab?.id) throw new Error('No active tab is available')
          streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
        }
        const response = await sendToOffscreen({
          type: 'START_LATENCY_PROBE',
          mode: message.mode === 'display' ? 'display' : 'tab',
          countdownSeconds: message.countdownSeconds,
          settleMs: message.settleMs,
          streamId
        })
        sendResponse(response)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await chrome.storage.session.set({
          recordingStartLatencyProgressV1: {
            stage: 'background-error',
            at: Date.now(),
            error: errorMessage
          },
          recordingStartLatencyResultV1: {
            pass: false,
            stage: 'background-error',
            error: errorMessage,
            finishedAt: Date.now()
          }
        })
        sendResponse({ ok: false, error: errorMessage })
      }
    })()
    return true
  }

  if (message?.type === 'STOP_LATENCY_PROBE') {
    ensureOffscreen()
      .then(() => sendToOffscreen({ type: 'STOP_LATENCY_PROBE' }))
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  return false
})
