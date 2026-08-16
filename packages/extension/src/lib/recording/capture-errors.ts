export type CaptureErrorCode =
  | 'PERMISSION_DENIED'
  | 'CAPTURE_CANCELLED'
  | 'CAPTURE_SOURCE_NOT_FOUND'
  | 'CAPTURE_NOT_SUPPORTED'
  | 'CAPTURE_INVALID_STATE'
  | 'CAPTURE_FAILED'

export interface ClassifiedCaptureError {
  code: CaptureErrorCode
}

const ERROR_CODES: Record<string, CaptureErrorCode> = {
  NotAllowedError: 'PERMISSION_DENIED',
  AbortError: 'CAPTURE_CANCELLED',
  NotFoundError: 'CAPTURE_SOURCE_NOT_FOUND',
  NotSupportedError: 'CAPTURE_NOT_SUPPORTED',
  InvalidStateError: 'CAPTURE_INVALID_STATE'
}

export function classifyCaptureError(error: unknown): ClassifiedCaptureError {
  const name = typeof (error as any)?.name === 'string' ? (error as any).name : ''
  return { code: ERROR_CODES[name] ?? 'CAPTURE_FAILED' }
}
