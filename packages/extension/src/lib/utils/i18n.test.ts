import { describe, expect, it } from 'vitest'
import { _t, setCachedMessages } from './i18n'

describe('web locale resolution', () => {
  it('prefers a loaded locale catalog over a component fallback', () => {
    setCachedMessages({
      gifArea_title: '录制 GIF'
    })

    expect(_t('gifArea_title', undefined, {
      gifArea_title: 'Record GIF'
    })).toBe('录制 GIF')
  })

  it('uses the component fallback when the loaded catalog lacks the key', () => {
    setCachedMessages({})

    expect(_t('gifArea_title', undefined, {
      gifArea_title: 'Record GIF'
    })).toBe('Record GIF')
  })
})
