# 扩展用户故事端到端测试用例

## 1. 通用约定

- 所有浏览器用例必须从待发布 commit 的正式 `build/` 加载 unpacked 扩展。
- 默认使用 ENV-CLEAN、Chrome Stable、100% 页面 zoom；用例明确要求时切换环境。
- 录制用例必须记录 operationId、最终 recordingId、录制来源和关键时间点。
- 导出用例必须回读文件；“按钮可点击”“下载存在”不等于 PASS。
- 任何自动化工具都不得绕过 Chrome Picker、安全权限或直接篡改产品状态来制造 PASS。
- P0 用例必须保留可复核证据；Console 未处理异常、重复文件、残留 live track 均需记录。

## 2. CLI 与发布门禁

### GATE-001 全量自动化测试

- 故事：US-12；优先级/层级：P0 / Smoke；执行：自动化。
- 步骤：运行 `pnpm test`，记录 commit、文件数、测试数和退出码。
- 预期：退出码 0；无 skipped P0 契约；失败测试不得通过重跑掩盖。
- 证据：完整命令和日志摘要。

### GATE-002 Svelte 与 TypeScript 检查

- 故事：US-14；优先级/层级：P0 / Smoke；执行：自动化。
- 步骤：运行 `pnpm check`，对 warning 与上一发布版做差异分类。
- 预期：0 error；新增 warning 有责任人和发布判断。
- 证据：diagnostic 数量、文件和变化说明。

### GATE-003 正式扩展构建与发布日志策略

- 故事：US-02、US-03、US-09、US-10；优先级/层级：P0 / Smoke；执行：自动化。
- 步骤：运行 `pnpm build:extension`；检查 manifest、background、offscreen、area selector、录制/导出 Worker 和页面产物。
- 预期：构建成功；所有引用资产存在；release bundle 日志策略通过；没有混入 Lab 权限或 debug 资产。
- 证据：构建日志、扫描 bundle 数、build hash。

### GATE-004 版本、Manifest、权限和发布声明一致性

- 故事：US-13；优先级/层级：P0 / Smoke；执行：辅助自动化。
- 步骤：比较根/扩展 package、源 Manifest、build Manifest 和发布说明；列出权限与对应用户能力。
- 预期：版本一致；权限无未说明扩大；描述不宣称未实现的云上传、智能元素或交付保证。
- 证据：版本/权限 diff 和文案审计表。

### GATE-005 用户故事套件结构校验

- 故事：US-12；优先级/层级：P0 / Smoke；执行：自动化。
- 步骤：运行 `pnpm test:e2e:catalog`。
- 预期：故事/用例 ID 唯一；所有引用有效；每个 P0 故事至少有一个 P0 Smoke 用例；Markdown 与 JSON 一致。
- 证据：校验输出。

### GATE-006 Git 与候选构建完整性

- 故事：US-12；优先级/层级：P0 / Smoke；执行：辅助自动化。
- 步骤：记录当前分支/HEAD；运行 `git diff --check`、`git status --short`；核对构建来自该 HEAD。
- 预期：无空白错误或未知源码改动；大体积证据/ZIP 未误提交；发布提交不直接落在受保护主分支。
- 证据：Git 状态、HEAD、build hash。

## 3. 首次安装与导航

### ONB-001 全新安装 Welcome

- 故事：US-01、US-13；优先级/层级：P1 / Full；执行：人工。
- 前置：ENV-CLEAN，首次安装扩展。
- 步骤：观察安装后页面；阅读价值、隐私、格式和使用路径；仅用键盘浏览主操作。
- 预期：只打开一个 Welcome；没有空白/缺 key；本地处理、无水印、支持格式与实际一致；下一步明确。
- 证据：首屏与主要说明截图、Console。

### ONB-002 从 Welcome 完成第一次标准录制

- 故事：US-01、US-02、US-05；优先级/层级：P1 / Full；执行：人工。
- 步骤：在 Welcome 选择 Tab；开始、等待倒计时、录制 DATA-01、停止。
- 预期：状态不与 Action 冲突；停止后打开唯一 Studio；录制动态且可播放。
- 证据：Welcome 状态、Action 状态、Studio recordingId。

### NAV-001 Action 到 Manager 和最近 Studio

