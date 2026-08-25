import type { AreaRect, AreaSize } from './area-crop'

export const AREA_RECORDING_CONTEXT_STORAGE_KEY = 'areaRecordingContextV1'

export interface AreaSelectionSnapshot {
  rectCss: AreaRect
  viewportCss: AreaSize
  devicePixelRatio: number
  selectedAt: number
}

export interface AreaRecordingContext {
  version: 1
  operationId: string
  targetTabId: number
  targetDocumentId: string | null
  mode: 'area'
  intent: 'gif'
  countdown: number
  selection: AreaSelectionSnapshot | null
  createdAt: number
  updatedAt: number
}

export interface AreaRecordingContextStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}

export function createAreaRecordingContextStore(storage: AreaRecordingContextStorage) {
  let queue: Promise<void> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    load: () => enqueue(async () => {
      const value = await storage.get(AREA_RECORDING_CONTEXT_STORAGE_KEY)
      return normalizeContext(value[AREA_RECORDING_CONTEXT_STORAGE_KEY])
    }),
    save: (context: AreaRecordingContext) => enqueue(async () => {
      const normalized = normalizeContext(context)
      if (!normalized) throw new Error('AREA_CONTEXT_INVALID')
      await storage.set({ [AREA_RECORDING_CONTEXT_STORAGE_KEY]: normalized })
      return normalized
    }),
    clear: () => enqueue(() => storage.remove(AREA_RECORDING_CONTEXT_STORAGE_KEY))
  }
}

function normalizeContext(value: unknown): AreaRecordingContext | null {
  if (!isRecord(value) || value.version !== 1 || value.mode !== 'area' || value.intent !== 'gif') return null
  const operationId = nonEmptyString(value.operationId)
  const targetTabId = positiveInteger(value.targetTabId)
  const targetDocumentId = value.targetDocumentId === null ? null : nonEmptyString(value.targetDocumentId)
  const countdown = boundedInteger(value.countdown, 0, 5)
  const createdAt = nonNegativeInteger(value.createdAt)
  const updatedAt = nonNegativeInteger(value.updatedAt)
  if (!operationId || targetTabId === null
    || (value.targetDocumentId !== null && targetDocumentId === null) || countdown === null
    || createdAt === null || updatedAt === null) return null

  const selection = value.selection === null ? null : normalizeSelection(value.selection)
  if (value.selection !== null && !selection) return null
  return {
    version: 1,
    operationId,
    targetTabId,
    targetDocumentId,
    mode: 'area',
    intent: 'gif',
    countdown,
    selection,
    createdAt,
    updatedAt
  }
}

function normalizeSelection(value: unknown): AreaSelectionSnapshot | null {
  if (!isRecord(value)) return null
  const rectCss = normalizeRect(value.rectCss)
  const viewportCss = normalizeSize(value.viewportCss)
  const devicePixelRatio = positiveNumber(value.devicePixelRatio)
  const selectedAt = nonNegativeInteger(value.selectedAt)
  if (!rectCss || !viewportCss || devicePixelRatio === null || selectedAt === null) return null
  return { rectCss, viewportCss, devicePixelRatio, selectedAt }
}

function normalizeRect(value: unknown): AreaRect | null {
  if (!isRecord(value)) return null
  const x = finiteNumber(value.x)
  const y = finiteNumber(value.y)
  const width = positiveNumber(value.width)
  const height = positiveNumber(value.height)
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height }
}

function normalizeSize(value: unknown): AreaSize | null {
  if (!isRecord(value)) return null
  const width = positiveNumber(value.width)
  const height = positiveNumber(value.height)
  return width === null || height === null ? null : { width, height }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const result = value.trim()
  return result ? result : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function positiveNumber(value: unknown): number | null {
  const result = finiteNumber(value)
  return result !== null && result > 0 ? result : null
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
    ? value as number
    : null
}
