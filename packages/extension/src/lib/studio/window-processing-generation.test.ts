import { describe, expect, it } from 'vitest'
import {
  WindowProcessingGenerationGate,
  isExpectedDecoderCancellation
} from './window-processing-generation'

describe('WindowProcessingGenerationGate', () => {
  it('activates each newer window exactly once', () => {
    const gate = new WindowProcessingGenerationGate()

    expect(gate.activate(1)).toBe(true)
    expect(gate.activate(1)).toBe(false)
    expect(gate.activate(2)).toBe(true)
  })

  it('rejects stale completion after a newer window becomes active', () => {
    const gate = new WindowProcessingGenerationGate()
    gate.activate(7)
    gate.activate(8)

    expect(gate.isCurrent(7)).toBe(false)
    expect(gate.isCurrent(8)).toBe(true)
  })

  it('creates a monotonic generation for legacy callers without a token', () => {
    const gate = new WindowProcessingGenerationGate()

    expect(gate.resolveIncoming(undefined)).toBe(1)
    expect(gate.activate(1)).toBe(true)
    expect(gate.resolveIncoming(undefined)).toBe(2)
  })
})

describe('isExpectedDecoderCancellation', () => {
  it('treats stale work and AbortError from reset as expected cancellation', () => {
    expect(isExpectedDecoderCancellation({
      activeGeneration: 4,
      settledGeneration: 3,
      errorName: 'OperationError'
    })).toBe(true)
    expect(isExpectedDecoderCancellation({
      activeGeneration: 4,
      settledGeneration: 4,
      errorName: 'AbortError'
    })).toBe(true)
  })

  it('keeps a current non-cancellation decoder failure actionable', () => {
    expect(isExpectedDecoderCancellation({
      activeGeneration: 4,
      settledGeneration: 4,
      errorName: 'EncodingError'
    })).toBe(false)
  })
})
