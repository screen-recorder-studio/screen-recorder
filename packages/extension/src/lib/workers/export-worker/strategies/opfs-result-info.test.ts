import { describe, expect, it } from 'vitest'
import { Mp4Strategy } from './mp4'
import { WebmStrategy } from './webm'

describe.each([
  ['MP4', () => new Mp4Strategy(), 'fallback.mp4'],
  ['WebM', () => new WebmStrategy(), 'fallback.webm']
] as const)('%s OPFS result validation', (_format, createStrategy, fallbackName) => {
  it('rejects when no output file handle exists', async () => {
    const strategy = createStrategy()

    await expect(strategy.getOpfsResultInfo({ opfsFileName: fallbackName }))
      .rejects.toThrow('OPFS_EXPORT_FILE_UNAVAILABLE')
  })

  it('rejects when the output file cannot be read', async () => {
    const strategy = createStrategy()
    Object.assign(strategy as object, {
      opfsFileHandle: { getFile: async () => { throw new Error('private filesystem detail') } }
    })

    await expect(strategy.getOpfsResultInfo({ opfsFileName: fallbackName }))
      .rejects.toThrow('OPFS_EXPORT_RESULT_UNREADABLE')
  })

  it('rejects an empty output instead of reporting false success', async () => {
    const strategy = createStrategy()
    Object.assign(strategy as object, {
      opfsFileHandle: { getFile: async () => ({ size: 0, name: fallbackName }) }
    })

    await expect(strategy.getOpfsResultInfo({ opfsFileName: fallbackName }))
      .rejects.toThrow('OPFS_EXPORT_EMPTY')
  })

  it('returns only a positive byte count and resolved file name', async () => {
    const strategy = createStrategy()
    Object.assign(strategy as object, {
      opfsFileHandle: { getFile: async () => ({ size: 128, name: 'actual-output.bin' }) }
    })

    await expect(strategy.getOpfsResultInfo({ opfsFileName: fallbackName })).resolves.toEqual({
      bytes: 128,
      fileName: 'actual-output.bin'
    })
  })
})
