# Studio 播放引擎全面评估报告

> 评估日期：2026-03-10  
> 评估范围：`packages/extension/src/routes/studio/+page.svelte` 及其播放链路全部组件  
> 问题现象：播放录制视频时偶发跳帧、进度条回跳后恢复

---

## 一、系统架构概述

Studio 播放系统采用多线程管道架构，核心链路如下：

```
+page.svelte (编排层)
    ├── OPFSReaderWorker (帧数据 I/O)
    ├── VideoPreviewComposite.svelte (播放控制 + UI)
    │       └── composite-worker/index.ts (解码 + 渲染 + 播放循环)
    └── 状态管理: trimStore / zoomStore / backgroundConfigStore
```

### 关键数据流

```
OPFS 磁盘 → OPFSReaderWorker (批量读取)
         → +page.svelte (中转/预取调度)
         → VideoPreviewComposite (编排)
         → composite-worker (WebCodecs 解码 → VideoFrame 缓冲 → 合成渲染 → ImageBitmap)
         → 主线程 Canvas 显示
```

### 涉及文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `+page.svelte` | ~951 | 编排层：Worker 生命周期、窗口请求调度、预取 |
| `VideoPreviewComposite.svelte` | ~2348 | 播放控制、UI 交互、窗口切换协调 |
| `composite-worker/index.ts` | ~1953 | WebCodecs 解码、帧缓冲、合成渲染、播放循环 |
| `opfs-reader-worker.ts` | ~542 | OPFS 数据读取、索引查找、GOP 管理 |

---

## 二、已识别问题清单

### 问题 P0：播放循环帧时间累积偏差（跳帧根因）

**位置**：`composite-worker/index.ts` 第 1303-1342 行

**现象**：播放过程中偶发跳帧，约每 5-10 秒出现一次。

**根因分析**：

```typescript
// 当前实现（有缺陷）
let lastFrameTime = 0;  // 行 1303：初始化为 0

function playFrame() {
  const now = performance.now();
  if (now - lastFrameTime >= frameInterval) {  // 行 1309
    // ... 渲染帧 ...
    currentFrameIndex++;
    lastFrameTime = now;  // 行 1342：使用当前时间更新
  }
  animationId = self.requestAnimationFrame(playFrame);  // 行 1428
}
```

**问题详解**：

1. **`lastFrameTime = now` 导致时间漂移**：每次渲染后，`lastFrameTime` 被设置为 `now`（实际渲染时刻），而非理想的帧时间点。如果某次渲染延迟 5ms（从 33.33ms 变为 38.33ms），这 5ms 误差被永久丢弃，而非累积到下一帧。长时间播放后，实际播放速度会略慢于预期。

2. **`lastFrameTime = 0` 初始值问题**：播放开始时 `lastFrameTime = 0`，而 `now` 可能是一个很大的值（如 15000ms），导致 `now - 0 >= frameInterval` 恒为真，第一帧立即渲染。这本身不是大问题，但在窗口切换后重新启动播放时，同样的初始化逻辑导致第一帧的时间基准不正确。

3. **合成渲染耗时波动**：`renderCompositeFrame()` 涉及 Canvas 2D 绘制（背景、阴影、圆角、缩放），在高分辨率或复杂配置下，单帧渲染耗时从 5ms 波动到 20ms+。当某帧渲染耗时超过 `frameInterval`（30fps = 33.33ms），下一次 rAF 回调时 `now - lastFrameTime` 可能超过 2 个 `frameInterval`，但仅渲染 1 帧，实质上跳过了 1 帧。

### 问题 P1：窗口切换时双重 rAF 延迟（进度条回跳根因）

**位置**：`VideoPreviewComposite.svelte` 第 377-382 行

**现象**：每 3-4 秒（窗口边界）进度条出现短暂回跳或停顿。

**根因分析**：

```typescript
// 当窗口准备好后继续播放的逻辑
if (shouldContinuePlayback) {
  // ...
  requestAnimationFrame(() => {          // 第一个 rAF：约 16ms 延迟
    seekToFrame(startFrame)              // 异步发送 'seek' 消息
    requestAnimationFrame(() => {        // 第二个 rAF：再约 16ms 延迟
      play()                             // 异步发送 'play' 消息
    })
  })
}
```

