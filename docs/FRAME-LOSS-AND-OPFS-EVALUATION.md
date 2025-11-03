# 录制和OPFS存储端到端评估 - 丢帧风险与进度条问题分析

## 📋 评估目标

**重点关注**：
1. 丢帧风险点识别
2. 可能导致进度条不能拉到头的问题
3. 录制和写入端的完整性保证

---

## 🔄 两条录制链路对比

### 链路1：Tab/Window/Screen (Offscreen)

```
MediaStreamTrackProcessor
    ↓ VideoFrame
Offscreen Main (frame loop)
    ↓ postMessage (transferable)
WebCodecs Worker
    ↓ VideoEncoder.encode()
    ↓ EncodedVideoChunk
    ↓ handleEncodedChunk
    ↓ postMessage (chunk)
Offscreen Main
    ↓ appendToOpfsChunk
    ↓ postMessage (transferable)
OPFS Writer Worker
    ↓ dataSyncHandle.write()
OPFS文件系统
```

### 链路2：Area/Element (Content Script)

```
MediaStreamTrackProcessor
    ↓ VideoFrame
Content Script (frame loop)
    ↓ postMessage (transferable)
Encoder Worker
    ↓ VideoEncoder.encode()
    ↓ EncodedVideoChunk
    ↓ postMessage (chunk)
Content Script
    ↓ postMessage to iframe sink
Iframe Sink (opfs-writer.ts)
    ↓ appendToOpfsChunk
    ↓ postMessage (transferable)
OPFS Writer Worker
    ↓ dataSyncHandle.write()
OPFS文件系统
```

---

## ⚠️ 丢帧风险点分析

### 🔴 高风险点

#### 1. **Encoder Worker 背压丢帧**（两条链路共有）

**位置**：`src/extensions/encoder-worker.ts:94`

```typescript
// Backpressure: drop if queue too long
if (encoder.encodeQueueSize != null && encoder.encodeQueueSize > BACKPRESSURE_MAX) {
  try { frame?.close?.(); } catch {}  // ❌ 直接丢弃帧
  break;
}
```

**风险等级**：🔴 **高**

**触发条件**：
- 编码队列 > 8 帧
- 编码速度 < 帧率（硬件编码器繁忙、软件编码慢）
- 高分辨率 + 高帧率（4K@60fps）

**影响**：
- ✅ **不会导致进度条问题**（丢帧不记录timestamp）
- ❌ **视频会跳帧**（画面不连续）
- ❌ **时长可能缩短**（丢失的帧不计入）

**检测方法**：
```typescript
// 添加丢帧计数
let droppedFrames = 0
if (encoder.encodeQueueSize > BACKPRESSURE_MAX) {
  droppedFrames++
  console.warn(`⚠️ Frame dropped due to backpressure (${droppedFrames} total)`)
}
```

---

#### 2. **WebCodecs Worker 无背压控制**（链路1特有）

**位置**：`src/lib/workers/webcodecs-worker.ts:102`

```typescript
async function encodeFrame(frame: VideoFrame, forceKey: boolean = false) {
  // ❌ 没有背压检查
  encoder.encode(frame, { keyFrame: forceKey === true })
  frame.close()
}
```

**风险等级**：🔴 **高**

**对比**：
- Encoder Worker (链路2)：✅ 有背压控制（BACKPRESSURE_MAX = 8）
- WebCodecs Worker (链路1)：❌ 无背压控制

**触发条件**：
- 帧率过高（60fps+）
- 编码器处理慢
- 队列无限增长

**影响**：
- ❌ **内存持续增长**
- ❌ **编码延迟累积**
- ⚠️ **可能导致OOM崩溃**

**修复建议**：
```typescript
async function encodeFrame(frame: VideoFrame, forceKey: boolean = false) {
  // ✅ 添加背压控制
  const BACKPRESSURE_MAX = 8
  if (encoder.encodeQueueSize != null && encoder.encodeQueueSize > BACKPRESSURE_MAX) {
    console.warn(`⚠️ [WORKER] Backpressure: dropping frame (queue: ${encoder.encodeQueueSize})`)
    frame.close()
    return
  }
  
  encoder.encode(frame, { keyFrame: forceKey === true })
  frame.close()
}
```

---

### 🟡 中风险点

#### 3. **Pause期间丢帧**（两条链路共有）

**位置**：
- Offscreen: `src/extensions/offscreen-main.ts:407`
- Content: `src/extensions/content.ts:991`

