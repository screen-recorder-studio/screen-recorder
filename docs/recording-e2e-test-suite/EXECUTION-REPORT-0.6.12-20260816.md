# Screen Recorder Studio v0.6.12 发布前端到端测试执行报告

> 执行日期：2026-08-16（Asia/Shanghai）
> 测试范围：发布门禁、真实 Chrome 用户旅程、Display Picker、Studio 编辑/导出、独立 Lab 及性能证据。
> 本报告记录测试、问题分级、修正和复核证据；确定性产品问题已按垂直薄片修复并提交。

## 1. 发布结论

**macOS 灰度可发布；全平台签字待 Windows 实机证据。**

原报告中的三个发布阻断项经复核后需要拆开判断：

1. **4K 原尺寸压力不是默认产品路径。** Production `resolveRecordingEncodePlan()` 会把横屏来源限制在最高 1920×1080、30 FPS；`4K → 4K/30 Stress` 在 fixture 中标记为 `runByDefault: false`，只用于手工寻找性能上限。默认 4K 来源会走 4K → 1080p/30 Balanced，本机 Capture RTF 为 **0.18x**，通过 ≤0.90x 门槛。
2. **GIF 的 `BRIDGE-REQUIRED` 只是 Worker Lab 边界，不是产品缺陷。** 真实 Studio → ExportManager → gif.js 主线程桥接 → 下载链已成功输出 647 帧、64.60s、1440×810 的 GIF。复核同时发现旧体积估算严重偏小（约 7.9 MB，实际 107.1 MB），已改为基于真实产物校准的范围估算并经 Chrome 验证。
3. **录制能力文案与产品策略不一致。** 原中/英/俄发布说明把默认录制描述为 4K/60；实际为 Balanced 1080p/30。文案已改为“录制最高 1080p/30，编辑画布可最高 4K 导出”，并由测试固化。
4. Service Worker 回收后会话继续、扩展重载、最终构建上的 3 秒 Slice WebM/MP4 连续导出均已补测通过。

仍未完成的是 Windows Stable、低配 Windows 和 10/30/60 分钟长时 Soak；这些是**外部覆盖缺口**，不能写成 PASS，但当前没有新增的确定性代码失败。基于已有 macOS 主路径、格式导出和性能证据，可进行受控 macOS 灰度；全平台发布签字应等待 Windows 实机矩阵。

## 2. 发布信息

| 字段 | 内容 |
| --- | --- |
| 版本 | 0.6.12 |
| 基线 Git commit | `b8b281f51d041fb5caf34df97f020f25655aebe4` |
| 修正提交 | `d0c14c8` GIF 估算；`49cdebb` 录制能力文案契约 |
| 分支 | `v0.6.12` |
| 构建产物 | `/Users/wxnet/Base/Projects/video-record/packages/extension/build`，Manifest MV3 |
| 扩展安装 | Chrome Unpacked，ID `hjknmbigiplfnijadglappikppmecpga` |
| 测试时间 | 2026-08-16（修正复核完成于 15:15 CST） |
| Chrome | 151.0.7922.138 Official arm64 |
| 上一版本 | 0.6.11（浏览器中旧扩展已停用） |

## 3. 测试环境

| 环境 | OS | CPU/GPU/内存 | Chrome/DPR | 备注 |
| --- | --- | --- | --- | --- |
| ENV-01 | macOS 26.5.2，Apple M2 Max | 12 logical cores，38-core GPU，96 GB | Chrome 151 arm64，DPR 2x | 当前唯一实机；`deviceMemory` Lab 值为 32 GB |
| ENV-02 | Windows | 未提供 | 未执行 | 发布矩阵阻断项 |

Chrome 中存在 ChatGPT 调试 infobar，以及其他历史 DevTools 的无关错误/警告；本轮未将其计入扩展缺陷。未建立完全隔离的扩展 Console 采集，因此 OBS Console 结论只按 UI/Lab/文件证据记录。

## 4. 覆盖矩阵

