import { describe, expect, it } from 'vitest'
import {
  clampTrimEnd,
  clampTrimStart,
  parseTrimSecondsInput,
  resolveTrimKeyboardValue
} from './trim-boundary'

describe('trim boundary controls', () => {
  it('ignores an empty numeric-input intermediate state and converts finite seconds', () => {
    expect(parseTrimSecondsInput(Number.NaN)).toBeNull()
    expect(parseTrimSecondsInput(8)).toBe(8_000)
  })

  it('keeps a 100ms minimum half-open range', () => {
    expect(clampTrimStart(9_999, 10_000, 20_000)).toBe(9_900)
    expect(clampTrimEnd(5_001, 5_000, 20_000)).toBe(5_100)
  })

  it('clamps direct time entry to the source timeline', () => {
    expect(clampTrimStart(-500, 10_000, 20_000)).toBe(0)
    expect(clampTrimEnd(25_000, 5_000, 20_000)).toBe(20_000)
  })

  it('supports exact Home and End keyboard boundaries', () => {
    expect(resolveTrimKeyboardValue({
      boundary: 'start', key: 'Home', currentMs: 5_000, otherMs: 10_000, timelineMaxMs: 20_000, frameRate: 30
    })).toBe(0)
    expect(resolveTrimKeyboardValue({
      boundary: 'end', key: 'End', currentMs: 10_000, otherMs: 5_000, timelineMaxMs: 20_000, frameRate: 30
    })).toBe(20_000)
  })

  it('nudges by frames and seconds without leaving the valid range', () => {
    expect(resolveTrimKeyboardValue({
      boundary: 'start', key: 'ArrowRight', currentMs: 5_000, otherMs: 10_000, timelineMaxMs: 20_000, frameRate: 25
    })).toBe(5_040)
    expect(resolveTrimKeyboardValue({
      boundary: 'end', key: 'PageDown', currentMs: 10_000, otherMs: 5_000, timelineMaxMs: 20_000, frameRate: 25
    })).toBe(9_000)
  })

  it('returns null for unrelated keys', () => {
    expect(resolveTrimKeyboardValue({
      boundary: 'start', key: 'Enter', currentMs: 5_000, otherMs: 10_000, timelineMaxMs: 20_000, frameRate: 30
    })).toBeNull()
  })
})
