import { describe, expect, it } from 'vitest'
import {
  buildExportDimensions,
  hasCompositionSizeChanged,
  resolveCompositionSize,
  resolveExportDialogSourceInfo
} from './export-dimensions'

describe('resolveCompositionSize', () => {
  it.each([
    ['16:9', 1920, 1080],
    ['1:1', 1080, 1080],
    ['9:16', 1080, 1920],
    ['4:5', 1080, 1350]
  ] as const)('maps %s to the same canvas size used by Studio', (outputRatio, width, height) => {
    expect(resolveCompositionSize({ outputRatio })).toEqual({ width, height })
  })

  it('uses a valid custom canvas size and falls back for invalid values', () => {
    expect(resolveCompositionSize({ outputRatio: 'custom', customWidth: 1440, customHeight: 900 }))
      .toEqual({ width: 1440, height: 900 })
    expect(resolveCompositionSize({ outputRatio: 'custom', customWidth: 0, customHeight: Number.NaN }))
      .toEqual({ width: 1920, height: 1080 })
  })

  it('uses the recording dimensions when decorative background is disabled', () => {
    expect(resolveCompositionSize(
      { enabled: false, outputRatio: '16:9' },
      { width: 640, height: 360 }
    )).toEqual({ width: 640, height: 360 })
  })

  it('uses the effective crop dimensions in original-frame mode', () => {
    expect(resolveCompositionSize({
      enabled: false,
      outputRatio: '16:9',
      videoCrop: {
        enabled: true,
        mode: 'percentage',
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        xPercent: 0.25,
        yPercent: 0.25,
        widthPercent: 0.5,
        heightPercent: 0.5
      }
    }, { width: 640, height: 360 })).toEqual({ width: 320, height: 180 })
  })

  it('honors an explicit export size even in original-frame mode', () => {
    expect(resolveCompositionSize({
      enabled: false,
      outputRatio: 'custom',
      customWidth: 600,
      customHeight: 338
    }, { width: 640, height: 360 })).toEqual({ width: 600, height: 338 })
  })
})

describe('hasCompositionSizeChanged', () => {
  const source = { width: 1706, height: 958 }

  it('requires a canvas rebuild when switching between styled and original-frame modes', () => {
    expect(hasCompositionSizeChanged(
      { enabled: true, outputRatio: '16:9' },
      { enabled: false, outputRatio: '16:9' },
      source
    )).toBe(true)
    expect(hasCompositionSizeChanged(
      { enabled: false, outputRatio: '16:9' },
      { enabled: true, outputRatio: '16:9' },
      source
    )).toBe(true)
  })

  it('does not rebuild the canvas for a same-size background style change', () => {
    expect(hasCompositionSizeChanged(
      { enabled: true, outputRatio: '16:9' },
      { enabled: true, outputRatio: '16:9' },
      source
    )).toBe(false)
  })
})

describe('resolveExportDialogSourceInfo', () => {
  it('shows the current composition instead of the Retina capture size', () => {
    expect(resolveExportDialogSourceInfo(
      { width: 4632, height: 2406, frameCount: 3, codec: 'vp09', duration: 23.77, estimatedSize: 42 },
      { width: 1920, height: 1080 }
    )).toEqual({
      width: 1920,
      height: 1080,
      frameCount: 3,
      codec: 'vp09',
      duration: 23.77,
      estimatedSize: 42
    })
  })
})

describe('buildExportDimensions', () => {
  it.each(['mp4', 'webm'] as const)('wires a selected size into the %s worker request', (format) => {
    expect(buildExportDimensions(
      { type: 'gradient', outputRatio: '16:9', padding: 60 },
      { width: 1280, height: 720 }
    )).toEqual({
      resolution: { width: 1280, height: 720 },
      backgroundConfig: {
        type: 'gradient',
        outputRatio: 'custom',
        customWidth: 1280,
        customHeight: 720,
        padding: 60
      }
    })
  })
})
