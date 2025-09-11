// Types for content script (TS migrated from static/content.js)

export type Mode = 'element' | 'region'

export interface SelectedRegion {
  width: number
  height: number
  x: number
  y: number
}

export interface EncodedChunk {
  data: Uint8Array | number[] // sender may use array for messaging
  timestamp: number
  type: 'key' | 'delta'
  size: number
  codedWidth: number
  codedHeight: number
  codec: string
}

export interface RecordingMetadata {
  mode: Mode
  selectedElement: string | null
  selectedRegion: SelectedRegion | null
  startTime: number
  codec: string
  width: number
  height: number
  framerate: number
}

export interface CapsReport {
  getDisplayMedia: boolean
  restrictionTarget: boolean
  cropTarget: boolean
}

export interface ContentState {
  mode: Mode
  selecting: boolean
  recording: boolean
  selectedElement: Element | null
  selectionBox: HTMLDivElement | null
  isDragging: boolean
  startX: number
  startY: number
  stream: MediaStream | null
  track: MediaStreamTrack | null
  root: HTMLDivElement | null
  preview: HTMLDivElement | null
  elementContainer: HTMLDivElement | null
  elementRecordingTarget: HTMLDivElement | null
  regionContainer: HTMLDivElement | null
  regionRecordingTarget: HTMLDivElement | null
  mediaRecorder: MediaRecorder | null
  recordedChunks: BlobPart[]
  videoBlob: Blob | null
  usingWebCodecs: boolean
  processor: MediaStreamTrackProcessor | null
  reader: ReadableStreamDefaultReader<VideoFrame> | null
  port: chrome.runtime.Port | null
  chunkCount: number
  byteCount: number
  worker: Worker | null
  workerBlobUrl: string | null
  encodedChunks: EncodedChunk[]
  recordingMetadata: RecordingMetadata | null
}

