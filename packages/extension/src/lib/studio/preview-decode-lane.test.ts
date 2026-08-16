import { describe, expect, it } from 'vitest'
import {
  beginMainDecode,
  createPreviewDecodeLane,
  finishMainDecode,
  finishPrefetchDecode,
  requestPrefetchDecode,
  type PreviewPrefetchIntent
} from './preview-decode-lane'

const prefetch = (targetGlobalFrame: number): PreviewPrefetchIntent => ({
  generation: 7,
  targetGlobalFrame
})

describe('preview decode lane', () => {
  it('defers prefetch without changing the current output target while main decode is active', () => {
    const main = beginMainDecode(createPreviewDecodeLane(7), 7)
    const requested = requestPrefetchDecode(main.state, prefetch(660))

    expect(main.effect).toBe('start-main')
    expect(requested.effect).toBe('defer-prefetch')
    expect(requested.state).toMatchObject({
      generation: 7,
      currentInFlight: true,
      prefetchInFlight: false,
      outputTarget: 'current',
      deferredPrefetch: prefetch(660)
    })
  })

  it('starts exactly one deferred prefetch only after main flush settles', () => {
    const main = beginMainDecode(createPreviewDecodeLane(7), 7).state
    const first = requestPrefetchDecode(main, prefetch(660)).state
    const latest = requestPrefetchDecode(first, prefetch(690)).state
    const settled = finishMainDecode(latest, 7)

    expect(settled.effect).toBe('start-prefetch')
    expect(settled.intent).toEqual(prefetch(690))
    expect(settled.state).toMatchObject({
      currentInFlight: false,
      prefetchInFlight: true,
      outputTarget: 'next',
      deferredPrefetch: null
    })
  })

  it('ignores stale completion and clears deferred work for a new generation', () => {
    const oldMain = beginMainDecode(createPreviewDecodeLane(7), 7).state
    const queued = requestPrefetchDecode(oldMain, prefetch(660)).state
    const nextMain = beginMainDecode(queued, 8)
    const stale = finishMainDecode(nextMain.state, 7)

    expect(nextMain.state).toMatchObject({
      generation: 8,
      currentInFlight: true,
      outputTarget: 'current',
      deferredPrefetch: null
    })
    expect(stale.effect).toBe('none')
    expect(stale.state).toBe(nextMain.state)
  })

  it('serializes another prefetch requested while the previous prefetch is active', () => {
    const idle = createPreviewDecodeLane(7)
    const first = requestPrefetchDecode(idle, prefetch(660))
    const queued = requestPrefetchDecode(first.state, prefetch(690))
    const settled = finishPrefetchDecode(queued.state, 7)

    expect(first.effect).toBe('start-prefetch')
    expect(queued.effect).toBe('defer-prefetch')
    expect(settled.effect).toBe('start-prefetch')
    expect(settled.intent).toEqual(prefetch(690))
    expect(settled.state.outputTarget).toBe('next')
  })
})
