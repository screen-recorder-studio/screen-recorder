# WebCodecs 性能优化：Chrome 扩展中的 4K 60FPS 编码实践

> **摘要**: 在浏览器沙箱中实现 4K 级别的实时视频编码是一项挑战。本文详细复盘了 Screen Recorder Studio 在工程实现中遇到的性能瓶颈，并深入探讨了基于 Transferable Objects 的零拷贝传输、硬件编码器的兼容性适配策略以及基于背压（Backpressure）的流控机制。

---

## 快速开始：源码与体验

*   **GitHub 源码**：访问 <https://github.com/screen-recorder-studio/screen-recorder>，欢迎加星支持。
*   **安装体验**：在 Chrome 应用市场搜索 **Screen Recorder Studio**，即可安装体验。

## 1. 性能瓶颈分析

尽管 Chrome 94 起逐步提供 WebCodecs API，使 JavaScript 可以访问底层编解码能力，但并不意味着“调用 API 就能自动获得高性能”。在开发初期，我们尝试在主线程直接处理 4K 视频流，结果遇到了严重的性能问题：

*   **UI 冻结 (Jank)**: 视频帧的处理逻辑抢占了主线程，导致 UI 响应延迟超过 200ms。
*   **内存带宽饱和**: 4K RGBA 帧的数据量约为 `3840 * 2160 * 4 bytes ≈ 33MB`。以 60FPS 计算，内存吞吐量高达 2GB/s。频繁的 GC 和对象拷贝迅速耗尽了系统资源。

为了突破这些物理限制，我们必须在**线程模型**和**数据流转**上下功夫。

### 我们关心哪些指标？

在“能录”之外，高性能录屏更像是一套系统工程。实际调优时，我们通常会把问题拆成四个可观测指标：

*   **吞吐（能否实时）**：采集 FPS 是否能稳定跟上目标 FPS，编码队列是否持续积压（`VideoEncoder.encodeQueueSize`）。
*   **延迟（是否越录越慢）**：从采集到落盘/导出的端到端延迟是否增长，是否出现“越录越卡、越录越慢”的雪崩。
*   **内存（是否随时长增长）**：`VideoFrame`、编码队列、各类缓冲是否会线性上涨，是否存在未关闭对象造成的泄漏。
*   **功耗与温度（是否可持续）**：长时录制下 CPU/GPU 占用是否可接受，是否触发系统降频导致性能断崖。

---

## 2. 核心优化一：零拷贝传输 (Zero-Copy Transfer)

将视频帧从采集线程（Offscreen）传递给编码线程（Worker）是整个链路中最关键的一步。

### 传统 postMessage 的代价
标准的 `postMessage` 采用结构化克隆算法（Structured Clone Algorithm）。当高频发送大对象（例如 4K `VideoFrame`）时，即使底层实现可能会做共享/延迟复制等优化，依然容易引入额外的对象分配、引用管理乃至像素拷贝开销；在 60FPS 的节奏下，这些开销会被放大为可观的 CPU 与内存带宽压力。

### Transferable Objects 方案
我们利用了 `VideoFrame` 实现的 `Transferable` 接口。在发送消息时，我们显式将 `frame` 列入转移列表。

```typescript
// src/extensions/offscreen-main.ts

const { value: frame } = await reader.read();

// ❌ 错误做法：导致克隆
// worker.postMessage({ type: 'encode', frame });

// ✅ 正确做法：转移所有权
worker.postMessage(
  { type: 'encode', frame }, 
  [frame] // 第二个参数：Transfer List
);
```

**机制解析**：这类似于 C++ 中的 `std::move`。一旦消息发送，主线程立即失去对 `frame` 的访问权（读取会抛出异常），而 Worker 瞬间获得该对象的句柄。整个过程不涉及底层图像数据的内存复制，仅传递了指针，开销几乎为零。

### 零拷贝之外：避免“隐形格式转换”