```typescript
// Offscreen
if (isPaused) { 
  try { frame.close() } catch {}  // ❌ 暂停时丢弃帧
  continue 
}

// Content
if (state.paused) { 
  try { frame?.close?.() } catch {}  // ❌ 暂停时丢弃帧
  await new Promise((r) => setTimeout(r, 60))
  continue
}
```

**风险等级**：🟡 **中**（设计行为，但可能导致问题）

**影响**：
- ✅ **符合预期**（暂停时不应录制）
- ⚠️ **时间戳可能不连续**
- ⚠️ **可能影响播放器时长计算**

---

#### 4. **OPFS Writer Pending Chunks 累积**（两条链路共有）

**位置**：
- Offscreen: `src/extensions/offscreen-main.ts:79`
- Iframe Sink: `src/extensions/opfs-writer.ts:91`

```typescript
// Offscreen
function appendToOpfsChunk(d) {
  if (!opfsWriter || !opfsWriterReady) { 
    opfsPendingChunks.push(d)  // ⚠️ 累积在内存
    return 
  }
  // ...
}

// Iframe Sink
function appendToOpfsChunk(d) {
  if (!writer || !writerReady) { 
    pendingChunks.push(d)  // ⚠️ 累积在内存
    return
  }
  // ...
}
```

**风险等级**：🟡 **中**

**触发条件**：
- OPFS Writer 初始化慢
- 录制开始时大量帧快速到达
- Writer 未就绪前累积chunks

**影响**：
- ⚠️ **内存峰值**（初始几秒）
- ✅ **最终会flush**（writerReady后）
- ⚠️ **极端情况可能OOM**

**观察**：
```typescript
// 添加监控
if (opfsPendingChunks.length > 100) {
  console.warn(`⚠️ OPFS pending chunks: ${opfsPendingChunks.length}`)
}
```

---

### 🟢 低风险点

#### 5. **Frame Loop 异常中断**

**位置**：
- Offscreen: `src/extensions/offscreen-main.ts:402-416`
- Content: `src/extensions/content.ts:986-1001`

```typescript
// Offscreen
;(async () => {
  try {
    while (wcFrameLoopActive) {
      const { value: frame, done } = await reader.read()
      if (done || !frame) break  // ✅ 正常结束
      // ...
    }
  } catch (err) {
    log('❌ Frame loop error:', err)  // ✅ 有错误处理
  }
})()

// Content
(async () => {
  try {
    for (;;) {
      const { done, value: frame } = await state.reader.read()
      if (done) break  // ✅ 正常结束
      // ...
    }
    state.worker?.postMessage({ type: 'stop' })  // ✅ 通知worker停止
  } catch (err) {
    console.error('frame pump error', err)  // ✅ 有错误处理
  }
})()
```

**风险等级**：🟢 **低**

**保护措施**：
- ✅ try-catch 包裹
- ✅ done 检查
- ✅ 发送 stop 消息

---

## 🎯 进度条不能拉到头的问题分析

### 🔴 关键问题1：Encoder Flush 后仍有帧在队列

**位置**：
- WebCodecs Worker: `src/lib/workers/webcodecs-worker.ts:187`
- Encoder Worker: `src/extensions/encoder-worker.ts:50`

```typescript
// WebCodecs Worker
async function stopEncoding() {
  if (encoder) {
    await encoder.flush()  // ⚠️ flush等待所有帧编码完成
    encoder.close()
    encoder = null
  }
  // 合并所有数据块
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  // ...
}

// Encoder Worker
async function flushAndClose() {
  try { await encoder?.flush?.() } catch {}  // ⚠️ flush可能失败
  try { encoder?.close?.() } catch {}
  encoder = null
}
```

**问题分析**：

1. **flush() 的异步性**
   ```typescript
   // flush() 返回 Promise，等待所有pending帧编码完成
   await encoder.flush()
   
   // 但如果：
   // - 编码器内部错误
   // - 某些帧无法编码
   // - 超时
   // 则可能有帧丢失
   ```

2. **Encoder Worker 的 flush 错误被吞没**
   ```typescript
   try { await encoder?.flush?.() } catch {}  // ❌ 错误被忽略
   ```

**影响**：
- ⚠️ **最后几帧可能丢失**
- ⚠️ **视频时长比预期短**
- ⚠️ **进度条不能拉到头**（实际时长 < 元数据时长）

