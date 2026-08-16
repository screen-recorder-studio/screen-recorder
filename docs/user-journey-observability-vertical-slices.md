# 用户旅程薄层可观测垂直切片

## 1. 目标

本计划从用户完成一次录屏任务的旅程出发，把系统改造为一组可独立验证、可回滚的小切片：

```text
打开 Control
→ 请求屏幕共享
→ 用户允许/拒绝
→ 录制开始/暂停/继续/停止
→ 编码并写入 OPFS
→ 最终提交完成
→ Studio 数据就绪
→ 首帧可见
→ 编辑
→ 导出开始/完成/失败/取消
→ 下载开始/完成/失败
```

每个切片同时贯穿四层，但只改变一个最小用户结果：

1. **用户状态**：用户当前在等待什么、是否成功、失败后能做什么。
2. **内部事实**：产生稳定、枚举化、可关联的旅程事件。
3. **可靠性约束**：失败必须显式，不允许静默丢数据或假成功。
4. **自动验证**：先写失败测试，再写最小实现，最后回归构建。

本轮可观测层只保存在本机，不上传任何数据，也不引入第三方分析 SDK。

## 2. 非目标

本轮不做以下工作：

- 不上传录屏内容、音频、URL、页面标题、元素选择器、文件名或异常堆栈。
- 不建立用户画像、跨设备标识或广告归因。
- 不一次性重写整个录制/导出架构。
- 不把 console 文本当作稳定事件协议。
- 不在缺少第一方资料或最小实验时猜测浏览器 API 行为。

## 3. 可观测事件契约

### 3.1 事件信封

每个事件使用同一信封：

```ts
interface JourneyEvent {
  schemaVersion: 1
  sequence: number
  journeyId: string
  name: JourneyEventName
  context: 'background' | 'offscreen' | 'studio' | 'export'
  occurredAt: number
  attributes: {
    mode?: 'tab' | 'window' | 'screen'
    format?: 'mp4' | 'webm' | 'gif'
    stage?: string
    outcome?: 'success' | 'failure' | 'cancelled'
    errorCode?: string
    durationMs?: number
    count?: number
    bytes?: number
    width?: number
    height?: number
    fps?: number
  }
}
```

`journeyId` 是浏览器会话内随机关联 ID，不使用录制目录名、tab ID、URL 或文件名。事件只进入有界 ring buffer。

### 3.2 首轮事件

| 用户阶段 | 事件 | 成功判据 |
|---|---|---|
| 请求录制 | `recording.requested` | Background 已接受请求并创建旅程 |
| 权限选择器 | `capture.permission_requested` | 调用 `getDisplayMedia()` 前 |
| 权限通过 | `capture.permission_granted` | 返回至少一个 video track |
| 权限失败 | `capture.permission_denied` / `capture.failed` | 使用稳定错误码，不保存原始错误文本 |
| 录制开始 | `recording.started` | 编码器、OPFS Writer 和帧循环均已就绪 |
| 暂停/继续 | `recording.paused` / `recording.resumed` | 实际 producer 状态已切换 |
| 用户停止 | `recording.stop_requested` | Stop 请求已送达 Offscreen |
| OPFS 初始化 | `storage.ready` | Writer 发出 `ready` |
| OPFS 最终提交请求 | `storage.finalize_started` | 当前表示 finalize 请求已发出；后续应改名 requested 或增加 Writer acknowledgement |
| OPFS 可用 | `storage.finalized` | data 先于 index flush/close，最终 meta 已提交 |
| 存储失败 | `storage.failed` | 稳定错误码与当前阶段 |
| Studio 数据请求 | `studio.load_started` | Reader 收到 open |
| Studio 数据就绪 | `studio.data_ready` | Reader 返回非空初始 range |
| Studio 首帧可见 | `studio.first_frame_visible` | bitmap 已 transfer，遮罩更新已由 `tick()` 应用，且只发一次 |
| Studio 失败 | `studio.load_failed` | empty/invalid/reader/preview/timeout 使用稳定错误码并进入可恢复状态 |
| 导出请求 | `export.started` | 当前接近规范化选项提交边界；后续应改名 requested 或增加 worker acknowledgement |
| 导出完成 | `export.completed` | 容器 finalize 完成；OPFS 文件可读且 `bytes > 0` |
| 导出失败/取消 | `export.failed` / `export.cancelled` | 取消需等待 Output 与 partial 文件清理；清理失败不得伪装 cancelled |
| 下载开始/完成/失败 | `download.started` / `download.completed` / `download.failed` | 只跟踪 `download()` 成功返回的扩展自有 ID；终态为 complete/interrupted |

