# WebM Export QA — 0.6.14

Checked: 2026-08-30

## Result

The Studio produced a real WebM export from the four-second release-candidate recording. The exported file is structurally valid and its container metadata matches the selected export settings.

## Evidence

- File: `webm-export-4s.webm`
- Size: 1,087,221 bytes
- SHA-256: `3ec3c7c2c5f735219767c3fd31bb39408fa0ab1541e4c47ac720d7ffb29cc624`
- Container: WebM with a valid EBML header (`1a45dfa3`)
- Video codec: VP9 (`V_VP9`)
- Duration: 4.0 seconds (`Duration=4000.0`, `TimecodeScale=1,000,000 ns`)
- Frame size: 1920 × 1080

## Playback observation limit

Chrome began handling the local WebM, but its video-rendering page caused the Computer Use screen capture to fail. A second browser-control path correctly refused direct `file://` navigation under its URL safety policy. Therefore visual playback is **not claimed as observed**. The successful real export plus independent container/codec/timing/dimension checks are the recorded release evidence.
