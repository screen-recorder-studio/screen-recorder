import type { PresentationScheduleEntry } from '../recording/recording-timeline'

export interface GifFrameScheduleEntry extends PresentationScheduleEntry {
  delayMs: number
}

export interface GifFrameSchedule {
  frames: GifFrameScheduleEntry[]
  inputDurationMs: number
  totalDelayMs: number
}

/**
 * GIF89a stores delays as integer centiseconds. Quantizing the cumulative
 * timeline carries rounding error so a long 30fps export stays synchronized.
 */
export function createGifFrameSchedule(
  schedule: readonly PresentationScheduleEntry[],
  options: { collapseRepeated?: boolean } = {}
): GifFrameSchedule {
  if (schedule.length === 0) throw new Error('GIF_SCHEDULE_EMPTY')

  const collapseRepeated = options.collapseRepeated !== false
  const collapsed: Array<{
    sourceFrameIndex: number
    timestampSeconds: number
    durationSeconds: number
    durationMs: number
  }> = []
  let inputDurationMs = 0
  for (const entry of schedule) {
    const durationMs = entry.durationSeconds * 1_000
    if (!Number.isSafeInteger(entry.sourceFrameIndex) || entry.sourceFrameIndex < 0
      || !Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error('GIF_SCHEDULE_INVALID')
    }
    inputDurationMs += durationMs
    const previous = collapsed.at(-1)
    if (collapseRepeated && previous?.sourceFrameIndex === entry.sourceFrameIndex) {
      previous.durationMs += durationMs
      previous.durationSeconds += entry.durationSeconds
    } else {
      collapsed.push({ ...entry, durationMs })
    }
  }

  let rawCumulativeMs = 0
  let quantizedCumulativeMs = 0
  const frames = collapsed.map((entry) => {
    rawCumulativeMs += entry.durationMs
    const targetCumulativeMs = Math.max(
      quantizedCumulativeMs + 10,
      Math.round(rawCumulativeMs / 10) * 10
    )
    const delayMs = targetCumulativeMs - quantizedCumulativeMs
    quantizedCumulativeMs = targetCumulativeMs
    return {
      sourceFrameIndex: entry.sourceFrameIndex,
      timestampSeconds: entry.timestampSeconds,
      durationSeconds: entry.durationSeconds,
      delayMs
    }
  })

  return { frames, inputDurationMs, totalDelayMs: quantizedCumulativeMs }
}
