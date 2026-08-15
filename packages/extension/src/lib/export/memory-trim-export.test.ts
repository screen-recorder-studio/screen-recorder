import { describe, expect, it } from 'vitest'
import type { EncodedChunk } from '../types/background'
import {
  MemoryTrimExportError,
  createMemoryExportCompositeRenderRequest,
  createMemoryTrimExportPlan,
  getMemoryVisibleFrameCount,
  mapMemoryOutputFrameToDecodeIndex
} from './memory-trim-export'

function chunk(timestamp: number, type: 'key' | 'delta'): EncodedChunk {
  return {
    data: new Uint8Array([timestamp / 1_000_000]),
    timestamp,
    type,
    size: 1
  }
}

describe('memory trim export', () => {
  it('starts decode at the nearest preceding keyframe but exposes only [start, end)', () => {
    const chunks = [
      chunk(10_000_000, 'key'),
      chunk(11_000_000, 'key'),
      chunk(12_000_000, 'delta'),
      chunk(13_000_000, 'delta'),
      chunk(14_000_000, 'key')
    ]

    const plan = createMemoryTrimExportPlan(chunks, {
      enabled: true,
      startMs: 2_000,
      endMs: 4_000
    })

    // startMs/endMs are relative to the first source timestamp. The delta at
    // 12s is visible, while the 11s keyframe is retained only as decoder preroll.
    expect(plan.decodeChunks.map(item => [item.timestamp, item.type])).toEqual([
      [11_000_000, 'key'],
      [12_000_000, 'delta'],
      [13_000_000, 'delta']
    ])
    expect(plan.visibleRange).toEqual({
      visibleStartIndex: 1,
      visibleEndExclusive: 3
    })
    expect(getMemoryVisibleFrameCount(plan.visibleRange)).toBe(2)
    expect(mapMemoryOutputFrameToDecodeIndex(0, plan.visibleRange)).toBe(1)
    expect(mapMemoryOutputFrameToDecodeIndex(1, plan.visibleRange)).toBe(2)

    // Decode PTS remain source PTS; the adapter does not pretend preroll is
    // output-relative time zero.
    expect(plan.decodeChunks[0].timestamp).toBe(11_000_000)
    expect(chunks[1].timestamp).toBe(11_000_000)
  })

  it('excludes a chunk exactly at the trim end', () => {
    const plan = createMemoryTrimExportPlan([
      chunk(0, 'key'),
      chunk(1_000_000, 'delta'),
      chunk(2_000_000, 'delta')
    ], {
      enabled: true,
      startMs: 0,
      endMs: 2_000
    })

    expect(plan.decodeChunks.map(item => item.timestamp)).toEqual([0, 1_000_000])
  })

  it('does not add preroll when trim starts on a keyframe', () => {
    const plan = createMemoryTrimExportPlan([
      chunk(0, 'key'),
      chunk(1_000_000, 'delta'),
      chunk(2_000_000, 'key'),
      chunk(3_000_000, 'delta')
    ], {
      enabled: true,
      startMs: 2_000,
      endMs: 4_000
    })

    expect(plan.decodeChunks.map(item => item.timestamp)).toEqual([2_000_000, 3_000_000])
    expect(plan.visibleRange.visibleStartIndex).toBe(0)
  })

  it('fails explicitly when a visible delta has no preceding keyframe', () => {
    expect(() => createMemoryTrimExportPlan([
      chunk(0, 'delta'),
      chunk(1_000_000, 'delta')
    ], {
      enabled: true,
      startMs: 500,
      endMs: 2_000
    })).toThrow(MemoryTrimExportError)
  })

  it('decouples decoder preroll index from output-relative Zoom time', () => {
    const visibleRange = { visibleStartIndex: 1, visibleEndExclusive: 3 }

    expect(createMemoryExportCompositeRenderRequest({
      outputFrameIndex: 0,
      outputFrameRate: 30,
      requestId: 71,
      visibleRange
    })).toEqual({
      type: 'renderAtTime',
      data: {
        frameIndex: 1,
        presentationTimeMs: 0,
        requestId: 71
      }
    })

    expect(createMemoryExportCompositeRenderRequest({
      outputFrameIndex: 1,
      outputFrameRate: 30,
      requestId: 72,
      visibleRange
    })).toEqual({
      type: 'renderAtTime',
      data: {
        frameIndex: 2,
        presentationTimeMs: 1000 / 30,
        requestId: 72
      }
    })
  })
})
