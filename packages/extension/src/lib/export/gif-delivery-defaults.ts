const EMAIL_MAX_WIDTH_PX = 600
const SCALE_PRESETS = [100, 75, 50, 25] as const

export interface GifDeliveryDefaults {
  fps: number
  scalePercent: number
  repeat: number
}

export function resolveGifDeliveryDefaults(sourceWidth: number): GifDeliveryDefaults {
  const width = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : EMAIL_MAX_WIDTH_PX
  const scalePercent = SCALE_PRESETS.find((scale) => width * scale / 100 <= EMAIL_MAX_WIDTH_PX)
    ?? SCALE_PRESETS.at(-1)!
  return { fps: 10, scalePercent, repeat: 2 }
}
