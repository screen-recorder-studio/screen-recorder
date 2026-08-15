# 端到端发布测试执行报告模板

> 复制本文件作为每次发布的执行记录。不要直接覆盖基线模板。

## 1. 发布信息

| 字段 | 内容 |
| --- | --- |
| 版本 |  |
| Git commit |  |
| 分支 |  |
| 构建产物 |  |
| 测试开始/结束时间 |  |
| 测试负责人 |  |
| 发布范围 |  |
| 上一发布版本 |  |

## 2. 环境

| 环境 ID | OS | Chrome | CPU/GPU | 显示器/DPR | 安装方式 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| ENV-01 |  |  |  |  |  |  |
| ENV-02 |  |  |  |  |  |  |

## 3. 本轮覆盖矩阵

| 维度 | 已覆盖 | 未覆盖及原因 |
| --- | --- | --- |
| 录制来源：当前标签页/标签页/窗口/屏幕 |  |  |
| 页面：HTTPS/受限页面 |  |  |
| 时间：正常/VFR/单帧/暂停/长录制 |  |  |
| 编辑：Crop/Trim/Zoom/组合 |  |  |
| 输出：MP4/WebM/GIF |  |  |
| 尺寸：720p/1080p/高 DPR/自定义 |  |  |
| 平台：macOS/Windows/Linux |  |  |

## 4. 自动化门禁

| Case ID | 命令 | 结果 | 摘要/数量 | 证据 |
| --- | --- | --- | --- | --- |
| GATE-001 | `pnpm -C packages/extension exec vitest run` |  |  |  |
| GATE-002 | `pnpm -C packages/extension exec tsc --noEmit` |  |  |  |
| GATE-003 | `pnpm build:extension` |  |  |  |
| GATE-004 | `git diff --check` / `git status --short` |  |  |  |
| GATE-005 | 版本与包一致性 |  |  |  |

## 5. 端到端用例结果

### 5.1 汇总

| 用例域 | PASS | FAIL | BLOCKED | NOT RUN | N/A |
| --- | ---: | ---: | ---: | ---: | ---: |
| ENTRY |  |  |  |  |  |
| SESSION |  |  |  |  |  |
| TIMELINE |  |  |  |  |  |
| PREVIEW |  |  |  |  |  |
| CROP |  |  |  |  |  |
| TRIM |  |  |  |  |  |
| ZOOM |  |  |  |  |  |
| EXPORT |  |  |  |  |  |
| QUALITY |  |  |  |  |  |
| COMBO |  |  |  |  |  |
| OBS |  |  |  |  |  |

### 5.2 明细

| Case ID | 环境 | 数据 | 结果 | 实际结果 | 证据 | 缺陷 ID |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## 6. 性能与正确性指标

| 指标 | 目标 | 实际 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| Preview p95 display interval | ≤25ms |  |  |  |
| Preview p95 clock drift | ≤34ms |  |  |  |
| Pressure recovery max drift | ≤34ms |  |  |  |
| Seek hit rate | 100% |  |  |  |
| Studio vs session duration | ≤1 output frame |  |  |  |
| Export vs requested duration | ≤1 output frame |  |  |  |
| Output coded/display size | 等于格式契约 |  |  |  |
| 10 分钟内存趋势 | 无持续线性增长 |  |  |  |

## 7. 输出文件回读

| 文件 | Case ID | Format/Codec | Duration | Coded size | Display size | Packet/FPS | 播放视觉结果 |
| --- | --- | --- | ---: | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

## 8. 缺陷记录

每个 FAIL 单独复制以下块。

### BUG-___：标题

- Case ID：
- 严重度：P0 / P1 / P2
- 环境与 commit：
- 前置状态：
- 最小复现步骤：
  1. [步骤一]
  2. [步骤二]
  3. [步骤三]
- 预期结果：
- 实际结果：
- 首个异常时间点：
- Console / Lab / 文件证据：
- 初步归属：录制 / 会话 / OPFS / Reader / Preview / Effect / Export / Browser
- 一手资料或浏览器边界：
- 根因：
- Red 测试：
- 修复 commit：
- 浏览器复测结果：
- 同域与组合回归：
- 剩余风险：
- 回滚方式：

## 9. 已知限制与非阻塞项

| 项目 | 影响范围 | 用户回避方式 | 后续计划 | Owner |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## 10. 发布结论

选择一个结论，并删除其余项：

- **可发布**：P0/P1 全部 PASS，平台和格式矩阵满足正式发布要求。
- **灰度可发布**：主路径全部 PASS，但明确的平台或次要格式尚未覆盖；必须配置灰度监控和回滚点。
- **不可发布**：存在 P0/P1 FAIL、无法解释的 BLOCKED，或发布门禁失败。

### 结论依据

- [依据一]
- [依据二]
- [依据三]

### 未执行范围

- [未执行项]

### 灰度观察指标

- 录制请求 → 成功开始转化率：
- Picker 取消/权限失败率：
- 录制意外结束率：
- Studio 首帧加载失败率：
- Preview/Seek 错误率：
- 导出成功率与取消率：
- 各格式平均导出耗时：
- 卸载率及录制后留存变化：

### 回滚点

- 上一稳定 commit/版本：
- 数据兼容说明：
- 回滚触发阈值：
- 负责人：

## 11. 签字

| 角色 | 姓名 | 结论 | 时间 |
| --- | --- | --- | --- |
| 开发 |  |  |  |
| 测试 |  |  |  |
| 产品 |  |  |  |
| 发布 |  |  |  |
