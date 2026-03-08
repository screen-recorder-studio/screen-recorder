# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Screen Recorder Studio is a Chrome Extension (MV3, minimum Chrome 116) for recording tabs, windows, screens, page regions, and DOM elements. Built with SvelteKit 2, Svelte 5 (runes), TypeScript, Tailwind CSS 4, and Vite 7.

This project uses a **pnpm Workspace Monorepo** structure.

## Monorepo Structure

```
/
├── pnpm-workspace.yaml        # Workspace configuration
├── package.json               # Root workspace orchestrator (delegates to packages)
├── packages/
│   └── extension/             # Main Chrome Extension package
│       ├── package.json       # All dependencies live here
│       ├── src/               # Source code
│       ├── scripts/           # Build scripts
│       ├── static/            # Static assets (manifest.json, icons, etc.)
│       ├── svelte.config.js
│       ├── vite.config.ts
│       └── tsconfig.json
├── lab/                       # Standalone experiments (not a workspace package)
├── docs/                      # Technical documentation
└── blog/                      # Blog articles
```

## Development Commands

```bash
# Install dependencies (from root)
pnpm install

# Development (SvelteKit dev server)
pnpm dev

# Type checking
pnpm check

# Build extension (produces packages/extension/build/ directory)
pnpm build:extension

# Package extension as zip
pnpm package:extension

# Run commands for a specific package
pnpm --filter extension dev
pnpm --filter extension build:extension
```

After building, load the extension from `chrome://extensions` → Developer Mode → Load unpacked → select `packages/extension/build/`.

## Architecture

### Extension Entry Points (`packages/extension/src/extensions/`)

- **`background.ts`** - Service Worker. Routes messages between UI, content scripts, and offscreen document. Manages global recording state, badge timer, control window lifecycle.
- **`content.ts`** - Injected into web pages for element/region selection and capture. Handles DOM interaction and coordinate tracking.
- **`offscreen-main.ts`** - Offscreen document for MediaStream capture and encoding. Uses WebCodecs pipeline with OPFS storage.
- **`encoder-worker.ts`** - WebCodecs encoding helper worker.
- **`opfs-writer.ts`** - OPFS file writing orchestration.

### UI Pages (`packages/extension/src/routes/`)

Each route is a standalone HTML page for the extension:
- **`/popup`** - Extension popup (minimal, redirects to control)
- **`/control`** - Main recording control window
- **`/welcome`** - First-run onboarding
- **`/studio`** - Preview, trim, and export recordings
- **`/drive`** and **`/opfs-drive`** - OPFS file manager

### Core Libraries (`packages/extension/src/lib/`)

- **`workers/`** - Web Workers for OPFS read/write, WebCodecs encoding, and export (MP4/WebM/GIF strategies)
- **`stores/*.svelte.ts`** - Svelte 5 runes-based state management (`$state`)
- **`services/`** - Recording service, export manager, GIF encoder
- **`utils/`** - Offscreen manager, Chrome API helpers, WebCodecs config

### Message Flow

```
UI → Background: REQUEST_START_RECORDING, REQUEST_STOP_RECORDING, REQUEST_TOGGLE_PAUSE
UI → Content: SET_MODE, ENTER_SELECTION, START_CAPTURE, STOP_CAPTURE
Background → Offscreen: OFFSCREEN_START_RECORDING, OFFSCREEN_STOP_RECORDING
Offscreen → OPFS Worker: append chunks → finalize
Offscreen → Background: OPFS_RECORDING_READY → opens Studio
```

### Storage (OPFS)

Recordings stored in OPFS with:
- `data.bin` - Raw encoded video data
- `index.jsonl` - Line-delimited JSON index for frame seeking
- `meta.json` - Metadata (codec, dimensions, duration)

### Build Pipeline

The `build:extension` script (in `packages/extension/`):
1. Runs `vite build` (SvelteKit with static adapter)
2. Executes scripts in `scripts/*.mjs` to build extension-specific entry points
3. Copies `static/manifest.json` to `build/`

## Key Technical Details

- **Svelte 5 Runes**: State management uses `$state` in `.svelte.ts` files (see `packages/extension/src/lib/stores/`)
- **Chrome MV3**: Uses Offscreen API for MediaStream access in service worker context
- **WebCodecs**: Primary encoding pipeline; MediaRecorder as fallback
- **Restricted Pages**: Content scripts cannot inject on `chrome://`, `chrome-extension://`, Chrome Web Store, or `file://` without explicit permission

## Testing

No automated test suite is currently configured. Manual testing workflow:
1. Build extension: `pnpm build:extension`
2. Load in Chrome as unpacked extension
3. Test recording modes: Tab, Window, Screen, Element, Area
4. Verify Studio preview, trim, and export functionality