### 3.3 隐私与容量边界

- 默认最大保留 200 条事件。
- 使用 `chrome.storage.session`，扩展更新、禁用或浏览器重启后清空。
- 只允许白名单字段；未知字段直接丢弃。
- `errorCode` 仅接受大写字母、数字和下划线，最大 64 字符。
- 不记录原始 `Error.message`、stack、URL、tab title、录制内容、文件名和 OPFS 目录 ID。
- 不进行网络发送。
- 提供内部 `GET_JOURNEY_EVENTS` 与 `CLEAR_JOURNEY_EVENTS` 消息，便于本地诊断和测试。

## 4. 垂直切片

### Slice 0：测试基线

**用户结果**：无直接 UI 变化；后续每次修复都有可重复证据。

**改动**：

- 固定版本 Vitest。
- 增加一次性运行命令 `pnpm test`，CI/代理不进入 watch。
- 测试文件与纯逻辑同目录，命名 `*.test.ts`。

**TDD 验收**：

- 先提交至少一个会失败的契约测试。
- 实现后所有测试通过。
- 测试不得依赖真实 Chrome 全局或真实 OPFS。

### Slice 1：旅程事件骨架

**用户结果**：一次录制从请求到结果可以在本机还原，不再只能依赖散乱 console。

**内部切片**：

- 纯函数负责事件白名单、数值归一化、错误码归一化和 ring buffer。
- Background 串行持久化到 `chrome.storage.session`，避免并发覆盖。
- 所有上下文通过 `JOURNEY_EVENT` 发送输入事件，最终信封只由 Background 生成。

**TDD 用例**：

- 丢弃 URL、文件名、message、stack、selector 等未知/敏感字段。
- 非法枚举和 NaN/Infinity 不进入事件。
- buffer 超过 200 条只保留最新事件。
- 新的 `recording.requested` 创建新旅程；后续事件继承同一 `journeyId`。
- service worker 恢复后 sequence 单调递增。

### Slice 2：权限与录制开始

**用户结果**：能区分“正在等待共享选择器”“用户取消”“权限拒绝”“环境不支持”“已开始录制”。

**内部切片**：

- 调用 `getDisplayMedia()` 前发 `capture.permission_requested`。
- 返回 video track 后发 `capture.permission_granted`。
- 规范化 DOMException：`NotAllowedError` → `PERMISSION_DENIED`；`AbortError` → `CAPTURE_CANCELLED`；`NotFoundError` → `CAPTURE_SOURCE_NOT_FOUND`；不支持 API → `CAPTURE_NOT_SUPPORTED`。
- `STREAM_START` 后发 `recording.started`，而不是在请求返回时提前宣告成功。

**TDD 用例**：

- 每种 DOMException 映射稳定错误码。
- 原始系统错误文本不进入旅程事件。
- 并发 start 只创建一个活动旅程。

### Slice 3：OPFS 增量索引与可确认 finalize

**用户结果**：长录制停止时不会因为反复重写全部索引而非线性变慢；只有数据真正可用后才打开 Studio。

**内部切片**：

