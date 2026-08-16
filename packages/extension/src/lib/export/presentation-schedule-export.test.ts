import { describe, expect, it, vi } from 'vitest'
import {
  createExportCompositeRenderRequest,
  isSourceFrameInLoadedWindow,
  writePresentationSchedule
} from './presentation-schedule-export'

describe('presentation schedule export', () => {
  it('renders only when the held source frame changes while writing every CFR sample', async () => {
    const renderSourceFrame = vi.fn(async () => {})
    const add = vi.fn(async () => {})

    const written = await writePresentationSchedule({
      schedule: [
        { sourceFrameIndex: 0, timestampSeconds: 0, durationSeconds: 0.5 },
        { sourceFrameIndex: 0, timestampSeconds: 0.5, durationSeconds: 0.5 },
        { sourceFrameIndex: 1, timestampSeconds: 1, durationSeconds: 0.5 },
        { sourceFrameIndex: 1, timestampSeconds: 1.5, durationSeconds: 0.5 },
        { sourceFrameIndex: 2, timestampSeconds: 2, durationSeconds: 0.25 }
      ],
      renderSourceFrame,
      videoSource: { add }
    })

    expect(written).toBe(5)
    expect(renderSourceFrame.mock.calls).toEqual([
      [0, { sourceFrameIndex: 0, timestampSeconds: 0, durationSeconds: 0.5 }, 0],
      [1, { sourceFrameIndex: 1, timestampSeconds: 1, durationSeconds: 0.5 }, 1_000],
      [2, { sourceFrameIndex: 2, timestampSeconds: 2, durationSeconds: 0.25 }, 2_000]
    ])
    expect(add.mock.calls).toEqual([
      [0, 0.5],
      [0.5, 0.5],
      [1, 0.5],
      [1.5, 0.5],
      [2, 0.25]
    ])
  })

  it('rerenders every output sample when a time-varying edit effect is active', async () => {
    const renderSourceFrame = vi.fn(async () => {})
    const add = vi.fn(async () => {})
    const schedule = [
      { sourceFrameIndex: 4, timestampSeconds: 0, durationSeconds: 0.25 },
      { sourceFrameIndex: 4, timestampSeconds: 0.25, durationSeconds: 0.25 },
      { sourceFrameIndex: 4, timestampSeconds: 0.5, durationSeconds: 0.25 }
    ]

    await writePresentationSchedule({
      schedule,
      hasTimeVaryingEffects: true,
      renderSourceFrame,
      videoSource: { add }
    })

    expect(renderSourceFrame.mock.calls).toEqual([
      [4, schedule[0], 0],
      [4, schedule[1], 250],
      [4, schedule[2], 500]
    ])
    expect(add).toHaveBeenCalledTimes(3)
  })

  it('builds renderAtTime for a schedule entry and seek for the legacy path', () => {
    expect(createExportCompositeRenderRequest({
      frameIndex: 7,
      requestId: 42,
      scheduleEntry: {
        sourceFrameIndex: 107,
        timestampSeconds: 1.25,
        durationSeconds: 1 / 30
      }
    })).toEqual({
      type: 'renderAtTime',
      data: {
        frameIndex: 7,
        presentationTimeMs: 1_250,
        requestId: 42
      }
    })

    expect(createExportCompositeRenderRequest({
      frameIndex: 7,
      requestId: 42
    })).toEqual({
      type: 'seek',
      data: { frameIndex: 7 }
    })
  })

  it('does not skip the first sample when rendering or encoding fails', async () => {
    await expect(writePresentationSchedule({
      schedule: [{ sourceFrameIndex: 0, timestampSeconds: 0, durationSeconds: 1 }],
      renderSourceFrame: async () => { throw new Error('frame zero unavailable') },
      videoSource: { add: async () => {} }
    })).rejects.toThrow('frame zero unavailable')
  })

  it('reuses the window that was decoded while initializing the export canvas', () => {
    const initializedWindow = { start: 0, count: 90 }

    expect(isSourceFrameInLoadedWindow(initializedWindow, 0)).toBe(true)
    expect(isSourceFrameInLoadedWindow(initializedWindow, 89)).toBe(true)
    expect(isSourceFrameInLoadedWindow(initializedWindow, 90)).toBe(false)
    expect(isSourceFrameInLoadedWindow({ start: -1, count: 0 }, 0)).toBe(false)
  })
})
