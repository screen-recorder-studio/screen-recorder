# Screen Recorder Studio（Chrome 扩展）

一个开源的浏览器录屏扩展，支持录制标签页、窗口、整个屏幕，以及网页元素与区域选择录制。内置 OPFS（Origin Private File System）大文件管理管线与 Studio 预览/编辑能力，适合 SaaS 产品演示、教程录制与本地视频处理。

- 许可证：MIT
- 最低 Chrome 版本：`116`

## 特性
- 录制模式：`Tab`、`Window`、`Screen`、`Element`、`Area`（元素/区域录制）
- 编码管线：基于 WebCodecs 的录制管线
- 大文件存储：OPFS 持久化，`data.mp4` + 行式索引 `index.jsonl` + `meta.json`
- 预览与编辑：Studio 支持按帧窗口读取、关键帧对齐、只读预取与导出
- 扩展 UI：弹窗（Popup）、欢迎页（Welcome）、侧边面板（SidePanel）、Drive 文件管理
- 权限最小化思路：仅在需要时调用显示媒体/脚本注入，数据仅保留在本地 OPFS 与下载

## 架构总览
- UI 层：
  - `src/routes/popup/+page.svelte`（弹窗）
  - `src/routes/welcome/+page.svelte`（欢迎页）
  - `src/routes/sidepanel/+page.svelte`（侧边面板）
  - `src/routes/studio/+page.svelte`（Studio 预览与导出）
  - `src/routes/drive/+page.svelte`（OPFS 文件管理）
- 后台与录制：
  - `src/extensions/background.ts`（Service Worker，消息路由与状态）
  - `src/extensions/offscreen-main.ts`（屏幕/窗口/标签录制、编码与 OPFS 写入）
  - `src/extensions/content.ts`（元素/区域选择与录制管线）
- 编码与存储：
  - `src/lib/workers/webcodecs-worker.ts`（编码）
  - `src/lib/workers/opfs-writer-worker.ts`（OPFS 写入）
  - `src/lib/workers/opfs-reader-worker.ts`（OPFS 按范围读取）
- 打包与清单：
  - `static/manifest.json`（MV3 权限与入口）
  - `scripts/*.mjs`（构建扩展产物）

消息流（示意）：
- UI → 后台：`REQUEST_START_RECORDING`、`REQUEST_STOP_RECORDING`、`REQUEST_TOGGLE_PAUSE`、状态请求
- UI → 内容脚本（元素/区域）：`SET_MODE`、`ENTER_SELECTION`、`START_CAPTURE`、`STOP_CAPTURE`、`TOGGLE_PAUSE`、`CLEAR_SELECTION`
- 编码 → Offscreen/Writer：`chunk`（包含编码数据+时间戳+类型）→ `append` → `finalize`
- 完成：后台广播 `OPFS_RECORDING_READY`，Studio 可用 `id=rec_<session>` 打开预览

## 快速开始
1) 安装依赖
- `pnpm install`

2) 本地开发（站点）
- `pnpm dev`
- 访问 `http://localhost:5173`（使用 SvelteKit 开发站点，以便调试 UI 组件与路由）

3) 构建扩展
- `pnpm build:extension`
- 构建脚本会生成扩展需要的 `background.js`、`content.js`、`offscreen.js`、`opfs-writer.js` 以及相关 worker 产物，并拷贝 `static/manifest.json` 到 `build/`

4) 打包扩展（zip）
- `pnpm package:extension`
- 产物：`screen-recorder-studio.zip`

5) 加载扩展
- Chrome 打开 `chrome://extensions` → 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择 `build/`

## 权限与隐私
- `desktopCapture`：用于屏幕/窗口/标签录制
- `offscreen`：离屏文档承载录制与编码管线（MV3）
- `tabs` / `scripting` / `activeTab`：元素/区域选择录制需注入内容脚本
- `storage` / `unlimitedStorage`：OPFS 持久化大文件与索引
- `sidePanel`：侧边面板 UI
- 主张权限最小化：仅在用户触发相关功能时使用。
- 隐私说明：录制数据仅存储在本地 OPFS 与用户下载文件，不会上传到远端。若未来引入云同步，将在隐私政策中明确告知与征求同意。

