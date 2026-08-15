import { describe, expect, it } from 'vitest'
import { RecordingDurationTracker } from './recording-duration-tracker'

describe('RecordingDurationTracker', () => {
  it('keeps the stopped duration available for asynchronous finalization', () => {
    const tracker = new RecordingDurationTracker()

    tracker.start(1_000)
    tracker.stop(6_250)

    expect(tracker.duration(9_000)).toBe(5_250)
  })

  it('excludes paused time from the finalized duration', () => {
    const tracker = new RecordingDurationTracker()

    tracker.start(1_000)
    tracker.pause(3_000)
    tracker.resume(8_000)
    tracker.stop(11_000)

    expect(tracker.duration(12_000)).toBe(5_000)
  })

  it('maps captured frames onto the pause-aware active timeline in microseconds', () => {
    const tracker = new RecordingDurationTracker()

    tracker.start(1_000)
    expect(tracker.timestampUs(2_000)).toBe(1_000_000)
    tracker.pause(3_000)
    tracker.resume(8_000)
    expect(tracker.timestampUs(9_000)).toBe(3_000_000)
  })

  it('resets stale duration when a new recording starts', () => {
    const tracker = new RecordingDurationTracker()

    tracker.start(1_000)
    tracker.stop(2_000)
    tracker.start(10_000)

    expect(tracker.duration(10_750)).toBe(750)
  })
})
