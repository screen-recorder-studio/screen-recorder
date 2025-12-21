# Building a Browser-Based Time-Series Database: High-Performance Video Storage with OPFS

> **Abstract:** When handling gigabytes of high-definition video data in the browser, traditional storage mechanisms like `IndexedDB` or in-memory `Blob` accumulation often hit a wall. This article details how **Screen Recorder Studio** leverages the Origin Private File System (OPFS) and `SyncAccessHandle` to build a high-throughput, crash-resilient local storage engine inspired by Log-Structured File Systems (LFS).

---

## Quick Start

*   **Source Code**: Star us on [GitHub](https://github.com/screen-recorder-studio/screen-recorder).
*   **Try it Out**: Install **Screen Recorder Studio** from the Chrome Web Store to see the engine in action.

---

## 1. The Memory Wall: Why Blobs Fail at Scale

In standard web development, handling file downloads usually involves accumulating data chunks into an array and creating a `Blob`. While fine for small images or PDFs, this "In-Memory" approach is fatal for long-form screen recording:

1.  **The OOM Crash**: A 1-hour recording at 4K/60FPS generates 4GB to 8GB of encoded data. This easily breaches the strict per-tab memory limits of modern browsers (often capped around 4GB), causing the dreaded "Aw, Snap!" crash.
2.  **I/O Blocking**: Even if you attempt to offload data to `IndexedDB`, its asynchronous transaction model introduces significant overhead. At 60Hz, the constant Promise resolution and event loop scheduling can starve the video encoder, leading to dropped frames and stuttering.

To record indefinitely, we need a mechanism that **bypasses the main thread**, **writes directly to disk**, and **persists data in real-time**.

### The Engineering Goals

From a systems perspective, "saving video to disk" involves four conflicting requirements:

1.  **Throughput**: Sustain 60FPS writes without choking the encoder.
2.  **Seekability**: Allow the editor to instantly jump to specific timestamps.
3.  **Resilience**: If the browser crashes or the battery dies, the recording must be recoverable.
4.  **Exportability**: The raw data must be convertible to standard MP4/WebM containers later.

---

## 2. The Game Changer: OPFS & Synchronous I/O

Chrome 102 introduced a primitive within the **Origin Private File System (OPFS)** called `FileSystemSyncAccessHandle`. Available exclusively within Dedicated Workers, it unlocks high-performance, synchronous file operations.

### Why is SyncAccessHandle Faster?
Compared to `FileWriter` or `Blob.stream()`, the synchronous handle offers architectural advantages closer to C/C++ system programming:
*   **Zero Context Switching**: Write operations block the Worker thread and execute immediately, bypassing the event loop queue entirely.
*   **Buffer Reuse**: It supports in-place read/write operations using `DataView` or `TypedArray`, minimizing the expensive copying of data between the JavaScript heap and the native heap.

### The Constraint: Dedicated Workers Only
Because `FileSystemSyncAccessHandle` blocks execution, it is strictly forbidden on the main thread to prevent freezing the UI. This aligns perfectly with our architecture: **Screen Recorder Studio** isolates file I/O in a dedicated `opfs-writer-worker`. Even if disk I/O spikes, the UI remains buttery smooth.

---

## 3. Architecture: The Log-Structured Engine

To achieve high throughput and crash resilience, we abandoned the idea of writing a valid MP4 container in real-time. MP4s require updating a global header (`moov` atom) continuously or at the end, which is fragile.

Instead, we designed a storage structure akin to a **Time-Series Database** or a **Write-Ahead Log (WAL)**. We decouple the "payload" from the "index".

Each recording session is a directory containing three core files:

### 3.1 `data.bin` ( The Payload )
This acts as our Write-Ahead Log. Every `EncodedVideoChunk` received from the encoder is appended directly to the end of this file.

*   **Strategy**: Pure Append-Only. No seeking backwards, no overwriting. This maximizes disk throughput.
*   **Content**: Raw VP9/H.264 bitstream without container overhead.

### 3.2 `index.jsonl` ( The Seek Table )
A sparse index stored in JSON Lines format. Each line maps a video frame to its physical location on the disk:

```json
{"offset":0,"size":45023,"timestamp":0,"type":"key","isKeyframe":true}
{"offset":45023,"size":1204,"timestamp":33333,"type":"delta","isKeyframe":false}
```

*   **offset/size**: The byte range in `data.bin`.
*   **timestamp**: Microsecond precision, critical for aligning audio/video during export.
*   **type**: Distinguishes Keyframes (I-frames) from Delta frames (P-frames), essential for seeking.

### 3.3 `meta.json` ( The Superblock )
Stores global session metadata: resolution, framerate, codec string, and the "finalized" state (used to detect crashes).

---

## 4. Implementation: Double Buffering Strategy

In `opfs-writer-worker.ts`, we implement a double buffering strategy to balance I/O frequency against data safety.

```typescript
// src/lib/workers/opfs-writer-worker.ts

// Level 1: Immediate Sync Write for Video Data
// We write the heavy binary payload immediately to ensure it hits the OS cache/disk.
const written = accessHandle.write(u8Buffer, { at: currentOffset });

// Level 2: Memory Buffering for the Index
// Writing small text strings to disk 60 times a second is inefficient.
pendingIndexLines.push(metaLine);

// Flush Strategy
if (chunksWritten % 100 === 0) {
  // Every 100 frames (~3 seconds), we flush the index to disk.
  flushIndexToFile();
}
```

This strategy ensures that the video data (the asset you can't recreate) is persisted instantly, while the index (which can theoretically be rebuilt by scanning the binary) is flushed periodically to reduce overhead.

### The Write Protocol

The writer worker is an append-only state machine responding to four messages:
*   `init`: Creates the directory `rec_<id>` and files.
*   `append`: Writes binary to `data.bin`, buffers metadata for `index.jsonl`.
*   `flush`: Forces the index buffer to disk.
*   `finalize`: Marks `meta.json` as completed and closes handles.

---

## 5. Engineering for Crash Recovery

The true value of this architecture is **Fault Tolerance**.

In the event of a browser crash, power loss, or process termination:
1.  **Data Survival**: Since `data.bin` is append-only, the bytes are already on the disk (subject to OS flush policies). We don't need to "close" the file to save it.
2.  **Index Recovery**: If the `index.jsonl` is missing the last few seconds (due to the buffer), we can typically recover by truncating the file to the last valid index entry. We do not need to parse the raw bitstream unless absolutely necessary.
3.  **Decoupled Export**: The complex logic of muxing into MP4/WebM happens *after* the recording. We never risk corrupting the source file by trying to mux in real-time.

**The Recovery Flow**:
When the app restarts, it checks `meta.json`. If `completed` is false, it reads the `index.jsonl` to find the last committed entry. It then treats the session as valid up to that point, allowing the user to export the recovered footage without data loss.

---

## 6. The Read Path: Optimization for the Studio

Writing is only half the battle. The Editor (Studio) needs to scrub through this data smoothly.

### 6.1 Opening & Summarization
When opening a session, the reader worker scans `meta.json` and `index.jsonl` to build an in-memory map of Keyframes and calculates the total duration (Last Timestamp - First Timestamp).

### 6.2 Seek Logic
Video codecs cannot decode arbitrary frames; they must start from a **Keyframe**. To seek to timestamp `T`:
1.  **Binary Search** the `index.jsonl` for `T`.
2.  **Backtrack** to the nearest previous Keyframe.
3.  **Decode** the sequence from that Keyframe up to `T`.

### 6.3 The "Batch Read" Optimization
A naive implementation would issue a `read()` call for every single frame. For a 3-second timeline segment, that's 180 separate I/O calls.

In `opfs-reader-worker.ts`, we implemented **Batch Reading**:
1.  Calculate the byte range for the entire requested time window (e.g., `[StartOffset, EndOffset]`).
2.  Perform **one single** `slice()` operation to read the megabytes of data into memory.
3.  Slice this buffer in memory into individual chunks based on the index.

```typescript
// P0 Optimization: Turn N I/O ops into 1
const totalSlice = file.slice(startOffset, endOffset);
const totalBuf = await totalSlice.arrayBuffer();

// Parse in memory
for (let i = startIdx; i < endIdx; i++) {
  // ... split totalBuf ...
}
```
This reduces I/O overhead by orders of magnitude, making timeline scrubbing instant.

---

## 7. Storage Management & Quotas

OPFS is bound by the browser's origin storage quota. Handling gigabytes of video requires disciplined space management:

*   **Directory-based Isolation**: Each session lives in its own `rec_<id>` folder. This makes enumeration, statistics, and deletion atomic and safe.
*   **Deletion Strategy**: We delete the entire directory to recycle space. This is more reliable than deleting individual files which might leave orphans.
*   **Export vs. Source**: We treat the OPFS data as "Project Files." Exporting an MP4 creates a separate file (usually saved to the user's visible Download folder), allowing the user to delete the raw OPFS project to free up quota.

---

## 8. Limitations & Future Work

While this "Payload + Index + Meta" architecture solves the stability and throughput issues, it has boundaries:

*   **Raw Format**: `data.bin` is not a valid video file. It *must* be processed by the export engine to be playable in standard media players.
*   **Index Scaling**: `index.jsonl` is text-based. For extremely long recordings (e.g., 10+ hours), parsing this text file becomes a bottleneck. Binary indexing or chunked indexing would be the next optimization step.
*   **Read Performance**: Currently, we use `File.slice` for reading. Upgrading the reader to also use `SyncAccessHandle` (just like the writer) could further reduce read latency.

## Conclusion

By adopting the principles of **Log-Structured File Systems**, Screen Recorder Studio solves the browser storage bottleneck. This "Payload First, Index Later" approach using OPFS `SyncAccessHandle` provides the reliability of a database with the raw throughput required for 4K video recording.

---

## Learn More

*   **GitHub**: [screen-recorder-studio/screen-recorder](https://github.com/screen-recorder-studio/screen-recorder)
*   **Chrome Web Store**: Search for **Screen Recorder Studio**