- 故事：US-11；优先级/层级：P1 / Full；执行：浏览器辅助。
- 前置：至少两条 OPFS 录制。
- 步骤：从 Action 分别打开 Recording Manager 和最近 Studio。
- 预期：各只打开一个目标页；最近 Studio 指向最新可用录制；返回 Action 不改变录制状态。
- 证据：页面 URL、recordingId、窗口数量。

## 4. 标准录制入口

### ENTRY-001 当前标签页主路径

- 故事：US-02、US-04、US-05；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 数据：DATA-01。
- 步骤：Action 选择 Tab；3 秒倒计时；录制动态 8～12 秒；停止。
- 预期：不出现 Display Picker；倒计时前不写正式首帧；只录当前 Tab；Studio 打开正确录制。
- 证据：倒计时、track settings、首帧、recordingId。

### ENTRY-002 窗口录制

- 故事：US-02；优先级/层级：P1 / Full；执行：人工。
- 步骤：选择 Window；Picker 选择非当前窗口；跨其内部页面操作后停止。
- 预期：捕获目标与 Picker 一致；尺寸正确；Action 控制不绑定错误窗口。
- 证据：Picker 选择、track settings、Studio 画面。

### ENTRY-003 整屏录制

- 故事：US-02；优先级/层级：P1 / Full；执行：人工。
- 步骤：选择 Screen；Picker 选择目标显示器；在两个应用间切换；停止。
- 预期：目标显示器画面完整；无错误裁剪；结束后 live track 关闭。
- 证据：显示器信息、Studio 画面、track end。

### ENTRY-004 Picker 取消与重试

- 故事：US-02、US-12；优先级/层级：P0 / Smoke；执行：人工。
- 步骤：打开 Window/Screen Picker 后取消；重开 Action；再次发起并成功录制。
- 预期：取消后没有假 recording/countdown/owner；显示可操作错误；重试使用新 operationId 并成功。
- 证据：状态迁移、两个 operationId、最终录制。

## 5. GIF Area 录制

### AREA-001 GIF 入口的可发现性与动作语义

- 故事：US-03、US-14；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 步骤：以 360px Action 宽度检查 GIF 入口；Tab 键聚焦并按 Enter/Space 发起。
- 预期：入口是语义 button；边框、hover/focus、箭头和文案清楚表达可点击；与分隔线有可见留白；无横向溢出。
- 证据：默认/hover/focus 截图、DOM role、宽度测量。

### AREA-002 选区到动态 Studio 主路径

- 故事：US-03、US-05、US-06、US-10；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 数据：DATA-02。
- 步骤：点击 GIF 录制；框住 Motion Lab 动画与 frame counter；确认；录制 6～10 秒；停止。
- 预期：选区层关闭后才进入正式帧；OPFS meta 为 area/gif；Studio 打开精确 ID 且默认 GIF；播放时动画和 counter 变化。
- 证据：选区截图、meta、Studio 0s/2s/末帧截图差异。

### AREA-003 取消、Esc 与重选

- 故事：US-03、US-12；优先级/层级：P0 / Full；执行：浏览器辅助。
- 步骤：分别用 Esc、页面取消、Action 取消；再选择过小区域；重选有效区域并录制。
- 预期：取消回 idle；overlay/监听器移除；过小区域不能开始；重试无旧几何/operation 污染。
- 证据：每种状态、DOM overlay 数、operationId。

### AREA-004 DPR、页面缩放和边界几何

- 故事：US-03；优先级/层级：P0 / Full；执行：半自动。
- 数据：DATA-03；环境：ENV-HIDPI。
- 步骤：逐项执行 zoom/DPR/右下边界选区；读取 OPFS capture/crop meta；在 Studio 查看边界标记。
- 预期：CSS→source 换算正确；选区外像素不可见；允许编码对齐但无拉伸、黑边或累计 1px 漂移。
- 证据：CSS rect、source frame、crop rect、输出截图。

### AREA-005 滚动时固定视口语义

- 故事：US-03；优先级/层级：P1 / Full；执行：人工。
- 步骤：选定固定视口区域；录制中滚动页面，让不同内容经过该位置。
- 预期：录制保持同一屏幕区域，不追踪原 DOM 元素；滚动内容按经过区域出现；尺寸不变。
- 证据：页面与 Studio 对照视频。

### AREA-006 Resize、导航和文档代次失效

