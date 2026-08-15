export const MIN_TRIM_DURATION_MS = 100

export function parseTrimSecondsInput(value: number): number | null {
  return Number.isFinite(value) ? value * 1000 : null
}

export function clampTrimStart(
  valueMs: number,
  endMs: number,
  timelineMaxMs: number,
  minDurationMs = MIN_TRIM_DURATION_MS
): number {
  const max = normalizeTimelineMax(timelineMaxMs)
  const end = clampFinite(endMs, 0, max)
  return clampFinite(valueMs, 0, Math.max(0, end - normalizeMinDuration(minDurationMs)))
}

export function clampTrimEnd(
  valueMs: number,
  startMs: number,
  timelineMaxMs: number,
  minDurationMs = MIN_TRIM_DURATION_MS
): number {
  const max = normalizeTimelineMax(timelineMaxMs)
  const start = clampFinite(startMs, 0, max)
  return clampFinite(valueMs, Math.min(max, start + normalizeMinDuration(minDurationMs)), max)
}

export function resolveTrimKeyboardValue(args: {
  boundary: 'start' | 'end'
  key: string
  currentMs: number
  otherMs: number
  timelineMaxMs: number
  frameRate: number
  shiftKey?: boolean
}): number | null {
  const frameMs = 1000 / normalizeFrameRate(args.frameRate)
  const multiplier = args.shiftKey ? 10 : 1
  let candidate: number

  switch (args.key) {
    case 'ArrowLeft':
      candidate = args.currentMs - frameMs * multiplier
      break
    case 'ArrowRight':
      candidate = args.currentMs + frameMs * multiplier
      break
    case 'PageDown':
      candidate = args.currentMs - 1000 * multiplier
      break
    case 'PageUp':
      candidate = args.currentMs + 1000 * multiplier
      break
    case 'Home':
      candidate = args.boundary === 'start' ? 0 : args.otherMs + MIN_TRIM_DURATION_MS
      break
    case 'End':
      candidate = args.boundary === 'end' ? args.timelineMaxMs : args.otherMs - MIN_TRIM_DURATION_MS
      break
    default:
      return null
  }

  return args.boundary === 'start'
    ? clampTrimStart(candidate, args.otherMs, args.timelineMaxMs)
    : clampTrimEnd(candidate, args.otherMs, args.timelineMaxMs)
}

function normalizeTimelineMax(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizeMinDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : MIN_TRIM_DURATION_MS
}

function normalizeFrameRate(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 30
}

function clampFinite(value: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? value : min
  return Math.min(Math.max(min, normalized), Math.max(min, max))
}
