export const GIF_AUTO_WORKERS = 2

export const GIF_LOOP_OPTIONS = [
  { value: 0, totalPlays: null, label: 'Forever' },
  { value: -1, totalPlays: 1, label: 'Play once' },
  { value: 1, totalPlays: 2, label: 'Play twice' },
  { value: 2, totalPlays: 3, label: 'Play 3 times' }
] as const

export interface GifOutputSizeOption {
  id: 'source' | 'email' | 'compact' | 'small'
  label: string
  width: number
  height: number
  scalePercent: number
}

const OUTPUT_TARGETS = [
  { id: 'email', label: 'Email width', width: 600 },
  { id: 'compact', label: 'Compact', width: 480 },
  { id: 'small', label: 'Small', width: 320 }
] as const

export function resolveGifOutputSizeOptions(
  sourceWidth: number,
  sourceHeight: number
): GifOutputSizeOption[] {
  const width = positiveDimension(sourceWidth)
  const height = positiveDimension(sourceHeight)
  const options: GifOutputSizeOption[] = [{
    id: 'source',
    label: 'Original',
    width,
    height,
    scalePercent: 100
  }]

  for (const target of OUTPUT_TARGETS) {
    if (target.width >= width) continue
    const scalePercent = (target.width / width) * 100
    const scaledSize = resolveGifScaledDimensions(width, height, scalePercent / 100)
    options.push({
      id: target.id,
      label: target.label,
      width: scaledSize.width,
      height: scaledSize.height,
      scalePercent
    })
  }

  return options
}

export function resolveGifScaledDimensions(
  sourceWidth: number,
  sourceHeight: number,
  scale: number
): { width: number; height: number } {
  const width = positiveDimension(sourceWidth)
  const height = positiveDimension(sourceHeight)
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1

  return {
    width: Math.max(1, Math.round(width * normalizedScale)),
    height: Math.max(1, Math.round(height * normalizedScale))
  }
}

function positiveDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
}