**修复建议**：
```typescript
// Encoder Worker
async function flushAndClose() {
  try {
    if (encoder) {
      console.log('[Encoder] Flushing... queue size:', encoder.encodeQueueSize)
      await encoder.flush()
      console.log('[Encoder] Flush complete')
    }
  } catch (e) {
    console.error('[Encoder] Flush failed:', e)  // ✅ 记录错误
    // ⚠️ 但仍然继续，因为无法恢复
  }
  try { encoder?.close?.() } catch {}
  encoder = null
}
```

---

### 🔴 关键问题2：OPFS Finalize 时机不确定

**位置**：
- Offscreen: `src/extensions/offscreen-main.ts:329`
- Iframe Sink: `src/extensions/opfs-writer.ts:225`

```typescript
// Offscreen
case 'complete':
  // ...
  if (OPFS_WRITER_ENABLED) {
    if (!opfsWriterReady || opfsPendingChunks.length > 0) {
      opfsEndPending = true  // ⚠️ 延迟finalize
    } else {
      void finalizeOpfsWriter()  // ⚠️ 立即finalize
    }
  }
  break

// Iframe Sink
case 'end':
case 'end-request':
  if (!writerReady || pendingChunks.length > 0) {
    endPending = true  // ⚠️ 延迟finalize
  } else {
    void finalizeOpfsWriter()  // ⚠️ 立即finalize
  }
  break
```

**问题分析**：

1. **竞态条件**
   ```
   时间线：
   T0: Worker发送最后一个chunk
   T1: Worker发送'complete'/'end'
   T2: Offscreen收到'complete'
   T3: Offscreen收到最后一个chunk (❌ 晚于T2)
   
   结果：
   - T2时 opfsPendingChunks.length = 0 (最后chunk还没到)
   - 立即finalize
   - T3的chunk丢失 ❌
   ```

2. **endPending 机制不可靠**
   ```typescript
   // flushOpfsPendingIfReady
   function flushOpfsPendingIfReady() {
     if (!opfsWriter || !opfsWriterReady) return
     while (opfsPendingChunks.length) { 
       const c = opfsPendingChunks.shift()!
       appendToOpfsChunk(c) 
     }
     if (opfsEndPending) { 
       opfsEndPending = false
       void finalizeOpfsWriter()  // ⚠️ 这里finalize
     }
   }
   ```
   
   **问题**：
   - 依赖 `opfsWriterReady` 事件触发
   - 如果 ready 事件在 complete 之前，endPending 永远不会被处理
   - 如果 ready 事件丢失，finalize 永远不会执行

**影响**：
- 🔴 **最后几个chunks可能丢失**
- 🔴 **视频不完整**
- 🔴 **进度条不能拉到头**

**修复建议**：
```typescript
// 方案1：添加延迟确保所有chunks到达
case 'complete':
  if (OPFS_WRITER_ENABLED) {
    // ✅ 等待100ms确保所有chunks到达
    setTimeout(() => {
      if (!opfsWriterReady || opfsPendingChunks.length > 0) {
        opfsEndPending = true
      } else {
        void finalizeOpfsWriter()
      }
    }, 100)
  }
  break

// 方案2：Worker发送明确的"最后一个chunk"标记
// Worker端
self.postMessage({
  type: 'chunk',
  data: { ...chunkData, isLast: true }  // ✅ 标记最后一个
})

// Offscreen端
case 'chunk':
  appendToOpfsChunk(...)
  if (data.isLast) {
    // ✅ 收到最后chunk后才finalize
    setTimeout(() => void finalizeOpfsWriter(), 50)
  }
  break
```

---

### 🟡 关键问题3：WebCodecs Worker Chunks 累积

**位置**：`src/lib/workers/webcodecs-worker.ts:144`

```typescript
function handleEncodedChunk(chunk: EncodedVideoChunk, metadata?: any) {
  const data = new Uint8Array(chunk.byteLength)
  chunk.copyTo(data)
  
  chunks.push(data)  // ⚠️ 累积所有chunks
  
  self.postMessage({
    type: 'chunk',
    data: { data: data, ... }
  })
}
```

**问题分析**：

1. **双重存储**
   ```typescript
   chunks.push(data)  // ❌ Worker内存中保留
   self.postMessage({ data })  // ✅ 发送给主线程
   
   // 结果：
   // - Worker内存：累积所有chunks
   // - 主线程：也处理所有chunks
   // - OPFS：也写入所有chunks
   // 
   // 三份数据！内存浪费
   ```

