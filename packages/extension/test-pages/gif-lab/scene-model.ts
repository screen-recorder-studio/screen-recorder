import {
  GIF_LAB_TARGET,
  getGifLabPhase,
  resolveGifLabCase,
  seededUnit,
  type GifLabCaseId
} from './lab-contract'

const VISUAL_FRAME_MS = 100
const ANIMATED_PHASES = new Set(['cadence', 'edit-motion', 'edm'])

export interface GifLabSceneSnapshot {
  caseId: GifLabCaseId
  phaseId: string
  elapsedMs: number
  phaseElapsedMs: number
  frameNumber: number
  progress: number
  visualKey: string
  blinkOn: boolean
  barcode: string
  motion: { x: number; y: number }
  palette: string[]
}

export function createSceneSnapshot(caseId: unknown, seed: number, elapsedMs: number): GifLabSceneSnapshot {
  const definition = resolveGifLabCase(caseId)
  const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const cycleElapsed = definition.loop
    ? safeElapsed % definition.durationMs
    : Math.min(safeElapsed, definition.durationMs - Number.EPSILON)
  const phase = getGifLabPhase(definition, safeElapsed)
  const phaseElapsedMs = Math.max(0, cycleElapsed - phase.startMs)
  const progress = Math.min(1, phaseElapsedMs / Math.max(1, phase.durationMs))
  const animated = ANIMATED_PHASES.has(phase.id)
  const phaseIndex = Math.max(0, definition.phases.findIndex((candidate) => candidate.id === phase.id))
  const frameNumber = animated ? Math.floor(phaseElapsedMs / VISUAL_FRAME_MS) : phaseIndex
  const visualKey = animated
    ? `${definition.id}:${phase.id}:${frameNumber}`
    : `${definition.id}:${phase.id}`

  const horizontalProgress = phase.id === 'edit-motion'
    ? (1 - Math.cos(progress * Math.PI * 2)) / 2
    : progress
  const x = Math.round(32 + horizontalProgress * (GIF_LAB_TARGET.width - 64))
  const y = Math.round(32 + ((Math.sin(progress * Math.PI * 4) + 1) / 2) * (GIF_LAB_TARGET.height - 64))

  return {
    caseId: definition.id,
    phaseId: phase.id,
    elapsedMs: safeElapsed,
    phaseElapsedMs,
    frameNumber,
    progress,
    visualKey,
    blinkOn: frameNumber % 10 < 5,
    barcode: (frameNumber % 4_096).toString(2).padStart(12, '0'),
    motion: { x, y },
    palette: Array.from({ length: 48 }, (_, index) => {
      const hue = Math.round(seededUnit(seed, index) * 359)
      const saturation = 58 + Math.round(seededUnit(seed, index + 64) * 38)
      const lightness = 28 + Math.round(seededUnit(seed, index + 128) * 56)
      return `hsl(${hue} ${saturation}% ${lightness}%)`
    })
  }
}
