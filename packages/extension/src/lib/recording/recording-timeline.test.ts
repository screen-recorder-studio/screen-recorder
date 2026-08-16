import { describe, expect, it } from 'vitest'
import {
  buildPresentationSchedule,
  countSourceFramesInRange,
  createRecordingTimeline,
  findSourceFrameAtTime,
  resolveDisplayedTimelinePosition,
  RecordingTimelineError
} from './recording-timeline'

describe('recording timeline', () => {
  it('holds a single captured frame for the full active session', () => {
    expect(createRecordingTimeline({
      sourceTimestampsUs: [5_000_000],
      canonicalDurationMs: 25_223,
      nominalFps: 30
    })).toEqual({
      durationMs: 25_223,
      nominalFps: 30,
      sourceTimestampsMs: [0],
      sourceDurationsMs: [25_223]
    })
  })

  it('preserves sparse samples and the static tail', () => {
    expect(createRecordingTimeline({
      sourceTimestampsUs: [1_000_000, 6_000_000, 21_000_000],
      canonicalDurationMs: 25_000,
      nominalFps: 30
    })).toEqual({
      durationMs: 25_000,
      nominalFps: 30,
      sourceTimestampsMs: [0, 5_000, 20_000],
      sourceDurationsMs: [5_000, 15_000, 5_000]
    })
  })

  it('never truncates an encoded sample when metadata is too short', () => {
    const timeline = createRecordingTimeline({
      sourceTimestampsUs: [0, 20_000_000],
      canonicalDurationMs: 19_000,
      nominalFps: 30
    })

    expect(timeline.durationMs).toBeCloseTo(20_033.333, 3)
    expect(timeline.sourceDurationsMs[1]).toBeCloseTo(33.333, 3)
  })

  it('normalizes a non-zero first timestamp without changing gaps', () => {
    const timeline = createRecordingTimeline({
      sourceTimestampsUs: [8_500_000, 9_000_000, 10_250_000],
      canonicalDurationMs: 2_000,
      nominalFps: 60
    })

    expect(timeline.sourceTimestampsMs).toEqual([0, 500, 1_750])
    expect(timeline.sourceDurationsMs).toEqual([500, 1_250, 250])
  })

  it('builds a CFR last-frame-hold schedule with an exact partial ending', () => {
    const schedule = buildPresentationSchedule({
      sourceTimestampsMs: [0, 1_000, 2_000],
      durationMs: 2_250,
      targetFps: 2
    })

    expect(schedule).toEqual([
      { sourceFrameIndex: 0, timestampSeconds: 0, durationSeconds: 0.5 },
      { sourceFrameIndex: 0, timestampSeconds: 0.5, durationSeconds: 0.5 },
      { sourceFrameIndex: 1, timestampSeconds: 1, durationSeconds: 0.5 },
      { sourceFrameIndex: 1, timestampSeconds: 1.5, durationSeconds: 0.5 },
      { sourceFrameIndex: 2, timestampSeconds: 2, durationSeconds: 0.25 }
    ])
  })

  it('builds a trimmed CFR schedule on the original VFR timeline', () => {
    const schedule = buildPresentationSchedule({
      sourceTimestampsMs: [0, 5_000, 20_000],
      durationMs: 25_000,
      targetFps: 2,
      startMs: 4_750,
      endMs: 7_250
    })

    expect(schedule).toHaveLength(5)
    expect(schedule.map((entry) => entry.sourceFrameIndex)).toEqual([0, 1, 1, 1, 1])
    expect(schedule[0]).toEqual({
      sourceFrameIndex: 0,
      timestampSeconds: 0,
      durationSeconds: 0.5
    })
    expect(schedule.at(-1)).toEqual({
      sourceFrameIndex: 1,
      timestampSeconds: 2,
      durationSeconds: 0.5
    })
  })

  it('counts source frames used by the half-open trim range', () => {
    const timestamps = [0, 5_000, 20_000, 24_000]

    expect(countSourceFramesInRange(timestamps, 0, 25_000)).toBe(4)
    expect(countSourceFramesInRange(timestamps, 5_000, 20_000)).toBe(1)
    expect(countSourceFramesInRange(timestamps, 4_750, 7_250)).toBe(2)
  })

  it('always starts at timestamp zero and covers a non-integral frame count', () => {
    const schedule = buildPresentationSchedule({
      sourceTimestampsMs: [0],
      durationMs: 25_223,
      targetFps: 30
    })

    expect(schedule).toHaveLength(757)
    expect(schedule[0]).toEqual({
      sourceFrameIndex: 0,
      timestampSeconds: 0,
      durationSeconds: 1 / 30
    })
    const last = schedule.at(-1)!
    expect(last.sourceFrameIndex).toBe(0)
    expect(last.timestampSeconds).toBeCloseTo(25.2, 10)
    expect(last.durationSeconds).toBeCloseTo(0.023, 10)
  })

  it('uses the last source frame when multiple decoded frames share one PTS', () => {
    const timeline = createRecordingTimeline({
      sourceTimestampsUs: [0, 0, 500_000],
      canonicalDurationMs: 1_000,
      nominalFps: 2
    })
    const schedule = buildPresentationSchedule({
      sourceTimestampsMs: timeline.sourceTimestampsMs,
      durationMs: timeline.durationMs,
      targetFps: 2
    })

    expect(timeline.sourceDurationsMs).toEqual([0, 500, 500])
    expect(schedule.map((entry) => entry.sourceFrameIndex)).toEqual([1, 2])
  })

  it('finds the held source frame at exact boundaries and inside sparse gaps', () => {
    const timestamps = [0, 5_000, 20_000]
    expect(findSourceFrameAtTime(timestamps, 4_999)).toBe(0)
    expect(findSourceFrameAtTime(timestamps, 5_000)).toBe(1)
    expect(findSourceFrameAtTime(timestamps, 19_999)).toBe(1)
    expect(findSourceFrameAtTime(timestamps, 25_000)).toBe(2)
    expect(findSourceFrameAtTime([0, 0, 500], 0)).toBe(1)
  })

  it('keeps the requested playhead time while displaying a held sparse frame', () => {
    const timestamps = [0, 5_000, 20_000]

    expect(resolveDisplayedTimelinePosition({
      sourceTimestampsMs: timestamps,
      requestedTimeMs: 12_000,
      renderedFrameIndex: 1
    })).toBe(12_000)
    expect(resolveDisplayedTimelinePosition({
      sourceTimestampsMs: timestamps,
      requestedTimeMs: 12_000,
      renderedFrameIndex: 2
    })).toBe(20_000)
  })

  it('rejects decreasing or invalid source timestamps', () => {
    const create = (sourceTimestampsUs: number[]) => () => createRecordingTimeline({
      sourceTimestampsUs,
      canonicalDurationMs: 1_000,
      nominalFps: 30
    })

    expect(create([1_000, 999])).toThrow(RecordingTimelineError)
    expect(create([0, Number.NaN])).toThrow(RecordingTimelineError)
  })
})
