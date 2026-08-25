export type StreamableExportFormat = 'mp4' | 'webm'
export type ExportArtifactFormat = StreamableExportFormat | 'gif'

function defaultTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function createExportFilename(
  format: ExportArtifactFormat,
  createTimestamp: () => string = defaultTimestamp
): string {
  const prefix = format === 'gif' ? 'screen-recording-gif' : 'edited-video'
  return `${prefix}-${createTimestamp()}.${format}`
}

export function withOpfsExportTarget<
  F extends StreamableExportFormat,
  T extends Record<string, unknown> & { format: F }
>(
  options: T,
  format: F,
  opfsDirId: string,
  createTimestamp: () => string = defaultTimestamp
): T & { saveToOpfs?: boolean; opfsFileName?: string } {
  if (!opfsDirId) return { ...options }
  return {
    ...options,
    saveToOpfs: true,
    opfsFileName: createExportFilename(format, createTimestamp)
  }
}
