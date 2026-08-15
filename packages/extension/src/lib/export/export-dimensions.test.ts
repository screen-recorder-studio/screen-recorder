import { describe, expect, it } from 'vitest'
import {
  buildExportDimensions,
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