2. **stopEncoding 时合并**
   ```typescript
   async function stopEncoding() {
     // 合并所有数据块
     const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
     const finalData = new Uint8Array(totalSize)
     
     let offset = 0
     for (const chunk of chunks) {
       finalData.set(chunk, offset)  // ⚠️ 大量内存拷贝
       offset += chunk.length
     }
     
     self.postMessage({ type: 'complete', data: finalData }, [finalData.buffer])
   }
   ```

**影响**：
- ⚠️ **内存持续增长**（10分钟 @ 8Mbps = 600MB × 3 = 1.8GB）
- ⚠️ **stopEncoding 时大量内存分配**
- ⚠️ **可能OOM崩溃**
- ✅ **不影响进度条**（数据完整）

**修复建议**：
```typescript
// ❌ 当前：累积chunks
let chunks: Uint8Array[] = []

function handleEncodedChunk(chunk: EncodedVideoChunk) {
  const data = new Uint8Array(chunk.byteLength)
  chunk.copyTo(data)
  chunks.push(data)  // ❌ 累积
  self.postMessage({ type: 'chunk', data: { data } })
}

// ✅ 改进：流式输出，不累积
function handleEncodedChunk(chunk: EncodedVideoChunk) {
  const data = new Uint8Array(chunk.byteLength)
  chunk.copyTo(data)
  // ✅ 直接发送，不保留
  self.postMessage({ type: 'chunk', data: { data } })
}

async function stopEncoding() {
  if (encoder) {
    await encoder.flush()
    encoder.close()
    encoder = null
  }
  
  // ✅ 不需要合并，直接通知完成
  self.postMessage({ type: 'complete' })
}
```

---

### 🟡 关键问题4：时间戳不连续

**位置**：多处

**问题场景**：

1. **暂停/恢复**
   ```typescript
   // 暂停时丢帧
   if (isPaused) { frame.close(); continue }
   
   // 时间戳：
   // T0: 0ms
   // T1: 33ms
   // T2: 66ms (暂停开始)
   // ... (暂停5秒)
   // T3: 5066ms (恢复) ❌ 时间戳跳跃
   ```

2. **背压丢帧**
   ```typescript
   // 丢帧时时间戳不连续
   frameIndex: 0, 1, 2, 3, [4丢失], 5, 6
   timestamp: 0, 33, 66, 99, [132丢失], 165, 198
   ```

**影响**：
- ⚠️ **播放器可能计算错误的时长**
- ⚠️ **进度条可能不准确**
- ⚠️ **seek可能跳过某些时间段**

---

## 📊 完整性保证机制评估

### ✅ 现有保护机制

#### 1. **Frame Loop 错误处理**
```typescript
try {
  while (wcFrameLoopActive) {
    // ...
  }
} catch (err) {
  log('❌ Frame loop error:', err)
}
```

#### 2. **Encoder Flush**
```typescript
await encoder.flush()  // 等待所有pending帧
```

#### 3. **OPFS Pending Chunks**
```typescript
if (!opfsWriterReady) {
  opfsPendingChunks.push(d)  // 缓冲直到ready
}
```

#### 4. **End Pending 机制**
```typescript
if (!opfsWriterReady || opfsPendingChunks.length > 0) {
  opfsEndPending = true  // 延迟finalize
}
```

### ❌ 缺失的保护机制

#### 1. **WebCodecs Worker 无背压控制**
- Encoder Worker 有：`BACKPRESSURE_MAX = 8`
- WebCodecs Worker 无：❌

#### 2. **Flush 错误处理不足**
```typescript
try { await encoder?.flush?.() } catch {}  // ❌ 错误被忽略
```

#### 3. **Finalize 竞态条件**
- 最后chunk可能晚于complete消息到达
- 没有明确的"最后chunk"标记

#### 4. **时间戳连续性无保证**
- 暂停/丢帧导致时间戳跳跃
- 没有时间戳修正机制

---

## 🎯 进度条问题的根本原因

### 最可能的原因（按概率排序）

#### 1. **OPFS Finalize 竞态条件**（概率：70%）

**症状**：
- 视频可以播放
- 但播放到某个时间点就卡住
- 进度条不能拉到最后

**原因**：
- 最后几个chunks在finalize前未到达
- OPFS文件不完整
- 播放器读到文件末尾但数据不完整

**验证方法**：
```typescript
// 在OPFS Writer Worker中添加日志
case 'finalize':
  console.log(`[OPFS] Finalizing: ${chunksWritten} chunks, ${dataOffset} bytes`)
  // 对比录制时的chunk数量
  break
```

#### 2. **Encoder Flush 丢失最后几帧**（概率：20%）

**症状**：
- 视频时长比预期短
- 最后几秒内容缺失

