export interface PreviewPrefetchIntent {
  generation: number
  targetGlobalFrame: number
}

export interface PreviewDecodeLane {
  generation: number
  currentInFlight: boolean
  prefetchInFlight: boolean
  deferredPrefetch: PreviewPrefetchIntent | null
  outputTarget: 'current' | 'next'
}

export type PreviewDecodeLaneEffect =
  | 'none'
  | 'start-main'
  | 'start-prefetch'
  | 'defer-prefetch'

export interface PreviewDecodeLaneTransition {
  state: PreviewDecodeLane
  effect: PreviewDecodeLaneEffect
  intent?: PreviewPrefetchIntent
}

export function createPreviewDecodeLane(generation = 0): PreviewDecodeLane {
  return {
    generation: normalizeGeneration(generation),
    currentInFlight: false,
    prefetchInFlight: false,
    deferredPrefetch: null,
    outputTarget: 'current'
  }
}

/**
 * A single VideoDecoder may only have one logical output owner at a time.
 * Starting a main window resets any prefetch work from the previous window so
 * asynchronous callbacks cannot be reclassified by a stale global target.
 */
export function beginMainDecode(
  _state: PreviewDecodeLane,
  generation: number
): PreviewDecodeLaneTransition {
  return {
    state: {
      ...createPreviewDecodeLane(generation),
      currentInFlight: true
    },
    effect: 'start-main'
  }
}

export function requestPrefetchDecode(
  state: PreviewDecodeLane,
  intent: PreviewPrefetchIntent
): PreviewDecodeLaneTransition {
  const normalizedIntent = normalizeIntent(intent)
  if (normalizedIntent.generation !== state.generation) {
    return { state, effect: 'none' }
  }

  if (state.currentInFlight || state.prefetchInFlight) {
    return {
      state: { ...state, deferredPrefetch: normalizedIntent },
      effect: 'defer-prefetch'
    }
  }

  return {
    state: {
      ...state,
      prefetchInFlight: true,
      deferredPrefetch: null,
      outputTarget: 'next'
    },
    effect: 'start-prefetch',
    intent: normalizedIntent
  }
}

export function finishMainDecode(
  state: PreviewDecodeLane,
  generation: number
): PreviewDecodeLaneTransition {
  if (normalizeGeneration(generation) !== state.generation || !state.currentInFlight) {
    return { state, effect: 'none' }
  }

  const settled = {
    ...state,
    currentInFlight: false,
    outputTarget: state.prefetchInFlight ? 'next' as const : 'current' as const
  }
  return startDeferredPrefetch(settled)
}

export function finishPrefetchDecode(
  state: PreviewDecodeLane,
  generation: number
): PreviewDecodeLaneTransition {
  if (normalizeGeneration(generation) !== state.generation || !state.prefetchInFlight) {
    return { state, effect: 'none' }
  }

  return startDeferredPrefetch({
    ...state,
    prefetchInFlight: false,
    outputTarget: 'current'
  })
}

function startDeferredPrefetch(state: PreviewDecodeLane): PreviewDecodeLaneTransition {
  if (state.currentInFlight || state.prefetchInFlight || !state.deferredPrefetch) {
    return { state, effect: 'none' }
  }

  const intent = state.deferredPrefetch
  return {
    state: {
      ...state,
      prefetchInFlight: true,
      deferredPrefetch: null,
      outputTarget: 'next'
    },
    effect: 'start-prefetch',
    intent
  }
}

function normalizeIntent(intent: PreviewPrefetchIntent): PreviewPrefetchIntent {
  return {
    generation: normalizeGeneration(intent.generation),
    targetGlobalFrame: Math.max(0, Math.floor(finiteOrZero(intent.targetGlobalFrame)))
  }
}

function normalizeGeneration(generation: number): number {
  return Math.max(0, Math.floor(finiteOrZero(generation)))
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}
