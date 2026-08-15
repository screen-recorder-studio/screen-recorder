# Screen Recorder Studio v0.6.12 发布前 E2E 测试报告

> **发布结论：不可直接发布（Release blocked）**
>
> 构建门禁、主录制链路、Popup 重开、暂停/恢复、来源结束、Preview Lab、H.264 探针及 MP4/WebM/GIF 导出均有通过证据；但 P0 的“当前 Tab 快速录制”实际仍打开系统 Display Picker，且 P0 自定义 Trim、Windows 平台矩阵未完成。因此本报告不建议将当前构建作为 0.6.12 全量发布包。

## 1. 执行信息

| 项目 | 结果 |
|---|---|
| 版本 | `0.6.12` |
| 分支 | `v0.6.12` |
| HEAD | `7cb11f0de02cdc08fbecdb74c7a15153b2fe1cd7` |
| 测试日期 | 2026-08-15（Asia/Shanghai） |
| 测试方式 | Computer Use 驱动真实 Chrome UI；本地 Lab 页面；导出容器回读 |
| 测试目标 | `/Users/wxnet/Base/Projects/video-record/packages/extension/build` |
| 源码变更 | 未修改源代码和构建配置；仅新增本报告。原有未跟踪目录 `docs/recording-e2e-test-suite/`、`semantic-review/` 保留不动 |

测试依据为：

- `/Users/wxnet/Base/Projects/video-record/docs/recording-e2e-test-suite/README.md`
- `/Users/wxnet/Base/Projects/video-record/docs/recording-e2e-test-suite/TEST-ENVIRONMENT-AND-DATA.md`
- `/Users/wxnet/Base/Projects/video-record/docs/recording-e2e-test-suite/TEST-CASES.md`
- `/Users/wxnet/Base/Projects/video-record/docs/recording-e2e-test-suite/EXECUTION-REPORT-TEMPLATE.md`

状态含义：`PASS` 通过，`FAIL` 失败，`PARTIAL` 部分通过，`NOT RUN` 未执行，`BLOCKED` 因环境或交互可测试性受阻。

## 2. 测试环境

| 项目 | 实测环境 |
|---|---|
| OS | macOS 26.5.2，Build 25F84 |
| 机器 | Mac Studio，Apple M2 Max，12 CPU cores，96 GB RAM，38-core GPU |
| Chrome | Google Chrome `151.0.7922.138` Official Build，arm64 |
| V8 | `15.1.206.17` |
| WebCodecs | `VideoEncoder=true`、`VideoFrame=true`；H.264 实编通过 |
| DPR | Preview Playback Lab 显示 `1x DPR` |
| GPU | Canvas、Compositing、Rasterization、Video Decode、Video Encode、WebGL 均 Hardware accelerated；Metal 后端 |
| 扩展 | `Screen Recorder Studio - Unlimited, Zoom, Video & GIF` `0.6.12`，ID `hjknmbigiplfnijadglappikppmecpga`，从 `packages/extension/build` 加载 |
| 录制来源 | Chrome Tab、Window、Entire Screen（Picker 枚举到 Screen 1/2/3） |
| 页面数据 | `https://example.com`、本地 Recording Quality Test Card、Preview Playback Lab |

未覆盖：Windows Chrome Stable、Linux、Chrome Beta/Dev、第二台真实设备；双显示器布局只验证了 Picker 能枚举多个屏幕，未分别录制 Screen 2/3。

## 3. P0/P1 构建门禁

| Gate | 命令/检查 | 结果 | 证据 |
|---|---|---|---|
| GATE-001 | `pnpm -C packages/extension exec vitest run` | **PASS** | `36 passed (36)` test files，`177 passed (177)` tests |
| GATE-002 | `pnpm -C packages/extension exec tsc --noEmit` | **PASS** | exit code 0，无 TypeScript 输出 |
| GATE-003 | `pnpm build:extension` | **PASS** | 构建完成，目标包可加载 |
| GATE-004 | `git diff --check`、`git status --short` | **PASS** | diff check 通过；无源代码修改 |
| GATE-005 | 版本/Manifest/发布包核对 | **PASS** | root/package/Manifest/build 均为 `0.6.12`；构建 Manifest 与静态 Manifest 权限一致 |