- 故事：US-03、US-12；优先级/层级：P1 / Full；执行：人工。
- 步骤：选区后确认前分别 resize viewport、修改 zoom、同标签导航/刷新；尝试确认旧选区。
- 预期：旧 selection/documentId 被拒绝或要求重选；不会录制错误页面或静默回退全屏。
- 证据：错误码、session、无新 OPFS 目录。

### AREA-007 受限页面 fail-closed

- 故事：US-03、US-12、US-13；优先级/层级：P0 / Smoke；执行：人工。
- 数据：DATA-01 与 `chrome://extensions`/Chrome Web Store。
- 步骤：在受限页点击 GIF 录制，再回普通 HTTPS 页重试。
- 预期：受限页显示明确不可选提示；不启动全页录制、不残留 selecting；普通页随后成功。
- 证据：错误 UI、session、OPFS 目录变化。

## 6. 会话控制与恢复

### SESSION-001 倒计时与正式首帧

- 故事：US-04；优先级/层级：P0 / Smoke；执行：半自动。
- 步骤：分别以 0s/3s 启动 Tab 和 GIF Area；倒计时期间显示醒目标记。
- 预期：0s 无伪倒计时；3s 顺序正确；正式首帧不含倒计时/selector 标记；timestamp 0 可解码。
- 证据：时间点、首帧、OPFS 首条 index。

### SESSION-002 Popup 关闭与重开

- 故事：US-04；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 步骤：在 requesting、recording、paused、finalizing 分别关闭 Popup，再重开。
- 预期：媒体会话不依赖 Popup；状态、模式、intent 和 elapsed 恢复；没有重复启动/停止。
- 证据：每阶段前后截图、operationId/revision。

### SESSION-003 Pause/Resume active clock

- 故事：US-04、US-06；优先级/层级：P0 / Smoke；执行：半自动。
- 步骤：录 3 秒、暂停 5 秒、恢复录 3 秒、停止。
- 预期：active duration 约 6 秒而非 11 秒；恢复画面继续变化；Studio/导出时长一致。
- 证据：时间戳、meta、Studio/输出 duration。

### SESSION-004 Stop 与 finalize 幂等

- 故事：US-04、US-12；优先级/层级：P0 / Smoke；执行：半自动。
- 步骤：快速双击 Stop；再测试 Popup Stop 与 Chrome Stop Sharing 近同时发生。
- 预期：仅一次 finalize、一个 recordingId、一次 Studio 打开；index/data/meta 完整；最终无 live track。
- 证据：消息计数、OPFS 目录、窗口/下载数。

### SESSION-005 来源主动结束

- 故事：US-04、US-12；优先级/层级：P1 / Full；执行：人工。
- 步骤：分别点击 Chrome Stop Sharing、关闭被捕获 Tab/Window。
- 预期：track ended 被识别；可用产物安全 finalize，不可用产物给出明确失败；UI 不停留 recording。
- 证据：track event、session 终态、OPFS 完整性。

### SESSION-006 Service Worker 回收与扩展重载

- 故事：US-04、US-12；优先级/层级：P1 / Full；执行：人工。
- 步骤：录制中终止 Service Worker；重开 Action 并停止；另起一轮在 recording/finalizing 时 reload 扩展。
- 预期：SW 回收后能 reconcile live Offscreen；reload 后不伪恢复已失效 stream；旧录制可识别且新会话可启动。
- 证据：session storage、Offscreen 状态、终态和重试。

### SESSION-007 并发启动与连续三轮资源释放

- 故事：US-04、US-12、US-15；优先级/层级：P1 / Full；执行：半自动。
- 步骤：活动录制中从另一个入口再次开始；随后连续三轮录制→Studio→导出。
- 预期：第二 owner 被拒绝；每轮 operation 唯一；结束后 track/reader/encoder/Worker 释放；资源不单调增长。
- 证据：错误码、operation 列表、每轮资源快照。

## 7. Studio 交接与预览

### STUDIO-001 精确 recording 与 GIF intent 交接

- 故事：US-05、US-10；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 步骤：先存在旧录制，再完成新 GIF Area；记录 OPFS ready id 和打开 URL。
- 预期：只打开一次；URL/加载内容是新 ID；delivery profile 为 GIF；旧录制不被误选。
- 证据：ready message、URL、meta、导出默认页。

### STUDIO-002 首帧、动态播放、暂停和终点

