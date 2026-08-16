import { describe, expect, it } from 'vitest'
import { classifyExportFailure } from './export-error'

describe('classifyExportFailure', () => {
  it('offers a Studio reload only for an unavailable export worker', () => {
    expect(classifyExportFailure({ code: 'EXPORT_WORKER_UNAVAILABLE' }, 'webm')).toEqual({
      errorCode: 'EXPORT_WORKER_UNAVAILABLE',
      messageKey: 'export_error_worker_unavailable',
      hintKey: 'export_error_reload_hint',
      action: 'reload-studio'
    })
  })

  it.each(['mp4', 'webm', 'gif'] as const)(
    'keeps ordinary %s failures on the retry path',
    (format) => {
      expect(classifyExportFailure(new Error('encode failed'), format)).toEqual({
        errorCode: `EXPORT_${format.toUpperCase()}_FAILED`,
        messageKey: `export_error_${format}_failed`,
        hintKey: 'export_error_retry_hint',
        action: 'none'
      })
    }
  )
})
