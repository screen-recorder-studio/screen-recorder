# GIF 录制意图：媒体所有权、Studio 与导出优化专项评估

## 1. 文档信息

- 文档状态：垂直切片实施决策稿 v1.0
- 评估日期：2026-08-23
- 当前基线：Screen Recorder Studio 0.6.12
- 上位切片：[“GIF录制 → 选择区域 → Studio”垂直切片评估](./GIF-AREA-RECORDING-VERTICAL-SLICE-EVALUATION.md)
- 产品定位：[面向落地页与 EDM 的营销动效资产工作台](./PRODUCT-POSITIONING-MARKETING-MOTION.md)
- 实施与验收结果：[GIF 区域录制垂直切片实施与端到端验收](./GIF-AREA-RECORDING-IMPLEMENTATION-AND-ACCEPTANCE.md)
- 评估范围：录制期间的媒体资源所有权、WebCodecs / Worker 离屏处理、Studio 的 GIF 上下文，以及最终 GIF 的正确性、内存和渠道优化

## 2. 执行结论

### 2.1 总体决策

建议继续推进，但将完成定义从“能导出 GIF”提升为：

```text
Action 选择 GIF录制
→ Area 捕获仍生成可编辑的视频母版
→ VideoFrame 所有权单向转移到编码 Worker
→ 编码块单向转移到 OPFS Writer
→ Studio 以 GIF delivery profile 打开
→ 同一编辑模型下完成循环、首帧和预算检查
→ 导出正确、可取消、内存有界、结果经过实际校验的 GIF
```

三项核心判断：

| 议题 | 决策 |
|---|---|
| 录制时是否直接编码 GIF | **No-go**。继续录制 WebCodecs 视频母版，GIF 只影响交付意图 |
| 是否使用 offscreen + Worker | **Go**。Offscreen Document 持有 capture 生命周期，Dedicated Worker 持有编码与 OPFS 写入 |
| Studio 是否切换成独立 GIF 编辑器 | **No-go**。保留同一编辑器，增加 `deliveryProfile`、默认格式和 GIF readiness UI |
| 当前 GIF 导出能否直接作为 EDM 成品 | **No-go**。能导出不等于时间正确、内存有界或满足 1 MB 预算 |
| 是否必须首版替换 `gif.js` | **有条件 No**。若首版限制在 Email Safe 边界，可先加正确性与资源门槛；通用长时、高分辨率 GIF 需要后续替换或扩展编码器 |

### 2.2 发布级优先级

**Must，随垂直切片交付：**

- 明确并测试 VideoFrame / ArrayBuffer 的单一所有者；
- producer-side 帧背压，不能只依赖 `VideoEncoder.encodeQueueSize`；
- 失败、暂停、丢帧、停止路径都显式释放资源；
- Studio 恢复 `intent=gif`，默认 GIF，但不改变普通录制；
- GIF 时间量化正确，不静默漏帧；
- GIF 导出前做内存和渠道预算预检，导出后校验真实文件；
- Email Safe 默认值、首帧预览和体积状态。

**Should，紧随首版：**

- 合并重复帧与静止区间；
- 自动选择 worker 数量，不再暴露为普通用户参数；
- 直接传递像素 buffer、移除临时 canvas；
- 按实际内容执行一次有界自动优化。

**Later：**

- 跨帧全局调色板；
- changed-rectangle / delta frame 编码；
- 真正增量输出、可写入 OPFS 的 WASM GIF 编码器；
- 更复杂的感知质量和运动分析。

## 3. 录制阶段：GIF 是意图，不是底层编码格式

### 3.1 继续保留视频母版

建议录制契约保持：

```ts
type RecordingMode = 'tab' | 'window' | 'screen' | 'area'
type RecordingIntent = 'video' | 'gif'

type AreaGifTask = {
  mode: 'area'
  source: 'tab'
  intent: 'gif'
}
```

`intent: 'gif'` 不应让录制器实时运行 GIF 量化器，原因是：

- GIF 的降帧、缩放、调色和循环需要在编辑完成后决定；
- 用户仍可能从同一母版导出 MP4 / WebM；
- 直接 GIF 录制会把暂停、恢复、OPFS、恢复和失败处理分叉成第二套系统；
- GIF 逐帧像素内存和 CPU 成本明显高于压缩视频母版；
- Studio 的 crop、zoom、背景、圆角、阴影和 trim 都需要可重复渲染的源时间轴。

