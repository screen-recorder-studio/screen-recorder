# Chrome 扩展高性能录屏：基于 WebCodecs 与 OPFS 的下一代架构设计

> **摘要**: 随着 Chrome Manifest V3 (MV3) 标准的推行以及 WebCodecs API 的成熟，浏览器端的视频处理能力迎来了质的飞跃。本文深入剖析 Screen Recorder Studio 如何突破 `MediaRecorder` 的内存瓶颈，利用 Offscreen Document 和 Origin Private File System (OPFS) 构建一套面向长时录制（受磁盘空间与设备性能限制）的全链路流式架构，并以 4K/60FPS 作为性能目标进行设计。

---

## 快速开始：源码与体验

*   **GitHub 源码**：访问 <https://github.com/screen-recorder-studio/screen-recorder>，欢迎加星支持。
*   **安装体验**：在 Chrome 应用市场搜索 **Screen Recorder Studio**，即可安装体验。

## 1. 演进动力：为何不再以 MediaRecorder 为主？

在 Web 前端开发中，`MediaRecorder` API 长期以来是处理媒体流的标准工具。它易于使用，只需几行代码即可将 `MediaStream` 录制为 WebM 文件。然而，在开发专业级屏幕录制扩展时，我们发现它存在两个无法忽视的架构缺陷：

### 1.1 内存黑洞 (OOM)
`MediaRecorder` 的工作机制倾向于在内存中缓冲数据。虽然可以通过 `timeslice` 参数获取数据块，但大多数浏览器实现仍会在内部维护较大的缓冲区。
*   **现象**：录制 4K 分辨率视频超过 20 分钟时，Tab 进程内存占用常突破 3GB。
*   **后果**：触发 Chrome 的 OOM (Out of Memory) 保护机制，导致页面崩溃（Aw, Snap!），用户录制的内容瞬间丢失且无法找回。

### 1.2 封闭的黑盒
`MediaRecorder` 输出的是封装好的容器格式（如 WebM）。
*   **索引与元信息写入时机不可控**：很多实现倾向于在录制结束时才补全容器索引（例如 Cues/Seek 信息），这会让“录制中实时预览/快速 Seek/崩溃后恢复”变得困难。
*   **GOP 不可控**：开发者无法精确控制关键帧间隔（GOP）。在视频编辑场景中，过大的 GOP 会导致 Seek 明显卡顿。

为了解决这些问题，我们需要一套**全链路流式（Fully Streaming）**且**数据透明**的架构。

---

## 2. 架构全景：MV3 多进程协作模型

在 Manifest V3 中，由于 Background Service Worker 无法长时间持有 DOM 和媒体流，我们将系统拆分为三个独立的执行环境，通过消息总线进行协同。

### 系统分层设计

1.  **控制层 (Background Service Worker)**
    *   **职责**：全局状态机、生命周期管理、用户意图分发。
    *   **特点**：短暂运行，不持有重资源。
2.  **采集层 (Offscreen Document)**
    *   **职责**：持有 `MediaStream`，提取原始视频帧 (`VideoFrame`)。
    *   **特点**：拥有完整的 DOM 环境，生命周期与录制状态绑定。
3.  **计算与存储层 (Dedicated Workers)**
    *   **职责**：WebCodecs 硬件编码、OPFS 磁盘写入。
    *   **特点**：高计算密度，不阻塞 UI 线程。

---

## 3. 核心组件详解

### 3.1 控制层：基于状态机的编排

Background 是整个系统的“指挥官”。它不直接接触媒体数据，而是通过维护一个状态机来管理录制流程。

```typescript
// src/extensions/background.ts（节选）
import { ensureOffscreenDocument, sendToOffscreen } from '../lib/utils/offscreen-manager'

async function startRecordingFlow(options) {
  await ensureOffscreenDocument({
    url: 'offscreen.html',
    reasons: ['DISPLAY_MEDIA', 'WORKERS', 'BLOBS'],
  })

  await sendToOffscreen({
    target: 'offscreen-doc',
    type: 'OFFSCREEN_START_RECORDING',
    payload: { options },
  })
}
```

### 3.2 采集层：从 Stream 到 Frame

在 `offscreen.html` 中，我们的主路径不再将流喂给 `MediaRecorder`。相反，我们使用 `MediaStreamTrackProcessor` 对流进行“解包”，直接获取底层的原始视频帧。

这种方式将我们从“文件录制”转变为“实时帧处理”，赋予了我们对画质的绝对控制权。

