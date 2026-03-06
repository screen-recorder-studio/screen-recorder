// Shared WebCodecs configuration and probing utilities
// Provides robust codec selection, variant attempts, and bitrate computation.

export type UserEncoderConfig = {
  codec?: string
  width: number
  height: number
  framerate: number
  bitrate?: number
  latencyMode?: 'realtime' | 'quality'
  hardwareAcceleration?: 'prefer-hardware' | 'prefer-software' | 'no-preference'
  bitrateMode?: 'constant' | 'variable'
}

export type AppliedEncoderConfig = VideoEncoderConfig & {
  width: number
  height: number
  framerate: number
  bitrate?: number
}

export function even(v: number): number {
  return (v & 1) ? (v - 1) : v
}

export function align16Down(v: number): number {
  return (v >> 4) << 4
}

export function computeBitrate(width: number, height: number, fps: number, fallback = 4_000_000): number {
  // Bits-per-pixel baseline suitable for screen recording with text-heavy scenes
  const bpp = 0.09
  const est = Math.floor(width * height * fps * bpp)
  // Clamp to a sensible range
  return Math.max(2_000_000, Math.min(est, 25_000_000)) || fallback
}

function makeCommonBase(w: number, h: number, f: number, b?: number, opts?: Partial<UserEncoderConfig>) {
  const base: any = {
    width: w,
    height: h,
    framerate: f,
  }
  if (b != null) base.bitrate = b
  // Apply optional preferences if provided, otherwise keep them out to improve compatibility
  if (opts?.latencyMode) base.latencyMode = opts.latencyMode
  if (opts?.hardwareAcceleration) base.hardwareAcceleration = opts.hardwareAcceleration
  if (opts?.bitrateMode) base.bitrateMode = opts.bitrateMode
  return base
}

const H264_PROFILES = [
  'avc1.64002A', // High@L4.2
  'avc1.640028', // High@L4.0
  'avc1.64001F', // High@L3.1
  'avc1.4D4028', // Main@L4.0
  'avc1.4D401F', // Main@L3.1
  'avc1.42001E', // Baseline@L3.0
  'avc1.42E01E', // Baseline@L3.0 (alt)
]
const H264_FORMATS: Array<'annexb' | 'avc'> = ['annexb', 'avc']
const VP9_PROFILES = ['vp09.00.10.08', 'vp09.00.10.10', 'vp09', 'vp9']
const VP8_PROFILES = ['vp8']

function buildOrder(preference?: string): string[][] {
  const want = (preference || 'auto').toLowerCase()
  if (want === 'vp9' || want === 'vp9-first') return [VP9_PROFILES, H264_PROFILES, VP8_PROFILES]
  if (want === 'vp8') return [VP8_PROFILES, H264_PROFILES, VP9_PROFILES]
  // default: H.264-first
  return [H264_PROFILES, VP9_PROFILES, VP8_PROFILES]
}

async function tryConfigure(
  enc: VideoEncoder,
  codec: string,
  avcFormat: 'annexb' | 'avc' | undefined,
  base: any
): Promise<AppliedEncoderConfig | null> {
  const full = avcFormat ? { ...base, codec, avc: { format: avcFormat } } : { ...base, codec }
  try {
    const support = await VideoEncoder.isConfigSupported(full as VideoEncoderConfig)
    if (support?.supported) {
      enc.configure(full as VideoEncoderConfig)
      return { ...full } as AppliedEncoderConfig
    }
  } catch { /* continue to minimal */ }

  // minimal fallback: drop optional flags (latencyMode/hardwareAcceleration/bitrateMode already omitted unless provided)
  const { width: W, height: H, framerate: F, bitrate: B } = base
  const minimal = avcFormat ? { codec, width: W, height: H, framerate: F, bitrate: B, avc: { format: avcFormat } } : { codec, width: W, height: H, framerate: F, bitrate: B }
  try {
    const support2 = await VideoEncoder.isConfigSupported(minimal as VideoEncoderConfig)
    if (support2?.supported) {
      enc.configure(minimal as VideoEncoderConfig)
      return { ...minimal } as AppliedEncoderConfig
    }
  } catch {}

  // final minimal without avc block
  if (avcFormat) {
    const minimal2 = { codec, width: W, height: H, framerate: F, bitrate: B }
    try {
      const support3 = await VideoEncoder.isConfigSupported(minimal2 as VideoEncoderConfig)
      if (support3?.supported) {
        enc.configure(minimal2 as VideoEncoderConfig)
        return { ...minimal2 } as AppliedEncoderConfig
      }
    } catch {}
  }
  return null
}

