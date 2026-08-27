interface WorkerMessageTarget {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

export class WorkerMessageError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WorkerMessageError'
    this.code = code
  }
}

export function waitForWorkerMessage<T = unknown>(
  worker: WorkerMessageTarget,
  type: string,
  timeoutMs = 30_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.removeEventListener('message', handler)
      callback()
    }

    const handler = (event: MessageEvent) => {
      if (event.data?.type === type) {
        settle(() => resolve(event.data as T))
        return
      }

      if (event.data?.type === 'error') {
        const code = String(event.data.code || 'WORKER_MESSAGE_ERROR')
        const message = String(event.data.message || event.data.error || code)
        settle(() => reject(new WorkerMessageError(code, message)))
      }
    }

    const timer = setTimeout(() => {
      settle(() => reject(new WorkerMessageError(
        'WORKER_MESSAGE_TIMEOUT',
        `Timeout waiting for worker message type '${type}' after ${timeoutMs}ms`
      )))
    }, timeoutMs)

    worker.addEventListener('message', handler)
  })
}