| 维度 | 本轮已覆盖 | 未覆盖或限制 |
| --- | --- | --- |
| 来源 | 当前标签页、Window Picker、Entire Screen Picker；Picker Cancel/Retry | 多窗口/多显示器系统化矩阵未执行 |
| 页面 | `https://example.com`、本地 HTTP 质量页 | 受限页面完整降级矩阵、浏览器内部页未执行；`file://` 当前标签页触发了权限失败边界 |
| 时间线 | 正常录制、Popup pause/resume、质量页动态/暂停/冻结/解冻、稀疏源/压力/Seek Lab | 真实 CFR/VFR/单帧尾部/90 秒及 10/30/60 分钟 Soak 未执行 |
| 编辑 | Crop 默认/1:1、Trim 10–40s、Zoom 2x/1000ms、组合导出 | 自定义拖拽边界、无效/极短 Trim、焦点位置视觉验收未执行 |
| 输出 | 真实 MP4、WebM、GIF；H.264 能力探针；最终构建 3 秒 Slice 双格式回读 | GIF 的独立 Worker Lab 仍不能独自完成主线程桥接，但真实产品链已覆盖 |
| 尺寸 | 1920×1080、1280×720；4K 性能场景 | 高 DPR 视觉几何及自定义尺寸完整矩阵未执行 |
| 平台 | macOS | Windows/Linux 未执行 |
| 性能 | Low proxy、Standard 1080p、4K Balanced、4K 原尺寸压力；启动延迟/预览 Lab | 硬件加速开关、低配 Windows 实机、长时稳定性未执行 |
| 稳定性 | Popup 重开、Picker Cancel/Retry、Stop 双击幂等、Service Worker 回收、扩展重载 | 浏览器完整重启、10/30/60 分钟和低配 Windows Soak 未执行 |

## 5. 自动化门禁

| Case ID | 命令/检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| GATE-001 | `pnpm --filter extension test` | **PASS** | 56 files passed，299 tests passed |
| GATE-002 | `pnpm -C packages/extension exec tsc --noEmit` | **PASS** | 无输出、退出码 0 |
| GATE-003 | `pnpm build:extension` | **PASS** | Release logging policy verified across 87 JavaScript bundles；构建产物 Manifest 为 0.6.12 |
| GATE-004 | `git diff --check` | **PASS** | 无 whitespace 错误 |
| GATE-005 | 版本一致性 | **PASS** | root/package/build Manifest 均为 0.6.12 |
| LAB-FIXTURE | preview-memory / production-export / recording-performance fixture + 各自 tsc | **PASS** | preview 4/4、production export 5/5、performance 4/4；三套 Lab 类型检查通过 |

构建有既存 Svelte 编译警告（局部状态引用、若干 div 缺 ARIA role 等），不影响本轮构建退出码，但建议另行清理。

## 6. 真实 Chrome 端到端结果

### 6.1 入口与会话

| 用例 | 结果 | 实际证据 |
| --- | --- | --- |
| ENTRY-001 当前标签页 | **PASS** | `example.com` 通过真实 Popup 启动；未出现 Display Picker，标题变为 `Tab content shared` |
| ENTRY-002 Window / Screen | **PASS** | Window 选择 `Screen Recorder Studio` 后进入录制；Entire Screen 选择 Screen 1 后进入录制；两条链路均成功进入 Studio |
| ENTRY-003 Cancel / Retry | **PASS** | Picker Cancel 返回原 Studio；重新 Share 后成功录制；无伪造录制结果 |
| ENTRY-004 Popup 失焦/关闭 | **PASS** | 录制中关闭 Popup，重新打开仍显示 Recording 和持续 elapsed time |
| SESSION-001/002/003 | **PASS（基础）** | Recording 状态、Pause/Resume、Popup 重开均可用；Pause 后 UI 保持 `Recording Paused` |
| SESSION-007 | **PASS** | 取消/失败后重新启动成功，旧事件未阻止新会话 |
| SESSION-008 | **PASS** | Stop 快速双击仅生成一个 Studio 结果 |
| SESSION-004 | **PASS** | 录制中在 `chrome://inspect/#service-workers` 终止扩展 Service Worker；Popup 重新打开仍显示进行中的会话，可 Pause、Stop 并成功生成 02:26.44 / 4383 帧 Studio 结果 |
| SESSION-006（扩展重载） | **PASS** | Release build 后在 `chrome://extensions` Reload；重新打开既有 Studio，GIF 新估算范围和 MP4/WebM 导出入口均正常 |
| SESSION-005/006（浏览器重启）/009 | **NOT RUN** | 来源主动结束、Chrome 完整重启和 10/30/60 分钟连续资源趋势未完成 |

补充：对 `file://` 质量页尝试当前标签页时，Chrome Picker 无可选 Tab，Popup 显示 `PERMISSION_DENIED`；这作为受限来源边界记录，不作为 HTTPS 主路径失败。改用本地 HTTP 后当前标签页录制成功。

