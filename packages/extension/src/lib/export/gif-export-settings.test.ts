import { describe, expect, it } from 'vitest'
import {
  GIF_AUTO_WORKERS,
  GIF_LOOP_OPTIONS,
  resolveGifScaledDimensions,
  resolveGifOutputSizeOptions
} from './gif-export-settings'

describe('GIF export settings presentation', () => {
  it('keeps worker concurrency as an automatic implementation detail', () => {
    expect(GIF_AUTO_WORKERS).toBe(2)
  })

  it('expresses the GIF repeat extension as total plays for people', () => {
    expect(GIF_LOOP_OPTIONS).toEqual([
      { value: 0, totalPlays: null, label: 'Forever' },
      { value: -1, totalPlays: 1, label: 'Play once' },
      { value: 1, totalPlays: 2, label: 'Play twice' },
      { value: 2, totalPlays: 3, label: 'Play 3 times' }
    ])
  })

  it('offers an exact email-width target instead of a coarse percentage step', () => {
    expect(resolveGifOutputSizeOptions(640, 360)).toEqual([
      { id: 'source', label: 'Original', width: 640, height: 360, scalePercent: 100 },
      { id: 'email', label: 'Email width', width: 600, height: 338, scalePercent: 93.75 },
      { id: 'compact', label: 'Compact', width: 480, height: 270, scalePercent: 75 },
      { id: 'small', label: 'Small', width: 320, height: 180, scalePercent: 50 }
    ])
  })

  it('deduplicates targets that are not smaller than the source', () => {
    expect(resolveGifOutputSizeOptions(480, 270)).toEqual([
      { id: 'source', label: 'Original', width: 480, height: 270, scalePercent: 100 },
      { id: 'small', label: 'Small', width: 320, height: 180, scalePercent: 66.66666666666666 }
    ])
  })

  it('keeps named output widths exact across floating-point scale conversion', () => {
    const smallScale = resolveGifOutputSizeOptions(1_920, 1_080)
      .find((option) => option.id === 'small')!.scalePercent / 100

    expect(resolveGifScaledDimensions(1_920, 1_080, smallScale)).toEqual({
      width: 320,
      height: 180
    })
  })
})
