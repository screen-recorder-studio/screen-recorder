import type {
  RecordingMode,
  RecordingSessionEvent,
  RecordingSessionState
} from './recording-session'

export interface RecordingSessionStoreLike {
  load(): Promise<RecordingSessionState>
  apply(event: RecordingSessionEvent): Promise<RecordingSessionState>
}

export interface RecordingCoordinatorOptions {
  createOperationId?: () => string
  now?: () => number
}

export interface RecordingTransitionResult {
  accepted: boolean
  state: RecordingSessionState
}

type EventFactory = (
  state: RecordingSessionState,
  revision: number,
  updatedAt: number
) => RecordingSessionEvent

/**
 * Owns command ordering and revision allocation for the current recording.
 * Browser APIs stay outside this class so the lifecycle contract is testable.
 */
export class RecordingCoordinator {
  private queue: Promise<void> = Promise.resolve()
  private readonly createOperationId: () => string
  private readonly now: () => number

  constructor(
    private readonly store: RecordingSessionStoreLike,
    options: RecordingCoordinatorOptions = {}
  ) {
    this.createOperationId = options.createOperationId ?? createDefaultOperationId
    this.now = options.now ?? Date.now
  }

  getState(): Promise<RecordingSessionState> {
    return this.enqueue(() => this.store.load())
  }

  requestStart(mode: RecordingMode): Promise<RecordingTransitionResult> {
    return this.enqueue(async () => {
      const current = await this.store.load()
      if (current.phase !== 'idle' && current.phase !== 'failed') {
        return { accepted: false, state: current }
      }

      const event: RecordingSessionEvent = {
        type: current.phase === 'failed' ? 'RETRY_REQUESTED' : 'START_REQUESTED',
        operationId: this.createOperationId(),
        revision: 1,
        mode,
        updatedAt: this.now()
      }
      return this.apply(current, event)
    })
  }

  countdownChanged(operationId: string, countdownRemaining: number): Promise<RecordingTransitionResult> {
    return this.transition(operationId, (state, revision, updatedAt) => ({
      type: state.phase === 'requesting' ? 'COUNTDOWN_STARTED' : 'COUNTDOWN_TICKED',
      operationId,
      revision,
      countdownRemaining,
      updatedAt
    }))
  }

  streamStarted(operationId: string): Promise<RecordingTransitionResult> {
    return this.transition(operationId, (_state, revision, updatedAt) => ({
      type: 'STREAM_STARTED', operationId, revision, updatedAt
    }))
  }

  elapsedChanged(operationId: string, elapsedMs: number): Promise<RecordingTransitionResult> {
    return this.transition(operationId, (_state, revision, updatedAt) => ({
      type: 'ELAPSED_UPDATED', operationId, revision, elapsedMs, updatedAt
    }))
  }

  pauseChanged(
    operationId: string,
    paused: boolean,
    elapsedMs: number
  ): Promise<RecordingTransitionResult> {
    return this.transition(operationId, (_state, revision, updatedAt) => ({
      type: paused ? 'PAUSED' : 'RESUMED',
      operationId,
      revision,
      elapsedMs,
      updatedAt
    }))
  }

  stopRequested(operationId: string, elapsedMs: number): Promise<RecordingTransitionResult> {
    return this.transition(operationId, (_state, revision, updatedAt) => ({
      type: 'STOP_REQUESTED', operationId, revision, elapsedMs, updatedAt
    }))
  }

  finalizingStarted(operationId: string): Promise<RecordingTransitionResult> {
    return this.transition(operationId, (_state, revision, updatedAt) => ({
      type: 'FINALIZING_STARTED', operationId, revision, updatedAt
    }))
  }

  finalized(operationId: string): Promise<RecordingTransitionResult> {
    return this.transition(operationId, (_state, revision, updatedAt) => ({
      type: 'FINALIZED', operationId, revision, updatedAt
    }))
  }

  failed(operationId: string, errorCode: string): Promise<RecordingTransitionResult> {
    return this.transition(operationId, (_state, revision, updatedAt) => ({
      type: 'FAILED', operationId, revision, errorCode, updatedAt
    }))
  }

  private transition(
    operationId: string,
    createEvent: EventFactory
  ): Promise<RecordingTransitionResult> {
    return this.enqueue(async () => {
      const current = await this.store.load()
      if (!operationId || current.operationId !== operationId) {
        return { accepted: false, state: current }
      }

      const event = createEvent(current, current.revision + 1, this.now())
      return this.apply(current, event)
    })
  }

  private async apply(
    _current: RecordingSessionState,
    event: RecordingSessionEvent
  ): Promise<RecordingTransitionResult> {
    const next = await this.store.apply(event)
    const accepted = next.operationId === event.operationId && next.revision === event.revision
    return { accepted, state: next }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}

function createDefaultOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `recording-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
