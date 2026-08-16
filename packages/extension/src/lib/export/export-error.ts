import type { ExportOptions } from '$lib/types/background'

export type ExportFailureAction = 'none' | 'reload-studio'

export interface ExportFailurePresentation {
  errorCode: string
  messageKey: string
  hintKey: string
  action: ExportFailureAction
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export function classifyExportFailure(
  error: unknown,
  format: ExportOptions['format']
): ExportFailurePresentation {
  if (hasErrorCode(error, 'EXPORT_WORKER_UNAVAILABLE')) {
    return {
      errorCode: 'EXPORT_WORKER_UNAVAILABLE',
      messageKey: 'export_error_worker_unavailable',
      hintKey: 'export_error_reload_hint',
      action: 'reload-studio'
    }
  }

  return {
    errorCode: `EXPORT_${format.toUpperCase()}_FAILED`,
    messageKey: `export_error_${format}_failed`,
    hintKey: 'export_error_retry_hint',
    action: 'none'
  }
}
