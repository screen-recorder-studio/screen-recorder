import { describe, expect, it } from 'vitest'
import { calculatePreviewSize } from './preview-size'

describe('calculatePreviewSize', () => {
  it('returns one stable bounded size when the timeline leaves less than the old minimum', () => {
    const input = {
      displayWidth: 960,
      displayHeight: 450,
      outputWidth: 1920,
      outputHeight: 1080,
      showControls: true,
      showTimeline: true,
      hasFrames: true
    }

    const first = calculatePreviewSize(input)

    expect(first).toEqual({ width: 288, height: 162 })
    expect(calculatePreviewSize(input)).toEqual(first)
  })

  it('uses the available canvas area while preserving the output aspect ratio', () => {
    expect(calculatePreviewSize({
      displayWidth: 1280,
      displayHeight: 900,
      outputWidth: 1920,
      outputHeight: 1080,
      showControls: true,
      showTimeline: true,
      hasFrames: true
    })).toEqual({ width: 1088, height: 612 })
  })

  it('supports portrait output and never returns negative or non-finite dimensions', () => {
    expect(calculatePreviewSize({
      displayWidth: 400,
      displayHeight: 900,
      outputWidth: 1080,
      outputHeight: 1920,
      showControls: false,
      showTimeline: false,
      hasFrames: true
    })).toEqual({ width: 400, height: 711 })

    expect(calculatePreviewSize({
      displayWidth: 200,
      displayHeight: 100,
      outputWidth: 1920,
      outputHeight: 1080,
      showControls: true,
      showTimeline: true,
      hasFrames: true
    })).toEqual({ width: 0, height: 0 })
  })
})
