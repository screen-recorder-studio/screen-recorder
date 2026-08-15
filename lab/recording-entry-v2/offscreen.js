let activeStream = null
let activeMode = null
let stopping = false
const intentionallyStoppedStreams = new WeakSet()
const reportedEndedTracks = new WeakSet()

function userActivationSnapshot() {
  const activation = navigator.userActivation
  return activation
    ? { isActive: activation.isActive, hasBeenActive: activation.hasBeenActive }
    : null
}

function trackSnapshot(track) {
  return {
    kind: track.kind,
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    settings: track.getSettings()
  }
}

function errorMessage(error) {
  if (error && typeof error.message === 'string') return `${error.name || 'Error'}: ${error.message}`
  return String(error || 'Unknown capture error')
}

async function publish(type, details = {}) {
  return chrome.runtime.sendMessage({ target: 'lab-background-event', type, ...details })
}

function observe(event, details = {}, at = Date.now()) {
  void publish('LAB_OBSERVATION', {
    source: 'offscreen',
    event,
    at,
    details
  }).catch(() => undefined)
}

function clearActiveStream() {
  activeStream = null
  activeMode = null
  stopping = false
}

async function stopActiveStream() {
  if (!activeStream) {
    await publish('LAB_CAPTURE_STOPPED')
    return
  }
  stopping = true
  intentionallyStoppedStreams.add(activeStream)
  const stream = activeStream
  for (const track of stream.getTracks()) {
    track.stop()
    await reportTrackEnded(track, activeMode, stream, true)
  }
  clearActiveStream()
  await publish('LAB_CAPTURE_STOPPED', { stoppedAt: Date.now() })
}

async function reportTrackEnded(track, mode, stream, intentional) {
  if (reportedEndedTracks.has(track)) return
  reportedEndedTracks.add(track)
  await publish('LAB_TRACK_ENDED', {
    mode,
    endedAt: Date.now(),
    intentional,
    track: trackSnapshot(track),
    streamIsActive: stream === activeStream
  }).catch(() => undefined)
}

function watchStream(stream, mode) {
  const tracks = stream.getTracks()
  let naturalEndReported = false
  for (const track of tracks) {
    track.addEventListener('ended', async () => {
      const endedAt = Date.now()
      const intentional = intentionallyStoppedStreams.has(stream)
      await reportTrackEnded(track, mode, stream, intentional)

      if (intentional || naturalEndReported || stream !== activeStream) return
      if (stream.getVideoTracks().some((candidate) => candidate.readyState === 'live')) return
      naturalEndReported = true
      clearActiveStream()
      await publish('LAB_CAPTURE_ENDED', {
        mode,
        endedAt,
        reason: `${track.kind} track ended`
      }).catch(() => undefined)
    }, { once: true })
  }
}

async function activateStream(stream, mode, metadata = {}) {
  if (activeStream) await stopActiveStream()
  activeStream = stream
  activeMode = mode
  watchStream(stream, mode)
  const tracks = stream.getTracks().map(trackSnapshot)
  await publish('LAB_CAPTURE_STARTED', {
    mode,
    variant: metadata.variant || null,
    resolvedAt: metadata.resolvedAt || Date.now(),
    tracks,
    diagnostics: { ...metadata, tracks }
  })
}

function waitForVariant(variant) {
  if (variant === 'microtask') {
    return new Promise((resolve) => queueMicrotask(resolve))
  }
  if (variant === 'delay-0') {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (variant === 'delay-1000') {
    return new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return Promise.resolve()
}

async function startDisplayCapture(message) {
  const receivedAt = Date.now()
  const receivedActivation = userActivationSnapshot()
  observe('display command received', {
    variant: message.variant,
    popup: message.popup || null,
    userActivation: receivedActivation
  }, receivedAt)

  if (message.variant !== 'immediate') await waitForVariant(message.variant)
  const callAt = Date.now()
  const callActivation = userActivationSnapshot()
  observe('getDisplayMedia called', {
    variant: message.variant,
    userActivation: callActivation,
    delayFromPopupClickMs: message.popup?.clickedAt ? callAt - message.popup.clickedAt : null,
    delayFromOffscreenReceiveMs: callAt - receivedAt
  }, callAt)

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    const resolvedAt = Date.now()
    await activateStream(stream, 'display', {
      variant: message.variant,
      popup: message.popup || null,
      requestedAt: message.requestedAt || null,
      receivedAt,
      receivedActivation,
      callAt,
      callActivation,
      resolvedAt
    })
  } catch (error) {
    const rejectedAt = Date.now()
    const errorName = error?.name || 'Error'
    const displayErrorMessage = error?.message || String(error)
    await publish('LAB_CAPTURE_FAILED', {
      mode: 'display',
      variant: message.variant,
      rejectedAt,
      errorName,
      errorMessage: displayErrorMessage,
      error: `${errorName}: ${displayErrorMessage}`,
      diagnostics: {
        variant: message.variant,
        popup: message.popup || null,
        requestedAt: message.requestedAt || null,
        receivedAt,
        receivedActivation,
        callAt,
        callActivation,
        rejectedAt,
        error: { name: errorName, message: displayErrorMessage }
      }
    })
    throw error
  }
}

async function startTabCapture(streamId, message) {
  const callAt = Date.now()
  const callActivation = userActivationSnapshot()
  observe('getUserMedia for tab called', {
    popup: message.popup || null,
    userActivation: callActivation
  }, callAt)
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  })
  await activateStream(stream, 'tab', {
    popup: message.popup || null,
    requestedAt: message.requestedAt || null,
    callAt,
    callActivation,
    resolvedAt: Date.now()
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'lab-offscreen') return false
  const operation = message.type === 'LAB_START_DISPLAY'
    ? startDisplayCapture(message)
    : message.type === 'LAB_START_TAB'
      ? startTabCapture(message.streamId, message)
      : message.type === 'LAB_STOP'
        ? stopActiveStream()
        : Promise.reject(new Error('Unknown offscreen lab command'))

  operation
    .then(() => sendResponse({ ok: true, mode: activeMode }))
    .catch(async (error) => {
      const messageText = errorMessage(error)
      if (message.type !== 'LAB_START_DISPLAY') {
        await publish('LAB_CAPTURE_FAILED', {
          mode: activeMode,
          rejectedAt: Date.now(),
          errorName: error?.name || 'Error',
          errorMessage: error?.message || String(error),
          error: messageText
        })
      }
      sendResponse({ ok: false, error: messageText })
    })
  return true
})
