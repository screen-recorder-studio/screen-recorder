import { describe, expect, it } from 'vitest'
import { resolveStudioDeliveryProfile } from './delivery-profile'

describe('Studio recording delivery profile', () => {
  it('treats OPFS metadata as truth for a GIF-intent recording', () => {
    expect(resolveStudioDeliveryProfile({
      meta: { intent: 'gif', capture: { intent: 'gif' } },
      urlIntent: null
    })).toBe('gif')
  })

  it('uses the URL intent only as a bootstrap hint for older metadata', () => {
    expect(resolveStudioDeliveryProfile({ meta: {}, urlIntent: 'gif' })).toBe('gif')
    expect(resolveStudioDeliveryProfile({ meta: { intent: 'video' }, urlIntent: 'gif' })).toBe('video')
  })

  it('defaults existing recordings to the shared video workflow', () => {
    expect(resolveStudioDeliveryProfile({ meta: null, urlIntent: null })).toBe('video')
  })
})
