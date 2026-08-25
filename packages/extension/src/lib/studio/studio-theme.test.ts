import { describe, expect, it } from 'vitest'
import {
  STUDIO_THEME_CONTRACT,
  resolveStudioVisualAccent
} from './studio-theme'

describe('Studio visual contract', () => {
  it('keeps the chrome-covers Studio shell geometry and dark surface hierarchy', () => {
    expect(STUDIO_THEME_CONTRACT).toMatchObject({
      source: 'chrome-covers-studio',
      colorScheme: 'dark',
      headerHeightPx: 56,
      sidebarWidthPx: 320,
      dialogRadiusPx: 16,
      shellColor: '#09090b',
      panelColor: '#18181b'
    })
  })

  it('uses violet only for GIF-specific emphasis and blue for shared video actions', () => {
    expect(resolveStudioVisualAccent('gif')).toBe('violet')
    expect(resolveStudioVisualAccent('video')).toBe('blue')
    expect(resolveStudioVisualAccent('mp4')).toBe('blue')
    expect(resolveStudioVisualAccent('webm')).toBe('blue')
  })
})
