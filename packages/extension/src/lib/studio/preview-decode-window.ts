export interface BoundedPreviewDecodeWindowInput {
  decodeStartGlobalFrame: number
  retainStartGlobalFrame: number
  decodedChunkCount: number
  capacity: number
}

export interface BoundedPreviewDecodeWindow {
  decodeStartGlobalFrame: number
  retainStartGlobalFrame: number
  prerollFrameCount: number
  retainedFrameCount: number
  decodeFrameCount: number
}

export type PreviewDecodedOutputDecision =
  | { action: 'discard-preroll'; globalFrameIndex: number }
  | { action: 'retain'; globalFrameIndex: number; retainedFrameIndex: number }
  | { action: 'discard-overflow'; globalFrameIndex: number }

/**
 * Separates codec decode preroll from the bounded set of frames the preview can
 * address. The retained window is fixed at its requested start: overflow is
 * discarded at the tail so a fast decoder cannot evict frames before the
 * display clock reaches them.
 */
export function planBoundedPreviewDecodeWindow(
  input: BoundedPreviewDecodeWindowInput
): BoundedPreviewDecodeWindow | null {
  if (![
    input.decodeStartGlobalFrame,
    input.retainStartGlobalFrame,
    input.decodedChunkCount,
    input.capacity
  ].every(Number.isFinite)) return null

  const decodeStartGlobalFrame = Math.max(0, Math.floor(input.decodeStartGlobalFrame))
  const retainStartGlobalFrame = Math.max(0, Math.floor(input.retainStartGlobalFrame))
  const decodedChunkCount = Math.max(0, Math.floor(input.decodedChunkCount))
  const capacity = Math.max(0, Math.floor(input.capacity))
  const prerollFrameCount = retainStartGlobalFrame - decodeStartGlobalFrame
  const availableRetainedFrames = decodedChunkCount - prerollFrameCount

  if (
    capacity === 0
    || prerollFrameCount < 0
    || availableRetainedFrames <= 0
  ) return null

  const retainedFrameCount = Math.min(availableRetainedFrames, capacity)
  return {
    decodeStartGlobalFrame,
    retainStartGlobalFrame,
    prerollFrameCount,
    retainedFrameCount,
    decodeFrameCount: prerollFrameCount + retainedFrameCount
  }
}

export function classifyPreviewDecodedOutput(
  plan: BoundedPreviewDecodeWindow,
  decodedOutputIndex: number
): PreviewDecodedOutputDecision {
  const outputIndex = Math.max(0, Math.floor(decodedOutputIndex))
  const globalFrameIndex = plan.decodeStartGlobalFrame + outputIndex

  if (outputIndex < plan.prerollFrameCount) {
    return { action: 'discard-preroll', globalFrameIndex }
  }

  const retainedFrameIndex = outputIndex - plan.prerollFrameCount
  if (retainedFrameIndex >= plan.retainedFrameCount) {
    return { action: 'discard-overflow', globalFrameIndex }
  }

  return {
    action: 'retain',
    globalFrameIndex,
    retainedFrameIndex
  }
}
