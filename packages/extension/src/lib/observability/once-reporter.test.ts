import { describe, expect, it, vi } from 'vitest'
import { createOnceReporter } from './once-reporter'

describe('createOnceReporter', () => {
  it('reports a milestone once until the next recording load resets it', () => {
    const callback = vi.fn()
    const reporter = createOnceReporter(callback)

    expect(reporter.report()).toBe(true)
    expect(reporter.report()).toBe(false)
    expect(callback).toHaveBeenCalledTimes(1)

    reporter.reset()
    expect(reporter.report()).toBe(true)
    expect(callback).toHaveBeenCalledTimes(2)
  })
})
