interface VideoTrackOutputLike {
  addVideoTrack(source: unknown, metadata?: { frameRate?: number }): unknown
}

/**
 * Registers the encoded video track with an explicit cadence. Matroska/WebM
 * stores this as DefaultDuration, which is required to recover the duration of
 * a final SimpleBlock because there is no following timestamp to infer it from.
 */
export function addVideoTrackWithTiming(
  output: VideoTrackOutputLike,
  source: unknown,
  frameRate: number
) {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new TypeError('frameRate must be a positive finite number')
  }

  return output.addVideoTrack(source, { frameRate })
}
