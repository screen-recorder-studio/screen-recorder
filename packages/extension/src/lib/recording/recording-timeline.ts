export interface RecordingTimelineInput {
  sourceTimestampsUs: readonly number[]
  canonicalDurationMs: number
  nominalFps: number
}

export interface RecordingTimeline {
  durationMs: number
  nominalFps: number
  sourceTimestampsMs: number[]
  sourceDurationsMs: number[]
}

export interface PresentationScheduleEntry {
  sourceFrameIndex: number
  timestampSeconds: number
  durationSeconds: number
}

export class RecordingTimelineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordingTimelineError'
  }
}

export function createRecordingTimeline(input: RecordingTimelineInput): RecordingTimeline {
  const nominalFps = requirePositiveFinite(input.nominalFps, 'nominalFps')
  if (input.sourceTimestampsUs.length === 0) {
    throw new RecordingTimelineError('sourceTimestampsUs must contain at least one sample')
  }

  const firstTimestampUs = requireFinite(input.sourceTimestampsUs[0], 'sourceTimestampsUs[0]')
  const sourceTimestampsMs = input.sourceTimestampsUs.map((timestampUs, index) => {
    const timestamp = requireFinite(timestampUs, `sourceTimestampsUs[${index}]`)
    if (index > 0 && timestamp < input.sourceTimestampsUs[index - 1]) {
      throw new RecordingTimelineError('source timestamps must be monotonic')
    }
    return (timestamp - firstTimestampUs) / 1000
  })

  const nominalFrameDurationMs = 1000 / nominalFps
  const lastTimestampMs = sourceTimestampsMs.at(-1) ?? 0
  const canonicalDurationMs = Number.isFinite(input.canonicalDurationMs)
    ? Math.max(0, input.canonicalDurationMs)
    : 0
  const durationMs = Math.max(canonicalDurationMs, lastTimestampMs + nominalFrameDurationMs)

  const sourceDurationsMs = sourceTimestampsMs.map((timestampMs, index) => {
    const nextTimestampMs = sourceTimestampsMs[index + 1]
    return nextTimestampMs === undefined
      ? durationMs - timestampMs
      : nextTimestampMs - timestampMs
  })

  return {
    durationMs,
    nominalFps,
    sourceTimestampsMs,
    sourceDurationsMs
  }
}

export function buildPresentationSchedule(input: {
  sourceTimestampsMs: readonly number[]
  durationMs: number
  targetFps: number
}): PresentationScheduleEntry[] {
  const targetFps = requirePositiveFinite(input.targetFps, 'targetFps')
  const durationMs = requirePositiveFinite(input.durationMs, 'durationMs')
  validateNormalizedTimestamps(input.sourceTimestampsMs)

  const frameDurationMs = 1000 / targetFps
  const targetFrameCount = Math.ceil(durationMs / frameDurationMs)
  const schedule: PresentationScheduleEntry[] = []
  let sourceFrameIndex = 0

  for (let targetFrameIndex = 0; targetFrameIndex < targetFrameCount; targetFrameIndex++) {
    const timestampMs = targetFrameIndex * frameDurationMs
    sourceFrameIndex = findSourceFrameAtTime(input.sourceTimestampsMs, timestampMs, sourceFrameIndex)

    schedule.push({
      sourceFrameIndex,
      timestampSeconds: timestampMs / 1000,
      durationSeconds: Math.min(frameDurationMs, durationMs - timestampMs) / 1000
    })
  }

  return schedule
}

export function findSourceFrameAtTime(
  sourceTimestampsMs: readonly number[],
  timeMs: number,
  lowerBoundIndex = 0
): number {
  if (sourceTimestampsMs.length === 0) return 0
  const targetMs = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0
  let lo = Math.max(0, Math.min(sourceTimestampsMs.length - 1, lowerBoundIndex))
  let hi = sourceTimestampsMs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sourceTimestampsMs[mid] <= targetMs) lo = mid + 1
    else hi = mid - 1
  }
  return Math.max(0, Math.min(sourceTimestampsMs.length - 1, hi))
}

export function resolveDisplayedTimelinePosition(input: {
  sourceTimestampsMs: readonly number[]
  requestedTimeMs: number
  renderedFrameIndex: number
}): number {
  if (input.sourceTimestampsMs.length === 0) return 0

  const requestedTimeMs = Number.isFinite(input.requestedTimeMs)
    ? Math.max(0, input.requestedTimeMs)
    : 0
  const renderedFrameIndex = Math.max(
    0,
    Math.min(input.sourceTimestampsMs.length - 1, Math.floor(input.renderedFrameIndex))
  )

  if (findSourceFrameAtTime(input.sourceTimestampsMs, requestedTimeMs) === renderedFrameIndex) {
    return requestedTimeMs
  }
  return input.sourceTimestampsMs[renderedFrameIndex] ?? 0
}

function validateNormalizedTimestamps(timestampsMs: readonly number[]): void {
  if (timestampsMs.length === 0) {
    throw new RecordingTimelineError('sourceTimestampsMs must contain at least one sample')
  }
  if (timestampsMs[0] !== 0) {
    throw new RecordingTimelineError('sourceTimestampsMs must start at zero')
  }
  timestampsMs.forEach((timestampMs, index) => {
    requireFinite(timestampMs, `sourceTimestampsMs[${index}]`)
    if (index > 0 && timestampMs < timestampsMs[index - 1]) {
      throw new RecordingTimelineError('source timestamps must be monotonic')
    }
  })
}

function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RecordingTimelineError(`${field} must be finite`)
  }
  return value
}

function requirePositiveFinite(value: number, field: string): number {
  const finite = requireFinite(value, field)
  if (finite <= 0) {
    throw new RecordingTimelineError(`${field} must be greater than zero`)
  }
  return finite
}
