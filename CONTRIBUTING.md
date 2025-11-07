# 贡献指南（Contributing）

感谢你对 Screen Recorder Studio 的关注与贡献！为了保持项目的质量与协作效率，请在提交 Issue 或 Pull Request 前阅读本指南。

## 如何开始
- 提交 Issue：清晰描述问题或需求，附带复现步骤、预期与实际结果、环境信息（浏览器/版本/平台）
- 提交 PR：基于最新 `main` 分支开发，确保可构建并通过基本检查（见下）

## 开发环境
- 包管理器：`pnpm`
- 语言与框架：TypeScript、Svelte 5、Vite、Chrome MV3
- 本地运行：
  - `pnpm install`
  - `pnpm dev`（调试站点与组件）
  - `pnpm build:extension`（生成扩展产物到 `build/`）

## 代码规范
- TypeScript 类型完善，避免 `any`（确需使用时加注释说明）
- 保持模块边界清晰：UI（routes）、后台/内容/离屏（extensions）、Worker（lib/workers）
- 消息常量/类型统一：建议集中到 `src/lib/types`（如新增）并复用
- 日志：避免过多 `console.log`；为调试输出增加开关或等级
- 样式：遵循现有 Svelte/Tailwind 约定，减少内联样式

## 提交与评审
- 提交信息：简洁明确，建议格式 `feat: ...` / `fix: ...` / `docs: ...` / `refactor: ...`
- PR 内容：
  - 变更摘要与动机
  - 技术方案与影响范围（尤其权限与隐私相关）
  - 测试或验证步骤（本地复现、构建、扩展加载操作截图等）
- 评审标准：正确性、可维护性、文档与注释质量、对现有功能的影响

## 测试与构建
- 基本检查：
  - `pnpm check`（类型检查）
  - `pnpm build:extension`（构建扩展）
- 测试建议：
  - Worker 层（OPFS 读/写、索引、范围读取）的单测或轻量集成测试
  - E2E：后续可引入 Playwright 模拟 UI 操作与消息流

## 分支与发布
- 主分支：`main`
- 功能分支：`feature/<topic>`；修复分支：`fix/<topic>`
- 变更日志：`CHANGELOG.md`

## 行为准则
- 参与者需遵守 `CODE_OF_CONDUCT.md`（Contributor Covenant）

## 权限与隐私变更
- 若 PR 引入或调整浏览器权限、数据处理方式，请在 PR 描述中突出说明并更新 `README.md/ docs/` 相应章节

## 联系与支持
- 如需讨论复杂设计或安全问题，请通过 Issue 或安全披露渠道（见 `SECURITY.md`）与维护者联系