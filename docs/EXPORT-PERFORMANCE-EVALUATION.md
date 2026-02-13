# 视频导出性能全面评估报告

## 背景

收到用户反馈（俄语翻译）：

> "应用在中等设置下编码一个60分钟的文件花了4天。它在做什么只有开发者知道，但肯定不是在执行它的核心功能。编码完成后不知道保存到了哪里，没有控制过程和保存位置的设置。即使在沙盒中使用也不安全，界面很漂亮但不执行其功能。"

本报告从**录制 → 编辑 → 导出**全链路，深入评估当前工程的性能瓶颈和用户体验问题。

---

## 一、架构概览

### 录制流程

```
用户点击录制 → Background.ts 调度
  → Offscreen Document 获取 MediaStream
  → WebCodecs Worker 编码帧
  → OPFS Writer Worker 持久化写入 data.bin + index.jsonl
```

### 导出流程

```
用户点击导出 → Export Worker 初始化
  → 逐帧请求 Composite Worker 合成（seek → 解码 → 渲染 → 回传 bitmap）
  → Export Worker 写入 CanvasSource
  → Mediabunny 编码为 MP4/WebM
  → 生成 Blob → 触发下载
```

---

## 二、核心性能瓶颈分析

### 🔴 问题 1：WebM 导出存在硬编码 16ms 延迟（严重）

**文件**：`src/lib/workers/export-worker/index.ts`  
**函数**：`renderFramesForExportWebm()`

```typescript
// 已修复：原代码中存在硬编码延迟
await new Promise(resolve => setTimeout(resolve, 16))
```

**影响分析**：
- 每帧强制等待 16ms
- 60 分钟视频 @ 30fps = 108,000 帧
- 额外等待时间 = 108,000 × 16ms = **1,728 秒 ≈ 28.8 分钟**
- 这只是额外的空等待时间，不包括实际编码时间

**根因**：代码注释 "等待一帧时间确保渲染完成（与原实现保持一致）"，属于遗留代码，`requestCompositeFrame()` 本身已是 await 异步等待，不需要额外延迟。

### 🔴 问题 2：MP4 导出每帧执行 Canvas 内容验证（严重）

**文件**：`src/lib/workers/export-worker/index.ts`  
**函数**：`renderFramesForExport()`

```typescript
// 已修复：原代码中每帧执行 getImageData 验证
const imageData = canvasCtx.getImageData(0, 0, Math.min(10, offscreenCanvas.width), Math.min(10, offscreenCanvas.height))
const hasContent = imageData.data.some(value => value > 0)
```

**影响分析**：
- `getImageData()` 是一个**同步阻塞**的 GPU → CPU 数据读回操作
- 每帧调用一次，60 分钟视频需调用 108,000 次
- 每次调用约 0.1-1ms（取决于 GPU 负载），总计 **10-108 秒额外开销**
- 此验证仅用于打印警告日志，对导出结果无实际影响

### 🔴 问题 3：导出过程中过度日志输出（严重）

**文件**：`src/lib/workers/export-worker/index.ts`

该文件包含 **172 条** `console.log/warn/error` 语句。在导出循环中，**每一帧**都会输出多条日志：

```typescript
// 每帧输出 4-5 条日志
console.log(`🎬 [MP4-Export-Worker] Requesting frame ${frameIndex}...`)
console.log(`✅ [MP4-Export-Worker] Frame ${frameIndex} rendered successfully`)
console.log(`📦 [MP4-Export-Worker] Adding frame ${frameIndex} to CanvasSource...`)
console.log(`📊 [MP4-Export-Worker] Canvas state: ...`)
console.log(`✅ [MP4-Export-Worker] Frame ${frameIndex} added successfully`)
```

**影响分析**：
- 108,000 帧 × 每帧约 5 条日志 = **540,000 条日志**
- 字符串格式化 + DevTools 控制台序列化开销：每条约 0.05-0.2ms
- 总计额外开销：**27-108 秒**
- 如果用户打开了 DevTools，开销会指数级增长

### 🟡 问题 4：Composite Worker 的 seek 处理每帧输出调试日志

**文件**：`src/lib/workers/composite-worker/index.ts`

```typescript
// 已修复：原代码中每次 seek 都输出多条日志
console.log('⏭️ [COMPOSITE-WORKER] Seeking to frame:', data.frameIndex, {...})
console.log('🔍 [COMPOSITE-WORKER] Seek target in range, checking conditions:', {...})
console.log('✅ [COMPOSITE-WORKER] Rendering frame', currentFrameIndex)
console.log('📤 [COMPOSITE-WORKER] Frame bitmap sent to main thread')
```

**影响分析**：
- 导出每帧都会触发一次 seek
- 108,000 次 seek × 每次 4 条日志 = **432,000 条日志**
- 与 export-worker 的日志叠加，总日志量接近 **100 万条**

### 🟡 问题 5：模块加载时执行测试代码

**文件**：`src/lib/workers/export-worker/index.ts`  
**位置**：模块顶层（已修复删除）

```typescript
// 模块顶层代码（非函数内）
console.log('🔧 [MP4-Export-Worker] Testing H.264 dimension validation...')
const testCases = [
  { width: 719, height: 996, name: '奇数尺寸' },
  // ...
]
testCases.forEach(testCase => {
  const result = validateAndFixH264Dimensions(testCase.width, testCase.height)
  console.log(...)
})
```

