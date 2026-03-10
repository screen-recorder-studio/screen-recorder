# 录制管线端到端评估报告

## 1. 评估范围

本报告对 Screen Recorder Studio 的录制管线进行端到端评估，覆盖以下关键路径：

```
用户点击 Action → 控制窗口创建 → 录制启动 → 帧采集 → WebCodecs 编码 → OPFS 存储 → 录制完成 → Studio 打开
```

### 评估文件

| 模块 | 文件 | 职责 |
|------|------|------|
| 控制窗口 | `extensions/background.ts` | Service Worker，窗口生命周期管理 |
| 控制面板 UI | `routes/control/+page.svelte` | 录制控制界面 |
| Offscreen 管理 | `lib/utils/offscreen-manager.ts` | Offscreen Document 生命周期 |
| 数据接收 | `extensions/offscreen-main.ts` | 编码数据接收与 OPFS 写入调度 |
| 帧编码 | `extensions/encoder-worker.ts` | WebCodecs VideoEncoder 管道 |
| OPFS 写入 | `extensions/opfs-writer.ts` | OPFS 文件系统写入 |
| 内容脚本 | `extensions/content.ts` | 帧采集与 Worker 通信 |

---

## 2. 问题一：控制窗口多开

### 2.1 现象

用户多次点击扩展图标 (Action)，会创建多个控制窗口。录制完成后仅关闭最后记录的一个窗口 ID，其余窗口成为"废弃小窗口"残留在桌面上。

### 2.2 根因分析

**文件：`background.ts` 第 138-201 行**

```javascript
let controlWinId: number | null = null;

async function openOrFocusControlWindow(): Promise<void> {
  // ① 检查内存中的 controlWinId
  if (controlWinId !== null) {
    try {
      await chrome.windows.update(controlWinId, { focused: true });
      return;
    } catch {
      controlWinId = null;
    }
  }

  // ② 遍历所有窗口寻找已有的 control.html
  const allWindows = await chrome.windows.getAll({ populate: true });
  // ...

  // ③ 创建新窗口
  const win = await chrome.windows.create({ ... });
}
```

**问题点：**

1. **无并发锁**：`openOrFocusControlWindow()` 是异步函数，但没有互斥锁。当用户快速多次点击 Action 时，多个调用同时进入，全部通过 `controlWinId === null` 检查，全部执行 `chrome.windows.create()`，导致创建多个窗口。

2. **Service Worker 重启丢状态**：Chrome MV3 Service Worker 可能被休眠后重新唤醒，此时 `controlWinId` 变量重置为 `null`。虽然有窗口恢复逻辑（步骤 ②），但恢复逻辑与创建逻辑之间存在 TOCTOU 竞态 — 恢复尚未完成时新创建已开始。

3. **`OPEN_CONTROL_WINDOW` 消息与 `action.onClicked` 双入口**：两个入口均调用 `openOrFocusControlWindow()`，缺乏统一的防重机制。

4. **`controlWinId` 只记录最后一个**：即使创建了多个窗口，`controlWinId` 仅保存最后创建的窗口 ID。当 `OPFS_RECORDING_READY` 时只关闭最后一个，其余窗口遗留。

### 2.3 影响评估

| 维度 | 影响 |
|------|------|
| 用户体验 | 桌面残留多个小窗口，需手动关闭 |
| 资源占用 | 每个窗口消耗约 30-50MB 内存 |
| 状态混乱 | 多窗口同时监听录制状态，可能产生重复指令 |

---

## 3. 问题二：录制过程鼠标迟滞

### 3.1 现象

录制过程中用户操作鼠标明显感到卡顿/迟滞，影响正常使用体验。

### 3.2 根因分析

#### 3.2.1 帧采集无节流 (content.ts 第 1811-1820 行)

```javascript
state.reader = state.processor.readable.getReader();
(async () => {
  for (;;) {
    const { done, value: frame } = await state.reader.read();
    if (done) break;
    state.worker?.postMessage({ type: 'frame', frame, keyFrame, i: frameIndex }, [frame]);
    frameIndex++;
  }
})();
```

`MediaStreamTrackProcessor` 以 GPU 刷新率（通常 60fps）产出帧，但 `for(;;)` 循环无任何节流，在内容脚本的主线程中以最高速率拉取帧并 `postMessage` 到 Worker。

