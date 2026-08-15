export type PreviewLoadFailureReason = 'invalid-chunks' | 'processing-failed'

export type PreviewLoadErrorCode =
  | 'STUDIO_PREVIEW_INVALID_CHUNKS'
  | 'STUDIO_PREVIEW_PROCESSING_FAILED'

const ERROR_CODE_BY_REASON: Record<PreviewLoadFailureReason, PreviewLoadErrorCode> = {
  'invalid-chunks': 'STUDIO_PREVIEW_INVALID_CHUNKS',
  'processing-failed': 'STUDIO_PREVIEW_PROCESSING_FAILED'
}

export function reportPreviewLoadFailure(
  onLoadError: ((errorCode: string) => void) | undefined,
  reason: PreviewLoadFailureReason
): PreviewLoadErrorCode {
  const errorCode = ERROR_CODE_BY_REASON[reason]
  onLoadError?.(errorCode)
  return errorCode
}

export async function runPreviewProcessing(
  processVideo: () => Promise<void>,
  onLoadError?: (errorCode: string) => void,
  onProcessingError?: (error: unknown) => void
): Promise<boolean> {
  try {
    await processVideo()
    return true
  } catch (error) {
    reportPreviewLoadFailure(onLoadError, 'processing-failed')
    onProcessingError?.(error)
    return false
  }
}
