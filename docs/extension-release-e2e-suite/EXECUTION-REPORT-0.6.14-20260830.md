# Screen Recorder Studio 0.6.14 用户故事端到端执行报告

> 执行日期：2026-08-30
> 执行层级：Smoke（macOS 单平台；CLI 全门禁 + 关键 P0 浏览器闭环）
> 结论：灰度可发布；不声明 Windows、全量 P1、三轮资源或长时 Soak 已覆盖

## 1. 发布信息

| 字段 | 内容 |
| --- | --- |
| 版本 | 0.6.14 |
| Git branch | `codex/release-gif-area-recording` |
| 候选源码状态 | HEAD `2fc44fd51025fe5d402bed84d6622b5da5d4c09a` + 本轮版本、54 locale 元数据及干净打包差异 |
| 构建路径/hash | `packages/extension/build` / `8e464e8c4bc5abc99d7f39665609061f737bf2f21876c2135072f68ae30436bc` |
| 发布包 | `release-assets/0.6.14/screen-recorder-studio-v0.6.14.zip` |
| 发布包 SHA-256 | `7db9e22ab468901933e193d802ed04d1e5aa8f057d14bc6999f8b65166b91979` |
| Manifest 版本 | 0.6.14 |
| 扩展 ID | `bondbeldfibfmdjlcnomlaooklacmfpa` |
| 本地 unpacked ID | `hjknmbigiplfnijadglappikppmecpga` |
| 上一发布版 | Chrome Web Store 公开版 0.6.12 |
| 执行人 | Codex + Computer Use |

## 2. 环境

| 环境 ID | OS/硬件 | Chrome | DPR/显示器 | 安装状态 | 备注 |
| --- | --- | --- | --- | --- | --- |
| ENV-MAC-LOCAL | macOS 26.5.2 / arm64 | Stable 152.0.7977.64 | 页面初始 DPR 1；tab capture 期间报告 DPR 2 | upgrade/reload existing unpacked | 1920×963 viewport；正式 `build/` |

## 3. CLI 与构建门禁

| Case ID | 命令/检查 | 结果 | 摘要/证据 |
| --- | --- | --- | --- |
| GATE-001 | `pnpm test` | PASS | 82 个测试文件、420 项测试全部通过 |
| GATE-002 | `pnpm check` | PASS | 0 error；18 条既存 Svelte `state_referenced_locally` warning，分布于 4 个文件 |
| GATE-003 | `pnpm build:extension` | PASS | 正式构建成功；release logging policy 验证 87 个 JS bundle；236 个构建文件；无 UI Lab/debug route |
| GATE-004 | 版本/Manifest/权限/声明审计 | PASS | 根包、扩展包、源与 build Manifest 均为 0.6.14；无 `host_permissions`；权限集合未扩大；54 locale 标题/摘要均在长度限制内 |
| GATE-005 | `pnpm test:e2e:catalog` | PASS | 15 stories、54 cases；P0=32、P1=22、Smoke=27 |
| GATE-006 | 候选完整性 | PASS | `git diff --check` 通过；ZIP 302 个条目与 build 精确一致、无旧哈希资源、无缺失文件；旧 0.6.12 资产未纳入候选包 |

## 4. i18n 与页面结构审计

- 新页面结构中的 GIF Area、Crop、Focus、背景、GIF 导出和错误关闭文案已从硬编码迁移到目录键。
- `en` 503 个键、`zh_CN` 504 个键；产品源码中的字面量 `t(...)`、`gifText(...)`、`areaText(...)` 均有 en/zh_CN 定义，placeholder 位置一致。
- 修复 web/preview 模式优先级：已加载语言目录现在优先于组件内英文 fallback，避免 zh_CN 页面结构混排。
- Chrome 实页复验：`popup.html?l=zh_CN` 的新结构完整中文化；`Drive`/`Studio` 保留产品名。
- 缺失键复验：俄语目录 399 个键；新增 GIF Area 键缺失时回退为可理解英文，无原始 key 泄露。
- 54 个 locale 的商店标题/摘要已同步本期定位；其余 52 个 locale 的新增界面键仍沿用 Chrome `default_locale=en` 回退策略。

