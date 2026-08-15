export type ReaderRequestPurpose = 'main' | 'prefetch' | 'single-frame'

export interface ReaderRequestContext {
  requestId?: number
  purpose?: ReaderRequestPurpose
}

export interface TaggedReaderRequestContext {
  requestId: number
  purpose: ReaderRequestPurpose
}

export type ReaderResponseRoute =
  | 'accept-main'
  | 'resolve-prefetch'
  | 'resolve-single-frame'
  | 'stale'
  | 'untracked'

export function decideReaderResponseRoute(
  state: {
    latestMainRequestId: number | null
    pendingPrefetchRequestIds: ReadonlySet<number>
    pendingSingleFrameRequestIds: ReadonlySet<number>
  },
  response: ReaderRequestContext
): ReaderResponseRoute {
  if (!Number.isInteger(response.requestId) || !response.purpose) return 'untracked'
  const requestId = response.requestId as number

  if (response.purpose === 'main') {
    return requestId === state.latestMainRequestId ? 'accept-main' : 'stale'
  }
  if (response.purpose === 'prefetch') {
    return state.pendingPrefetchRequestIds.has(requestId) ? 'resolve-prefetch' : 'untracked'
  }
  if (response.purpose === 'single-frame') {
    return state.pendingSingleFrameRequestIds.has(requestId) ? 'resolve-single-frame' : 'untracked'
  }
  return 'untracked'
}

export class ReaderRequestCoordinator {
  #nextRequestId = 0
  #latestMainRequestId: number | null = null
  #pendingPrefetchRequestIds = new Set<number>()
  #pendingSingleFrameRequestIds = new Set<number>()

  issue(purpose: ReaderRequestPurpose): TaggedReaderRequestContext {
    const requestId = this.#nextRequestId++
    if (purpose === 'main') {
      this.#latestMainRequestId = requestId
    } else if (purpose === 'prefetch') {
      this.#pendingPrefetchRequestIds.add(requestId)
    } else {
      this.#pendingSingleFrameRequestIds.clear()
      this.#pendingSingleFrameRequestIds.add(requestId)
    }
    return { requestId, purpose }
  }

  consume(response: ReaderRequestContext): ReaderResponseRoute {
    const route = decideReaderResponseRoute({
      latestMainRequestId: this.#latestMainRequestId,
      pendingPrefetchRequestIds: this.#pendingPrefetchRequestIds,
      pendingSingleFrameRequestIds: this.#pendingSingleFrameRequestIds
    }, response)
    if (route === 'accept-main') this.#latestMainRequestId = null
    if (route === 'resolve-prefetch') this.#pendingPrefetchRequestIds.delete(response.requestId as number)
    if (route === 'resolve-single-frame') this.#pendingSingleFrameRequestIds.delete(response.requestId as number)
    return route
  }

  cancel(request: TaggedReaderRequestContext): void {
    if (request.purpose === 'main' && this.#latestMainRequestId === request.requestId) {
      this.#latestMainRequestId = null
    } else if (request.purpose === 'prefetch') {
      this.#pendingPrefetchRequestIds.delete(request.requestId)
    } else if (request.purpose === 'single-frame') {
      this.#pendingSingleFrameRequestIds.delete(request.requestId)
    }
  }

  reset(): void {
    this.#latestMainRequestId = null
    this.#pendingPrefetchRequestIds.clear()
    this.#pendingSingleFrameRequestIds.clear()
  }
}
