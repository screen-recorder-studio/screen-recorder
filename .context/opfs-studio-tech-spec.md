# OPFS-Based Studio Editing & Export – Technical Specification

Status: Proposal (no code changes yet)
Owner: Studio/Recording
Last updated: 2025-09-12

## 0) Goals & Non-Goals
- Goals
  - Replace IndexedDB full-load with OPFS-first, editor-friendly access.
  - Achieve fast seek/scrub on long recordings with bounded memory.
  - Keep a single recordingId across the system and use it as Studio URL id.
  - Support export to WebM and MP4 by reusing the Composite pipeline (decode → composite → encode → mux), streaming to OPFS.
- Non-Goals
  - Server-side processing; external cloud services.
  - Full-blown NLE; scope is preview + basic layout/background effects + export.

## 1) IDs, URLs, and Contracts
- recordingId = OPFS directory name (example: `rec_1757651534329`). This is the single source of truth for locating a recording.
- Studio URL: `studio.html?id=<recordingId>` (e.g., `?id=rec_1757651534329`).
- Generation timing: at recording start.
- Consistency
  - For OPFS writer worker today: it expects a “bare” numeric id and adds `rec_` internally, writing meta.id = `rec_<bareId>`.
  - For Studio and end-to-end: we will treat `recordingId` as the full directory name (`rec_<ts>`), equal to meta.id and the folder name.
- IndexedDB (if retained): store only lightweight metadata + `opfsId = recordingId`. No large arrays.

## 2) OPFS Layout & Schemas
Directory structure (under the extension origin’s OPFS):
```
rec_<id>/
  meta.json
  index.jsonl
  data.bin
  exports/                # optional outputs
    out.webm
    out.mp4
    manifest.json         # optional, records export history
  thumbs/                 # optional, keyframe thumbnails for timeline
```

meta.json (canonical, example):
```json
{
  "id": "rec_1757651534329",      
  "createdAt": 1757651534333,
  "completed": true,
  "codec": "vp8",                 
  "width": 4094,
  "height": 2440,
  "fps": 30,
  "totalBytes": 5559278,
  "totalChunks": 120,
  "opfsFormat": 1,                
  "durationMs": 0,               
  "hasAudio": false,              
  "syncAccess": true              
}
```
Notes:
- `opfsFormat` is a simple version tag for future evolution.
- `durationMs` optional; can be derived from last index timestamp.
- `syncAccess` indicates writer used SyncAccessHandle.

index.jsonl (one JSON object per line):
```json
{"offset":0,"size":12345,"timestamp":0,"type":"key","isKeyframe":true,"codedWidth":4094,"codedHeight":2440,"codec":"vp8"}
{"offset":12345,"size":8123,"timestamp":33333,"type":"delta","isKeyframe":false,"codedWidth":4094,"codedHeight":2440,"codec":"vp8"}
```
Fields:
- offset: number (byte offset in data.bin)
- size: number (length in bytes)
- timestamp: number (microseconds)
- type: 'key' | 'delta'
- isKeyframe: boolean (redundant with type, present for clarity)
- codedWidth, codedHeight, codec: optional repeat for diagnostics

## 3) Reader Layer (OPFSReaderWorker)
Purpose: Editor-friendly, bounded-memory IO for OPFS recordings.

### Responsibilities
- Resolve directory by `recordingId` (folder name equals meta.id).
- Load and parse meta.json.
- Stream-parse index.jsonl (line-by-line), building lightweight search structures:
  - chunkCount, totalDurationMs
  - time → chunkIndex bisection (timestamp array)
  - keyframe positions (array of indices)
- Provide random access APIs for chunk batches; prefer SyncAccessHandle for reads.

