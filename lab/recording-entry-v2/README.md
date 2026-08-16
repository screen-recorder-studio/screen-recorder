# Recording Entry V2 Lab

This unpacked Manifest V3 extension isolates the two browser behaviors that the
new recording entry must depend on. It deliberately does not encode or persist
video; a live video track is enough to prove the interaction contract.

## Hypotheses

1. **Display picker path** — a click in the action popup can ask an offscreen
   document to call `getDisplayMedia()`. The action popup may close while the
   browser picker is open, but the selected stream must remain alive.
   The four timing variants test whether activation behavior changes across an
   immediate call, one microtask, a zero-delay task, and a one-second task.
2. **Quick current-tab path** — after a user click, the service worker can call
   `chrome.tabCapture.getMediaStreamId()` and the offscreen document can consume
   that one-time ID. This should start a current-tab stream without the system
   display picker and survive the action popup closing.
3. Reopening the action popup must reconstruct the current state from
   `chrome.storage.session`; UI lifetime must not own capture lifetime.

## Why this lab exists

Chrome action popups close automatically when focus moves outside them, and
there is no supported way to keep them open. Therefore the production popup can
only be a disposable command/status view. Countdown, capture state, and recovery
must live in the extension service/offscreen layers.

## Run manually

1. Open `chrome://extensions`, enable Developer mode, then choose **Load
   unpacked** and select this directory.
2. Open a normal HTTPS page and pin **Recording Entry V2 Lab**.
3. Leave **Display call timing** on **Immediate**, click **Display picker**, and
   either choose a source or cancel. Reopen the popup and inspect the event log.
   It records popup lifecycle, popup/offscreen user activation, call timing,
   resolution or rejection, error name/message, and selected track settings.
4. Stop or reset, then repeat step 3 for **Microtask**, **Delay 0 ms**, and
   **Delay 1000 ms**. This is an observation test: do not assume all variants
   should succeed.
5. Click **Quick current tab**. Expected: no display picker; reopen
   the popup and see `streaming/tab`.
6. Navigate or reload the captured tab and reopen the popup. Expected: the
   extension still reports the offscreen stream accurately (the browser may end
   a stream for a browser-defined reason, which must appear as `ended`).
7. Click **Stop** and verify the state returns to `idle`. The event log should
   contain each track's final settings and whether the end was intentional.

The popup includes a **Reset state** button for recovery after reloading the
unpacked extension. Reloading/disabling the extension clears
`chrome.storage.session` by design.

## Result matrix

| Scenario | Evidence to capture | Result |
| --- | --- | --- |
| Popup opens | `pageshow`, visibility, popup activation snapshot | Pending browser run |
| Display / immediate | offscreen receive/call activation; resolve or exact reject | Pending browser run |
| Display / microtask | same evidence plus measured call delay | Pending browser run |
| Display / delay 0 ms | same evidence plus measured call delay | Pending browser run |
| Display / delay 1000 ms | same evidence plus measured call delay | Pending browser run |
| Picker takes focus | best-effort `visibilitychange` / `pagehide` | Pending browser run |
| Picker cancel | rejection time and exact `error.name` / `error.message` | Pending browser run |
| Pick browser tab | resolve time and video track settings | Pending browser run |
| Pick window | resolve time and video track settings | Pending browser run |
| Pick entire screen | resolve time and video track settings | Pending browser run |
| Reopen during display capture | state reconstructs as `streaming/display` | Pending browser run |
| Quick current tab | no picker; popup/offscreen activation and track settings logged | Pending browser run |
| Reopen during tab capture | state reconstructs as `streaming/tab` | Pending browser run |
| Chrome **Stop sharing** | track `ended`, settings, `intentional: false` | Pending browser run |
| Lab **Stop** after popup reopen | track `ended`, `intentional: true`, state `idle` | Pending browser run |
| Terminate service worker, reopen popup | session state and offscreen stream remain reconcilable | Pending browser run |
| Reload/disable extension | session state clears by design | Pending browser run |
| Restart Chrome | session state clears by design | Pending browser run |

Run the display rows on current Chrome Stable for macOS and Windows. On macOS,
also repeat with two displays because picker focus placement is platform and
window-layout dependent. Include a normal HTTPS page and a restricted page such
as `chrome://extensions` to verify that popup/offscreen control remains usable
when a future content overlay cannot be injected.

## First-party references

- [Add a popup](https://developer.chrome.com/docs/extensions/develop/ui/add-popup)
  — an action popup closes when focus moves outside it.
- [Chrome action API](https://developer.chrome.com/docs/extensions/reference/api/action)
  — popup sizing, action behavior, and `openPopup()` version limits.
- [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
  — `DISPLAY_MEDIA`, offscreen lifetime, and runtime-only extension APIs.
- [Chrome screen capture guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
  — the Chrome 116+ service-worker-to-offscreen tab capture pattern.
- [Chrome tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
  — user-invocation requirement and stream ID lifetime.
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
  — `storage.session` semantics for service-worker state.
- [Screen Capture specification](https://www.w3.org/TR/screen-capture/)
  — per-call user choice, non-persisted permission, and transient activation.
- [MDN `getDisplayMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
  — documented exception names and activation requirement.
