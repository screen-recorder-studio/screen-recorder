# 详细端到端测试用例

## 1. 通用约定

### 1.1 前置条件

- 使用待发布 commit 执行 `pnpm build:extension`，从 `build/` 加载 Unpacked 扩展。
- 关闭同 ID 的旧开发扩展，避免快捷键、Offscreen Document 和下载事件互相干扰。
- 首轮保留旧 OPFS 数据验证兼容性；第二轮清理数据后验证全新安装路径。
- 页面缩放默认 100%，记录 DPR、显示器和录制来源。
- 打开扩展 Service Worker、Offscreen 和 Studio 的 Console；保留 error/warning 日志。
- 所有视觉用例使用 `lab/recording-quality-page/` 或明确标记的标准数据。

### 1.2 通用失败条件

出现以下任一情况直接判 FAIL：

- UI 显示录制中，但 Offscreen 已没有 live track；或反之。
- Popup 关闭导致录制结束、计时重置或停止按钮失效。
- 播放时间回退、突然快进、在静态区停钟或播放不到终点。
- Seek 后先显示旧位置，且旧结果最终覆盖新目标。
- Crop/Trim/Zoom 重新编辑时参数丢失或改变。
- 导出 UI 的格式、分辨率、时长与实际文件不一致。
- 静态区被删除、末帧提前结束、出现黑帧、几何拉伸或 1080→1088 黑边。
- Console 出现未解释的无限循环、解码错误、detached frame 或未处理 Promise rejection。

### 1.3 Slice 术语

本文中的 **Trim/Slice** 表示用户在时间线上保留一个时间区间的裁剪功能，不代表代码提交的“薄切片”。测试记录中统一填写实际保留的 `[startMs, endMs)`。

## 2. 自动化发布门禁

### GATE-001：全量单元测试

- 优先级：P0
- 步骤：运行 `pnpm -C packages/extension exec vitest run`。
- 预期：退出码为 0；无 skipped P0 契约；记录文件数和测试数。
- 证据：完整命令、commit、通过数量和日志尾部。

### GATE-002：TypeScript 检查

- 优先级：P0
- 步骤：运行 `pnpm -C packages/extension exec tsc --noEmit`。
- 预期：退出码为 0，无类型错误。

### GATE-003：生产扩展构建

- 优先级：P0
- 步骤：运行 `pnpm build:extension`。
- 预期：退出码为 0；`build/manifest.json` 和各 Worker 产物存在；warning 已分类且没有新增 blocker。

### GATE-004：补丁完整性

- 优先级：P0
- 步骤：运行 `git diff --check` 和 `git status --short`。
- 预期：无空白错误、临时视频、构建产物或未知源码改动；明确记录有意保留的未跟踪文件。

### GATE-005：版本与包一致性

- 优先级：P1
- 步骤：核对根 `package.json`、扩展 `package.json`、Manifest 和发布包版本。
- 预期：版本号、名称、权限和待发布变更一致；没有 Lab 权限进入生产 Manifest。

## 3. 录制入口与 Picker

### ENTRY-001：当前标签页快速录制

- 优先级：P0
- 数据：普通 HTTPS 页，DATA-01。
- 步骤：点击扩展图标；选择当前标签页快速录制；等待倒计时；观察是否出现系统 Picker；重新打开 Popup。
- 预期：只需一次明确点击；不出现 display Picker；倒计时后开始录制；Popup 关闭不影响 stream；重开后显示正确模式和录制状态。
- 证据：Popup 初始/重开截图、Offscreen track settings、事件时间线。

### ENTRY-002：Display Picker 立即调用

- 优先级：P0
- 数据：`lab/recording-entry-v2/`，Immediate。
- 步骤：点击 Display Picker；分别选择标签页、窗口和整个屏幕；每次开始后重开 Popup 并停止。
- 预期：Picker 能从用户手势链路打开；Popup 即使自动关闭，选中 stream 仍存活；三个来源均报告真实 settings；停止回到 idle。
- 证据：userActivation、call/resolve 时间、track settings、Popup lifecycle 日志。

