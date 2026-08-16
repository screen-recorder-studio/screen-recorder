import { describe, expect, it } from 'vitest'
import {
  SOAK_SCENARIOS,
  evaluateCutoverGaps,
  evaluateOwnershipPhase,
  evaluateProductionCleanup,
  theoreticalFrameBytes,
  type OwnershipSnapshot
} from './memory-soak-fixture'

function snapshot(overrides: Partial<OwnershipSnapshot> = {}): OwnershipSnapshot {
  return {
    aliveByLane: { main: 3, next: 3, hover: 0 },
    aliveBytesByLane: { main: 24_883_200, next: 24_883_200, hover: 0 },
    totalAlive: 6,
    totalAliveBytes: 49_766_400,
    peakAlive: 8,
    peakAliveByLane: { main: 3, next: 3, hover: 2 },
    allocated: 8,
    closed: 2,
    ...overrides
  }
}

describe('preview memory soak fixture', () => {
  it('keeps source and composite output dimensions explicit for retained-plan assertions', () => {
    expect(theoreticalFrameBytes(1920, 1080)).toBe(8_294_400)
    expect(theoreticalFrameBytes(3840, 2160)).toBe(33_177_600)
    expect(SOAK_SCENARIOS.map(item => [item.id, item.proxyWidth, item.proxyHeight])).toEqual([
      ['1080p-source', 640, 360],
      ['4k-source', 640, 360]
    ])
  })

  it('requires exact main/next ownership and zero live hover frames after hover render', () => {
    expect(evaluateOwnershipPhase(snapshot(), {
      expectedMain: 3,
      expectedNext: 3,
      requireHoverPeak: true
    })).toEqual({ pass: true, failures: [] })

    expect(evaluateOwnershipPhase(snapshot({
      aliveByLane: { main: 4, next: 3, hover: 1 },
      totalAlive: 8
    }), {
      expectedMain: 3,
      expectedNext: 3,
      requireHoverPeak: true
    }).failures).toEqual(['main', 'hover', 'accounting'])
  })

  it('puts a bounded release gate on every cutover gap', () => {
    expect(evaluateCutoverGaps([18, 42, 71], 250)).toEqual({
      pass: true,
      maxGapMs: 71,
      failures: []
    })
    expect(evaluateCutoverGaps([18, 310], 250)).toEqual({
      pass: false,
      maxGapMs: 310,
      failures: ['cutover-gap']
    })
  })

  it('keeps production cleanup as a real failure while retained frames remain', () => {
    expect(evaluateProductionCleanup(snapshot())).toEqual({
      pass: false,
      remainingFrames: 6,
      remainingBytes: 49_766_400
    })
    expect(evaluateProductionCleanup(snapshot({
      aliveByLane: { main: 0, next: 0, hover: 0 },
      aliveBytesByLane: { main: 0, next: 0, hover: 0 },
      totalAlive: 0,
      totalAliveBytes: 0,
      closed: 8
    })).pass).toBe(true)
  })
})
