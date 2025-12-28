# Trim & Zoom & Export 协同改进计划 (Professional NLE Standards)

本文档基于对 Screen Recorder Studio 现有 Trim（剪裁）、Zoom（变焦）与 Export（导出）功能的深度评估。虽然核心架构基于“全局绝对时间戳”保证了底层逻辑的正确性，但在 **交互一致性** 和 **视觉反馈** 上与专业非线性编辑软件（NLE, 如 Premiere/Final Cut）仍存在差距。

本计划按照 **“成本最低、风险最小、收益最大”** 的原则进行排序，优先解决导致用户困惑的 UI 视觉割裂问题。

---

## 🎯 核心目标与对标
1.  **视觉统一 (vs Track Ghosting)**：解决 Trim 遮罩未覆盖 Zoom 轨道的割裂感，明确“可见即所得”。
2.  **交互逻辑 (vs Nondestructive Editing)**：强化非破坏性编辑的感知，明确区分“被隐藏的数据”与“被删除的数据”。
3.  **导出精确性 (vs Render Consistency)**：确保导出进度条与实际输出时长严格匹配，避免“假死”或进度跳变。

---

## 🚀 Phase 1: 视觉一致性修复 (P0) - 消除误导

**痛点**：目前 `Timeline` 组件中，Trim 的半透明遮罩（Overlay）仅覆盖主时间轴，下方的 Zoom 轨道完全不受影响。当用户切除某段视频后，该时间段内的 Zoom 区间依然高亮显示，导致用户误以为该特效仍有效。

### 1. 全局遮罩同步 (Visual Sync)
**成本**：低 (CSS/Svelte Template)
**风险**：极低
**改进方案**：
*   **UI 层级调整**：在 `Timeline.svelte` 中，将 `trim-overlay` (左/右遮罩) 的父容器范围扩大，或者在 `.zoom-control` 容器上也渲染一套同样的遮罩。
*   **样式联动**：确保 Zoom 轨道上的遮罩样式（颜色、透明度）与主轨道完全一致，形成“垂直切片”的视觉隐喻。

### 2. 区间状态区分 (Interval State)
**成本**：低 (JS Logic)
**风险**：低
**改进方案**：
*   **状态计算**：在 `Timeline.svelte` 渲染循环中，判断每个 `zoomInterval` 与 `trimStart/End` 的关系。
    *   *完全在范围外*：降低透明度 (Opacity 0.3)，添加“禁用”视觉样式（如变灰）。
    *   *部分重叠*：使用 `clip-path` 或视觉截断，仅高亮显示位于 Trim 有效区内的部分。
*   **交互限制**：对位于 Trim 范围外的 Zoom 区间，禁用其拖拽和调整大小的手柄，防止用户在不可见区域进行无效操作。

---

## 🛠 Phase 2: 交互与数据精度 (P1) - 专业体验

**痛点**：鼠标拖拽 Trim 手柄难以精确到帧；导出时的进度条分母可能基于源视频总帧数而非裁剪后的帧数，导致进度显示不准确。

### 3. 微调交互 (Nudge Control)
**成本**：中 (Event Handling)
**风险**：低
**改进方案**：
*   **键盘支持**：选中 Trim 手柄时，支持使用 `←` / `→` 键进行逐帧移动（Nudge）。
*   **磁吸效果**：(可选) 拖拽 Trim 手柄靠近播放头（Playhead）时自动吸附，方便用户利用播放头先定位再裁剪。

### 4. 导出进度归一化 (Progress Accuracy)
**成本**：低 (Logic Fix)
**风险**：低
**改进方案**：
*   **分母修正**：检查 `VideoExportPanel.svelte`。确保进度条的 `total` 值使用的是 `trimStore.trimFrameCount` (裁剪后的实际帧数)，而非 `totalFramesAll` (源视频帧数)。
*   **逻辑验证**：确保 `ExportManager` 内部的回调进度是基于“已处理的输出帧数”计算的。

---

## 🎨 Phase 3: 进阶协同能力 (P2) - 锦上添花

**痛点**：缺乏对被剪切掉的关键帧的直观提示。

### 5. 幽灵数据提示 (Ghost Data)
**成本**：中
**风险**：低
**改进方案**：
*   **Tooltip 提示**：当鼠标悬停在被 Trim 变灰的 Zoom 区间上时，显示 Tooltip：“此区域位于裁剪范围外，不会被导出”。

### 6. 弹性模式 (Elastic Zoom) - *技术预研*
**成本**：高
**风险**：中
**现状**：目前 Zoom 锁定在源时间上（剪掉前 5 秒，Zoom 从中间开始）。
**改进方案**：
*   未来可增加“弹性”选项：当 Trim 改变时，自动压缩/拉伸 Zoom 区间以适应新的视频时长（Fit to Fill）。这属于高级功能，暂不作为当前重点。

---

## 📝 实现清单 (Implementation Checklist)

### 1. 时间轴组件 (`src/lib/components/Timeline.svelte`)
- [x] **视觉同步**: 在 `.zoom-control` 区域添加与主轨道同步的 `trim-overlay` DOM 结构。
- [x] **样式调整**: 确保遮罩层级 (z-index) 正确覆盖 Zoom 区间但低于手柄。
- [x] **区间状态**: 通过 `.zoom-trim-mask` 统一实现了变灰和禁用交互。
- [x] **交互锁定**: 阻止对 `.disabled` 状态 Zoom 区间的鼠标事件响应（通过遮罩层阻挡）。
- [x] **键盘微调**: 为 Trim 手柄添加 `keydown` 监听，支持方向键逐帧调整。 (✅ 已实现)

### 2. 导出面板 (`src/lib/components/VideoExportPanel.svelte`)
- [x] **进度修正**: 修改 `targetProgress` 计算逻辑，使用 `trimStore.trimFrameCount` 作为分母。

### 3. 导出管理器 (`src/lib/services/export-manager.ts`)
- [ ] **边界检查**: 再次确认 Zoom 计算逻辑在导出循环中传入的是正确的全局绝对帧索引 (`globalFrameIndex`)，而非相对索引，确保“所见即所得”。 (⚠️ 风险：代码中未见 Zoom Rebase 逻辑)

---

## 📊 预期收益
实施 Phase 1 后，将消除用户最困惑的“视觉不同步”问题，使 Trim 和 Zoom 的关系一目了然。Phase 2 将提升操作的精确度和导出反馈的专业度，显著增强软件的“生产力工具”属性。