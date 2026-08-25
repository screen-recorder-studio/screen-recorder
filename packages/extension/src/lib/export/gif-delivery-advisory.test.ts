import { describe, expect, it } from 'vitest'
import { deriveGifDeliveryAdvisory, GIF_EMAIL_IDEAL_BYTES, GIF_EMAIL_UPPER_BYTES } from './gif-delivery-advisory'

describe('GIF delivery advisory', () => {
  it('marks an estimate fully below the email-friendly target as ready', () => {
    expect(deriveGifDeliveryAdvisory({
      minBytes: 420_000,
      maxBytes: GIF_EMAIL_IDEAL_BYTES
    })).toEqual({ tone: 'good', code: 'email-ready' })
  })

  it('asks for a review when the estimate can exceed the ideal target', () => {
    expect(deriveGifDeliveryAdvisory({
      minBytes: 700_000,
      maxBytes: 2_400_000
    })).toEqual({ tone: 'caution', code: 'review-size' })
  })

  it('warns when even the lower estimate reaches a common platform ceiling', () => {
    expect(deriveGifDeliveryAdvisory({
      minBytes: GIF_EMAIL_UPPER_BYTES,
      maxBytes: 18_000_000
    })).toEqual({ tone: 'warning', code: 'too-heavy' })
  })
})
