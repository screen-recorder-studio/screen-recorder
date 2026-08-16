export interface TabCaptureApiLike {
  getMediaStreamId(options: { targetTabId: number }): Promise<string>
}

export interface TabCaptureMediaConstraints {
  audio: false | {
    mandatory: {
      chromeMediaSource: 'tab'
      chromeMediaSourceId: string
    }
  }
  video: {
    mandatory: {
      chromeMediaSource: 'tab'
      chromeMediaSourceId: string
    }
  }
}

export function resolveTabCaptureTargetId(
  invokingTabId: number | null | undefined,
  fallbackTabId: number | null | undefined
): number | null {
  if (Number.isInteger(invokingTabId) && Number(invokingTabId) > 0) return Number(invokingTabId)
  if (Number.isInteger(fallbackTabId) && Number(fallbackTabId) > 0) return Number(fallbackTabId)
  return null
}

export async function requestTabCaptureStreamId(
  api: TabCaptureApiLike | undefined,
  targetTabId: number | null | undefined
): Promise<string> {
  if (!Number.isInteger(targetTabId) || Number(targetTabId) <= 0) {
    throw codedError('No active browser tab is available to record', 'TAB_CAPTURE_TARGET_UNAVAILABLE')
  }
  if (!api || typeof api.getMediaStreamId !== 'function') {
    throw codedError('Current-tab recording is not supported by this browser', 'TAB_CAPTURE_NOT_SUPPORTED')
  }

  try {
    const streamId = await api.getMediaStreamId({ targetTabId: Number(targetTabId) })
    if (typeof streamId !== 'string' || streamId.trim() === '') {
      throw codedError('Chrome did not return a current-tab capture stream', 'TAB_CAPTURE_FAILED')
    }
    return streamId
  } catch (error) {
    if (typeof (error as any)?.code === 'string') throw error
    throw codedError('Current-tab recording could not be started', 'TAB_CAPTURE_FAILED', error)
  }
}

export function buildTabCaptureConstraints(
  streamId: string,
  includeAudio: boolean
): TabCaptureMediaConstraints {
  if (typeof streamId !== 'string' || streamId.trim() === '') {
    throw codedError('The current-tab capture stream expired', 'TAB_CAPTURE_STREAM_INVALID')
  }

  const mandatory = {
    chromeMediaSource: 'tab' as const,
    chromeMediaSourceId: streamId
  }
  return {
    audio: includeAudio ? { mandatory: { ...mandatory } } : false,
    video: { mandatory: { ...mandatory } }
  }
}

function codedError(message: string, code: string, cause?: unknown): Error & { code: string; cause?: unknown } {
  return Object.assign(new Error(message), { code, ...(cause === undefined ? {} : { cause }) })
}
