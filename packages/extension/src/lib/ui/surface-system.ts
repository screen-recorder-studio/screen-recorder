export type ProductSurface = 'browser' | 'workspace' | 'marketing' | 'countdown'
export type SurfaceColorScheme = 'light' | 'dark'

export const UI_SURFACE_CONTRACT = Object.freeze({
  browser: {
    themeStrategy: 'adaptive',
    defaultColorScheme: 'light',
    surfaces: ['popup', 'control', 'recording-manager']
  },
  workspace: {
    themeStrategy: 'fixed',
    defaultColorScheme: 'dark',
    surfaces: ['studio']
  },
  marketing: {
    themeStrategy: 'fixed',
    defaultColorScheme: 'light',
    surfaces: ['welcome']
  },
  countdown: {
    themeStrategy: 'fixed',
    defaultColorScheme: 'dark',
    surfaces: ['countdown']
  },
  solidActions: {
    video: '#2563eb',
    gif: '#7c3aed',
    danger: '#dc2626'
  }
} as const)

export function resolveSurfaceTheme(surface: ProductSurface, prefersDark: boolean): SurfaceColorScheme {
  if (surface === 'browser') return prefersDark ? 'dark' : 'light'
  if (surface === 'marketing') return 'light'
  return 'dark'
}

function normalizeHex(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, '')
  const expanded = raw.length === 3 ? raw.split('').map((value) => `${value}${value}`).join('') : raw
  if (!/^[0-9a-f]{6}$/i.test(expanded)) throw new Error(`Unsupported color: ${hex}`)
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16)) as [number, number, number]
}

function linearize(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = normalizeHex(hex).map(linearize)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}
