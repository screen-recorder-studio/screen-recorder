export const GIF_LAB_TARGET = Object.freeze({ width: 640, height: 360 })

export const GIF_LAB_CASE_IDS = [
  'suite',
  'geometry',
  'static-hold',
  'cadence',
  'palette',
  'edit-motion',
  'lifecycle',
  'edm'
] as const

export type GifLabCaseId = typeof GIF_LAB_CASE_IDS[number]
export type GifLabMotionExpectation = 'static' | 'animated' | 'mixed'

/**
 * The default is deliberately motion-bearing. Geometry remains available as a
 * static crop oracle, but must never be the implicit end-to-end GIF fixture.
 */
export const GIF_LAB_DEFAULT_CASE_ID: GifLabCaseId = 'cadence'
export const GIF_LAB_DEFAULT_SEED = 20260824

export interface GifLabPhase {
  id: string
  startMs: number
  durationMs: number
}

export interface GifLabCaseDefinition {
  id: GifLabCaseId
  label: string
  description: string
  motionExpectation: GifLabMotionExpectation
  durationMs: number
  loop: boolean
  phases: readonly GifLabPhase[]
}

const SINGLE_PHASE_DURATION_MS = 10_000

const CASES: Record<GifLabCaseId, GifLabCaseDefinition> = {
  suite: {
    id: 'suite',
    label: 'Full suite',
    description: 'Geometry, cadence, palette, edit motion, and EDM chapters in one deterministic loop.',
    motionExpectation: 'mixed',
    durationMs: 12_000,
    loop: true,
    phases: [
      { id: 'geometry', startMs: 0, durationMs: 2_000 },
      { id: 'cadence', startMs: 2_000, durationMs: 3_000 },
      { id: 'palette', startMs: 5_000, durationMs: 2_000 },
      { id: 'edit-motion', startMs: 7_000, durationMs: 3_000 },
      { id: 'edm', startMs: 10_000, durationMs: 2_000 }
    ]
  },
  geometry: singlePhaseCase('geometry', 'Geometry · static', 'Intentionally static pixel rulers, corner fiducials, and a fixed even-sized crop target.', 'static'),
  'static-hold': {
    id: 'static-hold',
    label: 'Static hold',
    description: 'Two visual changes followed by an eight-second unchanged hold.',
    motionExpectation: 'mixed',
    durationMs: 10_000,
    loop: false,
    phases: [
      { id: 'intro', startMs: 0, durationMs: 1_000 },
      { id: 'changed', startMs: 1_000, durationMs: 1_000 },
      { id: 'hold', startMs: 2_000, durationMs: 8_000 }
    ]
  },
  cadence: singlePhaseCase('cadence', 'Cadence · motion gate', 'The required full-flow gate: fixed-step counter, barcode, blink signal, and constant-speed motion.', 'animated'),
  palette: singlePhaseCase('palette', 'Palette stress · static', 'A static color-fidelity oracle with gradients, fine text, seeded colors, and high-frequency detail.', 'static'),
  'edit-motion': singlePhaseCase('edit-motion', 'Edit motion', 'A trackable subject for trim, crop, and animated zoom parity.', 'animated'),
  lifecycle: singlePhaseCase('lifecycle', 'Lifecycle · static', 'A static target for scroll, resize, cancel, and re-selection controls.', 'static'),
  edm: singlePhaseCase('edm', 'EDM card', 'A meaningful first frame and short marketing-motion loop at email width.', 'animated')
}

function singlePhaseCase(
  id: Exclude<GifLabCaseId, 'suite' | 'static-hold'>,
  label: string,
  description: string,
  motionExpectation: Exclude<GifLabMotionExpectation, 'mixed'>
): GifLabCaseDefinition {
  return {
    id,
    label,
    description,
    motionExpectation,
    durationMs: SINGLE_PHASE_DURATION_MS,
    loop: true,
    phases: [{ id, startMs: 0, durationMs: SINGLE_PHASE_DURATION_MS }]
  }
}

export function resolveGifLabCase(value: unknown): GifLabCaseDefinition {
  const id = typeof value === 'string' ? value : ''
  return Object.prototype.hasOwnProperty.call(CASES, id)
    ? CASES[id as GifLabCaseId]
    : CASES[GIF_LAB_DEFAULT_CASE_ID]
}

export function getGifLabPhase(definition: GifLabCaseDefinition, elapsedMs: number): GifLabPhase {
  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const localElapsed = definition.loop
    ? safeElapsed % definition.durationMs
    : Math.min(safeElapsed, Math.max(0, definition.durationMs - Number.EPSILON))

  return definition.phases.find((phase) => (
    localElapsed >= phase.startMs && localElapsed < phase.startMs + phase.durationMs
  )) ?? definition.phases[definition.phases.length - 1]
}

export function createGifLabContract(caseId: unknown, seed: number) {
  const definition = resolveGifLabCase(caseId)
  const normalizedSeed = normalizeGifLabSeed(seed)
  return {
    version: 1 as const,
    caseId: definition.id,
    seed: normalizedSeed,
    ready: true as const,
    expectedRegion: {
      selector: '[data-gif-lab-target]',
      width: GIF_LAB_TARGET.width,
      height: GIF_LAB_TARGET.height
    },
    timeline: {
      durationMs: definition.durationMs,
      loop: definition.loop,
      phases: definition.phases.map((phase) => ({ ...phase }))
    },
    expected: {
      recordingIntent: 'gif' as const,
      recordingMode: 'area' as const,
      exportFps: 10,
      repeat: 2,
      motion: {
        expectation: definition.motionExpectation,
        fullFlowEligible: definition.motionExpectation === 'animated',
        sampleIntervalMs: 1_000,
        minimumDistinctVisualKeys: definition.motionExpectation === 'static' ? 1 : 2
      }
    }
  }
}

export function normalizeGifLabSeed(value: unknown): number {
  if (value === null || value === undefined || value === '') return GIF_LAB_DEFAULT_SEED
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) ? parsed : GIF_LAB_DEFAULT_SEED
}

/** A deterministic pseudo-random unit value for visual fixtures. */
export function seededUnit(seed: number, index: number): number {
  let value = ((seed | 0) ^ Math.imul((index | 0) + 1, 0x9e3779b1)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d)
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b)
  value ^= value >>> 16
  return (value >>> 0) / 0x1_0000_0000
}

export function listGifLabCases(): GifLabCaseDefinition[] {
  return GIF_LAB_CASE_IDS.map((id) => CASES[id])
}
