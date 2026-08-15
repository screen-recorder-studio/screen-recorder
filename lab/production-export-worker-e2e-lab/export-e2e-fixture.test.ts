import { describe, expect, it } from 'vitest'
import {
  buildProductionExportMatrix,
  evaluateProductionExportAcceptance
} from './export-e2e-fixture'
import { createMemoryTrimExportPlan } from '../../packages/extension/src/lib/export/memory-trim-export'

describe('production export worker E2E fixture', () => {
  it('uses half-open trim bounds, preserves source timestamps, and leaves source chunks untouched', () => {
    const chunks = [
      chunk(0, 'key'),
      chunk(500_000, 'key'),
      chunk(1_000_000, 'key'),
      chunk(1_500_000, 'key'),
      chunk(2_000_000, 'key')
    ]

    const prepared = createMemoryTrimExportPlan(chunks, { enabled: true, startMs: 500, endMs: 1_500 })

    expect(prepared.decodeChunks.map(item => item.timestamp)).toEqual([500_000, 1_000_000])
    expect(prepared.visibleRange).toEqual({ visibleStartIndex: 0, visibleEndExclusive: 2 })
    expect(chunks.map(item => item.timestamp)).toEqual([0, 500_000, 1_000_000, 1_500_000, 2_000_000])
  })

  it('keeps keyframe preroll while excluding it from the visible output range', () => {
    const chunks = [chunk(0, 'key'), chunk(500_000, 'delta'), chunk(1_000_000, 'delta'), chunk(1_500_000, 'delta')]

    const plan = createMemoryTrimExportPlan(chunks, { enabled: true, startMs: 500, endMs: 1_500 })

    expect(plan.decodeChunks.map(item => item.timestamp)).toEqual([0, 500_000, 1_000_000])
    expect(plan.visibleRange).toEqual({ visibleStartIndex: 1, visibleEndExclusive: 3 })
  })

  it('exposes MP4, WebM, and GIF as an explicit production matrix', () => {
    expect(buildProductionExportMatrix()).toEqual([
      { format: 'mp4', state: 'implemented', detail: '真实 export-worker + H.264 BufferTarget' },
      { format: 'webm', state: 'unverified', detail: '同一入口，VP9 BufferTarget；尚未实跑' },
      { format: 'gif', state: 'bridge-required', detail: '需要主线程 GifEncoder 握手与静态 worker 资产' }
    ])
  })

  it('requires duration, dimensions, and every checkpoint pixel to pass', () => {
    expect(evaluateProductionExportAcceptance({
      actualDurationSeconds: 3.01,
      expectedDurationSeconds: 3,
      actualWidth: 640,
      actualHeight: 360,
      expectedWidth: 640,
      expectedHeight: 360,
      checkpointMae: [0.4, 1.2, 2.1]
    })).toEqual({
      durationPass: true,
      dimensionsPass: true,
      pixelsPass: true,
      pass: true,
      maxCheckpointMae: 2.1
    })

    expect(evaluateProductionExportAcceptance({
      actualDurationSeconds: 3.3,
      expectedDurationSeconds: 3,
      actualWidth: 640,
      actualHeight: 358,
      expectedWidth: 640,
      expectedHeight: 360,
      checkpointMae: [0.2, 19]
    }).pass).toBe(false)
  })
})

function chunk(timestamp: number, type: 'key' | 'delta') {
  return {
    timestamp,
    type,
    data: new Uint8Array([timestamp / 500_000]),
    size: 1,
    codec: 'vp8',
    codedWidth: 320,
    codedHeight: 180
  }
}
