# Bug Review - 2026-01-09

## 来源
- 基于 `.prompt` 目录中录制/预览/导出流程提示词的快速巡检。
- 结合基线 `svelte-check` 输出定位显性、低风险问题。

## 已修复（低风险高收益）
1. **Composite Worker 消息枚举缺失**：`preview-frame` / `getCurrentFrameBitmap` / `getSourceFrameBitmap` 未纳入消息类型联合，导致裁剪/预览帧请求在类型检查阶段直接报错。已补全枚举以保持数据契约一致。
2. **导出配置类型引用错误**：`export-utils.ts` 中误引用未导出的 `VideoCropStore` 类型，造成类型检查失败并掩盖真实依赖。已改为使用仅需 `getCropConfig` 的实例契约。

## 待关注（未改动）
- `svelte-check` 仍提示若干历史问题（如 `VideoExportDialog` 预设的 `limitFileSize/maxSize` 类型缺口、lab 工具的隐式 `any`、数据分析页的动态键访问等），本次未调整以避免扩大改动面。
- `.prompt/evaluate-trim-zoom-export.todo.md` 中关于 Export Manager 全局帧索引验证的待办仍未落地，后续需要端到端确认。

## 建议
- 完成剩余类型整理后再次跑通 `svelte-check`，确保预览/导出链路的类型契约稳定。
- 针对 Export Manager 的全局帧索引复用逻辑补充一次带裁剪/Zoom 的实测，关闭对应 TODO。
