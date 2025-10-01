# 视频编辑器 OPFS 读取快速参考

## 🎯 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| **Studio 页面** | `src/routes/studio/+page.svelte` | 主控制器，管理窗口切换 |
| **视频预览** | `src/lib/components/VideoPreviewComposite.svelte` | UI 和播放控制 |
| **OPFS Reader** | `src/lib/workers/opfs-reader-worker.ts` | 读取 OPFS 数据 |
| **Composite Worker** | `src/lib/workers/composite-worker/index.ts` | 解码和合成 |

---

## 📊 数据格式

### OPFS 文件结构

```
rec_xxx/
├── meta.json          # 元数据 (~500 bytes)
├── index.jsonl        # 索引 (10分钟 ≈ 2MB)
└── data.bin           # 编码数据 (10分钟 @ 8Mbps ≈ 600MB)
```

### meta.json

```json
{
  "id": "rec_xxx",
  "codec": "avc1.64002A",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "completed": true,
  "totalBytes": 5238459,
  "totalChunks": 300,
  "duration": 9966,        // ✅ 实际时长（微秒）
  "firstTimestamp": 0,
  "lastTimestamp": 9966
}
```

### index.jsonl (每行一个 JSON)

```jsonl
{"offset":0,"size":15234,"timestamp":0,"type":"key","codedWidth":1920,"codedHeight":1080,"codec":"avc1.64002A","isKeyframe":true}
{"offset":15234,"size":3421,"timestamp":33000,"type":"delta","codedWidth":1920,"codedHeight":1080,"codec":"avc1.64002A"}
```

---

## 🔄 关键流程

### 1. 初始化流程

```
用户打开 /studio.html?id=rec_xxx
    ↓
Studio 创建 OPFS Reader Worker
    ↓
发送 { type: 'open', dirId: 'rec_xxx' }
    ↓
OPFS Reader:
  - 读取 meta.json
  - 读取 index.jsonl (⚠️ 完整加载)
  - 打开 data.bin
    ↓
发送 { type: 'ready', summary, meta, keyframeInfo }
    ↓
Studio 请求初始帧: { type: 'getRange', start: 0, count: 90 }
```

### 2. 窗口切换流程

```
播放到窗口末尾
    ↓
Composite Worker 发送 { type: 'windowComplete' }
    ↓
VideoPreviewComposite 计算下一窗口
    ↓
调用 onRequestWindow({ centerMs, beforeMs, afterMs })
    ↓
Studio 计算帧范围（关键帧对齐）
    ↓
发送 { type: 'getRange', start, count }
    ↓
OPFS Reader 读取数据（⚠️ 90次 I/O）
    ↓
发送 { type: 'range', chunks } (transferable)
    ↓
VideoPreviewComposite 发送给 Composite Worker
    ↓
Composite Worker 流式解码
```

---

## ⚠️ 性能瓶颈

### 🔴 高风险

1. **index.jsonl 完整加载**
   - 位置：`opfs-reader-worker.ts:74`
   - 问题：1小时录制 ≈ 10MB 全部加载到内存
   - 影响：初始加载慢 (50-200ms)

2. **逐个 chunk 读取**
   - 位置：`opfs-reader-worker.ts:312`
   - 问题：90帧 = 90次 I/O
   - 影响：窗口切换延迟 (100-300ms)

3. **帧缓冲无上限**
   - 位置：`composite-worker/index.ts:628`
   - 问题：decodedFrames + nextDecoded 无限累积
   - 影响：峰值内存 1.4GB

---

## 🛠️ 优化方案

### P0: 批量读取优化

**目标**：减少 I/O 次数，提升 30-50% 性能

```typescript
// 一次读取整个窗口
const startOffset = indexEntries[start].offset
const endOffset = indexEntries[end - 1].offset + indexEntries[end - 1].size
const totalSlice = file.slice(startOffset, endOffset)
const totalBuf = await totalSlice.arrayBuffer()

// 然后切分
for (let i = start; i < end; i++) {
  const ent = indexEntries[i]
  const relativeOffset = ent.offset - startOffset
  const buf = totalBuf.slice(relativeOffset, relativeOffset + ent.size)
  // ...
}
```

**效果**：
- 窗口切换：300ms → 150ms
- I/O 次数：90次 → 1次

---

### P1: 帧缓冲限制

**目标**：防止内存泄漏

```typescript
const MAX_DECODED_FRAMES = 150

output: (frame: VideoFrame) => {
  if (decodedFrames.length >= MAX_DECODED_FRAMES) {
    const oldest = decodedFrames.shift()
    oldest?.close()
  }
  decodedFrames.push(frame)
}
```