即便做到了 Transferable，仍可能在链路里触发昂贵的格式转换（例如在采集端把帧绘制到 `canvas` 再读回像素，或把 GPU 纹理回读到 CPU 内存）。这类转换常见症状是 CPU 突增、内存带宽飙升、编码前的预处理耗时异常。

Screen Recorder Studio 的主链路选择用 `MediaStreamTrackProcessor` 直接产出 `VideoFrame`，并把 `VideoFrame` 作为跨线程边界的数据契约，尽量避免在采集端引入额外的像素拷贝与颜色空间转换。

---

## 3. 核心优化二：硬件编码器的降级与适配

WebCodecs 的 `VideoEncoder` 是对底层硬件（如 NVENC, AMF, QuickSync）的抽象。然而，硬件实现的碎片化极其严重。

### 分辨率对齐 (Alignment)
许多老旧的硬件编码器要求输入分辨率必须是 16 的倍数（Macroblock 宏块大小）。如果输入 `1920x1080`（1080 不是 16 的倍数），`configure` 可能会直接报错或回退到软件编码。

我们实现了一个自动对齐算法：

```typescript
// src/lib/utils/webcodecs-config.ts

function align16Down(value: number): number {
  // 向下取整到最近的 16 倍数
  // 例如：1080 -> 1072
  return value & ~0xF;
}

const config = {
  width: align16Down(originalWidth),
  height: align16Down(originalHeight),
  // ...
};
```
这种做法本质是“向下对齐编码分辨率”（可能表现为轻微的裁切或缩放），但通常能显著提高硬件兼容性，避免直接失败或被迫回退到软件编码。

### 工程化实现：配置探测与变体尝试

编码器能力的碎片化不只体现在 codec 本身，还体现在 profile、封装格式（例如 H.264 的 `avc`/`annexb`）、分辨率对齐、帧率与码率上限等组合维度。一个“能跑”的工程实现，核心不是写死一组参数，而是：

1.  归一化输入（例如宽高偶数化、16 对齐变体）。
2.  生成多个候选配置（帧率变体、可选码率开关）。
3.  用 `VideoEncoder.isConfigSupported` 探测并选择第一个可用配置。

对应实现位于 `src/lib/utils/webcodecs-config.ts`，其中既包含 `align16Down`，也包含一套“候选配置 + 探测 + 最小化回退”的逻辑（`tryConfigureBestEncoder`）。

### 智能降级策略
并不是所有设备都支持 H.264 High Profile。为了保证可用性，我们构建了一个优先级探测队列：

1.  **尝试 H.264 High Profile**: 最佳画质与压缩率平衡。
2.  **降级 H.264 Baseline**: 兼容性最好，但同码率下画质稍差。
3.  **回退 VP9/VP8**: 如果 H.264 不可用，则尝试 VPx 系列（通常至少有软件实现保底）。

在工程上，我们通过 `VideoEncoder.isConfigSupported` 逐项探测候选配置（分辨率对齐、不同 profile/format、不同帧率/码率组合），最终选择第一个可用项（实现见 `src/lib/utils/webcodecs-config.ts`）。

---

## 4. 核心优化三：背压控制 (Backpressure)

编码是一个异步过程，且编码耗时受画面复杂度影响剧烈（复杂纹理场景编码更慢）。当采集速度（FPS）持续高于编码速度时，输入队列会无限积压。

**后果**：
1.  **内存泄漏**：未处理的 `VideoFrame` 堆积在内存中。
2.  **延迟累积**：录制出的视频不仅画面卡顿，且延迟会越来越大。

我们利用 `VideoEncoder.encodeQueueSize` 属性实现了主动丢帧机制：

