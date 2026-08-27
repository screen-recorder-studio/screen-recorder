# GIF 区域录制垂直切片：实施与端到端验收报告

## 1. 文档信息

- 文档状态：已实施、已验收 v1.1
- 实施与验收日期：2026-08-28
- 工程基线：Screen Recorder Studio 0.6.12
- 对应产品决策：[面向落地页与 EDM 的营销动效资产工作台](./PRODUCT-POSITIONING-MARKETING-MOTION.md)
- 历史链路评估：[Element / Area 历史录制链路端到端评估](./ELEMENT-AREA-RECORDING-E2E-EVALUATION.md)
- 切片设计：[“GIF录制 → 选择区域 → Studio”垂直切片评估](./GIF-AREA-RECORDING-VERTICAL-SLICE-EVALUATION.md)
- 媒体专项：[GIF 录制意图的所有权、Studio 与导出优化评估](./GIF-MEDIA-PIPELINE-STUDIO-EXPORT-EVALUATION.md)

## 2. 最终结论

本轮垂直切片已经达到业务闭环：

    Action：Record GIF / GIF录制
    → 当前页面选择区域
    → 倒计时期间清除选择 UI
    → Tab stream + 帧级真实裁剪
    → WebCodecs Worker 编码
    → 与视频录制相同的 OPFS
    → 自动进入当前 Studio
    → Studio 识别 GIF delivery intent
    → 默认 GIF 导出
    → 严格校验后的 GIF89a 文件

关键决策保持成立：

1. GIF 是用户任务与交付意图，不是新的底层录制编码格式；
2. 录制阶段继续生成可编辑的视频母版，并写入现有 OPFS；
3. Studio 不分叉为第二套 GIF 编辑器，只增加 GIF 上下文、默认值和交付约束；
4. Area 在当前 action → background → offscreen → worker → OPFS 主干上重建，没有复活旧 Element / Area 第二套管线；
5. 最终 GIF 已通过结构、时间、内容差异和浏览器实际播放四类验证。

## 3. 本轮交付范围

### 3.1 已完成

| 范围 | 结果 |
|---|---|
| Action 入口 | 增加 Record GIF / GIF录制任务入口 |
| 区域选择 | Shadow DOM 选择器，支持拖拽、确认、取消、倒计时 |
| 会话状态 | 增加 selecting 阶段、area mode、gif intent 和 operationId |
| 持久上下文 | 使用 chrome.storage.session 保存目标 Tab、Document、选区和倒计时 |
| 捕获 | Area 复用 tabCapture，不恢复旧页面 canvas 捕获 |
| 裁剪 | Offscreen 在构造正式 VideoFrame 时使用 visibleRect 做真实裁剪 |
| 坐标 | 支持视口与固定比例 Tab capture 之间的居中等比映射 |
| 所有权 | VideoFrame 单向转移给 WebCodecs Worker；编码数据以 ArrayBuffer 转移 |
| 存储 | 继续使用当前 OPFS writer、metadata 和录制列表 |
| Studio | 自动打开指定 recording，并识别 GIF delivery profile |
| GIF 默认值 | 10 fps、邮件宽度不超过 600 px 的缩放档、repeat metadata 2 |
| 导出正确性 | 百分之一秒时间量化、内存预检、失败即失败、尾部零填充清理、结构校验 |
| 专用 Lab | 8 类确定性场景、机器契约、动态门禁与静态基准提示 |
| 自动化测试 | 单元、组件/模型、完整扩展构建与浏览器 E2E |

### 3.2 明确未纳入

- Element Capture；
- 跨 frame 元素语义跟随；
- 页面滚动后自动重新锚定已选区域；
- GIF 全局调色板、脏矩形编码和目标字节数搜索；
- Landing Page 的 WebM + MP4 + poster 成品包；
- 云上传、分享链接与分析。

## 4. 实际架构

### 4.1 控制面

    popup/+page.svelte
      REQUEST_GIF_AREA_SELECTION
        background.ts
          recordingCoordinator.requestSelection(area, gif)
          chrome.storage.session 写入 AreaRecordingContext
          chrome.scripting.executeScript 注入 area-selector.js
            area-selector.ts
              AREA_SELECTION_CONFIRMED / CANCELLED

AreaRecordingContext 保存：

- version；
- operationId；
- targetTabId；
- targetDocumentId；
- mode = area；
- intent = gif；
- countdown；
- rectCss；
- viewportCss；
- devicePixelRatio；
- selectedAt / createdAt / updatedAt。

