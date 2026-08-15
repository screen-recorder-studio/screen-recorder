import {
  createJourneyState,
  recordJourneyEvent,
  type JourneyEventInput,
  type JourneyState,
  type RecordJourneyOptions
} from './journey-events'

export const JOURNEY_STORAGE_KEY = 'journeyObservabilityV1'

export interface JourneyStorageArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}

export interface JourneyRecorder {
  record(input: JourneyEventInput): Promise<JourneyState>
  read(): Promise<JourneyState>
  clear(): Promise<void>
}

export function createJourneyRecorder(
  storage: JourneyStorageArea,
  options: RecordJourneyOptions = {}
): JourneyRecorder {
  let queue: Promise<void> = Promise.resolve()

  const readStoredState = async () => {
    const stored = await storage.get(JOURNEY_STORAGE_KEY)
    return createJourneyState(stored?.[JOURNEY_STORAGE_KEY] as Partial<JourneyState> | undefined)
  }

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    record(input) {
      return enqueue(async () => {
        const current = await readStoredState()
        const next = recordJourneyEvent(current, input, options)
        await storage.set({ [JOURNEY_STORAGE_KEY]: next })
        return next
      })
    },
    async read() {
      await queue
      return readStoredState()
    },
    clear() {
      return enqueue(async () => {
        await storage.remove(JOURNEY_STORAGE_KEY)
      })
    }
  }
}
