import { describe, expect, it } from 'vitest'
import { classifyCaptureError } from './capture-errors'

describe('classifyCaptureError', () => {
  it.each([
    ['NotAllowedError', 'PERMISSION_DENIED'],
    ['AbortError', 'CAPTURE_CANCELLED'],
    ['NotFoundError', 'CAPTURE_SOURCE_NOT_FOUND'],
    ['NotSupportedError', 'CAPTURE_NOT_SUPPORTED'],
    ['InvalidStateError', 'CAPTURE_INVALID_STATE']
  ])('maps %s to %s', (name, expectedCode) => {
    expect(classifyCaptureError({ name, message: 'private platform text' })).toEqual({ code: expectedCode })
  })

  it('does not expose raw error messages for unknown failures', () => {
    const result = classifyCaptureError(new Error('screen title and private details'))
    expect(result).toEqual({ code: 'CAPTURE_FAILED' })
    expect(JSON.stringify(result)).not.toContain('private')
  })
})
