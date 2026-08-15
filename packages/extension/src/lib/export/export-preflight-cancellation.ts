import { ExportCancelledError } from '../services/export-manager'

export interface ExportPreflightCancellation {
  request(): boolean
  throwIfRequested(): void
}

export function createExportPreflightCancellation(): ExportPreflightCancellation {
  let requested = false

  return {
    request() {
      if (requested) return false
      requested = true
      return true
    },
    throwIfRequested() {
      if (requested) throw new ExportCancelledError()
    }
  }
}