GIF intent 可以影响产品提示、默认导出 profile 和软性时长建议，但首版不应降低母版帧率或破坏其可编辑性。区域裁剪已经在编码前减少像素，是这一阶段最有效的优化。

### 3.2 推荐离屏职责划分

```text
Service Worker
  └─ operation / permission / lifecycle orchestration

Offscreen Document                     capture owner
  ├─ MediaStream / MediaStreamTrack
  ├─ countdown + formal-frame boundary
  ├─ MediaStreamTrackProcessor reader
  ├─ area mapping / crop descriptor
  └─ producer credits
          │ transfer VideoFrame
          ▼
WebCodecs Dedicated Worker             frame + encoder owner
  ├─ crop / timestamp frame（或接收已裁剪帧）
  ├─ VideoEncoder
  └─ EncodedVideoChunk → ArrayBuffer
          │ transfer ArrayBuffer
          ▼
OPFS Writer Dedicated Worker           byte + file-handle owner
  ├─ SyncAccessHandle / writable
  ├─ data.bin
  ├─ index.jsonl
  └─ meta.json
```

Action popup、selector content script 和 Service Worker 都只传控制消息与小型 metadata，不持有 `MediaStream`、`VideoFrame`、像素数组或编码块。

Chrome 官方建议把逐帧 WebCodecs 工作放入 Worker；`VideoFrame` 本身可通过 transfer list 移动，或把来自 track 的 readable stream 转给 Worker。首版可保留当前 Offscreen Document 读帧和 warmup 边界，不必同时重构成“整个 readable stream 转移”，但帧转移契约必须补齐。

## 4. 媒体资源的“转移所有权”契约

### 4.1 规则

WebCodecs 规范定义 `VideoFrame` 为 transferable：成功转移后，媒体资源引用移动到接收端，发送端对象被关闭。`VideoEncoder.encode(frame)` 会克隆输入帧，因此 Worker 在调用 `encode()` 后即可关闭自己的 frame 引用。

工程上采用以下单向规则：

| 资源 | 初始所有者 | 转移点 | 转移后所有者 | 最终释放者 |
|---|---|---|---|---|
| `MediaStream` / track | Offscreen Document | 不跨 realm | Offscreen Document | stop / cancel / failure cleanup |
| Processor 输出的 source frame | Offscreen Document | 生成正式帧前 | Offscreen Document | pause/drop/error 时 offscreen 关闭 |
| 裁剪、重打时间戳后的 frame | Offscreen Document | `postMessage(..., [frame])` | WebCodecs Worker | Worker 在 `encode()` 后关闭 |
| `EncodedVideoChunk` | WebCodecs callback | `copyTo(ArrayBuffer)` | WebCodecs Worker | callback 返回后由 UA 管理 |
| chunk `ArrayBuffer` | WebCodecs Worker | transfer 到 offscreen，再 transfer 到 writer | OPFS Writer | 写入任务完成后自然释放 |
| OPFS handle | OPFS Writer | 不跨 realm | OPFS Writer | finalize / fatal error |

只有当前所有者可以读取、关闭或再次转移资源。控制层不得保存媒体对象引用用于重试。

### 4.2 推荐帧发送模式

```ts
function transferFrame(worker: Worker | null, frame: VideoFrame, message: object) {
  if (!worker) {
    frame.close()
    throw new Error('ENCODER_WORKER_UNAVAILABLE')
  }

  try {
    worker.postMessage({ ...message, frame }, [frame])
    // success: sender no longer owns frame
  } catch (error) {
    // failed transfer: sender still owns frame
    try { frame.close() } catch {}
    throw error
  }
}
```

不要使用无法区分“没有 Worker”与“已成功转移”的可选调用。禁止在成功 transfer 后继续访问尺寸、时间戳或调用业务逻辑。

### 4.3 当前实现已经做对的部分

当前正式帧路径已经接近该模型：

- offscreen 为正式帧创建 active-timeline `VideoFrame`；
- source frame 随后被关闭；
- active frame 使用 transfer list 发给 `webcodecs-worker`；
- Worker 调用 `encoder.encode()` 后关闭 frame；
- OPFS Writer 在独立 Worker 内串行写入。

这些能力应复用，不需要为 GIF intent 新建编码器。

### 4.4 当前必须补强的缺口

