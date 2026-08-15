const STATE_KEY = 'recording-entry-v2-lab-state'
const IDLE_STATE = Object.freeze({
  phase: 'idle',
  mode: null,
  variant: null,
  startedAt: null,
  updatedAt: 0,
  error: null,
  diagnostics: null,
  events: []
})

let creatingOffscreenDocument = null
let stateWriteQueue = Promise.resolve()

async function readState() {
  const stored = await chrome.storage.session.get(STATE_KEY)
  return { ...IDLE_STATE, ...(stored[STATE_KEY] || {}) }
}

function normalizeEvent(event) {
  if (!event) return null
  if (typeof event === 'string') return { at: Date.now(), source: 'background', event }
  return {
    at: event.at || Date.now(),
    source: event.source || 'background',
    event: event.event,
    ...(event.details ? { details: event.details } : {})
  }
}

function writeState(patch, event) {
  const write = stateWriteQueue.then(async () => {
    const previous = await readState()
    const observation = normalizeEvent(event)
    const nextEvents = observation
      ? [observation, ...(previous.events || [])].slice(0, 60)
      : previous.events
    const next = { ...previous, ...patch, updatedAt: Date.now(), events: nextEvents }
    await chrome.storage.session.set({ [STATE_KEY]: next })
    return next
  })
  stateWriteQueue = write.catch(() => undefined)
  return write
}

async function readSettledState() {
  await stateWriteQueue
  return readState()
}

async function hasOffscreenDocument() {
  if (typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    return contexts.length > 0
  }
  return false
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DISPLAY_MEDIA', 'USER_MEDIA'],
      justification: 'Validate capture lifetime independently from the action popup.'
    }).finally(() => {
      creatingOffscreenDocument = null
    })
  }
  await creatingOffscreenDocument
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument()
  return chrome.runtime.sendMessage({ target: 'lab-offscreen', ...message })
}

const DISPLAY_VARIANTS = new Set(['immediate', 'microtask', 'delay-0', 'delay-1000'])

async function startDisplayCapture(message) {
  const variant = DISPLAY_VARIANTS.has(message.variant) ? message.variant : 'immediate'
  await writeState(
    { phase: 'requesting', mode: 'display', variant, startedAt: null, error: null, diagnostics: null },
    {
      source: 'popup',
      at: message.popup?.clickedAt,
      event: 'display capture requested',
      details: { variant, popup: message.popup || null }
    }
  )
  const response = await sendToOffscreen({
    type: 'LAB_START_DISPLAY',
    variant,
    popup: message.popup || null,
    requestedAt: Date.now()
  })
  if (!response?.ok) throw new Error(response?.error || 'Offscreen display request failed')
  return readSettledState()
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active browser tab is available')
  return tab
}

async function startTabCapture(message) {
  await ensureOffscreenDocument()
  const tab = await getActiveTab()
  await writeState(
    { phase: 'requesting', mode: 'tab', variant: null, startedAt: null, error: null, diagnostics: null },
    {
      source: 'popup',
      at: message.popup?.clickedAt,
      event: `tab capture requested for tab ${tab.id}`,
      details: { popup: message.popup || null }
    }
  )
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
  const response = await chrome.runtime.sendMessage({
    target: 'lab-offscreen',
    type: 'LAB_START_TAB',
    streamId,
    popup: message.popup || null,
    requestedAt: Date.now()
  })
  if (!response?.ok) throw new Error(response?.error || 'Offscreen tab request failed')
  return readSettledState()
}

async function handleCommand(message) {
  switch (message.type) {
    case 'LAB_PREPARE':
      await ensureOffscreenDocument()
      return { ok: true, state: await readSettledState() }
    case 'LAB_GET_STATE':
      return { ok: true, state: await readSettledState() }
    case 'LAB_START_DISPLAY':
      return { ok: true, state: await startDisplayCapture(message) }
    case 'LAB_START_TAB':
      return { ok: true, state: await startTabCapture(message) }
    case 'LAB_STOP': {
      const response = await sendToOffscreen({ type: 'LAB_STOP' })
      if (!response?.ok) throw new Error(response?.error || 'Offscreen stop failed')
      return { ok: true, state: await readSettledState() }
    }
    case 'LAB_RESET':
      await sendToOffscreen({ type: 'LAB_STOP' }).catch(() => undefined)
      await chrome.storage.session.remove(STATE_KEY)
      await chrome.action.setBadgeText({ text: '' })
      return { ok: true, state: await readSettledState() }
    default:
      return null
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === 'lab-background-event') {
    if (message.type === 'LAB_OBSERVATION') {
      writeState({}, {
        at: message.at,
        source: message.source,
        event: message.event,
        details: message.details
      })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }))
      return true
    }

    const updates = {
      LAB_CAPTURE_STARTED: {
        patch: {
          phase: 'streaming',
          mode: message.mode,
          variant: message.variant || null,
          startedAt: message.resolvedAt || Date.now(),
          error: null,
          diagnostics: message.diagnostics || null
        },
        event: {
          at: message.resolvedAt,
          source: 'offscreen',
          event: `${message.mode} stream started`,
          details: { variant: message.variant || null, tracks: message.tracks || [] }
        }
      },
      LAB_CAPTURE_ENDED: {
        patch: { phase: 'ended', startedAt: null },
        event: {
          at: message.endedAt,
          source: 'offscreen',
          event: `${message.mode || 'capture'} stream ended: ${message.reason || 'track ended'}`
        }
      },
      LAB_CAPTURE_STOPPED: {
        patch: { phase: 'idle', mode: null, variant: null, startedAt: null, error: null },
        event: { at: message.stoppedAt, source: 'offscreen', event: 'capture stopped' }
      },
      LAB_CAPTURE_FAILED: {
        patch: {
          phase: 'failed',
          variant: message.variant || null,
          startedAt: null,
          error: message.error || 'Capture failed',
          diagnostics: message.diagnostics || null
        },
        event: {
          at: message.rejectedAt,
          source: 'offscreen',
          event: 'capture rejected',
          details: {
            variant: message.variant || null,
            error: { name: message.errorName || null, message: message.errorMessage || message.error || null }
          }
        }
      },
      LAB_TRACK_ENDED: {
        patch: {},
        event: {
          at: message.endedAt,
          source: 'offscreen',
          event: `${message.track?.kind || 'unknown'} track ended`,
          details: { intentional: Boolean(message.intentional), track: message.track || null }
        }
      }
    }
    const update = updates[message.type]
    if (!update) return false
    writeState(update.patch, update.event)
      .then(async (state) => {
        await chrome.action.setBadgeText({ text: state.phase === 'streaming' ? 'LIVE' : '' })
        await chrome.action.setBadgeBackgroundColor({ color: '#d93025' })
        sendResponse({ ok: true })
      })
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }))
    return true
  }

  if (message?.target !== 'lab-background') return false
  handleCommand(message)
    .then((response) => sendResponse(response || { ok: false, error: 'Unknown lab command' }))
    .catch(async (error) => {
      const errorMessage = String(error?.message || error)
      const current = await readSettledState()
      if (current.phase !== 'failed') {
        await writeState(
          { phase: 'failed', startedAt: null, error: errorMessage },
          { source: 'background', event: 'command failed', details: { error: errorMessage } }
        )
      }
      sendResponse({ ok: false, error: errorMessage, state: await readSettledState() })
    })
  return true
})
