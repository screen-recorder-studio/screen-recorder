export interface AreaRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AreaSize {
  width: number
  height: number
}

export interface AreaCropInput {
  rectCss: AreaRect
  viewportCss: AreaSize
  sourceFrame: AreaSize
}

export const MIN_AREA_EDGE_CSS_PX = 24

/**
 * Maps selector CSS pixels into the centered, aspect-preserving content box of
 * the captured frame. Tab capture may deliver a fixed-aspect frame around a
 * differently shaped page viewport; treating its axes independently stretches
 * the coordinate space and exposes pixels outside the user's selection.
 *
 * Boundaries are moved inward to even pixels so codec alignment can never
 * reveal content outside the selected area.
 */
export function mapAreaSelectionToSourceFrame(input: AreaCropInput): AreaRect {
  const { rectCss, viewportCss, sourceFrame } = input
  if (!isPositiveSize(viewportCss) || !isPositiveSize(sourceFrame) || !isValidRect(rectCss)) {
    throw new Error('AREA_SELECTION_INVALID')
  }
  if (rectCss.width < MIN_AREA_EDGE_CSS_PX || rectCss.height < MIN_AREA_EDGE_CSS_PX) {
    throw new Error('AREA_SELECTION_TOO_SMALL')
  }

  const leftCss = clamp(rectCss.x, 0, viewportCss.width)
  const topCss = clamp(rectCss.y, 0, viewportCss.height)
  const rightCss = clamp(rectCss.x + rectCss.width, 0, viewportCss.width)
  const bottomCss = clamp(rectCss.y + rectCss.height, 0, viewportCss.height)
  if (rightCss <= leftCss || bottomCss <= topCss) throw new Error('AREA_SELECTION_INVALID')

  const scale = Math.min(
    sourceFrame.width / viewportCss.width,
    sourceFrame.height / viewportCss.height
  )
  const contentWidth = viewportCss.width * scale
  const contentHeight = viewportCss.height * scale
  const offsetX = (sourceFrame.width - contentWidth) / 2
  const offsetY = (sourceFrame.height - contentHeight) / 2
  const left = alignUp(Math.ceil(offsetX + leftCss * scale), 2)
  const top = alignUp(Math.ceil(offsetY + topCss * scale), 2)
  const right = alignDown(Math.floor(offsetX + rightCss * scale), 2)
  const bottom = alignDown(Math.floor(offsetY + bottomCss * scale), 2)
  const width = right - left
  const height = bottom - top

  if (width < 2 || height < 2) throw new Error('AREA_SELECTION_TOO_SMALL')
  return { x: left, y: top, width, height }
}

function isPositiveSize(value: AreaSize): boolean {
  return Number.isFinite(value.width) && Number.isFinite(value.height)
    && value.width > 0 && value.height > 0
}

function isValidRect(value: AreaRect): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.width) && Number.isFinite(value.height)
    && value.width > 0 && value.height > 0
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

function alignDown(value: number, alignment: number): number {
  return Math.floor(value / alignment) * alignment
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