### ENTRY-003：Picker 取消

- 优先级：P0
- 步骤：打开 Picker 后点击取消；重开 Popup；再次发起并选择有效来源。
- 预期：取消进入可理解、可重试状态；没有假录制、残留倒计时或死锁；重试使用新的 operationId 并能成功。
- 证据：精确 `error.name/message`、状态迁移和重试 operationId。

### ENTRY-004：Popup 失焦与关闭

- 优先级：P0
- 步骤：在 requesting、countdown、recording、paused、stopping/finalizing 阶段分别点击 Popup 外部；随后重开。
- 预期：Popup 可关闭；业务状态不依赖 unload/pagehide；每次重开都从协调层恢复同一会话；不存在重复开始/停止。

### ENTRY-005：受限页面降级

- 优先级：P1
- 数据：`chrome://extensions` 或 Chrome Web Store。
- 步骤：从受限页面打开扩展，尝试允许的录制入口和状态控制。
- 预期：无法注入页面 Overlay 时有明确降级；Popup/Offscreen 主控制仍可用；无权限异常造成的空白 UI。

### ENTRY-006：多窗口与多显示器

- 优先级：P1
- 步骤：在双显示器和两个 Chrome 窗口中发起 Picker；分别捕获非当前窗口和第二块屏幕。
- 预期：Picker 焦点位置合理；选择结果与目标一致；控制入口不绑定错误 windowId；停止能结束正确 track。

### ENTRY-007：Picker 调用时序观察

- 优先级：P2
- 数据：`lab/recording-entry-v2/`。
- 步骤：依次运行 Immediate、Microtask、Delay 0ms、Delay 1000ms。
- 预期：Immediate 是生产依赖路径并成功；其余结果按目标 Chrome 真实行为记录，不将偶然成功外推为规范保证。

## 4. 录制会话、暂停与恢复

### SESSION-001：状态机正常路径

- 优先级：P0
- 步骤：idle → requesting → countdown → recording → stopping → finalizing → idle。
- 预期：UI 和日志阶段单向前进；同一 operationId 的 revision 递增；重复事件不会重复写入或二次 finalize。

### SESSION-002：暂停与恢复 active clock

- 优先级：P0
- 数据：DATA-05。
- 步骤：录制运动 2 秒；暂停 5 秒；恢复录制 2 秒；静止 5 秒后停止。
- 预期：active duration 约 9 秒，不包含暂停的 5 秒；恢复后的媒体时间映射不跳跃；预览和导出均约 9 秒。
- 证据：暂停/恢复时间戳、final meta、Studio duration、输出 duration。

### SESSION-003：Popup 重开恢复

- 优先级：P0
- 步骤：录制中关闭 Popup；等待 5 秒；重开；暂停；再次关闭和重开；恢复并停止。
- 预期：状态、模式和计时与 Offscreen 一致；按钮可继续控制；计时不从 0 重启。

### SESSION-004：Service Worker 被回收

- 优先级：P0
- 步骤：在 requesting、recording 和 finalizing 阶段分别从扩展管理页终止 Service Worker；重开 Popup。
- 预期：`storage.session` 投影可加载；重新向 Offscreen reconcile live status；没有把旧快照当成 live stream；finalizing 可给出稳定结果。

### SESSION-005：来源主动结束

- 优先级：P0
- 步骤：录制中点击 Chrome “停止共享”，以及关闭被捕获窗口/标签页。
- 预期：track `ended` 被识别为非主动停止；会话安全进入 stop/finalize 或明确失败；产物可用时保留；UI 不停留在 recording。

### SESSION-006：扩展重载与浏览器重启

- 优先级：P1
- 步骤：分别在 idle 和 recording 时 Reload 扩展；重启 Chrome。
- 预期：`storage.session` 按 Chrome 语义清空；旧 MediaStream 不被虚假恢复；再次打开时给出干净 idle 或可解释的上次异常结束信息。

