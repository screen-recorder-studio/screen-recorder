import { describe, expect, it } from 'vitest'
import {
  classifyHoverDecodedFrame,
  shouldAcceptHoverPreviewResponse
} from './preview-hover-frame'

describe('hover preview decoded-frame ownership', () => {
  it('retains only the requested GOP output', () => {
    expect(Array.from({ length: 8 }, (_, outputIndex) =>
      classifyHoverDecodedFrame(outputIndex, 5)
    )).toEqual([
      'discard', 'discard', 'discard', 'discard', 'discard', 'retain-target', 'discard', 'discard'
    ])
  })

  it('normalizes invalid indices without retaining an arbitrary frame', () => {
    expect(classifyHoverDecodedFrame(0, Number.NaN)).toBe('discard')
    expect(classifyHoverDecodedFrame(-1, 0)).toBe('discard')
  })

  it('accepts only the active hover response for the current window', () => {
    const current = {
      responseRequestId: 12,
      activeRequestId: 12,
      responseGeneration: 7,
      currentGeneration: 7,
      isPreviewMode: true
    }

    expect(shouldAcceptHoverPreviewResponse(current)).toBe(true)
    expect(shouldAcceptHoverPreviewResponse({ ...current, responseRequestId: 11 })).toBe(false)
    expect(shouldAcceptHoverPreviewResponse({ ...current, responseGeneration: 6 })).toBe(false)
    expect(shouldAcceptHoverPreviewResponse({ ...current, isPreviewMode: false })).toBe(false)
    expect(shouldAcceptHoverPreviewResponse({ ...current, activeRequestId: null })).toBe(false)
  })
})
