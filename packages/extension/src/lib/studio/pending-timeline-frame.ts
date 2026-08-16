export interface PendingTimelineFrameDecision {
  action: 'display' | 'display-target' | 'suppress' | 'target-outside-window'
  displayedGlobalFrame: number
  targetLocalFrame: number | null
}

export function decidePendingTimelineFrame(input: {
  targetGlobalFrame: number | null
  frameWindowStartIndex: number
  frameIndex: number
  windowFrameCount: number
}): PendingTimelineFrameDecision {
  const displayedGlobalFrame = input.frameWindowStartIndex + input.frameIndex
  if (input.targetGlobalFrame === null) {
    return { action: 'display', displayedGlobalFrame, targetLocalFrame: null }
  }

  const targetLocalFrame = input.targetGlobalFrame - input.frameWindowStartIndex
  if (targetLocalFrame < 0 || targetLocalFrame >= input.windowFrameCount) {
    return { action: 'target-outside-window', displayedGlobalFrame, targetLocalFrame }
  }
  if (displayedGlobalFrame !== input.targetGlobalFrame) {
    return { action: 'suppress', displayedGlobalFrame, targetLocalFrame }
  }
  return { action: 'display-target', displayedGlobalFrame, targetLocalFrame }
}
