import { describe, expect, it } from 'vitest'
import { inspectGifBytes } from './gif-artifact-inspector'

function twoFrameGif(options: { padding?: number[]; repeat?: number } = {}): Uint8Array {
  const repeat = options.repeat ?? 2
  return new Uint8Array([
    // Header + 2x1 logical screen + two-entry global color table.
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    0x02, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
    // NETSCAPE2.0 loop extension.
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, repeat & 0xff, (repeat >> 8) & 0xff, 0x00,
    // Frame 1, 10 centiseconds.
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x00,
    0x02, 0x02, 0x44, 0x01, 0x00,
    // Frame 2, 20 centiseconds.
    0x21, 0xf9, 0x04, 0x00, 0x14, 0x00, 0x00, 0x00,
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x00,
    0x02, 0x02, 0x44, 0x01, 0x00,
    0x3b,
    ...(options.padding ?? [])
  ])
}

describe('GIF artifact inspector', () => {
  it('reports the delivery-critical GIF89a fields', () => {
    expect(inspectGifBytes(twoFrameGif())).toEqual({
      version: 'GIF89a',
      width: 2,
      height: 1,
      frameCount: 2,
      frameDelaysCentiseconds: [10, 20],
      totalDelayCentiseconds: 30,
      repeat: 2,
      logicalLength: twoFrameGif().length,
      physicalLength: twoFrameGif().length,
      trailingPaddingBytes: 0
    })
  })

  it('accepts only zero page padding after the logical trailer', () => {
    const padded = twoFrameGif({ padding: [0, 0, 0] })
    expect(inspectGifBytes(padded)).toMatchObject({
      logicalLength: padded.length - 3,
      physicalLength: padded.length,
      trailingPaddingBytes: 3
    })

    expect(() => inspectGifBytes(twoFrameGif({ padding: [0, 1] })))
      .toThrowError('GIF_TRAILING_DATA_INVALID')
  })

  it('fails closed on malformed or truncated GIF data', () => {
    expect(() => inspectGifBytes(new Uint8Array([1, 2, 3])))
      .toThrowError('GIF_SIGNATURE_INVALID')

    const truncated = twoFrameGif().subarray(0, twoFrameGif().length - 2)
    expect(() => inspectGifBytes(truncated)).toThrowError(/GIF_/)
  })
})
