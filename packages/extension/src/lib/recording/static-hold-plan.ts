export interface StaticHoldPlanInput {
  sourceFrameCount: number
  durationMs: number
}

export interface StaticHoldPlan {
  durationMs: number
  sampleDurationSeconds: number
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function createStaticHoldPlan(input: StaticHoldPlanInput): StaticHoldPlan | null {
  const sourceFrameCount = Math.floor(finiteNonNegative(input.sourceFrameCount))
  const durationMs = finiteNonNegative(input.durationMs)
  if (sourceFrameCount !== 1 || durationMs <= 0) return null

  return {
    durationMs,
    sampleDurationSeconds: durationMs / 1000
  }
}

export function clampStaticHoldPosition(positionMs: number, durationMs: number): number {
  const duration = finiteNonNegative(durationMs)
  return Math.min(duration, finiteNonNegative(positionMs))
}

export function advanceStaticHold(input: {
  positionMs: number
  elapsedMs: number
  durationMs: number
}): { positionMs: number; ended: boolean } {
  const durationMs = finiteNonNegative(input.durationMs)
  const positionMs = clampStaticHoldPosition(
    finiteNonNegative(input.positionMs) + finiteNonNegative(input.elapsedMs),
    durationMs
  )
  return { positionMs, ended: durationMs > 0 && positionMs >= durationMs }
}