### 6.2 Studio、时间线和编辑

| 用例域 | 结果 | 实际证据 |
| --- | --- | --- |
| Studio 首帧/播放/暂停 | **PASS（基础）** | 真实 Studio 显示 1920×1080、source duration 49.77s；播放后暂停，未出现黑帧或 UI 状态错乱 |
| CROP-001/002/004 | **PASS** | 默认 `x=0,y=0,w=1920,h=1080`；1:1 为 `x=420,y=0,w=1080,h=1080`；Apply 后重开保持参数 |
| TRIM-001/006 | **PASS（基础）** | 设置 Start 10.00 / End 40.00，摘要显示 30.00s、8 source frames，并用于 MP4 导出 |
| ZOOM-001/004 | **PASS（基础）** | 在 30s 创建 Zoom；Focus panel 参数改为 2x、1000ms，重开后保持 |
| TIMELINE-002/004/007 | **PASS（Lab 合约）** | 稀疏/动静动/Trim 半开区间由 Preview、Parity Lab 覆盖；未等同于真实生产 VFR 全矩阵 |
| CROP-003/005、TRIM-002/003/004/005、ZOOM-002/003/005 | **NOT RUN** | 自定义边界、无效区间、焦点/重叠效果等未执行 |

### 6.3 质量页

真实录制 `http://127.0.0.1:4183/lab/recording-quality-page/`：

- 录制结果：`01:04.60`，1471 source frames，1920×1080。
- 录制期间验证 `RUNNING → PAUSED → RUNNING → FROZEN → RUNNING`，冻结时 Pause 按钮被禁用，解冻后恢复。
- 最终成功进入 Studio，Studio 显示 `01:04.60`、`Frame: 1/1471`。

因此 QUALITY-001/002/003/004/005/006 的入口和控制语义有基础证据；逐帧视觉、0Hz 精确静态尾部、来源对比仍需专门回放/像素验收，不能写成完整视觉 PASS。

## 7. 独立 Lab 结果

### 7.1 H.264 能力

- `1920×1080`：SUPPORTED，`avc1.640028`；实际编码 PASS，3 chunks、19,026 bytes。
- `1920×1088`：SUPPORTED。
- `1919×1079`：UNSUPPORTED，符合对齐契约。
- 环境：Chrome 151、VideoEncoder/VideoFrame 可用、macOS、12 logical cores。

### 7.2 Recording Start Latency Lab

三轮均 PASS：

- 当前标签页 + 3s countdown：`closedWarmupFrames=98`，正式首帧存在，1 encoded chunk，`displaySurface=tab`。
- 当前标签页 + countdown off：`closedWarmupFrames=7`，正式首帧存在，1 encoded chunk。
- Display Picker + 3s countdown：`closedWarmupFrames=94`，正式首帧存在，`displaySurface=browser`。

### 7.3 Preview Playback Lab

- 稀疏动→静→动 8s：candidate p95 interval **18.9ms**，p95 drift **5.0ms**，static redraw 240，seek 7/7。
- 压力场景 8s：candidate p95 interval **19.0ms**，p95 drift **5.1ms**，max interval 87.9ms / 104.0ms 上限，coalesced 12，seek 7/7。
- 两个场景均显示生产 Worker display time、精确定位 100% 命中和压力恢复 PASS。

### 7.4 Production Export Worker E2E

- MP4：PASS；slice 1.100–4.100s，Crop 80%，两段 Zoom，输出 640×360、3.000s，571,812 bytes，7/7 checkpoints PASS，最大像素 MAE 0.30。
- WebM：PASS；同一编辑意图，输出 640×360、3.000s，232,055 bytes，7/7 checkpoints PASS，最大像素 MAE 0.98。
- GIF：Worker Lab 仍显示 `BRIDGE-REQUIRED`，这是其不包含主线程 gif.js handshake 的证据边界；真实产品 E2E 已通过，不能据此判产品失败。

### 7.5 Edit / Export Parity Lab

PASS：Preview 与 MP4 的 Raw MAE 最大 0.00；未重基 baseline 在 2/6 checkpoints 显著失配；MP4 回读 287,518 bytes、4.000s、640×360；Trim `[1400,5400]ms` 后 Zoom 使用相对时间并通过 6/6 checkpoint。Lab 的 HTML video AX 同时出现 `Unable to play media.`，但 Mediabunny/MP4 readback 与像素验收均通过，记录为播放器可访问性观察项而非导出失败。

