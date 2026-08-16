import { describe, expect, it } from 'vitest'
import {
  resolvePaddedTimelinePositionCss,
  resolvePaddedTimelinePositionPx
} from './timeline-coordinate'

describe('timeline coordinate contract', () => {
  it('maps playhead endpoints to the same padded content box as trim handles', () => {
    expect(resolvePaddedTimelinePositionPx(1200, 16, 0)).toBe(16)
    expect(resolvePaddedTimelinePositionPx(1200, 16, 50)).toBe(600)
    expect(resolvePaddedTimelinePositionPx(1200, 16, 100)).toBe(1184)
  })

  it('keeps a short trim end aligned near the start instead of drifting into its middle', () => {
    const trimEndPercent = (3000 / 146_440) * 100
    const trimEndX = 16 + (1200 - 32) * (trimEndPercent / 100)

    expect(resolvePaddedTimelinePositionPx(1200, 16, trimEndPercent)).toBeCloseTo(trimEndX, 8)
  })

  it('emits CSS positions that compensate for the container inset', () => {
    expect(resolvePaddedTimelinePositionCss(0, 1)).toBe('calc(0% + 1rem)')
    expect(resolvePaddedTimelinePositionCss(50, 1)).toBe('50%')
    expect(resolvePaddedTimelinePositionCss(100, 1)).toBe('calc(100% - 1rem)')
  })
})
