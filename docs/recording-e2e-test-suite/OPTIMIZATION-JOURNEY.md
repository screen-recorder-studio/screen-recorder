# 端到端优化过程

## 1. 背景与核心问题

本轮工作从扩展卸载率和录制入口使用成本出发，逐步深入到完整的视频数据链路。初始实现同时存在交互和技术风险：

- 录制入口依赖小窗口，Popup 一旦失焦就可能被 Chrome 关闭，用户难以理解当前状态。
- Popup、Service Worker、Offscreen Document 对“谁拥有录制事实”缺少稳定契约。
- 录制数据已经携带时间戳，但 Studio 预览和导出又用 `frameCount / fps` 重建时间，稀疏 VFR 会被加速。
- 预览只在源帧变化时合成，静态屏幕期间 Zoom 等时间效果会停住。
- Seek、跨窗口加载和长 GOP 之间缺少请求代次与目标帧约束，容易显示过期结果。
- Capture、Composition 和 Encoded 三种尺寸混用，导出设置可能只改变 UI、不改变产物。
- H.264 路径把 1080 错误扩为 1088，而 Chromium 实际只要求偶数尺寸。
- Crop 默认值、VFR Trim 和组合导出的语义没有完整的端到端保护。

因此没有一次性重写，而是沿用户旅程建立可单独验证、提交和回滚的薄切片。

## 2. 统一研发闭环

每个薄切片都遵循同一套闭环：

1. **只读审计**：追踪数据从录制、OPFS、Reader、Studio、Composite Worker 到 Export Worker 的完整路径。
2. **一手资料**：对 Chrome Popup、Offscreen、Screen Capture、WebCodecs、H.264 和 Mediabunny 等不确定边界只采信规范和官方实现/文档。
3. **独立 Lab**：将浏览器 API 或性能假设隔离，不让实验代码污染生产链路。
4. **Red**：先写会失败的状态机、纯时间函数、尺寸函数或调度测试。
5. **Green**：实现最小生产变更，让目标测试通过。
6. **Refactor**：消除重复契约，将组件逻辑下沉为可测试模块。
7. **浏览器端测**：在真实 Chrome 中走用户旅程，记录 UI、控制台、时间和导出结果。
8. **修正循环**：发现问题后回到 Lab/TDD，不通过刷新或扩大缓冲临时掩盖。
9. **提交与发布门禁**：薄片独立提交，最后执行全量测试、类型检查和生产构建。

## 3. 薄切片一：可恢复的录制会话

提交：`0d1c1e5 feat(recording): make capture sessions durable`

### 主要结论

- Chrome Action Popup 是一次性命令/状态视图，失焦关闭是正常生命周期，不能持有录制事实。
- Offscreen Document 持有真实 MediaStream；Service Worker 负责协调；`chrome.storage.session` 只保存当前浏览器会话中的可恢复投影。
- 会话状态使用 `operationId + revision`，拒绝旧操作、重复事件和非法阶段跃迁。
- 录制 active duration 使用排除暂停时间的单调时钟，不能由最后一帧时间戳或帧数推导。
- OPFS finalize、下载归属、取消与错误均进入显式状态，避免重复结束和误删非本扩展下载。

### 对应验证资产

- `lab/recording-entry-v2/`：Popup 关闭、显示选择器、当前标签页、Offscreen 和 `storage.session` 恢复。
- `lab/opfs-incremental-index/`：增量索引和 Writer 生命周期。
- 状态机、存储、Coordinator、Duration Tracker、OPFS Writer/Finalize 单元测试。

## 4. 薄切片二：真实时间线驱动的流畅预览

提交：`a27c4b4 feat(preview): drive playback from recording timeline`

### 根因

屏幕捕获天然允许稀疏 VFR：静态画面可能不交付重复帧，背压也可能丢帧。把样本数量当作播放时间会导致静态段消失、视频加速。旧预览还只在源帧索引变化时重绘，导致同一源帧上的 Zoom 动画暂停。

### 主要结论

- 录制会话时长是权威时间轴终点，源帧只是时间轴上的变化样本。
- 任意展示时刻 `t` 选择最后一个 `pts <= t` 的源帧；首帧之前回填首帧，末帧持续到会话结束。
- 播放显示时钟与源帧到达解耦；即使源帧不变，时间效果仍按展示时间重绘。
- Worker 忙时只保留最新合成请求，不追播已经过期的位图。
- Seek 请求带代次和上下文；旧窗口、旧解码结果不能覆盖新目标。
- 读取窗口必须包含目标帧且从合法关键帧开始；长 GOP 不能被静默截断。
- 预览尺寸由纯函数一次计算并赋值，避免响应式 effect 在窄容器中反复写值。

