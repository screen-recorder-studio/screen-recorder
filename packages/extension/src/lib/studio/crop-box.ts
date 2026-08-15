export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedCropBox {
  enabled?: boolean
  mode?: 'pixels' | 'percentage'
  xPercent?: number
  yPercent?: number
  widthPercent?: number
  heightPercent?: number
  x?: number
  y?: number
  width?: number
  height?: number
}

export function resolveInitialCropBox(
  sourceWidth: number,
  sourceHeight: number,
  saved: SavedCropBox
): CropBox {
  const frameWidth = positiveInteger(sourceWidth)
  const frameHeight = positiveInteger(sourceHeight)

  if (!saved.enabled) return fullFrame(frameWidth, frameHeight)

  const candidate = saved.mode === 'pixels'
    ? {
        x: finiteNumber(saved.x),
        y: finiteNumber(saved.y),
        width: finiteNumber(saved.width),
        height: finiteNumber(saved.height)
      }
    : {
        x: finiteNumber(saved.xPercent) * frameWidth,
        y: finiteNumber(saved.yPercent) * frameHeight,
        width: finiteNumber(saved.widthPercent) * frameWidth,
        height: finiteNumber(saved.heightPercent) * frameHeight
      }

  const x = clamp(Math.round(candidate.x), 0, frameWidth - 1)
  const y = clamp(Math.round(candidate.y), 0, frameHeight - 1)
  const width = clamp(Math.round(candidate.width), 1, frameWidth - x)
  const height = clamp(Math.round(candidate.height), 1, frameHeight - y)

  return { x, y, width, height }
}

function fullFrame(width: number, height: number): CropBox {
  return { x: 0, y: 0, width, height }
}

function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 1
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
