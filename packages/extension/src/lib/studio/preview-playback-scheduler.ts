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

export interface PendingPreviewPlaybackStart {
  windowGeneration: number
  targetGlobalFrame: number
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

/**
 * Playback may reset from the slice end to a start frame in another decode
 * window. The media clock must remain paused until that exact rendered result
 * is visible; otherwise a slow 4K window load can consume the whole slice while
 * the canvas still shows the old end frame.
 */
export function shouldCommitPreviewPlaybackStart(input: {
  pending: PendingPreviewPlaybackStart | null
  presentedWindowGeneration: number
  presentedWindowStartFrame: number
  presentedLocalFrame: number
  presentedPositionMs: number
}): boolean {
  if (!input.pending) return false
  const presentedGlobalFrame = Math.max(
    0,
    Math.floor(input.presentedWindowStartFrame) + Math.floor(input.presentedLocalFrame)
  )
  return input.presentedWindowGeneration === input.pending.windowGeneration
    && presentedGlobalFrame === input.pending.targetGlobalFrame
    && Math.abs(input.presentedPositionMs - input.pending.positionMs) < 0.5
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

export interface PreviewPressureRecoveryInput {
  playbackDurationMs: number
  displayedFrameCount: number
  displayedSpanMs: number
  p95DriftMs: number
  maxDriftMs: number
  maxDisplayGapMs: number
  coalescedRequestCount: number
  injectedBlockMs: number
  recoveryBudgetMs: number
}

export interface PreviewPressureRecoveryResult {
  passed: boolean
  maxAllowedInterruptionMs: number
  minimumDisplayedSpanMs: number
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

/**
 * A synthetic worker block necessarily creates one long presentation gap. The
 * preview passes when it catches up within one extra frame budget, keeps the
 * normal p95 drift bounded, and continues presenting through the end of the
 * playback range. Comparing the single worst sample against an unblocked frame
 * budget would reject every real recovery, while omitting coverage would let a
 * permanently frozen preview pass on its last observed samples.
 */
export function evaluatePreviewPressureRecovery(
  input: PreviewPressureRecoveryInput
): PreviewPressureRecoveryResult {
  const playbackDurationMs = nonNegativeFinite(input.playbackDurationMs)
  const injectedBlockMs = nonNegativeFinite(input.injectedBlockMs)
  const recoveryBudgetMs = nonNegativeFinite(input.recoveryBudgetMs)
  const maxAllowedInterruptionMs = injectedBlockMs + recoveryBudgetMs
  const minimumDisplayedSpanMs = Math.max(
    0,
    playbackDurationMs - (maxAllowedInterruptionMs * 2)
  )
  const hasValidTelemetry = [
    input.playbackDurationMs,
    input.displayedFrameCount,
    input.displayedSpanMs,
    input.p95DriftMs,
    input.maxDriftMs,
    input.maxDisplayGapMs,
    input.coalescedRequestCount,
    input.injectedBlockMs,
    input.recoveryBudgetMs
  ].every(value => Number.isFinite(value) && value >= 0)
  const hasObservedRecovery = input.playbackDurationMs > 0
    && input.displayedFrameCount >= 2
    && input.coalescedRequestCount > 0

  return {
    passed: hasValidTelemetry
      && hasObservedRecovery
      && nonNegativeFinite(input.displayedSpanMs) >= minimumDisplayedSpanMs
      && nonNegativeFinite(input.p95DriftMs) <= recoveryBudgetMs
      && nonNegativeFinite(input.maxDriftMs) <= maxAllowedInterruptionMs
      && nonNegativeFinite(input.maxDisplayGapMs) <= maxAllowedInterruptionMs,
    maxAllowedInterruptionMs,
    minimumDisplayedSpanMs
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
  /**
   * The completed bitmap is still the newest available rendered result and may
   * be presented even when a coalesced follow-up request is dispatched.
   */
  presentCurrent: boolean
} {
  if (!gate.inFlight || gate.inFlight.requestId !== requestId) {
    return { gate, dispatch: null, accepted: false, presentCurrent: false }
  }

  if (!gate.queued) {
    return {
      gate: { ...gate, inFlight: null },
      dispatch: null,
      accepted: true,
      presentCurrent: true
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
    accepted: true,
    presentCurrent: true
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
  const completed = completePreviewRender(gate, requestId)
  return { ...completed, presentCurrent: false }
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
  hasQueuedFollowUp?: boolean
}): boolean {
  // A coalesced follow-up is already chasing the display clock. Presenting the
  // completed bitmap keeps motion visible on slower renderers without adding
  // backlog; dropping every >1-frame result would otherwise starve the canvas.
  if (input.hasQueuedFollowUp) return true
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
