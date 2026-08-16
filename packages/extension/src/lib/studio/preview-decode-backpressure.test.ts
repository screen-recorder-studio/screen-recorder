import { describe, expect, it } from 'vitest'
import { previewDecodeBackpressureState } from './preview-decode-backpressure'

describe('preview decoder submission backpressure', () => {
  it('pauses at eight queued chunks and resumes only at four', () => {
    expect(previewDecodeBackpressureState(7, false)).toBe('submit')
    expect(previewDecodeBackpressureState(8, false)).toBe('wait')
    expect(previewDecodeBackpressureState(5, true)).toBe('wait')
    expect(previewDecodeBackpressureState(4, true)).toBe('submit')
  })

  it('normalizes invalid queue sizes to a safe wait state', () => {
    expect(previewDecodeBackpressureState(Number.NaN, false)).toBe('wait')
    expect(previewDecodeBackpressureState(-1, false)).toBe('wait')
  })

  it('supports a tighter high-watermark for 4K transient surfaces', () => {
    expect(previewDecodeBackpressureState(1, false, 2, 1)).toBe('submit')
    expect(previewDecodeBackpressureState(2, false, 2, 1)).toBe('wait')
    expect(previewDecodeBackpressureState(2, true, 2, 1)).toBe('wait')
    expect(previewDecodeBackpressureState(1, true, 2, 1)).toBe('submit')
  })
})
