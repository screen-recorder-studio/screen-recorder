import type { JourneyEventInput } from '../observability/journey-events'

const OWNED_DOWNLOAD_IDS_KEY = 'journeyOwnedDownloadIds'

export interface DownloadIdStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export interface DownloadChange {
  id: number
  state?: {
    current?: string
  }
}

type TerminalDownloadState = 'complete' | 'interrupted'

function isDownloadId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export class OwnedDownloadTracker {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly storage: DownloadIdStorage) {}

  trackStarted(downloadId: unknown): Promise<JourneyEventInput | null> {
    if (!isDownloadId(downloadId)) return Promise.resolve(null)

    return this.enqueue(async () => {
      const ids = await this.readIds()
      if (ids.has(downloadId)) return null

      ids.add(downloadId)
      await this.writeIds(ids)
      return {
        name: 'download.started',
        context: 'background'
      }
    })
  }

  observeChange(change: DownloadChange): Promise<JourneyEventInput | null> {
    const state = change?.state?.current
    if (!isDownloadId(change?.id) || (state !== 'complete' && state !== 'interrupted')) {
      return Promise.resolve(null)
    }

    return this.enqueue(async () => {
      const ids = await this.readIds()
      if (!ids.delete(change.id)) return null

      await this.writeIds(ids)
      return state === 'complete'
        ? {
            name: 'download.completed',
            context: 'background',
            attributes: { outcome: 'success' }
          }
        : {
            name: 'download.failed',
            context: 'background',
            attributes: { outcome: 'failure', errorCode: 'DOWNLOAD_INTERRUPTED' }
          }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async readIds(): Promise<Set<number>> {
    const stored = await this.storage.get(OWNED_DOWNLOAD_IDS_KEY)
    const values = stored?.[OWNED_DOWNLOAD_IDS_KEY]
    return new Set(Array.isArray(values) ? values.filter(isDownloadId) : [])
  }

  private writeIds(ids: Set<number>): Promise<void> {
    return this.storage.set({
      [OWNED_DOWNLOAD_IDS_KEY]: [...ids].sort((left, right) => left - right)
    })
  }
}
