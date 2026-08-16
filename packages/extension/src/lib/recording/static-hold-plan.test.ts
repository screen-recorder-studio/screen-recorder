import { describe, expect, it } from 'vitest'
import {
  advanceStaticHold,
  clampStaticHoldPosition,
  createStaticHoldPlan
} from './static-hold-plan'

describe('static recording hold plan', () => {
  it('represents a long single-frame recording as one held sample', () => {
    expect(createStaticHoldPlan({ sourceFrameCount: 1, durationMs: 25_223 })).toEqual({
      durationMs: 25_223,
      sampleDurationSeconds: 25.223
    })
  })

  it('does not rewrite ordinary multi-frame recordings', () => {
    expect(createStaticHoldPlan({ sourceFrameCount: 300, durationMs: 9_967 })).toBeNull()
  })

  it('rejects incomplete or malformed timing data', () => {
    expect(createStaticHoldPlan({ sourceFrameCount: 1, durationMs: 0 })).toBeNull()
    expect(createStaticHoldPlan({ sourceFrameCount: 0, durationMs: 8_000 })).toBeNull()
    expect(createStaticHoldPlan({ sourceFrameCount: 1, durationMs: Number.NaN })).toBeNull()
  })

  it('clamps timeline seeking to the held sample duration', () => {
    expect(clampStaticHoldPosition(-10, 25_223)).toBe(0)
    expect(clampStaticHoldPosition(7_500, 25_223)).toBe(7_500)
    expect(clampStaticHoldPosition(30_000, 25_223)).toBe(25_223)
  })

  it('advances playback using wall-clock time and reports completion', () => {
    expect(advanceStaticHold({ positionMs: 4_000, elapsedMs: 250, durationMs: 25_223 })).toEqual({
      positionMs: 4_250,
      ended: false
    })
    expect(advanceStaticHold({ positionMs: 25_000, elapsedMs: 500, durationMs: 25_223 })).toEqual({
      positionMs: 25_223,
      ended: true
    })
  })
})