- index 使用单个长生命周期 writable 或同步句柄增量写入。
- 每次 flush 后清空待写行，不再重写历史。
- `init` 重置 offset、计数、时间戳和缓冲区。
- duration 固定为 `max(0, lastTimestamp - firstTimestamp)`，单位为微秒，与 Reader 一致。
- finalize 只有收到 `finalized` 或显式 `error` 才结束；超时必须产生 `OPFS_FINALIZE_TIMEOUT`，不能静默当成功。
- 每 100 个 chunk、显式 flush 与 finalize 都先提交 `data.bin`，再提交对应 index；data flush 失败时不得发布领先的 index。
- data/index 句柄采用 take-and-null 后再 flush/close，失败清理重入时不会二次操作同一句柄。
- `init`、`append`、`flush`、`finalize` 全部进入单一 FIFO Promise queue；前一消息失败不会阻塞后续清理。
- fallback data 首次 checkpoint 截断旧文件，后续以 `keepExistingData + seek(committedOffset)` 仅提交 pending bytes；提交失败不推进 offset、不丢 pending。
- final close 成功后释放 data handle 与 fallback 状态；重复 finalize 不重写 data/meta，finalize 后 append/flush 稳定拒绝。

**TDD 用例**：

- 两次 index flush 只写新增行。
- fallback 第二次 checkpoint 只写新增 bytes，失败时保留 pending 与 committed offset。
- 并发提交按 FIFO 完成，前一失败不阻塞后续清理。
- 多次 init 不继承上一录制状态。
- 首帧时间戳非零时 duration 仍正确。
- 空录制 duration 为 0 且提交空 `data.bin`。
- index offset 连续且关键帧标记正确。
- finalize 成功、错误和超时分别产生唯一结果；重复 finalize 幂等，finalize 后写入被拒绝。

### Slice 4：Studio 数据就绪与真实首帧

**用户结果**：加载状态直到首帧真正显示；“数据已读取”不再伪装为“视频已可见”。

**内部切片**：

- Reader 非空 range → `studio.data_ready`。
- `transferFromImageBitmap()` 成功后先解除首帧遮罩，等待 `tick()` 应用 UI 更新，再发送第一次 `studio.first_frame_visible`。
- 首帧事件每次载入录制只发送一次；切换录制后，上一录制尚未完成的回调不能误报。
- 空 range、Reader worker error/messageerror、Preview worker/context/display error 均进入可恢复的 `load-failed`。
- 不可修复/不可转换的 chunk 立即产生 `STUDIO_PREVIEW_INVALID_CHUNKS`；`processVideo()` rejection 立即产生 `STUDIO_PREVIEW_PROCESSING_FAILED`，不能降级为通用超时。
- 首帧等待上限为 15 秒，超时产生 `STUDIO_FIRST_FRAME_TIMEOUT`，不能永久遮挡编辑入口。

**TDD 用例**：

- 空 range 不产生 data-ready，并解除等待进入失败状态。
- 遮罩状态先变为 false，`tick()` resolve 后才记录 visible。
- 首帧回调重复调用只记录一次；录制切换抑制旧回调。
- 不可修复 chunk 与预处理 rejection 立即退出 gate，并分别使用稳定错误码。
- worker 错误与超时均只产生一次稳定失败。

### Slice 5：导出与下载闭环

**用户结果**：导出成功、失败、取消以及下载结果均明确；MP4 长文件不要求完整驻留内存。

**内部切片**：

- 导出选项先规范化，再发送 worker。
- MP4 与 WebM 在 OPFS 来源下均使用 `StreamTarget`。
- 按 Mediabunny `position` 语义写入 OPFS，禁止简单拼接可能重写的 byte region。
- 取消先停止帧生产，再等待 `Output.cancel()`、视频源关闭、writable abort 与 partial OPFS 文件删除；全部完成后才发送 `cancelled`。
- partial 文件删除失败时保留目录/文件名供下一次取消重试；`NotFoundError` 视为已清理，并发 cleanup 合并为同一 Promise。
- GIF 在 `ensureGifLibLoaded()` 预加载阶段也持有取消令牌；取消后即使脚本稍后加载完成，也不得创建 export worker。
- GIF 主线程 encoder 在取消请求时显式 cleanup，同时仍等待 worker 回执后结算 Promise。
- OPFS 导出结果只接受可读取且 `bytes > 0` 的文件；缺失、不可读或空文件 fail-closed。
- `download.started` 只在 `chrome.downloads.download()` 成功返回 ID 后记录；`onChanged` 仅消费保存在 `storage.session` 中的扩展自有 ID，终态后删除。

