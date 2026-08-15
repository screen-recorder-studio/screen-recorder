import { describe, expect, it } from 'vitest'
import {
  completePreviewRender,
  createTimelinePrefetchWindow,
  createPreviewClock,
  createPreviewRenderGate,
  decidePreviewTarget,
  pausePreviewClock,
  playPreviewClock,
  queuePreviewRender,
  failPreviewRender,
  evaluatePreviewPressureRecovery,
  resetPreviewRenderGate,
  resolvePreviewPlaybackRange,
  resolvePrefetchDecodedFrame,
  resolvePreviewPresentationTimeMs,
  samplePreviewClock,
  seekPreviewClock,
  shouldCommitPreviewPlaybackStart,
  shouldPresentPreviewFrame
} from './preview-playback-scheduler'

describe('preview playback clock', () => {
  it('uses trim boundaries as a time-domain playback range', () => {
    expect(resolvePreviewPlaybackRange({
      durationMs: 89_590,
      positionMs: 21_880,
      trim: { enabled: true, startMs: 8_300, endMs: 21_880 }
    })).toEqual({ startMs: 8_300, endMs: 21_880, positionMs: 8_300 })

    expect(resolvePreviewPlaybackRange({
      durationMs: 89_590,
      positionMs: 12_000,
      trim: { enabled: true, startMs: 8_300, endMs: 21_880 }
    })).toEqual({ startMs: 8_300, endMs: 21_880, positionMs: 12_000 })
  })

  it('advances from a monotonic anchor without accumulating frame callback drift', () => {
    const paused = createPreviewClock({ durationMs: 5_000, positionMs: 1_000 })
    const playing = playPreviewClock(paused, 10_000)

    expect(samplePreviewClock(playing, 10_250)).toEqual({ positionMs: 1_250, ended: false })
    expect(samplePreviewClock(playing, 10_900)).toEqual({ positionMs: 1_900, ended: false })
  })

  it('reanchors on pause, seek, and resume', () => {
    const playing = playPreviewClock(
      createPreviewClock({ durationMs: 5_000, positionMs: 500 }),
      1_000
    )
    const paused = pausePreviewClock(playing, 1_750)
    const sought = seekPreviewClock(paused, 4_500, 2_000)
    const resumed = playPreviewClock(sought, 3_000)

    expect(samplePreviewClock(paused, 2_500)).toEqual({ positionMs: 1_250, ended: false })
    expect(samplePreviewClock(resumed, 3_250)).toEqual({ positionMs: 4_750, ended: false })
    expect(samplePreviewClock(resumed, 3_600)).toEqual({ positionMs: 5_000, ended: true })
  })

  it('does not start a trim playback clock until the exact slice-start frame is presented', () => {
    const pending = {
      windowGeneration: 12,
      targetGlobalFrame: 249,
      positionMs: 8_300
    }

    expect(shouldCommitPreviewPlaybackStart({
      pending,
      presentedWindowGeneration: 11,
      presentedWindowStartFrame: 657,
      presentedLocalFrame: 0,
      presentedPositionMs: 21_880
    })).toBe(false)
    expect(shouldCommitPreviewPlaybackStart({
      pending,
      presentedWindowGeneration: 12,
      presentedWindowStartFrame: 249,
      presentedLocalFrame: 0,
      presentedPositionMs: 8_300
    })).toBe(true)
  })
})