background 在确认、取消、页面切换和异常路径上核对 operationId、Tab 与顶层 Document。上下文不匹配时失败关闭，不会把旧选区错误应用到新页面。

### 4.2 媒体面

    background.ts
      startRecordingViaOffscreen({ mode: area, intent: gif, areaSelection })
        offscreen-main.ts
          chrome.tabCapture stream
          MediaStreamTrackProcessor
          选择倒计时 warm-up lane
          正式 processor lane
          CSS 选区 → source frame rect
          new VideoFrame(source, { visibleRect, displayWidth, displayHeight })
          transferFrameToEncoderWorker
            webcodecs-worker.ts
              VideoEncoder
              EncodedVideoChunk → ArrayBuffer
                opfs-writer-worker.ts
                  现有 OPFS recording

倒计时期间和正式录制使用不同的 processor reader。这样选择框最后一帧不会残留在正式 OPFS 数据中。

### 4.3 Studio 与交付面

    OPFS recording metadata
      intent = gif
      capture.mode = area
      capture.source = tab
      capture.mappingVersion = 2
      requestedRectCss
      viewportCss
      actualRectPx
      sourceFrameSize
        studio.html?id=recordingId&intent=gif
          resolveStudioDeliveryProfile
          GIF delivery chip
          UnifiedExportDialog 默认 GIF
            export-worker
            gif-encoder
            validateGifBlob

metadata 是主事实源，URL intent 是兼容回退。刷新 Studio 或从录制列表再次打开时，GIF 上下文仍可恢复。

## 5. 区域坐标与裁剪

### 5.1 发现的问题

Tab capture 的 source frame 可能是固定 16:9，而页面 viewport 不是相同比例。若分别使用 X/Y 比例映射，会把选区拉伸，并在边缘包含用户没有选择的像素。

### 5.2 当前映射

当前算法使用居中、等比的 content box：

1. scale = min(sourceWidth / viewportWidth, sourceHeight / viewportHeight)；
2. 计算 source frame 中实际页面内容的宽高；
3. 计算左右或上下居中偏移；
4. 把 CSS rect 映射到 content box；
5. 左上边界向内向上取偶数，右下边界向内向下取偶数；
6. 映射无效或小于最小边长时失败。

该策略的目标是“绝不泄露选区外像素”，即使因此收缩最多一个对齐像素。

### 5.3 生命周期保护

- 首帧确定 sourceFrameSize 和 actualRectPx；
- 后续 frame 尺寸变化时抛出 AREA_SOURCE_SIZE_CHANGED；
- Area crop 未初始化时抛出 AREA_CROP_UNAVAILABLE；
- 选区、视口或尺寸数据损坏时拒绝启动。

## 6. 媒体所有权

### 6.1 VideoFrame

- Offscreen 在收到源帧后拥有它；
- Area 模式先构造带 visibleRect 的新 VideoFrame；
- 原始 frame 随即 close；
- 新 frame 通过 transferable 单向转移给编码 Worker；
- postMessage 同步失败时，由发送方 close；
- 成功转移后，发送方不再访问该 frame；
- wcFramesInFlight 提供有界背压，超过上限的帧立即 close。

### 6.2 编码数据

- WebCodecs Worker 将 EncodedVideoChunk 拷贝到独立 ArrayBuffer；
- ArrayBuffer 转移给 OPFS writer；
- writer 成为唯一数据所有者；
- stop/finalize 等待编码与写入收尾，不以 popup 生命周期为准。

该模型消除了“同一媒体对象由多个上下文隐式共享”的歧义。

## 7. OPFS 决策

GIF 任务没有新建 GIF 专用录制目录，也没有在录制阶段保存 GIF 帧集合。

仍然保存：

- 编码后的视频母版；
- 帧索引与时间；
- source width / height / fps / codec；
- capture 与 intent metadata。

收益：

- 录制期间内存不随 GIF 帧数线性增长；
- Studio 的 trim、crop、background、zoom 继续复用；
- 用户可反复调整 GIF 参数和再次导出；
- 同一母版也可以导出 MP4 / WebM；
- Recordings 页面无需维护第二种资产模型。

## 8. Studio 的 GIF 模式

Studio 没有切换成独立编辑器。当前变化是“交付上下文”：

