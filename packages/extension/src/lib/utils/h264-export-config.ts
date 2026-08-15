export const H264_PROBE_CODECS = [
  'avc1.640028', // High Profile @ Level 4.0 (supports Full HD)
  'avc1.4D4028', // Main Profile @ Level 4.0
  'avc1.64001F', // High Profile @ Level 3.1
  'avc1.4D401F', // Main Profile @ Level 3.1
  'avc1.42E01E', // Constrained Baseline Profile @ Level 3.0
  'avc1.42001E'  // Baseline Profile @ Level 3.0
] as const

export interface NormalizedH264Dimensions {
  width: number
  height: number
  modified: boolean
}

const MIN_H264_DIMENSION = 2

/**
 * Produces the smallest positive, integral, even frame that contains the
 * requested dimensions. WebCodecs H.264 does not require macroblock padding.
 */
export function normalizeH264Dimensions(
  width: number,
  height: number
): NormalizedH264Dimensions {
  const normalizedWidth = normalizeDimension(width)
  const normalizedHeight = normalizeDimension(height)

  return {
    width: normalizedWidth,
    height: normalizedHeight,
    modified: normalizedWidth !== width || normalizedHeight !== height
  }
}

function normalizeDimension(value: number): number {
  const integer = Number.isFinite(value) ? Math.ceil(value) : MIN_H264_DIMENSION
  const positive = Math.max(MIN_H264_DIMENSION, integer)
  return positive % 2 === 0 ? positive : positive + 1
}