- 故事：US-06；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 数据：DATA-02。
- 步骤：等待首帧；截图；播放 2 秒截图；暂停；继续到终点。
- 预期：无黑帧；两截图视觉不同；暂停时 clock 不动；终点不越界；无 detached frame/未处理异常。
- 证据：0s/2s/末帧、clock、Console。

### STUDIO-003 Seek、静态 Hold 与快速乱序定位

- 故事：US-06、US-07；优先级/层级：P0 / Smoke；执行：半自动。
- 数据：DATA-04/05。
- 步骤：Seek 起点、样本边界前后、静态中点、end-1ms；快速执行 5%→80%→20%→65%。
- 预期：last-frame-hold 正确；最终画面为 65%；旧 generation 不覆盖新目标；时钟无回退。
- 证据：目标/实际时间、frame index、generation。

### STUDIO-004 加载失败、旧录制与重试

- 故事：US-06、US-12；优先级/层级：P1 / Full；执行：半自动。
- 数据：DATA-06/07。
- 步骤：打开历史兼容录制、缺失数据录制和构建代次错配 Studio；执行可用的重试/重载入口。
- 预期：兼容数据可播放或明确估算；损坏数据给出可操作错误；刷新/重载原因明确，不伪装成格式错误。
- 证据：错误码/UI、fallback timing source、恢复结果。

## 8. Studio 编辑

### EDIT-001 Crop 与比例

- 故事：US-08；优先级/层级：P1 / Full；执行：浏览器辅助。
- 数据：DATA-04/08。
- 步骤：依次选择 1:1、16:9、9:16 和自定义 Crop；拖到边界；应用后重开面板。
- 预期：几何 clamp 正确；无拉伸/黑边；参数回显；预览与实际输出画布一致。
- 证据：crop 参数、预览截图、输出截图。

### EDIT-002 Trim 边界与重编辑

- 故事：US-07；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 步骤：保留 `[2000ms, 7000ms)`；播放到两端；重开 Trim 并细调；尝试无效/极短区间。
- 预期：区间约 5 秒；结束样本不重复；播放不越界；无效区间被阻止且原设置不丢失。
- 证据：起止值、playhead、duration。

### EDIT-003 Focus/Zoom 时序与焦点

- 故事：US-07；优先级/层级：P1 / Full；执行：浏览器辅助。
- 步骤：在左上/中心/右下创建 focus；修改 scale、easing、duration；在静态段和相邻效果中播放。
- 预期：目标位置正确；过渡按媒体时间连续；静态源仍有缩放动画；相邻效果无闪回。
- 证据：效果参数、关键时间截图/视频。

### EDIT-004 背景、Padding、圆角、阴影与持久化

- 故事：US-08、US-13；优先级/层级：P1 / Full；执行：浏览器辅助。
- 数据：DATA-08。
- 步骤：组合纯色/渐变/壁纸/本地图、padding、radius、shadow；切换录制；重开 Studio。
- 预期：配置作用于预期录制；上传图不外传；切换/重开不串数据；预览无明显裁切错误。
- 证据：配置快照、Network、重开前后截图。

### EDIT-005 Original frame 与 Styled canvas 往返

- 故事：US-08、US-10；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 数据：DATA-02 的动态 GIF Area 录制。
- 步骤：以 Original frame 打开 Studio；切到 Styled canvas 并选择渐变、padding、radius、shadow；再切回 Original frame；播放并导出 8 秒 Small GIF。
- 预期：切回后预览立即恢复 source composition size；背景、padding、圆角和阴影全部消失且相关控制隐藏；Small 的输出宽度精确为 320px，不出现 319px；GIF 仍为动态。
- 证据：往返前后截图、source/composition 尺寸、导出 parser 摘要与文件尺寸。

## 9. 导出与产物回读

### EXPORT-001 GIF intent 默认与邮件参数

- 故事：US-10；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 前置：从 GIF Area 进入 Studio。
- 步骤：打开导出弹窗，不修改设置。
- 预期：默认格式 GIF；fps=10；“Email width”宽度精确为 600px（源更小时不放大）；UI 显示总共播放 3 次且 repeat metadata=2；显示邮件体积建议。
- 证据：对话框字段、source/output 尺寸、delivery profile。

### EXPORT-002 GIF 必须真正动画且结构有效

