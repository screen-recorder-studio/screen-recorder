export type StudioDeliveryProfile = 'video' | 'gif'

export function resolveStudioDeliveryProfile(input: {
  meta: unknown
  urlIntent: string | null
}): StudioDeliveryProfile {
  const meta = isRecord(input.meta) ? input.meta : null
  if (meta?.intent === 'gif' || (isRecord(meta?.capture) && meta.capture.intent === 'gif')) return 'gif'
  if (meta?.intent === 'video' || (isRecord(meta?.capture) && meta.capture.intent === 'video')) return 'video'
  return input.urlIntent === 'gif' ? 'gif' : 'video'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
