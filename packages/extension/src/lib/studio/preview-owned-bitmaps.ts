interface ClosableBitmap {
  close(): void
}

interface PreviewBitmapConfig {
  image?: { imageBitmap?: ClosableBitmap | null } | null
  wallpaper?: { imageBitmap?: ClosableBitmap | null } | null
}

export function closeReplacedPreviewConfigBitmaps(input: {
  previous: PreviewBitmapConfig | null | undefined
  next: PreviewBitmapConfig | null | undefined
}): void {
  const nextBitmaps = new Set<ClosableBitmap>()
  for (const bitmap of configBitmaps(input.next)) nextBitmaps.add(bitmap)

  for (const bitmap of new Set(configBitmaps(input.previous))) {
    if (nextBitmaps.has(bitmap)) continue
    try { bitmap.close() } catch {}
  }
}

function configBitmaps(config: PreviewBitmapConfig | null | undefined): ClosableBitmap[] {
  const bitmaps = [config?.image?.imageBitmap, config?.wallpaper?.imageBitmap]
  return bitmaps.filter((bitmap): bitmap is ClosableBitmap => !!bitmap)
}