describe('preview render backpressure', () => {
  it('keeps rendering presentation time while the same sparse source frame is held', () => {
    const initial = createPreviewRenderGate(7)
    const first = queuePreviewRender(initial, {
      windowGeneration: 7,
      sourceFrameIndex: 3,
      presentationTimeMs: 2_000
    })
    const held = queuePreviewRender(first.gate, {
      windowGeneration: 7,
      sourceFrameIndex: 3,
      presentationTimeMs: 2_016.7
    })

    expect(first.dispatch?.sourceFrameIndex).toBe(3)
    expect(held.dispatch).toBeNull()

    const completed = completePreviewRender(held.gate, first.dispatch!.requestId)
    expect(completed.dispatch).toMatchObject({
      sourceFrameIndex: 3,
      presentationTimeMs: 2_016.7
    })
  })

  it('coalesces overload to the newest desired presentation instead of building a queue', () => {
    const first = queuePreviewRender(createPreviewRenderGate(2), {
      windowGeneration: 2,
      sourceFrameIndex: 10,
      presentationTimeMs: 1_000
    })
    const second = queuePreviewRender(first.gate, {
      windowGeneration: 2,
      sourceFrameIndex: 11,
      presentationTimeMs: 1_033
    })
    const latest = queuePreviewRender(second.gate, {
      windowGeneration: 2,
      sourceFrameIndex: 12,
      presentationTimeMs: 1_066
    })

    const completed = completePreviewRender(latest.gate, first.dispatch!.requestId)
    expect(completed.presentCurrent).toBe(true)
    expect(completed.dispatch).toMatchObject({
      sourceFrameIndex: 12,
      presentationTimeMs: 1_066
    })
  })

  it('ignores stale completions and invalidates work when the window generation changes', () => {
    const first = queuePreviewRender(createPreviewRenderGate(3), {
      windowGeneration: 3,
      sourceFrameIndex: 1,
      presentationTimeMs: 100
    })

    expect(completePreviewRender(first.gate, 999)).toEqual({
      gate: first.gate,
      dispatch: null,
      accepted: false,
      presentCurrent: false
    })

    const reset = resetPreviewRenderGate(first.gate, 4)
    expect(reset).toMatchObject({ windowGeneration: 4, inFlight: null, queued: null })
  })

  it('releases a render gate when the worker reports that a frame is unavailable', () => {
    const first = queuePreviewRender(createPreviewRenderGate(5), {
      windowGeneration: 5,
      sourceFrameIndex: 8,
      presentationTimeMs: 800
    })
    const latest = queuePreviewRender(first.gate, {
      windowGeneration: 5,
      sourceFrameIndex: 9,
      presentationTimeMs: 900
    })

    const failed = failPreviewRender(latest.gate, first.dispatch!.requestId)
    expect(failed.accepted).toBe(true)
    expect(failed.presentCurrent).toBe(false)
    expect(failed.dispatch).toMatchObject({
      sourceFrameIndex: 9,
      presentationTimeMs: 900
    })
  })

  it('accepts one unavoidable pressure gap when playback promptly recovers and stays live', () => {
    expect(evaluatePreviewPressureRecovery({
      playbackDurationMs: 8_000,
      displayedFrameCount: 472,
      displayedSpanMs: 7_970,
      p95DriftMs: 3.6,
      maxDriftMs: 73.5,
      maxDisplayGapMs: 86.9,
      coalescedRequestCount: 12,
      injectedBlockMs: 70,
      recoveryBudgetMs: 34
    }).passed).toBe(true)
  })

  it('rejects a player that stops presenting before the playback range ends', () => {
    expect(evaluatePreviewPressureRecovery({
      playbackDurationMs: 8_000,
      displayedFrameCount: 120,
      displayedSpanMs: 1_950,
      p95DriftMs: 3,
      maxDriftMs: 20,
      maxDisplayGapMs: 20,
      coalescedRequestCount: 8,
      injectedBlockMs: 70,
      recoveryBudgetMs: 34
    }).passed).toBe(false)
  })

  it('rejects stale-frame catch-up that exceeds the injected block plus one recovery budget', () => {
    expect(evaluatePreviewPressureRecovery({
      playbackDurationMs: 8_000,
      displayedFrameCount: 430,
      displayedSpanMs: 7_980,
      p95DriftMs: 10,
      maxDriftMs: 180,
      maxDisplayGapMs: 190,
      coalescedRequestCount: 20,
      injectedBlockMs: 70,
      recoveryBudgetMs: 34
    }).passed).toBe(false)
  })

  it('rejects incomplete pressure telemetry instead of treating invalid metrics as zero', () => {
    expect(evaluatePreviewPressureRecovery({
      playbackDurationMs: 8_000,
      displayedFrameCount: 472,
      displayedSpanMs: 7_970,
      p95DriftMs: Number.NaN,
      maxDriftMs: 73.5,
      maxDisplayGapMs: 86.9,
      coalescedRequestCount: 12,
      injectedBlockMs: 70,
      recoveryBudgetMs: 34
    }).passed).toBe(false)
  })
})

