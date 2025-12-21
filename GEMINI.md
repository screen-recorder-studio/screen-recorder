# Screen Recorder Studio - AI Context & Development Guide

## 🚀 Project Overview
A professional-grade, high-performance Chrome extension for video recording and editing. By leveraging the combination of **WebCodecs (Hardware-Accelerated Encoding)** and **OPFS (Origin Private File System)**, it solves the long-standing issues of browser crashes and export delays when handling high-resolution or long-duration recordings.

This project is open-source under the **MIT License**.

---

## 🛠️ Core Technology Stack
- **Framework**: Svelte 5 (utilizing the Runes reactivity system)
- **UI**: Tailwind CSS + Lucide Svelte
- **Video Backend**: WebCodecs API (`VideoEncoder` / `VideoDecoder`)
- **Storage Backend**: OPFS (Origin Private File System)
- **Build System**: Vite + SvelteKit (for modular architecture)

---

## 🏗️ Core Architecture

### 1. Recording Pipeline
- **Orchestration (`background.ts`)**: Manages tab states, Offscreen Document lifecycle, and global recording singletons.
- **Capture Host (`offscreen.html/js`)**: The actual environment holding the `MediaStream`, responsible for initializing WebCodecs encoders.
- **Persistent Writer (`opfs-writer.ts`)**: A dedicated Worker thread that streams encoded data into `data.bin` and `index.jsonl` in real-time.

### 2. OPFS Storage System
Each recording is stored in a unique directory: `rec_{timestamp}/`
- **`meta.json`**: Contains resolution, framerate, encoder configurations, and total duration.
- **`index.jsonl`**: **The Core Index**. A line-delimited JSON file where each entry records a frame's `offset`, `size`, `timestamp(μs)`, and `isKeyframe` flag.
- **`data.bin`**: The raw binary stream of encoded video chunks.

### 3. Studio Rendering Engine (`src/routes/studio/`)
- **Data Loading**: Implements "on-demand" fetching via `OPFSReaderWorker` instead of loading the entire file into memory.
- **Seek Logic**: 
  1. Searches the index for the target timestamp.
  2. Traverses backward to the nearest **Keyframe**.
  3. Decodes the GOP (Group of Pictures) via WebCodecs and renders frames to the Canvas.
- **Performance**: Implements **Batch Read** optimization, fetching 2-4 seconds of frame data in a single I/O operation to minimize disk overhead.

### 4. State Management (`src/lib/stores/recording.svelte.ts`)
- Utilizes Svelte 5 `$state` for the recording state machine (`idle` -> `preparing` -> `recording` -> `completed`).
- Provides real-time telemetry for FPS, Bitrate, and disk usage.

---

## 📂 Directory Navigation
- `/src/extensions/`: Core extension scripts (Background, Content, Offscreen).
- `/src/lib/workers/`: High-performance Workers for storage and retrieval.
- `/src/routes/control/`: Recording control console UI.
- `/src/routes/studio/`: Post-processing video editor.
- `/src/routes/drive/`: Local recording file manager.

---

## ⚠️ Development Guidelines
1. **Timestamp Precision**: Internally, all timestamps in indices and metadata use **Microseconds (μs)**. These MUST be converted to **Milliseconds (ms)** for UI display or progress calculations.
2. **GOP Alignment**: Seek operations MUST be aligned to the nearest previous keyframe. Attempting to decode delta frames without the preceding keyframe will result in visual artifacts.
3. **OPFS Locking**: The OPFS directory is typically locked during recording. The Studio should access files in a read-only manner to avoid access conflicts.
4. **Build Process**: Ensure the build scripts in `scripts/` are used to correctly handle worker bundling and path resolution via `fix-paths.js`.

---

## 🎯 AI Collaboration Tips
When modifying video processing or playback logic, start by examining the `summarize` and `getRange` methods in `src/lib/workers/opfs-reader-worker.ts`. This file provides the best insight into the project's data structure and I/O patterns.