**原因**：
- flush() 失败但错误被忽略
- 编码队列中的帧未完成编码

**验证方法**：
```typescript
async function flushAndClose() {
  console.log('[Encoder] Queue size before flush:', encoder.encodeQueueSize)
  await encoder.flush()
  console.log('[Encoder] Queue size after flush:', encoder.encodeQueueSize)
}
```

#### 3. **时间戳不连续导致播放器混乱**（概率：10%）

**症状**：
- 播放器显示的时长不准确
- seek行为异常

**原因**：
- 暂停/丢帧导致时间戳跳跃
- 播放器无法正确解析

---

## 🔧 修复优先级

### P0 - 立即修复

#### 1. **添加 WebCodecs Worker 背压控制**
```typescript
// src/lib/workers/webcodecs-worker.ts
const BACKPRESSURE_MAX = 8

async function encodeFrame(frame: VideoFrame, forceKey: boolean = false) {
  if (encoder.encodeQueueSize != null && encoder.encodeQueueSize > BACKPRESSURE_MAX) {
    console.warn(`⚠️ [WORKER] Dropping frame (queue: ${encoder.encodeQueueSize})`)
    frame.close()
    return
  }
  encoder.encode(frame, { keyFrame: forceKey === true })
  frame.close()
}
```

#### 2. **修复 OPFS Finalize 竞态**
```typescript
// src/extensions/offscreen-main.ts
case 'complete':
  // ✅ 延迟100ms确保所有chunks到达
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

### P1 - 重要优化

#### 3. **改进 Flush 错误处理**
```typescript
// src/extensions/encoder-worker.ts
async function flushAndClose() {
  try {
    if (encoder) {
      const queueBefore = encoder.encodeQueueSize
      console.log(`[Encoder] Flushing (queue: ${queueBefore})`)
      await encoder.flush()
      console.log(`[Encoder] Flush complete`)
    }
  } catch (e) {
    console.error('[Encoder] Flush failed:', e)
    postError('Flush failed: ' + (e?.message || String(e)))
  }
  try { encoder?.close?.() } catch {}
  encoder = null
}
```

#### 4. **移除 WebCodecs Worker Chunks 累积**
```typescript
// src/lib/workers/webcodecs-worker.ts
// ❌ 删除
let chunks: Uint8Array[] = []

function handleEncodedChunk(chunk: EncodedVideoChunk) {
  const data = new Uint8Array(chunk.byteLength)
  chunk.copyTo(data)
  // ❌ chunks.push(data)  // 删除累积
  self.postMessage({ type: 'chunk', data: { data, ... } })
}

async function stopEncoding() {
  if (encoder) {
    await encoder.flush()
    encoder.close()
    encoder = null
  }
  // ❌ 删除合并逻辑
  self.postMessage({ type: 'complete' })
}
```

### P2 - 监控和诊断

#### 5. **添加丢帧统计**
```typescript
let droppedFrames = 0
let totalFrames = 0

