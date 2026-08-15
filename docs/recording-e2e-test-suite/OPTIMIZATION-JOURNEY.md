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

## 9. 发布门禁结果

本轮六个薄切片提交后执行：

- Vitest：36 个测试文件、177 项测试通过。
- TypeScript：`tsc --noEmit` 通过。
- 生产扩展：`pnpm build:extension` 通过。
- Git：`git diff --check` 通过。
- 真实 Chrome：长时间线、稀疏 VFR、快速 Seek、Crop、Trim、Zoom 和 MP4 组合导出通过。

当时的端测环境为 macOS Chrome 151。该结论支持当前主路径灰度发布，但 Windows 捕获差异、最低支持 Chrome 以及 WebM/GIF 完整组合链仍应按环境矩阵持续执行，不能由 macOS MP4 结果外推。

## 10. 回归保护原则

- Popup 状态不是录制事实。
- 帧数和名义 FPS 不是录制时长。
- 稀疏样本不是错误，丢失静态时间才是错误。
- Source FPS、目标输出 FPS 和平均帧密度是三个不同概念。
- Seek 成功必须证明目标帧在返回窗口中，不能静默截断。
- Capture、Composition 和 Encoded 尺寸必须分别命名并分别验证。
- UI 显示的导出选项必须进入 Worker 和最终容器。
- 时间变化效果使用展示时间，而不是源帧索引。
- 任何浏览器假设必须先经过独立 Lab 和真实版本验证。