#### A. transfer 失败可能泄漏 frame

当前调用使用：

```ts
wcWorker?.postMessage({ type: 'encode', frame: activeTimelineFrame, keyFrame }, [activeTimelineFrame])
```

当 Worker 已为空或 `postMessage` 抛错时，`activeTimelineFrame` 没有明确关闭。Area / GIF 切片应改为具备失败所有权的 helper，并做故障注入测试。

#### B. Worker mailbox 没有 producer-side 上限

当前 `BACKPRESSURE_MAX = 8` 只检查 Worker 内部的 `encoder.encodeQueueSize`。它无法看到还排在 Worker message queue 中、尚未进入 `encodeFrame()` 的 VideoFrame。

建议采用两级信号，而不是把“Worker 已收到”误当成“Encoder 已有容量”：

```text
mailboxCredit = 2～3

offscreen transfer frame
→ mailboxCredit - 1
→ worker encode() + close()
→ FRAME_RELEASED(operationId, sequence)      所有权已释放
→ VideoEncoder dequeue / queue below watermark
→ ENCODER_CREDIT(operationId, count)         producer 才获得新额度
```

没有 credit 时按 cadence 明确丢弃并关闭 source frame，不能继续向 mailbox 堆积。Worker 自身仍保留 `encodeQueueSize` high-water 检查作为最后防线。Worker error、stop 或 generation 变化时必须清零 credit，并拒绝迟到 ACK / credit。

#### C. 编码块存在可避免的复制

当前 WebCodecs Worker 把 `EncodedVideoChunk` 复制到 `Uint8Array` 后，用普通 `postMessage` 发回 offscreen。应把 `data.buffer` 放入 transfer list；offscreen 收到后再把同一 buffer 转给 OPFS Writer。

这样仍需要一次 `EncodedVideoChunk.copyTo()`，但避免 Worker → offscreen 的结构化克隆。转移后 Worker 不得再读取该 buffer。

#### D. stop / complete 身份需要显式化

当前 stop 发消息后立即把本地 `wcWorker` 置空，旧 Worker 的 flush / complete 依赖隐式生命周期。新切片应给 Worker 绑定：

- `operationId`；
- `workerGeneration`；
- `STOP_REQUESTED → ENCODER_FLUSHED → WRITER_FINALIZED` ACK；
- 迟到 chunk / complete 丢弃规则。

只有收到当前 generation 的 `ENCODER_FLUSHED` 后才进入 writer finalize。新录制不得复用旧 Worker 的回调状态。

#### E. 存储过载不能丢最旧 chunk

当前 OPFS pending queue 满时存在“丢弃最旧 chunk”的分支。对视频码流来说，任意缺失块都可能破坏 GOP 或时间轴。发布切片必须 fail-closed：暂停 producer、停止录制或报告存储失败，不能静默生成损坏母版。

### 4.5 Area crop 放在哪里

首版有两个可接受实现：

1. offscreen 根据第一帧解析 crop，构造裁剪后的 `VideoFrame` 再 transfer；
2. offscreen transfer source frame 与已验证的 pixel crop，Worker 构造裁剪帧、关闭 source，再编码。

推荐先采用 1，因为它最少改变当前 warmup / formal lane；`VideoFrame` 的 `visibleRect` 路径通常只创建新的媒体资源引用，不等同于把整帧转成 `ImageData`。若性能分析显示 offscreen frame handler 成为瓶颈，再把 crop 移入 Worker。

无论放在哪里，都禁止 `CanvasRenderingContext2D.getImageData()` 出现在录制热路径中。

## 5. Studio：需要 GIF 上下文，不需要第二套编辑器

### 5.1 决策

Studio 需要调整，但不应实现 `editorMode = 'gif'` 的平行编辑系统。

建议模型：

```ts
type DeliveryProfile =
  | { kind: 'generic-video' }
  | { kind: 'email-gif'; budgetBytes: 1_000_000 }
```

同一份 edit graph 继续负责：

- trim；
- crop；
- zoom / focus；
- background、padding、radius、shadow；
- preview 和时间轴；
- MP4 / WebM / GIF 多格式导出。

GIF profile 只改变交付默认、预览方式、预算提示和导出 guardrail，不改变源数据结构或合成算法。

### 5.2 intent 的来源与恢复

优先级建议：

