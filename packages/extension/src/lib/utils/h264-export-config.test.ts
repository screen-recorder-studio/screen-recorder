import { describe, expect, it } from 'vitest'
import { H264_PROBE_CODECS, normalizeH264Dimensions } from './h264-export-config'

describe('normalizeH264Dimensions', () => {
  it('keeps an already-even 1920x1080 frame unchanged', () => {
    expect(normalizeH264Dimensions(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
      modified: false
    })
  })

  it('rounds odd dimensions up to the next even integer without 16px padding', () => {
    expect(normalizeH264Dimensions(1919, 1079)).toEqual({
      width: 1920,
      height: 1080,
      modified: true
    })
  })

  it('maps 1x1 to the smallest safe positive even dimensions', () => {
    expect(normalizeH264Dimensions(1, 1)).toEqual({
      width: 2,
      height: 2,
      modified: true
    })
  })

  it('tries the Full HD-capable H.264 Level 4 profile first', () => {
    expect(H264_PROBE_CODECS[0]).toBe('avc1.640028')
  })
})