- 故事：US-03、US-06、US-10；优先级/层级：P0 / Smoke；执行：半自动。
- 数据：AREA-002 的动态录制。
- 步骤：导出 GIF；回读 signature/trailer、帧数、delay、总时长；解码首帧/中间帧/末帧。
- 预期：GIF87a/89a 有效且以 trailer 结束；至少两个视觉不同帧；动画顺序与 Motion Lab 一致；时长误差在一个 GIF 帧以内。
- 证据：parser 摘要、三帧截图/像素 hash、文件 bytes。

### EXPORT-003 GIF 体积建议、实际预算与内存拒绝

- 故事：US-10、US-15；优先级/层级：P0 / Smoke；执行：半自动。
- 步骤：分别导出估算 good/caution 场景并比较实际 bytes；构造超 memory budget 计划。
- 预期：实际体积与 UI 风险不产生危险反向误导；超预算在分配大量 RGBA 前失败；错误可通过降尺寸/fps 重试。
- 证据：估算区间、实际 bytes、advisory、内存峰值、重试结果。

### EXPORT-004 MP4 主路径

- 故事：US-09；优先级/层级：P0 / Smoke；执行：半自动。
- 步骤：以默认和一个非默认分辨率导出 MP4；回读 codec、display size、duration、首尾帧。
- 预期：可播放 H.264/MP4；尺寸和时长与 UI 一致；无 1080→1088 可见黑边或拉伸。
- 证据：metadata、播放器截图、文件 hash/bytes。

### EXPORT-005 WebM 主路径

- 故事：US-09；优先级/层级：P1 / Full；执行：半自动。
- 步骤：导出 WebM；回读 codec、尺寸、duration 和最后一帧持续时间。
- 预期：可播放；末帧/静态尾部不提前结束；编辑效果与预览一致。
- 证据：metadata、末尾帧和 duration。

### EXPORT-006 组合编辑三格式 parity

- 故事：US-07、US-08、US-09、US-10；优先级/层级：P1 / Full；执行：半自动。
- 步骤：组合 Crop + Trim + Focus + Background；分别导出 MP4/WebM/GIF。
- 预期：三格式使用同一编辑语义；可容忍编码差异，但构图、时间区间、焦点和背景一致。
- 证据：相同时间点三格式截图、参数、duration。

### EXPORT-007 取消、失败、清理与重试

- 故事：US-09、US-10、US-12；优先级/层级：P0 / Full；执行：半自动。
- 步骤：导出进行中取消；制造 worker/codec/空间不足失败；修改设置重试。
- 预期：进度停止；临时 OPFS/下载残片清理；UI 不锁死；重试成功且只产生 owned download。
- 证据：目录/下载前后、错误码、重试文件。

## 10. Recording Manager

### MANAGER-001 列表、排序与打开精确录制

- 故事：US-11；优先级/层级：P0 / Smoke；执行：浏览器辅助。
- 前置：至少三条不同时间和尺寸录制。
- 步骤：从 Action 打开 Manager；核对数量、顺序、时长/尺寸/大小；点击中间一条编辑。
- 预期：列表与 OPFS 一致；卡片信息正确；打开对应 recordingId 而非最新一条。
- 证据：OPFS 清单、Manager、Studio URL。

### MANAGER-002 缩略图、残缺录制和刷新

- 故事：US-11、US-12；优先级/层级：P1 / Full；执行：半自动。
- 数据：DATA-07。
- 步骤：加载完整/残缺录制；等待缩略图；刷新 Manager。
- 预期：完整录制缩略图可见或给出明确预览错误；残缺状态可识别；单卡失败不使整个列表崩溃。
- 证据：卡片状态、Console、刷新前后列表。

### MANAGER-003 单个与批量删除确认

- 故事：US-11、US-14；优先级/层级：P0 / Full；执行：浏览器辅助。
- 步骤：单删先取消再确认；选择多条批删；用 Esc/Tab 测试确认对话框。
- 预期：取消不删除；确认只删除目标；批量选择数正确；焦点被 trap 并回到触发点；OPFS 同步。
- 证据：删除前后目录、对话框焦点、剩余列表。

### MANAGER-004 浏览器重启与扩展升级后的数据保留

- 故事：US-11、US-12；优先级/层级：P0 / Full；执行：人工。
- 环境：ENV-UPGRADE。
- 步骤：上一版创建录制；重启浏览器；安装/重载候选版；打开 Manager 和旧录制。
- 预期：OPFS 数据未被误删；完整旧录制可打开/导出，或明确说明兼容限制；新旧录制可区分。
- 证据：升级前后目录、Manager、旧 Studio 结果。

