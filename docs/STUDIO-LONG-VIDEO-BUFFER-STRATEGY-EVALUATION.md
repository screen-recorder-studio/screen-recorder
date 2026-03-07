# Studio 长视频预览缓冲策略评估报告

## 1. 评估目标与范围

本报告聚焦 `packages/extension/src/routes/studio/+page.svelte` 所驱动的 Studio 长视频预览、连续播放与编辑体验，重点回答两个问题：

1. 当前长视频连续播放的缓冲策略是否符合行业最佳实践；
2. 当前“双窗口”方案与“环形缓冲（Ring Buffer）”方案相比，分别有什么优劣，以及本项目更适合怎样的演进路线。

本次**仅评估，不修改代码**。评估覆盖以下关键链路：

- Studio 页面调度：`packages/extension/src/routes/studio/+page.svelte`
- 预览/播放组件：`packages/extension/src/lib/components/VideoPreviewComposite.svelte`
- OPFS 读取 Worker：`packages/extension/src/lib/workers/opfs-reader-worker.ts`
- 解码/合成 Worker：`packages/extension/src/lib/workers/composite-worker/index.ts`

---

## 2. 基线验证

在开始评估前，对仓库做了最小基线验证：

- `pnpm install`：成功
- `pnpm build:extension`：成功
- `pnpm check`：失败，但失败来自仓库现有的 Svelte/样式告警与检查问题，不是本次文档变更引入

说明：

- 当前仓库**没有自动化测试套件**，CLAUDE.md 中定义的验证方式以 `pnpm build:extension` 和人工验证为主。
- 本次仅新增文档，不改运行时代码，因此不新增测试。

---

## 3. Studio 长视频预览的当前架构

### 3.1 主链路概览

当前长视频预览链路可以概括为：

```text
Studio 页面
  -> OPFS Reader Worker 打开 recording
  -> 读取 meta.json / index.jsonl / data.bin
  -> 首屏请求一个窗口的 encoded chunks
  -> VideoPreviewComposite 将 chunks 发送给 Composite Worker
  -> Composite Worker 做流式解码 + 合成 + 位图输出
  -> 主线程 canvas 显示
  -> 播放到窗口边界后请求下一窗口
  -> 继续播放
```

### 3.2 初始化路径

Studio 页面在录制加载后：

- 保存全局时长、总帧数、关键帧信息；
- 首次请求 `min(90, globalTotalFrames)` 帧作为初始窗口；
- 将窗口数据透传给 `VideoPreviewComposite`。

关键位置：

- `loadRecordingById()` 初始化与首窗加载：`packages/extension/src/routes/studio/+page.svelte:307-410`
- 首次 `getRange` 请求：`packages/extension/src/routes/studio/+page.svelte:373-378`

### 3.3 OPFS Reader 的职责

OPFS Reader Worker 的职责是：

- 全量读取 `index.jsonl` 到内存；
- 建立关键帧索引摘要；
- 按请求的帧范围或时间范围，从 `data.bin` 中**批量切片读取**；
- 返回适合 WebCodecs 的 `chunks` 数组。

关键位置：

- 全量读取索引：`packages/extension/src/lib/workers/opfs-reader-worker.ts:75-87`
- 关键帧摘要：`packages/extension/src/lib/workers/opfs-reader-worker.ts:98-193`
- `getRange`：`packages/extension/src/lib/workers/opfs-reader-worker.ts:395-458`
- `getWindowByTime` / `getRangeByTime`：`packages/extension/src/lib/workers/opfs-reader-worker.ts:306-393`

### 3.4 Composite Worker 的职责

Composite Worker 负责：

- 用 `VideoDecoder` 解码当前窗口；
- 维护 `decodedFrames`（当前窗口）与 `nextDecoded`（下一窗口）；
- 合成背景、裁剪、缩放等编辑效果；
- 按播放节奏输出位图给主线程；
- 上报 bufferStatus / windowComplete。

关键位置：

