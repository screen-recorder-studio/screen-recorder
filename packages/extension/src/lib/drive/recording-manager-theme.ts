export type RecordingManagerMode = 'library' | 'selection'

/**
 * Recording Manager is launched from the browser extension, so it uses the
 * light-first adaptive product surface rather than inheriting Studio's fixed
 * dark canvas. Geometry remains stable and testable.
 */
export const RECORDING_MANAGER_THEME_CONTRACT = Object.freeze({
  source: 'browser-attached-product-surface',
  colorScheme: 'adaptive',
  defaultColorScheme: 'light',
  headerHeightPx: 56,
  contentMaxWidthPx: 1280,
  cardMinWidthPx: 260,
  dialogRadiusPx: 16,
  shellColor: '#f8fafc',
  panelColor: '#ffffff'
} as const)

export function resolveRecordingManagerMode(selectedCount: number): RecordingManagerMode {
  return selectedCount > 0 ? 'selection' : 'library'
}
