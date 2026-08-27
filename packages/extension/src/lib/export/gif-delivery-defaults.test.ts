import { describe, expect, it } from 'vitest'
import { resolveGifDeliveryDefaults } from './gif-delivery-defaults'

describe('GIF delivery defaults', () => {
  it('chooses the largest existing scale preset at or below the 600px email width', () => {
    expect(resolveGifDeliveryDefaults(600)).toMatchObject({ scalePercent: 100 })
    expect(resolveGifDeliveryDefaults(800)).toMatchObject({ scalePercent: 75 })
    expect(resolveGifDeliveryDefaults(1_200)).toMatchObject({ scalePercent: 50 })
    expect(resolveGifDeliveryDefaults(1_920)).toMatchObject({ scalePercent: 31.25 })
    expect(resolveGifDeliveryDefaults(640)).toMatchObject({ scalePercent: 93.75 })
  })

  it('uses an email-friendly cadence and a finite loop count', () => {
    expect(resolveGifDeliveryDefaults(1_000)).toEqual({
      fps: 10,
      scalePercent: 60,
      repeat: 2
    })
  })
})
