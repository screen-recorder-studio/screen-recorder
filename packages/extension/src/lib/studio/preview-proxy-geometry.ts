export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

interface PreviewGeometryInput {
  sourceWidth: number
  sourceHeight: number
  previewWidth: number
  previewHeight: number
  crop: PreviewRect
}

export function mapSourceCropToPreview(input: PreviewGeometryInput): PreviewRect {
  const sourceWidth = positive(input.sourceWidth)
  const sourceHeight = positive(input.sourceHeight)
  const previewWidth = positive(input.previewWidth)
  const previewHeight = positive(input.previewHeight)
  if (!sourceWidth || !sourceHeight || !previewWidth || !previewHeight) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  const crop = clampCrop(input.crop, sourceWidth, sourceHeight)
  if (!crop) return { x: 0, y: 0, width: previewWidth, height: previewHeight }

  const scaleX = previewWidth / sourceWidth
  const scaleY = previewHeight / sourceHeight
  const x = Math.max(0, Math.min(previewWidth - 1, Math.floor(crop.x * scaleX)))
  const y = Math.max(0, Math.min(previewHeight - 1, Math.floor(crop.y * scaleY)))
  const right = Math.max(x + 1, Math.min(previewWidth, Math.ceil((crop.x + crop.width) * scaleX)))
  const bottom = Math.max(y + 1, Math.min(previewHeight, Math.ceil((crop.y + crop.height) * scaleY)))
  return { x, y, width: right - x, height: bottom - y }
}

export function resolveFocusWithinSourceCrop(input: {
  focusX: number
  focusY: number
  sourceWidth: number
  sourceHeight: number
  crop: PreviewRect
}): { x: number; y: number } {
  const sourceWidth = positive(input.sourceWidth)
  const sourceHeight = positive(input.sourceHeight)
  if (!sourceWidth || !sourceHeight) return { x: 0.5, y: 0.5 }
  const crop = clampCrop(input.crop, sourceWidth, sourceHeight)
    ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  const sourceX = clamp01(input.focusX) * sourceWidth
  const sourceY = clamp01(input.focusY) * sourceHeight
  return {
    x: clamp01((sourceX - crop.x) / crop.width),
    y: clamp01((sourceY - crop.y) / crop.height)
  }
}

function clampCrop(crop: PreviewRect, sourceWidth: number, sourceHeight: number): PreviewRect | null {
  const x = Math.max(0, Math.min(sourceWidth, finite(crop.x)))
  const y = Math.max(0, Math.min(sourceHeight, finite(crop.y)))
  const width = Math.max(0, Math.min(finite(crop.width), sourceWidth - x))
  const height = Math.max(0, Math.min(finite(crop.height), sourceHeight - y))
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finite(value)))
}