if (encoder.encodeQueueSize > BACKPRESSURE_MAX) {
  droppedFrames++
  console.warn(`⚠️ Frame dropped (${droppedFrames}/${totalFrames})`)
}
```

#### 6. **添加 OPFS 完整性检查**
```typescript
// 录制结束时对比
console.log(`[Recording] Sent ${totalChunks} chunks`)
console.log(`[OPFS] Wrote ${chunksWritten} chunks`)
if (totalChunks !== chunksWritten) {
  console.error(`❌ Chunk mismatch: ${totalChunks} sent, ${chunksWritten} written`)
}
```

---

## 📋 测试建议

### 测试场景

1. **长时间录制**（30分钟+）
   - 验证内存不泄漏
   - 验证所有chunks写入OPFS

2. **高帧率录制**（60fps）
   - 验证背压控制生效
   - 统计丢帧率

3. **暂停/恢复**
   - 验证时间戳连续性
   - 验证播放器正常

4. **快速停止**
   - 录制5秒后立即停止
   - 验证最后几帧不丢失

5. **并发录制**
   - 同时录制多个窗口
   - 验证OPFS写入不冲突

---

## 🎯 总结

### 丢帧风险点（按严重程度）

| 风险点 | 严重程度 | 影响 | 修复优先级 |
|--------|---------|------|-----------|
| WebCodecs Worker 无背压 | 🔴 高 | 内存泄漏、OOM | P0 |
| OPFS Finalize 竞态 | 🔴 高 | 数据丢失、进度条问题 | P0 |
| Encoder Flush 错误忽略 | 🟡 中 | 最后几帧丢失 | P1 |
| Chunks 累积 | 🟡 中 | 内存浪费 | P1 |
| 背压丢帧 | 🟡 中 | 视频跳帧 | P2 |
| 暂停丢帧 | 🟢 低 | 设计行为 | - |

### 进度条问题最可能原因

1. **OPFS Finalize 竞态**（70%）- 最后chunks丢失
2. **Encoder Flush 失败**（20%）- 最后几帧未编码
3. **时间戳不连续**（10%）- 播放器解析错误

### 立即行动项

1. ✅ 添加 WebCodecs Worker 背压控制
2. ✅ 修复 OPFS Finalize 竞态（延迟100ms）
3. ✅ 改进 Flush 错误处理和日志
4. ✅ 移除 WebCodecs Worker chunks 累积
5. ✅ 添加完整性检查和统计

---

## 🔬 深度分析：进度条问题的技术细节

### 问题表现

**用户报告**：
> "编辑阶段进度条经常不能拉到头"

**可能的具体表现**：
1. 进度条只能拖到 95%，最后 5% 无法到达
2. 拖到末尾时视频卡住不动
3. 显示的总时长与实际可播放时长不符
4. seek 到末尾时跳回某个较早的位置

### 根本原因分析

#### 场景1：OPFS 文件不完整（最可能）

**完整的数据流**：
```
Encoder Worker
  ↓ chunk 1 (t=0ms, key)
  ↓ chunk 2 (t=33ms, delta)
  ↓ chunk 3 (t=66ms, delta)
  ↓ ...
  ↓ chunk N-2 (t=9900ms, delta)
  ↓ chunk N-1 (t=9933ms, delta)
  ↓ chunk N (t=9966ms, delta)  ← 最后一个chunk
  ↓ 'end' message

Content Script
  ↓ 收到 chunk 1-N
  ↓ 转发到 iframe sink
  ↓ 收到 'end'
  ↓ 发送 'end' 到 sink

Iframe Sink
  ↓ 收到 chunk 1, 2, 3, ...
  ↓ 收到 'end' message  ← ⚠️ 可能早于 chunk N
  ↓ 检查 pendingChunks.length
  ↓ 如果为 0 → 立即 finalize  ← ❌ chunk N 还在路上
  ↓ OPFS 只写入了 chunk 1 到 N-1
```

**结果**：
- OPFS 文件缺少最后一个 chunk
- 视频时长：9933ms（实际）vs 10000ms（预期）
- 进度条：只能拖到 99.33%

**验证方法**：
```typescript
// 在 encoder-worker.ts 中
let lastChunkTimestamp = 0
let totalChunksSent = 0

case 'frame':
  // ...
  encoder.encode(frame, ...)
  totalChunksSent++
  break

case 'stop':
  await flushAndClose()
  console.log(`[Encoder] Sent ${totalChunksSent} chunks, last ts: ${lastChunkTimestamp}`)
  postMessage({ type: 'end', chunks: stats.chunks, lastTimestamp: lastChunkTimestamp })
  break

// 在 opfs-writer.ts 中
case 'end':
  console.log(`[OPFS] Received end, pending: ${pendingChunks.length}, written: ${chunksWritten}`)
  // 对比 stats.chunks 和 chunksWritten
  break
```

#### 场景2：Encoder Flush 不完整

**Encoder 内部状态**：
```
VideoEncoder
  ├─ Input Queue (待编码)
  │   ├─ frame 298
  │   ├─ frame 299
  │   └─ frame 300  ← 最后一帧
  │
  ├─ Encoding (编码中)
  │   ├─ frame 295
  │   └─ frame 296
  │
  └─ Output Queue (已编码)
      ├─ chunk 293
      └─ chunk 294

调用 flush():
  1. 等待 Input Queue 清空
  2. 等待 Encoding 完成
  3. 等待 Output Queue 输出

可能的问题：
  - 硬件编码器超时
  - 某帧编码失败（静默失败）
  - flush() Promise reject 但被 catch 忽略
