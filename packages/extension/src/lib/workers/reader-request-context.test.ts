import { describe, expect, it } from 'vitest'
import { getReaderReplyContext } from './reader-request-context'

describe('getReaderReplyContext', () => {
  it('echoes every valid request context, including request id zero', () => {
    expect(getReaderReplyContext({ requestId: 0, purpose: 'main' })).toEqual({
      requestId: 0,
      purpose: 'main'
    })
    expect(getReaderReplyContext({ requestId: 12, purpose: 'prefetch' })).toEqual({
      requestId: 12,
      purpose: 'prefetch'
    })
    expect(getReaderReplyContext({ requestId: 13, purpose: 'single-frame' })).toEqual({
      requestId: 13,
      purpose: 'single-frame'
    })
  })

  it('keeps legacy reader callers compatible by returning no context', () => {
    expect(getReaderReplyContext({ type: 'getRange' })).toEqual({})
    expect(getReaderReplyContext({ requestId: -1, purpose: 'main' })).toEqual({})
    expect(getReaderReplyContext({ requestId: 1, purpose: 'unknown' })).toEqual({})
  })
})