### 7.6 Recording Performance Lab

| 场景 | 结果 | 关键指标 |
| --- | --- | --- |
| 1080p → 720p/24，software preference（Low proxy） | **PASS** | capture RTF 0.09x，preview p95 3.2ms，WebM RTF 0.15x，drops 0 |
| 1080p/30 browser preference（Standard） | **PASS** | capture RTF 0.17x，preview p95 5.4ms，WebM RTF 0.27x，drops 0 |
| 4K → 1080p/30 Balanced | **PASS** | capture RTF 0.18x，preview p95 5.7ms，WebM RTF 0.26x，drops 0 |
| 4K → 4K/30 Stress（手工、非默认） | **PRESSURE SIGNAL** | capture RTF **1.59x > 1.00x**；该 fixture `runByDefault: false`，Production 不会选择此 encode plan。用于确认若未来开放原始 4K 必须重新设计，不阻断当前 Balanced 产品路径 |

该 Lab 是短时确定性代理/压力验证，不替代低配 Windows 实机及长时 Soak。4K 原尺寸结果是未来开放 Original/4K Capture 时的设计阻断；当前产品固定使用 Balanced 1080p/30，因此不作为当前发布失败。

## 8. 真实输出文件回读

| 文件 | 格式/编码 | Duration | Display size | 回读结果 |
| --- | --- | ---: | --- | --- |
| [edited-video-0.6.12-combo-720p.mp4](/Users/wxnet/Downloads/edited-video-0.6.12-combo-720p.mp4) | MP4 / AVC | 30.000s | 1280×720 | Mediabunny 元数据通过；ISO MP4，1,430,196 bytes |
| [edited-video-0.6.12-raw-webm-1080p.webm](/Users/wxnet/Downloads/edited-video-0.6.12-raw-webm-1080p.webm) | WebM / VP9 | 49.8003s | 1920×1080 | WebM 通过；Studio 49.77s，误差约 30.3ms，≤ 30fps 单帧 |
| [edited-video-2026-08-16T07-10-06-041Z.webm](/Users/wxnet/Downloads/edited-video-2026-08-16T07-10-06-041Z.webm) | WebM / VP9 | 3.000333s | 1920×1080 | 最终 Release build，02:26 源录制 `[0,3s)` Slice，729,481 bytes |
| [edited-video-2026-08-16T07-10-42-569Z.mp4](/Users/wxnet/Downloads/edited-video-2026-08-16T07-10-42-569Z.mp4) | MP4 / AVC | 3.000s | 1920×1080 | 同一 Slice 紧接 WebM 导出，905,114 bytes |
| [edited-video-2026-08-16T06-54-36-276Z.gif](/Users/wxnet/Downloads/edited-video-2026-08-16T06-54-36-276Z.gif) | GIF89a | 64.60s | 1440×810 | 真实产品 GIF E2E，647 帧，107,141,128 bytes；证明主线程 bridge 正常并暴露旧估算缺陷 |

MP4 的 Node 侧 H.264 解码不可用，因此本轮对 MP4 做了容器/时长/尺寸/codec 元数据回读和 Chrome Studio 播放 UI 验证；像素级 Worker/Parity 证据来自独立 Lab。

## 9. 性能与正确性指标

| 指标 | 目标 | 实际 | 结果 |
| --- | --- | --- | --- |
| Preview p95 display interval | ≤25ms | 18.9ms / 19.0ms | **PASS** |
| Preview p95 clock drift | ≤34ms | 5.0ms / 5.1ms | **PASS** |
| Seek hit rate | 100% | 7/7，稀疏与压力均通过 | **PASS** |
| Standard capture RTF | ≤1.0 | 0.17x | **PASS** |
| Low proxy capture RTF | ≤1.0 | 0.09x | **PASS** |
| 4K → Balanced capture RTF | ≤0.90 | 0.18x | **PASS** |
| 4K 原尺寸 Stress capture RTF（非默认诊断） | ≤1.0 | **1.59x** | **PRESSURE SIGNAL** |
| WebM export RTF | ≤2.0 | 0.15x / 0.27x / 0.26x | **PASS** |
| Studio vs session duration | ≤1 output frame | WebM 30.3ms，目标 33.3ms | **PASS** |
| 输出 display size | 等于请求格式 | MP4 1280×720；WebM 1920×1080 | **PASS** |
| 10/30/60min 内存趋势 | 无线性增长 | 未执行；fixture 通过 | **NOT RUN** |
| Preview dispose / retained budget | 有界且归零 | 浏览器 Soak 未执行；fixture 通过 | **NOT RUN** |

