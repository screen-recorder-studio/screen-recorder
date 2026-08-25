import { describe, expect, it } from 'vitest'
import { mapAreaSelectionToSourceFrame } from './area-crop'

describe('area capture crop mapping', () => {
  it('maps through the centered content box when the captured frame is letterboxed', () => {
    expect(mapAreaSelectionToSourceFrame({
      rectCss: { x: 100, y: 50, width: 300, height: 200 },
      viewportCss: { width: 1_000, height: 500 },
      sourceFrame: { width: 1_920, height: 1_080 }
    })).toEqual({ x: 192, y: 156, width: 576, height: 384 })
  })

  it('maps through the centered content box when the captured frame is pillarboxed', () => {
    expect(mapAreaSelectionToSourceFrame({
      rectCss: { x: 100, y: 100, width: 300, height: 200 },
      viewportCss: { width: 1_000, height: 1_000 },
      sourceFrame: { width: 1_920, height: 1_080 }
    })).toEqual({ x: 528, y: 108, width: 324, height: 216 })
  })

  it('keeps the GIF Lab target inside its exact CSS selection at 16:9 capture output', () => {
    expect(mapAreaSelectionToSourceFrame({
      rectCss: { x: 720, y: 374.6875, width: 640, height: 360 },
      viewportCss: { width: 2_560, height: 1_203 },
      sourceFrame: { width: 1_920, height: 1_080 }
    })).toEqual({ x: 540, y: 370, width: 480, height: 268 })
  })

  it('shrinks to even pixel boundaries without exposing pixels outside the selection', () => {
    const crop = mapAreaSelectionToSourceFrame({
      rectCss: { x: 10.2, y: 20.2, width: 100.2, height: 80.2 },
      viewportCss: { width: 500, height: 500 },
      sourceFrame: { width: 1_000, height: 1_000 }
    })

    expect(crop).toEqual({ x: 22, y: 42, width: 198, height: 158 })
    expect(crop.x).toBeGreaterThanOrEqual(Math.ceil(10.2 * 2))
    expect(crop.x + crop.width).toBeLessThanOrEqual(Math.floor(110.4 * 2))
  })

  it('rejects stale, invalid, or too-small selections', () => {
    expect(() => mapAreaSelectionToSourceFrame({
      rectCss: { x: 499, y: 499, width: 1, height: 1 },
      viewportCss: { width: 500, height: 500 },
      sourceFrame: { width: 1_000, height: 1_000 }
    })).toThrowError('AREA_SELECTION_TOO_SMALL')
    expect(() => mapAreaSelectionToSourceFrame({
      rectCss: { x: 0, y: 0, width: 100, height: 100 },
      viewportCss: { width: 0, height: 500 },
      sourceFrame: { width: 1_000, height: 1_000 }
    })).toThrowError('AREA_SELECTION_INVALID')
  })
})
