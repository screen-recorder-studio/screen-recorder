import { describe, expect, it } from 'vitest'
import {
  hasUsableExportTimeline,
  hasTimeVaryingEditEffects,
  rebaseZoomForTrim,
  toTrimmedPresentationTimeMs
} from './edit-export-parity'

describe('edit/export parity', () => {
  it('rebases zoom intervals without clamping away an in-progress transition', () => {
    const backgroundConfig = {
      type: 'gradient',
      videoZoom: {
        enabled: true,
        scale: 1.5,
        transitionDurationMs: 300,
        focusX: 0.25,
        intervals: [{
          startMs: 9_000,
          endMs: 10_000,
          scale: 2,
          focusX: 0.75,
          focusY: 0.4,
          focusSpace: 'source',
          mode: 'anchor',
          easing: 'linear',
          transitionDurationMs: 300,
          syncBackground: true,
          futureField: 'preserved'
        }]
      }
    }

    const rebased = rebaseZoomForTrim(backgroundConfig, {
      enabled: true,
      startMs: 8_800,
      endMs: 9_600
    })

    expect(rebased).not.toBe(backgroundConfig)
    expect(rebased.videoZoom).not.toBe(backgroundConfig.videoZoom)
    expect(rebased.videoZoom.intervals).toEqual([{
      startMs: 200,
      endMs: 1_200,
      scale: 2,
      focusX: 0.75,
      focusY: 0.4,
      focusSpace: 'source',
      mode: 'anchor',
      easing: 'linear',
      transitionDurationMs: 300,
      syncBackground: true,
      futureField: 'preserved'
    }])
    expect(rebased.videoZoom.focusX).toBe(0.25)
    expect(rebased.type).toBe('gradient')
    expect(backgroundConfig.videoZoom.intervals[0].startMs).toBe(9_000)
  })

  it('keeps intervals whose transition overlaps the trim and drops fully invisible intervals', () => {
    const rebased = rebaseZoomForTrim({
      videoZoom: {
        enabled: true,
        transitionDurationMs: 300,
        intervals: [
          { startMs: 1_000, endMs: 2_000, id: 'before-but-fading' },
          { startMs: 2_500, endMs: 3_000, transitionDurationMs: 100, id: 'inside' },
          { startMs: 4_500, endMs: 5_000, id: 'after' }
        ]
      }
    }, {
      enabled: true,
      startMs: 2_200,
      endMs: 4_000
    })

    expect(rebased.videoZoom.intervals).toEqual([
      { startMs: -1_200, endMs: -200, id: 'before-but-fading' },
      { startMs: 300, endMs: 800, transitionDurationMs: 100, id: 'inside' }
    ])
    expect(rebased.videoZoom.enabled).toBe(true)
  })

  it('disables zoom after trim only when no core or transition can affect the export', () => {
    const rebased = rebaseZoomForTrim({
      videoZoom: {
        enabled: true,
        transitionDurationMs: 200,
        intervals: [{ startMs: 0, endMs: 1_000 }]
      }
    }, {
      enabled: true,
      startMs: 2_000,
      endMs: 3_000
    })

    expect(rebased.videoZoom.intervals).toEqual([])
    expect(rebased.videoZoom.enabled).toBe(false)
  })

  it('leaves identity unchanged without an enabled trim', () => {
    const config = {
      videoZoom: { enabled: true, intervals: [{ startMs: 10, endMs: 20 }] }
    }

    expect(rebaseZoomForTrim(config)).toBe(config)
    expect(rebaseZoomForTrim(config, { enabled: false, startMs: 5, endMs: 15 })).toBe(config)
  })

  it('recognizes enabled zoom as a time-varying edit effect', () => {
    expect(hasTimeVaryingEditEffects({
      videoZoom: { enabled: true, intervals: [{ startMs: -100, endMs: 900 }] }
    })).toBe(true)
    expect(hasTimeVaryingEditEffects({
      videoZoom: { enabled: false, intervals: [{ startMs: 0, endMs: 900 }] }
    })).toBe(false)
    expect(hasTimeVaryingEditEffects({
      videoZoom: { enabled: true, intervals: [] }
    })).toBe(false)
    expect(hasTimeVaryingEditEffects({ videoCrop: { enabled: true } })).toBe(false)
  })

  it('maps source time to output-relative presentation time', () => {
    expect(toTrimmedPresentationTimeMs(9_500, 9_100)).toBe(400)
    expect(toTrimmedPresentationTimeMs(8_900, 9_100)).toBe(0)
    expect(toTrimmedPresentationTimeMs(Number.NaN, 9_100)).toBe(0)
  })

  it('accepts a normalized legacy timeline for trim export instead of ignoring the slice', () => {
    expect(hasUsableExportTimeline({
      version: 1,
      durationMs: 3_000,
      sampleTimestampsMs: [0, 1_000, 2_000]
    }, 3)).toBe(true)
    expect(hasUsableExportTimeline({
      version: 1,
      durationMs: 3_000,
      sampleTimestampsMs: [0, 2_000, 1_000]
    }, 3)).toBe(false)
    expect(hasUsableExportTimeline({
      version: 2,
      durationMs: 3_000,
      sampleTimestampsMs: [0, 1_000]
    }, 3)).toBe(false)
  })
})