### SESSION-007：失败后重试与旧事件

- 优先级：P1
- 步骤：制造一次 Picker 取消或捕获失败；重试；在 DevTools/测试桩中延迟旧 operation 的事件。
- 预期：只有 failed 状态可 retry；新 operationId 生效；旧 operationId、非递增 revision 和非法 phase 事件被拒绝且不改状态。

### SESSION-008：停止与 finalize 幂等

- 优先级：P0
- 步骤：快速连续点击停止；在 Popup 和 Chrome Stop Sharing 近同时触发结束。
- 预期：只 finalize 一次，只生成一个 owned download；OPFS meta/index 完整；UI 最终可返回 idle。

## 5. 时间线与 OPFS 数据正确性

### TIMELINE-001：正常 30fps 回归

- 优先级：P0
- 数据：DATA-04。
- 步骤：录制 25 秒；打开 Studio；检查时长；播放到结尾；导出 MP4 并回读。
- 预期：Studio 和导出均约 25 秒，误差不超过一帧；没有因时间模型改造而变慢或重复帧。

### TIMELINE-002：稀疏 VFR

- 优先级：P0
- 数据：DATA-02。
- 步骤：分别 Seek 到 0、4999、5000、19999、20000、24999ms；从头播放；导出。
- 预期：帧选择依次为 A、A、B、B、C、C；总时长 25 秒；不存在 3 秒快放。

### TIMELINE-003：单帧长时长

- 优先级：P0
- 数据：DATA-03。
- 步骤：打开 Studio；Seek 0、12.5、24.9 秒；播放并导出。
- 预期：三个位置都显示同一帧；时钟连续到 25 秒；输出约 25 秒而不是 1 秒或 1/30 秒。

### TIMELINE-004：动→静→动

- 优先级：P0
- 数据：DATA-01 冻结片段。
- 步骤：播放进入冻结段并继续到解除冻结；在冻结中间和恢复边界 Seek。
- 预期：冻结段完整保留最后有效帧，播放时钟继续；恢复边界切换到新样本，不提前、不延后、不倒退。

### TIMELINE-005：旧录制兼容

- 优先级：P1
- 数据：缺少新 active duration 或部分 meta 的历史录制。
- 步骤：从 Drive/OPFS 打开；检查 fallback timingSource、时长、Seek 和导出。
- 预期：使用明确的兼容 fallback；不崩溃；UI 或日志能够区分估算时长；不把合法时间戳 0 当成缺失。

### TIMELINE-006：非单调时间戳

- 优先级：P1
- 步骤：用测试数据注入相等或倒退 PTS。
- 预期：按既定契约 fail-fast 或单调 clamp，并记录诊断；禁止排序帧破坏编码/GOP 顺序；不产生负 duration。

### TIMELINE-007：Trim 半开区间

- 优先级：P0
- 步骤：对恰好落在样本时间戳上的起止点执行 Trim。
- 预期：按 `[startMs, endMs)` 选择；结束点样本不重复；普通 30fps 的 1 秒区间不会错误包含 31 帧。

## 6. 预览播放与精确定位

### PREVIEW-001：首帧加载门

- 优先级：P0
- 步骤：打开短、长、稀疏录制；在首帧出现前点击播放/Seek。
- 预期：没有黑帧闪烁和无效播放；首帧门只在正确 generation 就绪后开放；旧加载结果不能解除新请求的 loading。

### PREVIEW-002：真实时间播放

- 优先级：P0
- 步骤：原子记录播放前后 `performance.now()` 与时间线位置，真实等待约 5 秒。
- 预期：时间线前进约 5 秒；误差在一帧级别，不按样本密度加速。

### PREVIEW-003：播放、暂停与结束

- 优先级：P0
- 步骤：播放 5 秒；暂停 3 秒；继续；播放到终点；再次点击播放。
- 预期：暂停期间 playhead 不动；继续无跳变；终点停止且不越界；再次播放按产品定义从头或保持终点，行为一致且可理解。

### PREVIEW-004：关键点精确 Seek

