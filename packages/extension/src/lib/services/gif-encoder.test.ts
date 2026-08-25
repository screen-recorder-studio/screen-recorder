import { afterEach, describe, expect, it, vi } from 'vitest'
import { GifEncoder } from './gif-encoder'

describe('GifEncoder frame ownership', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('passes ImageData directly to gif.js without a temporary DOM canvas copy', async () => {
    const addFrame = vi.fn()
    class FakeGif {
      addFrame = addFrame
      on() {}
      abort() {}
      render() {}
    }
    vi.stubGlobal('window', { GIF: FakeGif })
    const imageData = { width: 10, height: 10, data: new Uint8ClampedArray(400) } as ImageData
    const encoder = new GifEncoder({ width: 10, height: 10 })

    await encoder.initialize()
    encoder.addFrame(imageData, 100, 2)

    expect(addFrame).toHaveBeenCalledWith(imageData, {
      delay: 100,
      dispose: 2,
      copy: false
    })
  })
})
