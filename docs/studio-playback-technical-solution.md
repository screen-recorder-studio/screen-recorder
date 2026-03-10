# Studio 播放引擎优化技术方案

> 基于评估报告：`docs/studio-playback-evaluation.md`  
> 目标：修复偶发跳帧和进度条回跳问题

---

## 一、修复范围

本方案聚焦于评估报告中识别的 P0 和 P1 两个核心问题，以及 P2 辅助问题：

| 优先级 | 问题 | 修复文件 | 修改量 |
|--------|------|----------|--------|
| P0 | 播放循环帧时间累积偏差 | `composite-worker/index.ts` | ~10 行 |
| P1 | 窗口切换双重 rAF 延迟 | `VideoPreviewComposite.svelte` | ~8 行 |
| P2 | 时间戳精度损失 | `+page.svelte` + `opfs-reader-worker.ts` | ~4 行 |

---

## 二、P0 修复：播放循环帧时间累积

### 问题回顾

```typescript
// 当前实现
let lastFrameTime = 0;
function playFrame() {
  const now = performance.now();
  if (now - lastFrameTime >= frameInterval) {
    renderFrame();
    lastFrameTime = now;  // ← 问题：使用实际时间，误差不可恢复
  }
  requestAnimationFrame(playFrame);
}
```

### 修复方案

**核心思路**：将 `lastFrameTime` 改为**累积递增**（每帧 += frameInterval），而非使用 `performance.now()`。这样即使某帧渲染延迟，后续帧会"追赶"回来，保持长期时间精度。

```typescript
// 修复后实现
let lastFrameTime = 0;
function playFrame() {
  if (!isPlaying) return;
  const now = performance.now();

  // 首帧初始化：以当前时间为基准
  if (lastFrameTime === 0) {
    lastFrameTime = now;
  }

  if (now - lastFrameTime >= frameInterval) {
    // ... 渲染帧 ...
    currentFrameIndex++;
    // 累积递增，而非使用 now；保持长期精度
    lastFrameTime += frameInterval;

    // 安全阀：如果累积偏差过大（>2帧间隔），重新同步
    // 防止因长时间暂停后恢复导致一次性快进大量帧
    if (now - lastFrameTime > frameInterval * 2) {
      lastFrameTime = now;
    }
  }
  animationId = self.requestAnimationFrame(playFrame);
}
```

### 设计要点

1. **累积递增**：`lastFrameTime += frameInterval` 确保帧间隔严格等于理论值，不受渲染延迟影响。
2. **首帧初始化**：`lastFrameTime = 0` 时使用 `now` 初始化，避免启动时立即渲染大量帧。
3. **安全阀**：当累积偏差 > 2 帧间隔时重新同步，防止暂停恢复后快进。

---

## 三、P1 修复：窗口切换延迟

### 问题回顾

```typescript
// 当前实现：两个嵌套 rAF，至少 32ms 延迟
if (shouldContinuePlayback) {
  requestAnimationFrame(() => {
    seekToFrame(startFrame)
    requestAnimationFrame(() => {
      play()
    })
  })
}
```

### 修复方案

**核心思路**：将双重 rAF 合并为单次 rAF，在同一个回调中顺序执行 seek 和 play。由于 Worker 消息队列是 FIFO 的，同一个事件循环中发送的 `'seek'` 和 `'play'` 消息会被 Worker 按顺序处理。

```typescript
// 修复后实现
if (shouldContinuePlayback) {
  shouldContinuePlayback = false
  lastFrameWindowStartIndex = windowStartIndex
  currentFrameIndex = startFrame

  requestAnimationFrame(() => {
    seekToFrame(startFrame)
    play()  // 同一 rAF 回调中，消息按顺序送达 Worker
  })
}
```

### 设计要点

1. **单次 rAF**：减少 16ms 延迟，窗口切换更流畅。
2. **FIFO 保证**：Worker 的 `onmessage` 按消息到达顺序处理，同一微任务中 `postMessage` 的消息保持顺序。
3. **状态更新前移**：在 rAF 之前更新 `lastFrameWindowStartIndex` 和 `currentFrameIndex`，确保期间进度条显示正确。

---

## 四、P2 修复：时间戳精度

### 修复方案

将时间戳转换从 `Math.floor()` 改为 `Math.round()`，减少系统性负向偏移。

```typescript
// opfs-reader-worker.ts
function timestampToMs(timestamp: number): number {
  return Math.round(timestamp / 1000)  // Math.floor → Math.round
}

// +page.svelte
windowStartMs = Math.round((windowStartTimestamp - firstGlobalTimestamp) / 1000)
windowEndMs = Math.round((windowEndTimestamp - firstGlobalTimestamp) / 1000)
```

---

## 五、不修改项说明

以下问题在本次迭代中不做修改，原因如下：

| 问题 | 不修改原因 |
|------|-----------|
| P3：GOP 截断 | 需要重构窗口管理逻辑，影响面大；当前 140 帧限制在绝大多数场景下足够 |
| P4：帧缓冲无背压 | 需要在 Worker 中实现 decode 暂停/恢复机制，复杂度高；当前 150 帧上限在 1080p 场景下足够 |
| 预取缓存严格匹配 | 当前整数帧索引比较不存在浮点误差，严格匹配是正确行为 |
| 预取超时 4 秒 | 在低端设备上 OPFS 读取可能较慢，4 秒是合理的上限 |

---

## 六、修改清单

### 文件 1：`packages/extension/src/lib/workers/composite-worker/index.ts`

| 行号 | 修改内容 |
|------|----------|
| 1303 | `lastFrameTime` 初始化逻辑 |
| 1308-1309 | 添加首帧初始化判断 |
| 1342 | `lastFrameTime = now` → `lastFrameTime += frameInterval` + 安全阀 |

### 文件 2：`packages/extension/src/lib/components/VideoPreviewComposite.svelte`

| 行号 | 修改内容 |
|------|----------|
| 377-382 | 双重 rAF → 单次 rAF |

### 文件 3：`packages/extension/src/routes/studio/+page.svelte`

| 行号 | 修改内容 |
|------|----------|
| 416-421 | `Math.floor` → `Math.round` |

### 文件 4：`packages/extension/src/lib/workers/opfs-reader-worker.ts`

| 行号 | 修改内容 |
|------|----------|
| 47 | `Math.floor` → `Math.round` |

---

## 七、验证方案

### 构建验证

```bash
pnpm check    # 类型检查
pnpm build:extension  # 构建
```

### 功能验证要点

1. 正常播放：30 秒以上视频无可见跳帧
2. 窗口切换：观察播放中每次窗口切换是否流畅（无停顿/回跳）
3. Seek 操作：拖动进度条后恢复播放正常
4. Trim 播放：裁剪范围内播放正确
5. 长视频播放：5 分钟以上视频，进度条与实际时间保持同步
