const overlay = document.querySelector('#countdown-overlay')
const value = document.querySelector('#countdown-value')
const clock = document.querySelector('#clock')
const startedAt = performance.now()

function tick() {
  clock.value = `${((performance.now() - startedAt) / 1000).toFixed(3)}s`
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'latency-surface') return false
  if (message.type === 'LAB_COUNTDOWN_SHOW') {
    value.textContent = String(message.remaining)
    overlay.hidden = false
    document.documentElement.dataset.capturePhase = 'countdown'
    sendResponse({ ok: true })
    return false
  }
  if (message.type === 'LAB_COUNTDOWN_HIDE') {
    overlay.hidden = true
    document.documentElement.dataset.capturePhase = 'live'
    requestAnimationFrame(() => requestAnimationFrame(() => sendResponse({ ok: true })))
    return true
  }
  return false
})
