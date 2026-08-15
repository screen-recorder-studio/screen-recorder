export interface RecordingEncodePlan {
  width: number
  height: number
  framerate: number
}

const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080
const MAX_FRAME_RATE = 30

function positiveDimension(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function encoderSafeEven(value: number, maximum: number) {
  const bounded = Math.min(maximum, Math.max(2, value))
  return Math.max(2, Math.floor(bounded / 2) * 2)
}

/**
 * Balanced is the reliable default for interactive screen recording. It keeps
 * the source aspect ratio, never intentionally upscales, and caps the longest
 * orientation-specific edge at Full HD and capture cadence at 30fps.
 */
export function resolveRecordingEncodePlan(
  sourceWidth: number,
  sourceHeight: number,
  sourceFrameRate: number
): RecordingEncodePlan {
  const width = positiveDimension(sourceWidth, DEFAULT_WIDTH)
  const height = positiveDimension(sourceHeight, DEFAULT_HEIGHT)
  const portrait = height > width
  const maxWidth = portrait ? DEFAULT_HEIGHT : DEFAULT_WIDTH
  const maxHeight = portrait ? DEFAULT_WIDTH : DEFAULT_HEIGHT
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const framerate = Number.isFinite(sourceFrameRate) && sourceFrameRate > 0
    ? Math.min(MAX_FRAME_RATE, Math.max(1, Math.round(sourceFrameRate)))
    : MAX_FRAME_RATE

  return {
    width: encoderSafeEven(width * scale, maxWidth),
    height: encoderSafeEven(height * scale, maxHeight),
    framerate
  }
}
