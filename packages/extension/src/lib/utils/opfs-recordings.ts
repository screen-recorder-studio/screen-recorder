/**
 * Shared OPFS recordings query layer.
 *
 * Provides unified listing, validation, and caching for recording assets
 * stored in the Origin Private File System. Used by Drive, Studio, and
 * the Action Launcher so that "latest recording" semantics stay consistent.
 */

import type { RecordingSummary } from '$lib/types/recordings'
import { _t as t } from '$lib/utils/i18n'

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000 // 30 seconds

let cachedRecordings: RecordingSummary[] | null = null
let cacheTimestamp = 0

/**
 * Invalidate the local recordings cache so the next query re-scans OPFS.
 */
export function invalidateRecordingsCache(): void {
  cachedRecordings = null
  cacheTimestamp = 0
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all recognisable recordings in OPFS, sorted by createdAt descending.
 * Results are cached for `CACHE_TTL_MS` to avoid repeated I/O.
 *
 * @param forceRefresh  Bypass cache and re-scan OPFS.
 */
export async function listRecordings(
  forceRefresh = false
): Promise<RecordingSummary[]> {
  if (
    !forceRefresh &&
    cachedRecordings !== null &&
    Date.now() - cacheTimestamp < CACHE_TTL_MS
  ) {
    return cachedRecordings
  }

  if (!navigator.storage?.getDirectory) {
    throw new Error(t('drive_errorSupport'))
  }

  const root = await navigator.storage.getDirectory()
  const list: RecordingSummary[] = []

  for await (const handle of (root as any).values()) {
    const name = (handle as any).name as string
    if (name?.startsWith('rec_') && handle.kind === 'directory') {
      try {
        const meta = await readMetaJson(handle as FileSystemDirectoryHandle)
        const summary = await createRecordingSummary(
          name,
          meta,
          handle as FileSystemDirectoryHandle
        )
        list.push(summary)
      } catch {
        // Skip unreadable recordings – they will be treated as unusable
      }
    }
  }

  list.sort((a, b) => b.createdAt - a.createdAt)

  cachedRecordings = list
  cacheTimestamp = Date.now()
  return list
}

/**
 * Return the most recent recording that passes the usability check,
 * or `null` if no usable recording exists.
 */
export async function getLatestValidRecording(
  forceRefresh = false
): Promise<RecordingSummary | null> {
  const all = await listRecordings(forceRefresh)
  for (const rec of all) {
    if (await isRecordingUsable(rec)) {
      return rec
    }
  }
  return null
}

/**
 * Check whether a recording has the minimum required files and metadata
 * to be opened in Studio.
 */
export async function isRecordingUsable(
  summary: RecordingSummary
): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(summary.id)

    // data.bin and index.jsonl must exist
    await dir.getFileHandle('data.bin')
    await dir.getFileHandle('index.jsonl')

    // Basic sanity: duration / totalChunks should be valid
    if (summary.totalChunks <= 0) return false
    if (summary.duration <= 0) return false

    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Internal helpers  (extracted from Drive page)
// ---------------------------------------------------------------------------

async function readMetaJson(
  dirHandle: FileSystemDirectoryHandle
): Promise<any> {
  const metaHandle = await dirHandle.getFileHandle('meta.json')
  const file = await metaHandle.getFile()
  const text = await file.text()
  return JSON.parse(text)
}

async function createRecordingSummary(
  dirName: string,
  meta: any,
  dirHandle: FileSystemDirectoryHandle
): Promise<RecordingSummary> {
  // File size – prefer meta.totalBytes to avoid extra I/O
  let totalSize =
    typeof meta.totalBytes === 'number' ? Number(meta.totalBytes) : 0
  if (!totalSize) {
    try {
      const dataHandle = await dirHandle.getFileHandle('data.bin')
      const dataFile = await dataHandle.getFile()
      totalSize = dataFile.size
    } catch {
      // size will remain 0
    }
  }

  const createdAt = Number(meta.createdAt) || Date.now()
  const width = Number(meta.width) || 1920
  const height = Number(meta.height) || 1080
  const totalChunks = Number(meta.totalChunks) || 0
  const fps = Number(meta.fps) || 30

  // Duration – prefer timestamp-diff (consistent with Studio timeline)
  let duration = 0
  const firstTimestamp =
    typeof meta.firstTimestamp === 'number' ? Number(meta.firstTimestamp) : null
  const lastTimestamp =
    typeof meta.lastTimestamp === 'number' ? Number(meta.lastTimestamp) : null

  if (
    firstTimestamp != null &&
    lastTimestamp != null &&
    lastTimestamp > firstTimestamp
  ) {
    duration = Math.round((lastTimestamp - firstTimestamp) / 1_000_000)
  } else if (
    typeof meta.duration === 'number' &&
    !Number.isNaN(meta.duration)
  ) {
    const raw = Number(meta.duration)
    if (raw > 0) {
      const daySec = 24 * 60 * 60
      if (raw < daySec) {
        duration = Math.round(raw)
      } else if (raw < daySec * 1000) {
        duration = Math.round(raw / 1000)
      } else {
        duration = Math.round(raw / 1_000_000)
      }
    }
  }

  // Last-resort estimate
  if (!duration && totalChunks && fps) {
    duration = Math.round(totalChunks / fps)
  }

  const displayName = generateDisplayName(createdAt)

  return {
    id: dirName,
    displayName,
    createdAt,
    duration,
    resolution: `${width}×${height}`,
    size: totalSize,
    totalChunks,
    codec: meta.codec || 'vp8',
    fps,
    meta,
  }
}

function generateDisplayName(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  const prefix = t('drive_recordingNamePrefix')
  return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