```typescript
// src/extensions/offscreen-main.ts（节选）

const processor = new (window as any).MediaStreamTrackProcessor({ track: videoTrack })
const reader: ReadableStreamDefaultReader<VideoFrame> = processor.readable.getReader()

const wcWorker = new Worker(new URL('../lib/workers/webcodecs-worker.ts', import.meta.url), {
  type: 'module',
})

while (true) {
  const { value: frame, done } = await reader.read()
  if (done) break

  wcWorker.postMessage({ type: 'encode', frame }, [frame])
}
```

### 3.3 计算层：WebCodecs 硬件编码

Worker 接收到 `VideoFrame` 后，利用 `VideoEncoder` API 进行编码，并尽可能走硬件加速路径（是否硬件加速取决于平台、驱动与所选编解码器）。

与 `MediaRecorder` 的黑盒不同，这里我们可以精确配置每一个参数：

```typescript
// src/lib/workers/webcodecs-worker.ts（节选）
import { tryConfigureBestEncoder } from '../utils/webcodecs-config'

await tryConfigureBestEncoder(encoder, {
  codec: config?.codec ?? 'auto',
  width: config?.width ?? 1920,
  height: config?.height ?? 1080,
  framerate: config?.framerate ?? 30,
  bitrate: config?.bitrate,
  latencyMode: config?.latencyMode,
  hardwareAcceleration: config?.hardwareAcceleration,
  bitrateMode: config?.bitrateMode,
})

encoder.encode(frame, { keyFrame: forceKey === true })
```

### 3.4 存储层：OPFS 同步写入

这是架构中防止 OOM 的最后一块拼图：编码后的数据块不在内存中聚合，而是增量写入 OPFS。

在实现上，我们把“写盘”放进 Dedicated Worker，通过 `FileSystemSyncAccessHandle` 获得同步追加写入能力，同时落盘一份索引（`index.jsonl`）用于后续导出/Seek/恢复：

```typescript
// src/lib/workers/opfs-writer-worker.ts（节选）

const root = await (self as any).navigator.storage.getDirectory()
const recDir = await root.getDirectoryHandle(`rec_${id}`, { create: true })

const dataHandle = await recDir.getFileHandle('data.bin', { create: true })
const sync = await (dataHandle as any).createSyncAccessHandle()

let offset = 0
const u8 = new Uint8Array(msg.buffer)
const start = offset
const written = sync.write(u8, { at: start })
offset += (typeof written === 'number' ? written : u8.byteLength)

await appendIndexLine(JSON.stringify({ offset: start, size: u8.byteLength, timestamp, type }) + '\n')
```

这种“数据文件 + 索引文件 + meta”的布局天然适配追加写入：即便录制过程中浏览器崩溃，也能保留已写入的 `data.bin`，并用 `index.jsonl` 重建时间线。

### 3.5 封装与导出：从“编码块”到可播放文件
需要特别强调：`EncodedVideoChunk` 本质是编码码流的“分片”，并不等同于最终的 WebM/MP4 文件。要得到可播放、可 Seek 的成品，还需要一个导出/封装（Muxing）阶段：

*   **录制阶段**：只做“采集 → 编码 → 追加写盘”，最大化稳定性与吞吐。
*   **导出阶段**：读取 `data.bin + index.jsonl + meta.json`，再封装成 WebM/MP4（项目中对应 `src/lib/workers/export-worker/strategies/*` 的策略实现）。

---

## 4. 架构收益：数据契约与稳定性

通过这套架构重构，Screen Recorder Studio 实现了以下核心技术指标：

1.  **内存占用平稳**：无论录制 10 分钟还是数小时，内存占用基本由少量处理缓冲区决定，峰值不再随时长线性增长。
2.  **崩溃保护**：数据以 Append-only 方式实时写入 OPFS，即使意外崩溃也能保留“已完成写入”的部分，并据索引恢复。
3.  **编辑友好**：关键帧策略与索引文件解耦于容器封装，让后续导出可以生成更“可编辑/可 Seek”的文件结构。

对于追求极致性能的 Web 多媒体应用，**Offscreen + WebCodecs + OPFS** 的组合不仅是 MV3 时代的最佳实践，更是突破浏览器沙箱限制的必经之路。

---

## 进一步了解

*   GitHub：<https://github.com/screen-recorder-studio/screen-recorder>
*   Chrome 应用市场：搜索 **Screen Recorder Studio**