```typescript
// src/lib/workers/webcodecs-worker.ts

const BACKPRESSURE_MAX = 8 // 允许最大积压 8 帧

async function encodeFrame(frame) {
  // 监控队列深度
  if (encoder.encodeQueueSize > BACKPRESSURE_MAX) {
    console.warn(`Encoder congested (queue: ${encoder.encodeQueueSize}), dropping frame`)
    frame.close()
    return
  }

  encoder.encode(frame)
  frame.close()
}
```
这种机制类似于网络流控，牺牲部分帧率来换取系统的整体稳定性，防止雪崩效应。

### 丢帧之外：关键帧策略要协同

背压触发后如果简单粗暴地丢帧，可能带来两个副作用：

*   **观感抖动**：连续丢帧会让用户感知明显掉帧。
*   **Seek/编辑体验变差**：如果关键帧间隔过大，后续回放或导出时的 Seek 会更慢。

因此在 Screen Recorder Studio 的录制链路中，关键帧并非完全交给编码器默认策略，而是由采集侧按节奏控制（例如强制每 2 秒一个关键帧，相关逻辑在 `src/extensions/offscreen-main.ts` 中按 `framerate * 2` 计算间隔）。这让“背压丢帧”和“可编辑性/可 Seek”之间形成更稳定的工程折中。

---

## 5. 可选优化：Content Hint

在屏幕录制场景中，用户对**清晰度（Sharpness）**的敏感度远高于**流畅度（Motion）**。特别是录制代码演示或文档时，模糊的文字是不可接受的。

WebRTC 标准中的 `contentHint` 属性允许我们向编码器传递意图：

```typescript
// 提示浏览器：这是文字内容，请优先保留边缘细节
track.contentHint = 'text';
```

当设置为 `'text'` 时，浏览器底层的编码器策略会发生变化：
*   **码率分配**：优先分配给 I 帧和静态区域。
*   **帧率策略**：在带宽受限时，宁愿降低帧率（丢帧）也不会降低分辨率或增加量化步长（QP），从而确保文字始终清晰可读。

需要注意：`contentHint` 的支持程度与具体的采集源/浏览器实现有关，并非所有 `MediaStreamTrack` 都会生效。在 Screen Recorder Studio 的编码链路里，它属于“可选的画质偏好提示”，适合在兼容性验证后按需开启。

---

## 6. 常见现象与排查清单

| 现象 | 常见原因 | 优先排查 |
| --- | --- | --- |
| UI 变卡、鼠标拖拽都不顺 | 主线程做了重活（绘制/拷贝/日志过多） | 确认采集与编码都在 Worker/Offscreen，避免把帧绘制回主线程；减少高频日志 |
| 录制开始很顺，几分钟后越来越慢 | 编码吞吐 < 采集吞吐，队列持续积压 | 观察 `encodeQueueSize` 是否持续增长；启用背压丢帧；降低 `framerate` 或码率 |
| 内存持续上涨，最终崩溃 | `VideoFrame` 未及时 `close()` 或队列堆积 | 确保丢帧与正常路径都关闭 `frame`；检查是否有缓存数组在累积 |
| 某些机器上 `configure` 失败或回退软件编码 | 分辨率未对齐、profile/format 不支持 | 启用对齐变体与 `isConfigSupported` 探测；尝试 VP9/VP8 回退 |
| 导出/Seek 很慢 | 关键帧间隔太大或缺少索引策略 | 调整关键帧节奏（例如 2 秒）；在导出阶段生成更合理的索引/容器结构 |

## 结论

通过深入理解浏览器底层的内存模型和编解码机制，Screen Recorder Studio 证明了 Web 技术在高性能多媒体领域的潜力。**零拷贝传输**解决了带宽瓶颈，**智能适配**解决了碎片化问题，而**背压控制**则保障了系统的鲁棒性。这些工程实践构成了 Chrome 扩展端 4K 录制的基石。

---

## 进一步了解

*   GitHub：<https://github.com/screen-recorder-studio/screen-recorder>
*   Chrome 应用市场：搜索 **Screen Recorder Studio**
