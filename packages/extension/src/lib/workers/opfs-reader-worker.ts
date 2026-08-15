// OPFSReaderWorker: basic OPFS read access for Studio (Phase 1)
// Provides: open(dirId), getRange(start,count), close
// Notes:
// - Timestamps are stored in microseconds in index.jsonl
// - This basic version parses full index.jsonl into memory once
// - Data slices are read via Blob.slice; upgrade to SyncAccessHandle later

import { resolveRecordingDurationMs } from './recording-meta-duration'
import { createRecordingTimeline } from '../recording/recording-timeline'
import { getReaderReplyContext } from './reader-request-context'
import { planReaderWindowByIndex, planReaderWindowByTime } from './reader-window-plan'

interface OpenMsg { type: 'open'; dirId: string }
interface ReaderRequestContext {
  requestId?: number
  purpose?: 'main' | 'prefetch' | 'single-frame'
}
interface GetRangeMsg extends ReaderRequestContext { type: 'getRange'; start: number; count: number }
interface GetSingleFrameGOPMsg extends ReaderRequestContext { type: 'getSingleFrameGOP'; targetFrame: number }
interface CloseMsg { type: 'close' }

type InMsg = OpenMsg | GetRangeMsg | GetSingleFrameGOPMsg | CloseMsg

interface ChunkIndex {
  offset: number
  size: number
  timestamp: number // microseconds
  type: 'key' | 'delta'
  isKeyframe?: boolean
  codedWidth?: number
  codedHeight?: number
  codec?: string
}

interface ChunkWire {
  data: ArrayBuffer
  timestamp: number
  type: 'key' | 'delta'
  size: number
  codedWidth?: number
  codedHeight?: number
  codec?: string
}

let rootDir: FileSystemDirectoryHandle | null = null
let recDir: FileSystemDirectoryHandle | null = null
let meta: any = null
let indexEntries: ChunkIndex[] = []
let dataFileHandle: FileSystemFileHandle | null = null
let openedDirId: string | null = null

// 🔧 优化时间戳处理：基于OPFS Writer的实际格式
function timestampToMs(timestamp: number): number {
  // 根据opfs-writer-worker.ts，时间戳以微秒存储
  // 需要转换为毫秒用于UI显示和计算
  return Math.round(timestamp / 1000)
}

// 🔧 计算相对时间戳（从第一帧开始）
function getRelativeTimestampMs(timestamp: number, baseTimestamp: number): number {
  return timestampToMs(timestamp - baseTimestamp)
}

async function ensureRoot() {
  if (!(self as any).navigator?.storage?.getDirectory) {
    throw new Error('OPFS not available in this context')
  }
  rootDir = await (self as any).navigator.storage.getDirectory()
}

async function openDir(dirId: string) {
  if (!rootDir) await ensureRoot()
  recDir = await (rootDir as any).getDirectoryHandle(dirId, { create: false })
  openedDirId = dirId
}

async function readMeta() {
  const fh = await (recDir as any).getFileHandle('meta.json')
  const f = await fh.getFile()
  const text = await f.text()
  meta = JSON.parse(text)
}

async function readIndexAll(): Promise<void> {
  const ih = await (recDir as any).getFileHandle('index.jsonl')
  const f = await ih.getFile()
  const text = await f.text()
  const lines = text.split(/\r?\n/).filter(Boolean)
  indexEntries = lines.map((line: string, index: number) => {
    try {
      return JSON.parse(line) as ChunkIndex
    } catch {
      throw new Error(`INDEX_PARSE_ERROR at line ${index}`)
    }
  })
}

async function openDataFileHandle() {
  dataFileHandle = await (recDir as any).getFileHandle('data.bin')
}

async function getDataFile(): Promise<File> {
  if (!dataFileHandle) throw new Error('DATA_HANDLE_NOT_OPEN')
  return dataFileHandle.getFile()
}

