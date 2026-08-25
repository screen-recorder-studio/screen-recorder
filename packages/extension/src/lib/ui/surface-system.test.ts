import { describe, expect, it } from 'vitest'
import {
  UI_SURFACE_CONTRACT,
  contrastRatio,
  resolveSurfaceTheme
} from './surface-system'

describe('product surface design contract', () => {
  it('keeps browser-attached surfaces light-first and adaptive', () => {
    expect(UI_SURFACE_CONTRACT.browser).toMatchObject({
      themeStrategy: 'adaptive',
      defaultColorScheme: 'light'
    })
    expect(resolveSurfaceTheme('browser', false)).toBe('light')
    expect(resolveSurfaceTheme('browser', true)).toBe('dark')
  })

  it('keeps the creative workspace deliberately dark', () => {
    expect(UI_SURFACE_CONTRACT.workspace).toMatchObject({
      themeStrategy: 'fixed',
      defaultColorScheme: 'dark'
    })
    expect(resolveSurfaceTheme('workspace', false)).toBe('dark')
  })

  it.each([
    ['browser light primary text', '#0f172a', '#ffffff', 4.5],
    ['browser light muted text', '#475569', '#ffffff', 4.5],
    ['browser dark primary text', '#f4f4f5', '#18181b', 4.5],
    ['browser dark muted text', '#a1a1aa', '#18181b', 4.5],
    ['workspace muted text', '#a1a1aa', '#18181b', 4.5],
    ['blue solid button', '#ffffff', '#2563eb', 4.5],
    ['violet solid button', '#ffffff', '#7c3aed', 4.5],
    ['red solid button', '#ffffff', '#dc2626', 4.5],
    ['browser light interactive border', '#64748b', '#ffffff', 3],
    ['browser dark interactive border', '#71717a', '#18181b', 3]
  ])('%s clears its WCAG contrast gate', (_name, foreground, background, minimum) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum)
  })
})
