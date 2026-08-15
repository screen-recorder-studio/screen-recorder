import type { PresentationScheduleEntry } from '../recording/recording-timeline'

interface ScheduledVideoSource {
  add(timestampSeconds: number, durationSeconds: number): Promise<void>
}

export function isSourceFrameInLoadedWindow(
  window: { start: number; count: number },
  sourceFrameIndex: number
): boolean {
  return window.start >= 0
    && window.count > 0
    && sourceFrameIndex >= window.start
    && sourceFrameIndex < window.start + window.count
}

export async function writePresentationSchedule(input: {
  schedule: readonly PresentationScheduleEntry[]
  renderSourceFrame: (sourceFrameIndex: number) => Promise<void>
  videoSource: ScheduledVideoSource
  onSampleWritten?: (writtenCount: number, entry: PresentationScheduleEntry) => void
}): Promise<number> {
  let renderedSourceFrameIndex = -1
  let writtenCount = 0

  for (const entry of input.schedule) {
    if (entry.sourceFrameIndex !== renderedSourceFrameIndex) {
      await input.renderSourceFrame(entry.sourceFrameIndex)
      renderedSourceFrameIndex = entry.sourceFrameIndex
    }
    await input.videoSource.add(entry.timestampSeconds, entry.durationSeconds)
    writtenCount++
    input.onSampleWritten?.(writtenCount, entry)
  }

  return writtenCount
}
