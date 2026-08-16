import { describe, expect, it } from 'vitest'
import { createRecordingFrameCadence, sampleRecordingFrame } from './recording-frame-cadence'

describe('recording frame cadence', () => {
  it('samples a 60fps capture onto a 30fps active-time cadence', () => {
    let cadence = createRecordingFrameCadence(30)
    const accepted: number[] = []
    for (let index = 0; index < 60; index++) {
      const timestampUs = Math.round(index * 1_000_000 / 60)
      const decision = sampleRecordingFrame(cadence, timestampUs)
      cadence = decision.cadence
      if (decision.accept) accepted.push(timestampUs)
    }

    expect(accepted).toHaveLength(30)
    expect(accepted[0]).toBe(0)
    expect(accepted.at(-1)).toBe(966_667)
  })

  it('does not synthesize frames across a sparse capture gap', () => {
    let cadence = createRecordingFrameCadence(30)
    const first = sampleRecordingFrame(cadence, 0)
    cadence = first.cadence
    const afterGap = sampleRecordingFrame(cadence, 5_000_000)

    expect(first.accept).toBe(true)
    expect(afterGap.accept).toBe(true)
    expect(afterGap.cadence.nextDueTimestampUs).toBeCloseTo(5_033_333.333, 2)
  })

  it('uses a small jitter tolerance without allowing an early burst', () => {
    let cadence = createRecordingFrameCadence(30)
    cadence = sampleRecordingFrame(cadence, 0).cadence

    const jittered = sampleRecordingFrame(cadence, 32_800)
    expect(jittered.accept).toBe(true)
    const tooEarly = sampleRecordingFrame(jittered.cadence, 49_000)
    expect(tooEarly.accept).toBe(false)
  })

  it('does not accumulate an early-source drift into more than the target cadence', () => {
    let cadence = createRecordingFrameCadence(30)
    let accepted = 0
    for (let timestampUs = 0; timestampUs < 1_000_000; timestampUs += 16_000) {
      const decision = sampleRecordingFrame(cadence, timestampUs)
      cadence = decision.cadence
      if (decision.accept) accepted++
    }
    expect(accepted).toBeLessThanOrEqual(31)
  })

  it('normalizes invalid frame rates to 30fps', () => {
    expect(createRecordingFrameCadence(0).frameRate).toBe(30)
    expect(createRecordingFrameCadence(Number.NaN).frameRate).toBe(30)
  })
})