**问题详解**：

1. **双重 rAF 引入 32ms+ 延迟**：两个嵌套的 `requestAnimationFrame` 至少引入 2 个显示帧的延迟（约 32ms @ 60Hz 刷新率）。在此期间进度条停滞不动。

2. **消息顺序不保证**：`seekToFrame()` 向 Worker 发送 `'seek'` 消息，但第二个 rAF 中的 `play()` 不等 Worker 处理完 `'seek'` 就发送 `'play'`。在极端情况下，Worker 可能先处理 `'play'` 后处理 `'seek'`，导致从错误的帧位置开始播放，表现为进度条短暂回跳。

3. **`lastFrameWindowStartIndex` 更新时机**：`displayFrame()` 中通过 `lastFrameWindowStartIndex = windowStartIndex` 绑定帧与窗口。在窗口切换期间，`windowStartIndex`（props）已更新为新值，但在 32ms 延迟内显示的帧仍属于旧窗口。这段时间内 `currentTimeMs` 的计算会出现跳变。

### 问题 P2：时间戳精度损失

**位置**：`+page.svelte` 第 416-421 行 / `opfs-reader-worker.ts` 第 47 行

**影响**：累积时间漂移，长视频中帧定位偏移。

```typescript
// +page.svelte 第 416-421 行
windowStartMs = Math.floor((windowStartTimestamp - firstGlobalTimestamp) / 1000);
windowEndMs = Math.floor((windowEndTimestamp - firstGlobalTimestamp) / 1000);

// opfs-reader-worker.ts 第 47 行
function timestampToMs(timestamp: number): number {
  return Math.floor(timestamp / 1000)  // 微秒 → 毫秒，始终向下取整
}
```

**问题详解**：

`Math.floor()` 始终向下取整，最大误差为 0.999μs（≈1ms）。在多次窗口切换过程中，每次转换都引入最多 1ms 的负向偏移。对于 30fps 视频（帧间距 33.33ms），10 次窗口切换累积最多 10ms 误差，不会直接导致跳帧，但可能导致 `idxByRelativeTimeMs()` 二分查找定位到错误的帧索引。

### 问题 P3：窗口截断破坏 GOP 完整性

**位置**：`opfs-reader-worker.ts` 第 338-341 行 / 第 413-416 行

**影响**：窗口边界处可能出现解码异常。

```typescript
const maxFramesPerWindow = 140
if (endIdx - startIdx > maxFramesPerWindow) {
  endIdx = startIdx + maxFramesPerWindow  // 硬截断，不考虑 GOP 边界
}
```

当窗口大小超过 140 帧时，直接截断到 140 帧，不检查截断点是否落在 GOP 边界。如果截断发生在一个 GOP 中间，后续窗口从该 GOP 的关键帧重新解码时，会导致重复解码已截断的帧。

### 问题 P4：帧缓冲区溢出丢帧

**位置**：`composite-worker/index.ts` 第 1062-1082 行

**影响**：高分辨率视频播放时偶发帧丢失。

```typescript
if (targetBuf.length >= maxSize) {
  const oldest = targetBuf.shift();  // 丢弃最旧的帧
  oldest?.close();
  droppedFramesCount++;
}
```

当解码速度快于播放速度时，缓冲区会填满。此时丢弃最旧帧（`shift()`）而非停止解码，可能丢弃尚未播放的帧。这是一种"无背压"设计，在正常场景下影响不大，但在 4K 视频或复杂合成配置下可能导致可见的跳帧。

---

## 三、组件级评估

### 3.1 `+page.svelte`（编排层）

**评分：⚠️ 良好，存在小问题**

