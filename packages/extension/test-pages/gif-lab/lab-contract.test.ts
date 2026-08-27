import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GIF_LAB_CASE_IDS,
  GIF_LAB_DEFAULT_CASE_ID,
  GIF_LAB_TARGET,
  createGifLabContract,
  getGifLabPhase,
  normalizeGifLabSeed,
  resolveGifLabCase,
  seededUnit
} from './lab-contract'

const labRuntimeSource = readFileSync(new URL('./gif-lab.ts', import.meta.url), 'utf8')

describe('GIF Lab contract', () => {
  it('offers one deterministic fixture for every vertical-slice risk', () => {
    expect(GIF_LAB_CASE_IDS).toEqual([
      'suite',
      'geometry',
      'static-hold',
      'cadence',
      'palette',
      'edit-motion',
      'lifecycle',
      'edm'
    ])
    expect(GIF_LAB_TARGET).toEqual({ width: 640, height: 360 })
    expect(GIF_LAB_TARGET.width % 2).toBe(0)
    expect(GIF_LAB_TARGET.height % 2).toBe(0)
  })

  it('falls back to the motion gate and exposes a machine-readable capture contract', () => {
    expect(GIF_LAB_DEFAULT_CASE_ID).toBe('cadence')
    expect(resolveGifLabCase('does-not-exist')).toMatchObject({
      id: 'cadence',
      motionExpectation: 'animated'
    })

    expect(createGifLabContract('cadence', 42)).toMatchObject({
      version: 1,
      caseId: 'cadence',
      seed: 42,
      ready: true,
      expectedRegion: { width: 640, height: 360 },
      expected: {
        recordingIntent: 'gif',
        recordingMode: 'area',
        exportFps: 10,
        repeat: 2,
        motion: {
          expectation: 'animated',
          fullFlowEligible: true,
          sampleIntervalMs: 1_000,
          minimumDistinctVisualKeys: 2
        }
      }
    })
  })

  it('makes static crop fixtures impossible to mistake for motion acceptance', () => {
    expect(createGifLabContract('geometry', 42).expected.motion).toEqual({
      expectation: 'static',
      fullFlowEligible: false,
      sampleIntervalMs: 1_000,
      minimumDistinctVisualKeys: 1
    })
    expect(createGifLabContract('suite', 42).expected.motion).toMatchObject({
      expectation: 'mixed',
      fullFlowEligible: false
    })
  })

  it('maps elapsed time to stable suite chapters and static-hold states', () => {
    const suite = resolveGifLabCase('suite')
    expect(getGifLabPhase(suite, 0).id).toBe('geometry')
    expect(getGifLabPhase(suite, 2_200).id).toBe('cadence')
    expect(getGifLabPhase(suite, 5_200).id).toBe('palette')
    expect(getGifLabPhase(suite, 7_200).id).toBe('edit-motion')
    expect(getGifLabPhase(suite, 10_200).id).toBe('edm')
    expect(getGifLabPhase(suite, 12_200).id).toBe('geometry')

    const hold = resolveGifLabCase('static-hold')
    expect(getGifLabPhase(hold, 0).id).toBe('intro')
    expect(getGifLabPhase(hold, 1_100).id).toBe('changed')
    expect(getGifLabPhase(hold, 9_900).id).toBe('hold')
  })

  it('uses a stable seeded value without ambient randomness', () => {
    expect(normalizeGifLabSeed(null)).toBe(20260824)
    expect(normalizeGifLabSeed('')).toBe(20260824)
    expect(normalizeGifLabSeed('42')).toBe(42)
    expect(normalizeGifLabSeed(7)).toBe(7)

    const first = Array.from({ length: 8 }, (_, index) => seededUnit(20260824, index))
    const second = Array.from({ length: 8 }, (_, index) => seededUnit(20260824, index))
    expect(first).toEqual(second)
    expect(new Set(first).size).toBeGreaterThan(4)
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true)
    expect(seededUnit(20260825, 0)).not.toBe(first[0])
  })

  it('refreshes viewport-dependent region coordinates after resize or browser zoom', () => {
    expect(labRuntimeSource).toContain("addEventListener('resize', scheduleFixtureMetadataRefresh)")
    expect(labRuntimeSource).toContain('target.getBoundingClientRect()')
  })
})