### API (message protocol)
Inbound (from main thread/Studio):
```ts
// Open by directory id (full name like "rec_175765..."), mandatory
{ type: 'open', dirId: string }

// Fetch chunk batch by [start, count]
{ type: 'getRange', start: number, count: number }

// Query GOP window containing time (ms)
{ type: 'gopByTime', ms: number }

// Optional: soft prefetch around a chunk index / seconds window
{ type: 'prefetchAround', index: number, seconds?: number }

// Close and release handles
{ type: 'close' }
```
Outbound (to main thread/Studio):
```ts
{ type: 'ready', meta, summary: { totalChunks, durationMs, fps, width, height, codec } }
{ type: 'range', start, count, chunks: Array<Chunk>, transfer?: ArrayBuffer[] }
{ type: 'gop', ms, keyIndex, startIndex, endIndex }
{ type: 'error', code, message }
{ type: 'closed' }
```
Chunk wire format (transferable):
```ts
interface Chunk {
  data: ArrayBuffer;           // transferable buffer with exact slice
  timestamp: number;           // µs
  type: 'key' | 'delta';
  size: number;
  codedWidth?: number;
  codedHeight?: number;
  codec?: string;
}
```

### Implementation Notes
- Use `navigator.storage.getDirectory()` in the worker to resolve OPFS root.
- Locate `dirId` directory; open `index.jsonl`, `data.bin`, `meta.json`.
- Stream-parse index.jsonl to avoid loading it all at once; persist arrays of timestamps and keyframe indices.
- Reads
  - If SyncAccessHandle is available: `read(u8, { at })` to fill buffers efficiently.
  - Else: `getFile()` + `Blob.slice(offset, offset + size)` + `arrayBuffer()`.
- Caching policy
  - Keep a small LRU cache for recently requested ranges (configurable window).
  - Ensure hard upper bound for memory (e.g., ≤ 200MB by default).

### Error Codes
- OPFS_NOT_AVAILABLE, DIR_NOT_FOUND, META_NOT_FOUND, INDEX_NOT_FOUND,
- INDEX_PARSE_ERROR, DATA_RANGE_ERROR,
- CLOSED, INTERNAL.

## 4) Composite Layer (VideoComposite Worker) – Two Phases

### Phase 1 (Minimal change – push in batches)
- Keep current Composite Worker API (accepts encodedChunks[]), but feed it incrementally.
- Studio flow:
  1) `OPFSReaderWorker.open(dirId)` → `ready`
  2) Find first keyframe; `getRange(start, N)` (e.g., 1–2 GOPs)
  3) Push to current `VideoPreviewComposite` as `encodedChunks` and set `isRecordingComplete = true`
  4) On user seek/scrub: request additional batches and append; enforce a max buffer length by discarding distant chunks from in-memory list.
- Pros: Fast to ship; eliminates IDB full-load.
- Cons: Composite still “push”-based; not optimal for frequent random seek.

### Phase 2 (Recommended – pull-based protocol)
Extend Composite Worker to request chunks from host when needed.

Inbound (from main thread):
```ts
{ type: 'open', source: 'opfs', dirId: string, preview: { displayWidth?: number, displayHeight?: number } }
{ type: 'seek', ms: number }
{ type: 'play' } | { type: 'pause' } | { type: 'stop' }
{ type: 'config', backgroundConfig: ... } // existing background features
{ type: 'close' }
```
Outbound (from worker):
```ts
{ type: 'initialized' }
{ type: 'ready', totalFrames, duration, outputSize: { width, height } }
{ type: 'requestChunks', start: number, count: number }          // NEW: pull request
{ type: 'frame', bitmap: ImageBitmap, frameIndex, timestamp }
{ type: 'sizeChanged', outputSize: { width, height } }
{ type: 'complete' }
{ type: 'error', message }
```
Host must answer `requestChunks` by calling `OPFSReaderWorker.getRange` and responding:
```ts
{ type: 'chunks', start, count, chunks: Chunk[], transfer?: ArrayBuffer[] }
```
Worker maintains a small windowed cache (e.g., 1–3 GOPs), and evicts on seek.

