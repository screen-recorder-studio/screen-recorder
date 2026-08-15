const summary = document.querySelector('#summary')
const detail = document.querySelector('#detail')
const events = document.querySelector('#events')
const buttons = [...document.querySelectorAll('button')]
const displayVariant = document.querySelector('#display-variant')

function userActivationSnapshot() {
  const activation = navigator.userActivation
  return activation
    ? { isActive: activation.isActive, hasBeenActive: activation.hasBeenActive }
    : null
}

function popupObservation(event, details = {}) {
  return {
    target: 'lab-background-event',
    type: 'LAB_OBSERVATION',
    source: 'popup',
    event,
    at: Date.now(),
    details: {
      visibilityState: document.visibilityState,
      userActivation: userActivationSnapshot(),
      ...details
    }
  }
}

function publishPopupObservation(event, details) {
  // Lifecycle delivery, especially pagehide, is intentionally best effort.
  void chrome.runtime.sendMessage(popupObservation(event, details)).catch(() => undefined)
}

function send(type, details = {}) {
  return chrome.runtime.sendMessage({ target: 'lab-background', type, ...details })
}

function eventLine(entry) {
  const source = entry.source ? `[${entry.source}] ` : ''
  const detailsText = entry.details ? ` ${JSON.stringify(entry.details)}` : ''
  return `${new Date(entry.at).toLocaleTimeString()}  ${source}${entry.event}${detailsText}`
}

function render(state) {
  const mode = state.mode ? ` / ${state.mode}` : ''
  summary.textContent = `${state.phase}${mode}`
  detail.textContent = state.error
    ? state.error
    : state.startedAt
      ? `Started ${new Date(state.startedAt).toLocaleTimeString()}${state.variant ? ` (${state.variant})` : ''}`
      : 'No active stream'
  events.textContent = (state.events || [])
    .map(eventLine)
    .join('\n')

  const busy = state.phase === 'requesting'
  document.querySelector('#display').disabled = busy || state.phase === 'streaming'
  document.querySelector('#tab').disabled = busy || state.phase === 'streaming'
  document.querySelector('#stop').disabled = !['requesting', 'streaming', 'ended', 'failed'].includes(state.phase)
  document.querySelector('#reset').disabled = false
  displayVariant.disabled = busy || state.phase === 'streaming'
}

async function run(type, details = {}) {
  buttons.forEach((button) => { button.disabled = true })
  displayVariant.disabled = true
  try {
    const response = await send(type, details)
    if (!response?.ok) throw new Error(response?.error || 'Lab command failed')
    render(response.state)
  } catch (error) {
    render({ phase: 'failed', mode: null, startedAt: null, events: [], error: String(error?.message || error) })
  }
}

function clickContext() {
  return {
    clickedAt: Date.now(),
    visibilityState: document.visibilityState,
    userActivation: userActivationSnapshot()
  }
}

document.querySelector('#display').addEventListener('click', () => run('LAB_START_DISPLAY', {
  variant: displayVariant.value,
  popup: clickContext()
}))
document.querySelector('#tab').addEventListener('click', () => run('LAB_START_TAB', { popup: clickContext() }))
document.querySelector('#stop').addEventListener('click', () => run('LAB_STOP'))
document.querySelector('#reset').addEventListener('click', () => run('LAB_RESET'))

window.addEventListener('pageshow', (event) => {
  publishPopupObservation('pageshow', { persisted: event.persisted })
})

document.addEventListener('visibilitychange', () => {
  publishPopupObservation('visibilitychange')
})

window.addEventListener('pagehide', (event) => {
  publishPopupObservation('pagehide', { persisted: event.persisted })
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'session') return
  const changed = changes['recording-entry-v2-lab-state']
  if (changed?.newValue) render(changed.newValue)
})

run('LAB_PREPARE')
