export type StreamableExportFormat = 'mp4' | 'webm'

function defaultTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
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
    opfsFileName: `edited-video-${createTimestamp()}.${format}`
  }
}
