export type ExportDialogFormat = 'mp4' | 'webm' | 'gif'

export function resolveExportDialogHeading(format: ExportDialogFormat) {
  return format === 'gif'
    ? { key: 'export_dialog_gif_title', fallback: 'Export GIF' }
    : { key: 'export_dialog_title', fallback: 'Export Video' }
}
