const EMAIL_MAX_WIDTH_PX = 600

export interface GifDeliveryDefaults {
  fps: number
  scalePercent: number
  repeat: number
}

export function resolveGifDeliveryDefaults(sourceWidth: number): GifDeliveryDefaults {
  const width = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : EMAIL_MAX_WIDTH_PX
  const scalePercent = Math.min(100, (EMAIL_MAX_WIDTH_PX / width) * 100)
  return { fps: 10, scalePercent, repeat: 2 }
}
