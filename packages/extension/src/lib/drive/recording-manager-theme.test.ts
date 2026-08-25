import { describe, expect, it } from 'vitest'
import {
  RECORDING_MANAGER_THEME_CONTRACT,
  resolveRecordingManagerMode
} from './recording-manager-theme'

describe('Recording Manager visual contract', () => {
  it('uses an adaptive browser-attached hierarchy with a wider library layout', () => {
    expect(RECORDING_MANAGER_THEME_CONTRACT).toMatchObject({
      source: 'browser-attached-product-surface',
      colorScheme: 'adaptive',
      defaultColorScheme: 'light',
      headerHeightPx: 56,
      contentMaxWidthPx: 1280,
      cardMinWidthPx: 260,
      dialogRadiusPx: 16,
      shellColor: '#f8fafc',
      panelColor: '#ffffff'
    })
  })

  it('uses a distinct selection mode only while recordings are selected', () => {
    expect(resolveRecordingManagerMode(0)).toBe('library')
    expect(resolveRecordingManagerMode(1)).toBe('selection')
    expect(resolveRecordingManagerMode(8)).toBe('selection')
  })
})
