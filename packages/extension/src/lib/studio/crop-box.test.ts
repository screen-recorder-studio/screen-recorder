import { describe, expect, it } from 'vitest'
import { resolveInitialCropBox } from './crop-box'

describe('resolveInitialCropBox', () => {
  it('starts with the full source frame when crop is disabled', () => {
    expect(resolveInitialCropBox(4632, 2406, { enabled: false })).toEqual({
      x: 0,
      y: 0,
      width: 4632,
      height: 2406
    })
  })

  it('restores an existing percentage crop', () => {
    expect(resolveInitialCropBox(2000, 1000, {
      enabled: true,
      mode: 'percentage',
      xPercent: 0.1,
      yPercent: 0.2,
      widthPercent: 0.5,
      heightPercent: 0.6
    })).toEqual({ x: 200, y: 200, width: 1000, height: 600 })
  })

  it('clamps malformed saved values inside the source bounds', () => {
    expect(resolveInitialCropBox(1000, 500, {
      enabled: true,
      mode: 'percentage',
      xPercent: 0.9,
      yPercent: -1,
      widthPercent: 0.5,
      heightPercent: 2
    })).toEqual({ x: 900, y: 0, width: 100, height: 500 })
  })
})