```

**结果**：
- frame 297-300 未编码
- 视频缺少最后 4 帧（133ms @ 30fps）
- 进度条：只能拖到 98.67%

**验证方法**：
```typescript
async function flushAndClose() {
  if (!encoder) return

  const queueBefore = encoder.encodeQueueSize
  console.log(`[Encoder] Before flush: queue=${queueBefore}, state=${encoder.state}`)

  try {
    await encoder.flush()
    console.log(`[Encoder] After flush: queue=${encoder.encodeQueueSize}, state=${encoder.state}`)
  } catch (e) {
    console.error(`[Encoder] Flush failed:`, e)
    console.error(`[Encoder] Queue at failure: ${encoder.encodeQueueSize}`)
    // ⚠️ 这里应该报告错误，而不是静默忽略
  }

  encoder.close()
}
```

#### 场景3：时间戳元数据不匹配

**OPFS index.jsonl 示例**：
```jsonl
{"offset":0,"size":15234,"timestamp":0,"type":"key"}
{"offset":15234,"size":3421,"timestamp":33,"type":"delta"}
{"offset":18655,"size":3156,"timestamp":66,"type":"delta"}
...
{"offset":5234567,"size":3892,"timestamp":9933,"type":"delta"}
```

**meta.json 示例**：
```json
{
  "codec": "avc1.64002A",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "completed": true,
  "totalBytes": 5238459,
  "totalChunks": 300,
  "duration": 10000  ← ⚠️ 预期时长
}
```

**问题**：
- meta.json 中的 duration 是估算值（录制开始时间 - 结束时间）
- 实际最后一个 chunk 的 timestamp 是 9933ms
- 播放器读取 meta.json 认为视频是 10000ms
- 但实际数据只到 9933ms
- 进度条拖到 9933ms 后无数据

**修复方法**：
```typescript
// 在 finalize 时计算真实时长
case 'finalize':
  // 读取 index.jsonl 最后一行
  const lastLine = pendingIndexLines[pendingIndexLines.length - 1]
  const lastChunk = JSON.parse(lastLine)
  const actualDuration = lastChunk.timestamp

  await writeMeta({
    ...initialMeta,
    completed: true,
    totalBytes: dataOffset,
    totalChunks: chunksWritten,
    duration: actualDuration,  // ✅ 使用实际时长
    lastTimestamp: lastChunk.timestamp
  })
  break
```

---

## 🔍 诊断工具和方法

### 1. 添加完整性检查

```typescript
// src/extensions/encoder-worker.ts
let sentChunks = 0
let lastChunkTs = 0

// 在 output 回调中
output: (chunk) => {
  sentChunks++
  lastChunkTs = chunk.timestamp
  // ...
}

// 在 stop 时
case 'stop':
  await flushAndClose()
  postMessage({
    type: 'end',
    chunks: stats.chunks,
    bytes: stats.bytes,
    lastTimestamp: lastChunkTs,  // ✅ 发送最后时间戳
    totalSent: sentChunks
  })
  break
```

```typescript
// src/extensions/opfs-writer.ts
case 'end':
  const endMsg = d
  console.log(`[OPFS] End received:`, {
    expectedChunks: endMsg.chunks,
    writtenChunks: chunksWritten,
    pendingChunks: pendingChunks.length,
    lastExpectedTs: endMsg.lastTimestamp
  })

  // ✅ 验证完整性
  if (endMsg.chunks && chunksWritten < endMsg.chunks) {
    console.error(`❌ Missing chunks: expected ${endMsg.chunks}, written ${chunksWritten}`)
  }
  break
```

### 2. 添加时间戳追踪

```typescript
// src/lib/workers/opfs-writer-worker.ts
let firstTimestamp = -1
let lastTimestamp = -1
let chunkTimestamps: number[] = []

case 'append':
  const ts = msg.timestamp ?? 0
  if (firstTimestamp === -1) firstTimestamp = ts
  lastTimestamp = ts
  chunkTimestamps.push(ts)
  // ...
  break

case 'finalize':
  // 检查时间戳连续性
  let gaps = 0
  for (let i = 1; i < chunkTimestamps.length; i++) {
    const gap = chunkTimestamps[i] - chunkTimestamps[i-1]
    if (gap > 100) {  // 超过100ms认为是gap
      gaps++
      console.warn(`⚠️ Timestamp gap: ${chunkTimestamps[i-1]}ms -> ${chunkTimestamps[i]}ms (${gap}ms)`)
    }
  }

  console.log(`[OPFS] Finalize:`, {
    chunks: chunksWritten,
    firstTs: firstTimestamp,
    lastTs: lastTimestamp,
    duration: lastTimestamp - firstTimestamp,
    gaps: gaps
  })

  await writeMeta({
    ...initialMeta,
    completed: true,
    totalBytes: dataOffset,
    totalChunks: chunksWritten,
    firstTimestamp,
    lastTimestamp,
    duration: lastTimestamp - firstTimestamp,  // ✅ 实际时长
    timestampGaps: gaps
  })
  break
