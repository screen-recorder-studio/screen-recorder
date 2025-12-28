# Beyond MediaRecorder: Building a High-Performance 4K Screen Recorder with WebCodecs & OPFS

> **Abstract:** With the maturity of the WebCodecs API and the enforcement of Chrome's Manifest V3 (MV3), browser-based video processing is undergoing a paradigm shift. This article details how **Screen Recorder Studio** moved away from the legacy `MediaRecorder` API to a fully streaming architecture using Offscreen Documents and the Origin Private File System (OPFS), achieving stable 4K/60FPS recording without memory bottlenecks.

---

## 🚀 Quick Links

*   **GitHub Repository**: [screen-recorder-studio/screen-recorder](https://github.com/screen-recorder-studio/screen-recorder) (Stars appreciated!)
*   **Live Demo**: Install **Screen Recorder Studio** from the Chrome Web Store to see it in action.

---

## 1. The Motivation: Why Ditch MediaRecorder?

For years, the `MediaRecorder` API has been the de facto standard for web recording. It’s simple: pass in a `MediaStream`, and get a WebM file out. However, when building a professional-grade tool, we hit two fatal architectural flaws:

### 1.1 The Memory Trap (OOM)
`MediaRecorder` tends to buffer data in RAM. Even when using the `timeslice` parameter to request data chunks, the internal browser implementation often holds onto large buffers.
*   **The Issue**: Recording 4K video for over 20 minutes often causes the tab process to exceed 3GB of RAM.
*   **The Result**: Chrome triggers its Out of Memory (OOM) killer, crashing the page ("Aw, Snap!") and causing total data loss.

### 1.2 The "Black Box" Problem
`MediaRecorder` outputs a pre-muxed container (usually WebM/Matroska).
*   **Uncontrollable Indexing**: Most implementations write the Seek Head (Cues) only at the very end of the recording. If the browser crashes mid-recording, the file is often corrupt or unseekable.
*   **Unpredictable GOP**: Developers cannot strictly enforce Group of Pictures (GOP) structures or keyframe intervals. This makes accurate seeking and non-linear editing in the browser nearly impossible.

To solve this, we needed a **fully streaming**, **transparent data pipeline**.

---

## 2. The Architecture: MV3 Multi-Process Orchestration

Under Manifest V3, Background Service Workers are ephemeral and cannot hold DOM or MediaStreams. We split the system into three distinct execution environments communicating via a message bus.

### System Layers

1.  **Control Layer (Background Service Worker)**
    *   **Role**: Global State Machine, Lifecycle Management.
    *   **Characteristics**: Short-lived, resource-light.
2.  **Ingestion Layer (Offscreen Document)**
    *   **Role**: Holds the `MediaStream`, extracts raw `VideoFrame` objects.
    *   **Characteristics**: Full DOM access, lifespan tied to the recording session.
3.  **Compute & Storage Layer (Dedicated Workers)**
    *   **Role**: Hardware encoding (WebCodecs), Disk I/O (OPFS).
    *   **Characteristics**: High computation density, non-blocking to the UI.

---

## 3. Implementation Deep Dive

### 3.1 Control: The State Machine
The Background script acts as the conductor. It never touches the actual video data; it simply ensures the stage is set.

```typescript
// src/extensions/background.ts (Snippet)
import { ensureOffscreenDocument, sendToOffscreen } from '../lib/utils/offscreen-manager'

async function startRecordingFlow(options) {
  // 1. Boot the environment
  await ensureOffscreenDocument({
    url: 'offscreen.html',
    reasons: ['DISPLAY_MEDIA', 'WORKERS', 'BLOBS'],
  })

  // 2. Command the ingestion layer to start
  await sendToOffscreen({
    target: 'offscreen-doc',
    type: 'OFFSCREEN_START_RECORDING',
    payload: { options },
  })
}
```

### 3.2 Ingestion: From Stream to Frames
In `offscreen.html`, we bypass `MediaRecorder`. Instead, we use `MediaStreamTrackProcessor` to unwrap the stream. This gives us direct access to raw `VideoFrame` objects, moving us from "File Recording" to "Real-time Frame Processing."

```typescript
// src/extensions/offscreen-main.ts (Snippet)

const processor = new (window as any).MediaStreamTrackProcessor({ track: videoTrack })
const reader: ReadableStreamDefaultReader<VideoFrame> = processor.readable.getReader()

// Spawn the heavy-lifter
const wcWorker = new Worker(new URL('../lib/workers/webcodecs-worker.ts', import.meta.url), {
  type: 'module',
})

while (true) {
  const { value: frame, done } = await reader.read()
  if (done) break

  // Transfer control of the frame to the worker immediately
  wcWorker.postMessage({ type: 'encode', frame }, [frame])
}
```

### 3.3 Compute: Hardware Accelerated Encoding
The Worker receives the `VideoFrame` and feeds it into the `VideoEncoder` API. Unlike the `MediaRecorder` black box, WebCodecs allows granular control over encoding parameters, crucial for performance tuning.

```typescript
// src/lib/workers/webcodecs-worker.ts (Snippet)
import { tryConfigureBestEncoder } from '../utils/webcodecs-config'

await tryConfigureBestEncoder(encoder, {
  codec: config?.codec ?? 'auto',
  width: config?.width ?? 1920,
  height: config?.height ?? 1080,
  framerate: config?.framerate ?? 30,
  bitrate: config?.bitrate,
  latencyMode: config?.latencyMode, // crucial for real-time performance
  hardwareAcceleration: config?.hardwareAcceleration,
})

encoder.encode(frame, { keyFrame: forceKey === true })
```

### 3.4 Storage: Zero-Overhead Writes with OPFS
This is the final piece of the anti-OOM puzzle. Encoded chunks are never aggregated in RAM. They are streamed directly to the Origin Private File System (OPFS).

We utilize the `FileSystemSyncAccessHandle`, which provides a high-performance, synchronous write interface within the Worker. We maintain two files:
1.  **`data.bin`**: The raw bitstream.
2.  **`index.jsonl`**: A line-delimited index containing timestamps, offsets, and frame types.

```typescript
// src/lib/workers/opfs-writer-worker.ts (Snippet)

const root = await (self as any).navigator.storage.getDirectory()
const recDir = await root.getDirectoryHandle(`rec_${id}`, { create: true })

const dataHandle = await recDir.getFileHandle('data.bin', { create: true })
// Acquire exclusive, synchronous lock
const sync = await (dataHandle as any).createSyncAccessHandle()

let offset = 0
const u8 = new Uint8Array(msg.buffer)
const start = offset

// Direct write to disk
const written = sync.write(u8, { at: start })
offset += (typeof written === 'number' ? written : u8.byteLength)

// Update index
await appendIndexLine(JSON.stringify({ offset: start, size: u8.byteLength, timestamp, type }) + '\n')
```

This **Append-only** strategy means that even if the browser crashes, `data.bin` remains on disk, and the timeline can be reconstructed from `index.jsonl`.

### 3.5 Assembly: The Export Phase
It's important to note: `EncodedVideoChunk`s are just pieces of data. They are not a playable file yet.
*   **During Recording**: We optimize for throughput (Capture -> Encode -> Write).
*   **On Export**: We read the artifacts (`data.bin` + `index.jsonl`) and multiplex them into a standard WebM or MP4 container using custom strategies.

---

## 4. The Result: Stability & Performance

By re-engineering the pipeline, Screen Recorder Studio achieved:

1.  **Flat Memory Curve**: Memory usage remains constant regardless of recording duration. It relies only on small processing buffers, not total video size.
2.  **Crash Resilience**: Data is persisted frame-by-frame. If the system crashes at 01:00:00, you still have 00:59:59 of usable footage.
3.  **Editor-Ready**: By decoupling keyframe logic from the container, we enable instant seeking and precise editing in our post-production studio.

For modern web multimedia applications, the combination of **Offscreen + WebCodecs + OPFS** isn't just a "nice to have"—it is the only viable path to break free from the browser sandbox's resource constraints.

---

## Learn More

*   **Repo**: [github.com/screen-recorder-studio/screen-recorder](https://github.com/screen-recorder-studio/screen-recorder)
*   **Install**: Search **Screen Recorder Studio** in the Chrome Web Store.
