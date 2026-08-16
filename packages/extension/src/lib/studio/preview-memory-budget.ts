const MEBIBYTE = 1024 * 1024
const RGBA_BYTES_PER_PIXEL = 4
const MIN_MAIN_RUNWAY_SECONDS = 2
const MIN_NEXT_RUNWAY_SECONDS = 2
const TRANSIENT_HEADROOM_RATIO = 0.25

export type PreviewMemoryTier = 'conservative' | 'standard'

export interface PreviewMemoryBudgetInput {
  sourceWidth: number
  sourceHeight: number
  fps: number
  deviceMemoryGB?: number | null
  mainRunwaySeconds?: number
  nextRunwaySeconds?: number
}

export interface PreviewMemoryBudgetPlan {
  memoryTier: PreviewMemoryTier
  retainedBudgetBytes: number
  transientHeadroomBytes: number
  totalWorkingSetBudgetBytes: number
  mainRunwaySeconds: number
  nextRunwaySeconds: number
  mainFrameCapacity: number
  nextFrameCapacity: number
  retainedFrameCapacity: number
  previewWidth: number
  previewHeight: number
  estimatedRetainedBytes: number
  scale: number
  usesProxy: boolean
}

export interface PreviewMemoryTelemetry extends PreviewMemoryBudgetPlan {
  sourceDisplayWidth: number
  sourceDisplayHeight: number
  decodeQueueHighWatermark: number
  decodeQueueLowWatermark: number
  windowGeneration: number
}

export function createPreviewMemoryTelemetry(input: {
  plan: PreviewMemoryBudgetPlan
  sourceDisplayWidth: number
  sourceDisplayHeight: number
  decodeQueueHighWatermark: number
  decodeQueueLowWatermark: number
  windowGeneration: number
}): PreviewMemoryTelemetry {
  const { plan, ...telemetry } = input
  return { ...plan, ...telemetry }
}

/**
 * Plans a deterministic retained-frame budget for preview caches. The caller
 * supplies the (possibly unavailable) device-memory hint so this module stays
 * pure and can use the conservative tier whenever that hint is unknown.
 */
export function planPreviewMemoryBudget(
  input: PreviewMemoryBudgetInput
): PreviewMemoryBudgetPlan | null {
  if (!isValidSourceInput(input)) return null

  const sourceWidth = Math.floor(input.sourceWidth)
  const sourceHeight = Math.floor(input.sourceHeight)
  if (sourceWidth < 2 || sourceHeight < 2) return null

  const memoryTier: PreviewMemoryTier = Number.isFinite(input.deviceMemoryGB)
    && Number(input.deviceMemoryGB) >= 8
    ? 'standard'
    : 'conservative'
  const retainedBudgetBytes = memoryTier === 'standard'
    ? 512 * MEBIBYTE
    : 256 * MEBIBYTE
  const transientHeadroomBytes = retainedBudgetBytes * TRANSIENT_HEADROOM_RATIO

  const mainRunwaySeconds = normalizeRunway(
    input.mainRunwaySeconds,
    MIN_MAIN_RUNWAY_SECONDS
  )
  const nextRunwaySeconds = normalizeRunway(
    input.nextRunwaySeconds,
    MIN_NEXT_RUNWAY_SECONDS
  )
  const mainFrameCapacity = Math.ceil(input.fps * mainRunwaySeconds)
  const nextFrameCapacity = Math.ceil(input.fps * nextRunwaySeconds)
  const retainedFrameCapacity = mainFrameCapacity + nextFrameCapacity
  const maxPixelsPerFrame = Math.floor(
    retainedBudgetBytes / (RGBA_BYTES_PER_PIXEL * retainedFrameCapacity)
  )
  const dimensions = fitEvenPreviewDimensions(
    sourceWidth,
    sourceHeight,
    maxPixelsPerFrame
  )
  if (!dimensions) return null

  const estimatedRetainedBytes = dimensions.width
    * dimensions.height
    * RGBA_BYTES_PER_PIXEL
    * retainedFrameCapacity

  return {
    memoryTier,
    retainedBudgetBytes,
    transientHeadroomBytes,
    totalWorkingSetBudgetBytes: retainedBudgetBytes + transientHeadroomBytes,
    mainRunwaySeconds,
    nextRunwaySeconds,
    mainFrameCapacity,
    nextFrameCapacity,
    retainedFrameCapacity,
    previewWidth: dimensions.width,
    previewHeight: dimensions.height,
    estimatedRetainedBytes,
    scale: Math.min(
      dimensions.width / sourceWidth,
      dimensions.height / sourceHeight
    ),
    usesProxy: dimensions.width !== sourceWidth || dimensions.height !== sourceHeight
  }
}

function isValidSourceInput(input: PreviewMemoryBudgetInput): boolean {
  return [input.sourceWidth, input.sourceHeight, input.fps].every(Number.isFinite)
    && input.sourceWidth >= 2
    && input.sourceHeight >= 2
    && input.fps > 0
}

function normalizeRunway(value: number | undefined, minimum: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.max(minimum, Number(value))
    : minimum
}

function fitEvenPreviewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxPixels: number
): { width: number; height: number } | null {
  if (maxPixels < 4) return null

  const fullSize = dimensionsAtScale(sourceWidth, sourceHeight, 1)
  if (fullSize && fullSize.width * fullSize.height <= maxPixels) return fullSize

  let lowerScale = 0
  let upperScale = 1
  let best: { width: number; height: number } | null = null

  for (let iteration = 0; iteration < 48; iteration++) {
    const scale = (lowerScale + upperScale) / 2
    const candidate = dimensionsAtScale(sourceWidth, sourceHeight, scale)
    if (candidate && candidate.width * candidate.height <= maxPixels) {
      best = candidate
      lowerScale = scale
    } else {
      upperScale = scale
    }
  }

  return best
}

function dimensionsAtScale(
  sourceWidth: number,
  sourceHeight: number,
  scale: number
): { width: number; height: number } | null {
  const width = floorEven(sourceWidth * scale)
  const height = floorEven(sourceHeight * scale)
  return width >= 2 && height >= 2 ? { width, height } : null
}

function floorEven(value: number): number {
  return Math.floor(value / 2) * 2
}
