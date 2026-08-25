import { describe, expect, it } from 'vitest'
import { resolveAreaSelectorToolbarDock } from './area-selector-layout'

describe('area selector toolbar layout', () => {
  const viewport = { width: 1_200, height: 800 }

  it('keeps the confirmation toolbar at the bottom when that dock is unobstructed', () => {
    expect(resolveAreaSelectorToolbarDock({ x: 120, y: 100, width: 640, height: 360 }, viewport)).toBe('bottom')
  })

  it('moves the toolbar to the top when a bottom-edge selection would cover it', () => {
    expect(resolveAreaSelectorToolbarDock({ x: 80, y: 520, width: 720, height: 270 }, viewport)).toBe('top')
  })

  it('keeps controls visible for a full-viewport selection', () => {
    expect(resolveAreaSelectorToolbarDock({ x: 0, y: 0, width: 1_200, height: 800 }, viewport)).toBe('top')
  })
})
