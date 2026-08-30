# Chrome Web Store Asset Review — 0.6.14

Final review date: 2026-08-30

## Disposition

GO. The current 20 screenshots are suitable for Chrome Web Store upload.

## Review coverage

- Visual-quality review: GO
- Localization review: GO
- Store-conversion review: GO
- Machine validation: 20/20 files open successfully; all are 1280 × 800 RGB JPEGs
- Real WebM export: valid 4.0-second VP9 WebM at 1920 × 1080; details in `WEBM-QA.md`

## Resolved findings

- Removed GetAppAssets layer borders and control points from all 20 files by capturing a fully deselected canvas.
- Replaced the 49.9-second red GIF warning scene with a real four-second configuration showing a green email-friendly estimate.
- Exposed the Studio timeline in screen 02.
- Corrected Russian, Simplified Chinese, and Traditional Chinese feature terminology.
- Restored English punctuation in screen 04.
- Corrected screen 05 text-image overlap by reducing the product-image scale and resyncing all locales.
- Regenerated contact sheets and SHA-256 hashes after the final image changes.

## Non-blocking follow-ups

- Screen 01 is intentionally dark because area selection applies the product's real page mask. A brighter public demo page could improve a future first-screen iteration.
- Embedded product UI remains English in the non-English screenshot sets; the localized marketing copy is complete and readable.
- Product screenshots retain the browser tab strip. It contains no personal information but can be simplified in a future capture pass.
