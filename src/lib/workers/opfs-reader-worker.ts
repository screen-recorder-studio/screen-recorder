// OPFSReaderWorker: basic OPFS read access for Studio (Phase 1)
// Provides: open(dirId), getRange(start,count), close
// Notes:
// - Timestamps are stored in microseconds in index.jsonl
// - This basic version parses full index.jsonl into memory once
// - Data slices are read via Blob.slice; upgrade to SyncAccessHandle later

interface OpenMsg { type: 'open'; dirId: string }
interface GetRangeMsg { type: 'getRange'; start: number; count: number }
interface CloseMsg { type: 'close' }

type InMsg = OpenMsg | GetRangeMsg | CloseMsg

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
  return Math.floor(timestamp / 1000)
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
      totalBytes: 0
    }
  }

  const firstTimestamp = indexEntries[0]?.timestamp ?? 0
  const lastTimestamp = indexEntries.at(-1)?.timestamp ?? 0

  // 🔧 充分利用index.jsonl中的数据
  const keyframeIndices: number[] = []
  let totalBytes = 0
  const chunkSizes: number[] = []

  indexEntries.forEach((entry, index) => {
    // 收集关键帧索引
    if (entry.type === 'key' || entry.isKeyframe) {
      keyframeIndices.push(index)
    }
    // 统计数据大小
    totalBytes += entry.size || 0
    chunkSizes.push(entry.size || 0)
  })

  // 计算相对时长（最后一帧 - 第一帧）
  const durationMicroseconds = lastTimestamp - firstTimestamp
  const durationMs = Math.round(durationMicroseconds / 1000) // 微秒 → 毫秒
  const avgChunkSize = totalBytes / totalChunks

  const summary = {
    totalChunks,
    durationMs,
    fps: meta?.fps || 30,
    width: meta?.width || 0,
    height: meta?.height || 0,
    codec: meta?.codec || 'unknown',
    firstTimestamp,
    lastTimestamp,
    keyframeCount: keyframeIndices.length,
    keyframeIndices,
    avgChunkSize: Math.round(avgChunkSize),
    totalBytes
  }

  console.log('[progress] OPFS Reader - enhanced summary:', {
    ...summary,
    durationSeconds: durationMs / 1000,
    keyframeRatio: (keyframeIndices.length / totalChunks * 100).toFixed(1) + '%',
    avgKeyframeInterval: totalChunks / keyframeIndices.length
  })

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
  let i = Math.max(0, Math.min(index, indexEntries.length - 1))
  for (; i >= 0; i--) {
    const ent = indexEntries[i]
    // 优先检查isKeyframe字段，回退到type字段
    if (ent?.isKeyframe === true || ent?.type === 'key') {
      return i
    }
  }
  return 0
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

      console.log('[progress] OPFS Reader - sending enhanced ready message:', {
        meta,
        summary: summaryData,
        keyframeInfo
      })

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
      self.postMessage({ type: 'nearestKeyframe', index: k, timeMs: t })
      return
    }

    if (msg.type === 'getRangeByTime' || msg.type === 'getWindowByTime') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) {
        throw new Error('NOT_OPEN')
      }

      const centerMs = Math.max(0, Math.floor((msg.centerMs ?? (((msg.startMs ?? 0) + (msg.endMs ?? 0)) / 2)) || 0))
      const beforeMs = Math.max(0, Math.floor(msg.beforeMs ?? 0))
      const afterMs = Math.max(0, Math.floor((msg.afterMs ?? (((msg.endMs ?? centerMs) - centerMs))) || 0))

      // 使用相对时间进行查找
      const desiredStartMs = Math.max(0, centerMs - beforeMs)
      const desiredEndMs = centerMs + afterMs

      console.log('[progress] OPFS Reader - window request:', {
        centerMs, beforeMs, afterMs,
        desiredStartMs, desiredEndMs,
        totalEntries: indexEntries.length
      })

      let startIdx = keyframeBefore(idxByRelativeTimeMs(desiredStartMs))

      // find end index: first index whose relative timeMs > desiredEndMs
      let endIdx = startIdx
      const lastIdx = indexEntries.length - 1
      const baseTimestamp = indexEntries[0]?.timestamp ?? 0

      while (endIdx <= lastIdx) {
        const absoluteTimestamp = indexEntries[endIdx]?.timestamp || 0
        const relativeMs = (absoluteTimestamp - baseTimestamp) / 1000
        if (relativeMs > desiredEndMs) break
        endIdx++
      }
      if (endIdx <= startIdx) endIdx = Math.min(startIdx + 1, indexEntries.length)

      const file = await getDataFile()
      const chunks: ChunkWire[] = []
      const transfer: ArrayBuffer[] = []

      for (let i = startIdx; i < endIdx; i++) {
        const ent = indexEntries[i]
        const slice = file.slice(ent.offset, ent.offset + ent.size)
        const buf = await slice.arrayBuffer()
        const wire: ChunkWire = {
          data: buf,
          timestamp: Number(ent.timestamp) || 0,
          type: (ent.type === 'key' ? 'key' : 'delta'),
          size: Number(ent.size) || (buf.byteLength || 0),
          codedWidth: ent.codedWidth,
          codedHeight: ent.codedHeight,
          codec: ent.codec
        }
        chunks.push(wire)
        transfer.push(buf)
      }

      // 计算相对时间戳用于UI显示
      const startMs = (indexEntries[startIdx]?.timestamp || 0 - baseTimestamp) / 1000
      const endMs = (indexEntries[Math.max(startIdx, endIdx - 1)]?.timestamp || 0 - baseTimestamp) / 1000

      console.log('[progress] OPFS Reader - returning window:', {
        startIdx, endIdx, count: endIdx - startIdx,
        startMs, endMs,
        chunksReturned: chunks.length
      })

      ;(self as any).postMessage({
        type: 'range',
        start: startIdx,
        count: endIdx - startIdx,
        startMs,
        endMs,
        chunks
      }, transfer)
      return
    }

    if (msg.type === 'getRange') {
      if (!recDir || !dataFileHandle || indexEntries.length === 0) {
        throw new Error('NOT_OPEN')
      }

      const requestedStart = Math.max(0, Math.min(indexEntries.length, Math.floor(msg.start)))
      const count = Math.max(0, Math.floor(msg.count))

      // 🔧 智能关键帧对齐 - 基于index.jsonl的精确关键帧信息
      let start = requestedStart
      let end = Math.min(indexEntries.length, requestedStart + count)

      // 检查请求范围内是否有关键帧（优先使用isKeyframe字段）
      let hasKeyframeInRange = false
      let firstKeyframeInRange = -1

      for (let i = requestedStart; i < end; i++) {
        const ent = indexEntries[i]
        if (ent?.isKeyframe === true || ent?.type === 'key') {
          hasKeyframeInRange = true
          firstKeyframeInRange = i
          break
        }
      }

      if (hasKeyframeInRange) {
        // 从范围内的第一个关键帧开始
        start = firstKeyframeInRange
        console.log('[progress] OPFS Reader - using keyframe in range:', firstKeyframeInRange)
      } else {
        // 查找最近的前置关键帧
        const nearestKeyframe = keyframeBefore(requestedStart)
        const keyframeDistance = requestedStart - nearestKeyframe

        // 🔧 更智能的回退策略：基于关键帧间隔
        if (keyframeDistance <= 60) { // 最多回退60帧（2秒@30fps）
          start = nearestKeyframe
          end = Math.min(indexEntries.length, start + count + keyframeDistance)
          console.log('[progress] OPFS Reader - using previous keyframe:', nearestKeyframe, 'distance:', keyframeDistance)
        } else {
          // 距离太远，保持原始范围，让解码器处理
          console.log('[progress] OPFS Reader - keyframe too far, using original range')
        }
      }

      console.log('[progress] OPFS Reader - getRange request (smart keyframe alignment):', {
        requestedStart: msg.start,
        requestedCount: msg.count,
        finalStart: start,
        finalEnd: end,
        finalCount: end - start,
        hasKeyframeInRange,
        keyframeAdjustment: requestedStart - start,
        totalEntries: indexEntries.length
      })

      const file = await getDataFile()
      const chunks: ChunkWire[] = []
      const transfer: ArrayBuffer[] = []

      for (let i = start; i < end; i++) {
        const ent = indexEntries[i]
        // boundary guard
        const slice = file.slice(ent.offset, ent.offset + ent.size)
        const buf = await slice.arrayBuffer()
        const wire: ChunkWire = {
          data: buf,
          timestamp: Number(ent.timestamp) || 0,
          type: (ent.type === 'key' ? 'key' : 'delta'),
          size: Number(ent.size) || (buf.byteLength || 0),
          codedWidth: ent.codedWidth,
          codedHeight: ent.codedHeight,
          codec: ent.codec
        }
        chunks.push(wire)
        transfer.push(buf)
      }

      console.log('[progress] OPFS Reader - getRange returning:', {
        start,
        count: end - start,
        chunksReturned: chunks.length
      })

      ;(self as any).postMessage({ type: 'range', start, count: end - start, chunks }, transfer)
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
    self.postMessage({ type: 'error', code: 'READER_ERROR', message })
  }
}

export {} // make this a module

