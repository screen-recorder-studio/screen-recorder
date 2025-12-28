# Video Zoom 功能改进计划 (Minimal Cost to Professional)

本文档基于端到端评估结果及与专业非线性编辑软件 (NLE, 如 Premiere/Resolve) 的对比分析，旨在以**最小的开发成本**，通过逻辑优化和功能补齐，使现有的 Zoom 功能从“单一特效”升级为“通用编辑工具”。

## 🎯 核心目标与对标
1.  **多模式支持 (vs Anchor Point)**：补齐“原地放大”能力，对标 NLE 的 "Scale around Anchor Point"，解决当前强制推镜头导致的眩晕感。
2.  **节奏自由度 (vs Keyframe Easing)**：支持自定义过渡时长和缓动类型，模拟 NLE 的关键帧插值 (Linear/Bezier/Hold)。
3.  **稳定性 (vs Track Management)**：解决区间过渡期的重叠冲突问题，确保多段 Zoom 连贯稳定。
4.  **画面完整性 (vs Auto Reframe)**：(进阶) 引入动态背景填充，解决缩放或比例不一致时的黑边问题。

---

## 🚀 Phase 1: 关键逻辑修复 (P0) - 稳定性基石

### 1. 修复过渡期重叠冲突
**痛点**：当前仅判断 `start < end`，忽略了 300ms 过渡期。紧邻区间会导致“进入动画”被前一个“退出动画”截断，视觉跳变。
**改进方案**：
*   **Store 层**：修改 `hasOverlap`，引入 `transitionDuration` 缓冲。
    *   逻辑修正：`startMs < (interval.endMs + transitionMs) && (endMs + transitionMs) > (interval.startMs - transitionMs)`。
*   **Worker 层**：(可选) 优化 `calculateZoomScale`，若时间点重叠（前 Exit 后 Enter），优先响应 Enter 状态，避免逻辑打架。

---

## 🛠 Phase 2: 核心能力补齐 (P1) - 通用性升级

### 2. 新增 "Anchor Zoom" (原地放大) 模式
**对标**：专业软件的 **Scale around Anchor Point**。
**痛点**：当前 Dolly 模式强制将焦点移至屏幕中心。演示软件左上角菜单时，画面整体移动会产生强烈眩晕感。
**改进方案**：
*   **数据结构**：`ZoomInterval` 增加 `mode: 'dolly' | 'anchor'` (默认 `dolly`)。
*   **Worker 渲染**：
    *   *Dolly (现有)*: 焦点坐标平滑插值移动到画布中心。适合：特写、剧情强调。
    *   *Anchor (新增)*: 焦点坐标在屏幕上的绝对位置保持不变，仅放大画面。适合：操作演示、查看细节。
    *   *算法*：`layout.x = focusAbsX - focusRelativeX * currentWidth` (基于缩放后的宽高计算左上角位置，使焦点重合)。

### 3. 支持自定义过渡 (Duration & Easing)
**对标**：专业软件的 **Keyframe Interpolation (Temporal)**。
**痛点**：硬编码 300ms + `easeInOutCubic`，无法实现“瞬间放大”的强调效果或“匀速推进”的说明效果。
**改进方案**：
*   **数据结构**：`ZoomInterval` 增加 `transitionDurationMs` (默认 300) 和 `easing` (默认 'smooth')。
*   **Worker 渲染**：`calculateZoomScale` 读取区间级配置。
    *   *Smooth*: `easeInOutCubic` (现有，默认)。适合：平滑运镜。
    *   *Linear*: `t` (新增)。适合：机械/精准演示。
    *   *Punch*: `step` (新增，即 Hold)。适合：卡点、强调、鬼畜。

---

## 🎨 Phase 3: 进阶专业能力 (P2) - 质感提升

### 4. 动态背景填充 (Smart Background)
**对标**：专业软件的 **Background Fill / Blur**。
**场景**：当 Zoom Out (< 1.0) 或源视频比例（如 9:16）与画布（16:9）不一致时，会出现黑边。
**改进方案**：
*   **Worker 渲染**：在 `renderCompositeFrame` 底层增加 pass：
    1.  绘制一层全屏铺满的当前帧（`object-fit: cover`）。
    2.  应用高斯模糊 (`ctx.filter = 'blur(20px)'`)。
    3.  在上方绘制实际视频帧。
*   **价值**：极大提升竖屏素材在横屏画布上的专业感。

### 5. 运动模糊 (Motion Blur) - *技术预研*
**对标**：专业软件的 **Motion Blur**。
**现状**：Canvas 2D 实现模糊性能开销极大。
**策略**：暂不作为 MVP 功能。后续若迁移至 WebGL 渲染管线，作为默认能力开启。

---

## 📝 实现清单 (Implementation Checklist)

### 1. 状态管理 (`src/lib/stores/video-zoom.svelte.ts`)
- [ ] **Interface 更新**: 增加 `mode`, `transitionDurationMs`, `easing` 字段。
- [ ] **逻辑修复**: 修改 `hasOverlap` 方法，加入过渡缓冲时间判断。
- [ ] **API 更新**: `addInterval` 和 `updateInterval` 支持新字段传入。

### 2. 渲染引擎 (`src/lib/workers/composite-worker/index.ts`)
- [ ] **缓动算法增强**: 增加 `linear` 和 `step` (Punch) 缓动函数。
- [ ] **渲染逻辑分支**: 增加 `Anchor` 模式的布局计算分支。
- [ ] **配置读取**: 替换硬编码常量为 `interval` 对象配置。
- [ ] **背景填充**: (P2) 实现高斯模糊背景层。

### 3. UI 交互 (`src/lib/components/Timeline.svelte` & `VideoFocusPanel.svelte`)
- [ ] **属性面板优化**: 允许用户修改选中 Interval 的属性：
    - [ ] 切换模式 (Dolly / Anchor)。
    - [ ] 选择缓动 (Smooth / Linear / Punch)。
    - [ ] 调整过渡时长。
- [ ] **视觉反馈**: 在时间轴上可视化过渡期范围 (可选)。

---

## 📊 预期收益
通过 P0 和 P1 的实施，我们将以极低的成本（仅逻辑修改，无架构重构）解决 Zoom 功能最核心的“眩晕感”和“单一感”问题，使其从一个娱乐向的特效工具，转变为一个能够胜任专业软件教程录制和精确剪辑的生产力工具。