- 优先级：P0
- 数据：DATA-02、DATA-06。
- 步骤：定位到起点、样本边界前后、静态区中点、窗口边界前后和 `end-1ms`。
- 预期：每次显示 last-frame-hold 应选帧；时间标签等于目标；Seek 命中率 100%。

### PREVIEW-005：快速乱序 Seek

- 优先级：P0
- 步骤：在长录制中快速执行 5% → 80% → 20% → 65%，每次间隔小于一个窗口加载时间。
- 预期：最终画面和 playhead 为 65%；旧请求可以完成但不能覆盖新 generation；没有短暂回零后永久停住。
- 证据：目标时间、request/generation、最终 global frame index。

### PREVIEW-006：跨读取窗口连续播放

- 优先级：P0
- 数据：DATA-06。
- 步骤：从窗口边界前至少 3 秒开始播放，连续跨越多个窗口。
- 预期：时钟连续；切窗无明显暂停、回零或重复区间；当前帧在新窗口准备期间合理持有。

### PREVIEW-007：长 GOP Seek

- 优先级：P1
- 数据：DATA-07。
- 步骤：Seek 到长 GOP 尾部目标。
- 预期：从之前关键帧连续解码到目标并只保留必要显示帧；如果当前实现不支持，返回明确错误，绝不静默截断到错误帧；decoder 会话中间不错误 flush。

### PREVIEW-008：稀疏源上的时间效果

- 优先级：P0
- 数据：DATA-02 或 DATA-01 冻结段。
- 步骤：在静态区创建 1 秒 Zoom；播放并逐帧/定时截图。
- 预期：源画面保持同一帧，但 Zoom 几何连续变化；不能只在下一源样本到达时跳变。

### PREVIEW-009：压力与最新帧优先

- 优先级：P0
- 数据：`lab/preview-playback-lab/` pressure。
- 步骤：运行完整压力场景，保存报告。
- 预期：编码/解码样本数一致；p95 显示间隔 ≤25ms；p95 和恢复后 max drift ≤34ms；Seek 100%；Worker 恢复后直接追上当前媒体时钟，不顺序播放过期位图。

### PREVIEW-010：窄容器与尺寸响应

- 优先级：P1
- 步骤：连续调整 Studio 宽度到小于 300px 可用区域再恢复；观察 Console 和画布。
- 预期：尺寸每次只提交最终 clamp 值；无 `effect_update_depth_exceeded`；画布无抖动、无限 resize 或比例变化。

### PREVIEW-011：资源稳定性

- 优先级：P1
- 步骤：播放 10 分钟或循环执行 100 次 Seek；采集 Memory 和 Worker 日志。
- 预期：已淘汰 VideoFrame 被 close；内存无持续线性增长；decoded buffer 不超过协商上限；无 detached bitmap/frame 错误。

## 7. Crop 系统测试

### CROP-001：默认完整画面

- 优先级：P0
- 步骤：首次打开 Crop，不移动控制点。
- 预期：矩形为完整 capture frame：`x=0, y=0, width=sourceWidth, height=sourceHeight`；Apply 不应意外裁掉内容。

### CROP-002：比例预设

- 优先级：P0
- 数据：包含圆、方形、16:9/1:1 框的 DATA-01。
- 步骤：依次选择 16:9、1:1 和可用预设；Apply 后播放。
- 预期：在源坐标系内居中且不越界；输出比例正确；圆不变椭圆；安全框位置符合预期。

### CROP-003：自定义拖拽边界

- 优先级：P1
- 步骤：拖动四边和四角到最小尺寸、源边缘和接近源外区域。
- 预期：坐标被 clamp；宽高保持正值；控制点不反转；无 NaN、负值或越界黑边。

### CROP-004：参数持久化与重编辑

- 优先级：P0
- 步骤：Apply 自定义 Crop；关闭面板；播放；重新进入 Crop。
- 预期：矩形、预设/自定义状态和最终合成完全一致；重新 Apply 不产生累计裁剪。

