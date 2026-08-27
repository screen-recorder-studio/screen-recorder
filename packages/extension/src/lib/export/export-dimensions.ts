import type { BackgroundConfig } from '../types/background'

export interface VideoSize {
  width: number
  height: number
}

type CompositionConfig = Partial<Pick<
  BackgroundConfig,
  'enabled' | 'outputRatio' | 'customWidth' | 'customHeight' | 'videoCrop'
>>

const STANDARD_COMPOSITION_SIZES: Record<Exclude<BackgroundConfig['outputRatio'], 'custom'>, VideoSize> = {
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 }
}

const FALLBACK_COMPOSITION_SIZE = STANDARD_COMPOSITION_SIZES['16:9']

export function resolveCompositionSize(
  config?: CompositionConfig | null,
  sourceSize?: VideoSize | null
): VideoSize {
  if (config?.outputRatio === 'custom') {
    const width = normalizeDimension(config.customWidth)
    const height = normalizeDimension(config.customHeight)
    if (width && height) return { width, height }
    return { ...FALLBACK_COMPOSITION_SIZE }
  }

  if (config?.enabled === false) {
    const sourceWidth = normalizeDimension(sourceSize?.width)
    const sourceHeight = normalizeDimension(sourceSize?.height)
    if (sourceWidth && sourceHeight) {
      return resolveEffectiveSourceSize(config, { width: sourceWidth, height: sourceHeight })
    }
  }

  const ratio = config?.outputRatio
  if (ratio && ratio in STANDARD_COMPOSITION_SIZES) {
    return { ...STANDARD_COMPOSITION_SIZES[ratio as keyof typeof STANDARD_COMPOSITION_SIZES] }
  }
  return { ...FALLBACK_COMPOSITION_SIZE }
}

export function hasCompositionSizeChanged(
  previous: CompositionConfig,
  next: CompositionConfig,
  sourceSize: VideoSize
): boolean {
  const previousSize = resolveCompositionSize(previous, sourceSize)
  const nextSize = resolveCompositionSize(next, sourceSize)
  return previousSize.width !== nextSize.width || previousSize.height !== nextSize.height
}

function resolveEffectiveSourceSize(config: CompositionConfig, sourceSize: VideoSize): VideoSize {
  const crop = config.videoCrop
  if (!crop?.enabled) return { ...sourceSize }

  if (crop.mode === 'percentage') {
    return {
      width: Math.max(1, Math.floor(sourceSize.width * clampUnit(crop.widthPercent))),
      height: Math.max(1, Math.floor(sourceSize.height * clampUnit(crop.heightPercent)))
    }
  }

  return {
    width: Math.min(sourceSize.width, normalizeDimension(crop.width) ?? sourceSize.width),
    height: Math.min(sourceSize.height, normalizeDimension(crop.height) ?? sourceSize.height)
  }
}

function clampUnit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}

export function resolveExportDialogSourceInfo<T extends { width: number; height: number }>(
  captureInfo: T,
  compositionSize: VideoSize
): T {
  return {
    ...captureInfo,
    width: compositionSize.width,
    height: compositionSize.height
  }
}

export function buildExportDimensions<T extends Record<string, unknown>>(
  backgroundConfig: T,
  requestedSize: VideoSize
): {
  resolution: VideoSize
  backgroundConfig: T & {
    outputRatio: 'custom'
    customWidth: number
    customHeight: number
  }
} {
  const width = normalizeDimension(requestedSize.width) || FALLBACK_COMPOSITION_SIZE.width
  const height = normalizeDimension(requestedSize.height) || FALLBACK_COMPOSITION_SIZE.height

  return {
    resolution: { width, height },
    backgroundConfig: {
      ...backgroundConfig,
      outputRatio: 'custom',
      customWidth: width,
      customHeight: height
    }
  }
}

function normalizeDimension(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.floor(value)
}