## 5) Export Orchestrator (WebM & MP4)
Purpose: Stream the full (or EDL-defined) timeline through decode → composite → encode → mux, writing to OPFS `exports/` without large RAM spikes.

### Capability Detection
- Use `VideoEncoder.isConfigSupported` with target codec
  - WebM: VP9 ('vp09.00.10.08') or VP8 ('vp8')
  - MP4: H.264/AVC (e.g., 'avc1.42E01E') – may not be available on all devices
- If H.264 unsupported → fallback to WebM, present UI hint.

### Export API (main thread → Composite/Export worker)
```ts
{ type: 'export:start', container: 'webm' | 'mp4',
  codec?: 'vp9' | 'vp8' | 'h264',
  bitrate?: number, fps?: number, width?: number, height?: number,
  backgroundConfigSnapshot?: any,
  outputPath?: `exports/${string}` }     // default: exports/out.webm | out.mp4

{ type: 'export:pause' } | { type: 'export:resume' } | { type: 'export:cancel' }
```

Progress / results (worker → main thread):
```ts
{ type: 'export:progress', percent: number, framesEncoded: number, bytesWritten: number }
{ type: 'export:warning', code, message }
{ type: 'export:complete', output: { path: string, size: number, durationMs: number, codec: string, container: string } }
{ type: 'export:error', code, message }
```

### Implementation Notes
- Perform decode → composite → encode → mux entirely inside the worker to avoid heavy message passing.
- Multiplexing libraries
  - WebM: webm-muxer (or equivalent) designed for WebCodecs
  - MP4: mp4-muxer (WebCodecs-friendly); ensure AnnexB/AVCC correctness
- Writing
  - Stream to OPFS via WritableStream/FileSystemSyncAccessHandle
  - On cancel, close handles and keep partial file (optional) with manifest note
- EDL (future): allow a simple list of segments; iterate segments sequentially.

### Export Error Codes
- ENCODER_NOT_SUPPORTED, MUX_ERROR, IO_ERROR, CANCELLED, TIMEOUT, INTERNAL.

## 6) Performance Targets
- Open long recording: first keyframe displayed in ≤ 1–2 s (meta + index open + first batch read + first decode)
- Seek latency: ≤ 200 ms to nearest keyframe preview; ≤ 500 ms to exact target frame
- Memory cap: default ≤ 200 MB for cached chunks/frames (configurable)
- Export: progress visible, stream to OPFS, no large in-memory buffers

## 7) Compatibility & Fallbacks
- OPFS availability: required in extension context; reader/ writer workers are dedicated workers
- No SyncAccessHandle: fallback to Blob.slice reads; performance lower but functional
- H.264 unsupported: MP4 export disabled or auto-fallback to WebM
- Legacy recordings: if URL id not found in OPFS, optionally fallback to IndexedDB using `opfsId` in IDB meta

## 8) Telemetry & Logging (production)
- Gate verbose logs behind dev flag; summarize key events (open/seek/request/evict/export progress)
- Error events include codes; redact large buffers from logs

## 9) Test Plan
- Unit: index.jsonl parser (streaming), time→index bisection, keyframe lookup
- Integration: OPFSReaderWorker open/getRange; Composite pull flow; export pipeline for short samples
- Stress: 30–60 min recordings – open time, repeated seeks, memory ceiling
- Capability: H.264 support detection paths; fallbacks
- Export correctness: container playable in Chrome/VLC; duration and fps match meta

## 10) Rollout Plan
- Phase 0: unify recordingId across paths (no behavior change, ensure URL = dir name)
- Phase 1: ship OPFSReaderWorker + batch push feeding existing preview; Studio opens long recordings
- Phase 2: upgrade Composite to pull-based; adopt windowed cache and eviction
- Phase 3: streaming export (WebM first; MP4 when supported); write outputs to exports/

## 11) Open Questions
- Audio support (future): capture, index, mux – out of current scope
- Thumbnails: generate on demand vs. precompute during recording/export
- Binary index format for faster load/search in very large recordings

