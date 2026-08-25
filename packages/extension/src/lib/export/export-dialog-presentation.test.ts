import { describe, expect, it } from 'vitest'
import { resolveExportDialogHeading } from './export-dialog-presentation'

describe('export dialog presentation', () => {
  it('names a GIF export as GIF rather than video', () => {
    expect(resolveExportDialogHeading('gif')).toEqual({
      key: 'export_dialog_gif_title',
      fallback: 'Export GIF'
    })
  })

  it.each(['mp4', 'webm'] as const)('uses the video heading for %s', (format) => {
    expect(resolveExportDialogHeading(format)).toEqual({
      key: 'export_dialog_title',
      fallback: 'Export Video'
    })
  })
})
