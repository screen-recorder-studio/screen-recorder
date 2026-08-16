export interface RecordingDurationMeta {
  wallClockDurationMs?: unknown
}

/** Resolve the pause-aware active recording duration. Encoded timestamps are
 * only a legacy fallback because sparse capture cannot describe a static tail. */
export function resolveRecordingDurationMs(
  meta: RecordingDurationMeta | null | undefined,
  firstTimestamp: unknown,
  lastTimestamp: unknown
): number {
  const wallClockDurationMs = finiteNumber(meta?.wallClockDurationMs)
  if (wallClockDurationMs !== null && wallClockDurationMs > 0) {
    return Math.floor(wallClockDurationMs)
  }

  const first = finiteNumber(firstTimestamp)
  const last = finiteNumber(lastTimestamp)
  if (first !== null && last !== null && last > first) {
    return Math.max(0, Math.round((last - first) / 1000))
  }
  return 0
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
