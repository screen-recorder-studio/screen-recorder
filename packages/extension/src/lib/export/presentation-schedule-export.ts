import type { PresentationScheduleEntry } from '../recording/recording-timeline'

interface ScheduledVideoSource {
  add(timestampSeconds: number, durationSeconds: number): Promise<void>
}

export type ExportCompositeRenderRequest = {
  type: 'renderAtTime'
  data: {
    frameIndex: number
    presentationTimeMs: number
    requestId: number
  }
} | {
  type: 'seek'
  data: {
    frameIndex: number
  }
}

export function createExportCompositeRenderRequest(input: {
  frameIndex: number
  requestId: number
  scheduleEntry?: PresentationScheduleEntry
}): ExportCompositeRenderRequest {
  if (input.scheduleEntry) {
    return {
      type: 'renderAtTime',
      data: {
        frameIndex: input.frameIndex,
        presentationTimeMs: input.scheduleEntry.timestampSeconds * 1000,
        requestId: input.requestId
      }
    }
  }

  return {
    type: 'seek',
    data: { frameIndex: input.frameIndex }
  }
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
  hasTimeVaryingEffects?: boolean
  renderSourceFrame: (
    sourceFrameIndex: number,
    entry: PresentationScheduleEntry,
    presentationTimeMs: number
  ) => Promise<void>
  videoSource: ScheduledVideoSource
  onSampleWritten?: (writtenCount: number, entry: PresentationScheduleEntry) => void
}): Promise<number> {
  let renderedSourceFrameIndex = -1
  let writtenCount = 0

  for (const entry of input.schedule) {
    if (input.hasTimeVaryingEffects || entry.sourceFrameIndex !== renderedSourceFrameIndex) {
      await input.renderSourceFrame(
        entry.sourceFrameIndex,
        entry,
        entry.timestampSeconds * 1000
      )
      renderedSourceFrameIndex = entry.sourceFrameIndex
    }
    await input.videoSource.add(entry.timestampSeconds, entry.durationSeconds)
    writtenCount++
    input.onSampleWritten?.(writtenCount, entry)
  }

  return writtenCount
}