### 对应验证资产

- `lab/preview-playback-lab/`：真实 WebCodecs 编解码、静态 last-frame-hold、Zoom 时间效果、压力注入和 Seek 命中率。
- 时间线、静态持有、调度器、首帧门、请求路由、窗口计划和预览尺寸测试。

### 本轮实测基线

- 稀疏场景：122 个样本完成编码/解码，Seek 命中率 100%。
- 静态段候选重绘 240 次，旧基线仅 1 次。
- 轻载 p95 显示间隔约 18.6ms，p95 时钟漂移约 4.6ms。
- 压力场景 p95 显示间隔约 18.8ms，最大漂移约 8.7ms；旧基线约 72.8ms。
- 产品预览真实 5.176 秒内时间线前进约 5.21 秒，误差约 34ms。

## 5. 薄切片三：时间和尺寸一致的导出

提交：`b06fc2b feat(export): preserve timeline and canvas dimensions`

### 主要结论

- 明确三种尺寸：`captureSize` 是原始编码尺寸，`compositionSize` 是 Studio 画布，`encodedSize` 是输出轨道尺寸。
- 导出对话框的尺寸选择必须真正写入 ExportOptions 和 Worker-facing composition config。
- 导出固定时间网格由权威时长生成：`N = ceil(duration × fps)`，最后一帧裁短到精确结束时间。
- 每个输出时刻使用 last-frame-hold 选择源样本，稀疏源不能整体加速。
- H.264 1920×1080 保持原尺寸；只把奇数尺寸归一到偶数。16×16 宏块是编码器内部细节，不应暴露为 1920×1088 的显示画布。
- 导出取消具有显式状态并清理局部 OPFS 结果，避免残缺文件被当成成功。

### 对应验证资产

- `lab/webcodecs-h264-probe/`：`isConfigSupported` 与真实 `configure → encode → flush`。
- `lab/mediabunny-opfs-stream/`：OPFS 流式封装和容器回读。
- 导出尺寸、展示计划、静态持有、取消、目标和 OPFS 清理测试。

## 6. 薄切片四：统一录制质量测试卡

提交：`58ec04b test(lab): add recording quality test card`

测试卡覆盖圆/方形、16:9/1:1、安全区、1px 线、网格、色条、灰阶、中英文文字、匀速/快速运动、连续旋转和复合 Transform。它还区分：

- “暂停动画”：测试动画停止，但计时和 DOM 仍变化。
- “冻结画面”：所有像素完全静止，用于验证 Chrome 0Hz/稀疏捕获和静态尾部。

这使形变、清晰度、色彩、运动、静态持有和真实时长可以在同一素材中复现。

## 7. 薄切片五：Crop 默认全画面

提交：`14981ac fix(studio): default crop to the full frame`

### 主要结论

- 首次进入 Crop 必须以源画面完整矩形初始化，而不是使用错误的 composition 或空状态。
- 预设比例应在源坐标系中居中裁剪，并经过边界夹取。
- Apply 后重新进入编辑，显示的矩形必须与已应用参数一致。

### 本轮实测

- 源尺寸 4632×2406，默认 Crop 为完整 `x=0, y=0, w=4632, h=2406`。
- 16:9 预设得到约 `x=177, y=0, w=4277, h=2406`，重新编辑保持一致。

## 8. 薄切片六：VFR 时间线上的 Trim/Slice

提交：`7cb11f0 fix(studio): keep trim on the VFR timeline`

### 主要结论

- Trim 以毫秒时间区间为权威契约，不能先换算成 `frameIndex / fps`。
- 播放时钟、Seek、帧选择、导出摘要和 Export Worker 必须消费同一个裁剪时间域。
- 应使用半开区间 `[startMs, endMs)` 避免边界重复帧。

### 本轮实测

- 独立 Trim：约 8.00–21.93 秒、226 个源样本，预览重置和结束行为正确。
- Crop + Trim + Zoom 组合：约 13.37 秒、227 个源样本，导出 MP4 回读为 13.3725 秒、1280×720、约 30.06fps。

## 9. 薄切片七：当前标签页免 Picker 录制

提交：`b89b807 feat(recording): capture the active tab without a picker`

- 当前标签页入口改用 `chrome.tabCapture.getMediaStreamId`，由 Service Worker 在用户手势中取得 stream ID，再交给 Offscreen 捕获。
- Tab 模式不再打开系统 Display Picker；Window/Screen 仍遵守浏览器每次选择来源的安全边界。
- Popup 只负责发起命令，关闭后不会中断捕获。