**影响**：每帧 `postMessage` 需要序列化/转移帧数据，频繁的跨线程通信增加主线程负载。

#### 3.2.2 编码器背压导致静默丢帧 (encoder-worker.ts 第 104-110 行)

```javascript
const BACKPRESSURE_MAX = 8;
if (encoder.encodeQueueSize > BACKPRESSURE_MAX) {
  frame?.close?.();
  break;
}
```

当编码队列积压超过 8 帧时，新帧被直接丢弃。这个背压机制虽然防止了内存溢出，但：
- **无反馈通知**：内容脚本不知道帧被丢弃，继续高速推送
- **丢帧阈值过低**：BACKPRESSURE_MAX=8 在高分辨率场景下很容易触达

#### 3.2.3 数据复制开销 (encoder-worker.ts 第 28-29 行)

```javascript
const buf = new Uint8Array(chunk.byteLength);
chunk.copyTo(buf);
```

每个编码后的 chunk 都进行同步 `copyTo()` 操作。对于高码率视频（8Mbps），每个 chunk 约 33-100KB，复制操作阻塞 Worker 线程。

#### 3.2.4 逐块 IPC 无批量化 (offscreen-main.ts 第 87-156 行)

每个编码 chunk 单独通过 `postMessage` 发送到 OPFS Writer Worker，无批量化机制。30fps 时每秒约 30 次 `postMessage` 调用，加上 `Transferable` 缓冲区处理，增加进程间通信开销。

#### 3.2.5 pendingChunks 无界队列 (offscreen-main.ts 第 14 行)

```javascript
const pendingChunks: Array<...> = [];
```

如果 OPFS Writer 尚未就绪或写入较慢，`pendingChunks` 数组可以无限增长，导致内存压力上升，触发 GC（垃圾回收），而 GC 暂停是造成鼠标迟滞的重要因素之一。

### 3.3 数据流瓶颈图

```
[GPU/屏幕] 60fps
    ↓ (无节流)
[content.ts 主线程] ← 主线程高频 postMessage，影响事件循环
    ↓ postMessage(frame, [frame])
[encoder-worker] ← BACKPRESSURE_MAX=8，超出丢帧
    ↓ postMessage(chunk)
[content.ts → offscreen-main.ts] ← 逐块 IPC，无批量
    ↓ postMessage(append)
[opfs-writer Worker] ← 同步 I/O 写入
```

### 3.4 影响评估

| 维度 | 影响 |
|------|------|
| 鼠标操作 | 明显迟滞，尤其高分辨率/高帧率场景 |
| CPU 占用 | 内容脚本主线程高负载，影响页面响应 |
| 内存 | pendingChunks 无限增长可能触发频繁 GC |
| 视频质量 | 静默丢帧导致视频不流畅 |

---

## 4. 其他发现

### 4.1 录制完成后窗口关闭逻辑

`OPFS_RECORDING_READY` 处理中（background.ts 第 359-410 行）：
- 仅关闭 `controlWinId` 记录的最后一个窗口
- 如果存在多个控制窗口，其余不会被关闭

### 4.2 Service Worker 状态持久性

`currentRecording` 对象纯内存存储（background.ts 第 972-980 行），Service Worker 重启后丢失，可能导致录制状态不一致。

### 4.3 OPFS Writer 初始化竞态

`offscreen-main.ts` 中 `initOpfsWriter()` 没有防重入保护，如果短时间内收到多个 `chunk` 消息且 writer 未初始化，理论上不会重复创建（有 `if (writer) return` 检查），但 `appendToOpfsChunk` 中对 `writerReady` 的检查依赖时序。

---

## 5. 风险评估总结

| 问题 | 严重程度 | 修复风险 | 建议优先级 |
|------|---------|---------|-----------|
| 控制窗口多开（无并发锁） | 🔴 高 | 🟢 低 | P0 |
| 帧采集无节流 | 🔴 高 | 🟡 中 | P0 |
| 编码器背压阈值过低 | 🟡 中 | 🟢 低 | P1 |
| pendingChunks 无界队列 | 🟡 中 | 🟢 低 | P1 |
| 录制完成仅关闭单个窗口 | 🟡 中 | 🟢 低 | P0（随窗口修复一并解决） |
| 编码 chunk 同步复制 | 🟡 中 | 🟡 中 | P2 |
| 逐块 IPC 无批量化 | 🟢 低 | 🟡 中 | P2 |