## 兼容性与限制
- 主要目标：Chrome MV3（`minimum_chrome_version: 116`）
- Firefox 不支持 MV3 Offscreen Document；Edge 基于 Chromium 通常兼容，但请自测
- 受限页面：`chrome://`、未授权的 `file://` 等页面无法注入内容脚本，因此元素/区域模式会自动禁用
- OPFS 支持：部分旧版浏览器或隐私模式可能不支持 OPFS；Drive/Studio 功能会做能力检测

## 目录结构（节选）
- `src/routes/*`：扩展界面（弹窗、欢迎、Drive、Studio、SidePanel 等）
- `src/extensions/*`：后台、内容脚本、离屏文档、编码入口
- `src/lib/workers/*`：OPFS 读/写、编码/导出等 Worker
- `static/*`：MV3 清单、离屏页面、图标与资源
- `scripts/*`：扩展打包脚本
- `docs/*`：实现说明、性能与 UI 文档

## 常见问题
- 元素/区域模式不可用：当前页面可能受限（如 `chrome://`），或未允许对应域的脚本注入
- 录制突然停止：用户点击了系统的「停止共享」，后台会广播 `STREAM_END` 并同步 UI 状态
- 大文件预览卡顿：Studio 会按关键帧批量读取，但首次加载巨大文件可能需要时间；建议稍后重试

## Roadmap / TODO（计划）
**稳定性**
- 日志统一：在后台/离屏/各 Worker 建立分级日志与结构化错误信息。
- 健康检查与恢复：探测 Offscreen 崩溃并自动重启，OPFS 写入失败后的安全续写。
- 背压与内存控制：限制队列、调优分片大小与刷写节奏，定期输出内存统计。
- 失败处理：当 WebCodecs 不可用或失败时，向用户给出清晰的错误提示。
- 持久化安全：录制中周期性写入 `meta.json` 检查点，`finalize` 更健壮，启动时清理孤立会话。
- 权限处理：拒绝权限时的友好流程，以及 Popup/Welcome/SidePanel 一致的状态同步。

**使用体验**
- 首次运行引导与工具提示；快速能力检测（OPFS/WebCodecs/权限）。
- 统一设置页：码率/编码器、文件命名、倒计时、快捷键，提供安全默认值。
- 录制状态清晰：计时、文件大小、暂停/恢复指示；系统“停止共享”时的横幅提示。
- Drive 优化：缩略图、时长/大小、排序与筛选、删除确认 UX。
- 可访问性：ARIA 标签、键盘导航、焦点顺序；基础 i18n（中/英切换）。

**跨系统与浏览器测试**
- Playwright 端到端：开始/暂停/停止，打开 Studio，裁剪与导出（Chromium 无头）。
- 测试矩阵：macOS/Windows/Linux 上的 Chrome stable/beta/dev 与 Edge stable。
- OPFS 能力与配额行为测试；元素/区域录制在受限页面的禁用检测。
- 导出管线正确性：裁剪范围、GIF 导出、性能基线。

**CI 与分发**
- GitHub Actions：`pnpm install` → 类型检查 → `pnpm build:extension` → E2E（Chromium）→ 上传 zip 工件。
- 可选操作系统矩阵；对大样本文件的夜间性能跑。

## 贡献
- 欢迎提交 Issue 与 Pull Request。请先阅读 `CONTRIBUTING.md` 与 `CODE_OF_CONDUCT.md`
- 建议在 PR 中：说明动机与设计，附带测试或手动验证步骤

## 许可证
- 本项目采用 MIT 许可证发布，详见 `LICENSE`

## 致谢
- 本项目参考并实践了多项现代 Web 能力：WebCodecs、OPFS、Chrome MV3 Offscreen Document 等