import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const labSource = readFileSync(new URL('../../../test-pages/ui-system-lab/ui-system.svelte', import.meta.url), 'utf8')

describe('UI System Lab coverage', () => {
  it.each([
    'browser-light',
    'browser-dark',
    'workspace-dark',
    'default',
    'hover',
    'focus',
    'disabled',
    'busy',
    'empty',
    'error',
    'long-copy',
    'reduced-motion'
  ])('contains the %s fixture', (fixture) => {
    const renderedFixture = `data-fixture="${fixture}"`
    const themeFixture = `id: '${fixture}'`
    expect(labSource.includes(renderedFixture) || labSource.includes(themeFixture)).toBe(true)
  })

  it('identifies itself as a development-only accessibility lab', () => {
    expect(labSource).toContain('data-development-only="true"')
    expect(labSource).toContain('UI System Lab')
  })
})
