# Screen Recorder Studio 0.6.14 release report

Date: 2026-08-30  
Chrome Web Store item: `bondbeldfibfmdjlcnomlaooklacmfpa`

## Source and package

- Branch: `codex/release-gif-area-recording`
- Worktree HEAD: `2fc44fd51025fe5d402bed84d6622b5da5d4c09a`
- Feature source commit: `b936b3a5a2c9e5449a08788a2d45babdf27993e1`
- Release-preparation delta: version 0.6.14, localized store name/summary in 54 locales, and clean ZIP synchronization
- Package: `screen-recorder-studio-v0.6.14.zip`
- Package SHA-256: `7db9e22ab468901933e193d802ed04d1e5aa8f057d14bc6999f8b65166b91979`
- Build SHA-256 aggregate: `8e464e8c4bc5abc99d7f39665609061f737bf2f21876c2135072f68ae30436bc`

## Verification

- 82 automated test files and 420 tests passed.
- Svelte check completed with 0 errors and 18 existing warnings.
- The E2E catalog validated 15 stories and 54 cases.
- Production extension build passed; release logging policy checked 87 JavaScript bundles.
- The production build contains 236 files and no UI System Lab/debug route.
- Package manifest is 0.6.14, contains 54 locale catalogs, has no `host_permissions`, and preserves the prior permission set.
- ZIP synchronization was corrected from incremental `zip -r` to `zip -FS -r`. The final archive has 302 file/directory entries, exactly matches `build/`, and has no stale or missing entries.
- All 54 localized package titles/descriptions parse successfully and meet Chrome limits (name ≤75, description ≤132).
- The 0.6.13 functional candidate passed macOS Chrome 152 loops for GIF Area → Studio → GIF, Tab → Studio → MP4, Manager exact reopen, restricted-page fail-closed, and en/zh_CN/missing-key fallback. The 0.6.14 delta is limited to manifest version, locale metadata, and packaging synchronization.
- A real four-second WebM export is structurally valid VP9 at 1920×1080; see `qa/WEBM-QA.md` for the browser-observation limit.
- All 20 store screenshots passed machine validation and independent visual, localization, and conversion reviews.

## i18n

- Package search metadata now leads with the page-area-to-GIF workflow while retaining tab/window/screen capture, local editing, and MP4/WebM/GIF export.
- All 54 `appName`/`appDesc` pairs are localized and within manifest limits; only those two keys changed in each catalog.
- New page-structure UI copy remains complete in English and Simplified Chinese. Other locales continue to use the Chrome `default_locale=en` fallback for untranslated new interface keys.
- Chrome's internal extension page and local `file://` video page could not be visually captured: Computer Use screen capture failed, while browser control correctly blocked internal/local URL automation. No visual pass is claimed for those two surfaces.

## Store assets

- Eight localized listing descriptions are saved: English, Russian, Simplified Chinese, Traditional Chinese, Filipino, Hindi, Croatian, and Swahili.
- Four screenshot sets are ready, five images per locale, all 1280×800 RGB JPEG.
- The eight descriptions and all 20 unique localized screenshots are saved in the Chrome Web Store listing; the English set is also saved as the five-image global fallback.
- The initial submission warning for Filipino, Hindi, Croatian, and Swahili metadata was resolved by adding complete localized long descriptions before resubmission.
- GetAppAssets Standard export defects were filed as [AppAssets #59](https://github.com/wxnet2013/AppAssets/issues/59) and [AppAssets #60](https://github.com/wxnet2013/AppAssets/issues/60); the local issue records remain in `qa/appassets-issue-export.md` and `qa/appassets-issue-localization.md`.

## Release assessment

- Assessment: single-platform gray release candidate, submitted to Chrome Web Store review.
- Public store version before upload: 0.6.12.
- The submitted Chrome Web Store item contains the verified 0.6.14 package, eight localized descriptions, all four five-image localized screenshot sets, and the five-image English global fallback.
- Submission completed on 2026-08-30. Chrome Web Store status is `Pending review`, and automatic publication after approval is enabled; the public version remains 0.6.12 until approval and publication complete.
- Known boundary: a 49.9-second 600px/10fps GIF failed after the UI warned it was too heavy; shorter email-oriented GIFs export successfully.
- Full Windows coverage, complete Network HAR, and long soak were not executed in this run.