export async function tryConfigureBestEncoder(
  enc: VideoEncoder,
  userCfg: UserEncoderConfig
): Promise<{ applied: AppliedEncoderConfig, selectedCodec: string }> {
  const width = even(Math.max(2, userCfg.width | 0))
  const height = even(Math.max(2, userCfg.height | 0))
  const framerate = Math.max(1, userCfg.framerate | 0)
  const bitrate = userCfg.bitrate ?? computeBitrate(width, height, framerate)

  const w16 = Math.max(2, align16Down(width))
  const h16 = Math.max(2, align16Down(height))
  const fpsVariants = Array.from(new Set([framerate, Math.min(30, framerate), 24]))

  const withOpts = (w: number, h: number, f: number, b?: number) => makeCommonBase(w, h, f, b, userCfg)

  const variantCommons: any[] = []
  for (const f of fpsVariants) {
    const b1 = userCfg.bitrate ?? computeBitrate(width, height, f)
    variantCommons.push(withOpts(width, height, f, b1))
    if (w16 !== width || h16 !== height) {
      const b2 = userCfg.bitrate ?? computeBitrate(w16, h16, f)
      variantCommons.push(withOpts(w16, h16, f, b2))
    }
  }

  const variantCommonsNoBitrate: any[] = []
  for (const f of fpsVariants) {
    variantCommonsNoBitrate.push(withOpts(width, height, f, undefined))
    if (w16 !== width || h16 !== height) variantCommonsNoBitrate.push(withOpts(w16, h16, f, undefined))
  }

  const order = buildOrder(userCfg.codec)

  for (const group of order) {
    // H.264 group
    if (group === H264_PROFILES) {
      for (const codec of H264_PROFILES) {
        for (const fmt of H264_FORMATS) {
          for (const base of variantCommons) {
            const applied = await tryConfigure(enc, codec, fmt, base)
            if (applied) return { applied, selectedCodec: codec }
          }
          for (const base of variantCommonsNoBitrate) {
            const applied2 = await tryConfigure(enc, codec, fmt, base)
            if (applied2) return { applied: applied2, selectedCodec: codec }
          }
        }
      }
      continue
    }
    // VP9 group
    if (group === VP9_PROFILES) {
      for (const codec of VP9_PROFILES) {
        for (const base of variantCommons) {
          const applied = await tryConfigure(enc, codec, undefined, base)
          if (applied) return { applied, selectedCodec: codec }
        }
        for (const base of variantCommonsNoBitrate) {
          const applied2 = await tryConfigure(enc, codec, undefined, base)
          if (applied2) return { applied: applied2, selectedCodec: codec }
        }
      }
      continue
    }
    // VP8 group
    if (group === VP8_PROFILES) {
      for (const codec of VP8_PROFILES) {
        for (const base of variantCommons) {
          const applied = await tryConfigure(enc, codec, undefined, base)
          if (applied) return { applied, selectedCodec: codec }
        }
        for (const base of variantCommonsNoBitrate) {
          const applied2 = await tryConfigure(enc, codec, undefined, base)
          if (applied2) return { applied: applied2, selectedCodec: codec }
        }
      }
      continue
    }
  }

  throw new Error(`No supported codec configuration (preference=${userCfg.codec || 'auto'}, ${width}x${height}@${framerate})`)
}