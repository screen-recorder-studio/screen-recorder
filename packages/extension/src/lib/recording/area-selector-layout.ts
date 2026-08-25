import type { AreaRect, AreaSize } from './area-crop'

export type AreaSelectorToolbarDock = 'top' | 'bottom'

const TOOLBAR_DOCK_GUARD_CSS_PX = 96

/**
 * The confirmation controls are viewport-docked instead of attached outside
 * the selection rectangle. Move them to the top whenever a bottom-edge
 * selection would cover the bottom dock.
 */
export function resolveAreaSelectorToolbarDock(
  rect: AreaRect,
  viewport: AreaSize
): AreaSelectorToolbarDock {
  const viewportHeight = finitePositive(viewport.height)
  const selectionBottom = finiteNonNegative(rect.y) + finiteNonNegative(rect.height)
  return selectionBottom > viewportHeight - TOOLBAR_DOCK_GUARD_CSS_PX ? 'top' : 'bottom'
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}