### CROP-005：高 DPR Capture 与 1080p Composition

- 优先级：P0
- 数据：captureSize 4632×2406，compositionSize 1920×1080。
- 步骤：在高 DPR 录制上 Crop，再选择 1080p/720p 导出。
- 预期：Crop 使用 capture 坐标；Studio 标识 Canvas/Composition；导出按选择缩放；不把 4632×2406 错标为默认输出。

## 8. Trim/Slice 系统测试

### TRIM-001：设置保留区间

- 优先级：P0
- 步骤：将 start/end 设置为视频中间的可识别位置并 Apply。
- 预期：时间线总长变为 `end-start`；playhead 重置到裁剪时间域起点；画面对应原视频 start。

### TRIM-002：VFR 区间与源样本数

- 优先级：P0
- 数据：DATA-02 或真实稀疏录制。
- 步骤：Trim 跨越长静态 gap；查看摘要和导出。
- 预期：摘要显示真实区间时长；源样本数可以很少但不会改变时长；静态 gap 完整保留。

### TRIM-003：播放边界

- 优先级：P0
- 步骤：在 Trim 起点播放到终点；从 `end-100ms` 播放；Seek 到 0 和最大值。
- 预期：不播放区间外帧；终点稳定停止；最大值不越界；重复播放结果一致。

### TRIM-004：重新编辑

- 优先级：P0
- 步骤：Apply Trim；关闭再打开面板；移动一个边界再 Apply。
- 预期：面板显示已应用的源时间范围；第二次编辑不是在错误的局部时间上叠加偏移。

### TRIM-005：无效和极短区间

- 优先级：P1
- 步骤：尝试 start=end、start>end、短于一目标帧、结束超过时长。
- 预期：UI 阻止或规范化为有效区间并给出反馈；Worker 不收到负时长；导出不无限等待或生成损坏文件。

### TRIM-006：Trim 后导出

- 优先级：P0
- 步骤：记录 `[startMs,endMs)`；导出 MP4；回读容器 duration 和第一/末帧画面。
- 预期：文件时长与 `end-start` 相差不超过一输出帧；首尾画面位于区间内；末帧 duration 精确补到裁剪终点。

## 9. Zoom 系统测试

### ZOOM-001：创建与播放

- 优先级：P0
- 步骤：在可识别时间点创建 Zoom，设置 2×、Smooth、1000ms；从进入前播放到退出后。
- 预期：进入、保持和退出连续；无瞬间跳变、停顿或画面超出边界。

### ZOOM-002：焦点位置

- 优先级：P1
- 步骤：分别选择左上、中心、右下和接近 Crop 边界的焦点。
- 预期：缩放围绕用户指定位置；Crop 后焦点映射正确；不使用未裁剪画面的错误坐标。

### ZOOM-003：稀疏静态段连续性

- 优先级：P0
- 步骤：在没有新源帧的静态区执行 Zoom；以 250ms 间隔截图或读取 Lab 像素。
- 预期：同一源帧在不同展示时间产生不同合成结果；运动连续，至少达到 Preview Lab 阈值。

### ZOOM-004：参数持久化

- 优先级：P0
- 步骤：Apply Zoom；关闭面板；重新打开编辑。
- 预期：Scale、easing、duration、时间点和焦点全部保持；重新保存不重复创建效果。

### ZOOM-005：相邻/重叠效果

- 优先级：P1
- 步骤：创建两个相邻或边界相接的 Zoom；再尝试重叠。
- 预期：按产品规则阻止、合并或稳定排序；UI 给出清晰反馈；播放和导出没有闪烁或未定义插值。

## 10. 导出与文件回读

### EXPORT-001：默认 MP4

- 优先级：P0
- 步骤：无编辑导出默认 MP4；回读容器。
- 预期：导出完成且只下载一个文件；codec、duration、coded/display size 合理；可被 Chrome 播放。

### EXPORT-002：分辨率选择接线