- 主缓冲与下一窗口缓冲定义：`packages/extension/src/lib/workers/composite-worker/index.ts:34-40`
- 动态帧缓冲上限：`packages/extension/src/lib/workers/composite-worker/index.ts:62-129`
- 当前窗口流式解码：`packages/extension/src/lib/workers/composite-worker/index.ts:1010-1206`
- 下一窗口追加解码：`packages/extension/src/lib/workers/composite-worker/index.ts:1208-1253`
- `process` / `appendWindow`：`packages/extension/src/lib/workers/composite-worker/index.ts:1448-1602`
- 播放循环与水位上报：`packages/extension/src/lib/workers/composite-worker/index.ts:1274-1431`

---

## 4. 当前方案是否真的是“双窗口”？

结论：**是，但更准确地说，它是“主窗口 + 预取窗口”的双窗口方案，而不是连续滚动的环形缓冲。**

### 4.1 Studio 层面的窗口定义

Studio 使用 `computeFrameWindow()` 统一计算播放/seek/预取窗口：

- `prefetch` 模式最少约 `1s`
- `play/seek` 模式最少约 `2s`
- 所有模式上限约 `4s`

关键代码：

- `computeFrameWindow()`：`packages/extension/src/routes/studio/+page.svelte:97-226`
- 最小/最大窗口帧数：`packages/extension/src/routes/studio/+page.svelte:134-149`

实际窗口大小并不是固定秒数，而是受以下因素共同影响：

1. 目标时间点；
2. before/after 时间范围；
3. 关键帧间隔；
4. 总帧数；
5. `maxFramesPerWindow = 140` 的硬限制。

### 4.2 Reader 层的关键帧对齐

尽管播放模式下 `computeFrameWindow()` 尝试“只前进不回退”，但真正的读取仍会在 `getRange` 中回退到最近关键帧，以保证可解码性：

- `keyframeBefore(requestedStart)`：`packages/extension/src/lib/workers/opfs-reader-worker.ts:220-239`
- `getRange()` 的关键帧回退：`packages/extension/src/lib/workers/opfs-reader-worker.ts:400-416`

因此，**逻辑上的“下一帧开始”并不总等于物理上的“下一窗口起点”**。这对平滑衔接和缓存命中率都很关键。

### 4.3 Composite Worker 中的双窗口

Composite Worker 内部存在两个明确的帧池：

- `decodedFrames`：当前窗口
- `nextDecoded`：下一窗口后台预解码缓冲

关键代码：

- 双缓冲定义：`packages/extension/src/lib/workers/composite-worker/index.ts:34-40`
- 预解码写入 `nextDecoded`：`packages/extension/src/lib/workers/composite-worker/index.ts:1585-1599`
- 下一窗口命中复用 `nextDecoded`：`packages/extension/src/lib/workers/composite-worker/index.ts:1503-1535`

这说明当前实现的核心不是“一个连续增长的 buffer”，而是：

1. 当前窗口解码并播放；
2. 水位低时预抓取下一窗口数据；
3. 可选地先解码到 `nextDecoded`；
4. 真正切窗时，若起点精确匹配，则直接把 `nextDecoded` 晋升为当前窗口。

### 4.4 预取触发机制

预取并不是一直进行，而是依赖水位事件：

- Worker 在播放过程中根据 `remaining` 帧数上报 `healthy / low / critical`
- 主线程在 `low/critical` 状态下才开始构建预取缓存
- 预取缓存准备好后，再尝试 `appendWindow` 到 Worker 做后台解码

关键代码：

- 水位阈值：`packages/extension/src/lib/workers/composite-worker/index.ts:52-60`
- 水位上报：`packages/extension/src/lib/workers/composite-worker/index.ts:1344-1411`
- 主线程收到 `bufferStatus` 后开始 prefetch：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:431-558`

### 4.5 切窗方式

当当前窗口播放结束：

- Worker 发 `windowComplete`
- 主线程计算 `nextGlobalFrame`
- Studio 再通过 OPFS Reader 请求新的窗口
- 新窗口到达后重新触发 `process`
- 若已提前命中 `nextDecoded`，则快速晋升；否则重新解码

关键代码：

- `handleWindowComplete()`：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:1422-1511`

