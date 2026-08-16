export interface GifSizeEstimateInput {
  width: number
  height: number
  frameCount: number
  /** gif.js sample interval: smaller values favor quality and usually larger files. */
  quality: number
}

export interface GifSizeEstimateRange {
  minBytes: number
  maxBytes: number
}

// GIF size depends heavily on pixel changes and palette reuse. Two production
// exports of the quality test card measured 0.142 and 0.445 bytes/pixel/frame,
// so a range is materially more honest than the former 0.011 point estimate.
const MIN_BYTES_PER_PIXEL_FRAME = 0.1
const MAX_BYTES_PER_PIXEL_FRAME = 0.5
const BASELINE_QUALITY = 10

function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function qualityMultiplier(value: number): number {
  const quality = Number.isFinite(value) ? Math.min(30, Math.max(1, value)) : BASELINE_QUALITY
  return Math.min(1.5, Math.max(0.5, (31 - quality) / (31 - BASELINE_QUALITY)))
}

export function estimateGifSizeRange(input: GifSizeEstimateInput): GifSizeEstimateRange {
  const width = positiveInteger(input.width)
  const height = positiveInteger(input.height)
  const frameCount = positiveInteger(input.frameCount)
  if (width === 0 || height === 0 || frameCount === 0) {
    return { minBytes: 0, maxBytes: 0 }
  }

  const pixelFrames = width * height * frameCount
  const multiplier = qualityMultiplier(input.quality)
  return {
    minBytes: Math.round(pixelFrames * MIN_BYTES_PER_PIXEL_FRAME * multiplier),
    maxBytes: Math.round(pixelFrames * MAX_BYTES_PER_PIXEL_FRAME * multiplier)
  }
}
