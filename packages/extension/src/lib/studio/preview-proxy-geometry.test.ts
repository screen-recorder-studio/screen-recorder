import { describe, expect, it } from 'vitest'
import {
  mapSourceCropToPreview,
  resolveFocusWithinSourceCrop
} from './preview-proxy-geometry'

describe('preview proxy geometry', () => {
  it('maps a source-pixel crop onto a downscaled preview frame', () => {
    expect(mapSourceCropToPreview({
      sourceWidth: 3840,
      sourceHeight: 2160,
      previewWidth: 960,
      previewHeight: 540,
      crop: { x: 960, y: 540, width: 1920, height: 1080 }
    })).toEqual({ x: 240, y: 135, width: 480, height: 270 })
  })

  it('clamps malformed source crops before mapping them', () => {
    expect(mapSourceCropToPreview({
      sourceWidth: 1920,
      sourceHeight: 1080,
      previewWidth: 1280,
      previewHeight: 720,
      crop: { x: -20, y: 900, width: 2200, height: 400 }
    })).toEqual({ x: 0, y: 600, width: 1280, height: 120 })
  })

  it('keeps a source-space focus stable inside the same crop', () => {
    expect(resolveFocusWithinSourceCrop({
      focusX: 0.75,
      focusY: 0.5,
      sourceWidth: 3840,
      sourceHeight: 2160,
      crop: { x: 960, y: 540, width: 1920, height: 1080 }
    })).toEqual({ x: 1, y: 0.5 })
  })

  it('uses canonical display geometry and preserves a one-pixel edge crop', () => {
    // The encoded buffer may be 1920x1088, but Canvas drawImage addresses the
    // VideoFrame display space (1920x1080).
    expect(mapSourceCropToPreview({
      sourceWidth: 1920,
      sourceHeight: 1080,
      previewWidth: 960,
      previewHeight: 540,
      crop: { x: 0, y: 1079, width: 1920, height: 1 }
    })).toEqual({ x: 0, y: 539, width: 960, height: 1 })
  })

  it('falls back to the full source rectangle for an empty crop', () => {
    expect(mapSourceCropToPreview({
      sourceWidth: 1920,
      sourceHeight: 1080,
      previewWidth: 960,
      previewHeight: 540,
      crop: { x: 2000, y: 0, width: 0, height: 0 }
    })).toEqual({ x: 0, y: 0, width: 960, height: 540 })
  })
})
