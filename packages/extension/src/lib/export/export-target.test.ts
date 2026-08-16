import { describe, expect, it } from 'vitest'
import { withOpfsExportTarget } from './export-target'

describe('withOpfsExportTarget', () => {
  it.each(['mp4', 'webm'] as const)('enables OPFS streaming for %s when a recording directory exists', (format) => {
    const result = withOpfsExportTarget(
      { format, bitrate: 8_000_000 },
      format,
      'rec-private-id',
      () => '2026-08-01T12-00-00-000Z'
    )

    expect(result).toMatchObject({
      format,
      saveToOpfs: true,
      opfsFileName: `edited-video-2026-08-01T12-00-00-000Z.${format}`
    })
  })

  it('does not add streaming fields without an OPFS directory', () => {
    expect(withOpfsExportTarget({ format: 'mp4' }, 'mp4', '')).toEqual({ format: 'mp4' })
  })
})
