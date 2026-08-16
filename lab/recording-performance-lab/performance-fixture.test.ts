import { describe, expect, it } from 'vitest'
import {
  PERFORMANCE_SCENARIOS,
  estimateDecodedFrameBufferBytes,
  evaluatePerformanceRun,
  projectExportMinutes
} from './performance-fixture'

describe('recording performance lab fixture', () => {
  it('keeps the default matrix bounded and makes 4K an explicit stress case', () => {
    expect(PERFORMANCE_SCENARIOS.map(item => [item.id, item.runByDefault])).toEqual([
      ['low-end-proxy', true],
      ['standard', true],
      ['4k-balanced', true],
      ['4k-stress', false]
    ])
  })

  it('exposes the current preview fallback memory risk', () => {
    expect(estimateDecodedFrameBufferBytes(1920, 1080, 140, 120, 140)).toBe(3_317_760_000)
    expect(estimateDecodedFrameBufferBytes(3840, 2160, 140, 120, 140)).toBe(13_271_040_000)
  })

  it('projects the reported 60 minute / four day export as a 96x real-time factor', () => {
    expect(projectExportMinutes(60, 96)).toBe(5_760)
  })

  it('requires every release stage to meet its own budget', () => {
    const scenario = PERFORMANCE_SCENARIOS[0]
    expect(evaluatePerformanceRun(scenario, {
      captureRtf: 0.7,
      previewP95Ms: 35,
      exportRtf: 1.4,
      droppedFrames: 0,
      frameCount: 48
    }).pass).toBe(true)

    const failed = evaluatePerformanceRun(scenario, {
      captureRtf: 0.7,
      previewP95Ms: 70,
      exportRtf: 2.6,
      droppedFrames: 3,
      frameCount: 48
    })
    expect(failed.pass).toBe(false)
    expect(failed.failures).toEqual(['preview', 'export', 'drops'])
  })
})
