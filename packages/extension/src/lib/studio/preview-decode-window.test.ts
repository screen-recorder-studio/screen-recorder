import { describe, expect, it } from 'vitest'
import {
  classifyPreviewDecodedOutput,
  planBoundedPreviewDecodeWindow
} from './preview-decode-window'

describe('bounded preview decode window', () => {
  it('keeps the first visible frames after keyframe preroll instead of the last decoded frames', () => {
    const plan = planBoundedPreviewDecodeWindow({
      decodeStartGlobalFrame: 180,
      retainStartGlobalFrame: 241,
      decodedChunkCount: 140,
      capacity: 30
    })

    expect(plan).toEqual({
      decodeStartGlobalFrame: 180,
      retainStartGlobalFrame: 241,
      prerollFrameCount: 61,
      retainedFrameCount: 30,
      decodeFrameCount: 91
    })
    expect(classifyPreviewDecodedOutput(plan!, 60)).toEqual({
      action: 'discard-preroll',
      globalFrameIndex: 240
    })
    expect(classifyPreviewDecodedOutput(plan!, 61)).toEqual({
      action: 'retain',
      globalFrameIndex: 241,
      retainedFrameIndex: 0
    })
    expect(classifyPreviewDecodedOutput(plan!, 90)).toEqual({
      action: 'retain',
      globalFrameIndex: 270,
      retainedFrameIndex: 29
    })
    expect(classifyPreviewDecodedOutput(plan!, 91)).toEqual({
      action: 'discard-overflow',
      globalFrameIndex: 271
    })
  })

  it('bounds an initial 90-frame reader window to the consumer capacity', () => {
    expect(planBoundedPreviewDecodeWindow({
      decodeStartGlobalFrame: 0,
      retainStartGlobalFrame: 0,
      decodedChunkCount: 90,
      capacity: 30
    })).toEqual({
      decodeStartGlobalFrame: 0,
      retainStartGlobalFrame: 0,
      prerollFrameCount: 0,
      retainedFrameCount: 30,
      decodeFrameCount: 30
    })
  })

  it('never submits reader tail chunks that cannot enter the bounded visible cache', () => {
    const plan = planBoundedPreviewDecodeWindow({
      decodeStartGlobalFrame: 240,
      retainStartGlobalFrame: 249,
      decodedChunkCount: 140,
      capacity: 30
    })

    expect(plan).toMatchObject({
      prerollFrameCount: 9,
      retainedFrameCount: 30,
      decodeFrameCount: 39
    })
    expect(plan!.decodeFrameCount).toBeLessThan(140)
  })

  it('rejects a visible start that is outside the decoded range', () => {
    expect(planBoundedPreviewDecodeWindow({
      decodeStartGlobalFrame: 180,
      retainStartGlobalFrame: 320,
      decodedChunkCount: 140,
      capacity: 30
    })).toBeNull()
  })
})