**因此当前实现是“双窗口 + 事件驱动切换”，而不是“连续消费、连续补充”的环形缓冲。**

---

## 5. 当前策略的优点

从编辑器场景看，当前方案并非落后设计，反而有若干合理性：

### 5.1 关键帧/GOP 语义清晰

当前方案对“从关键帧开始解码”这一视频编辑器核心约束处理得比较明确：

- seek/拖拽/预取都通过统一窗口计算；
- Reader 层再次强制关键帧对齐；
- 单帧预览时还额外提供了 `getSingleFrameGOP` 最小 GOP 读取。

这比“纯播放器式字节流推进”更适合编辑器。

### 5.2 内存边界相对可控

Composite Worker 对当前窗口和下一窗口都有上限约束：

- `maxDecodedFrames` 默认 150
- `maxNextDecoded` 默认 120
- 并尝试根据分辨率和 `performance.memory` 动态收缩

关键代码：

- `computeDynamicBufferLimits()`：`packages/extension/src/lib/workers/composite-worker/index.ts:82-126`

这意味着它没有盲目把长视频整段解码进内存。

### 5.3 对随机 Seek 和预览友好

编辑器不只是连续播放，还包含：

- 时间轴点击 seek
- hover preview
- 单帧 GOP 预览
- trim、crop、zoom 的编辑后重渲染

当前“双窗口 + GOP 对齐”逻辑，比单纯为连续播放而设计的 ring buffer 更容易与这些编辑行为共存。

### 5.4 已具备演进基础

虽然当前不是 ring buffer，但它已经有：

- 水位检测；
- 预取计划；
- 下一窗口后台解码；
- 切窗前复用 `nextDecoded`；

这说明它距离“分段化滚动缓冲”并不远，架构上具备可演进性。

---

## 6. 当前方案存在的主要问题

这是本次评估的重点。当前用户感知到“播放不平滑、预览卡顿”，代码中确实能找到明确原因。

### 6.1 它是“边界切换”模型，不是“连续滚动”模型

当前播放循环在窗口边界处会停住：

- 如果 `currentFrameIndex >= boundary`，直接发送 `windowComplete`
- 然后 `isPlaying = false`
- 等待主线程请求并准备新窗口后，再恢复

关键代码：

- `windowComplete` 触发：`packages/extension/src/lib/workers/composite-worker/index.ts:1310-1320`

这意味着即便已有预取，播放链路依然以“窗口结束 -> 切换 -> 恢复”为单位工作，而不是像成熟播放器那样持续从一个滚动缓冲中消费。

**结论：这不是严格意义上的 seamless playback。**

### 6.2 预取触发偏晚

当前预取是在 `low` 或 `critical` 时才启动，阈值为：

- `lowWatermark = 30` 帧（约 1 秒@30fps）
- `criticalLevel = 10` 帧（约 0.33 秒@30fps）

关键代码：

- `BUFFER_CONFIG`：`packages/extension/src/lib/workers/composite-worker/index.ts:52-58`

对于以下情况，这个窗口过于保守：

- 4K / 高码率视频；
- 大量背景合成/圆角/阴影/图片背景；
- 主线程繁忙；
- OPFS 读取耗时抖动；
- 预取缓存尚未构建时的首次低水位。

行业里更常见的做法是**在“健康状态”阶段就提前做 read-ahead / decode-ahead**，而不是等低水位才开始。

### 6.3 数据拷贝链路偏重

当前预览路径中存在多次全窗口数据遍历和 `ArrayBuffer.slice()`：

1. OPFS Reader 先批量读一个大块；
2. 再切分成单个 chunk；
3. 主线程 `processVideo()` 再把 chunk 数据拷贝为 transferable；
4. prefetchCache 为了复用和 append，又会再次 `.slice(0)` 复制；
5. 真正切窗时还会再次走 `process`。

