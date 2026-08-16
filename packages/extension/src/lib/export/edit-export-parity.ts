export interface ExportTrimRange {
  enabled?: boolean
  startMs: number
  endMs: number
}

interface ZoomIntervalLike {
  startMs: number
  endMs: number
  transitionDurationMs?: number
  [key: string]: unknown
}

interface VideoZoomLike {
  enabled?: boolean
  transitionDurationMs?: number
  intervals?: readonly ZoomIntervalLike[]
  [key: string]: unknown
}

interface EditConfigLike {
  videoZoom?: VideoZoomLike
  [key: string]: unknown
}

const DEFAULT_ZOOM_TRANSITION_MS = 300

export function hasUsableExportTimeline(
  timeline: unknown,
  totalFrames: number
): timeline is { durationMs: number; sampleTimestampsMs: number[] } {
  if (!isRecord(timeline)) return false
  const sampleTimestampsMs = timeline.sampleTimestampsMs
  const durationMs = timeline.durationMs
  if (
    !Array.isArray(sampleTimestampsMs)
    || !Number.isInteger(totalFrames)
    || totalFrames <= 0
    || sampleTimestampsMs.length !== totalFrames
    || typeof durationMs !== 'number'
    || !Number.isFinite(durationMs)
    || durationMs <= 0
  ) return false

  return sampleTimestampsMs.every((timestampMs, index) => (
    typeof timestampMs === 'number'
    && Number.isFinite(timestampMs)
    && timestampMs >= 0
    && (index === 0
      ? timestampMs === 0
      : timestampMs >= sampleTimestampsMs[index - 1])
  ))
}

/**
 * Convert a source-timeline time to the output-relative presentation time.
 */
export function toTrimmedPresentationTimeMs(sourceTimeMs: number, trimStartMs: number): number {
  if (!Number.isFinite(sourceTimeMs)) return 0
  const safeTrimStartMs = Number.isFinite(trimStartMs) ? Math.max(0, trimStartMs) : 0
  return Math.max(0, sourceTimeMs - safeTrimStartMs)
}

/**
 * Rebase zoom intervals onto the trimmed output timeline.
 *
 * Interval boundaries deliberately remain outside the output range. Clamping an
 * interval start to zero would restart an already in-progress entrance
 * transition; clamping its end would similarly move the exit transition.
 */
export function rebaseZoomForTrim<T>(backgroundConfig: T, trim?: ExportTrimRange): T {
  if (!trim?.enabled || !isRecord(backgroundConfig)) return backgroundConfig

  const config = backgroundConfig as EditConfigLike
  const videoZoom = config.videoZoom
  if (!isRecord(videoZoom) || !Array.isArray(videoZoom.intervals)) return backgroundConfig

  const trimStartMs = Number.isFinite(trim.startMs) ? Math.max(0, trim.startMs) : 0
  const trimEndMs = Number.isFinite(trim.endMs)
    ? Math.max(trimStartMs, trim.endMs)
    : trimStartMs
  const outputDurationMs = trimEndMs - trimStartMs
  const globalTransitionMs = nonNegativeFiniteOr(
    videoZoom.transitionDurationMs,
    DEFAULT_ZOOM_TRANSITION_MS
  )

  const intervals = videoZoom.intervals
    .filter(isValidZoomInterval)
    .map((interval) => ({
      ...interval,
      startMs: interval.startMs - trimStartMs,
      endMs: interval.endMs - trimStartMs
    }))
    .filter((interval) => {
      const transitionMs = nonNegativeFiniteOr(
        interval.transitionDurationMs,
        globalTransitionMs
      )
      const effectiveStartMs = interval.startMs - transitionMs
      const effectiveEndMs = interval.endMs + transitionMs
      return effectiveEndMs > 0 && effectiveStartMs < outputDurationMs
    })

  return {
    ...config,
    videoZoom: {
      ...videoZoom,
      intervals,
      enabled: videoZoom.enabled !== false && intervals.length > 0
    }
  } as T
}

/**
 * Effects identified here require the compositor to redraw even while a VFR
 * source frame is held across multiple output samples.
 */
export function hasTimeVaryingEditEffects(backgroundConfig: unknown): boolean {
  if (!isRecord(backgroundConfig)) return false
  const videoZoom = backgroundConfig.videoZoom
  if (!isRecord(videoZoom) || videoZoom.enabled !== true || !Array.isArray(videoZoom.intervals)) {
    return false
  }
  return videoZoom.intervals.some(isValidZoomInterval)
}

function isValidZoomInterval(value: unknown): value is ZoomIntervalLike {
  return isRecord(value)
    && Number.isFinite(value.startMs)
    && Number.isFinite(value.endMs)
    && (value.startMs as number) < (value.endMs as number)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nonNegativeFiniteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback
}
