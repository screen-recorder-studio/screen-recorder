export interface OnceReporter {
  report(): boolean
  reset(): void
}

export function createOnceReporter(callback: () => void): OnceReporter {
  let reported = false
  return {
    report() {
      if (reported) return false
      reported = true
      callback()
      return true
    },
    reset() {
      reported = false
    }
  }
}
