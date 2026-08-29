# Screen Recorder Studio 0.6.13 release report

Date: 2026-08-30  
Chrome Web Store item: `bondbeldfibfmdjlcnomlaooklacmfpa`

## Source and package

- Branch: `codex/release-gif-area-recording`
- Candidate source commit: `b936b3a5a2c9e5449a08788a2d45babdf27993e1`
- Package: `screen-recorder-studio-v0.6.13.zip`
- Package SHA-256: `8392d4dd803305ec6224ad7be239ed0b169f28dd24767ef240b4cb3eb3ee89b3`
- Build SHA-256 aggregate: `46f0b6de4ce4a4dfc4cba6282366d81da9ce0865308e0d38ea49b377400108cd`

## Verification

- 82 automated test files and 420 tests passed.
- Svelte check completed with 0 errors and 18 existing warnings.
- The E2E catalog validated 15 stories and 54 cases.
- Production extension build passed; release logging policy checked 87 JavaScript bundles.
- The production build contains 236 files and no UI System Lab/debug route.
- macOS Chrome 152 browser loops passed for GIF Area → Studio → dynamic GIF, Tab → Studio → MP4, Manager exact reopen, restricted-page fail-closed, and en/zh_CN/missing-key fallback.

## i18n

- New page-structure copy is catalog-backed across Popup, area selector, Crop, Focus, background, GIF export, and error dismissal.
- English and Simplified Chinese catalogs cover every literal product translation key checked by the release test.
- Preview/web mode now prefers loaded locale messages over component-local English fallbacks.
- Other locales keep the Chrome `default_locale=en` fallback for untranslated new keys.

## Release assessment

- Assessment: single-platform gray release candidate.
- Public store version before upload: 0.6.12.
- Chrome Web Store accepted the ZIP as draft version 0.6.13; its 54 locales and permission set match the published 0.6.12 package.
- Dashboard handoff: ready at the `Submit for review` action; no review submission has been made yet.
- Known boundary: a 49.9-second 600px/10fps GIF failed after the UI warned it was too heavy; trimming to 8 seconds exported a valid 600×337, 80-frame, 8-second GIF with three total plays.
- Full Windows, WebM/three-format edit parity, complete Network HAR, and long soak were not executed in this run.