- 优先级：P0
- 步骤：分别选择 Match Canvas、720p、1080p 和自定义尺寸导出。
- 预期：对话框回调、ExportOptions、Worker composition config 和最终轨道尺寸一致；UI 选项不是装饰值。

### EXPORT-003：H.264 1920×1080

- 优先级：P0
- 数据：DATA-08、`lab/webcodecs-h264-probe/`。
- 步骤：运行 Probe；产品导出 1920×1080 MP4；回读 coded/display size 并播放边缘标记素材。
- 预期：L4 配置实编成功；最终显示 1920×1080；没有 1920×1088 黑边、拉伸或误裁底部。

### EXPORT-004：VFR 到目标时间网格

- 优先级：P0
- 数据：DATA-02，目标 2fps 或 30fps。
- 步骤：导出并检查输出 sample timestamp/duration。
- 预期：`N=ceil(duration×fps)`；每个 `t=k/fps` 取最新 `pts<=t` 源帧；最后 sample 裁短，结束时间等于 session end。

### EXPORT-005：单帧静态尾部

- 优先级：P0
- 数据：DATA-03。
- 步骤：导出 MP4；回读 duration；播放接近结尾。
- 预期：约 25 秒且一直显示首帧；无提前 ended、黑帧或仅 1 秒文件。

### EXPORT-006：取消与残留清理

- 优先级：P0
- 步骤：在初始化、合成中段和最终写入附近分别取消导出；再次正常导出。
- 预期：状态变为 canceled 而非 success；Worker 停止；局部 OPFS 文件被清理；不下载残缺文件；后续导出可成功。

### EXPORT-007：WebM 回归

- 优先级：P1
- 步骤：使用同一无编辑和组合编辑素材导出 WebM；回读和播放。
- 预期：时长与尺寸契约同 MP4；不受 H.264 偶数/level 探针逻辑影响；无共享 canvas 1088 扩边。

### EXPORT-008：GIF 时间语义

- 优先级：P2，若本版本发布 GIF 则提升为 P0。
- 步骤：导出包含稀疏静态段和运动段的 GIF；检查帧 delay 与总时长。
- 预期：按 GIF 明确策略重采样或使用可变 delay；静态 gap 不被固定 stride 压缩；UI 明示 GIF 帧率/质量差异。

### EXPORT-009：下载归属

- 优先级：P1
- 步骤：导出同时从其他页面下载文件；触发清理/取消。
- 预期：只追踪和清理本次导出的 owned download；不删除或改名用户其他下载。

## 11. 录制质量与视觉验收

### QUALITY-001：几何无形变

- 优先级：P0
- 步骤：录制 DATA-01，分别在预览和导出观察圆、正方形、16:9/1:1 框。
- 预期：圆仍为正圆；方形边长相等；比例框无拉伸；Crop/分辨率变化后结论不变。

### QUALITY-002：1px 线、网格与文字

- 优先级：P1
- 步骤：对比源页面、Studio 100% 预览和最终文件。
- 预期：1px 线不消失、不稳定闪烁、不变双线；网格无不可接受莫尔纹；12/16/28px 中英文可辨认。

### QUALITY-003：色条与灰阶

- 优先级：P1
- 步骤：观察八段色条和八级灰阶，截取同一区域对比。
- 预期：顺序正确；无明显通道交换、截断、异常偏色或严重 banding。

### QUALITY-004：匀速、快速与旋转

- 优先级：P0
- 步骤：运行段观察 6 秒匀速、1.2 秒快速和 3 秒旋转。
- 预期：匀速运动没有周期性停顿；旋转连续；快速运动允许编码损失但不能长时间冻结或撕裂。

### QUALITY-005：真正静态/0Hz

- 优先级：P0
- 步骤：录制“冻结画面”至少 10 秒，再解除冻结。
- 预期：预览和导出保留完整 10 秒；冻结时画面稳定；解除后时间线继续且不倒退；样本稀疏不被判为失败。

### QUALITY-006：录制来源对比