## 5. 关键浏览器用例结果

| Case ID | 结果 | 实际结果 | 证据/限制 |
| --- | --- | --- | --- |
| AREA-001 | PASS | 360px Action 中 GIF 入口为语义 button，文案/版本 0.6.13 功能候选正常，无横向溢出 | 0.6.14 仅调整版本与包内商店元数据，功能代码未变 |
| AREA-002 | PASS | Cadence motion gate 精确选择 `640×360`；停止后一次性打开新 recording 的 GIF Studio | recording `rec_1788028007186`；输出 GIF 80 帧中 38 个唯一帧 |
| AREA-003 | PARTIAL | Esc 取消与偏差区域重选可恢复，最终回显 `640×360` | 未覆盖页面取消、Action 取消、过小区域三条独立分支 |
| AREA-004 | PARTIAL | DPR 变化期间选区仍回显 `640×360`，预览只显示青色目标区域，选区外内容不可见 | 未覆盖所有 zoom/右下边界矩阵 |
| AREA-007 | PASS | `chrome://extensions` 显示 “This page does not allow area selection”，未启动录制；回普通页后入口恢复 | 受限页 fail-closed UI + 后续正常 Action |
| ENTRY-001 | PASS | Tab 模式 0 秒倒计时启动，无系统 Picker，停止后进入正确非 GIF Studio | recording `rec_1788028348639` |
| SESSION-001 | PASS | 3 秒倒计时/正式开始边界可见；区域选择框在捕获前隐藏 | 首帧为 Motion Lab `0000`，GIF 帧延迟 100ms |
| STUDIO-001 | PASS | URL 精确打开 `rec_1788028007186&intent=gif`；旧录制未误选；默认进入 GIF delivery / Original frame | Studio URL 与 Action/Manager 状态 |
| STUDIO-002 | PASS（证据限制） | 播放时 clock/frame index 前进；导出回读证明源帧持续变化 | Computer Use 截图对合成 canvas 捕获为首帧缓存，视觉差异以导出像素 hash 替代 |
| EDIT-002 | PASS（主路径） | Trim 数值回显；区域录制裁为 8 秒、视频录制裁为 5 秒，导出时长与设置一致 | 未覆盖无效/极短输入 |
| EXPORT-001 | PASS | GIF 默认：10 fps、Email width 600×337、Play 3 times / repeat=2，并显示邮件体积建议 | 导出弹窗无障碍树 |
| EXPORT-002 | PASS | GIF89a、trailer `0x3b`、600×337、80 帧、8000ms、38 unique frame hash、loop=2 | 下载文件 SHA-256 见下表 |
| EXPORT-003 | PASS（已知边界） | 49.9 秒/600px/10fps 显示“过重”建议且导出失败；Trim 到 8 秒后重试成功 | 长 GIF 需 Trim/降 fps/降尺寸；未采集内存峰值 |
| EXPORT-004 | PASS（主路径） | MP4 导出可解析：AVC、1920×1080、5.000s、150 packets、30fps | 未额外覆盖非默认分辨率 |
| EXPORT-005 | PASS（结构回读） | WebM 实际导出：VP9、1920×1080、4.000s、1,087,221 bytes | Chrome 视频页截图失败，未声明视觉播放观察 |
| MANAGER-001 | PASS | 最新条目排序在首位；先打开旧 ID，再从 Manager 精确回开 `rec_1788028007186` | URL/选中条目一致 |
| TRUST-002 | PASS | 无 host permissions；受限页 fail-closed；商店公开版权限与候选一致 | Manifest/Store UI/受限页 |
| I18N-001 | PASS（目录与主页面） | en、zh_CN 无 raw key；ru 缺失新增 key 时显示可理解英文 fallback | 未逐一人工走完 54 locale 全旅程 |

## 6. 导出文件回读

