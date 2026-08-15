import { describe, expect, it, vi } from 'vitest'
import {
  buildTabCaptureConstraints,
  requestTabCaptureStreamId,
  resolveTabCaptureTargetId
} from './tab-capture'

describe('tab capture contract', () => {
  it('uses the tab explicitly selected by the invoking popup instead of another Chrome window', () => {
    expect(resolveTabCaptureTargetId(42, 99)).toBe(42)
  })

  it('falls back for legacy entry points that do not provide an invoking tab', () => {
    expect(resolveTabCaptureTargetId(undefined, 99)).toBe(99)
  })

  it('requests a one-time stream id for the active target tab', async () => {
    const getMediaStreamId = vi.fn().mockResolvedValue('stream-id')

    await expect(requestTabCaptureStreamId({ getMediaStreamId }, 42)).resolves.toBe('stream-id')
    expect(getMediaStreamId).toHaveBeenCalledWith({ targetTabId: 42 })
  })

  it('rejects before calling Chrome when no capturable target tab exists', async () => {
    const getMediaStreamId = vi.fn()

    await expect(requestTabCaptureStreamId({ getMediaStreamId }, null)).rejects.toMatchObject({
      code: 'TAB_CAPTURE_TARGET_UNAVAILABLE'
    })
    expect(getMediaStreamId).not.toHaveBeenCalled()
  })

  it('turns an empty Chrome response into an actionable failure', async () => {
    const getMediaStreamId = vi.fn().mockResolvedValue('')

    await expect(requestTabCaptureStreamId({ getMediaStreamId }, 42)).rejects.toMatchObject({
      code: 'TAB_CAPTURE_FAILED'
    })
  })

  it('preserves the Chrome failure as a diagnostic cause without exposing it as UI copy', async () => {
    const chromeFailure = new Error('Extension has not been invoked for the current page')
    const getMediaStreamId = vi.fn().mockRejectedValue(chromeFailure)

    await expect(requestTabCaptureStreamId({ getMediaStreamId }, 42)).rejects.toMatchObject({
      code: 'TAB_CAPTURE_FAILED',
      message: 'Current-tab recording could not be started',
      cause: chromeFailure
    })
  })

  it('builds the exact offscreen getUserMedia constraints without a picker', () => {
    expect(buildTabCaptureConstraints('stream-id', false)).toEqual({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: 'stream-id'
        }
      }
    })
  })

  it('uses the same one-time stream id for optional tab audio', () => {
    expect(buildTabCaptureConstraints('stream-id', true).audio).toEqual({
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: 'stream-id'
      }
    })
  })
})
