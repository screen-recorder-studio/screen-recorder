import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const popupSource = readFileSync(new URL('../../routes/popup/+page.svelte', import.meta.url), 'utf8')
const labSource = readFileSync(new URL('../../routes/lab/ui-system/+page.svelte', import.meta.url), 'utf8')

function gifActionMarkup() {
  const clickHandlerIndex = popupSource.indexOf('onclick={startGifAreaSelection}')
  const buttonStartIndex = popupSource.lastIndexOf('<button', clickHandlerIndex)
  return popupSource.slice(buttonStartIndex, clickHandlerIndex)
}

describe('Action panel presentation contract', () => {
  it('presents GIF recording as a restrained browser action instead of a marketing card', () => {
    const markup = gifActionMarkup()

    expect(markup).toContain('border-gray-300')
    expect(markup).toContain('bg-white')
    expect(markup).toContain('text-gray-900')
    expect(markup).not.toMatch(/gradient|shadow|translate|scale-/)
  })

  it('keeps breathing room below the header divider and around the video divider', () => {
    expect(popupSource).toContain('<main class="px-4 pt-4 pb-4">')
    expect(popupSource).toContain('<div class="my-4 flex items-center gap-2">')
  })

  it('keeps the UI System Lab specimen aligned with the production treatment', () => {
    const gifRule = labSource.match(/\.gif-action \{[^}]+\}/)?.[0] ?? ''

    expect(gifRule).toContain('background: var(--surface-panel)')
    expect(gifRule).toContain('border: 1px solid var(--surface-interactive-border)')
    expect(gifRule).not.toContain('box-shadow')
  })
})
