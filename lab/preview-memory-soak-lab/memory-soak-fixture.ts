export type FrameLane = 'main' | 'next' | 'hover'

export interface SoakScenario {
  id: '1080p-source' | '4k-source'
  label: string
  sourceWidth: number
  sourceHeight: number
  proxyWidth: number
  proxyHeight: number
  frameRate: number
  totalFrames: number
  windowFrames: number
  soakMs: number
  cutoverGapBudgetMs: number
}

export interface OwnershipSnapshot {
  aliveByLane: Record<FrameLane, number>
  aliveBytesByLane: Record<FrameLane, number>
  totalAlive: number
  totalAliveBytes: number
  peakAlive: number
  peakAliveByLane: Record<FrameLane, number>
  allocated: number
  closed: number
  peakAliveBytes?: number
  decodeQueuePeakByKind?: { main: number; hover: number }
  publishedDecodeQueueHighWatermark?: number
  publishedPreviewPlan?: {
    previewWidth: number
    previewHeight: number
    usesProxy: boolean
    memoryTier?: string
  } | null
}

export const SOAK_SCENARIOS: readonly SoakScenario[] = [
  {
    id: '1080p-source',
    label: '1080p source · bounded preview → 640×360 output',
    sourceWidth: 1920,
    sourceHeight: 1080,
    proxyWidth: 640,
    proxyHeight: 360,
    frameRate: 4,
    totalFrames: 27,
    windowFrames: 3,
    soakMs: 9_000,
    cutoverGapBudgetMs: 250
  },
  {
    id: '4k-source',
    label: '4K source · bounded proxy → 640×360 output',
    sourceWidth: 3840,
    sourceHeight: 2160,
    proxyWidth: 640,
    proxyHeight: 360,
    frameRate: 4,
    totalFrames: 27,
    windowFrames: 3,
    soakMs: 9_000,
    cutoverGapBudgetMs: 250
  }
]

export function theoreticalFrameBytes(width: number, height: number): number {
  return Math.max(0, Math.floor(width)) * Math.max(0, Math.floor(height)) * 4
}

export function evaluateOwnershipPhase(
  snapshot: OwnershipSnapshot,
  expected: { expectedMain: number; expectedNext: number; requireHoverPeak?: boolean }
) {
  const failures: Array<'main' | 'next' | 'hover' | 'hover-never-owned' | 'accounting'> = []
  if (snapshot.aliveByLane.main !== expected.expectedMain) failures.push('main')
  if (snapshot.aliveByLane.next !== expected.expectedNext) failures.push('next')
  if (snapshot.aliveByLane.hover !== 0) failures.push('hover')
  if (expected.requireHoverPeak && snapshot.peakAliveByLane.hover < 1) failures.push('hover-never-owned')
  if (snapshot.totalAlive !== snapshot.allocated - snapshot.closed) failures.push('accounting')
  return { pass: failures.length === 0, failures }
}

export function evaluateCutoverGaps(gaps: number[], maxAllowedMs: number) {
  const maxGapMs = gaps.length > 0 ? Math.max(...gaps) : Number.POSITIVE_INFINITY
  const failures: Array<'cutover-gap'> = []
  if (!Number.isFinite(maxGapMs) || maxGapMs > maxAllowedMs) failures.push('cutover-gap')
  return { pass: failures.length === 0, maxGapMs, failures }
}

export function evaluateProductionCleanup(snapshot: OwnershipSnapshot) {
  return {
    pass: snapshot.totalAlive === 0 && snapshot.totalAliveBytes === 0,
    remainingFrames: snapshot.totalAlive,
    remainingBytes: snapshot.totalAliveBytes
  }
}
