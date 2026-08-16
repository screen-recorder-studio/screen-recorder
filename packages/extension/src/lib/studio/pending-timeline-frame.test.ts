import { describe, expect, it } from 'vitest'
import { decidePendingTimelineFrame } from './pending-timeline-frame'

describe('decidePendingTimelineFrame', () => {
  it('suppresses transient frames until the requested global frame arrives', () => {
    expect(decidePendingTimelineFrame({
      targetGlobalFrame: 467,
      frameWindowStartIndex: 420,
      frameIndex: 0,
      windowFrameCount: 90
    })).toEqual({
      action: 'suppress',
      displayedGlobalFrame: 420,
      targetLocalFrame: 47
    })

    expect(decidePendingTimelineFrame({
      targetGlobalFrame: 467,
      frameWindowStartIndex: 420,
      frameIndex: 47,
      windowFrameCount: 90
    })).toEqual({
      action: 'display-target',
      displayedGlobalFrame: 467,
      targetLocalFrame: 47
    })
  })

  it('never treats frame zero as success when the target is outside a stale window', () => {
    expect(decidePendingTimelineFrame({
      targetGlobalFrame: 467,
      frameWindowStartIndex: 0,
      frameIndex: 0,
      windowFrameCount: 140
    })).toEqual({
      action: 'target-outside-window',
      displayedGlobalFrame: 0,
      targetLocalFrame: 467
    })
  })

  it('displays normal frames when no seek is pending', () => {
    expect(decidePendingTimelineFrame({
      targetGlobalFrame: null,
      frameWindowStartIndex: 420,
      frameIndex: 5,
      windowFrameCount: 90
    })).toEqual({
      action: 'display',
      displayedGlobalFrame: 425,
      targetLocalFrame: null
    })
  })
})