function summarize() {
  const totalChunks = indexEntries.length

  if (totalChunks === 0) {
    return {
      totalChunks: 0,
      durationMs: 0,
      fps: meta?.fps || 30,
      width: meta?.width || 0,
      height: meta?.height || 0,
      codec: meta?.codec || 'unknown',
      firstTimestamp: 0,
      lastTimestamp: 0,
      keyframeCount: 0,
      keyframeIndices: [],
      avgChunkSize: 0,
      totalBytes: 0,
      timeline: {
        version: Number(meta?.timelineVersion) === 2 ? 2 : 1,
        durationMs: 0,
        nominalFps: meta?.fps || 30,
        firstTimestampUs: 0,
        sampleTimestampsMs: [],
        sampleDurationsMs: []
      }
    }
  }

  const firstTimestamp = indexEntries[0]?.timestamp ?? 0
  const lastTimestamp = indexEntries.at(-1)?.timestamp ?? 0

  // 🔧 充分利用index.jsonl中的数据
  const keyframeIndices: number[] = []
  let totalBytes = 0
  const chunkSizes: number[] = []

  // 🔧 诊断：检查时间戳单调性和关键帧分布
  let timestampErrors: Array<{ index: number; prev: number; curr: number }> = []
  let prevTimestamp = -1

  indexEntries.forEach((entry, index) => {
    // 收集关键帧索引
    if (entry.type === 'key' || entry.isKeyframe) {
      keyframeIndices.push(index)
    }
    // 统计数据大小
    totalBytes += entry.size || 0
    chunkSizes.push(entry.size || 0)

    // 🔧 诊断：检查时间戳是否单调递增
    const currTimestamp = entry.timestamp ?? 0
    if (prevTimestamp >= 0 && currTimestamp < prevTimestamp) {
      timestampErrors.push({ index, prev: prevTimestamp, curr: currTimestamp })
    }
    prevTimestamp = currTimestamp
  })

  const nominalFps = Number(meta?.fps) > 0 ? Number(meta.fps) : 30
  const resolvedDurationMs = resolveRecordingDurationMs(meta, firstTimestamp, lastTimestamp)
  const timeline = createRecordingTimeline({
    sourceTimestampsUs: indexEntries.map((entry) => entry.timestamp),
    canonicalDurationMs: resolvedDurationMs,
    nominalFps
  })
  const durationMs = timeline.durationMs
  const avgChunkSize = totalBytes / totalChunks

  const summary = {
    totalChunks,
    durationMs,
    fps: nominalFps,
    width: meta?.width || 0,
    height: meta?.height || 0,
    codec: meta?.codec || 'unknown',
    firstTimestamp,
    lastTimestamp,
    keyframeCount: keyframeIndices.length,
    keyframeIndices,
    avgChunkSize: Math.round(avgChunkSize),
    totalBytes,
    timeline: {
      version: Number(meta?.timelineVersion) === 2 ? 2 : 1,
      durationMs: timeline.durationMs,
      nominalFps: timeline.nominalFps,
      firstTimestampUs: firstTimestamp,
      sampleTimestampsMs: timeline.sourceTimestampsMs,
      sampleDurationsMs: timeline.sourceDurationsMs
    }
  }

  // 🔧 诊断日志：检查数据完整性

  // 🔴 关键诊断：检查关键帧标记是否正确
  if (keyframeIndices.length === 0) {
    console.error('❌ [DIAGNOSTIC] NO KEYFRAMES FOUND! All frames are delta frames. This will cause playback issues.')
  } else if (keyframeIndices[0] !== 0) {
    console.error('❌ [DIAGNOSTIC] First frame is NOT a keyframe! index[0]:', keyframeIndices[0])
  }

  // 🔴 关键诊断：检查时间戳单调性
  if (timestampErrors.length > 0) {
    console.error('❌ [DIAGNOSTIC] Timestamp ordering errors detected!', {
      errorCount: timestampErrors.length,
      firstErrors: timestampErrors.slice(0, 5)
    })
  } else {
  }

  // 🔴 关键诊断：检查关键帧间隔是否合理
  if (keyframeIndices.length >= 2) {
    const intervals = keyframeIndices.slice(1).map((k, i) => k - keyframeIndices[i])
    const maxInterval = Math.max(...intervals)
    const minInterval = Math.min(...intervals)
  }

  return summary
}