GATE-003 有非阻断警告：Svelte 状态引用警告、`VideoFocusPanel.svelte` 两处 pointer handler 缺少 ARIA role 警告，以及 SvelteKit 阶段提示找不到 Manifest。最终 `packages/extension/build/manifest.json` 已正确生成并包含 `0.6.12`，因此本次未将其判为 Gate 失败；建议发布前清理这些警告。

## 4. 端到端结果摘要

| 区域 | 结果 | 主要实测结论 |
|---|---|---|
| Popup 初始/版本 | PASS | Popup 显示 `v0.6.12`，Start/Tab/Window/Screen 控件可用 |
| ENTRY-001 当前 Tab 快速录制 | **FAIL（P0）** | 选择 Tab 后仍出现系统 `Choose what to share...` Picker，不符合“不出现 display Picker”契约 |
| ENTRY-002 Display Picker | PASS | Tab、Window、Entire Screen 均能打开 Picker，选中后可继续录制 |
| ENTRY-003 Picker 取消/重试 | PARTIAL | 取消后 Popup 显示可理解的错误并可重试；实际错误码为 `PERMISSION_DENIED`，未呈现专用 cancel 名称 |
| ENTRY-004 Popup 失焦/关闭 | PASS | 录制中关闭并重开 Popup，状态仍为 recording/paused，可继续控制 |
| ENTRY-005 受限页面 | PARTIAL/PASS | `chrome://extensions` 上 Popup 可打开，未出现空白 UI；未完成全部受限页面降级矩阵 |
| SESSION-002 暂停 active clock | PARTIAL/PASS | 暂停 5 秒期间 Popup 计时保持 `00:11`，恢复后继续；未以精确 active-duration 样本完成全部时间语义矩阵 |
| SESSION-003 Popup 重开恢复 | PASS | 暂停态关闭 Popup、等待约 5 秒、重开后仍为 `Recording Paused 00:11` |
| SESSION-005 来源主动结束 | PASS | Chrome Stop sharing 后自动 finalize 并进入 Studio；Entire Screen 录制得到 `7.73s/71 frames` |
| SESSION-008 停止幂等 | PASS | 对 Stop Recording 做快速双击后只进入一个 Studio 结果页，无二次 finalize UI |
| Recording Quality Test Card | PASS | 动态、Pause animation、Freeze 10 秒静态、恢复动态均可录制；Studio 回放画面无明显黑帧/形变 |
| Crop | PASS | 16:9 回填为 `x=308,y=0,w=3225,h=1814`，关闭后重开参数保持 |
| Zoom | PARTIAL/PASS | 区间创建、`2x/Smooth/1000ms` 参数回填通过；未完成自定义 Trim+Zoom 全时段视觉回放矩阵 |
| Trim | **NOT RUN/BLOCKED（P0 覆盖缺口）** | 只验证 Trim On 的全时长摘要；自定义 start/end、VFR 跨静态 gap、Trim 后导出未形成证据 |
| Preview Playback Lab | PASS | 默认、压力、精确定位三个场景均通过门槛 |
| H.264 Probe | PASS | 1920×1080 支持；1920×1080 实编 `PASS · 3 chunks · 19,026 bytes` |
| MP4/WebM/GIF | PASS | 720p、1080p、WebM、GIF 均成功保存并完成文件/元数据回读 |
| Windows/多设备 | **NOT RUN** | 当前环境无 Windows 实机；不满足发布矩阵要求 |

## 5. 关键证据

### 5.1 录制与回放

质量卡录制结果：