| Case ID | 格式 | 文件 | bytes | 宽×高 | 时长/帧数 | 动态帧 | 结果 |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| EXPORT-002 | GIF89a | `screen-recording-gif-2026-08-29T18-30-03-594Z.gif` | 4,424,251 | 600×337 | 8.000s / 80 | 38 unique SHA-256；loop=2；100ms delay | PASS |
| EXPORT-004 | H.264/MP4 | `edited-video-2026-08-29T18-33-59-227Z.mp4` | 794,033 | 1920×1080 | 5.000s / 150 packets / 30fps | 动态标签页源 | PASS |
| EXPORT-005 | VP9/WebM | `release-assets/0.6.14/qa/webm-export-4s.webm` | 1,087,221 | 1920×1080 | 4.000s | EBML/VP9 容器回读 | PASS（结构） |

- GIF SHA-256：`4f9f2d865ccf44928814e65a5a23c211fd3a4468ef2f24914fba515dbb735368`
- MP4 SHA-256：`2b03722909a6f65a1fc83a0f4293dd58c6a63f0b0937ac9a1390212f962b8946`
- WebM SHA-256：`3ec3c7c2c5f735219767c3fd31bb39408fa0ab1541e4c47ac720d7ffb29cc624`
- MP4 parser：codec `avc`；coded/display 均为 1920×1080；rotation 0；平均 bitrate 1,268,308.8 bps。

## 7. 网络、权限与隐私

- Manifest 权限：`desktopCapture`、`tabCapture`、`downloads`、`storage`、`unlimitedStorage`、`activeTab`、`scripting`、`tabs`、`offscreen`；无 `host_permissions`。
- 产品源码网络调用静态扫描只发现：扩展自有 worker URL、可选预设背景图片读取、web preview 语言目录读取；未发现媒体/帧/OPFS 上传或遥测发送路径。
- GIF Area 预览只显示选区内容，选区外页面未出现在 Studio 或导出 GIF。
- 本轮未采集完整 DevTools HAR，因此 TRUST-001 仍记为覆盖缺口，不把静态扫描等同于网络抓包。

## 8. 已知限制与覆盖缺口

| 用例/环境 | 状态 | 原因 | 风险/处理 |
| --- | --- | --- | --- |
| Windows / ENV-WIN-LOW | NOT RUN | 当前仅有本机 macOS 环境 | 按套件规则最高为单平台灰度结论 |
| Window / Screen Picker 主路径 | NOT RUN | 本轮重点为新增 Tab/GIF Area，无第二屏和窗口矩阵 | 下一轮补 ENTRY-002/003/004 |
| 全量编辑 parity | NOT RUN | 未执行组合 Crop+Focus+Background 三格式 | WebM 主路径已实际导出并完成结构回读，但不声明 P1 Full |
| 三轮资源释放 / 长时 Soak | NOT RUN | 未执行 3 轮与 10/30/60 分钟录制 | 不声明 Extended 稳定性 |
| TRUST-001 HAR | NOT RUN | 无完整 DevTools Network 导出 | 上线后继续监控；静态审计未见上传路径 |
| 长 GIF | KNOWN LIMIT | 49.9 秒、600px、10fps 导出失败；8 秒重试成功 | UI 已提前提示 Trim/降 fps/降尺寸；邮件主场景 8 秒通过 |

## 9. 发布结论

- 判定：**灰度可发布**。
- 范围：Chrome Stable 152 / macOS arm64；0.6.14 候选包可上传 Chrome Web Store。
- 硬门槛：自动测试、类型检查、正式构建、日志策略、版本/权限、关键 GIF Area→Studio→GIF 与 Tab→Studio→MP4 闭环均通过。
- 不声明：Windows、全量 32 个 P0 人工矩阵、P1 Full、三轮/长时 Soak 已覆盖。
- 回滚条件：区域录制出现选区外内容、GIF 退化为单帧、Stop 后无法进入精确 Studio、MP4/GIF 下载不可解析、Manager 打开错误 ID、权限或网络行为异常。
- 发布操作：Chrome 应用商店已上传 0.6.14 ZIP，8 个语言说明、四组各 5 张本地化截图及 5 张英文全局兜底截图均已保存并复核。首次提交提示菲律宾语、印地语、克罗地亚语和斯瓦希里语元数据不一致，补齐四份本地化长说明后警告消除；2026-08-30 已成功提交审核，当前状态为“待审核”，并启用审核通过后自动发布。公开版在审核通过前仍为 0.6.12。