- 顶部显示 GIF delivery；
- GIF intent 默认使用 Original frame，直接保留录制比例，不叠加背景、padding、圆角或阴影；
- Original frame / Styled canvas 是可逆的显式模式，切换回原始画面时会同步恢复 source composition size；
- 导出对话框默认选择 GIF；
- 默认帧率为 10 fps；
- 输出尺寸以 Original、Email width 600px、Compact 480px、Small 320px 命名，并保证标注宽度与产物像素一致；
- 默认 repeat metadata 为 2，对用户显示为总共播放 3 次；
- 帧率、输出尺寸和循环是主要设置，调色精度与抖动收纳在 Advanced color settings；Worker 数量由实现自动管理；
- 继续允许用户使用同一套裁剪、trim、背景、圆角、阴影和 zoom。

这是最小但完整的产品闭环：用户从 GIF录制 进入后，不需要再次猜测导出格式。

## 9. GIF 导出正确性与优化

### 9.1 时间

GIF89a 的帧延迟单位是 1/100 秒。当前 schedule：

- 先合并连续引用同一 source frame 的区间；
- 对累计时间做 10 ms 量化；
- 通过累计误差补偿，避免逐帧四舍五入造成长片漂移；
- 每帧最小延迟 10 ms；
- 校验导出总延迟。

### 9.2 内存

gif.js 会在 render 前保留 RGBA 帧。导出前使用：

    width × height × 4 × frameCount

估算保留帧内存，默认预算为 384 MiB。无效计划或超过预算时在编码前失败，而不是等待浏览器 OOM。

### 9.3 数据传递

- compositing 后直接传 ImageData；
- 避免为同一帧额外创建中间 canvas/bitmap；
- Worker 数量保持为自动实现细节，避免把并发调参责任转给普通用户；
- 600/480/320px 结果档会显著降低每帧 RGBA 体积，并避免百分比档位产生 319px 等标注/产物偏差。

### 9.4 输出验证

导出完成后必须满足：

- Blob 存在且长度有效；
- signature 为 GIF87a 或 GIF89a；
- 最后一个逻辑字节是 GIF trailer 0x3B；
- gif.js 4 KiB page 末尾的零填充会被安全裁掉；
- 任何单帧或 Worker 失败都会使整个导出失败。

## 10. 专用 GIF Lab

入口：

    pnpm lab:gif

位置：

    packages/extension/test-pages/gif-lab

### 10.1 场景

| 场景 | 运动契约 | 用途 |
|---|---|---|
| cadence | animated | 默认全链路门禁；计数器、闪烁、条码、匀速运动 |
| geometry | static | 选区边缘、四角标记、偶数尺寸和裁剪精度 |
| static-hold | mixed | 两次变化后长静止，验证重复帧与 delay |
| suite | mixed | 多章节综合回归 |
| palette | static | 渐变、细字、调色板和高频细节 |
| edit-motion | animated | trim、crop、zoom 的预览/导出一致性 |
| lifecycle | static | 取消、重选、滚动、缩放和 viewport 变化 |
| edm | animated | 首帧信息完整的营销卡片与短循环 |

### 10.2 防误判设计

本轮曾观察到 Studio 和 GIF “静止”。根因不是录制冻结，而是使用了 geometry：

- scene-model 只让 cadence、edit-motion、edm 持续动画；
- geometry 的目标就是固定四角与网格；
- 页面外的 Running 文案会变化，但选中的 target 本身保持不变。

为防止再次误判，Lab 已改为：

- 无 case 参数时默认 cadence；
- cadence 明示 MOTION REQUIRED；
- geometry 明示 STATIC BY DESIGN；
- contract.expected.motion 暴露 expectation、fullFlowEligible、sampleIntervalMs 和 minimumDistinctVisualKeys；
- 非 animated 场景的协议明确提示“仅做专项 fixture，运动验收请用 cadence”。

## 11. TDD 与自动化结果

### 11.1 重点测试

- recording-session：selecting / recording / finalizing 状态转换；
- recording-coordinator：并发请求、取消、错误与恢复；
- recording-popup-model：Record GIF 入口与禁用状态；
- area-recording-context：session storage 校验与 fail-closed；
- area-crop：视口、source frame、居中 content box 和偶数内缩；
- recording-frame-transfer：成功转移和 post 失败 close；
- gif-frame-schedule：累计时间量化与重复 source frame 合并；
- gif-export-preflight：内存预算、输出签名、trailer 与零填充；
- gif-artifact-inspector：帧数、delay、repeat 和物理/逻辑长度；
- gif-delivery-defaults：10 fps、600 px 邮件宽度和 repeat；
- delivery-profile：metadata 优先、URL 回退；
- GIF Lab contract / scene-model：静态、动态和确定性 visualKey。

