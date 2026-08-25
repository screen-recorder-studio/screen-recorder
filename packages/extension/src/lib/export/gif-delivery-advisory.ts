export const GIF_EMAIL_IDEAL_BYTES = 1024 * 1024
export const GIF_EMAIL_UPPER_BYTES = 5 * 1024 * 1024

export type GifDeliveryAdvisory =
  | { tone: 'good'; code: 'email-ready' }
  | { tone: 'caution'; code: 'review-size' }
  | { tone: 'warning'; code: 'too-heavy' }

export function deriveGifDeliveryAdvisory(input: {
  minBytes: number
  maxBytes: number
}): GifDeliveryAdvisory {
  const minBytes = normalizeBytes(input.minBytes)
  const maxBytes = Math.max(minBytes, normalizeBytes(input.maxBytes))

  if (maxBytes <= GIF_EMAIL_IDEAL_BYTES) {
    return { tone: 'good', code: 'email-ready' }
  }
  if (minBytes >= GIF_EMAIL_UPPER_BYTES) {
    return { tone: 'warning', code: 'too-heavy' }
  }
  return { tone: 'caution', code: 'review-size' }
}

function normalizeBytes(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}
