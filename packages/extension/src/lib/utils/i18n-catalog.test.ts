import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

type MessageEntry = {
  message?: string
  placeholders?: Record<string, { content?: string }>
}

const extensionRoot = join(import.meta.dirname, '../../..')
const sourceRoot = join(extensionRoot, 'src')
const localeRoot = join(extensionRoot, 'static/_locales')

function readCatalog(locale: string): Record<string, MessageEntry> {
  return JSON.parse(readFileSync(join(localeRoot, locale, 'messages.json'), 'utf8'))
}

function productSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const absolute = join(dir, name)
    const relativePath = relative(sourceRoot, absolute)
    if (relativePath.startsWith('routes/lab/')) return []
    if (statSync(absolute).isDirectory()) return productSourceFiles(absolute)
    if (!['.svelte', '.ts'].includes(extname(name)) || name.endsWith('.test.ts')) return []
    return [absolute]
  })
}

function literalTranslationKeys(): string[] {
  const keys = new Set<string>()
  for (const file of productSourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\b(?:t|gifText|areaText)\(\s*['"]([^'"]+)['"]/g)) {
      keys.add(match[1])
    }
  }
  return [...keys].sort()
}

function placeholderContents(entry: MessageEntry | undefined): string[] {
  return Object.values(entry?.placeholders || {})
    .map((placeholder) => placeholder.content || '')
    .sort()
}

describe('release locale catalogs', () => {
  const english = readCatalog('en')
  const simplifiedChinese = readCatalog('zh_CN')

  it('defines every literal product translation key in en and zh_CN', () => {
    const keys = literalTranslationKeys()
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((key) => !(key in english))).toEqual([])
    expect(keys.filter((key) => !(key in simplifiedChinese))).toEqual([])
  })

  it('keeps placeholder positions aligned across en and zh_CN', () => {
    const mismatches = Object.keys(english).flatMap((key) => {
      if (!(key in simplifiedChinese)) return []
      return JSON.stringify(placeholderContents(english[key])) === JSON.stringify(placeholderContents(simplifiedChinese[key]))
        ? []
        : [key]
    })
    expect(mismatches).toEqual([])
  })
})
