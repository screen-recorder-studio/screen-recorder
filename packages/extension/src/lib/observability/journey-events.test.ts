import { describe, expect, it } from 'vitest'
import {
  createJourneyState,
  recordJourneyEvent,
  sanitizeJourneyAttributes,
  type JourneyEventInput
} from './journey-events'

describe('journey event privacy boundary', () => {
  it('keeps only allow-listed, finite and normalized attributes', () => {
    const attributes = sanitizeJourneyAttributes({
      mode: 'tab',
      format: 'mp4',
      outcome: 'success',
      errorCode: ' permission denied ',
      durationMs: 1250.8,
      count: Number.NaN,
      bytes: Number.POSITIVE_INFINITY,
      url: 'https://private.example/path',
      filename: 'private-recording.mp4',
      message: 'raw operating-system error',
      stack: 'secret stack',
      selector: '#account'
    } as any)

    expect(attributes).toEqual({
      mode: 'tab',
      format: 'mp4',
      outcome: 'success',
      errorCode: 'PERMISSION_DENIED',
      durationMs: 1251
    })
    expect(JSON.stringify(attributes)).not.toContain('private')
    expect(JSON.stringify(attributes)).not.toContain('secret')
  })

  it('drops unsupported enum values and negative counters', () => {
    expect(sanitizeJourneyAttributes({
      mode: 'camera',
      format: 'avi',
      outcome: 'maybe',
      count: -1,
      fps: 0,
      width: -10
    } as any)).toEqual({})
  })
})

describe('journey event reducer', () => {
  const options = {
    now: () => 1_700_000_000_000,
    createJourneyId: () => 'journey-fixed'
  }

  it('starts a journey on recording.requested and correlates later events', () => {
    const first = recordJourneyEvent(
      createJourneyState(),
      { name: 'recording.requested', context: 'background', attributes: { mode: 'screen' } },
      options
    )
    const second = recordJourneyEvent(
      first,
      { name: 'capture.permission_granted', context: 'offscreen' },
      options
    )

    expect(first.activeJourneyId).toBe('journey-fixed')
    expect(first.events[0]).toMatchObject({
      schemaVersion: 1,
      sequence: 1,
      journeyId: 'journey-fixed',
      name: 'recording.requested'
    })
    expect(second.events[1].journeyId).toBe('journey-fixed')
    expect(second.nextSequence).toBe(3)
  })

  it('keeps popup entry and the accepted recording request in one journey', () => {
    const entered = recordJourneyEvent(
      createJourneyState(),
      { name: 'recording.entry_opened', context: 'popup' } as any,
      options
    )
    const requested = recordJourneyEvent(
      entered,
      { name: 'recording.requested', context: 'background', attributes: { mode: 'tab' } },
      options
    )

    expect(entered.events[0]).toMatchObject({
      name: 'recording.entry_opened',
      context: 'popup',
      journeyId: 'journey-fixed'
    })
    expect(requested.events[1].journeyId).toBe(entered.events[0].journeyId)
  })

  it('keeps only the newest events at the configured capacity', () => {
    let state = createJourneyState()
    const events: JourneyEventInput[] = [
      { name: 'recording.requested', context: 'background' },
      { name: 'capture.permission_requested', context: 'offscreen' },
      { name: 'capture.permission_granted', context: 'offscreen' },
      { name: 'recording.started', context: 'offscreen' }
    ]
    for (const event of events) state = recordJourneyEvent(state, event, { ...options, maxEvents: 3 })

    expect(state.events).toHaveLength(3)
    expect(state.events.map((event) => event.sequence)).toEqual([2, 3, 4])
  })
})
