import { describe, expect, it } from 'vitest'
import { resolveRecordingEncodePlan } from './recording-encode-plan'

describe('balanced recording encode plan', () => {
  it('caps landscape and portrait 4K sources without changing orientation', () => {
    expect(resolveRecordingEncodePlan(3840, 2160, 60)).toEqual({
      width: 1920,
      height: 1080,
      framerate: 30
    })
    expect(resolveRecordingEncodePlan(2160, 3840, 30)).toEqual({
      width: 1080,
      height: 1920,
      framerate: 30
    })
  })

  it('fits ultrawide sources proportionally inside the landscape envelope', () => {
    expect(resolveRecordingEncodePlan(5120, 1440, 30)).toEqual({
      width: 1920,
      height: 540,
      framerate: 30
    })
  })

  it('does not upscale sources already inside the balanced envelope', () => {
    expect(resolveRecordingEncodePlan(1920, 1080, 30)).toEqual({
      width: 1920,
      height: 1080,
      framerate: 30
    })
    expect(resolveRecordingEncodePlan(1280, 720, 24)).toEqual({
      width: 1280,
      height: 720,
      framerate: 24
    })
  })

  it('normalizes odd dimensions to encoder-safe even values without material distortion', () => {
    const plan = resolveRecordingEncodePlan(4633, 2407, 29.97)
    expect(plan.width % 2).toBe(0)
    expect(plan.height % 2).toBe(0)
    expect(plan.width).toBeLessThanOrEqual(1920)
    expect(plan.height).toBeLessThanOrEqual(1080)
    expect(Math.abs(plan.width / plan.height - 4633 / 2407)).toBeLessThan(0.003)
    expect(plan.framerate).toBe(30)
  })

  it('falls back to a safe default for invalid capture metadata', () => {
    expect(resolveRecordingEncodePlan(0, Number.NaN, 0)).toEqual({
      width: 1920,
      height: 1080,
      framerate: 30
    })
  })
})