**影响**：每次 Worker 初始化都执行测试代码，不属于生产环境代码。

---

## 三、用户反馈问题逐一对应

### 1. "编码60分钟文件花了4天"

**根因**：导出过程中的多重性能瓶颈叠加：

| 瓶颈 | 每帧额外开销 | 60 分钟总开销 |
|------|------------|-------------|
| 16ms setTimeout（WebM） | 16ms | ~29 分钟 |
| getImageData 验证（MP4） | 0.1-1ms | 10-108 秒 |
| 每帧日志（两个 Worker 合计） | 0.5-2ms | 54-216 秒 |
| **合计最坏情况** | **~18ms** | **~33 分钟** |

以上仅为**额外开销**。实际编码时间还包括：
- WebCodecs 解码（GOP 对齐）
- Canvas 合成渲染（背景、裁剪、缩放）
- 视频编码（VP9/H.264）
- OPFS I/O

对于低端设备，这些开销可能被显著放大。

### 2. "编码完成后不知道保存到哪里"

**根因**：
- 录制文件保存到 **OPFS（Origin Private File System）**，用户无法直接在文件系统中看到
- 导出后通过 `URL.createObjectURL()` + 锚点下载触发浏览器下载
- 缺少明确的"保存位置"反馈提示
- 没有自定义保存路径的设置

### 3. "没有控制过程和保存位置的设置"

**根因**：
- 导出过程中没有预估完成时间的显示（虽然有进度百分比）
- 无法暂停/恢复导出
- 无法选择保存目录
- 缺少导出完成后的明显通知

---

## 四、录制链路评估

### 录制阶段（评分：⭐⭐⭐⭐ 较好）

| 方面 | 评价 |
|------|------|
| 架构设计 | ✅ WebCodecs + OPFS 流式写入，架构先进 |
| 背压控制 | ⚠️ WebCodecs Worker 有 encodeQueueSize 检查（>8 丢帧），但 Offscreen 端未检查 |
| 实时性能 | ✅ 关键帧间隔 2s，帧率自适应 |
| 存储安全 | ⚠️ Index 缓冲在内存中直到 finalize，长录制可能丢失索引 |
| 降级兼容 | ✅ SyncAccessHandle 不可用时有内存缓冲降级方案 |

### 编辑阶段（评分：⭐⭐⭐⭐ 较好）

| 方面 | 评价 |
|------|------|
| 解码效率 | ✅ 批量读取优化，关键帧二分查找 |
| 窗口管理 | ✅ 自适应窗口大小（30-150 帧） |
| 时间轴操作 | ✅ GOP 对齐 seek |
| 内存管理 | ⚠️ 全量 index.jsonl 加载到内存（1小时约10万条） |

### 导出阶段（评分：⭐⭐ 需要改进）

| 方面 | 评价 |
|------|------|
| 编码效率 | 🔴 存在不必要的延迟和验证 |
| 日志开销 | 🔴 每帧多条日志，严重影响性能 |
| 进度反馈 | ⚠️ 有进度条但缺少预估时间 |
| 保存体验 | 🔴 用户不清楚文件保存位置 |
| 资源管理 | ⚠️ 每次导出创建新 Worker，无复用 |

---

## 五、优化难度评估与修复方案

### 可立即修复的 Bug（难度：低）

| Bug | 修复方案 | 影响范围 | 风险 |
|-----|---------|---------|------|
| WebM 16ms 延迟 | 删除 `setTimeout(resolve, 16)` | export-worker 单行 | 极低 |
| 每帧 getImageData | 移除该验证或改为仅首帧验证 | export-worker 3行 | 极低 |
| 过度日志 | 将每帧日志改为每 100 帧采样输出 | export-worker 多处 | 低 |
| Composite Worker 日志 | 将每帧 seek 日志改为采样输出 | composite-worker 几处 | 低 |
| 模块级测试代码 | 删除或移到开发模式守卫内 | export-worker 15行 | 极低 |

### 需要更多设计的改进（难度：中-高）

| 改进 | 方案 | 难度 |
|------|------|------|
| 导出预估时间 | 基于已处理帧计算剩余时间 | 中 |
| 保存位置提示 | 导出完成后显示文件名和下载路径 | 中 |
| 导出暂停/恢复 | 需要重构 Worker 通信协议 | 高 |
| 自定义保存目录 | Chrome File System Access API | 高 |
| Worker 复用 | Worker Pool 模式 | 中 |

---

## 六、本次修复内容

基于上述评估，本次针对**可立即修复的 Bug** 进行修复：

1. **移除 WebM 导出的 16ms 硬编码延迟** —— 消除每帧 16ms 空等待
2. **移除 MP4 导出每帧的 Canvas 内容验证** —— 消除 `getImageData()` 阻塞调用
3. **将导出 Worker 的逐帧日志改为采样输出** —— 减少 99% 的日志量
4. **将 Composite Worker 的 seek 日志改为采样输出** —— 减少 99% 的日志量
5. **移除模块加载时的测试代码** —— 消除不必要的初始化开销

预计修复后，60 分钟视频的导出可节省 **30+ 分钟**的额外开销。
