import { describe, expect, it } from 'vitest'
import { assertGifExportWithinMemoryBudget, validateGifBlob } from './gif-export-preflight'

describe('GIF export preflight and output validation', () => {
  it('accepts an email-sized frame plan and rejects a retained-frame memory spike', () => {
    expect(assertGifExportWithinMemoryBudget({ width: 600, height: 338, frameCount: 60 }))
      .toMatchObject({ estimatedRawBytes: 48_672_000 })

    expect(() => assertGifExportWithinMemoryBudget({
      width: 1_920,
      height: 1_080,
      frameCount: 120
    })).toThrowError('GIF_MEMORY_BUDGET_EXCEEDED')
  })

  it('validates the GIF signature and trailer instead of trusting a non-empty Blob', async () => {
    const valid = new Blob([
      new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x3b])
    ], { type: 'image/gif' })
    await expect(validateGifBlob(valid)).resolves.toBe(valid)

    await expect(validateGifBlob(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/gif' })))
      .rejects.toThrow('GIF_OUTPUT_INVALID')
  })

  it('removes gif.js zero-page padding after the GIF trailer', async () => {
    const padded = new Blob([
      new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
        0x01, 0x00, 0x01, 0x00,
        0x3b,
        0x00, 0x00, 0x00
      ])
    ], { type: 'image/gif' })

    const normalized = await validateGifBlob(padded)
    expect(normalized).not.toBe(padded)
    expect(normalized.type).toBe('image/gif')
    expect(Array.from(new Uint8Array(await normalized.arrayBuffer())))
      .toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x3b])
  })

  it('rejects non-padding bytes after the logical GIF trailer', async () => {
    const malformed = new Blob([
      new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
        0x01, 0x00, 0x01, 0x00,
        0x3b, 0x01
      ])
    ], { type: 'image/gif' })

    await expect(validateGifBlob(malformed)).rejects.toThrow('GIF_OUTPUT_INVALID')
  })
})