## 10. 薄切片八：Slice 跨窗口连续播放与确定性边界

提交：

- `4355e33 fix(preview): keep sliced playback moving across windows`
- `79e92cd fix(studio): make trim boundaries deterministic`

主要修复了三类问题：主窗口尚未完成解码时预取窗口不能切换全局输出 lane；播放调度不能因 Worker 比一个 rAF 慢就丢弃所有完成帧；Trim 手柄必须暴露可重复输入的数值和键盘边界。Reader/Preview 现在区分 decode preroll 与 retained display buffer，跨窗不会把 Slice 起点永久冻结成首帧。

对应 Lab：

- `lab/preview-decode-window-lab/`
- `lab/slice-decode-lane-lab/`
- `lab/preview-playback-lab/`

## 11. 薄切片九：预览与导出的编辑一致性

提交：

- `6eded2d fix(export): keep edited output aligned with preview`
- `cc70b97 fix(export): preserve slice decoder preroll`
- `ffabdf3 test(lab): verify production export parity`
- `76a35db fix(export): preserve final WebM frame duration`

### 主要结论

- Trim 后 Zoom 必须在输出相对时间上运行，不能继续使用源帧索引或 preroll 帧数作为效果时钟。
- 同一稀疏源帧跨多个输出 sample 时，只要存在时间效果就必须重新合成。
- Slice 首个可见帧为 delta 时，解码数据必须包含之前最近的关键帧，但 preroll 只能参与解码，不能进入输出。
- WebM 必须为最后一帧补齐 duration；否则容器时长可能比 Studio 少一帧。
- Preview 和 Export 分别使用全局/裁剪后配置时，Zoom 的 scale、focus、mode、easing、transition 与 syncBackground 字段必须全部保留。

真实 Chrome 的 production Worker Lab 已验证：`ExportManager → export-worker → composite-worker → Mediabunny MP4` 输出 3.000 秒、640×360；7 个包含 Zoom 过渡的 checkpoint 最大 MAE 0.59。该 Lab 不替代 OPFS、WebM、GIF 产品 E2E，所以这些路径仍保留在发布矩阵中。

## 12. 薄切片十：发布日志与可恢复的导出错误

提交：

- `1f3a31a build(extension): strip release console output`
- `27654b3 fix(export): recover when Studio worker assets change`

- Release 构建移除产品及静态 vendor 的 console 输出，Debug 构建保留诊断日志；构建末尾会扫描全部 JavaScript bundle。
- Studio 页面与带哈希 Export Worker 属于同一构建代次。若本地原地构建或扩展更新让旧 Studio 引用的 Worker 消失，Worker 会在首条消息前失败。
- 该错误现在稳定分类为 `EXPORT_WORKER_UNAVAILABLE`，提示重新加载 Studio；录制文件保持安全，编码中途崩溃仍走普通格式失败路径。

确定性验证：保持 release A Studio 打开，原地构建 debug B 后导出会触发恢复提示；重载 fresh release 后，同一录制恢复导出。随后连续执行两轮全新 Screen 录制而不重载扩展，WebM 回读 21.533 秒/VP9/1920×1080，MP4 回读 20.133 秒/AVC/1920×1080。

## 13. 薄切片十一：Balanced 录制性能与有界预览内存

提交：

- `d215d92 fix(recording): cap capture workload at balanced 1080p`
- `4190942 fix(preview): bound decoder memory and keep playback smooth`
- `7295e88 fix(extension): restore Svelte type gate`

### 录制侧

- 第一张真实 VideoFrame 决定稳定编码计划；默认最长边限制在横屏 1920×1080/竖屏 1080×1920，帧率不超过 30fps，且不放大小尺寸来源。
- 4K 原始帧直接交给配置为 1080p 的 VideoEncoder，由编码器完成规范定义的缩放，避免额外 Canvas 拷贝。
- 录制时间轴按真实捕获样本采样；超出 cadence 的样本关闭但不制造重复帧，静态 gap 仍保持 VFR 语义。
- OPFS meta 使用实际应用的编码配置，避免 settings、首帧和 chunk 尺寸漂移。

### 预览侧