```text
OPFS meta.capture.intent
  > studio URL intent（首次 handoff hint）
  > generic-video default
```

- Background 首次打开：`studio.html?id=<id>&intent=gif`；
- Studio 加载后从 OPFS meta 恢复，并与 recording id 绑定；
- 从 Drive 切换 recording 时重新解析该 recording 的 intent；
- URL 不能让另一个普通 recording 错误继承 GIF profile；
- 普通 Tab / Window / Screen 录制继续默认 MP4。

### 5.3 Studio MVP 必须调整

| 调整 | 目的 |
|---|---|
| 标题区显示“GIF / Email”profile chip | 让用户知道当前交付目标，而不是误以为母版就是 GIF |
| 导出按钮文案优先“导出 GIF” | 缩短任务路径，同时保留格式切换 |
| `preferredFormat="gif"` | 只改变当前 recording 的导出默认 |
| 循环预览 | 用户需要看首尾衔接，而普通视频预览默认不表达循环 |
| 第一帧独立预览 | 某些邮件客户端只显示第一帧，必须验证信息仍可读 |
| 当前 trim 后时长、预计帧数、预计体积 | 在编辑阶段而不是导出结束后暴露预算 |
| Email Safe 状态 | 明确显示“预算内 / 超出 / 需优化”，不要只给编码参数 |

第一帧预览不一定需要新的“封面帧”数据结构。MVP 可把 trim 后的第一帧作为 fallback；若用户需要另选 poster，再增加显式 `posterTimeMs`。

### 5.4 首版不需要的 Studio 变化

- 不需要新的 `/gif-studio` 路由；
- 不需要把 OPFS 母版转成逐帧图片；
- 不需要隐藏 MP4 / WebM；
- 不需要复制一套 crop、trim 或 preview store；
- 不需要打开 Studio 后自动弹出导出框；
- 不需要在每次编辑变化时实时编码完整 GIF。

可在编辑变化时更新廉价估算和 readiness；真实编码只在用户确认导出或执行明确的“优化到预算”时发生。

## 6. 当前 GIF 导出链路评估

### 6.1 当前路径

```text
OPFS Reader windows
→ Export Worker / Composite Worker 解码与编辑合成
→ OffscreenCanvas
→ getImageData
→ Export Worker postMessage ImageData
→ Studio main-thread GifEncoder
→ gif.js 保存 frames
→ gif.js worker pool 逐帧量化 / LZW
→ Blob
```

已有优点：

- OPFS 按窗口读取，不一次加载全部压缩视频；
- 复用同一 composite worker，GIF 能继承 trim / crop / zoom / background；
- 每发送一帧等待 ACK，限制了 export worker 侧的临时帧；
- 支持取消、进度、质量、fps、scale、repeat 和 dither；
- 已有基于实际样本的体积区间估算。

### 6.2 “流式 GIF”当前不是端到端流式

当前注释声称内存从 `O(N × 帧大小)` 降为 `O(帧大小)`，这只对 OPFS decode / composite 侧成立。

`GifEncoder.addFrame()` 会为每帧创建 canvas，随后用 `copy: true` 把像素交给 `gif.js`；`gif.js` 把所有 frame data 保存在 `frames[]`，直到调用 `render()` 才分发给自己的 worker pool。因此 Studio realm 的峰值仍近似：

```text
raw RGBA lower bound = width × height × 4 × frameCount
```

示例：

- 600 × 338、6 秒、10 fps：仅 RGBA 下限约 46 MiB；
- 1440 × 810、78 帧：仅 RGBA 下限约 347 MiB；
- 还未计算结构化克隆、canvas、worker job 和最终 Blob。

所以当前实现可在受限 Email Safe profile 下继续使用，但不能宣称支持任意长时、高分辨率 GIF 的有界内存导出。

## 7. GIF 发布前必须完成的正确性优化

### 7.1 帧延迟必须按 GIF 的 1/100 秒量化

GIF89a 的 delay 单位是 1/100 秒。当前 UI 允许 30 fps，代码把每帧 `33.33 ms` 交给 `gif.js`，后者对每帧独立四舍五入到 3 个 centisecond，即 30 ms。长片段会产生累计时长漂移。

不能简单把所有帧设成同一个 round 后 delay。应使用累计误差分配：

```text
target cumulative time
→ quantize cumulative time to centiseconds
→ current delay = quantized cumulative - previous quantized cumulative
```