### 11.2 完整结果

| 检查 | 结果 |
|---|---|
| Vitest | 80 个测试文件通过 |
| 测试数量 | 416 / 416 通过 |
| svelte-check | 0 errors |
| 既有 warnings | 18，集中在 4 个既有 Svelte 文件 |
| GIF Lab production build | 通过 |
| Extension build:extension | 通过 |
| Release logging policy | 97 个 JavaScript bundles 通过 |

## 12. 浏览器端到端验收

### 12.0 2026-08-27 Chrome 回归闭环

- 复现并确认 `Styled canvas/渐变 → Original frame` 后背景仍显示是产品 bug，而非缓存或视觉误判；
- 根因是 `VideoPreviewComposite.updateBackgroundConfig()` 的热更新序列化漏传 `enabled`，初始化路径正确但切换路径仍沿用旧合成状态；
- 修复后实测 composition size 从 `1920×1080` 立即回到原始 `1920×1076`，背景、padding、圆角、shadow 同时消失；
- GIF Lab 的 fixture 坐标改为在 resize/scroll 时重新计算，避免浏览器窗口变化后选区落到旧坐标；
- 真实 cadence Area 录制包含 715 个源帧，Studio 播放与视觉计数均推进；
- Original frame 下导出 8 秒 Small GIF：GIF89a、`320×179`、80 帧、总 delay 8.00 秒、80 个不同图像块、1,398,372 bytes；
- 600px 档命名改为 `Email width`，Small/Email 的宽度使用四舍五入后的精确像素，不再出现标注 320 实际 319；
- OPFS reader 错误会立即透传，不再被 30 秒等待伪装成泛化超时。

### 12.1 环境

- 独立 Microsoft Edge profile；
- 本地 unpacked extension build；
- DPR 2；
- viewport 1592×1016；
- GIF Lab 640×360 target；
- cadence motion gate。

### 12.2 录制与 Studio

1. Action 选择 Record GIF；
2. 拖拽选中目标，选择器报告约 642×360（包含边框手势）；
3. 确认后完成倒计时；
4. 按 R 重置 motion gate；
5. 录制源从 F0000 推进到 F0063；
6. 停止后 Studio 打开指定 recording，显示 GIF delivery；
7. Studio 首帧可见 F0056；
8. 点击播放后可见 F0078，时间轴从 00:00 推进到约 2 秒；
9. 画面四周只包含选择目标，不包含页面 contract 或说明区域。

结论：capture、OPFS、Studio decode 和 preview composite 都在推进。

### 12.3 GIF 导出

该录制共 117.50 秒、3520 个 source frames。为做可控验收，在 Studio 开启 trim，使用 0–6 秒：

- source frames：180；
- GIF 设置：10 fps、25%、480×270、repeat metadata 2；
- 预期 GIF frames：约 60；
- 实际 GIF frames：60。

验收产物：

    /Users/wxnet/Downloads/screen-recorder-gif-lab-cadence-dynamic.gif

文件证据：

| 指标 | 实际值 |
|---|---|
| 文件大小 | 2,195,796 bytes |
| SHA-256 | 57a68697318de3155b6d7d33d924b89dbc15926633cb513de7df59946e855b41 |
| 版本 | GIF89a |
| 尺寸 | 480×270 |
| 帧数 | 60 |
| 每帧 delay | 10 centiseconds |
| 总 delay | 600 centiseconds |
| repeat metadata | 2 |
| logical length | 2,195,796 |
| physical length | 2,195,796 |
| trailing padding | 0 |
| 唯一压缩图像块 | 60 / 60 |
| 最长连续相同图像块 | 1 |

唯一图像块 60 / 60 证明该文件不是“一个静态帧重复 60 次”。

### 12.4 浏览器实际播放

将导出的文件直接在隔离 Edge 中打开：

- 第一次视觉采样：F0067；
- 约 1.4 秒后：F0080；
- 计数器、闪烁信号、运动点和条码均发生变化。

结论：最终交付 GIF 在真实浏览器解码播放时也会运动。

## 13. 验收矩阵

