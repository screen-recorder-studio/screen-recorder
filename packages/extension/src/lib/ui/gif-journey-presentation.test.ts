import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const backgroundPickerSource = readFileSync(
  new URL('../components/BackgroundPicker/index.svelte', import.meta.url),
  'utf8'
)
const studioSource = readFileSync(new URL('../../routes/studio/+page.svelte', import.meta.url), 'utf8')
const exportDialogSource = readFileSync(
  new URL('../components/UnifiedExportDialog.svelte', import.meta.url),
  'utf8'
)
const previewCompositeSource = readFileSync(
  new URL('../components/VideoPreviewComposite.svelte', import.meta.url),
  'utf8'
)

describe('GIF user-journey presentation contract', () => {
  it('offers an explicit, reversible original-frame mode', () => {
    expect(backgroundPickerSource).toContain("t('bg_original_frame')")
    expect(backgroundPickerSource).toContain("t('bg_styled_canvas')")
    expect(backgroundPickerSource).toContain('aria-pressed={!backgroundEnabled}')
    expect(backgroundPickerSource).toContain('backgroundConfigStore.updateEnabled(false)')
  })

  it('removes inapplicable framing controls when original-frame mode is active', () => {
    expect(studioSource).toContain("backgroundConfigStore.config.enabled !== false")
    expect(studioSource).toContain('<BorderRadiusControl />')
    expect(studioSource).toContain('<PaddingControl />')
    expect(studioSource).toContain('<ShadowControl />')
  })

  it('forwards original-frame mode during live background updates', () => {
    const updateConfigSource = previewCompositeSource.slice(
      previewCompositeSource.indexOf('async function updateBackgroundConfig'),
      previewCompositeSource.indexOf('// Reactive processing')
    )

    expect(updateConfigSource).toContain('enabled: newConfig.enabled !== false')
  })

  it('keeps outcome settings primary and engineering settings out of the basic form', () => {
    expect(exportDialogSource).toContain("t('export_label_output_size')")
    expect(exportDialogSource).toContain("t('export_gif_compression_title')")
    expect(exportDialogSource).toContain("t('export_gif_advanced_colors')")
    expect(exportDialogSource).not.toContain('id="gif-workers"')
  })
})
