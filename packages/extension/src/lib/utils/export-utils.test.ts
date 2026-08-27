import { describe, expect, it } from 'vitest'
import { convertBackgroundConfigForExport, extractSourceInfo } from './export-utils'

describe('extractSourceInfo', () => {
  const singleFrame = [{
    data: new Uint8Array([1]),
    size: 1,
    codedWidth: 1920,
    codedHeight: 1080,
    codec: 'vp9'
  }]

  it('uses the canonical recording duration for a held static frame', () => {
    expect(extractSourceInfo(singleFrame, 1, 30, 25_223).duration).toBe(25.223)
  })

  it('keeps the frame-count fallback for callers without canonical timing', () => {
    expect(extractSourceInfo(singleFrame, 1, 30).duration).toBeCloseTo(1 / 30)
  })
})

describe('convertBackgroundConfigForExport', () => {
  const cropStore = { getCropConfig: () => undefined } as never

  it('preserves original-frame mode for the worker boundary', () => {
    expect(convertBackgroundConfigForExport({
      enabled: false,
      type: 'solid-color',
      color: '#000000',
      padding: 0,
      outputRatio: '16:9',
      videoPosition: 'center'
    }, cropStore)).toMatchObject({ enabled: false })
  })

  it('keeps older styled configurations enabled by default', () => {
    expect(convertBackgroundConfigForExport({
      type: 'solid-color',
      color: '#000000',
      padding: 0,
      outputRatio: '16:9',
      videoPosition: 'center'
    }, cropStore)).toMatchObject({ enabled: true })
  })
})