例如 30 fps 可生成 3 / 3 / 4 centisecond 的节奏，而不是所有帧都为 3。最终 GIF 总时长与 Studio trim 后时长误差应不超过 10 ms 或一个 GIF tick。

### 7.2 单帧失败不能 catch 后继续成功

当前 memory / OPFS GIF loop 对单帧异常记录日志后继续。最终文件可能缺帧、缩短或跳动，却仍返回 success。

改为：

- decode / composite / transfer / add-frame 任一失败默认终止导出；
- 错误包含 `operationId`、stage 和 frame index，不含页面隐私数据；
- 只有明确设计的“可跳过重复帧”才能减少 frame count；
- 取消与失败必须区分。

### 7.3 输出必须做实际校验

完成 Blob 后至少解析并核对：

- `GIF89a` / `GIF87a` header；
- width / height；
- frame count；
- 总 duration；
- repeat count；
- Blob size；
- 第一帧可以解码；
- 导出的首帧和末帧来自正确 trim 范围。

估算只能服务决策，最终体积状态必须使用真实 Blob 大小。

### 7.4 timeout 必须可取消并清理

当前 per-frame / init / render Promise 创建 timeout 后，成功路径没有清除 timer。应统一使用 request registry：

- resolve / reject / cancel 都清除 timer 与 listener；
- 同一 export generation 只有一个 init 和 render request；
- cancel 后不接受迟到 `gif-frame-added` 或 `gif-encode-complete`；
- 组件销毁后不更新 UI。

## 8. GIF 内存与吞吐优化

### 8.1 首版即可完成

#### 直接传 ImageData

`gif.js` 本身接受 `ImageData`。当前 `GifEncoder.addFrame()` 没必要为每帧创建 DOM canvas、`putImageData()`，再让 `gif.js` 取回像素。可直接传 `ImageData` 或其像素数据。

#### 转移像素 buffer

Export Worker → Studio 的 `gif-add-frame` 应验证并使用 transferable pixel buffer，避免结构化克隆整帧。发送成功后 Export Worker 不得继续读取该 `ImageData`。

这不会消除 `gif.js frames[]` 的保留成本，但能减少一次跨 realm 复制。

#### 自动 worker 数

`workers` 是实现参数，不是营销用户的质量参数。建议默认：

```text
max(1, min(4, hardwareConcurrency - 1))
```

再由内存预算降低并发。隐藏 1 / 2 / 4 / 8 选择，避免用户用更多 worker 换来更高峰值内存，却误以为质量更好。

#### 导出前内存门槛

使用 `width × height × 4 × frames` 作为下限，加上安全系数做 preflight：

- Email Safe profile 在保守设备上应保持可执行；
- 超过预算先建议 trim / width / fps；
- 明显不安全时拒绝开始，而不是浏览器崩溃后报通用错误；
- 记录 estimated peak、actual duration、frame count 和 outcome。

### 8.2 高收益的帧优化

#### 合并相同 source frame

当前 presentation schedule 可能让多个目标 GIF 时间点指向同一个 source frame。GIF 不需要重复写入相同画面，可把相邻相同 `sourceFrameIndex` 合并，累计 delay。

这是无损、低风险的首选优化，尤其适合网页 UI 的静止停留。

#### 合并视觉相同帧

即使 source index 不同，合成结果也可能完全相同。可以计算 tile hash 或受控像素 diff；相同则延长上一帧 delay，不加入新帧。近似去重应放在实验 flag 下，避免丢掉细小光标或文本变化。

#### 首尾静止段

不要重复编码几十个相同帧。首尾 hold 应编码为一个 frame + 较长 delay。Studio 可显示“删除静止等待”或“保留首尾停留”的显式选择。

### 8.3 需要新编码能力的优化

当前 `gif.js` 基本以完整画布、逐帧 palette 编码。若产品承诺把复杂 UI 动画稳定压进 1 MB，还需要评估：

- 从代表帧计算全局 palette，减少色彩跳动；
- 对 UI 默认关闭 dither，避免噪声增加 LZW 负担；
- 只编码 changed rectangle；
- 合理的 disposal method；
- 可配置颜色数，而不是固定 256 色；
- 增量输出到 OPFS，而不是最终一次生成大 Blob。

这些能力更适合维护活跃的 WASM / native-derived encoder。不要在 Area 首版里直接魔改压缩后的 `gif.js` bundle。

