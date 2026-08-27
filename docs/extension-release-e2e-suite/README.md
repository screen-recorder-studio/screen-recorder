# 扩展用户故事端到端发布测试套件

本目录是 Screen Recorder Studio 每次版本发布的用户验收基线。它从用户目标出发，覆盖首次安装、录制入口、GIF 区域录制、会话控制、Studio 编辑、MP4/WebM/GIF 导出、Recording Manager、失败恢复、隐私、无障碍、多语言与性能。

## 套件定位

本套件回答三个问题：

1. 用户能否从真实 Chrome 扩展入口完成目标，而不只是某个函数通过单元测试；
2. 编辑结果、导出文件和本地数据是否与 UI 承诺一致；
3. 当前 commit 是否具备发布资格，哪些平台或场景仍未验证。

它与已有 [录制技术回归套件](../recording-e2e-test-suite/README.md) 的关系是：

- 本目录是发布签字的主入口，按用户故事组织；
- 旧套件继续承担时间线、VFR、GOP、Worker、内存和性能等深度媒体回归；
- 主套件中的用例可以引用旧套件，但发布报告必须在本目录生成，不能用单元测试结果替代真实用户旅程。

## 文档导航

- [USER-STORIES.md](./USER-STORIES.md)：当前扩展的用户故事、优先级和完成定义。
- [IMPLEMENTATION-ASSESSMENT.md](./IMPLEMENTATION-ASSESSMENT.md)：当前实现对用户故事的覆盖与发布风险。
- [COVERAGE-MATRIX.md](./COVERAGE-MATRIX.md)：用户故事、用例、环境、证据和自动化状态的追踪矩阵。
- [TEST-CASES.md](./TEST-CASES.md)：发布时逐条执行的端到端用例。
- [TEST-DATA-AND-ENVIRONMENTS.md](./TEST-DATA-AND-ENVIRONMENTS.md)：标准页面、OPFS 数据、平台与证据要求。
- [RELEASE-RUNBOOK.md](./RELEASE-RUNBOOK.md)：Smoke、Full、Extended 三层发布流程和判定规则。
- [EXECUTION-REPORT-TEMPLATE.md](./EXECUTION-REPORT-TEMPLATE.md)：每个版本复制一份的执行报告模板。
- [CASE-CATALOG.json](./CASE-CATALOG.json)：供校验脚本和未来自动化消费的用例清单。

## 发布层级

| 层级 | 何时执行 | 必须覆盖 |
| --- | --- | --- |
| Smoke | 每个候选构建、合并前 | 所有 P0 主路径；Tab 与 GIF Area 至少各完成一次真实录制到导出 |
| Full | 每次商店发布 | 所有 P0/P1；全新安装与升级；MP4/WebM/GIF；Manager；故障恢复 |
| Extended | 重大媒体管线、权限或 Chrome 版本变更 | Windows/macOS、多显示器、高 DPR、长录制、低配设备和深度技术回归 |

## 标准结果

| 结果 | 定义 |
| --- | --- |
| PASS | 全部验收点满足且证据可追溯 |
| FAIL | 产品行为或导出产物不满足验收点 |
| BLOCKED | 权限、设备或外部条件阻止执行；不能写成 PASS |
| NOT RUN | 本轮没有执行；必须进入覆盖缺口 |
| N/A | 经评审确认对该环境不适用，并记录原因 |

## 快速开始

```bash
pnpm test:e2e:catalog
pnpm test
pnpm check
pnpm build:extension
```

然后按 [RELEASE-RUNBOOK.md](./RELEASE-RUNBOOK.md) 加载待发布的 unpacked build，执行对应发布层级，并从模板生成：

```text
EXECUTION-REPORT-<version>-<YYYYMMDD>.md
```

## 发布硬门槛

- P0 全部 PASS；P1 不得存在未接受的 FAIL；BLOCKED 必须体现在发布范围中。
- 真实 Chrome 中至少完成一次 `Action → 录制 → Studio → 导出 → 文件回读`。
- GIF 主路径必须证明画面发生变化，不能只验证文件存在或 Studio 时钟变化。
- GIF Area 必须证明选区外内容没有进入 OPFS 母版及导出 GIF。
- MP4、WebM、GIF 的格式、尺寸、时长和编辑效果必须通过产物回读。
- 没有未解释的权限扩大、外部上传、残缺 OPFS 目录、重复下载或活动 MediaStream。
- 自动化测试、静态检查、正式构建、发布日志策略和本套件结构校验全部通过。