## 10. 风险与缺陷记录

### RISK-01：未来开放 4K Original Capture 前必须重新做性能薄片

- 当前 Production Balanced encode plan 已限制为最高 1920×1080、30 FPS；4K 来源走 4K→1080p，RTF 0.18x。
- 手工 4K→4K/30 压力 Lab 的 1.59x 说明不能仅增加 UI 开关就宣称原始 4K 实时录制。
- 发布说明已移除 4K Capture/60 FPS 的错误承诺。若未来新增 Original/4K Capture，必须重新完成编码器策略、低配 Windows 和长时 Soak；当前版本不应暴露该入口。

### RISK-02：Windows 发布矩阵缺失

- 关联用例：PERF-007、Windows P0/P1 来源/格式矩阵。
- 本轮没有 Windows 实机，不能验证 Windows Chrome Stable、Window/Screen Picker、H.264/WebM/GIF、低配置预算及驱动差异。
- 这不是环境 PASS，而是发布门禁未完成。

### FIX-01：GIF 真实导出通过，体积估算已修复

- Worker Lab 的 `BRIDGE-REQUIRED` 只表示 Lab 没有宿主页面 handshake；Production ExportManager 已实现该桥接。
- 真实 Chrome 输出 64.60s / 647 帧 / 1440×810 / 107.1 MB GIF，证明产品链可用。
- 旧 UI 仅估算约 7.9 MB，严重低报；`d0c14c8` 改为实测校准范围。最终构建在同一录制上显示 `~163.0 MB–814.8 MB`（1465 帧），不再制造虚假精确值。

### FIX-02：发布文案能力边界已纠正

- `49cdebb` 将中/英/俄说明统一为 Balanced 录制最高 1080p/30、导出最高 4K；同时区分 MP4/WebM 最高 60 FPS 与 GIF 最高 30 FPS。
- 新增测试防止重新出现“默认录制从 SD 到 4K”的错误承诺。

### 非阻塞观察项

- `file://` 当前 Tab 在 Chrome Picker 中无可选 Tab，Popup 给出 `PERMISSION_DENIED`；HTTP/HTTPS 当前 Tab 路径通过。
- 取消 Picker 后 Popup 的错误提示包含通用文案 `Recording encountered an error and was stopped.` 及 `PERMISSION_DENIED`，可操作性尚可，但建议确认错误码和回避动作是否满足 OBS-002。
- 构建存在 Svelte warning；未导致构建失败。
- Parity Lab 的 HTML video AX 出现 `Unable to play media.`，但 readback、尺寸、时长、像素矩阵均 PASS；建议单独修复 Lab 播放器可访问性/错误状态。

## 11. 建议的发布前补测顺序

1. 在 Windows Stable 完成当前 Tab、Window、Entire Screen、720p/1080p MP4/WebM/GIF、取消/重试/暂停/来源结束，并至少覆盖一台低配/老电脑。
2. 补跑 Chrome 完整重启、来源主动结束和 10/30/60 分钟 Soak，记录 worker/frame/OPFS 资源趋势。
3. 补跑真实 CFR/VFR/单帧静态尾部、custom crop 边界、无效 Trim、Zoom focus 视觉验收。
4. 若产品未来计划开放 Original/4K Capture，单独立项，不复用当前 Balanced 发布结论。

## 12. 发布判断

- **当前结论：macOS 灰度可发布；全平台发布签字待 Windows/低配实机和长时 Soak。**
- 当前不存在未处理的默认产品路径 FAIL：Balanced 性能、MP4、WebM、GIF、Service Worker 恢复和扩展 Reload 均有真实 Chrome 证据；4K Direct 已明确为非默认手工压力场景，错误商店承诺已移除。
- 灰度发布应限制在当前 Balanced 1080p/30 录制能力，监控导出失败率、GIF 大文件反馈和低内存设备崩溃；不得把尚未运行的 Windows/长时矩阵写成 PASS。
- 回滚点：上一稳定版本/commit（本轮未执行回滚操作）。

## 13. 报告文件状态

本报告由初始执行结果与修正循环共同形成；用户既有未追踪目录 `semantic-review/` 未修改。
