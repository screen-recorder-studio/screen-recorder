export type PreviewDecodeSubmissionState = 'submit' | 'wait'

const DEFAULT_HIGH_WATERMARK = 8
const DEFAULT_LOW_WATERMARK = 4

export function previewDecodeBackpressureState(
  decodeQueueSize: number,
  wasWaiting: boolean,
  highWatermark = DEFAULT_HIGH_WATERMARK,
  lowWatermark = DEFAULT_LOW_WATERMARK
): PreviewDecodeSubmissionState {
  if (
    !Number.isFinite(decodeQueueSize)
    || decodeQueueSize < 0
    || !Number.isFinite(highWatermark)
    || !Number.isFinite(lowWatermark)
    || highWatermark < 1
    || lowWatermark < 0
    || lowWatermark >= highWatermark
  ) return 'wait'
  if (wasWaiting) return decodeQueueSize <= lowWatermark ? 'submit' : 'wait'
  return decodeQueueSize >= highWatermark ? 'wait' : 'submit'
}
