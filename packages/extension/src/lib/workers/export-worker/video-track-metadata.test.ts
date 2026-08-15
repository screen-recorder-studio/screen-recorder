import { describe, expect, it, vi } from 'vitest'
import { addVideoTrackWithTiming } from './video-track-metadata'

describe('addVideoTrackWithTiming', () => {
  it('declares the output frame rate so WebM can recover the final sample duration', () => {
    const output = { addVideoTrack: vi.fn() }
    const source = { codec: 'vp9' }

    addVideoTrackWithTiming(output, source, 10)

    expect(output.addVideoTrack).toHaveBeenCalledWith(source, { frameRate: 10 })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid frame rate (%s)',
    frameRate => {
      expect(() => addVideoTrackWithTiming({ addVideoTrack: vi.fn() }, {}, frameRate)).toThrow(
        'frameRate must be a positive finite number'
      )
    }
  )
})
