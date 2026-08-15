export interface RecordingFrameCadence {
  frameRate: number
  frameIntervalUs: number
  nextDueTimestampUs: number | null
}

export interface RecordingFrameSampleDecision {
  accept: boolean
  cadence: RecordingFrameCadence
}

const DEFAULT_FRAME_RATE = 30
const JITTER_TOLERANCE_RATIO = 0.1

export function createRecordingFrameCadence(frameRate: number): RecordingFrameCadence {
  const normalizedFrameRate = Number.isFinite(frameRate) && frameRate > 0
    ? frameRate
    : DEFAULT_FRAME_RATE
  return {
    frameRate: normalizedFrameRate,
    frameIntervalUs: 1_000_000 / normalizedFrameRate,
    nextDueTimestampUs: null
  }
}

/**
 * Selects real capture samples on an active-time grid. Gaps stay gaps; no
 * synthetic frames are created, and accepting after a long gap starts a fresh
 * interval instead of allowing a burst of queued frames.
 */
export function sampleRecordingFrame(
  cadence: RecordingFrameCadence,
  timestampUs: number
): RecordingFrameSampleDecision {
  const normalizedTimestampUs = Number.isFinite(timestampUs)
    ? Math.max(0, timestampUs)
    : 0
  const due = cadence.nextDueTimestampUs
  const jitterToleranceUs = cadence.frameIntervalUs * JITTER_TOLERANCE_RATIO
  if (due !== null && normalizedTimestampUs + jitterToleranceUs < due) {
    return { accept: false, cadence }
  }

  const scheduledNextDue = due === null
    ? normalizedTimestampUs + cadence.frameIntervalUs
    : due + cadence.frameIntervalUs
  const nextDueTimestampUs = normalizedTimestampUs - scheduledNextDue > cadence.frameIntervalUs
    ? normalizedTimestampUs + cadence.frameIntervalUs
    : scheduledNextDue

  return {
    accept: true,
    cadence: {
      ...cadence,
      nextDueTimestampUs
    }
  }
}
