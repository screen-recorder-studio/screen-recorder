export const JOURNEY_SCHEMA_VERSION = 1 as const
export const DEFAULT_MAX_JOURNEY_EVENTS = 200

export type JourneyEventName =
  | 'recording.entry_opened'
  | 'recording.requested'
  | 'capture.permission_requested'
  | 'capture.permission_granted'
  | 'capture.permission_denied'
  | 'capture.failed'
  | 'recording.started'
  | 'recording.paused'
  | 'recording.resumed'
  | 'recording.stop_requested'
  | 'recording.failed'
  | 'storage.ready'
  | 'storage.finalize_started'
  | 'storage.finalized'
  | 'storage.failed'
  | 'studio.load_started'
  | 'studio.data_ready'
  | 'studio.first_frame_visible'
  | 'studio.load_failed'
  | 'export.started'
  | 'export.completed'
  | 'export.failed'
  | 'export.cancel_requested'
  | 'export.cancelled'
  | 'download.started'
  | 'download.completed'
  | 'download.failed'

export type JourneyContext = 'popup' | 'background' | 'offscreen' | 'studio' | 'export'

export interface JourneyAttributes {
  mode?: 'tab' | 'window' | 'screen'
  format?: 'mp4' | 'webm' | 'gif'
  stage?: string
  outcome?: 'success' | 'failure' | 'cancelled'
  errorCode?: string
  durationMs?: number
  count?: number
  bytes?: number
  width?: number
  height?: number
  fps?: number
}

export interface JourneyEventInput {
  name: JourneyEventName
  context: JourneyContext
  attributes?: JourneyAttributes
}

export interface JourneyEvent {
  schemaVersion: typeof JOURNEY_SCHEMA_VERSION
  sequence: number
  journeyId: string
  name: JourneyEventName
  context: JourneyContext
  occurredAt: number
  attributes: JourneyAttributes
}

export interface JourneyState {
  activeJourneyId: string | null
  nextSequence: number
  events: JourneyEvent[]
}

export interface RecordJourneyOptions {
  now?: () => number
  createJourneyId?: () => string
  maxEvents?: number
}

const EVENT_NAMES = new Set<JourneyEventName>([
  'recording.entry_opened',
  'recording.requested',
  'capture.permission_requested',
  'capture.permission_granted',
  'capture.permission_denied',
  'capture.failed',
  'recording.started',
  'recording.paused',
  'recording.resumed',
  'recording.stop_requested',
  'recording.failed',
  'storage.ready',
  'storage.finalize_started',
  'storage.finalized',
  'storage.failed',
  'studio.load_started',
  'studio.data_ready',
  'studio.first_frame_visible',
  'studio.load_failed',
  'export.started',
  'export.completed',
  'export.failed',
  'export.cancel_requested',
  'export.cancelled',
  'download.started',
  'download.completed',
  'download.failed'
])
const CONTEXTS = new Set<JourneyContext>(['popup', 'background', 'offscreen', 'studio', 'export'])
const MODES = new Set(['tab', 'window', 'screen'])
const FORMATS = new Set(['mp4', 'webm', 'gif'])
const OUTCOMES = new Set(['success', 'failure', 'cancelled'])
const STAGE_PATTERN = /^[a-z][a-z0-9_.-]{0,31}$/
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/

function normalizePositiveNumber(value: unknown, allowZero = true): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (allowZero ? value < 0 : value <= 0) return undefined
  return Math.round(value)
}

function normalizeErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return ERROR_CODE_PATTERN.test(normalized) ? normalized : undefined
}

export function sanitizeJourneyAttributes(input: Record<string, unknown> | JourneyAttributes | undefined): JourneyAttributes {
  if (!input || typeof input !== 'object') return {}
  const output: JourneyAttributes = {}

  if (typeof input.mode === 'string' && MODES.has(input.mode)) output.mode = input.mode as JourneyAttributes['mode']
  if (typeof input.format === 'string' && FORMATS.has(input.format)) output.format = input.format as JourneyAttributes['format']
  if (typeof input.outcome === 'string' && OUTCOMES.has(input.outcome)) output.outcome = input.outcome as JourneyAttributes['outcome']
  if (typeof input.stage === 'string' && STAGE_PATTERN.test(input.stage)) output.stage = input.stage

  const errorCode = normalizeErrorCode(input.errorCode)
  if (errorCode) output.errorCode = errorCode

  const durationMs = normalizePositiveNumber(input.durationMs)
  const count = normalizePositiveNumber(input.count)
  const bytes = normalizePositiveNumber(input.bytes)
  const width = normalizePositiveNumber(input.width, false)
  const height = normalizePositiveNumber(input.height, false)
  const fps = normalizePositiveNumber(input.fps, false)
  if (durationMs !== undefined) output.durationMs = durationMs
  if (count !== undefined) output.count = count
  if (bytes !== undefined) output.bytes = bytes
  if (width !== undefined) output.width = width
  if (height !== undefined) output.height = height
  if (fps !== undefined) output.fps = fps

  return output
}

function defaultJourneyId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {}
  return `journey-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createJourneyState(seed?: Partial<JourneyState> | null): JourneyState {
  const events = Array.isArray(seed?.events) ? seed.events.filter((event) => event && typeof event === 'object') : []
  const highestSequence = events.reduce((highest, event) => Math.max(highest, Number(event.sequence) || 0), 0)
  const nextSequence = typeof seed?.nextSequence === 'number' && Number.isFinite(seed.nextSequence)
    ? Math.max(highestSequence + 1, Math.floor(seed.nextSequence))
    : highestSequence + 1
  return {
    activeJourneyId: typeof seed?.activeJourneyId === 'string' && seed.activeJourneyId ? seed.activeJourneyId : null,
    nextSequence: Math.max(1, nextSequence),
    events: events as JourneyEvent[]
  }
}

export function isJourneyEventInput(value: unknown): value is JourneyEventInput {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<JourneyEventInput>
  return EVENT_NAMES.has(candidate.name as JourneyEventName)
    && CONTEXTS.has(candidate.context as JourneyContext)
}

export function recordJourneyEvent(
  currentState: JourneyState,
  input: JourneyEventInput,
  options: RecordJourneyOptions = {}
): JourneyState {
  if (!isJourneyEventInput(input)) return currentState
  const now = options.now ?? Date.now
  const createJourneyId = options.createJourneyId ?? defaultJourneyId
  const maxEvents = Math.max(1, Math.floor(options.maxEvents ?? DEFAULT_MAX_JOURNEY_EVENTS))
  const startsNewJourney = input.name === 'recording.entry_opened'
  const journeyId = startsNewJourney || !currentState.activeJourneyId
    ? createJourneyId()
    : currentState.activeJourneyId
  const sequence = Math.max(1, Math.floor(currentState.nextSequence || 1))
  const event: JourneyEvent = {
    schemaVersion: JOURNEY_SCHEMA_VERSION,
    sequence,
    journeyId,
    name: input.name,
    context: input.context,
    occurredAt: Math.max(0, Math.floor(now())),
    attributes: sanitizeJourneyAttributes(input.attributes)
  }
  const events = [...currentState.events, event]
  return {
    activeJourneyId: journeyId,
    nextSequence: sequence + 1,
    events: events.length > maxEvents ? events.slice(events.length - maxEvents) : events
  }
}

export function emitJourneyEvent(input: JourneyEventInput): void {
  try {
    const runtime = (globalThis as any)?.chrome?.runtime
    if (!runtime?.sendMessage) return
    const result = runtime.sendMessage({ target: 'journey-observer', type: 'JOURNEY_EVENT', event: input })
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {}
}
