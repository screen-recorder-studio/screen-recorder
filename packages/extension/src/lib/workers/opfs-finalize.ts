export interface OpfsFinalizeWorker extends EventTarget {
  postMessage(message: { type: 'finalize'; wallClockDurationMs?: number }): void
}

export interface OpfsFinalizedResult {
  id: string
}

export class OpfsFinalizeError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'OpfsFinalizeError'
    this.code = code
  }
}

export function waitForOpfsFinalization(
  worker: OpfsFinalizeWorker,
  timeoutMs = 30_000,
  options: { wallClockDurationMs?: number } = {}
): Promise<OpfsFinalizedResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      worker.removeEventListener('message', onMessage as EventListener)
    }
    const settle = (action: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }
    const onMessage = (event: Event) => {
      const data = (event as MessageEvent).data || {}
      if (data.type === 'finalized') {
        settle(() => resolve({ id: String(data.id ?? '') }))
      } else if (data.type === 'error') {
        const code = typeof data.code === 'string' && data.code ? data.code : 'OPFS_WRITE_ERROR'
        settle(() => reject(new OpfsFinalizeError(code, 'OPFS writer failed while finalizing')))
      }
    }

    worker.addEventListener('message', onMessage as EventListener)
    timeoutId = setTimeout(() => {
      settle(() => reject(new OpfsFinalizeError(
        'OPFS_FINALIZE_TIMEOUT',
        `OPFS writer did not acknowledge finalization within ${timeoutMs}ms`
      )))
    }, Math.max(1, timeoutMs))

    try {
      const wallClockDurationMs = typeof options.wallClockDurationMs === 'number'
        && Number.isFinite(options.wallClockDurationMs)
        && options.wallClockDurationMs > 0
        ? Math.floor(options.wallClockDurationMs)
        : undefined
      worker.postMessage({
        type: 'finalize',
        ...(wallClockDurationMs === undefined ? {} : { wallClockDurationMs })
      })
    } catch {
      settle(() => reject(new OpfsFinalizeError('OPFS_FINALIZE_POST_FAILED', 'Failed to request OPFS finalization')))
    }
  })
}