关键代码：

- Reader 切分 batch buffer：`packages/extension/src/lib/workers/opfs-reader-worker.ts:347-377`
- `processVideo()` 重建 transferable chunks：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:719-763`
- prefetch append 再复制：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:446-455`, `529-547`

**这会带来 CPU、内存带宽和 GC 压力，长视频连续播放时尤其容易在切窗处放大。**

### 6.4 主线程日志量过大，可能直接制造卡顿

`VideoPreviewComposite` 中仍有明显的高频日志输出，部分逻辑接近逐帧：

- `displayFrame()` 每次显示帧都在 `console.log`
- 播放时间调试 `$effect` 在每次帧变化时输出
- 预取、切窗、bufferStatus 也有大量诊断日志

关键代码：

- `displayFrame()`：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:631-689`
- timer/frame jump 日志：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:1170-1187`

在长视频播放场景中，这类日志本身就会干扰主线程调度与 DevTools 性能，属于“会放大卡顿感知”的实现因素。

### 6.5 重新 `process` 的切窗成本仍然存在

即使预取命中，主线程在窗口切换后仍然会：

- 更新 `encodedChunks`
- 触发 `processVideo()`
- 再把 chunks 发送给 Composite Worker

只有当 `requestedStart` 与 `nextMeta.start` 精确匹配时，Worker 才能复用 `nextDecoded`。

关键代码：

