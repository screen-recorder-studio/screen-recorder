export interface PreviewSizeInput {
  displayWidth: number
  displayHeight: number
  outputWidth: number
  outputHeight: number
  showControls: boolean
  showTimeline: boolean
  hasFrames: boolean
}

export interface PreviewSize {
  width: number
  height: number
}

const CONTROLS_HEIGHT = 56
const TIMELINE_HEIGHT = 232

export function calculatePreviewSize(input: PreviewSizeInput): PreviewSize {
  const availableWidth = finiteNonNegative(input.displayWidth)
  const reservedHeight = input.hasFrames
    ? (input.showControls ? CONTROLS_HEIGHT : 0) + (input.showTimeline ? TIMELINE_HEIGHT : 0)
    : 0
  const availableHeight = Math.max(0, finiteNonNegative(input.displayHeight) - reservedHeight)
  const outputWidth = finiteNonNegative(input.outputWidth)
  const outputHeight = finiteNonNegative(input.outputHeight)

  if (availableWidth === 0 || availableHeight === 0 || outputWidth === 0 || outputHeight === 0) {
    return { width: 0, height: 0 }
  }

  const aspectRatio = outputWidth / outputHeight
  let width = availableWidth
  let height = Math.round(width / aspectRatio)
  if (height > availableHeight) {
    height = availableHeight
    width = Math.round(height * aspectRatio)
  }

  return {
    width: Math.min(availableWidth, Math.max(0, width)),
    height: Math.min(availableHeight, Math.max(0, height))
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