## 11. 信任、无障碍与本地化

### TRUST-001 本地处理与网络观察

- 故事：US-13；优先级/层级：P0 / Smoke；执行：人工观察。
- 步骤：打开扩展相关 DevTools Network；执行录制、编辑、上传本地背景和三格式导出；不点击外部链接。
- 预期：媒体、帧、OPFS 内容和上传背景不发送到外部；只有扩展自身静态资源请求；无遥测泄露页面 URL/标题。
- 证据：过滤后的 HAR/Network 截图、请求分类。

### TRUST-002 权限、受限页面与商店声明

- 故事：US-13；优先级/层级：P0 / Full；执行：辅助自动化。
- 步骤：审计 Manifest 权限和 host permissions；对照 Welcome、发布说明、隐私政策；在受限页触发入口。
- 预期：每项权限有真实用途；无隐式广泛 host 权限；fail-closed；文案不承诺未实现能力。
- 证据：权限表、文案 diff、受限页结果。

### A11Y-001 主旅程键盘与焦点

- 故事：US-14；优先级/层级：P1 / Smoke；执行：人工。
- 步骤：仅用 Tab/Shift+Tab/Enter/Space/Esc 完成 Action 选择、Area 取消/确认、Studio 播放/编辑、导出弹窗关闭和 Manager 删除取消。
- 预期：无键盘陷阱或不可见焦点；语义 button 可操作；dialog 焦点受控并恢复；状态通过 live region/文本可理解。
- 证据：焦点顺序录像、无障碍树关键节点。

### A11Y-002 对比度、明暗环境和窄宽度

- 故事：US-14；优先级/层级：P1 / Full；执行：浏览器辅助。
- 步骤：在系统明/暗模式和 360px/窄 Studio 宽度检查 Popup、selector、Studio、export、Manager、Welcome；测关键颜色对比度。
- 预期：浏览器表面与 Studio 语境一致；正文/控件达到 WCAG 2.2 AA 目标；无文本截断遮挡或横向溢出。
- 证据：截图、尺寸与对比度测量。

### I18N-001 英文、简中与缺失 key 回退

- 故事：US-14；优先级/层级：P1 / Full；执行：半自动。
- 数据：DATA-09。
- 步骤：切换 en、zh_CN 和一个缺少新增 key 的 locale；走 Action→GIF Area→Studio→Export→Manager。
- 预期：en/zh 无原始 key；fallback 可理解；参数替换正确；长文本不破坏按钮和对话框。
- 证据：每 locale 主页面截图、缺失 key 日志。

## 12. 性能与稳定性

### PERF-001 Balanced 1080p 主旅程预算

- 故事：US-15；优先级/层级：P1 / Full；执行：半自动。
- 数据：DATA-02/04；环境：目标发布设备。
- 步骤：1080p/30 录制 60 秒；打开 Studio、播放/Seek；导出默认视频和邮件 GIF。
- 预期：Capture 保持实时余量；页面可交互；Studio 首帧/Seek 无长冻结；导出 RTF 与上一版无不可解释回退。
- 证据：startup、capture RTF、dropped frames、first frame、Seek P95、export RTF。

### PERF-002 连续三轮与长时 Soak

- 故事：US-04、US-15；优先级/层级：P1 / Extended；执行：半自动。
- 数据：DATA-10；环境：ENV-WIN-LOW 和主发布设备。
- 步骤：三轮完整旅程；按变更风险执行 10/30/60 分钟录制；每阶段采集资源。
- 预期：无单调内存/Worker/live track 增长；OPFS 增量与录制合理；长时停止/Studio/导出仍成功。
- 证据：资源曲线、录制/输出摘要、异常日志。

## 13. 深度技术回归引用

当本套件失败指向媒体时间、解码、内存或 Worker 边界时，继续执行：

- [录制技术 TEST-CASES](../recording-e2e-test-suite/TEST-CASES.md) 中的 TIMELINE、PREVIEW、CROP、TRIM、ZOOM、EXPORT、PERF；
- [GIF Area 垂直切片评估](../GIF-AREA-RECORDING-VERTICAL-SLICE-EVALUATION.md)；
- [GIF 媒体管线评估](../GIF-MEDIA-PIPELINE-STUDIO-EXPORT-EVALUATION.md)；
- `packages/extension/test-pages/gif-lab/` 与仓库 `lab/` 下对应独立实验。