- `processVideo()`：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:691-935`
- `canReuse` 判断：`packages/extension/src/lib/workers/composite-worker/index.ts:1503-1505`

这意味着当前方案虽然有“双窗口”，但切换时仍然依赖：

1. 主线程调度；
2. 一次新的 `process` 消息；
3. 精确的窗口起点匹配。

只要其中任一环节抖动，就会形成边界卡顿。

### 6.6 播放窗口过短，抗抖动能力不足

目前常见窗口规模大约是：

- 初始窗口：最多 90 帧；
- 读取上限：140 帧；
- 对 30fps 视频相当于约 3~4.6 秒。

关键代码：

- 首次 90 帧：`packages/extension/src/routes/studio/+page.svelte:373-378`
- Reader 上限 140 帧：`packages/extension/src/lib/workers/opfs-reader-worker.ts:335-341`, `408-416`

对编辑器来说，这个窗口长度不是不能用，但对长视频连续播放而言偏激进：

- 预取和切换机会过于频繁；
- 任何一次 OPFS 抖动、GC、主线程繁忙，都会更快暴露为用户可见顿挫。

### 6.7 当前方案更像“段式拼接”，而不是播放器级流水线

行业最佳实践的长视频预览通常是分层流水线：

- I/O read-ahead
- demux/decode queue
- render queue
- A/V 时钟/回压控制
- 平滑的滚动消费

而当前实现虽然有 Worker 和双窗口思想，但本质还是：

- 一段数据到达
- 一段解码
- 一段播放
- 一段切换

这更接近“编辑器内嵌播放器”的阶段式实现，而不是成熟 NLE 或流媒体播放器的持续流水线。

---

## 7. 与行业最佳实践的对比

### 7.1 符合最佳实践的部分

当前实现与行业较一致的点：

1. **Worker 隔离重计算**：解码/合成在 Worker 内完成，方向正确；
2. **关键帧对齐**：适合编辑器语义；
3. **水位监控**：说明已经引入 backpressure 思路；
4. **预解码下一窗口**：说明已经开始做 decode-ahead；
5. **针对 hover preview 使用最小 GOP**：非常符合编辑器局部操作的成本控制思路。

### 7.2 不完全符合最佳实践的部分

与更成熟的长视频预览系统相比，当前短板主要有：

1. **预取开始过晚**  
   最佳实践通常在 buffer 仍“健康”时就开始下一段 I/O / decode-ahead。

2. **边界切窗仍可见**  
   最佳实践倾向于“滚动消费 + 持续补充”，而不是“播放完一段再切下一段”。

3. **主线程参与过多**  
   当前切窗仍依赖主线程完成较多数据复制和消息编排。

4. **没有真正的分段缓冲池管理**  
   当前只有 current/next 两段，没有 segment queue、LRU GOP cache 或 ring of segments。

5. **日志与调试逻辑未明显收敛**  
   最佳实践中，高频路径不会保留大量逐帧日志。

### 7.3 综合判断

**当前双窗口方案在“编辑器可用性”上是合理的，但在“长视频连续播放流畅度”上还没有达到行业最佳实践。**

更准确地说：

- 它已经具备了最佳实践的雏形；
- 但还停留在“第二代”实现；
- 若想显著改善长视频平滑度，需要进一步向“滚动分段缓冲”演进。

---

## 8. 双窗口 vs 环形缓冲：对比评估

### 8.1 双窗口方案的优势

1. **实现复杂度较低**
   - 当前代码已经具备；
   - 对现有 Studio/OPFS/seek/hover preview 改动较小。

2. **与关键帧/GOP 逻辑天然兼容**
   - 每次按窗口回退到关键帧；
   - 对 WebCodecs 的解码边界更清晰。

3. **适合编辑器的随机跳转**
   - 用户经常 seek、拖拽、hover；
   - 双窗口更容易把“当前操作上下文”定义清楚。

4. **内存成本可预测**
   - 只需要管当前窗口和下一窗口，不容易无限膨胀。

### 8.2 双窗口方案的劣势

1. **边界切换可见**
   - 这是当前流畅度问题的核心；
   - 切换仍然是事件而不是流水。

2. **对时序抖动敏感**
   - 一次 OPFS 慢读；
   - 一次 GC；
   - 一次主线程卡顿；
   - 都可能在窗口交界处暴露。

3. **缓存利用率有限**
   - 当前只有 current/next；
   - 无法形成持续的 segment 队列。

4. **对超长连续播放不够稳**
   - 视频越长，切窗次数越多；
   - 切窗越多，用户越容易感知顿挫。

### 8.3 环形缓冲方案的优势

这里的 ring buffer，不建议理解为“原始字节流无限环”，而应理解为：

> 以 GOP/segment 为单位维护固定容量的滚动缓冲池，播放头前方持续补充，播放头后方持续淘汰。

它的优势是：

1. **连续播放更平滑**
   - 消费与补充是滚动进行的；
   - 不需要明显的“窗口结束 -> 切换 -> 恢复”。

2. **抗抖动更强**
   - 只要 ring 中还有足够的 segment headroom；
   - 短时 I/O 波动不会立即变成卡顿。

3. **更接近成熟播放器/NLE 的长播模型**
   - 特别适合 10 分钟、30 分钟甚至更长视频的预览。

4. **更适合做多级水位**
   - 例如 read-ahead、decode-ahead、render queue 各自有独立阈值。

### 8.4 环形缓冲方案的劣势

1. **实现复杂度明显更高**
   - 需要 segment 生命周期管理；
   - 需要解决 GOP 边界、随机 seek、缓存失效；
   - 需要比当前更多的状态一致性控制。

2. **编辑器语义更难处理**
   - 当前项目不是纯播放器；
   - 还要兼顾 trim、crop、zoom、hover preview、seek 等操作。

3. **需要重构 current/next 模式**
   - 现在 Worker 只认识 `decodedFrames` 和 `nextDecoded`；
   - ring buffer 需要 segment queue 或 decode slots。

4. **如果实现不当，Bug 风险会高于当前双窗口**
   - 尤其是 seek 后旧 segment 污染、帧索引映射错乱、内存释放不及时等问题。

---

## 9. 本项目应不应该直接改成环形缓冲？

结论：**不建议“立即彻底替换”为纯环形缓冲；更建议“保留双窗口语义，逐步演进为 GOP 分段环形缓冲”。**

原因如下：

### 9.1 当前代码已经高度围绕“窗口”建模

Studio、Reader、Composite Worker 三层都围绕窗口工作：

- `windowStartIndex`
- `windowStartMs/windowEndMs`
- `onRequestWindow`
- `windowComplete`
- `appendWindow`

如果直接替换为全新 ring buffer，会影响：

- Studio 主页面的窗口管理；
- Composite Worker 的当前/下一窗口模型；
- hover preview 的状态恢复逻辑；
- trim/seek 的跨窗口定位逻辑。

### 9.2 当前项目是编辑器，不是纯播放器

编辑器里“任意跳转 + 局部预览 + 重新渲染当前帧”的比例很高。  
这类场景下，完全播放器化的 ring buffer 并不是银弹。

### 9.3 当前最大问题不是“双窗口思想本身”，而是“切换还不够滚动化”

也就是说，问题并不在于：

- “有两个窗口”本身错了；

而在于：

- 预取时机太晚；
- 切换边界太硬；
- 主线程拷贝太重；
- current/next 还没有演进成 segment queue。

---

## 10. 优化建议

以下建议按“短期可行 / 中期演进 / 长期目标”划分。

### 10.1 短期建议：保留双窗口，但把它做成“更早预取 + 更轻切换”

这是最小风险、最高性价比的方向。

#### 建议 A：把预取触发点前移

从当前的 `low/critical` 才触发，调整为：

- 在 `healthy` 阶段就开始下一段 I/O；
- `low` 阶段要求 decode-ahead 已基本完成；
- `critical` 仅作为兜底，不应是常态触发点。

**收益**：明显降低边界卡顿概率。  
**风险**：中低。  
**适配当前架构**：高。

#### 建议 B：减少主线程窗口切换期的数据复制

重点关注：

- `processVideo()` 中的整窗重新 map/copy；
- prefetch append 时的再次 `.slice(0)`；
- 非必要的 transferable 重建。

**收益**：降低 CPU 与 GC 抖动。  
**风险**：中。  
**适配当前架构**：高。

#### 建议 C：收敛逐帧/高频日志

建议把以下日志改为 dev flag 下采样输出：

- `displayFrame()` 的高频日志；
- timer/frame jump 日志；
- 高频预取日志。

**收益**：这是最容易被忽视、但可能立竿见影的平滑度改进点。  
**风险**：极低。  
**适配当前架构**：极高。

#### 建议 D：把连续播放窗口做长一点

对于长视频连续播放，可考虑：

- 当前窗口/预取窗口不再固定 90~140 帧；
- 按分辨率、码率、设备内存动态扩展到 5~8 秒级；
- 或至少在连续播放模式下比 seek/preview 模式更长。

**收益**：降低切窗频率，提高容错。  
**风险**：中，需要平衡内存。  
**适配当前架构**：高。

### 10.2 中期建议：从双窗口演进为“分段化双窗口”

推荐方案不是立刻上纯 ring，而是先把 `current/next` 进化为：

```text
current segment group + next segment queue
```

也就是：

- 当前播放仍以“当前窗口”概念暴露给 Studio；
- Worker 内部不再只持有一个 `nextDecoded`；
- 而是维护 2~N 个 GOP segment；
- 播放头跨 segment 时无需显式停播。

这是**双窗口语义不变、内部缓冲滚动化**的过渡方案。

**收益**：

- 对现有架构侵入更小；
- 能显著减少“windowComplete”式硬切；
- 逐步逼近 ring buffer。

### 10.3 长期建议：演进为 GOP 级环形缓冲

长期最佳实践建议是：

1. 以 **GOP / segment** 为最小缓冲单位，而不是“任意帧窗口”；
2. 建立固定容量的 segment ring；
3. 将流水线拆成：
   - OPFS read-ahead
   - decode-ahead
   - render queue
4. 让连续播放只消费 ring head；
5. seek/hover preview 则走独立的最小 GOP 快路径。

这条路线更接近成熟 NLE/播放器，但应在以下前提下推进：

- 当前双窗口先稳定；
- 监控指标先建立（切窗耗时、prefetch 命中率、解码空窗时长、掉帧数、主线程长任务）。

---

## 11. 推荐的演进路线

### 结论性建议

**推荐路线：**

> 短期保留双窗口方案，先解决“触发偏晚、主线程复制重、日志过多、窗口过短”问题；  
> 中期把 current/next 扩展为 GOP 分段队列；  
> 长期再演进为 GOP 级环形缓冲。

### 为什么不是“立刻改 ring buffer”

因为当前项目：

- 是编辑器，不是纯播放器；
- 已经有大量围绕 window 的状态机；
- 直接重构为 ring buffer，成本高、回归面大、风险高。

### 为什么又不能停留在现状

因为当前用户感知问题与实现形态高度一致：

- 播放不平滑；
- 边界卡顿；
- 长视频更明显；
- 预览交互仍有等待感。

这些问题单靠“再调几个阈值”很难彻底解决，必须让缓冲策略更滚动化。

---

## 12. 关键代码定位清单

如果后续继续做优化设计，建议优先复核以下位置：

### Studio 主页面

- 窗口计算：`packages/extension/src/routes/studio/+page.svelte:97-226`
- 主窗口请求：`packages/extension/src/routes/studio/+page.svelte:231-274`
- 预取数据请求：`packages/extension/src/routes/studio/+page.svelte:536-616`
- 单帧 GOP 请求：`packages/extension/src/routes/studio/+page.svelte:618-672`

### VideoPreviewComposite

- 预取状态定义：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:61-85`
- `bufferStatus` 处理与 prefetch 构建：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:431-558`
- `processVideo()`：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:691-935`
- `handleWindowComplete()`：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:1422-1511`
- `handleHoverPreview()`：`packages/extension/src/lib/components/VideoPreviewComposite.svelte:1570-1714`

### OPFS Reader Worker

- 索引全量读取：`packages/extension/src/lib/workers/opfs-reader-worker.ts:75-87`
- 关键帧摘要：`packages/extension/src/lib/workers/opfs-reader-worker.ts:98-193`
- `getRangeByTime/getWindowByTime`：`packages/extension/src/lib/workers/opfs-reader-worker.ts:306-393`
- `getRange`：`packages/extension/src/lib/workers/opfs-reader-worker.ts:395-458`
- `getSingleFrameGOP`：`packages/extension/src/lib/workers/opfs-reader-worker.ts:461-522`

### Composite Worker

- 缓冲与水位配置：`packages/extension/src/lib/workers/composite-worker/index.ts:34-60`
- 动态内存限制：`packages/extension/src/lib/workers/composite-worker/index.ts:62-129`
- 主窗口流式解码：`packages/extension/src/lib/workers/composite-worker/index.ts:1010-1206`
- 预取窗口解码：`packages/extension/src/lib/workers/composite-worker/index.ts:1208-1253`
- 播放循环与 windowComplete：`packages/extension/src/lib/workers/composite-worker/index.ts:1274-1431`
- `process` / `appendWindow` / `canReuse`：`packages/extension/src/lib/workers/composite-worker/index.ts:1448-1602`

---

## 13. 最终结论

### 结论 1

当前实现**确实属于双窗口方案**，并且已经具备一定的 read-ahead / decode-ahead 能力。

### 结论 2

它在“编辑器可用性”上是合理的，但在“长视频连续播放平滑度”上**还不属于行业最佳实践**。

### 结论 3

当前最影响用户观感的问题，不是 WebCodecs 或 OPFS 路线错误，而是：

- 切窗仍是硬边界；
- 预取偏晚；
- 主线程复制与日志负担偏重；
- 缓冲尚未滚动化。

### 结论 4

**最优策略不是马上推翻双窗口，而是将其逐步演进为 GOP 分段环形缓冲。**

这条路线既保留当前编辑器语义，又更有机会真正解决长视频预览卡顿与播放不平滑的问题。
