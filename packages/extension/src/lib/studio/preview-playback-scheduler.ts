export interface PreviewClock {
  durationMs: number
  anchorPositionMs: number
  anchorNowMs: number
  playing: boolean
}

export interface PreviewClockSample {
  positionMs: number
  ended: boolean
}

export interface PreviewPlaybackRange {
  startMs: number
  endMs: number
  positionMs: number
}

export function resolvePreviewPlaybackRange(input: {
  durationMs: number
  positionMs: number
  trim?: { enabled?: boolean; startMs: number; endMs: number }
}): PreviewPlaybackRange {
  const durationMs = nonNegativeFinite(input.durationMs)
  const startMs = input.trim?.enabled
    ? clampPosition(input.trim.startMs, durationMs)
    : 0
  const candidateEndMs = input.trim?.enabled
    ? clampPosition(input.trim.endMs, durationMs)
    : durationMs
  const endMs = Math.max(startMs, candidateEndMs)
  const requestedPositionMs = clampPosition(input.positionMs, durationMs)
  const positionMs = requestedPositionMs < startMs || requestedPositionMs >= endMs
    ? startMs
    : requestedPositionMs

  return { startMs, endMs, positionMs }
}

export interface PreviewRenderDesired {
  windowGeneration: number
  sourceFrameIndex: number
  presentationTimeMs: number
}

export interface PreviewRenderRequest extends PreviewRenderDesired {
  requestId: number
}

export interface PreviewRenderGate {
  windowGeneration: number
  nextRequestId: number
  inFlight: PreviewRenderRequest | null
  queued: PreviewRenderDesired | null
}

export type PreviewTargetDecision =
  | { action: 'render'; localFrameIndex: number }
  | { action: 'request-window'; targetGlobalFrame: number }
  | { action: 'wait-window'; targetGlobalFrame: number }

export function createPreviewClock(input: {
  durationMs: number
  positionMs?: number
}): PreviewClock {
  const durationMs = nonNegativeFinite(input.durationMs)
  return {
    durationMs,
    anchorPositionMs: clampPosition(input.positionMs ?? 0, durationMs),
    anchorNowMs: 0,
    playing: false
  }
}

export function samplePreviewClock(clock: PreviewClock, nowMs: number): PreviewClockSample {
  const elapsedMs = clock.playing
    ? Math.max(0, finiteOrZero(nowMs) - clock.anchorNowMs)
    : 0
  const positionMs = clampPosition(clock.anchorPositionMs + elapsedMs, clock.durationMs)
  return {
    positionMs,
    ended: clock.durationMs > 0 && positionMs >= clock.durationMs
  }
}

export function playPreviewClock(clock: PreviewClock, nowMs: number): PreviewClock {
  if (clock.playing) return clock
  const sample = samplePreviewClock(clock, nowMs)
  return {
    ...clock,
    anchorPositionMs: sample.ended ? 0 : sample.positionMs,
    anchorNowMs: finiteOrZero(nowMs),
    playing: true
  }
}

export function pausePreviewClock(clock: PreviewClock, nowMs: number): PreviewClock {
  const sample = samplePreviewClock(clock, nowMs)
  return {
    ...clock,
    anchorPositionMs: sample.positionMs,
    anchorNowMs: finiteOrZero(nowMs),
    playing: false
  }
}

export function seekPreviewClock(clock: PreviewClock, positionMs: number, nowMs: number): PreviewClock {
  return {
    ...clock,
    anchorPositionMs: clampPosition(positionMs, clock.durationMs),
    anchorNowMs: finiteOrZero(nowMs)
  }
}

export function createPreviewRenderGate(windowGeneration: number): PreviewRenderGate {
  return {
    windowGeneration,
    nextRequestId: 1,
    inFlight: null,
    queued: null
  }
}

export function queuePreviewRender(
  gate: PreviewRenderGate,
  desired: PreviewRenderDesired
): { gate: PreviewRenderGate; dispatch: PreviewRenderRequest | null } {
  if (desired.windowGeneration !== gate.windowGeneration) {
    return { gate, dispatch: null }
  }

  if (gate.inFlight) {
    return {
      gate: { ...gate, queued: desired },
      dispatch: null
    }
  }

  const dispatch = toRequest(gate.nextRequestId, desired)
  return {
    gate: {
      ...gate,
      nextRequestId: gate.nextRequestId + 1,
      inFlight: dispatch,
      queued: null
    },
    dispatch
  }
}

export function completePreviewRender(
  gate: PreviewRenderGate,
  requestId: number
): {
  gate: PreviewRenderGate
  dispatch: PreviewRenderRequest | null
  accepted: boolean
} {
  if (!gate.inFlight || gate.inFlight.requestId !== requestId) {
    return { gate, dispatch: null, accepted: false }
  }

  if (!gate.queued) {
    return {
      gate: { ...gate, inFlight: null },
      dispatch: null,
      accepted: true
    }
  }

  const dispatch = toRequest(gate.nextRequestId, gate.queued)
  return {
    gate: {
      ...gate,
      nextRequestId: gate.nextRequestId + 1,
      inFlight: dispatch,
      queued: null
    },
    dispatch,
    accepted: true
  }
}