- 优先级：P1
- 步骤：用标签页、窗口、整个屏幕分别录制同一质量卡。
- 预期：各来源尺寸和 DPR 被正确记录；输出按 composition 统一；平台自带缩放差异有记录但不被误判为产品 Crop。

## 12. 完整组合链路

### COMBO-001：录制 → Studio → MP4

- 优先级：P0
- 数据：DATA-01。
- 步骤：快速录制当前标签页；执行动→静→动脚本；停止；进入 Studio；不编辑直接导出 MP4。
- 预期：会话时长、Studio 时长和输出时长一致；几何/运动/静态段通过；只有一个成功下载。

### COMBO-002：Crop + Trim/Slice + Zoom

- 优先级：P0
- 数据：DATA-09。
- 步骤：应用 16:9 Crop；保留一个约 13 秒区间；在区间中部创建 2×/Smooth/1000ms Zoom；播放；逐一重开编辑面板；导出 720p MP4并回读。
- 预期：Crop、Trim、Zoom 参数均保持；预览从裁剪起点到终点连续；静态区 Zoom 不暂停；输出时长等于 Trim，尺寸 1280×720，几何正确。

### COMBO-003：长录制快速定位后编辑

- 优先级：P1
- 数据：DATA-06。
- 步骤：快速 Seek 5→80→20→65%；在最终位置添加 Zoom；Crop；Trim 包含跨窗口区间；导出。
- 预期：编辑绑定最终目标而非旧请求画面；导出无窗口边界停顿、重复或缺段。

### COMBO-004：暂停 + 静态尾部 + 导出

- 优先级：P0
- 数据：DATA-05。
- 步骤：完成含暂停的录制；在静态尾部添加 Zoom；导出。
- 预期：暂停 5 秒不计入文件；静态尾部 5 秒完整保留；Zoom 按 active time 运行；总时长约 9 秒。

### COMBO-005：异常恢复后完成编辑

- 优先级：P1
- 步骤：录制中终止 Service Worker并恢复；停止后进入 Studio；完成 Crop/Trim/Zoom 和导出。
- 预期：恢复不会产生重复/断裂 session；OPFS index/meta 完整；编辑和导出与正常会话一致。

## 13. 可观测性与缺陷定位

### OBS-001：用户旅程事件完整性

- 优先级：P1
- 步骤：执行成功录制、Picker 取消、来源 ended、导出取消四条路径；导出事件日志。
- 预期：事件包含阶段、operationId/revision、模式、错误分类和时刻；同一终态只报告一次；不记录 MediaStream 或敏感页面内容。

### OBS-002：错误可操作性

- 优先级：P1
- 步骤：分别触发权限拒绝、无可用编码器、OPFS 写失败或测试桩错误。
- 预期：用户获得可理解且可重试的信息；Console 保留底层 error.name/message；失败不会被误报为取消或成功。

### OBS-003：性能证据

- 优先级：P1
- 步骤：对 PREVIEW-009、PREVIEW-011 采集 Lab JSON、Performance 和 Memory。
- 预期：报告可关联 commit、浏览器和场景；指标计算使用单调时钟；不能只用主观“看起来流畅”判定。

## 14. 缺陷修正循环

任何 FAIL 按以下顺序处理：

1. 冻结原始证据，记录 case ID、commit、环境、实际/预期和最早错误时间。
2. 缩小到最小素材和最短操作链，区分录制、Reader、Preview、Effect、Export 或浏览器边界。
3. 若边界不明确，先在 `lab/` 增加探针，并引用规范/Chrome/Mediabunny 一手资料。
4. 为可纯化的契约补 Red 测试：状态机、时间映射、窗口计划、尺寸或导出 schedule。
5. 完成最小生产修复并跑目标测试。
6. 在同一 Chrome 环境重复原失败步骤，保存修复后证据。
7. 重跑同域用例、`COMBO-002`、全部 P0 和 `GATE-001` 至 `GATE-004`。
8. 缺陷关闭记录必须包含根因、修复 commit、影响面、未覆盖平台和回滚方式。