- Studio：`00:00.00 / 01:53.58`，`2591` source frames，`1920×1080`。
- 3 秒受控播放后达到 `00:03.40`、`Frame 104/2591`。
- Timeline `Home` 命中 `00:00.00`；`End` 命中 `01:53.58`；定位到 1:00 命中 `Frame 1723/2591`。
- Freeze 片段在源页面 10 秒内保持 timer/frame/FPS 不变；解冻后恢复动态。

Preview Playback Lab：

| 场景 | Candidate 结果 |
|---|---|
| 动 2s → 静态 4s → 动 2s | 481 display frames；静态区重绘 `240` 次；P95 interval `18.9ms`；P95 drift `5.1ms` |
| 连续 30fps + 周期性合成阻塞 | 469 display frames；静态区重绘 `232` 次；P95 interval `18.7ms`；最大 drift `8.4ms`，基线 `73.0ms` |
| 精确定位探针 | Candidate `7/7` 命中，P95 `2.3ms` |

### 5.2 导出文件回读

使用项目已安装的 Mediabunny `1.35.0` 回读视频容器；GIF 使用文件头及帧 delay 解析核对。

| 文件 | 回读结果 |
|---|---|
| [质量卡组合 MP4](/Users/wxnet/Downloads/edited-video-2026-08-15T10-03-35-418Z.mp4) | `113.583s`，`1280×720`，`avc1`，`3408 packets`，约 30fps |
| [基础 720p MP4](/Users/wxnet/Downloads/edited-video-2026-08-15T09-49-41-708Z.mp4) | `31.82s`，`1280×720`，`avc1`，`955 packets` |
| [基础 720p WebM](/Users/wxnet/Downloads/edited-video-2026-08-15T09-50-47-763Z.webm) | `31.80s`，`1280×720`，`VP9`，`955 packets` |
| [1080p MP4](/Users/wxnet/Downloads/edited-video-2026-08-15T10-12-42-039Z.mp4) | `7.735s`，`1920×1080`，`avc1.640028`，`233 packets` |
| [GIF](/Users/wxnet/Downloads/edited-video-2026-08-15T10-16-16-405Z.gif) | `1440×810`，`78 frames`，delay `4–10cs`，总 delay `7.74s` |

导出取消：长质量卡 MP4 在 `19% / Frame 636/3408` 点击 Cancel 后返回编辑器，没有打开 Save 对话框；随后仍可继续操作。

## 6. 发现的问题与交互观察

### BUG-P0-001：Tab 模式没有走“当前 Tab 快速录制”路径

- **状态：FAIL，发布阻断。**
- **复现：** 在 `https://example.com` 打开 Popup → Tab → Start Recording。
- **实际：** Chrome 打开 `Choose what to share with Screen Recorder Studio...`，仍需在 Picker 中选择 Chrome Tab。
- **预期：** 一次明确点击后不出现 display Picker，直接捕获当前 Tab。
- **影响：** ENTRY-001 P0 失败；也使“Tab”按钮的产品语义与测试契约不一致。
- **代码证据：** `offscreen-main.ts` 的 `getDisplayMediaStream(mode)` 对三种 mode 都调用 `navigator.mediaDevices.getDisplayMedia`（[376 行](/Users/wxnet/Base/Projects/video-record/packages/extension/src/extensions/offscreen-main.ts:376)、[409 行](/Users/wxnet/Base/Projects/video-record/packages/extension/src/extensions/offscreen-main.ts:409)、[480 行](/Users/wxnet/Base/Projects/video-record/packages/extension/src/extensions/offscreen-main.ts:480)）。

### UI-002：暂停态 Resume Recording 按钮文案折行

- **状态：UI 问题，P2。**
- **实际：** 当前 Popup 宽度下，`Resume Recording` 在深色按钮中折为两行；`Stop Recording` 为单行。
- **影响：** 功能仍可点击，但按钮组视觉不一致、文案可读性下降；属于本次用户补充要求记录的 UI/交互问题。
- **建议：** 增大 Popup/按钮最小宽度、缩短文案或允许稳定的单行布局，并在窄宽度下做快照回归。

### UI-003：导出对话框的源信息与目标信息容易混读