| 门槛 | 状态 | 证据 |
|---|---|---|
| Action 存在 GIF 入口 | 通过 | popup UI + popup model tests |
| 可选择并取消区域 | 通过 | selector + coordinator tests + E2E |
| 只捕获顶层目标文档 | 通过 | targetDocumentId 校验 |
| 倒计时 UI 不进入正式帧 | 通过 | warm-up/formal reader 分离 |
| 选区是真实裁剪 | 通过 | visibleRect + Geometry E2E |
| DPR / aspect mapping 正确 | 通过 | area-crop tests + Lab 实测 |
| source size 变化失败关闭 | 通过 | AREA_SOURCE_SIZE_CHANGED |
| VideoFrame 所有权有界 | 通过 | transfer helper + in-flight credit |
| 与现有录制写入同一 OPFS | 通过 | 同一 initOpfsWriter 路径 |
| Studio 打开指定 recording | 通过 | E2E URL id 与首帧 |
| Studio 播放会推进 | 通过 | F0056 → F0078 |
| GIF 默认值符合 EDM 首版 | 通过 | 10 fps / 精确 ≤600 px / repeat metadata 2（总播放 3 次） |
| GIF 时间与结构正确 | 通过 | strict inspector |
| GIF 内容实际变化 | 通过 | 60 / 60 unique image blocks |
| GIF 浏览器播放会推进 | 通过 | F0067 → F0080 |
| 完整测试与构建 | 通过 | 416 tests + check + build |

## 14. 剩余风险与下一步

### P0：本切片没有阻塞项

当前业务目标已经达到，可进入代码评审与发布准备。

### P1：建议下一轮

1. 把 cadence 全链路动作固化为可重复的发布前 E2E；
2. 增加 1 MB / 2 MB 预算提示与“一键优化”；
3. 增加首帧、循环接缝和实际文件体积的 Studio readiness；
4. 对长录制给出更早的 GIF 时长提示，默认鼓励 3–8 秒；
5. 对 viewport resize、浏览器 zoom 和页面导航补更多失败关闭 E2E。
6. 完成 Windows、屏幕阅读器、200% 文本缩放和 en/zh/fallback locale 的发布矩阵；当前只能视为 macOS Chromium 单平台的 GIF 切片 Go。

### P2：交付质量

1. 全局调色板；
2. 脏矩形与重复帧 disposal 优化；
3. 目标字节数搜索；
4. EDM 一键预设；
5. Landing Motion Pack：WebM + MP4 + poster + embed。

### 暂不恢复

Element Capture 仍不应与 Area 同期恢复。若未来需要，优先考虑“智能识别元素边界 → 冻结成 Area”，而不是重新引入独立元素录制管线。

## 15. 关键源码

- packages/extension/src/routes/popup/+page.svelte
- packages/extension/src/extensions/background.ts
- packages/extension/src/extensions/area-selector.ts
- packages/extension/src/extensions/offscreen-main.ts
- packages/extension/src/lib/recording/recording-session.ts
- packages/extension/src/lib/recording/recording-coordinator.ts
- packages/extension/src/lib/recording/area-recording-context.ts
- packages/extension/src/lib/recording/area-crop.ts
- packages/extension/src/lib/recording/recording-frame-transfer.ts
- packages/extension/src/lib/workers/webcodecs-worker.ts
- packages/extension/src/lib/workers/opfs-writer-worker.ts
- packages/extension/src/lib/studio/delivery-profile.ts
- packages/extension/src/lib/export/gif-delivery-defaults.ts
- packages/extension/src/lib/export/gif-frame-schedule.ts
- packages/extension/src/lib/export/gif-export-preflight.ts
- packages/extension/src/lib/export/gif-artifact-inspector.ts
- packages/extension/src/lib/services/gif-encoder.ts
- packages/extension/src/lib/workers/export-worker/index.ts
- packages/extension/test-pages/gif-lab

## 16. 一手资料

- [Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [W3C WebCodecs](https://www.w3.org/TR/webcodecs/)
- [GIF89a Specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)

## 17. 发布判断

结论为 **GIF Area 垂直切片 Go，进入单平台灰度发布准备**；这不等于整个扩展的跨平台 Full / Extended 用户故事矩阵已经全部通过。

Go 的依据不是“按钮可点击”或“能下载一个 .gif 文件”，而是：

- 动态源在录制时推进；
- 相同动态源在 Studio 播放时推进；
- 最新 8 秒导出文件包含 80 个不同图像块；
- GIF 时间、循环和文件边界通过解析；
- 同一文件在真实浏览器播放时推进；
- 完整测试、类型检查和生产构建通过。