**TDD 用例**：

- OPFS 来源的 MP4 设置 `saveToOpfs` 和文件名。
- `cancelled` 不能早于 Output、视频源和 partial 文件清理完成。
- partial 删除瞬时失败可重试；NotFound 与并发 cleanup 行为稳定。
- GIF 预加载期间取消后不得启动 worker；active GIF cancel 会清理主线程 encoder。
- OPFS 结果句柄缺失、读取失败、`bytes <= 0` 都不能产生 completed。
- 非 owned 下载变化被忽略；`complete` / `interrupted` 分别且仅一次映射为 completed / failed。

### Slice 6：暂停时间轴与背压

**用户结果**：暂停不增加成片时长；发生丢帧或存储积压时用户得到明确告警。

**内部切片**：

- 建立 active media clock，从帧时间戳中扣除累计暂停时间。
- WebCodecs/OPFS 队列产生累计 dropped count 与原因。
- 只有性能阈值跨越时发送 warning，避免每帧刷事件。

**TDD 用例**：

- 多次 pause/resume 后输出时间戳单调。
- stop while paused 时 active duration 正确。
- 队列边界 15/16、499/500 行为明确。

## 5. TDD 工作流

每个切片严格执行：

1. **Red**：新增最小失败测试，运行目标测试并保存失败原因。
2. **Green**：只写让该测试通过的最小生产实现。
3. **Refactor**：去重、改善命名，不改变行为。
4. **Regression**：运行全部单测、`pnpm check`、`pnpm build:extension`。
5. **Journey check**：核对事件是否来自真实完成边界，而非请求边界。
6. **Document**：更新本文状态和仍未验证项。

一次切片不混入无关重构。若测试无法在 Node 中表达，则先进入 lab，而不是直接写生产代码。

## 6. Lab 规则

在 `lab/` 中创建最小、可手工复现的浏览器实验，只验证一个问题：

- `lab/opfs-incremental-index/`：验证 Dedicated Worker 内 OPFS 长生命周期 writable 的增量写、flush、close 与重新读取。
- `lab/mediabunny-opfs-stream/`：验证 MP4 `StreamTarget` 对同一 byte region 的重写以及按 `position` 写入后的可播放性。
- 如后续需要，再建立 `lab/capture-error-taxonomy/`，记录不同 Chrome/OS 下共享选择器取消与拒绝的 DOMException 名称；自动化不能操作系统选择器，因此该实验是手工矩阵。

每个实验必须包含：

- 要证伪/证实的假设；
- 浏览器与版本；
- 操作步骤；
- 实际结果；
- 是否允许进入生产实现。

## 7. 第一方依据