```

### 3. 添加 OPFS 读取验证

```typescript
// 录制完成后验证 OPFS 文件
async function verifyOpfsRecording(recordingId: string) {
  const rootDir = await navigator.storage.getDirectory()
  const recDir = await rootDir.getDirectoryHandle(`rec_${recordingId}`)

  // 读取 meta.json
  const metaHandle = await recDir.getFileHandle('meta.json')
  const metaFile = await metaHandle.getFile()
  const meta = JSON.parse(await metaFile.text())

  // 读取 index.jsonl
  const indexHandle = await recDir.getFileHandle('index.jsonl')
  const indexFile = await indexHandle.getFile()
  const indexText = await indexFile.text()
  const lines = indexText.trim().split('\n')

  // 读取 data.bin
  const dataHandle = await recDir.getFileHandle('data.bin')
  const dataFile = await dataHandle.getFile()

  console.log(`[Verify] Recording ${recordingId}:`, {
    metaChunks: meta.totalChunks,
    indexLines: lines.length,
    dataBytes: dataFile.size,
    metaBytes: meta.totalBytes,
    match: lines.length === meta.totalChunks && dataFile.size === meta.totalBytes
  })

  // 验证最后一个 chunk
  const lastLine = JSON.parse(lines[lines.length - 1])
  console.log(`[Verify] Last chunk:`, {
    offset: lastLine.offset,
    size: lastLine.size,
    timestamp: lastLine.timestamp,
    type: lastLine.type,
    expectedEnd: lastLine.offset + lastLine.size,
    actualEnd: dataFile.size,
    match: lastLine.offset + lastLine.size === dataFile.size
  })

  return {
    valid: lines.length === meta.totalChunks && dataFile.size === meta.totalBytes,
    meta,
    lastChunk: lastLine
  }
}
```

---

## 🎯 推荐的修复方案

### 方案A：保守修复（推荐）

**目标**：最小改动，解决进度条问题

**修改点**：

1. **延迟 OPFS Finalize**
```typescript
// src/extensions/opfs-writer.ts
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

2. **改进 Flush 日志**
```typescript
// src/extensions/encoder-worker.ts
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

3. **使用实际时长**
```typescript
// src/lib/workers/opfs-writer-worker.ts
let lastTimestamp = 0

case 'append':
  lastTimestamp = msg.timestamp ?? 0
  // ...
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

**预期效果**：
- ✅ 解决 OPFS finalize 竞态
- ✅ 进度条可以拖到头
- ✅ 时长准确
- ⚠️ 增加 200ms 停止延迟（可接受）

### 方案B：彻底修复（长期）

**目标**：从根本上解决问题

**修改点**：

1. **添加"最后 chunk"标记**
```typescript
// src/extensions/encoder-worker.ts
case 'stop':
  await flushAndClose()

  // ✅ 发送一个特殊的"最后 chunk"标记
  postMessage({
    type: 'chunk',
    ts: lastChunkTs,
    kind: 'end-marker',  // ✅ 特殊标记
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

2. **添加 WebCodecs Worker 背压**
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

3. **移除 chunks 累积**
```typescript
// src/lib/workers/webcodecs-worker.ts
// ❌ 删除
// let chunks: Uint8Array[] = []

function handleEncodedChunk(chunk: EncodedVideoChunk, metadata?: any) {
  const data = new Uint8Array(chunk.byteLength)
  chunk.copyTo(data)

  // ❌ chunks.push(data)  // 删除

  self.postMessage({
    type: 'chunk',
    data: { data, ... }
  })
}

async function stopEncoding() {
  if (encoder) {
    await encoder.flush()
    encoder.close()
    encoder = null
  }

  // ❌ 删除合并逻辑
  self.postMessage({ type: 'complete' })
}
```

**预期效果**：
- ✅ 彻底解决竞态问题
- ✅ 减少内存占用
- ✅ 提高稳定性
- ⚠️ 需要更多测试

---

## 📝 建议的实施步骤

### 第一阶段：诊断（1-2天）

1. 添加完整性检查日志
2. 添加时间戳追踪
3. 复现进度条问题
4. 收集日志分析根本原因

### 第二阶段：快速修复（1天）

1. 实施方案A（保守修复）
2. 测试验证
3. 部署到生产

### 第三阶段：彻底优化（3-5天）

1. 实施方案B（彻底修复）
2. 全面测试
3. 性能对比
4. 逐步迁移

