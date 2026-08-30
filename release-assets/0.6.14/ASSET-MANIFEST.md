# Chrome Web Store 0.6.14 Asset Manifest

Status: asset production, cross-review, store upload, and review submission complete

## Deliverables

| Asset | English | Russian | Simplified Chinese | Traditional Chinese |
| --- | --- | --- | --- | --- |
| 01 Area to GIF | ready | ready | ready | ready |
| 02 Studio workflow | ready | ready | ready | ready |
| 03 GIF export | ready | ready | ready | ready |
| 04 Video export | ready | ready | ready | ready |
| 05 Local library | ready | ready | ready | ready |

Expected filenames in each locale directory:

1. `01-area-to-gif.jpg`
2. `02-studio-workflow.jpg`
3. `03-gif-export.jpg`
4. `04-video-export.jpg`
5. `05-local-library.jpg`

## Source and output locations

- Raw/current-product captures: `sources/`
- Store-ready locale sets: `store-assets/{en,ru,zh-CN,zh-TW}/`
- QA contact sheets and machine-readable checks: `qa/`
- Final long descriptions: `store-copy/`

## Acceptance checklist

- [x] 20 final screenshots exist with the exact expected names.
- [x] Every screenshot is exactly 1280 × 800.
- [x] Every final file is an RGB JPEG with no alpha channel.
- [x] All scenes represent the 0.6.14 candidate UI; the 0.6.14 change is limited to version and package-locale metadata.
- [x] English is suitable as the global fallback set.
- [x] Russian, Simplified Chinese, and Traditional Chinese preserve product meaning.
- [x] Text is legible at 640 × 400 with no clipping or awkward wrapping.
- [x] Each scene proves the claim made by its headline and subtitle.
- [x] No unsupported promise, stale UI, personal data, notification, or cursor artifact appears.
- [x] Cross-review findings are resolved and recorded in `qa/REVIEW.md`.
- [x] The exact store-upload files are recorded with SHA-256 hashes in `qa/IMAGE-QA.md`.

## Production note

The layouts and four language versions were composed and checked in GetAppAssets 0.5.5. Its Standard export failed with `multilingual_export_incomplete`, and some single-language versions failed before producing an Export Preview. The final files were therefore generated from deselected GetAppAssets editor canvases with a deterministic 1280 × 800 crop and then machine- and human-verified. Reproduction details are in `qa/appassets-issue-export.md`.

## Publishing record

The user confirmed the final assets and authorized submission. The verified 0.6.14 package, eight localized long descriptions, 20 localized screenshots, and five-image English global fallback were saved to Chrome Web Store. The item was submitted on 2026-08-30, is pending review, and is configured to publish automatically after approval.
