import { describe, expect, it } from 'vitest'
import { planReaderWindowByIndex, planReaderWindowByTime } from './reader-window-plan'

const timestamps = Array.from({ length: 600 }, (_, index) => index * 100)

describe('planReaderWindowByTime', () => {
  it('aligns to a keyframe while guaranteeing that the seek target is present', () => {
    expect(planReaderWindowByTime({
      sourceTimestampsMs: timestamps,
      keyframeIndices: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540],
      centerMs: 46_700,
      beforeMs: 1_500,
      afterMs: 1_500,
      maxFrames: 140
    })).toEqual({
      ok: true,
      startIndex: 420,
      endIndexExclusive: 483,
      targetIndex: 467
    })
  })

  it('drops excess history instead of truncating the target out of the window', () => {
    const result = planReaderWindowByTime({
      sourceTimestampsMs: timestamps,
      keyframeIndices: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540],
      centerMs: 46_700,
      beforeMs: 40_000,
      afterMs: 1_500,
      maxFrames: 140
    })

    expect(result).toEqual({
      ok: true,
      startIndex: 420,
      endIndexExclusive: 483,
      targetIndex: 467
    })
  })

  it('fails explicitly when a GOP is too long to decode within the worker capacity', () => {
    expect(planReaderWindowByTime({
      sourceTimestampsMs: timestamps,
      keyframeIndices: [0, 500],
      centerMs: 46_700,
      beforeMs: 1_500,
      afterMs: 1_500,
      maxFrames: 140
    })).toEqual({
      ok: false,
      code: 'GOP_EXCEEDS_WINDOW_CAPACITY',
      targetIndex: 467,
      keyframeIndex: 0,
      requiredFrames: 468,
      maxFrames: 140
    })
  })

  it('keeps a target near the recording tail in a bounded window', () => {
    const result = planReaderWindowByTime({
      sourceTimestampsMs: timestamps,
      keyframeIndices: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540],
      centerMs: 59_900,
      beforeMs: 1_500,
      afterMs: 1_500,
      maxFrames: 140
    })

    expect(result).toEqual({
      ok: true,
      startIndex: 540,
      endIndexExclusive: 600,
      targetIndex: 599
    })
  })
})

describe('planReaderWindowByIndex', () => {
  it('includes the requested index after keyframe alignment and bounds the tail', () => {
    expect(planReaderWindowByIndex({
      totalFrames: 600,
      keyframeIndices: [0, 60, 120, 180, 240],
      targetIndex: 200,
      requestedCount: 80,
      maxFrames: 140
    })).toEqual({
      ok: true,
      startIndex: 180,
      endIndexExclusive: 280,
      targetIndex: 200
    })
  })

  it('fails instead of returning a capped range that omits the requested index', () => {
    expect(planReaderWindowByIndex({
      totalFrames: 600,
      keyframeIndices: [0, 500],
      targetIndex: 200,
      requestedCount: 80,
      maxFrames: 140
    })).toEqual({
      ok: false,
      code: 'GOP_EXCEEDS_WINDOW_CAPACITY',
      targetIndex: 200,
      keyframeIndex: 0,
      requiredFrames: 201,
      maxFrames: 140
    })
  })
})
