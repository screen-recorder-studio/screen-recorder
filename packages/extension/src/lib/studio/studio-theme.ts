export type StudioVisualAccentInput = 'video' | 'gif' | 'mp4' | 'webm'
export type StudioVisualAccent = 'blue' | 'violet'

/**
 * Stable visual contract inherited from the chrome-covers Studio shell.
 * Keep geometry here so layout changes are deliberate and testable.
 */
export const STUDIO_THEME_CONTRACT = Object.freeze({
  source: 'chrome-covers-studio',
  colorScheme: 'dark',
  headerHeightPx: 56,
  sidebarWidthPx: 320,
  dialogRadiusPx: 16,
  shellColor: '#09090b',
  panelColor: '#18181b'
} as const)

export function resolveStudioVisualAccent(input: StudioVisualAccentInput): StudioVisualAccent {
  return input === 'gif' ? 'violet' : 'blue'
}
