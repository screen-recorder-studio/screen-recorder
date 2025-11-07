# Screen Recorder Studio (Chrome Extension)

An open-source screen recording extension for Chrome. It records tabs, windows, full screen, and supports element/region capture with modern Web capabilities. It includes an OPFS (Origin Private File System) large-file pipeline and a Studio for preview, trimming, and export.

- License: MIT
- Minimum Chrome version: `116`

## Features
- Recording modes: `Tab`, `Window`, `Screen`, `Element` (DOM), `Area` (region)
- Encoding pipeline: WebCodecs-based pipeline
- Large-file storage: OPFS with `data.mp4`, line-based index `index.jsonl`, and `meta.json`
- Studio preview/edit: frame-window loading, keyframe alignment, read-only prefetch, export options
- Extension UI: Popup, Welcome, Side Panel, Drive file manager
- Privacy-by-default: no cloud upload; data stays in OPFS or user downloads

## Architecture Overview
- UI
  - `src/routes/popup/+page.svelte` (Popup)
  - `src/routes/welcome/+page.svelte` (Welcome)
  - `src/routes/sidepanel/+page.svelte` (Side Panel)
  - `src/routes/studio/+page.svelte` (Studio)
  - `src/routes/drive/+page.svelte` (OPFS Drive)
- Background & Recording
  - `src/extensions/background.ts` (Service Worker, routing and state)
  - `src/extensions/offscreen-main.ts` (tab/window/screen capture, encoding, OPFS writing)
  - `src/extensions/content.ts` (element/region selection and capture)
- Encoding & Storage Workers
  - `src/extensions/encoder-worker.ts` (encoding helper)
  - `src/lib/workers/opfs-writer-worker.ts` (OPFS writing)
  - `src/lib/workers/opfs-reader-worker.ts` (OPFS range reading)
- Packaging & Manifest
  - `static/manifest.json` (MV3 permissions and entries)
  - `scripts/*.mjs` (build extension assets)

Message flow (high level):
- UI → Background: `REQUEST_START_RECORDING`, `REQUEST_STOP_RECORDING`, `REQUEST_TOGGLE_PAUSE`, state queries
- UI → Content (element/region): `SET_MODE`, `ENTER_SELECTION`, `START_CAPTURE`, `STOP_CAPTURE`, `TOGGLE_PAUSE`, `CLEAR_SELECTION`
- Encoding → Offscreen/Writer: `chunk` (data+timestamp+type) → `append` → `finalize`
- Completion: Background broadcasts `OPFS_RECORDING_READY`; Studio opens via `/studio.html?id=rec_<session>`

## Quick Start
- Install dependencies: `pnpm install`
- Develop site: `pnpm dev` (SvelteKit dev server)
- Build extension: `pnpm build:extension`
  - Produces `background.js`, `content.js`, `offscreen.js`, `opfs-writer.js`, workers, and copies `static/manifest.json` into `build/`
- Package extension (zip): `pnpm package:extension`
  - Output: `screen-recorder-studio.zip`
- Load extension:
  - Open `chrome://extensions` → enable Developer Mode → Load unpacked → select `build/`

## Permissions & Privacy
- `desktopCapture`: screen/window/tab recording
- `offscreen`: MV3 offscreen document for recording/encoding
- `tabs` / `scripting` / `activeTab`: element/region capture requires content scripts
- `storage` / `unlimitedStorage`: OPFS persistence for large files and indexes
- `sidePanel`: optional side panel UI
- Minimization: permissions are used only when needed
- Privacy: recordings are stored in local OPFS or user downloads; no cloud upload

## Compatibility & Limitations
- Primary target: Chrome MV3 (`minimum_chrome_version: 116`)
- Firefox lacks MV3 Offscreen Document; Edge (Chromium-based) generally compatible but untested
- Restricted pages (e.g., `chrome://`, some `file://`) cannot inject content scripts; element/region modes are disabled on such pages
- OPFS support may vary by browser/privacy mode; Drive/Studio detects capability

## Project Structure (excerpt)
- `src/routes/*`: extension UIs (popup, welcome, drive, studio, sidepanel)
- `src/extensions/*`: background, content, offscreen, encoder entry points
- `src/lib/workers/*`: OPFS read/write, export and helpers
- `static/*`: MV3 manifest, offscreen pages, icons and assets
- `scripts/*`: build scripts
- `docs/*`: implementation notes, performance and UI docs

## FAQ
- Element/Area unavailable: current page is restricted or lacks host permissions
- Recording stops unexpectedly: user clicked system “Stop sharing”; background broadcasts `STREAM_END` and UIs sync state
- Large preview is slow: Studio batches reads and aligns to keyframes, but initial load may take time for huge files

## Roadmap / TODO
**Stability**
- Centralized logging with levels across background/offscreen/workers; structured error messages.
- Health checks and recovery: detect offscreen crashes, auto-restart pipeline, safe resume after OPFS errors.
- Backpressure and memory control: bounded queues, tuned chunk sizes/flush cadence, periodic memory stats.
- Failure handling: clear user notifications when WebCodecs is unavailable or fails.
- Persistence safety: periodic checkpoints in `meta.json`, robust `finalize`, cleanup orphan sessions on startup.
- Permission handling: graceful deny flows and consistent state sync across Popup/Welcome/SidePanel.

**User Experience**
- First-run onboarding and tooltips; quick capability checks (OPFS/WebCodecs/permissions).
- Unified Settings: bitrate/codec, file naming, countdown, hotkeys, defaults with safe presets.
- Clear recording state: timer, file size, pause/resume indicator; banner on system “Stop sharing”.
- Drive improvements: thumbnails, duration/size, sort/filter, delete confirmation UX.
- Accessibility: ARIA labels, keyboard navigation, focus order; basic i18n (EN/ZH toggle).

**Cross-System & Browser Testing**
- Playwright E2E: start/pause/stop, open Studio, trim, export (Chromium headless).
- Test matrix: macOS/Windows/Linux with Chrome stable/beta/dev and Edge stable.
- OPFS capability and quota behavior tests; element/region capture across restricted pages detection.
- Export worker correctness: trimming ranges, GIF export, performance baselines.

**CI & Distribution**
- GitHub Actions: `pnpm install` → typecheck → `pnpm build:extension` → E2E (Chromium) → upload zip artifact.
- Optional OS matrix for CI; nightly performance run on large sample file.

## Contributing
- Issues and PRs are welcome. Please read `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` first.
- PRs should include motivation, design, and validation steps.

## License
- MIT License; see `LICENSE`

## Acknowledgements
- Built with modern Web capabilities: WebCodecs, OPFS, Chrome MV3 Offscreen Document

## Localizations
- Chinese README: see `README.ZH.md`