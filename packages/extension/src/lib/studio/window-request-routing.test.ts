import { describe, expect, it } from 'vitest'
import { decideReaderResponseRoute, ReaderRequestCoordinator } from './window-request-routing'

describe('decideReaderResponseRoute', () => {
  it('accepts only the latest main-window response', () => {
    const state = {
      latestMainRequestId: 7,
      pendingPrefetchRequestIds: new Set<number>(),
      pendingSingleFrameRequestIds: new Set<number>()
    }

    expect(decideReaderResponseRoute(state, {
      requestId: 7,
      purpose: 'main'
    })).toBe('accept-main')
    expect(decideReaderResponseRoute(state, {
      requestId: 6,
      purpose: 'main'
    })).toBe('stale')
  })

  it('routes prefetch and single-frame responses only to their exact pending request', () => {
    const state = {
      latestMainRequestId: 7,
      pendingPrefetchRequestIds: new Set([8]),
      pendingSingleFrameRequestIds: new Set([9])
    }

    expect(decideReaderResponseRoute(state, {
      requestId: 8,
      purpose: 'prefetch'
    })).toBe('resolve-prefetch')
    expect(decideReaderResponseRoute(state, {
      requestId: 9,
      purpose: 'single-frame'
    })).toBe('resolve-single-frame')
    expect(decideReaderResponseRoute(state, {
      requestId: 10,
      purpose: 'prefetch'
    })).toBe('untracked')
  })

  it('never lets a response cross request purposes or an untagged response mutate Studio', () => {
    const state = {
      latestMainRequestId: 8,
      pendingPrefetchRequestIds: new Set([8]),
      pendingSingleFrameRequestIds: new Set<number>()
    }

    expect(decideReaderResponseRoute(state, {
      requestId: 8,
      purpose: 'main'
    })).toBe('accept-main')
    expect(decideReaderResponseRoute(state, {
      requestId: 8,
      purpose: 'single-frame'
    })).toBe('untracked')
    expect(decideReaderResponseRoute(state, {})).toBe('untracked')
  })
})

describe('ReaderRequestCoordinator', () => {
  it('lets the latest main intent win and consumes each response once', () => {
    const coordinator = new ReaderRequestCoordinator()
    const first = coordinator.issue('main')
    const second = coordinator.issue('main')

    expect(coordinator.consume(first)).toBe('stale')
    expect(coordinator.consume(second)).toBe('accept-main')
    expect(coordinator.consume(second)).toBe('stale')
  })

  it('keeps main and prefetch responses isolated when they finish out of order', () => {
    const coordinator = new ReaderRequestCoordinator()
    const prefetch = coordinator.issue('prefetch')
    const main = coordinator.issue('main')

    expect(coordinator.consume(main)).toBe('accept-main')
    expect(coordinator.consume(prefetch)).toBe('resolve-prefetch')
  })

  it('supersedes an old single-frame request and invalidates everything on reset', () => {
    const coordinator = new ReaderRequestCoordinator()
    const oldHover = coordinator.issue('single-frame')
    const latestHover = coordinator.issue('single-frame')
    const prefetch = coordinator.issue('prefetch')

    expect(coordinator.consume(oldHover)).toBe('untracked')
    expect(coordinator.consume(latestHover)).toBe('resolve-single-frame')
    coordinator.reset()
    expect(coordinator.consume(prefetch)).toBe('untracked')
  })
})
