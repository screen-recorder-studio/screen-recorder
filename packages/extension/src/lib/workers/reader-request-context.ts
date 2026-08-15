import type { ReaderRequestPurpose } from '../studio/window-request-routing'

const PURPOSES: readonly ReaderRequestPurpose[] = ['main', 'prefetch', 'single-frame']

export function getReaderReplyContext(message: {
  requestId?: unknown
  purpose?: unknown
  [key: string]: unknown
}): { requestId?: number; purpose?: ReaderRequestPurpose } {
  if (
    !Number.isInteger(message.requestId)
    || (message.requestId as number) < 0
    || !PURPOSES.includes(message.purpose as ReaderRequestPurpose)
  ) {
    return {}
  }
  return {
    requestId: message.requestId as number,
    purpose: message.purpose as ReaderRequestPurpose
  }
}