/**
 * A worker rejection is still a terminal response for the in-flight request.
 * Releasing it through the same coalescing gate prevents one unavailable frame
 * from permanently blocking all newer display-clock requests.
 */
export function failPreviewRender(
  gate: PreviewRenderGate,
  requestId: number
): ReturnType<typeof completePreviewRender> {
  return completePreviewRender(gate, requestId)
}

/**
 * Reader windows may begin before the requested frame because decoding must
 * start at a keyframe. Such overlap is valid as long as the returned range
 * actually contains the requested playback boundary.
 */
export function createTimelinePrefetchWindow(input: {
  requestedGlobalFrame: number
  returnedStartGlobalFrame: number
  returnedFrameCount: number
}): {
  decodeStartGlobalFrame: number
  targetGlobalFrame: number
  retainOffset: number
  windowSize: number
} | null {
  const requested = Math.max(0, Math.floor(input.requestedGlobalFrame))
  const start = Math.max(0, Math.floor(input.returnedStartGlobalFrame))
  const count = Math.max(0, Math.floor(input.returnedFrameCount))
  if (count === 0 || requested < start || requested >= start + count) return null
  const retainOffset = requested - start
  return {
    decodeStartGlobalFrame: start,
    targetGlobalFrame: requested,
    retainOffset,
    windowSize: count - retainOffset
  }
}

export function resolvePrefetchDecodedFrame(input: {
  decodeStartGlobalFrame: number
  retainStartGlobalFrame: number
  decodedOutputIndex: number
}): { action: 'discard-preroll' } | { action: 'retain'; retainedFrameIndex: number } {
  const decodeStart = Math.max(0, Math.floor(input.decodeStartGlobalFrame))
  const retainStart = Math.max(decodeStart, Math.floor(input.retainStartGlobalFrame))
  const outputIndex = Math.max(0, Math.floor(input.decodedOutputIndex))
  const globalFrameIndex = decodeStart + outputIndex
  if (globalFrameIndex < retainStart) return { action: 'discard-preroll' }
  return { action: 'retain', retainedFrameIndex: globalFrameIndex - retainStart }
}

export function resetPreviewRenderGate(
  gate: PreviewRenderGate,
  windowGeneration: number
): PreviewRenderGate {
  return {
    windowGeneration,
    nextRequestId: gate.nextRequestId + 1,
    inFlight: null,
    queued: null
  }
}

export function decidePreviewTarget(input: {
  targetGlobalFrame: number
  windowStartIndex: number
  windowFrameCount: number
  pendingWindowTarget: number | null
}): PreviewTargetDecision {
  const targetGlobalFrame = Math.max(0, Math.floor(input.targetGlobalFrame))
  const windowStartIndex = Math.max(0, Math.floor(input.windowStartIndex))
  const windowFrameCount = Math.max(0, Math.floor(input.windowFrameCount))
  const localFrameIndex = targetGlobalFrame - windowStartIndex

  if (localFrameIndex >= 0 && localFrameIndex < windowFrameCount) {
    return { action: 'render', localFrameIndex }
  }

  if (input.pendingWindowTarget !== null) {
    return { action: 'wait-window', targetGlobalFrame }
  }

  return { action: 'request-window', targetGlobalFrame }
}

export function resolvePreviewPresentationTimeMs(input: {
  presentationTimeMs?: number
  windowStartFrameIndex: number
  frameIndex: number
  nominalFps: number
}): number {
  if (Number.isFinite(input.presentationTimeMs)) {
    return Math.max(0, input.presentationTimeMs!)
  }

  const nominalFps = input.nominalFps > 0 && Number.isFinite(input.nominalFps)
    ? input.nominalFps
    : 30
  return Math.max(0, input.windowStartFrameIndex + input.frameIndex) / nominalFps * 1000
}

export function shouldPresentPreviewFrame(input: {
  requestedPresentationTimeMs: number
  currentPresentationTimeMs: number
  maxLatenessMs: number
}): boolean {
  const requested = nonNegativeFinite(input.requestedPresentationTimeMs)
  const current = nonNegativeFinite(input.currentPresentationTimeMs)
  const maxLateness = nonNegativeFinite(input.maxLatenessMs)
  return current - requested <= maxLateness
}

function toRequest(requestId: number, desired: PreviewRenderDesired): PreviewRenderRequest {
  return { ...desired, requestId }
}

function clampPosition(positionMs: number, durationMs: number): number {
  return Math.max(0, Math.min(nonNegativeFinite(positionMs), durationMs))
}

function nonNegativeFinite(value: number): number {
  return Math.max(0, finiteOrZero(value))
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}
