import { describe, expect, it } from 'vitest'
import { createExportFilename, withOpfsExportTarget } from './export-target'

describe('createExportFilename', () => {
  it('uses a GIF-specific, user-facing filename for GIF delivery', () => {
    expect(createExportFilename('gif', () => '2026-08-01T12-00-00-000Z')).toBe(
      'screen-recording-gif-2026-08-01T12-00-00-000Z.gif'
    )
  })

  it.each(['mp4', 'webm'] as const)('keeps the edited-video filename for %s', (format) => {
    expect(createExportFilename(format, () => '2026-08-01T12-00-00-000Z')).toBe(
      `edited-video-2026-08-01T12-00-00-000Z.${format}`
    )
  })
})

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
