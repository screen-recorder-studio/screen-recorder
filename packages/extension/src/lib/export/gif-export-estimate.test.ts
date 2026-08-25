import { describe, expect, it } from 'vitest'
import { estimateGifPresentationFrameCount, estimateGifSizeRange } from './gif-export-estimate'

describe('GIF export size estimate', () => {
  it('contains the real 64.6s production export instead of under-reporting it as 7.9 MB', () => {
    const estimate = estimateGifSizeRange({
      width: 1440,
      height: 810,
      frameCount: 647,
      quality: 10
    })

    expect(estimate.minBytes).toBeLessThanOrEqual(107_141_128)
    expect(estimate.maxBytes).toBeGreaterThanOrEqual(107_141_128)
  })

  it('contains the real 7.74s high-motion production export', () => {
    const estimate = estimateGifSizeRange({
      width: 1440,
      height: 810,
      frameCount: 78,
      quality: 10
    })

    expect(estimate.minBytes).toBeLessThanOrEqual(40_497_763)
    expect(estimate.maxBytes).toBeGreaterThanOrEqual(40_497_763)
  })

  it('returns a safe empty range for invalid or empty work', () => {
    expect(estimateGifSizeRange({ width: 0, height: 810, frameCount: 10, quality: 10 }))
      .toEqual({ minBytes: 0, maxBytes: 0 })
    expect(estimateGifSizeRange({ width: 1440, height: 810, frameCount: 0, quality: 10 }))
      .toEqual({ minBytes: 0, maxBytes: 0 })
  })

  it('caps a static VFR estimate at the actual source frame count', () => {
    expect(estimateGifPresentationFrameCount({
      durationSeconds: 43.23,
      targetFps: 10,
      sourceFrameCount: 2,
      hasTimeVaryingEffects: false
    })).toBe(2)
  })

  it('keeps presentation samples when an edit changes during a held source frame', () => {
    expect(estimateGifPresentationFrameCount({
      durationSeconds: 43.23,
      targetFps: 10,
      sourceFrameCount: 2,
      hasTimeVaryingEffects: true
    })).toBe(433)
  })
})
