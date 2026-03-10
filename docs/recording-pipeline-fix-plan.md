# 录制管线技术修复方案

## 概述

基于[端到端评估报告](./recording-pipeline-e2e-evaluation.md)，本方案针对两个核心问题制定修复计划：
1. **控制窗口多开** — 点击 Action 重复打开窗口
2. **录制鼠标迟滞** — 录制过程影响电脑操作流畅度

---

## 修复项一：控制窗口单例保障 ✅ 低风险

### 问题

`openOrFocusControlWindow()` 无并发锁，快速多次调用时竞态创建多个窗口。

### 方案

在 `background.ts` 中添加 `Promise` 互斥锁，确保同一时间只有一次窗口创建操作进行中。

```typescript
// 添加互斥锁
let controlWindowPromise: Promise<void> | null = null;

async function openOrFocusControlWindow(): Promise<void> {
  // 如果有正在进行的创建/聚焦操作，等待它完成
  if (controlWindowPromise) {
    await controlWindowPromise;
    return;
  }
  controlWindowPromise = _openOrFocusControlWindowImpl();
  try {
    await controlWindowPromise;
  } finally {
    controlWindowPromise = null;
  }
}
```

### 风险评估

| 维度 | 评估 |
|------|------|
| 功能影响 | 仅影响窗口创建入口，不影响录制逻辑 |
| 兼容性 | 纯 JS 逻辑，无 API 变更 |
| 回滚难度 | 极低，移除锁即恢复 |
| **总体风险** | **🟢 低** |

---

## 修复项二：录制完成时清理所有控制窗口 ✅ 低风险

### 问题

`OPFS_RECORDING_READY` 处理中仅关闭 `controlWinId` 记录的最后一个窗口，如果曾创建多个窗口则会遗留。

### 方案

在录制完成时，遍历所有窗口，关闭所有 `control.html` 的 popup 窗口。

```typescript
async function closeAllControlWindows(): Promise<void> {
  const controlUrl = chrome.runtime.getURL('control.html');
  try {
    const allWindows = await chrome.windows.getAll({ populate: true });
    for (const win of allWindows) {
      if (win.type === 'popup' && win.id !== null && win.id !== undefined
          && win.tabs?.some(tab => tab.url?.startsWith(controlUrl))) {
        try { await chrome.windows.remove(win.id); } catch {}
      }
    }
  } catch {}
  controlWinId = null;
}
```

### 风险评估

| 维度 | 评估 |
|------|------|
| 功能影响 | 仅影响录制完成后的清理逻辑 |
| 边界情况 | 确保不误关其他窗口（通过 URL 匹配） |
| **总体风险** | **🟢 低** |

---

## 修复项三：帧采集节流 ✅ 低风险

### 问题

`content.ts` 中帧读取循环无节流，以最高速率拉取帧并发送到编码 Worker，导致主线程繁忙。

### 方案

在帧读取循环中添加基于 `requestAnimationFrame` 的节流，将帧采集频率与显示刷新对齐，减少无意义的高频帧推送。同时在帧发送前检查 Worker 编码队列的反馈（利用 Worker 的丢帧计数），适当 yield 让出主线程时间片。

```typescript
// 使用 setTimeout(0) 微节流，让出主线程事件循环
for (;;) {
  const { done, value: frame } = await state.reader.read();
  if (done) break;
  if (state.paused) { try { frame?.close?.() } catch {} await new Promise(r => setTimeout(r, 60)); continue; }
  const keyFrame = frameIndex === 0 || (frameIndex % (framerate * 2) === 0);
  state.worker?.postMessage({ type: 'frame', frame, keyFrame, i: frameIndex }, [frame]);
  frameIndex++;
  // 每 N 帧 yield 一次，防止长时间占用主线程
  if (frameIndex % 2 === 0) {
    await new Promise(r => setTimeout(r, 0));
  }
}
```

### 风险评估

| 维度 | 评估 |
|------|------|
| 功能影响 | 帧采集频率微降，不影响录制质量（实际帧率由编码器控制） |
| 性能改善 | 主线程定期 yield，改善鼠标/键盘事件响应 |
| 边界情况 | `setTimeout(0)` 最小延迟约 4ms，不会显著影响帧率 |
| **总体风险** | **🟢 低** |

---

## 修复项四：提高编码器背压阈值 ✅ 低风险

### 问题

`BACKPRESSURE_MAX = 8` 在高分辨率场景下很容易触达，导致频繁丢帧。

### 方案

将背压阈值从 8 提升到 15，给编码器更多缓冲空间。

### 风险评估

| 维度 | 评估 |
|------|------|
| 功能影响 | 减少丢帧频率，提高录制质量 |
| 内存影响 | 额外 7 帧缓冲，约增加 2-5MB，可接受 |
| **总体风险** | **🟢 低** |

---

## 修复项五：pendingChunks 队列上限 ✅ 低风险

### 问题

`offscreen-main.ts` 中 `pendingChunks` 数组无大小限制，在 OPFS Writer 就绪较慢时可能无限增长。

### 方案

添加队列上限（500 个 chunk），超出时丢弃最老的 chunk，避免内存溢出。

```typescript
const PENDING_CHUNKS_MAX = 500;

function appendToOpfsChunk(d) {
  if (!writer || !writerReady) {
    if (pendingChunks.length >= PENDING_CHUNKS_MAX) {
      pendingChunks.shift(); // 丢弃最老的
    }
    pendingChunks.push(d);
    return;
  }
  // ... existing write logic
}
```

### 风险评估

| 维度 | 评估 |
|------|------|
| 功能影响 | 仅在极端情况（500+ chunk 积压）时丢弃早期数据 |
| 正常录制 | Writer 通常在几百毫秒内就绪，不会触达上限 |
| **总体风险** | **🟢 低** |

---

## 实施优先级

| 优先级 | 修复项 | 风险 | 预计改动行数 |
|--------|--------|------|------------|
| P0 | 控制窗口单例锁 | 🟢 低 | ~20 行 |
| P0 | 录制完成清理所有控制窗口 | 🟢 低 | ~15 行 |
| P0 | 帧采集节流 | 🟢 低 | ~5 行 |
| P1 | 编码器背压阈值提升 | 🟢 低 | ~1 行 |
| P1 | pendingChunks 队列上限 | 🟢 低 | ~5 行 |

所有修复项均为低风险改动，不涉及架构变更，可逐项实施并验证。