## 9. 面向 EDM 的优化策略

### 9.1 默认 profile

建议“GIF录制”进入 Studio 后默认使用 Email Safe：

| 项目 | 默认 | 行为 |
|---|---:|---|
| 输出宽度 | 最大 600 px | 使用绝对输出宽度，不用难理解的 75% scale |
| 时长 | 3～6 秒 | 超过 6 秒提示，超过 10 秒强警告 |
| 帧率 | 8～10 fps | UI 操作优先，避免把 30 fps 当作质量默认 |
| 循环 | 2～3 次 | 不默认无限循环 |
| 体积目标 | ≤ 1 MB | 绿色通过；超出时给出优化动作 |
| 第一帧 | 独立可读 | 预览只显示第一帧的客户端表现 |
| 回退资产 | PNG | 与 GIF 一起生成或显式勾选 |
| dither | UI 默认关闭 | 照片 / 渐变时再建议开启 |

Mailchimp 的邮件模板通常以 600 px 为最大宽度，并建议图片最大 1 MB；Campaign Monitor 同样建议 GIF 尽量低于 1 MB，并提醒部分 Outlook 只显示第一帧。这里应作为产品预算，而不是写在帮助文档里。

### 9.2 一键优化顺序

为了避免“质量”滑块盲目降级，按对用户价值影响从低到高处理：

```text
1. 合并相同 source / pixel frames
2. 删除无内容的首尾静止段（需用户确认）
3. 把 10 fps 降到 8 / 6 fps
4. 把宽度从 600 降到 540 / 480 px
5. 调整 palette / colors / dither
6. 建议进一步 trim 或拆成两个 GIF
```

`gif.js quality` 实际上主要控制 NeuQuant 的采样间隔，不应被包装成“把文件压到 1 MB”的主要手段。像素数、帧数、画面变化和 palette 策略影响更直接。

### 9.3 预算不能承诺绝对成功

“优化到 1 MB”应是 budget-seeking：

- 在最小可读宽度、最低可接受 fps 和用户 trim 范围内自动寻找；
- 如果仍超过 1 MB，明确告诉用户差多少；
- 提供“继续导出大文件”或“返回裁短”，不无限循环重编码；
- 不静默把文字缩到不可读或删除重要帧。

Landing Page 不应复用 Email Safe GIF 为默认成品。Landing profile 仍应推荐 WebM + MP4 + poster，GIF 只做兼容预览。

## 10. 推荐实施切片

### Slice R：录制所有权硬化

- frame transfer helper；
- operation / worker generation；
- producer credits + `FRAME_CONSUMED`；
- chunk buffer transfer；
- stop / flush / finalize ACK；
- OPFS overflow fail-closed；
- ownership 和故障注入测试。

该阶段应与 Area crop 同步完成，否则新增裁剪 frame 会放大现有所有权缺口。

### Slice S：Studio GIF delivery profile

- OPFS meta intent + URL hint；
- recording-scoped preferred format；
- GIF / Email chip；
- 循环预览；
- 第一帧预览；
- duration / frames / budget readiness；
- Drive 切换和普通录制回归。

### Slice E1：GIF 正确性与有界首版

- centisecond duration quantizer；
- fail-fast frame pipeline；
- cancellable request registry；
- direct ImageData + pixel transfer；
- dynamic worker count；
- preflight memory cap；
- actual Blob validation；
- Email Safe preset。

完成 R + S + E1 后，才可把“GIF录制”作为公开任务入口。

### Slice E2：Email budget optimizer

- repeated source frame collapse；
- exact pixel-frame dedupe；
- sample-based size forecast；
- one-click bounded search；
- fallback PNG；
- 真实 EDM 任务集回归。

若 E1 后多数真实任务仍无法接近 1 MB，再进入 palette / changed rectangle / encoder replacement，不应提前扩大底层重写。

## 11. 验收门槛

### 11.1 录制与所有权

- 每个 source / cropped `VideoFrame` 在每条路径只有一个最终 owner；
- transfer 失败、Worker 缺失、pause、cadence drop、stop 都能证明 frame 被关闭；
- transfer 成功后发送端不再读取或关闭该 frame；
- 未确认的 mailbox frame 始终不超过 credit 上限，encoder queue 始终不超过 high-water；
- Worker mailbox 不随录制时长线性增长；
- chunk buffer 从 encoder 到 writer 不发生额外结构化克隆；
- stop 后只接受当前 operation / generation 的 flush 和 finalize；
- 任何存储过载都不产生缺 chunk 的“成功”录制。

