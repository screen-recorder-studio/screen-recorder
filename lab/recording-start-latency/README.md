# Recording Start Latency Lab

This unpacked MV3 extension tests one release-critical contract: capture and
encoder/storage warm-up may happen during the countdown, but no countdown frame
may become the first formal encoded frame.

The controlled surface renders a full-screen magenta countdown marker. The
offscreen recorder drains and closes all warm-up frames, configures WebCodecs
and opens an OPFS file during the countdown, waits for the surface's two-frame
hide acknowledgement, then creates a fresh `MediaStreamTrackProcessor` for the
formal first frame. It scans that frame for magenta pixels and encodes it as a
timestamp-zero keyframe.

## Manual run

1. Load this directory as an unpacked extension at `chrome://extensions`.
2. Pin the Lab, open its popup, and click **Open test surface**.
3. Keep the surface active, reopen the popup, and run **Probe current tab** with
   `3 seconds / 140 ms`. Reopen the popup to inspect the stored result.
4. Repeat with countdown `Off`, then repeat both with settle `0 ms`.
5. Run **Probe display picker**, choose the test-surface browser tab/window, and
   repeat the four combinations. For Entire Screen, maximize the surface first.

## Required assertions

- `warmupFrames > 0` and every warm-up frame is closed by the Lab.
- `encoderReadyAt` and `storageReadyAt` normally precede `captureBoundaryAt`
  for a 3-second countdown.
- `firstFormalFrameAt >= captureBoundaryAt`.
- For non-zero countdowns, `warmupMagentaRatio >= 0.02` proves the selected
  source actually contained the marker; `magentaRatio < 0.02`,
  `countdownFree=true`, and `encodedChunks > 0` prove it did not cross the gate.
- A static surface must either produce a formal frame within five seconds or
  fail explicitly; it must never reuse a known countdown frame.

The Lab does not claim production integration coverage. After the contract is
fixed with TDD, the production extension must be tested separately for Current
Tab, Window, and Entire Screen, including a static surface and a slow-machine
profile.

The magenta marker is a Lab assertion surface, not the production countdown
UI. Production Screen/Window capture additionally requires a focused,
short-lived Chrome popup window after picker approval. That window must close
before the zero boundary is acknowledged; the action popup cannot own this UI
because Chrome closes it when focus leaves the popup.

## First-party basis

- Chrome action popups close when the user focuses outside them, so they cannot
  be the countdown owner after the system picker opens:
  <https://developer.chrome.com/docs/extensions/develop/ui/add-popup>.
- Chrome's `windows.create()` API provides the focused, positioned popup used
  by the production Screen/Window countdown surface:
  <https://developer.chrome.com/docs/extensions/reference/api/windows>.
- W3C Media Capture Transform defines a bounded processor queue, recommends
  immediate `VideoFrame.close()`, and explicitly calls multiple processors on
  one unprocessed track a robust solution:
  <https://www.w3.org/TR/mediacapture-transform/>.
- W3C WebCodecs defines timestamps in microseconds and makes callers responsible
  for releasing transferred frame resources:
  <https://www.w3.org/TR/webcodecs/>.
- W3C Screen Capture requires a fresh user selection and non-persisted display
  permission; picker time is intentionally outside the startup performance SLA:
  <https://www.w3.org/TR/screen-capture/>.
- Chromium desktop capture can suppress unchanged frames (0 Hz), so the formal
  lane must be validated on static displays instead of assuming nominal 30 fps:
  <https://chromium.googlesource.com/chromium/src/+/master/content/browser/media/capture/desktop_capture_device.cc>.

## Chrome 151 evidence (macOS, 2026-08-16)

- Current Tab, 3 seconds: PASS; encoder ready about 167 ms after the request,
  formal frame about 38 ms after the capture boundary, no magenta marker.
- Current Tab, Off: PASS; formal frame about 22 ms after the capture boundary,
  no magenta marker.
- Display Picker → Chrome Tab, 3 seconds: PASS; formal frame about 10 ms after
  the capture boundary, no magenta marker.
- Display Picker → Entire Screen, 3 seconds: PASS; 1920×1080 track, formal frame
  about 1.2 ms after the capture boundary. The warm-up lane observed the
  full-screen magenta marker (`countdownObserved=true`), the formal first frame
  did not contain it (`countdownFree=true`), and all 20 warm-up frames were
  closed before the formal lane started.
- Production Entire Screen, 5 seconds: PASS; Chrome showed the independent
  `Countdown` window after picker approval, updated it through `1`, closed it
  automatically at zero, and then entered `Recording`. Studio opened the new
  1920×1080 recording at frame 1 with no countdown window in the captured
  image. The popup also reopened with its persisted/default countdown value
  visibly selected rather than a blank native select.

Picker interaction time is reported separately and is not counted as recorder
startup latency because browser security requires a fresh user selection.
