import type { EncodedChunk } from '../types/background'
import {
  createExportCompositeRenderRequest,
  type ExportCompositeRenderRequest
} from './presentation-schedule-export'

export interface MemoryChunkVisibleRange {
  /** Index in decodeChunks of the first frame eligible for output. */
  visibleStartIndex: number
  /** Exclusive index in decodeChunks after the last frame eligible for output. */
  visibleEndExclusive: number
}

export interface MemoryTrimExportPlan {
  /** Decoder input, including keyframe preroll when the first visible frame is delta. */
  decodeChunks: EncodedChunk[]
  visibleRange: MemoryChunkVisibleRange
}

export class MemoryTrimExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryTrimExportError'
  }
}

/**
 * Separates decoder dependency data from the strict output interval.
 *
 * Decoder timestamps remain on the source timeline. Output rebasing belongs to
 * the CFR mux/render loop, whose output frame zero maps to visibleStartIndex.
 * This adapter makes no VFR-duration claim; it only establishes decoder
 * preroll and the half-open set of source frames eligible for output.
 */
export function createMemoryTrimExportPlan(
  chunks: readonly EncodedChunk[],
  trim: { enabled: boolean; startMs: number; endMs: number }
): MemoryTrimExportPlan {
  if (chunks.length === 0) {
    return emptyPlan(0, 0)
  }

  validateMonotonicTimestamps(chunks)

  const firstTimestampUs = chunks[0].timestamp
  const startMs = finiteNonNegativeOr(trim.startMs, 0)
  const endMs = Math.max(startMs, finiteNonNegativeOr(trim.endMs, startMs))
  const trimStartTimestampUs = firstTimestampUs + startMs * 1000
  const trimEndTimestampUs = firstTimestampUs + endMs * 1000

  if (!trim.enabled) {
    return {
      decodeChunks: [...chunks],
      visibleRange: {
        visibleStartIndex: 0,
        visibleEndExclusive: chunks.length
      }
    }
  }

  const visibleStartInSource = firstIndexAtOrAfter(chunks, trimStartTimestampUs)
  const visibleEndInSource = firstIndexAtOrAfter(chunks, trimEndTimestampUs)
  if (visibleStartInSource >= visibleEndInSource) {
    return emptyPlan(trimStartTimestampUs, trimEndTimestampUs)
  }

  const decodeStartInSource = keyframeAtOrBefore(chunks, visibleStartInSource)
  if (decodeStartInSource === null) {
    throw new MemoryTrimExportError(
      `No keyframe is available at or before trim start frame ${visibleStartInSource}`
    )
  }

  const decodeChunks = chunks.slice(decodeStartInSource, visibleEndInSource)
  const visibleStartIndex = visibleStartInSource - decodeStartInSource
  const visibleEndExclusive = visibleEndInSource - decodeStartInSource

  return {
    decodeChunks,
    visibleRange: {
      visibleStartIndex,
      visibleEndExclusive
    }
  }
}

export function getMemoryVisibleFrameCount(range: MemoryChunkVisibleRange): number {
  return Math.max(0, range.visibleEndExclusive - range.visibleStartIndex)
}

/** Maps an output-relative frame index onto the decoder's preroll-inclusive buffer. */
export function mapMemoryOutputFrameToDecodeIndex(
  outputFrameIndex: number,
  range: MemoryChunkVisibleRange
): number {
  const visibleCount = getMemoryVisibleFrameCount(range)
  if (!Number.isInteger(outputFrameIndex) || outputFrameIndex < 0 || outputFrameIndex >= visibleCount) {
    throw new RangeError(`Output frame ${outputFrameIndex} is outside visible frame count ${visibleCount}`)
  }
  return range.visibleStartIndex + outputFrameIndex
}

/**
 * Memory export decodes through preroll but evaluates effects on the output
 * clock. Consequently decoder frame index and presentation time must be sent
 * as independent values.
 */
export function createMemoryExportCompositeRenderRequest(input: {
  outputFrameIndex: number
  outputFrameRate: number
  requestId: number
  visibleRange: MemoryChunkVisibleRange
}): ExportCompositeRenderRequest {
  if (!Number.isFinite(input.outputFrameRate) || input.outputFrameRate <= 0) {
    throw new RangeError('outputFrameRate must be positive and finite')
  }

  const decodeFrameIndex = mapMemoryOutputFrameToDecodeIndex(
    input.outputFrameIndex,
    input.visibleRange
  )
  const timestampSeconds = input.outputFrameIndex / input.outputFrameRate

  return createExportCompositeRenderRequest({
    frameIndex: decodeFrameIndex,
    requestId: input.requestId,
    scheduleEntry: {
      sourceFrameIndex: decodeFrameIndex,
      timestampSeconds,
      durationSeconds: 1 / input.outputFrameRate
    }
  })
}

function emptyPlan(_trimStartTimestampUs: number, _trimEndTimestampUs: number): MemoryTrimExportPlan {
  return {
    decodeChunks: [],
    visibleRange: {
      visibleStartIndex: 0,
      visibleEndExclusive: 0
    }
  }
}

function firstIndexAtOrAfter(chunks: readonly EncodedChunk[], timestampUs: number): number {
  let low = 0
  let high = chunks.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (chunks[middle].timestamp < timestampUs) low = middle + 1
    else high = middle
  }
  return low
}

function keyframeAtOrBefore(
  chunks: readonly EncodedChunk[],
  sourceFrameIndex: number
): number | null {
  for (let index = sourceFrameIndex; index >= 0; index--) {
    if (chunks[index]?.type === 'key') return index
  }
  return null
}

function validateMonotonicTimestamps(chunks: readonly EncodedChunk[]): void {
  for (let index = 0; index < chunks.length; index++) {
    const timestamp = chunks[index].timestamp
    if (!Number.isFinite(timestamp)) {
      throw new MemoryTrimExportError(`Chunk ${index} has a non-finite timestamp`)
    }
    if (index > 0 && timestamp < chunks[index - 1].timestamp) {
      throw new MemoryTrimExportError('Chunk timestamps must be monotonic')
    }
  }
}

function finiteNonNegativeOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback
}
