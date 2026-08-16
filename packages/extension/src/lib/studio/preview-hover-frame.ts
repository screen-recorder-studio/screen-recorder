export type HoverDecodedFrameDecision = 'retain-target' | 'discard'

export interface HoverPreviewResponseIdentity {
  responseRequestId: number | null | undefined
  activeRequestId: number | null | undefined
  responseGeneration: number | null | undefined
  currentGeneration: number
  isPreviewMode: boolean
}

export function classifyHoverDecodedFrame(
  outputIndex: number,
  targetIndex: number
): HoverDecodedFrameDecision {
  if (!Number.isFinite(outputIndex) || !Number.isFinite(targetIndex)) return 'discard'
  const output = Math.floor(outputIndex)
  const target = Math.floor(targetIndex)
  if (output < 0 || target < 0) return 'discard'
  return output === target ? 'retain-target' : 'discard'
}

export function shouldAcceptHoverPreviewResponse(
  identity: HoverPreviewResponseIdentity
): boolean {
  return identity.isPreviewMode
    && Number.isInteger(identity.activeRequestId)
    && identity.responseRequestId === identity.activeRequestId
    && identity.responseGeneration === identity.currentGeneration
}