- [Chrome Extensions Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)：`storage.session` 在扩展加载期间驻内存，浏览器重启、扩展更新/禁用后清空，当前配额 10MB，并推荐用于 service worker 与敏感状态。
- [Chrome Extension Service Worker Lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：service worker 空闲后可能终止，重新唤醒时全局变量已丢失，因此扩展自有 `downloadId` 保存在 `storage.session`，而不是只放在内存 `Set`。
- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)：`download()` 成功后返回唯一 ID；`onChanged` 会报告浏览器中的下载变化，终态包括 `complete` 与 `interrupted`，因此必须按本扩展创建的 ID 过滤。
- [WHATWG File System Standard](https://fs.spec.whatwg.org/)：`createSyncAccessHandle()` 只暴露给 Dedicated Worker，并对文件持有独占锁；`flush()` 用于把缓存修改提交到底层存储。`createWritable({ keepExistingData: true })` 可保留既有内容，`seek()` 设置后续写入位置，因此 fallback checkpoint 以 committed offset 追加而非重写历史。
- [Svelte Lifecycle Hooks](https://svelte.dev/docs/svelte/lifecycle-hooks)：`tick()` 在待处理的 UI 更新应用后 resolve；首帧事件因此在移除遮罩并等待 `tick()` 后记录。
- [W3C Screen Capture](https://www.w3.org/TR/2025/WD-screen-capture-20250522/)：屏幕捕获权限失败以 `NotAllowedError` 拒绝。
- [Vitest Getting Started](https://vitest.dev/guide/)：Vitest 要求 Vite 6+、Node 20+，支持 `vitest run` 一次性执行；当前项目 Vite 7.3.1、Node 24.15.0 满足要求。
- [Mediabunny Writing media files](https://mediabunny.dev/guide/writing-media-files)：`BufferTarget` 将完整输出保存在内存，较大文件应使用 `StreamTarget`；stream chunk 必须写入指定 `position`；取消时需等待 `output.cancel()` 完成，才表示编码器与 writer 资源已释放。

Content was rephrased for compliance with licensing restrictions.

## 8. 实施状态

| 切片 | 状态 | 证据 |
|---|---|---|
| Slice 0 测试基线 | 已完成 | 固定 `vitest@4.1.10`；根目录与 extension 均提供 `test` / `test:watch`；当前 15 个测试文件、66 个测试 |
| Slice 1 旅程事件骨架 | 已完成（本轮薄层） | `journey-events` 白名单与 ring buffer、`journey-recorder` 串行 session 写入、Background 唯一持久化边界 |
| Slice 2 权限与录制开始 | 已完成（首片） | 捕获异常稳定分类；Background/Offscreen 已接入请求、权限、开始、暂停、继续、停止与失败事件 |
| Slice 3 OPFS 增量索引/finalize | 已完成 | FIFO 消息队列；增量 JSONL 与 fallback pending bytes；data→index durability；相对 duration；明确 finalize ack/30s 超时；final close 幂等 |
| Slice 4 Studio 首帧 | 已完成 | 非空 range 才 data-ready；canvas transfer 后先移除遮罩，`tick()` 后才上报 visible；预处理错误立即分类；15s 超时及 reader/preview 错误进入可恢复失败页 |
| Slice 5 导出/下载 | 已完成（本轮闭环） | OPFS `StreamTarget`；取消等待 Output/视频源/partial 清理且删除可重试；GIF preflight 可取消；结果 fail-closed；下载仅消费扩展自有 ID |
| Slice 6 暂停/背压 | 未开始 | 仍需 active media clock、队列背压、dropped-frame 阈值和用户告警 |

## 9. 验证结果（2026-08-01）

### 9.1 自动化与构建

- `pnpm test`：通过，`15 passed` / `66 passed`。
- `pnpm build:extension`：通过；Background、Offscreen、OPFS writer worker 均成功独立打包。
- `git diff --check`：通过。
- 四个 Lab JavaScript 配置/入口均通过 `node --check`。
- `static/manifest.json` 与 `build/manifest.json`：`cmp -s` 通过。
- 已确认产物存在：`build/background.js`、`build/offscreen.js`、`build/opfs-writer-worker.js`、`build/popup.html`。
- Adapter 构建阶段仍打印既有提示 `Extension manifest not found...`；构建脚本末尾复制 manifest 后，上述一致性和产物检查均通过。

### 9.2 类型检查边界

`pnpm check` 当前为 `2 errors and 65 warnings in 8 files`，没有本轮新增错误。两个改造前错误未混入本切片修复：

1. `packages/extension/src/routes/opfs-drive/+page.svelte:221:11`：异步 `onMount` 返回 cleanup 的类型不兼容。
2. `packages/extension/src/routes/sidepanel/+page.svelte:982:60`：`ElementRecordingIntegration` 缺少 `convertToMainSystemFormat`。

### 9.3 TDD 证据

本轮新增行为均先观察到 Red，再做最小实现：

- 下载归属：测试先因 `owned-download-tracker` 缺失失败，随后 5 个测试通过。
- Studio 首帧：测试先因 `first-frame-gate` 缺失失败，随后 4 个测试通过；预处理失败 helper 先因模块缺失失败，随后 3 个测试通过。
- 导出取消：控制器先因模块缺失失败；strategy 清理先因方法缺失失败；GIF cleanup 先出现断言失败，随后目标测试通过。
- partial 删除重试：MP4/WebM 的 transient failure、NotFound、并发合并及 controller retry 共 7 个场景先失败，随后相关 12 个测试通过。
- GIF preflight：测试先因取消模块缺失失败，随后 2 个测试通过，证明预加载期间取消不会启动 worker。
- OPFS checkpoint：data→index 与幂等关闭 3 个断言先失败；FIFO/lifecycle 3 个断言先因 helper 缺失失败；fallback 增量提交 2 个断言先失败；最终 writer-state 11 个测试通过。
- OPFS 导出结果：MP4/WebM 的句柄缺失、读取失败、空文件共 6 个断言先出现“错误地 resolve bytes: 0”，修复后结果验证 8 个测试通过。
- 最终行为级语义审查确认此前 writer 并发、重复 finalize、GIF preflight、partial 删除重试、预处理失败及 fallback 二次方 I/O 均已关闭；当前 diff 无 confirmed/likely P0–P2。

### 9.4 浏览器 Lab 状态

| Lab | 自动检查 | 真实 Chrome 结果 | 当前结论 |
|---|---|---|---|
| `lab/opfs-incremental-index/` | `index.js`、`worker.js` 已通过 `node --check` | 待手工点击 SyncAccessHandle 与 long-lived writable 两种模式；尚无 Chrome 版本与运行输出 | **待手工验证**，不能宣称 PASS |
| `lab/mediabunny-opfs-stream/` | `index.js`、`vite.config.js` 已通过 `node --check` | 待手工生成 2 秒 MP4，并核对非空、high-water mark、metadata 与播放 | **待手工验证**，不能宣称 PASS |

手工验收时在项目根目录分别启动本地服务，然后在 Chrome 点击页面按钮并保存页面输出与 Chrome 版本：

```bash
python3 -m http.server 4173 --directory lab/opfs-incremental-index
pnpm --dir packages/extension exec vite ../../lab/mediabunny-opfs-stream --host 127.0.0.1
```

自动化环境无法操作 Chrome UI。生产实现以第一方契约、Node 单测和生产构建为依据；上述 lab 仍是浏览器兼容性验收门槛，不作为已通过证据。

### 9.5 已知后续边界

- `storage.finalize_started` 与 `export.started` 目前仍接近请求边界；后续应改名为 `*.requested`，或增加 worker acknowledgement 后再记录 `*.started`。
- 单一 `activeJourneyId` 不能精确关联并行录制/导出；需要按 operation ID 建立并行旅程关联。
- Slice 6 尚未实施：暂停期间 active timeline、OPFS/WebCodecs 背压、累计丢帧与阈值告警仍是下一轮工作。
- 两个既有 `pnpm check` 错误应单独修复，避免与本轮用户旅程切片混杂。

## 10. 本轮完成定义

本轮以以下结果为完成，不以“代码已写”作为完成标准：

- Slice 0–5 的已实施部分有先红后绿的测试证据。
- 旅程事件只在本地 session 保存且通过白名单脱敏。
- 录制请求、权限、录制开始、OPFS finalize、Studio 数据/首帧、导出/下载至少各有一个稳定事件。
- OPFS index 不再周期性重写全部历史；fallback data checkpoint 也只提交尚未持久化的 bytes。
- OPFS writer 消息按 FIFO 完成，finalize 幂等，关闭后写入被拒绝。
- OPFS metadata duration 与 Reader 的相对时间语义一致。
- Studio 预处理失败立即解除首帧 gate 并使用稳定分类。
- 导出取消覆盖 GIF preflight 与 active worker；partial 删除失败可重试，清理完成前不报告 cancelled。
- MP4 的 OPFS 来源路径使用流式输出。
- 所有新增测试通过；扩展构建成功。
- 现有 `pnpm check` 的历史错误与本轮新增错误分开报告，不能把历史失败伪装成成功。
- 无网络遥测、无录屏内容或页面信息被收集。