**效果**：
- 峰值内存：1.4GB → 1.0GB

---

## 🔍 诊断工具

### 1. OPFS 完整性检查

```typescript
async function diagnoseOPFSIntegrity() {
  // 1. 检查 meta.json
  const meta = await readMeta()
  console.log('[DIAGNOSIS] Meta:', {
    totalChunks: meta.totalChunks,
    duration: meta.duration,
    estimatedDuration: (meta.totalChunks / meta.fps) * 1000
  })
  
  // 2. 检查 index.jsonl
  const index = await readIndexAll()
  console.log('[DIAGNOSIS] Index:', {
    entries: index.length,
    lastEntry: index[index.length - 1]
  })
  
  // 3. 检查数据完整性
  const lastEntry = index[index.length - 1]
  const expectedSize = lastEntry.offset + lastEntry.size
  const actualSize = await getDataFileSize()
  console.log('[DIAGNOSIS] Data file:', {
    expectedSize,
    actualSize,
    match: expectedSize === actualSize
  })
}
```

### 2. 播放位置追踪

```typescript
let playbackLog: Array<{
  time: number
  globalFrame: number
  windowStart: number
  frameIndex: number
}> = []

$effect(() => {
  const globalFrame = lastFrameWindowStartIndex + currentFrameIndex
  playbackLog.push({
    time: Date.now(),
    globalFrame,
    windowStart: lastFrameWindowStartIndex,
    frameIndex: currentFrameIndex
  })
})
```

---

## 📈 性能指标

### 初始加载

| 操作 | 时间 | 数据量 |
|------|------|--------|
| 打开 OPFS | ~10ms | - |
| 读取 meta.json | ~5ms | ~500 bytes |
| 读取 index.jsonl | ~50-200ms | 10分钟 ≈ 2MB |
| 打开 data.bin | ~5ms | - |
| **总计** | **~70-220ms** | **~2MB** |

### 窗口切换

| 操作 | 时间 | 数据量 |
|------|------|--------|
| 计算帧范围 | ~1ms | - |
| 读取 90 chunks | ~100-300ms | 5-10MB |
| 数据传输 | ~10ms | 5-10MB |
| 解码 90 帧 | ~200-500ms | 后台 |
| **总计（用户感知）** | **~110-310ms** | **5-10MB** |

### 内存占用

| 组件 | 内存 | 说明 |
|------|------|------|
| index.jsonl | ~2MB | 10分钟录制 |
| decodedFrames | ~700MB | 90帧 |
| nextDecoded | ~700MB | 预取 |
| prefetchCache | ~10MB | 编码数据 |
| **总计** | **~1.4GB** | **峰值** |

---

## 🎯 进度条问题诊断

### 可能原因

1. **时间戳不匹配**
   ```
   实际时长：9966ms (meta.duration)
   估算时长：10000ms (totalFrames / fps * 1000)
   差异：34ms (约1帧)
   ```

2. **窗口边界问题**
   ```
   最后窗口: 270-299 (30帧)
   实际可播放: 270-298 (29帧)
   ```

3. **关键帧对齐导致帧丢失**
   ```
   请求: 210-299 (90帧)
   关键帧: 240
   实际返回: 240-299 (60帧)
   ```

### 验证方法

```typescript
// 在 Studio 页面添加
console.log('[progress] Timeline max vs actual:', {
  timelineMaxMs,
  actualDurationMs: durationMs,
  totalFrames: totalFramesAll,
  fps: frameRate,
  estimatedDuration: (totalFramesAll / frameRate) * 1000,
  difference: timelineMaxMs - durationMs
})

// 在 handleWindowComplete 添加
console.log('[progress] Window complete check:', {
  windowStartIndex,
  totalFrames: data.totalFrames,
  lastFrameIndex: data.lastFrameIndex,
  currentGlobalFrame: windowStartIndex + data.lastFrameIndex,
  totalFramesAll,
  isLastWindow: (windowStartIndex + data.totalFrames) >= totalFramesAll
})
```

---

## 📚 相关文档

- `docs/STUDIO-OPFS-READING-EVALUATION.md` - 完整评估报告
- `docs/FRAME-LOSS-AND-OPFS-EVALUATION.md` - 录制端评估
- `docs/OPTIMIZATION-IMPLEMENTATION-SUMMARY.md` - 录制端优化

---

**更新时间**：2025-09-30
**版本**：v1.0

