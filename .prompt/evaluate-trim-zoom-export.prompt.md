# Trim & Zoom & Export 协同功能端到端评估

本文档旨在评估视频编辑中 Trim（剪裁）、Zoom（变焦）与 Export（导出）三大核心能力的协同工作情况。目标是确保从时间轴编辑到最终导出的全流程中，逻辑一致（所见即所得）、交互直观且符合专业非线性编辑软件（NLE）的体验标准。

**核心协同机制：**
1.  **全局时间基准**：Trim 定义播放窗口（In/Out Point），Zoom 定义基于源时间戳的空间变换。两者通过全局绝对帧索引解耦，确保剪裁不破坏变焦的关键帧逻辑。
2.  **非破坏性编辑**：Trim 操作仅隐藏视频片段，不物理删除数据；Zoom 区间即使被 Trim 切除，数据依然保留，随时可恢复。
3.  **渲染一致性**：预览（Preview）与导出（Export）共用同一套状态数据和合成逻辑，保证“所见即所得”。

请端到端评估以下协同链路：

1.  **状态管理协同**：
    *   `src/lib/stores/trim.svelte.ts`: 负责管理裁剪范围（开始/结束帧），提供帧级精度的范围计算。
    *   `src/lib/stores/video-zoom.svelte.ts`: 负责管理 Zoom 区间列表。
    *   **评估点**：两者状态是否独立且互不干扰？是否存在逻辑冲突（如 Zoom 计算依赖了相对时间而非绝对时间）？

2.  **UI 交互与视觉反馈**：
    *   `src/lib/components/Timeline.svelte`: 负责同时展示 Trim 遮罩和 Zoom 轨道。
    *   **评估点**：当 Trim 范围变化时，Zoom 轨道是否有相应的视觉反馈（如变暗、禁用态）？用户是否容易误解被切除区域的 Zoom 状态？交互操作（如拖拽 Zoom 区间跨越 Trim 边界）是否符合直觉？

3.  **播放预览逻辑**：
    *   `src/lib/components/VideoPreviewComposite.svelte`: 负责协调 Worker 进行实时渲染。
    *   **评估点**：
        *   当播放指针从 Trim 起点开始时，Zoom 的初始状态（Scale/Position）是否正确计算了被切除部分的影响？（例如：前 5 秒有 Zoom In，切掉后从第 5 秒开始播放，画面是否已经是放大状态？）
        *   循环播放或 Seek 时，状态重置是否准确？

4.  **导出管线一致性**：
    *   `src/lib/components/VideoExportPanel.svelte`: 负责组装导出配置。
    *   `src/lib/services/export-manager.ts`: 负责执行导出流程。
    *   **评估点**：
        *   导出循环是否正确使用了全局帧索引来查询 Zoom 状态？
        *   导出进度条的分母是否正确反映了裁剪后的实际工作量？
        *   GIF 等特殊格式导出时，是否保持了与视频导出一致的协同逻辑？
