# Web Video Editing Engine (1): Memory Virtualization and the Sliding Window

You’ve just finished recording an epic 10‑minute 4K game session. You drag the resulting 5GB video into your browser-based editor, excited to trim and polish it.

Halfway through the loading bar, your screen goes white and Chrome greets you with the infamous:

> **“Aw, Snap!”**

That was the first brick wall we ran into when building **Screen Recorder Studio**.

On the web, the hardest part of video editing isn’t the codec math – it’s **memory**. Native apps like Premiere can stream directly from disk. Inside the browser sandbox, if you try to slurp an entire long recording into RAM, V8 will happily remind you of its limits with an OOM.

Our goal, however, is “effectively infinite” recording and editing. To get there, we can’t brute-force our way through. We have to **trick** the browser:

> Make it think it’s only working on a tiny sliver of video, while we’re actually operating on a huge dataset.

That’s where **memory virtualization** and the **sliding window** come in.

> 🌟 **About the project**  
> Screen Recorder Studio is an open-source, web‑based screen recording and editing tool. If you’re curious about how it works under the hood, check out the [GitHub repo](https://github.com/screen-recorder-studio/screen-recorder) or try it directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/screen-recorder-studio-fo/bondbeldfibfmdjlcnomlaooklacmfpa).

---

## 1. The Sliding Window Mental Model

To deal with large recordings safely, we designed a **Sliding Window** mechanism.

### Core idea

Imagine walking down a long, dark gallery with a flashlight:

- **Global timeline** – the entire gallery (for example, a 1‑hour recording sitting quietly in OPFS).
- **Current window** – the area illuminated by your flashlight (a 2–4 second chunk currently loaded into RAM as compressed video chunks).
- **Viewport** – what the user actually sees on screen right now (the current frame in the player).

No matter how long the recording is, we only keep the data under the “flashlight beam” in memory. When the user scrubs the timeline, we don’t slide a massive video file around – we slide a **lightweight window** over a fixed file.

```mermaid
graph LR
    Total[Global Video File (OPFS Disk)]
    Window[In‑Memory Window (RAM ArrayBuffer)]
    Player[Player / Decoder]

    Total -- "Seek 00:15" --> Window
    subgraph "Sliding Window"
    Window -- "Load [00:13 ~ 00:17]" --> Player
    end
    
    style Window fill:#f9f,stroke:#333,stroke-width:2px
```

### State in the editor

In `src/routes/studio/+page.svelte`, we define the core state that drives this mechanism:

```ts
// Timeline & window (milliseconds)
let durationMs = $state(0);       // Total duration
let windowStartMs = $state(0);    // Current window start
let windowEndMs = $state(0);      // Current window end

// Global frame index
let globalTotalFrames = $state(0); // Global frame count
let windowStartIndex = $state(0);  // First frame index of current window in global timeline
```

These values are updated whenever we:

- Load the initial window from OPFS.
- Move the playback head across the timeline.
- Prefetch the “next” window ahead of time for smooth playback.

---

## 2. The Core Algorithm: Smart Window Planning

How do we decide which part of the video the window should cover?

That logic lives in a function called `computeFrameWindow`. It does more than “take 2 seconds before and after the cursor” – it runs a strategy that adapts to user behavior and keyframe layout.

In the actual implementation, `framesBefore` and `framesAfter` are first derived from the requested `beforeMs` / `afterMs` and the inferred source FPS, then clamped by minimum/maximum window sizes. Below is a simplified version to illustrate the idea without all the edge‑case code:

### Modes: seek vs play vs prefetch

We distinguish between different interaction modes:

1. **Seek** (jump)
   - Trigger: user clicks somewhere on the timeline.
   - Strategy: center the window around the target time, loading a bit **before and after** (for example `before = 1.5s`, `after = 1.5s`) so the user can nudge in both directions without another I/O round trip.

2. **Play** (continuous playback)
   - Trigger: video is playing forward.
   - Strategy: aggressively bias toward **future data**. We don’t need frames we’ve already shown. When the playhead approaches the end of the current window, we silently prefetch the next window.

3. **Prefetch**
   - Trigger: a background request from the preview component when the buffer is low.
   - Strategy: minimal “lookahead window” that’s big enough for smooth playback, but small enough to keep memory stable.

### Sketch of `computeFrameWindow`

Here’s a simplified version of the function as it actually exists in `src/routes/studio/+page.svelte`:

```ts
function computeFrameWindow(params: FrameWindowParams): FrameWindowResult {
  const {
    centerMs,
    beforeMs,
    afterMs,
    fps,
    totalFrames,
    keyframeInfo,
    currentWindowStartIndex,
    mode,
  } = params;

  if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
    return { startFrame: 0, frameCount: 0, skip: true };
  }

  const effectiveFps = Math.max(
    1,
    Math.floor(Number.isFinite(fps) && fps > 0 ? fps : 30),
  );

  const clampedCenterMs = Math.max(0, centerMs);
  const clampedBeforeMs = Math.max(0, beforeMs);
  const clampedAfterMs = Math.max(0, afterMs);

  // Convert time window to frames
  const targetFrameIndex = Math.max(
    0,
    Math.floor((clampedCenterMs / 1000) * effectiveFps),
  );
  const framesBefore = Math.max(
    0,
    Math.floor((clampedBeforeMs / 1000) * effectiveFps),
  );
  const framesAfter = Math.max(
    0,
    Math.floor((clampedAfterMs / 1000) * effectiveFps),
  );

  // Estimate desired window size from time
  const minWindowFrames = Math.min(
    totalFrames,
    mode === "prefetch" ? effectiveFps : effectiveFps * 2, // at least 1s for prefetch, 2s otherwise
  );
  const maxWindowFrames = Math.min(totalFrames, effectiveFps * 4); // cap at ~4s
  let desiredFramesFromTime = framesBefore + framesAfter;
  if (desiredFramesFromTime <= 0) {
    // Fallback: ~2s window when no explicit range is given
    desiredFramesFromTime = effectiveFps * 2;
  }

  let desiredWindowFrames = Math.min(
    maxWindowFrames,
    Math.max(minWindowFrames, desiredFramesFromTime),
  );

  let startFrame = 0;
  let frameCount = 0;

  if (keyframeInfo && keyframeInfo.indices.length > 0) {
    // Align to the nearest previous keyframe to avoid decoder corruption
    let prevKeyframeIndex = keyframeInfo.indices[0];
    for (const k of keyframeInfo.indices) {
      if (k <= targetFrameIndex) prevKeyframeIndex = k;
      else break;
    }
    startFrame = Math.max(0, prevKeyframeIndex);

    // Use typical keyframe spacing as a hint for window size
    const avgInterval = keyframeInfo.avgInterval || effectiveFps;
    const keyframeSuggested = avgInterval * 2;
    desiredWindowFrames = Math.min(
      maxWindowFrames,
      Math.max(
        minWindowFrames,
        Math.max(desiredWindowFrames, keyframeSuggested),
      ),
    );

    frameCount = Math.min(
      desiredWindowFrames,
      Math.max(1, totalFrames - startFrame),
    );
  } else {
    // No keyframe info: purely time‑based window around the target frame
    startFrame = Math.max(0, targetFrameIndex - framesBefore);
    if (startFrame + desiredWindowFrames > totalFrames) {
      startFrame = Math.max(0, totalFrames - desiredWindowFrames);
    }
    frameCount = Math.max(
      1,
      Math.min(desiredWindowFrames, totalFrames - startFrame),
    );
  }

  // In play mode, avoid re-loading overlapping windows that go “backwards”
  let skip = false;
  if (
    mode === "play" &&
    clampedBeforeMs === 0 &&
    startFrame <= currentWindowStartIndex
  ) {
    skip = true;
  }

  return { startFrame, frameCount, skip };
}
```

This is the brain behind the sliding window: it knows how big the window should be, where it should start, and how to respect GOP/keyframe layout.

---

## 3. Data Flow with Svelte 5 Runes

Screen Recorder Studio is built on **Svelte 5 Runes** (`$state`, `$derived`, `$effect`) for fine‑grained reactivity.

### Why Svelte 5?

At 60fps, video playback and timeline updates can easily overwhelm a naive UI state model. React’s VDOM diffing and traditional dependency tracking can introduce overhead we don’t want in a hot path.

With Svelte 5’s runes:

- State updates are localized – only components that depend on a specific rune re‑run.
- We can express derived values (`sourceFps`, `timelineMaxMs`, etc.) declaratively without incurring heavy runtime cost.

### Request lifecycle

The main flow between the UI and the OPFS reader looks like this:

1. **Trigger**  
   `VideoPreviewComposite` realizes it needs more data – for example:
   - The playhead is nearing the end of the current window.
   - The user scrubs to a different position.
   It calls the `onRequestWindow` callback provided by the Studio page.

2. **Compute**  
   The Studio page calls `computeFrameWindow` with:
   - Target time (`centerMs`).
   - Desired before/after spans.
   - Derived `sourceFps`.
   - Recorded keyframe information from the recording metadata.

3. **Communicate**  
   Based on the result, Studio sends a `getRange` or `getWindowByTime` message to `opfs-reader-worker.ts`.

4. **Receive & swap**

   ```ts
   readerWorker.onmessage = (ev) => {
     const { type, start, count, chunks, summary, keyframeInfo } = ev.data || {};

     if (type === "ready") {
       // Initialize duration, frame count, keyframe map, etc.
     } else if (type === "range") {
       // Hard swap the current window
       workerEncodedChunks = chunks;
       windowStartIndex = typeof start === "number" ? start : 0;
       // Compute windowStartMs / windowEndMs using relative timestamps
     }
   };
   ```

   The old `workerEncodedChunks` reference is dropped. From V8’s point of view, that entire buffer becomes garbage and can be reclaimed. From our point of view, the window has “moved” to a new region of the global file.

---

## 4. Two Performance Levers That Really Matter

While implementing the sliding window, we discovered two performance details that make or break the experience.

### 4.1 Memory strategy: full‑window swap vs append buffer

At the **compressed data layer** (encoded chunks), we chose a **full‑window swap** strategy.

- **Ring buffer / append buffer**  
  Sounds more “efficient” on paper, but in practice:
  - Frequent small messages between workers.
  - Complex pointer arithmetic and off‑by‑one edge cases.
  - Higher risk of memory fragmentation and difficult debugging.

- **Full‑window replacement**  
  Simple and robust:
  - On each window update, we drop the old `ArrayBuffer` reference and adopt a new one.
  - Garbage collection does the hard work for us.

As long as we don’t stash old chunk references elsewhere, the overall memory usage stays flat, even for hour‑long recordings.

> Note: At the **decoded frame layer** (`VideoFrame` objects), the strategy is different:
> - `VideoFrame` holds GPU resources and must be closed manually.
> - In the composite worker we maintain bounded queues (e.g. 150 frames) and explicitly `close()` frames as they age out.

### 4.2 I/O strategy: batch reads

This turned out to be a P0 optimization.

The naive approach was:

> “Need 100 frames? Loop 100 times and call `File.slice()` 100 times.”

Unsurprisingly, this caused huge I/O latency whenever the user scrubbed the timeline.

We switched to:

1. Find the byte `offset` of the first frame.
2. Find `offset + size` of the last frame.
3. Call `file.slice(startOffset, endOffset)` **once**.
4. Split the large buffer into per‑frame chunks in memory using the `index.jsonl` map.

```ts
// src/lib/workers/opfs-reader-worker.ts

// ✅ New: 1 I/O instead of N
const startOffset = indexEntries[startIdx].offset;
const endEntry = indexEntries[endIdx - 1];
const endOffset = endEntry.offset + endEntry.size;

const totalSlice = file.slice(startOffset, endOffset);
const totalBuf = await totalSlice.arrayBuffer();

for (let i = startIdx; i < endIdx; i++) {
  const ent = indexEntries[i];
  const relativeOffset = ent.offset - startOffset;
  const buf = totalBuf.slice(relativeOffset, relativeOffset + ent.size);
  chunks.push({
    data: buf,
    timestamp: Number(ent.timestamp) || 0,
    type: ent.type === "key" ? "key" : "delta",
    size: Number(ent.size) || buf.byteLength,
    codedWidth: ent.codedWidth,
    codedHeight: ent.codedHeight,
    codec: ent.codec,
  });
}
```

On typical hardware this took I/O latency from “tens of milliseconds” down to “a couple of milliseconds” – a visible, tactile difference when scrubbing.

---

## 5. Wrap‑up and Next Problem

With the **sliding window** and **batch I/O** in place, Screen Recorder Studio shifts the problem from “how big is the file?” to “how big is the current time slice?”:

- Whether you record 10 minutes or 10 hours, in typical scenarios the editor’s peak memory usage stays within a **few hundred megabytes**, instead of growing linearly with file length.
- Combined with Svelte 5’s fine‑grained reactivity, the editing experience feels much closer to a native app than to a traditional web page.

But solving “we can’t fit the file in memory” exposes the next challenge:

> When a user clicks at 05:20 on the timeline, how do we find **exactly** the right bytes inside a gigabytes‑large OPFS file?  
> And once we’ve found those bytes, how do we make sure the decoder doesn’t receive “half a GOP” and produce corrupted frames?

In the next article, we’ll dive into the heart of the storage layer and look at **frame‑accurate seeking on top of OPFS and GOP alignment**.

---

> **Previous**: (none)  
> **Next**: [Web Video Editing Engine (2): Frame‑Accurate Seeking with OPFS and GOP](./05-editor-seeking-gop-alignment.en.md)

