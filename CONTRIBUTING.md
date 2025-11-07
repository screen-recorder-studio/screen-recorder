# Contributing Guide

Thank you for your interest in contributing to Screen Recorder Studio! To keep quality high and collaboration efficient, please read this guide before filing Issues or Pull Requests.

## Getting Started
- Issues: Provide a clear description, repro steps, expected vs. actual behavior, and environment details (browser/version/platform).
- Pull Requests: Branch from the latest `main`, ensure the project builds and passes basic checks (see below).

## Development Setup
- Package manager: `pnpm`
- Stack: TypeScript, Svelte 5, Vite, Chrome MV3
- Local commands:
  - `pnpm install`
  - `pnpm dev` (develop site and components)
  - `pnpm build:extension` (build extension artifacts into `build/`)

## Code Standards
- TypeScript: strong typing; avoid `any` unless justified with comments.
- Clear module boundaries: UI (`src/routes/*`), background/content/offscreen (`src/extensions/*`), workers (`src/lib/workers/*`).
- Message constants/types: centralize in `src/lib/types` where possible and reuse.
- Logging: avoid excessive `console.log`; add flags or levels for debug output.
- Styles: follow existing Svelte/Tailwind conventions; minimize inline styles.

## Submission & Review
- Commit messages: concise and structured — `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`.
- PR content:
  - Summary and motivation.
  - Technical approach and impact (especially permissions and privacy).
  - Tests or validation steps (local repro, build success, extension load screenshots, etc.).
- Review criteria: correctness, maintainability, documentation/comments quality, impact on existing features.

## Testing & Build
- Basic checks:
  - `pnpm check` (type checking)
  - `pnpm build:extension` (extension build)
- Suggested tests:
  - Workers: OPFS read/write, indexing, range reads (unit or light integration).
  - E2E: Playwright for UI flows and message routing (start/pause/stop, Studio open/trim/export).

## Branching & Releases
- Main branch: `main`
- Feature branches: `feature/<topic>`; fix branches: `fix/<topic>`
- Changelog: `CHANGELOG.md`

## Code of Conduct
- All contributors must follow `CODE_OF_CONDUCT.md` (Contributor Covenant).

## Permissions & Privacy Changes
- If your PR introduces or alters browser permissions or data handling, call it out prominently in the PR description and update relevant sections in `README.md` and `docs/`.

## Contact & Support
- For complex design questions or security topics, use Issues or the responsible disclosure channel described in `SECURITY.md`.