### 11.2 Studio

- GIF intent recording 打开后默认 GIF；
- 普通 recording 仍默认 MP4；
- Drive 切换不会继承前一 recording 的 intent；
- loop preview 与实际 repeat 设置一致；
- 第一帧预览与最终 GIF 第一帧一致；
- trim、crop、zoom、background、radius、padding、shadow 的预览与 GIF 导出一致。

### 11.3 GIF 导出

- 5 / 10 / 15 / 20 / 25 / 30 fps 的总时长误差不超过一个 centisecond；
- 任一帧处理失败时导出失败，不返回缺帧 success；
- cancel 后 Worker、timer、listener、encoder 都被释放；
- `[E2]` 静止 6 秒录制不会生成 60 个相同 GIF frame；
- preflight 拒绝已知不安全的内存计划；
- 实际 Blob 的尺寸、帧数、duration、repeat、首帧均通过校验；
- Email Safe profile 使用真实文件大小判断是否通过 1 MB 预算；
- 在 10～20 个真实 SaaS UI 任务上记录首次通过率、优化后通过率和视觉可读性。

## 12. 工作量影响

在原 Area 垂直切片之外，建议按以下增量估算：

| 工作 | 粗略增量 |
|---|---:|
| 录制所有权、背压、chunk transfer 与 lifecycle 测试 | 2～4 个工程日 |
| Studio delivery profile、循环与首帧 readiness | 2～3 个工程日 |
| GIF 时间正确性、失败语义、内存 guardrail、文件校验 | 3～5 个工程日 |
| 重复帧优化与首轮 Email budget optimizer | 4～7 个工程日 |
| palette / changed rectangle / 新编码器 | 另立项目，约 8～15+ 个工程日 |

因此：

- **仅“进入 Studio 并默认 GIF”不应视为可发布完成；**
- **R + S + E1 是公开入口的最小发布面；**
- **E2 决定产品能否从“支持 GIF”升级到“适合 EDM”。**

## 13. 关键源码

- Offscreen 录制主干：[offscreen-main.ts](../packages/extension/src/extensions/offscreen-main.ts)
- WebCodecs 编码 Worker：[webcodecs-worker.ts](../packages/extension/src/lib/workers/webcodecs-worker.ts)
- OPFS Writer：[opfs-writer-worker.ts](../packages/extension/src/lib/workers/opfs-writer-worker.ts)
- Studio：[studio/+page.svelte](../packages/extension/src/routes/studio/+page.svelte)
- Studio 合成预览：[VideoPreviewComposite.svelte](../packages/extension/src/lib/components/VideoPreviewComposite.svelte)
- 导出面板：[VideoExportPanel.svelte](../packages/extension/src/lib/components/VideoExportPanel.svelte)
- 统一导出对话框：[UnifiedExportDialog.svelte](../packages/extension/src/lib/components/UnifiedExportDialog.svelte)
- Export Manager：[export-manager.ts](../packages/extension/src/lib/services/export-manager.ts)
- GIF service：[gif-encoder.ts](../packages/extension/src/lib/services/gif-encoder.ts)
- GIF export path：[export-worker/index.ts](../packages/extension/src/lib/workers/export-worker/index.ts)
- GIF strategy：[strategies/gif.ts](../packages/extension/src/lib/workers/export-worker/strategies/gif.ts)
- GIF 体积估算：[gif-export-estimate.ts](../packages/extension/src/lib/export/gif-export-estimate.ts)
- 时间轴调度：[recording-timeline.ts](../packages/extension/src/lib/recording/recording-timeline.ts)

## 14. 外部资料

以下资料均于 2026-08-23 访问：

- [W3C WebCodecs：Memory Model、Transfer 与 VideoEncoder](https://www.w3.org/TR/webcodecs/)
- [Chrome Developers：Video processing with WebCodecs](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)
- [GIF89a Specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)
- [Mailchimp：About Template Images](https://mailchimp.com/help/about-template-images/)
- [Campaign Monitor：Optimize GIFs in Email](https://www.campaignmonitor.com/resources/knowledge-base/how-do-you-optimize-and-embed-gifs-in-an-email/)
