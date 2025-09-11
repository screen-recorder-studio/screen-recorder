import type { ContentState, Mode, RecordingMetadata } from './types'

// Basic state migrated from content.js (single source of truth)
export const state: ContentState = {
  mode: 'element',
  selecting: false,
  recording: false,
  selectedElement: null,
  selectionBox: null,
  isDragging: false,
  startX: 0,
  startY: 0,
  stream: null,
  track: null,
  root: null,
  preview: null,
  elementContainer: null,
  elementRecordingTarget: null,
  regionContainer: null,
  regionRecordingTarget: null,
  mediaRecorder: null,
  recordedChunks: [],
  videoBlob: null,
  usingWebCodecs: true,
  processor: null as any,
  reader: null as any,
  port: null,
  chunkCount: 0,
  byteCount: 0,
  worker: null,
  workerBlobUrl: null,
  encodedChunks: [],
  recordingMetadata: null as RecordingMetadata | null,
}

export function setMode(m: Mode) {
  state.mode = m
}

export function ensureRoot(): HTMLDivElement {
  if (state.root && document.body.contains(state.root)) return state.root
  const root = document.createElement('div')
  root.id = 'mcp-content-root'
  Object.assign(root.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    zIndex: String(2 ** 31 - 1), // top-most
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  document.documentElement.appendChild(root)
  state.root = root
  return root
}

export function setSelecting(v: boolean) {
  state.selecting = v
}

export function resetRecordingState() {
  state.recording = false
  state.stream?.getTracks().forEach(t => t.stop())
  state.stream = null
  state.track = null
  state.processor = null as any
  state.reader = null as any
  state.port?.disconnect()
  state.port = null
  if (state.worker) {
    state.worker.terminate()
    state.worker = null
  }
  if (state.workerBlobUrl) {
    URL.revokeObjectURL(state.workerBlobUrl)
    state.workerBlobUrl = null
  }
  state.mediaRecorder = null
  state.recordedChunks = []
  state.videoBlob = null
  state.chunkCount = 0
  state.byteCount = 0
  state.encodedChunks = []
  state.recordingMetadata = null
}

export function setRecordingMeta(meta: RecordingMetadata) {
  state.recordingMetadata = meta
}