// 基于相对时间的索引查找（视频编辑器核心功能）
function idxByRelativeTimeMs(relativeMs: number): number {
  if (indexEntries.length === 0) return 0

  const firstTimestamp = indexEntries[0]?.timestamp ?? 0
  const targetAbsoluteMs = relativeMs + (firstTimestamp / 1000) // 转换为绝对时间戳（毫秒）

  // binary search for last index with timestamp <= targetAbsoluteMs
  let lo = 0
  let hi = indexEntries.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const tMid = timestampToMs(indexEntries[mid]?.timestamp || 0)
    if (tMid <= targetAbsoluteMs) lo = mid + 1
    else hi = mid - 1
  }
  return Math.max(0, Math.min(indexEntries.length - 1, hi))
}

// 兼容旧接口
function idxByTimeMs(ms: number): number {
  return idxByRelativeTimeMs(ms)
}

// 🔧 优化关键帧查找：优先使用isKeyframe字段
function keyframeBefore(index: number): number {
  const clampedIndex = Math.max(0, Math.min(index, indexEntries.length - 1))
  let i = clampedIndex
  for (; i >= 0; i--) {
    const ent = indexEntries[i]
    // 优先检查isKeyframe字段，回退到type字段
    if (ent?.isKeyframe === true || ent?.type === 'key') {
      return i
    }
  }

  // 🔧 修复：如果没有找到关键帧，打印警告并返回请求的索引
  // 而不是返回 0，这会导致窗口错误地回退到开头
  console.warn('⚠️ [OPFS-READER] keyframeBefore: no keyframe found before index', index, ', returning original index. This may cause decode issues.')
  console.warn('⚠️ [OPFS-READER] This usually means keyframe markers are not being written correctly during recording.')

  // 返回请求的索引，至少不会回退到帧 0
  // 但这可能导致解码问题（从 delta 帧开始解码）
  return clampedIndex
}

// 🔧 新增：查找下一个关键帧
function keyframeAfter(index: number): number {
  let i = Math.max(0, Math.min(index, indexEntries.length - 1))
  for (; i < indexEntries.length; i++) {
    const ent = indexEntries[i]
    if (ent?.isKeyframe === true || ent?.type === 'key') {
      return i
    }
  }
  return indexEntries.length - 1
}

