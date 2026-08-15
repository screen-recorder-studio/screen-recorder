export interface OpfsResultFileHandle {
  getFile(): Promise<{ size: number; name?: string }>
}

export async function readOpfsResultInfo(
  fileHandle: OpfsResultFileHandle | null,
  fallbackFileName: string
): Promise<{ bytes: number; fileName: string }> {
  if (!fileHandle) throw new Error('OPFS_EXPORT_FILE_UNAVAILABLE')

  let file: { size: number; name?: string }
  try {
    file = await fileHandle.getFile()
  } catch {
    throw new Error('OPFS_EXPORT_RESULT_UNREADABLE')
  }

  const bytes = Number(file?.size)
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new Error('OPFS_EXPORT_EMPTY')
  }

  const fileName = typeof file.name === 'string' && file.name.trim()
    ? file.name
    : fallbackFileName
  return { bytes, fileName }
}