- `deviceMemory` 不可用或 ≤4GB 时保留预算为 256MiB，≥8GB 为 512MiB，另留 25% transient headroom。
- main 与 next 均至少保留 2 秒播放跑道；预算不足时降低 retained preview proxy 尺寸，不缩短时间跑道。
- main/next/hover 三类 VideoFrame 使用显式所有权、解码背压和 dispose；hover 只保留目标帧。
- Source display geometry 与代理尺寸分离，Crop/Zoom 仍在 canonical display space 计算。

性能 Lab 基线：4K direct 录制在测试机上为 1.12× RTF，证明无上限的 4K 默认路径不具实时余量；4K → Balanced 1080p 为 0.15× RTF。真实 preview memory soak 中，1080p 与 4K proxy 都完成 8 次 cutover，最大间隙分别 78.2ms/55.0ms，Crop+Zoom 9/9，production dispose 后 live frame 为 0。

## 14. 薄切片十二：倒计时期间预热且不录入倒计时

提交：`6022ee2 feat(recording): hide countdown frames during warmup`

- Picker 返回后立即建立 warm-up processor，在倒计时期间完成编码器选择、配置和 OPFS 初始化，并持续关闭 warm-up 帧。
- 零点前关闭独立 Countdown 窗口；等待关闭确认后停止 warm-up owner，再创建全新的 formal processor。
- 正式第一帧从新 processor 读取，以 timestamp 0 keyframe 进入录制，不能复用已知倒计时帧。
- Popup 的倒计时设置由长生命周期 Service Worker 持久化，并支持 `Off/0s`。

Chrome 151 实测：Current Tab 正式首帧在边界后约 22–38ms；Picker Tab 约 10ms；Entire Screen 约 1.2ms。Entire Screen 的 warm-up 明确观察到全屏倒计时标记，但正式首帧没有标记，且全部 20 张 warm-up 帧已关闭。

## 15. 性能评审结论

性能用例需要纳入正式发布套件，不能只保留 Lab README。原因是当前正确性高度依赖实时余量、解码队列、代理尺寸和资源释放；单纯验证“能导出”无法覆盖低配置电脑上的掉帧、长时间冻结或数 GiB 解码缓存风险。

本套件新增 `PERF-*` 用例，分为：

- 发布 P1：启动边界延迟、1080p/4K Balanced 录制实时余量、预览切窗与 Seek、内存预算、连续录制/导出、WebM 导出 RTF、真实 4 核/8GB Windows。
- 周期 P2：10/30/60 分钟 soak、硬件加速开关、4K 原始压力与跨平台趋势。

性能阈值与环境分层见 `TEST-CASES.md` 和 `TEST-ENVIRONMENT-AND-DATA.md`。

## 16. 发布门禁结果

最初六个薄切片的历史基线为 36 个测试文件、177 项测试通过。完成当前十二个薄切片后，最新全量门禁为：

- Vitest：54 个测试文件、293 项测试通过。
- TypeScript：`pnpm --filter extension exec tsc --noEmit` 通过。
- 生产扩展：`pnpm build:extension` 通过；release 日志策略扫描 87 个 JavaScript bundle 通过。
- Git：`git diff --check` 通过。
- 真实 Chrome：长时间线、稀疏 VFR、快速 Seek、Crop、Trim、Zoom、MP4/WebM 连续 Screen 录制导出、倒计时预热边界和 Worker 资源代次恢复通过。

当前端测环境为 macOS Chrome 151。该结论支持当前主路径灰度发布，但不能外推为低配置电脑已经通过：4 核/8GB Windows、最低支持 Chrome、GIF 完整组合链和 30/60 分钟 soak 仍须按环境矩阵执行。发布前若以“低配置老电脑可稳定运行”为承诺，`PERF-007` 是 P1 阻断项。

## 17. 回归保护原则

- Popup 状态不是录制事实。
- 帧数和名义 FPS 不是录制时长。
- 稀疏样本不是错误，丢失静态时间才是错误。
- Source FPS、目标输出 FPS 和平均帧密度是三个不同概念。
- Seek 成功必须证明目标帧在返回窗口中，不能静默截断。
- Capture、Composition 和 Encoded 尺寸必须分别命名并分别验证。
- UI 显示的导出选项必须进入 Worker 和最终容器。
- 时间变化效果使用展示时间，而不是源帧索引。
- 倒计时帧可以参与预热，但不能跨越正式录制边界。
- 默认录制必须保留实时余量；原始 4K 能编码不等于适合作为默认路径。
- 预览缓存预算必须按字节和播放跑道规划，不能只设置固定帧数。
- Worker 在首条消息前失败表示资源代次/加载问题，不应误报成格式编码失败。
- 任何浏览器假设必须先经过独立 Lab 和真实版本验证。
