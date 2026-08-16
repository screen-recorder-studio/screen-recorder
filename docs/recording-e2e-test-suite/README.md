# 屏幕录制端到端发布测试套件

本目录沉淀屏幕录制入口、录制会话、视频时间线、Studio 预览、Crop、Trim/Slice、Zoom 与导出的端到端回归基线。它既记录 2026-08-15 这一轮薄切片优化的结论，也用于后续版本发布前重复执行。

## 文档导航

- [OPTIMIZATION-JOURNEY.md](./OPTIMIZATION-JOURNEY.md)：从录制入口到性能、资源恢复的薄切片拆分、验证方式和已完成提交。
- [TEST-ENVIRONMENT-AND-DATA.md](./TEST-ENVIRONMENT-AND-DATA.md)：浏览器、操作系统、录制来源、测试素材和覆盖矩阵。
- [TEST-CASES.md](./TEST-CASES.md)：按用户旅程编号的详细端到端测试用例。
- [EXECUTION-REPORT-TEMPLATE.md](./EXECUTION-REPORT-TEMPLATE.md)：每轮发布的执行记录、证据和缺陷闭环模板。

## 测试目标

1. 用户能从扩展入口低成本开始、取消、暂停、恢复和停止录制。
2. Popup 被浏览器关闭、Service Worker 被回收或录制来源主动结束时，会话仍保持一致且可恢复。
3. 正常 CFR、稀疏 VFR、静态尾部、暂停和长录制都使用真实媒体时间线，不按帧数错误压缩。
4. 预览播放时钟连续，跨读取窗口和快速 Seek 不显示过期帧，静态源上的 Zoom 等时间效果仍连续。
5. Crop、Trim/Slice、Zoom 单独和组合使用时，参数、播放区间、画面几何和导出结果一致。
6. 导出文件保持请求的时长、显示尺寸和时间效果；取消或失败不遗留错误状态和残缺文件。
7. 录制、预览和导出在 Balanced 1080p、4K 输入和低配代理环境下满足明确的实时、内存与 RTF 预算。
8. 扩展更新或本地构建导致 Studio 与哈希 Worker 资源不一致时，用户能识别原因并安全恢复。
9. 发布构建通过自动化门禁，关键路径在真实 Chrome 中通过浏览器端测。

## 测试分层

| 层级 | 目的 | 执行位置 | 失败后的动作 |
| --- | --- | --- | --- |
| 纯函数与状态机测试 | 固化时间、状态、尺寸和窗口边界 | Vitest | 先修契约，再进入浏览器 |
| 独立 Lab | 隔离浏览器 API、WebCodecs 和性能假设 | `lab/` | 记录浏览器/平台差异，避免把假设直接带入产品 |
| 产品浏览器端测 | 验证真实扩展用户旅程与 UI | Chrome Stable | 建立最小复现并进入修正循环 |
| 组合导出验证 | 验证编辑结果穿过完整导出链 | Studio + 导出文件回读 | 对比时间、尺寸、帧率和视觉结果 |
| 发布门禁 | 防止类型、构建和全量回归问题 | 命令行 | 任一失败均不得发布 |

## 标准执行顺序

1. 从 [TEST-ENVIRONMENT-AND-DATA.md](./TEST-ENVIRONMENT-AND-DATA.md) 选择本轮覆盖矩阵，记录 Chrome、OS、DPR 和扩展 commit。
2. 执行发布门禁 `GATE-*`，确认测试基线可用。
3. 依次执行 `ENTRY-*`、`SESSION-*`、`TIMELINE-*`、`PREVIEW-*`、`CROP-*`、`TRIM-*`、`ZOOM-*`、`EXPORT-*`、`QUALITY-*` 和 `PERF-*`。
4. 任何疑似问题先按“实际结果、预期结果、最小复现、证据”记录，不用刷新或重装掩盖状态问题。
5. 对浏览器或编解码器边界不明确的问题，先在对应 Lab 重现，再补失败测试，最后修改生产代码。
6. 修复后重跑直接失败用例、同域回归、组合链路和全量发布门禁。
7. 使用 [EXECUTION-REPORT-TEMPLATE.md](./EXECUTION-REPORT-TEMPLATE.md) 给出发布结论。

## 结果定义

| 结果 | 定义 |
| --- | --- |
| PASS | 实际结果满足全部验收点，证据已保存 |
| FAIL | 产品行为或输出明确不满足验收点 |
| BLOCKED | 外部权限、环境或工具阻止执行，不能写成 PASS |
| NOT RUN | 本轮范围未覆盖，必须在发布报告中明确 |
| N/A | 经评审确认该环境或功能不适用，并记录原因 |

## 发布判定

满足以下条件才可标记“可发布”：

- 所有 P0、P1 用例为 PASS；无未解释的 BLOCKED。
- 录制、预览、编辑、主导出格式至少完成一次真实浏览器组合链路。
- 时间线时长误差不超过一个目标输出帧；Seek 命中正确的 last-frame-hold 源帧。
- 输出显示尺寸与用户选择一致，无拉伸、黑边或错误的 16 像素扩边。
- Balanced 录制满足实时余量，预览缓存受确定性内存预算约束，连续录制/导出无单调资源增长。
- 当前 Stable 的启动延迟、预览切窗和导出 RTF 达到 `TEST-CASES.md` 中的 P0/P1 门槛。
- 全量测试、类型检查、扩展构建和 `git diff --check` 全部通过。
- P2 遗留有明确影响面、回避方式和后续责任，不影响本次主路径。

若只覆盖单一操作系统或单一主格式，可以判定为“灰度可发布”，但不能把未执行的平台/格式写成已验证。

## 快速命令

```bash
pnpm -C packages/extension exec vitest run
pnpm -C packages/extension exec tsc --noEmit
pnpm build:extension
git diff --check
git status --short
```

Lab 启动方式和专属断言见各目录 README：

- `lab/recording-entry-v2/`
- `lab/recording-start-latency/`
- `lab/recording-performance-lab/`
- `lab/preview-playback-lab/`
- `lab/preview-memory-soak-lab/`
- `lab/recording-quality-page/`
- `lab/webcodecs-h264-probe/`
- `lab/mediabunny-opfs-stream/`
- `lab/edit-export-parity-lab/`
- `lab/production-export-worker-e2e-lab/`
- `lab/release-log-policy/`
