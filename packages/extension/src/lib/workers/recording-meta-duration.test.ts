import { describe, expect, it } from 'vitest'
import { resolveRecordingDurationMs } from './recording-meta-duration'

describe('recording metadata duration', () => {
  it('prefers the pause-aware active clock so a multi-frame static tail is preserved', () => {
    expect(resolveRecordingDurationMs({ wallClockDurationMs: 9_000 }, 1_000_000, 3_500_000)).toBe(9_000)
  })

  it('falls back to wall-clock duration for a static one-frame recording', () => {
    expect(resolveRecordingDurationMs({ wallClockDurationMs: 11_250 }, 5_000_000, 5_000_000)).toBe(11_250)
  })

  it('normalizes malformed metadata', () => {
    expect(resolveRecordingDurationMs({ wallClockDurationMs: -1 }, -1, -1)).toBe(0)
  })

  it('falls back to the encoded span for legacy recordings without an active clock', () => {
    expect(resolveRecordingDurationMs({}, 1_000_000, 3_500_000)).toBe(2_500)
  })
})
