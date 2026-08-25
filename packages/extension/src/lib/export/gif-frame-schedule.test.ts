import { describe, expect, it } from 'vitest'
import { createGifFrameSchedule } from './gif-frame-schedule'

describe('GIF frame schedule', () => {
  it('collapses repeated source frames and quantizes delays to GIF centiseconds', () => {
    const result = createGifFrameSchedule([
      { sourceFrameIndex: 0, timestampSeconds: 0, durationSeconds: 1 / 30 },
      { sourceFrameIndex: 0, timestampSeconds: 1 / 30, durationSeconds: 1 / 30 },
      { sourceFrameIndex: 1, timestampSeconds: 2 / 30, durationSeconds: 1 / 30 },
      { sourceFrameIndex: 1, timestampSeconds: 3 / 30, durationSeconds: 1 / 30 },
      { sourceFrameIndex: 2, timestampSeconds: 4 / 30, durationSeconds: 1 / 30 }
    ])

    expect(result.frames.map((frame) => [frame.sourceFrameIndex, frame.delayMs])).toEqual([
      [0, 70],
      [1, 60],
      [2, 40]
    ])
    expect(result.totalDelayMs).toBe(170)
    expect(result.inputDurationMs).toBeCloseTo(166.67, 1)
  })

  it('carries fractional centiseconds so long exports do not accumulate drift', () => {
    const schedule = Array.from({ length: 300 }, (_, sourceFrameIndex) => ({
      sourceFrameIndex,
      timestampSeconds: sourceFrameIndex / 30,
      durationSeconds: 1 / 30
    }))
    const result = createGifFrameSchedule(schedule)

    expect(result.totalDelayMs).toBe(10_000)
    expect(new Set(result.frames.map((frame) => frame.delayMs))).toEqual(new Set([30, 40]))
  })

  it('preserves repeated samples when a time-varying edit must be rendered', () => {
    const result = createGifFrameSchedule([
      { sourceFrameIndex: 4, timestampSeconds: 0, durationSeconds: 0.05 },
      { sourceFrameIndex: 4, timestampSeconds: 0.05, durationSeconds: 0.05 }
    ], { collapseRepeated: false })

    expect(result.frames).toHaveLength(2)
    expect(result.frames.map((frame) => frame.timestampSeconds)).toEqual([0, 0.05])
  })

  it('rejects empty and non-positive schedules', () => {
    expect(() => createGifFrameSchedule([])).toThrowError('GIF_SCHEDULE_EMPTY')
    expect(() => createGifFrameSchedule([
      { sourceFrameIndex: 0, timestampSeconds: 0, durationSeconds: 0 }
    ])).toThrowError('GIF_SCHEDULE_INVALID')
  })
})
