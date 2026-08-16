import { describe, expect, it, vi } from 'vitest'
import { closeReplacedPreviewConfigBitmaps } from './preview-owned-bitmaps'

describe('preview background bitmap ownership', () => {
  it('closes replaced worker-owned image and wallpaper bitmaps', () => {
    const image = { close: vi.fn() }
    const wallpaper = { close: vi.fn() }

    closeReplacedPreviewConfigBitmaps({
      previous: { image: { imageBitmap: image }, wallpaper: { imageBitmap: wallpaper } },
      next: null
    })

    expect(image.close).toHaveBeenCalledOnce()
    expect(wallpaper.close).toHaveBeenCalledOnce()
  })

  it('does not close a bitmap retained by the next config', () => {
    const shared = { close: vi.fn() }

    closeReplacedPreviewConfigBitmaps({
      previous: { image: { imageBitmap: shared } },
      next: { image: { imageBitmap: shared } }
    })

    expect(shared.close).not.toHaveBeenCalled()
  })

  it('closes a bitmap only once when two previous slots share it', () => {
    const shared = { close: vi.fn() }

    closeReplacedPreviewConfigBitmaps({
      previous: {
        image: { imageBitmap: shared },
        wallpaper: { imageBitmap: shared }
      },
      next: null
    })

    expect(shared.close).toHaveBeenCalledOnce()
  })
})
