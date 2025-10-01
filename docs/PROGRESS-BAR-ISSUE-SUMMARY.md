# 进度条问题快速总结

## 🎯 问题描述

**用户报告**：编辑阶段进度条经常不能拉到头

**具体表现**：
- 进度条只能拖到 95-99%
- 拖到末尾时视频卡住
- 显示时长与实际可播放时长不符

---

## 🔍 根本原因（按概率排序）

### 1. OPFS Finalize 竞态条件（70%概率）

**问题**：最后几个 chunks 在 finalize 前未到达

**时序**：
```
T0: Encoder Worker 发送 chunk 298
T1: Encoder Worker 发送 chunk 299
T2: Encoder Worker 发送 chunk 300 (最后一个)
T3: Encoder Worker 发送 'end' message
T4: Content Script 转发 chunk 298
T5: Content Script 转发 chunk 299
T6: Content Script 转发 'end' message
T7: Iframe Sink 收到 'end'，检查 pendingChunks.length = 0
T8: Iframe Sink 立即 finalize ❌
T9: Content Script 转发 chunk 300 (太晚，已 finalize)
```

**结果**：
- OPFS 只写入 299 个 chunks
- 缺少最后 33ms（1帧 @ 30fps）
- 进度条只能拖到 99.67%

**代码位置**：
- `src/extensions/opfs-writer.ts:225`
- `src/extensions/offscreen-main.ts:329`

---

### 2. Encoder Flush 不完整（20%概率）

**问题**：flush() 失败但错误被忽略

**代码**：
```typescript
// src/extensions/encoder-worker.ts:50
async function flushAndClose() {
  try { await encoder?.flush?.() } catch {}  // ❌ 错误被吞没
  try { encoder?.close?.() } catch {}
}
```

**可能原因**：
- 硬件编码器超时
- 某些帧编码失败
- 编码队列未清空

**结果**：
- 最后几帧未编码
- 视频时长缩短
- 进度条不能拖到头

---

### 3. 时间戳元数据不匹配（10%概率）

**问题**：meta.json 中的 duration 是估算值

**当前实现**：
```typescript
// 录制开始时记录
recordingStartTime = Date.now()

// 录制结束时计算
const duration = Date.now() - recordingStartTime  // ❌ 估算值
```

**实际情况**：
- 估算 duration: 10000ms
- 实际最后 chunk timestamp: 9933ms
- 差异：67ms

**结果**：
- 播放器认为视频是 10000ms
- 但实际数据只到 9933ms
- 进度条拖到 9933ms 后无数据

---

## 🔧 推荐修复方案

### 方案A：保守修复（推荐立即实施）

**优点**：
- ✅ 改动最小
- ✅ 风险最低
- ✅ 可快速部署

**缺点**：
- ⚠️ 增加 200ms 停止延迟

**修改点**：

#### 1. 延迟 OPFS Finalize

```typescript
// src/extensions/opfs-writer.ts:225
case 'end':
case 'end-request':
  console.log(`[OPFS] End received, pending: ${pendingChunks.length}`)
  
  // ✅ 延迟 200ms 确保所有 chunks 到达
  setTimeout(() => {
    if (!writerReady || pendingChunks.length > 0) {
      endPending = true
    } else {
      void finalizeOpfsWriter()
    }
  }, 200)
  break
```

```typescript
// src/extensions/offscreen-main.ts:329
case 'complete':
  // ✅ 延迟 100ms 确保所有 chunks 到达
  setTimeout(() => {
    if (OPFS_WRITER_ENABLED) {
      if (!opfsWriterReady || opfsPendingChunks.length > 0) {
        opfsEndPending = true
      } else {
        void finalizeOpfsWriter()
      }
    }
  }, 100)
  break
```

#### 2. 使用实际时长

```typescript
// src/lib/workers/opfs-writer-worker.ts
let lastTimestamp = 0

case 'append':
  lastTimestamp = msg.timestamp ?? 0
  // ... 其他代码
  break

case 'finalize':
  await writeMeta({
    ...initialMeta,
    completed: true,
    totalBytes: dataOffset,
    totalChunks: chunksWritten,
    duration: lastTimestamp,  // ✅ 使用最后 chunk 的时间戳
    lastTimestamp
  })
  break
```

#### 3. 改进 Flush 日志

```typescript
// src/extensions/encoder-worker.ts:49
async function flushAndClose() {
  try {
    if (encoder) {
      const queueBefore = encoder.encodeQueueSize
      console.log(`[Encoder] Flushing (queue: ${queueBefore})`)
      await encoder.flush()
      const queueAfter = encoder.encodeQueueSize
      console.log(`[Encoder] Flushed (queue: ${queueAfter})`)
      
      if (queueAfter > 0) {
        console.warn(`⚠️ [Encoder] Queue not empty after flush: ${queueAfter}`)
      }
    }
  } catch (e) {
    console.error(`[Encoder] Flush error:`, e)
  }
  try { encoder?.close?.() } catch {}
  encoder = null
}
```

**预期效果**：
- ✅ 解决 OPFS finalize 竞态
- ✅ 进度条可以拖到头
- ✅ 时长准确
- ⚠️ 增加 200ms 停止延迟（可接受）

**工作量**：1-2 小时

---

### 方案B：彻底修复（长期优化）

**优点**：
- ✅ 从根本上解决问题
- ✅ 无额外延迟
- ✅ 更可靠

**缺点**：
- ⚠️ 改动较大
- ⚠️ 需要更多测试

**修改点**：

#### 1. 添加"最后 chunk"标记