self.onmessage = async (e: MessageEvent<InMsg | any>) => {
  const msg = e.data
  try {
    if (msg.type === 'open') {
      await ensureRoot()
      await openDir(msg.dirId)
      await readMeta()
      await readIndexAll()
      await openDataFileHandle()

      // 🔧 准备增强的关键帧信息
      const summaryData = summarize()
      const baseTimestamp = indexEntries[0]?.timestamp || 0

      // 关键帧的相对时间戳（毫秒）
      const keyframesMs = indexEntries
        .map((ent) => {
          if (ent.isKeyframe === true || ent.type === 'key') {
            return getRelativeTimestampMs(ent.timestamp || 0, baseTimestamp)
          }
          return -1
        })
        .filter((v) => v >= 0)

      // 关键帧索引信息
      const keyframeInfo = {
        indices: summaryData.keyframeIndices,
        timestamps: keyframesMs,
        count: summaryData.keyframeCount,
        avgInterval: summaryData.keyframeIndices.length > 1 ?
          (summaryData.keyframeIndices[summaryData.keyframeIndices.length - 1] - summaryData.keyframeIndices[0]) / (summaryData.keyframeIndices.length - 1) : 30
      }


      self.postMessage({
        type: 'ready',
        meta,
        summary: summaryData,
        keyframes: keyframesMs,
        keyframeInfo
      })
      return
    }

    if (msg.type === 'getNearestKeyframe') {
      const timeMs = Math.max(0, Math.floor(msg.timeMs || 0))
      const i = idxByTimeMs(timeMs)
      const k = keyframeBefore(i)
      const t = timestampToMs(indexEntries[k]?.timestamp || 0)
      self.postMessage({ type: 'nearestKeyframe', index: k, timeMs: t, ...getReaderReplyContext(msg) })
      return
    }

    if (msg.type === 'getRangeByTime' || msg.type === 'getWindowByTime') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) {
        throw new Error('NOT_OPEN')
      }

      const centerMs = Math.max(0, Math.floor((msg.centerMs ?? (((msg.startMs ?? 0) + (msg.endMs ?? 0)) / 2)) || 0))
      const beforeMs = Math.max(0, Math.floor(msg.beforeMs ?? 0))
      const afterMs = Math.max(0, Math.floor((msg.afterMs ?? (((msg.endMs ?? centerMs) - centerMs))) || 0))

      const baseTimestamp = indexEntries[0]?.timestamp ?? 0
      const maxFramesPerWindow = 140
      const plan = planReaderWindowByTime({
        sourceTimestampsMs: indexEntries.map((entry) => (entry.timestamp - baseTimestamp) / 1000),
        keyframeIndices: indexEntries.flatMap((entry, index) =>
          entry.isKeyframe === true || entry.type === 'key' ? [index] : []),
        centerMs,
        beforeMs,
        afterMs,
        maxFrames: maxFramesPerWindow
      })
      if (!plan.ok) {
        const error = new Error(plan.code)
        ;(error as any).code = plan.code
        throw error
      }
      const startIdx = plan.startIndex
      const endIdx = plan.endIndexExclusive

      const file = await getDataFile()
      const chunks: ChunkWire[] = []
      const transfer: ArrayBuffer[] = []

      // 🚀 P0 优化：批量读取，减少 I/O 次数
      const startOffset = indexEntries[startIdx].offset
      const endEntry = indexEntries[endIdx - 1]
      const endOffset = endEntry.offset + endEntry.size


      // 一次性读取整个窗口的数据
      const batchReadStart = performance.now()
      const totalSlice = file.slice(startOffset, endOffset)
      const totalBuf = await totalSlice.arrayBuffer()
      const batchReadTime = performance.now() - batchReadStart


      // 切分为单个 chunks
      for (let i = startIdx; i < endIdx; i++) {
        const ent = indexEntries[i]
        const relativeOffset = ent.offset - startOffset
        const buf = totalBuf.slice(relativeOffset, relativeOffset + ent.size)

        const wire: ChunkWire = {
          data: buf,
          timestamp: Number(ent.timestamp) || 0,
          type: (ent.type === 'key' ? 'key' : 'delta'),
          size: Number(ent.size) || buf.byteLength,
          codedWidth: ent.codedWidth,
          codedHeight: ent.codedHeight,
          codec: ent.codec
        }
        chunks.push(wire)
        transfer.push(buf)
      }

      // 🔧 修复：计算相对时间戳用于UI显示（修正运算符优先级）
      const startMs = ((indexEntries[startIdx]?.timestamp || 0) - baseTimestamp) / 1000
      const endMs = ((indexEntries[Math.max(startIdx, endIdx - 1)]?.timestamp || 0) - baseTimestamp) / 1000


      ;(self as any).postMessage({
        type: 'range',
        start: startIdx,
        count: endIdx - startIdx,
        targetIndex: plan.targetIndex,
        startMs,
        endMs,
        chunks,
        ...getReaderReplyContext(msg)
      }, transfer)
      return
    }

    if (msg.type === 'getRange') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) {
        throw new Error('NOT_OPEN')
      }

      const requestedStart = Math.max(0, Math.min(indexEntries.length - 1, Math.floor(msg.start)))
      const count = Math.max(0, Math.floor(msg.count))

      const maxFramesPerWindow = 140
      const plan = planReaderWindowByIndex({
        totalFrames: indexEntries.length,
        keyframeIndices: indexEntries.flatMap((entry, index) =>
          entry.isKeyframe === true || entry.type === 'key' ? [index] : []),
        targetIndex: requestedStart,
        requestedCount: count,
        maxFrames: maxFramesPerWindow
      })
      if (!plan.ok) {
        const error = new Error(plan.code)
        ;(error as any).code = plan.code
        throw error
      }
      const start = plan.startIndex
      const end = plan.endIndexExclusive



      const file = await getDataFile()
      const chunks: ChunkWire[] = []
      const transfer: ArrayBuffer[] = []

      // 🚀 P0 优化：批量读取，减少 I/O 次数
      const startOffset = indexEntries[start].offset
      const endEntry = indexEntries[end - 1]
      const endOffset = endEntry.offset + endEntry.size


      // 一次性读取整个窗口的数据
      const totalSlice = file.slice(startOffset, endOffset)
      const totalBuf = await totalSlice.arrayBuffer()


      // 切分为单个 chunks
      for (let i = start; i < end; i++) {
        const ent = indexEntries[i]
        const relativeOffset = ent.offset - startOffset
        const buf = totalBuf.slice(relativeOffset, relativeOffset + ent.size)

        const wire: ChunkWire = {
          data: buf,
          timestamp: Number(ent.timestamp) || 0,
          type: (ent.type === 'key' ? 'key' : 'delta'),
          size: Number(ent.size) || buf.byteLength,
          codedWidth: ent.codedWidth,
          codedHeight: ent.codedHeight,
          codec: ent.codec
        }
        chunks.push(wire)
        transfer.push(buf)
      }
      ;(self as any).postMessage({
        type: 'range',
        start,
        count: end - start,
        targetIndex: plan.targetIndex,
        chunks,
        ...getReaderReplyContext(msg)
      }, transfer)
      return
    }

    // 🆕 Single-frame preview optimization: only read minimal GOP required for target frame
    // (from nearest keyframe to target frame). Used for timeline hover preview, avoiding loading entire window.
    if (msg.type === 'getSingleFrameGOP') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) {
        throw new Error('NOT_OPEN')
      }

      const targetFrame = Math.max(0, Math.min(indexEntries.length - 1, Math.floor(msg.targetFrame)))
      const plan = planReaderWindowByIndex({
        totalFrames: indexEntries.length,
        keyframeIndices: indexEntries.flatMap((entry, index) =>
          entry.isKeyframe === true || entry.type === 'key' ? [index] : []),
        targetIndex: targetFrame,
        requestedCount: 1,
        maxFrames: 140
      })
      if (!plan.ok) {
        const error = new Error(plan.code)
        ;(error as any).code = plan.code
        throw error
      }

      // 只读取从关键帧到目标帧的 GOP（包含目标帧）
      const start = plan.startIndex
      const end = plan.endIndexExclusive
      const gopSize = end - start


      const file = await getDataFile()
      const chunks: ChunkWire[] = []
      const transfer: ArrayBuffer[] = []

      // 批量读取 GOP 数据
      const startOffset = indexEntries[start].offset
      const endEntry = indexEntries[end - 1]
      const endOffset = endEntry.offset + endEntry.size

      const batchReadStart = performance.now()
      const totalSlice = file.slice(startOffset, endOffset)
      const totalBuf = await totalSlice.arrayBuffer()
      const batchReadTime = performance.now() - batchReadStart


      // 切分为单个 chunks
      for (let i = start; i < end; i++) {
        const ent = indexEntries[i]
        const relativeOffset = ent.offset - startOffset
        const buf = totalBuf.slice(relativeOffset, relativeOffset + ent.size)

        const wire: ChunkWire = {
          data: buf,
          timestamp: Number(ent.timestamp) || 0,
          type: (ent.type === 'key' ? 'key' : 'delta'),
          size: Number(ent.size) || buf.byteLength,
          codedWidth: ent.codedWidth,
          codedHeight: ent.codedHeight,
          codec: ent.codec
        }
        chunks.push(wire)
        transfer.push(buf)
      }

      // 返回时标记目标帧在 chunks 中的索引
      const targetIndexInGOP = targetFrame - start

      ;(self as any).postMessage({
        type: 'singleFrameGOP',
        targetFrame,
        targetIndexInGOP,
        start,
        count: gopSize,
        chunks,
        ...getReaderReplyContext(msg)
      }, transfer)
      return
    }

    if (msg.type === 'close') {
      rootDir = null
      recDir = null
      meta = null
      indexEntries = []
      dataFileHandle = null
      openedDirId = null
      self.postMessage({ type: 'closed' })
      return
    }
  } catch (err: any) {
    const message = err?.message || String(err)
    self.postMessage({
      type: 'error',
      code: err?.code || 'READER_ERROR',
      message,
      ...getReaderReplyContext(msg)
    })
  }
}

export {} // make this a module