| 方面 | 评估 | 说明 |
|------|------|------|
| Worker 生命周期管理 | ✅ 良好 | `loadRecordingById` 正确清理旧 Worker 后创建新 Worker |
| 窗口请求调度 | ⚠️ 可改进 | `computeFrameWindow` 的 skip 逻辑可能误跳合法请求（P2 问题 #2） |
| 预取机制 | ⚠️ 可改进 | 4 秒超时可能过长（P3） |
| 状态重置 | ✅ 良好 | 切换录制时完整重置所有状态 |
| 错误处理 | ✅ 良好 | Worker 错误分类为 invalid-recording / load-failed |

### 3.2 `VideoPreviewComposite.svelte`（播放控制）

**评分：⚠️ 存在关键问题**

| 方面 | 评估 | 说明 |
|------|------|------|
| 连续播放 | 🔴 P1 问题 | 双重 rAF 导致窗口切换延迟（第 377-382 行） |
| 时间显示 | ✅ 良好 | `lastFrameWindowStartIndex` 避免 props 更新导致的抖动 |
| Seek 机制 | ⚠️ 可改进 | 无超时保护，Worker 无响应时会卡死 |
| Trim 集成 | ✅ 良好 | 帧级精度的裁剪边界检查 |
| 预览模式 | ✅ 良好 | 悬停预览的状态保存/恢复机制完善 |

### 3.3 `composite-worker/index.ts`（解码/渲染）

**评分：🔴 存在核心问题**

| 方面 | 评估 | 说明 |
|------|------|------|
| 播放循环 | 🔴 P0 问题 | `lastFrameTime = now` 导致帧时间累积偏差 |
| 帧缓冲管理 | ⚠️ 可改进 | 无背压机制，满时直接丢帧 |
| WebCodecs 解码 | ✅ 良好 | 流式解码 + 码型检测 |
| 合成渲染 | ✅ 良好 | 缓存布局计算，避免每帧重算 |
| 窗口切换 | ⚠️ 可改进 | `windowBoundaryFrames` 设置时机可能导致提前报告窗口完成 |

### 3.4 `opfs-reader-worker.ts`（数据 I/O）

**评分：✅ 良好**

| 方面 | 评估 | 说明 |
|------|------|------|
| 批量读取 | ✅ 优秀 | 单次 I/O 读取整个窗口数据 |
| 索引查找 | ✅ 良好 | 二分查找 + 关键帧回退 |
| 诊断能力 | ✅ 优秀 | 时间戳单调性检查、关键帧分布诊断 |
| 错误处理 | ⚠️ 可改进 | `keyframeBefore()` 找不到关键帧时返回原始索引（可能导致解码失败） |

---

## 四、问题严重度与影响矩阵

| 编号 | 问题 | 严重度 | 频率 | 用户感知 | 修复复杂度 |
|------|------|--------|------|----------|-----------|
| P0 | 播放循环帧时间累积偏差 | 🔴 高 | 每 5-10 秒 | 可见跳帧 | 低 |
| P1 | 窗口切换双重 rAF 延迟 | 🔴 高 | 每 3-4 秒 | 进度条回跳/停顿 | 低 |
| P2 | 时间戳精度损失 | 🟡 中 | 长视频累积 | 偶尔帧偏移 | 低 |
| P3 | GOP 完整性截断 | 🟡 中 | 窗口边界 | 偶尔解码异常 | 中 |
| P4 | 帧缓冲无背压丢帧 | 🟡 中 | 高分辨率 | 偶尔帧丢失 | 高 |

---

## 五、结论

Studio 播放系统整体架构设计合理，多线程管道、GOP 感知窗口管理、流式解码等关键决策正确。核心问题集中在**播放循环的时间管理**和**窗口切换的同步机制**两个点：

1. **P0（跳帧）**：播放循环使用 `lastFrameTime = now` 而非累积时间基准，导致帧间隔误差不可恢复。修复方案明确且风险低。

2. **P1（进度条回跳）**：窗口切换时使用嵌套 `requestAnimationFrame` 引入不必要延迟，且不保证消息处理顺序。修复方案是将双重 rAF 合并为单次，并确保消息顺序。

3. **P2-P4**：为次要问题，建议在 P0/P1 修复后观察是否仍有残余现象。
