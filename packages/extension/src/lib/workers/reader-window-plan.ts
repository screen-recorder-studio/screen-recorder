import { findSourceFrameAtTime } from '../recording/recording-timeline'

export type ReaderWindowPlan =
  | {
      ok: true
      startIndex: number
      endIndexExclusive: number
      targetIndex: number
    }
  | {
      ok: false
      code: 'NO_KEYFRAME_BEFORE_TARGET' | 'GOP_EXCEEDS_WINDOW_CAPACITY' | 'EMPTY_TIMELINE'
      targetIndex: number
      keyframeIndex?: number
      requiredFrames?: number
      maxFrames: number
    }

export function planReaderWindowByTime(input: {
  sourceTimestampsMs: readonly number[]
  keyframeIndices: readonly number[]
  centerMs: number
  beforeMs: number
  afterMs: number
  maxFrames: number
}): ReaderWindowPlan {
  const maxFrames = Math.max(1, Math.floor(input.maxFrames))
  if (input.sourceTimestampsMs.length === 0) {
    return { ok: false, code: 'EMPTY_TIMELINE', targetIndex: 0, maxFrames }
  }

  const centerMs = finiteNonNegative(input.centerMs)
  const desiredStartMs = Math.max(0, centerMs - finiteNonNegative(input.beforeMs))
  const desiredEndMs = centerMs + finiteNonNegative(input.afterMs)
  const targetIndex = findSourceFrameAtTime(input.sourceTimestampsMs, centerMs)
  const desiredStartIndex = findSourceFrameAtTime(input.sourceTimestampsMs, desiredStartMs)

  const validKeyframes = input.keyframeIndices
    .filter((index) => Number.isInteger(index) && index >= 0 && index < input.sourceTimestampsMs.length)
    .sort((a, b) => a - b)
  const targetKeyframeIndex = keyframeAtOrBefore(validKeyframes, targetIndex)
  if (targetKeyframeIndex === null) {
    return { ok: false, code: 'NO_KEYFRAME_BEFORE_TARGET', targetIndex, maxFrames }
  }

  const requiredFrames = targetIndex - targetKeyframeIndex + 1
  if (requiredFrames > maxFrames) {
    return {
      ok: false,
      code: 'GOP_EXCEEDS_WINDOW_CAPACITY',
      targetIndex,
      keyframeIndex: targetKeyframeIndex,
      requiredFrames,
      maxFrames
    }
  }

  const desiredKeyframeIndex = keyframeAtOrBefore(validKeyframes, desiredStartIndex)
  const canKeepDesiredHistory = desiredKeyframeIndex !== null
    && targetIndex - desiredKeyframeIndex + 1 <= maxFrames
  const startIndex = canKeepDesiredHistory ? desiredKeyframeIndex : targetKeyframeIndex
  const desiredEndIndexExclusive = upperBound(input.sourceTimestampsMs, desiredEndMs)
  const endIndexExclusive = Math.min(
    input.sourceTimestampsMs.length,
    startIndex + maxFrames,
    Math.max(targetIndex + 1, desiredEndIndexExclusive)
  )

  return { ok: true, startIndex, endIndexExclusive, targetIndex }
}

export function planReaderWindowByIndex(input: {
  totalFrames: number
  keyframeIndices: readonly number[]
  targetIndex: number
  requestedCount: number
  maxFrames: number
}): ReaderWindowPlan {
  const totalFrames = Math.max(0, Math.floor(input.totalFrames))
  const maxFrames = Math.max(1, Math.floor(input.maxFrames))
  if (totalFrames === 0) {
    return { ok: false, code: 'EMPTY_TIMELINE', targetIndex: 0, maxFrames }
  }

  const targetIndex = Math.max(0, Math.min(totalFrames - 1, Math.floor(input.targetIndex)))
  const validKeyframes = input.keyframeIndices
    .filter((index) => Number.isInteger(index) && index >= 0 && index < totalFrames)
    .sort((a, b) => a - b)
  const keyframeIndex = keyframeAtOrBefore(validKeyframes, targetIndex)
  if (keyframeIndex === null) {
    return { ok: false, code: 'NO_KEYFRAME_BEFORE_TARGET', targetIndex, maxFrames }
  }

  const requiredFrames = targetIndex - keyframeIndex + 1
  if (requiredFrames > maxFrames) {
    return {
      ok: false,
      code: 'GOP_EXCEEDS_WINDOW_CAPACITY',
      targetIndex,
      keyframeIndex,
      requiredFrames,
      maxFrames
    }
  }

  const requestedCount = Math.max(1, Math.floor(input.requestedCount))
  return {
    ok: true,
    startIndex: keyframeIndex,
    endIndexExclusive: Math.min(totalFrames, keyframeIndex + maxFrames, targetIndex + requestedCount),
    targetIndex
  }
}

function keyframeAtOrBefore(keyframes: readonly number[], targetIndex: number): number | null {
  let result: number | null = null
  for (const keyframe of keyframes) {
    if (keyframe > targetIndex) break
    result = keyframe
  }
  return result
}

function upperBound(values: readonly number[], target: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
