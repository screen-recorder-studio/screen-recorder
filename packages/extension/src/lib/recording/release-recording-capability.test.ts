import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const releaseDescription = (locale: 'en' | 'zh' | 'ru') => {
  const relativePath = locale === 'zh'
    ? '../../../../../docs/release/detailed-description.md'
    : `../../../../../docs/release/${locale}/detailed-description.md`
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('release recording capability claims', () => {
  it('describes the balanced capture limit and keeps 4K as an export capability in English', () => {
    const description = releaseDescription('en')

    expect(description).toContain('Balanced recording up to 1920×1080 at 30 FPS')
    expect(description).toContain('Export resolutions up to 4K')
    expect(description).not.toContain('Record in resolutions from SD to 4K')
  })

  it('describes the same capture/export boundary in Chinese', () => {
    const description = releaseDescription('zh')

    expect(description).toContain('均衡录制最高为 1920×1080、30 FPS')
    expect(description).toContain('导出分辨率最高支持 4K')
    expect(description).not.toMatch(/从标清到 4K.*录制/)
  })

  it('describes the same capture/export boundary in Russian', () => {
    const description = releaseDescription('ru')

    expect(description).toContain('Сбалансированная запись до 1920×1080 при 30 FPS')
    expect(description).toContain('Экспорт с разрешением до 4K')
    expect(description).not.toMatch(/Поддержка записи[^.]*4K/)
  })
})