```typescript
// src/extensions/encoder-worker.ts
let lastChunkTimestamp = 0

// 在 output 回调中
output: (chunk) => {
  lastChunkTimestamp = chunk.timestamp
  // ... 发送 chunk
}

case 'stop':
  await flushAndClose()
  
  // ✅ 发送特殊的"最后 chunk"标记
  postMessage({ 
    type: 'chunk',
    ts: lastChunkTimestamp,
    kind: 'end-marker',
    data: new ArrayBuffer(0),
    size: 0,
    isLast: true
  })
  
  postMessage({ type: 'end', chunks: stats.chunks, bytes: stats.bytes })
  break
```

```typescript
// src/extensions/opfs-writer.ts
let receivedEndMarker = false

case 'chunk':
  if (d.isLast) {
    receivedEndMarker = true
    console.log(`[OPFS] Received end marker`)
  } else {
    appendToOpfsChunk(...)
  }
  break

case 'end':
  if (receivedEndMarker) {
    // ✅ 已收到最后 chunk，可以安全 finalize
    void finalizeOpfsWriter()
  } else {
    // ⚠️ 还没收到最后 chunk，等待
    endPending = true
  }
  break
```

#### 2. 添加 WebCodecs Worker 背压控制

```typescript
// src/lib/workers/webcodecs-worker.ts
const BACKPRESSURE_MAX = 8

async function encodeFrame(frame: VideoFrame, forceKey: boolean = false) {
  if (!encoder) {
    frame.close()
    return
  }
  
  // ✅ 背压控制
  if (encoder.encodeQueueSize != null && encoder.encodeQueueSize > BACKPRESSURE_MAX) {
    console.warn(`⚠️ [WORKER] Backpressure: dropping frame (queue: ${encoder.encodeQueueSize})`)
    frame.close()
    return
  }
  
  encoder.encode(frame, { keyFrame: forceKey === true })
  frame.close()
}
```

**工作量**：3-5 小时

---

## 📊 诊断工具

### 添加完整性检查

```typescript
// src/extensions/encoder-worker.ts
let sentChunks = 0

case 'stop':
  await flushAndClose()
  postMessage({ 
    type: 'end', 
    chunks: stats.chunks,
    totalSent: sentChunks,  // ✅ 发送总数
    lastTimestamp: lastChunkTimestamp
  })
  break
```

```typescript
// src/extensions/opfs-writer.ts
case 'end':
  console.log(`[OPFS] End received:`, {
    expectedChunks: d.chunks,
    writtenChunks: chunksWritten,
    pendingChunks: pendingChunks.length
  })
  
  // ✅ 验证完整性
  if (d.chunks && chunksWritten < d.chunks) {
    console.error(`❌ Missing chunks: expected ${d.chunks}, written ${chunksWritten}`)
  }
  break
```

### 验证 OPFS 文件

```typescript
async function verifyOpfsRecording(recordingId: string) {
  const rootDir = await navigator.storage.getDirectory()
  const recDir = await rootDir.getDirectoryHandle(`rec_${recordingId}`)
  
  const metaHandle = await recDir.getFileHandle('meta.json')
  const metaFile = await metaHandle.getFile()
  const meta = JSON.parse(await metaFile.text())
  
  const indexHandle = await recDir.getFileHandle('index.jsonl')
  const indexFile = await indexHandle.getFile()
  const indexText = await indexFile.text()
  const lines = indexText.trim().split('\n')
  
  const dataHandle = await recDir.getFileHandle('data.bin')
  const dataFile = await dataHandle.getFile()
  
  console.log(`[Verify] Recording ${recordingId}:`, {
    metaChunks: meta.totalChunks,
    indexLines: lines.length,
    dataBytes: dataFile.size,
    metaBytes: meta.totalBytes,
    match: lines.length === meta.totalChunks && dataFile.size === meta.totalBytes
  })
  
  const lastLine = JSON.parse(lines[lines.length - 1])
  console.log(`[Verify] Last chunk:`, {
    timestamp: lastLine.timestamp,
    expectedEnd: lastLine.offset + lastLine.size,
    actualEnd: dataFile.size,
    match: lastLine.offset + lastLine.size === dataFile.size
  })
}
```

---

## 🎯 实施建议

### 第一步：诊断（今天）

1. 添加完整性检查日志
2. 复现进度条问题
3. 收集日志确认根本原因

### 第二步：快速修复（明天）

1. 实施方案A（延迟 finalize + 实际时长）
2. 测试验证
3. 部署

### 第三步：长期优化（下周）

1. 实施方案B（end-marker + 背压控制）
2. 全面测试
3. 性能对比
4. 逐步迁移

---

## 📋 相关文档

- [FRAME-LOSS-AND-OPFS-EVALUATION.md](./FRAME-LOSS-AND-OPFS-EVALUATION.md) - 完整的端到端评估
- [OPFS-RECORDING-EVALUATION.md](./OPFS-RECORDING-EVALUATION.md) - OPFS 录制评估
- [VIDEO-ENCODING-ANALYSIS.md](./VIDEO-ENCODING-ANALYSIS.md) - 视频编码分析

---

## ✅ 检查清单

- [ ] 添加完整性检查日志
- [ ] 复现进度条问题
- [ ] 确认根本原因
- [ ] 实施方案A（延迟 finalize）
- [ ] 实施方案A（实际时长）
- [ ] 实施方案A（改进日志）
- [ ] 测试验证
- [ ] 部署到生产
- [ ] 监控效果
- [ ] 规划方案B实施

