# Changelog

All notable changes to this project will be documented in this file.

The format loosely follows Keep a Changelog and Semantic Versioning (the project itself is still in pre‑1.0 iteration, so minor bumps may include internal refactors).

## [0.6.0] - 2025-09-27
### Added / Improved
- Automatic codec selection (`codec: "auto"`) replacing the previous hard‑coded `vp8`. The runtime now probes (in order) multiple H.264 profiles (High/Main/Baseline, both `annexb` & `avc` formats) → VP9 variants → VP8, and uses the first supported configuration.
- New shared utility module `src/lib/utils/webcodecs-config.ts` providing:
  - Systematic generation of resolution / FPS / bitrate variants.
  - Even dimension + 16‑alignment helpers.
  - Adaptive bitrate estimation (`computeBitrate`) as a baseline heuristic.
  - Centralized probing (`tryConfigureBestEncoder`) consolidating all fallback logic.
- Refactored `encoder-worker`:
  - GOP / keyframe strategy (~1.5s interval) plus forced keyframe on first frame or explicit request.
  - Backpressure control (`BACKPRESSURE_MAX = 8`) to drop frames when the encode queue grows, reducing latency buildup.
  - Streamlined streaming of encoded chunks instead of accumulating them in memory.
  - Basic statistics (chunk count, byte count) tracking.
- `content.ts` enhancements:
  - Pre‑warm sink iframe with a provisional `start` (codec = `auto`) + metadata to avoid losing the earliest encoded chunks.
  - Post‑configuration metadata reconciliation (width / height / framerate / resolved codec) once the worker reports the final applied encoder settings.
  - Zero‑copy transfer of `VideoFrame` objects to the worker and encoded chunk ArrayBuffers to the sink iframe (reduced memory pressure).
- Version bump in both `package.json` and `static/manifest.json` from `0.5.0` to `0.6.0`.

### Compatibility Notes
- Environments supporting H.264 will now most likely produce H.264 (profile & format may vary). If future MP4 muxing is added, Annex B → AVCC conversion may be required.
- VP9 / VP8 remain as fallbacks to maximize cross‑platform success.
- MediaRecorder fallback (when WebCodecs is unavailable) still outputs `video/webm;codecs=vp9`—unchanged.

### Internal / Architectural
- Consolidation of codec probing logic reduces duplication and prepares for future tuning (e.g., caching probe results, telemetry, or user‑exposed codec preferences).
- Worker message schemas currently differ between `encoder-worker` and `webcodecs-worker`; unification is a future goal.

### Potential Future Improvements (Not Implemented Yet)
- Cache `VideoEncoder.isConfigSupported` results to cut down on repeated probing cost.
- Harmonize worker message formats (`chunk`, completion events: `end` vs `complete`).
- More granular bitrate adaptation (e.g., tiered BPP by resolution & low FPS safeguards).
- Toggleable debug logging flag to reduce console noise in production.
- Optional user / UI surface for codec preference (e.g., “Prefer VP9” / “Lower Bitrate Mode”).

## [0.5.0]
- Baseline public version (fixed VP8 encoding path, no formal changelog previously maintained).

---

If you need a backfilled historical log prior to 0.5.0 or want Conventional Commits automation, that can be introduced in a future release.
