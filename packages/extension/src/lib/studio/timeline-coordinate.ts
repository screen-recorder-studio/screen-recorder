export const TIMELINE_CONTENT_INSET_REM = 1

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

function formatCssNumber(value: number): string {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value
  return Number(normalized.toFixed(6)).toString()
}

/**
 * Maps a timeline percentage into the content box of a padded container.
 * Trim and zoom elements are positioned inside that content box, while the
 * full-height playhead is positioned against the outer container.
 */
export function resolvePaddedTimelinePositionPx(
  containerWidthPx: number,
  insetPx: number,
  percent: number
): number {
  const width = Number.isFinite(containerWidthPx) ? Math.max(0, containerWidthPx) : 0
  const inset = Number.isFinite(insetPx)
    ? Math.min(width / 2, Math.max(0, insetPx))
    : 0
  const ratio = clampPercent(percent) / 100
  return inset + (width - (2 * inset)) * ratio
}

/** CSS equivalent of resolvePaddedTimelinePositionPx for an absolute child. */
export function resolvePaddedTimelinePositionCss(
  percent: number,
  insetRem = TIMELINE_CONTENT_INSET_REM
): string {
  const clampedPercent = clampPercent(percent)
  const safeInsetRem = Number.isFinite(insetRem) ? Math.max(0, insetRem) : 0
  const insetOffsetRem = safeInsetRem * (1 - (2 * clampedPercent / 100))
  const percentText = formatCssNumber(clampedPercent)

  if (Math.abs(insetOffsetRem) < 1e-9) return `${percentText}%`

  const operator = insetOffsetRem > 0 ? '+' : '-'
  return `calc(${percentText}% ${operator} ${formatCssNumber(Math.abs(insetOffsetRem))}rem)`
}