- **状态：可用性观察，P2。**
- **实际：** 选择 720p 后，顶部源摘要仍显示 `Resolution 1920×1080`，下方 `Estimated Output` 显示 `1280×720`。
- **判断：** 目前更像“源媒体摘要”和“目标输出摘要”的标签层级不够明显，不判定为功能错误；建议明确增加 `Source` / `Output` 标签。

### UI-004：Trim 自定义手柄的可测试性/可访问性不足

- **状态：覆盖阻塞观察，P1/P0 覆盖风险。**
- **实际：** Trim On 后时间线能显示全范围摘要和可见手柄，但当前 Accessibility tree 没有暴露 start/end 的可操作控件或值；本次无法通过语义 UI 完成可靠的自定义区间设置。
- **影响：** TRIM-001/002/003/004/006 未能形成发布级证据；不能据此判定 Trim 功能本身失败，但必须补测。
- **建议：** 为 start/end 手柄提供可访问名称、当前时间值、键盘调整和可重复的自动化入口。

### OBS-005：Picker 取消错误码偏泛化

- **状态：功能可重试，P2/P1 观察。**
- **实际：** 取消 Picker 后 Popup 显示 `Recording encountered an error and was stopped.`，并显示 `PERMISSION_DENIED`；重新发起并选择有效来源可以成功。
- **建议：** 将用户取消映射为明确的 `CAPTURE_CANCELLED`/用户可理解文案，避免把主动取消误认为权限故障。

### Build warning：非阻断但应清理

构建阶段存在 Svelte reactivity/accessibility warnings，涉及 `VideoPreviewComposite.svelte`、`UnifiedExportDialog.svelte`、`VideoFocusPanel.svelte`。目前不影响本次 Gate 通过，但建议在发布前转为零 warning，尤其是与 UI-004 相关的可访问性问题。

## 7. 未完成的发布级覆盖

以下项目不能被本次结果默认为通过：

1. **ENTRY-001 修复后的无 Picker 当前 Tab 路径**，需重新验证 Popup 关闭/重开和来源结束。
2. **TRIM P0 全套**：中间区间、VFR 静态 gap、边界、二次编辑、Trim 后 MP4 duration/首尾画面。
3. **SESSION-004/006**：Service Worker 回收、扩展 Reload、Chrome 重启后的 reconcile/清理。
4. **Windows Chrome Stable** 及至少一个不同硬件/显示器布局。
5. **EXPORT-002 全分辨率接线**：本次实测 720p、1080p 和 Match Canvas 相关路径；未覆盖 480p/1440p/2160p/自定义尺寸。
6. 双显示器下 Screen 2/3、非当前 Chrome 窗口选择，以及更长时长/更复杂 VFR 数据。

## 8. 发布建议

### 发布前必须完成

- 修复或明确调整 Tab 模式契约：若目标是“当前 Tab 快速录制”，改为真实 `tabCapture` 路径并重新执行 ENTRY-001；若产品决定保留 Picker，必须同步更新 P0 测试契约和 UI 文案。
- 补齐 Trim 自定义范围与 Trim 后导出回读，至少覆盖一个动态+静态 gap 录制。
- 在 Windows Chrome Stable 上至少执行一轮 P0 矩阵。

### 建议随本版本处理

- 修复 `Resume Recording` 折行。
- 明确导出对话框的 Source/Output 信息层级。
- 将 Picker 主动取消显示为可理解的取消状态，而不是泛化的 `PERMISSION_DENIED`。
- 清理构建警告和 VideoFocusPanel 的 ARIA 警告。

### 当前构建可确认的能力

在当前 macOS + Chrome 151 环境中，普通 Display Picker 录制、Popup 状态恢复、暂停/恢复、来源主动结束、Studio 回放、Crop 参数持久化、Zoom 参数持久化、Preview 调度和 MP4/WebM/GIF 导出均已获得真实 UI 或文件回读证据；问题集中在发布门槛完整性和少数入口/UI 契约，而不是所有主链路均不可用。