describe('timeline prefetch window', () => {
  it('accepts a keyframe-aligned overlapping range when it still covers the requested boundary', () => {
    expect(createTimelinePrefetchWindow({
      requestedGlobalFrame: 90,
      returnedStartGlobalFrame: 60,
      returnedFrameCount: 140
    })).toEqual({
      decodeStartGlobalFrame: 60,
      targetGlobalFrame: 90,
      retainOffset: 30,
      windowSize: 110
    })
  })

  it('rejects a reader range that does not contain the requested boundary', () => {
    expect(createTimelinePrefetchWindow({
      requestedGlobalFrame: 200,
      returnedStartGlobalFrame: 0,
      returnedFrameCount: 140
    })).toBeNull()
  })

  it('discards keyframe preroll outputs and re-bases retained frames at the playback boundary', () => {
    expect(resolvePrefetchDecodedFrame({
      decodeStartGlobalFrame: 60,
      retainStartGlobalFrame: 90,
      decodedOutputIndex: 29
    })).toEqual({ action: 'discard-preroll' })

    expect(resolvePrefetchDecodedFrame({
      decodeStartGlobalFrame: 60,
      retainStartGlobalFrame: 90,
      decodedOutputIndex: 30
    })).toEqual({ action: 'retain', retainedFrameIndex: 0 })
  })
})

describe('preview target routing', () => {
  it('maps exact current-window boundaries to local frames', () => {
    expect(decidePreviewTarget({
      targetGlobalFrame: 100,
      windowStartIndex: 100,
      windowFrameCount: 30,
      pendingWindowTarget: null
    })).toEqual({ action: 'render', localFrameIndex: 0 })

    expect(decidePreviewTarget({
      targetGlobalFrame: 129,
      windowStartIndex: 100,
      windowFrameCount: 30,
      pendingWindowTarget: null
    })).toEqual({ action: 'render', localFrameIndex: 29 })
  })

  it('requests a missing window once while playback ticks keep advancing', () => {
    expect(decidePreviewTarget({
      targetGlobalFrame: 130,
      windowStartIndex: 100,
      windowFrameCount: 30,
      pendingWindowTarget: null
    })).toEqual({ action: 'request-window', targetGlobalFrame: 130 })

    expect(decidePreviewTarget({
      targetGlobalFrame: 131,
      windowStartIndex: 100,
      windowFrameCount: 30,
      pendingWindowTarget: 130
    })).toEqual({ action: 'wait-window', targetGlobalFrame: 131 })
  })
})

describe('preview effect presentation time', () => {
  it('uses explicit display time even when the held source frame index does not change', () => {
    expect(resolvePreviewPresentationTimeMs({
      presentationTimeMs: 3_500,
      windowStartFrameIndex: 60,
      frameIndex: 0,
      nominalFps: 30
    })).toBe(3_500)
  })

  it('keeps the legacy frame-index fallback for non-timeline callers', () => {
    expect(resolvePreviewPresentationTimeMs({
      windowStartFrameIndex: 60,
      frameIndex: 15,
      nominalFps: 30
    })).toBe(2_500)
  })

  it('drops a completed bitmap that is already too far behind the display clock', () => {
    expect(shouldPresentPreviewFrame({
      requestedPresentationTimeMs: 1_000,
      currentPresentationTimeMs: 1_050,
      maxLatenessMs: 34
    })).toBe(false)
    expect(shouldPresentPreviewFrame({
      requestedPresentationTimeMs: 1_000,
      currentPresentationTimeMs: 1_025,
      maxLatenessMs: 34
    })).toBe(true)
  })

  it('presents a late completed bitmap when a coalesced follow-up is already chasing the clock', () => {
    expect(shouldPresentPreviewFrame({
      requestedPresentationTimeMs: 1_000,
      currentPresentationTimeMs: 1_080,
      maxLatenessMs: 34,
      hasQueuedFollowUp: true
    })).toBe(true)
  })
})
