# Video Zoom 功能端到端评估

Video Zoom 功能允许用户在时间轴上定义特定的时间段，对视频画面进行平滑放大，以突出显示特定区域（如菜单、按钮或细节）。

**已实现的核心能力：**
1.  **区间管理**：支持在时间轴上创建、移动、调整时长和删除 Zoom 区间。
2.  **焦点设置**：支持通过可视化的“焦点面板”在源视频上点击设置关注点 (Focus Point)。
3.  **平滑渲染**：基于 WebCodecs 和 OffscreenCanvas 在 Worker 线程中实现高性能渲染，支持 `easeInOutCubic` 缓动过渡 (300ms)。
4.  **Dolly Zoom 效果**：放大时自动将设定的焦点平滑移动至画面中心，提供类似推镜头的视觉引导体验。
5.  **帧级对齐**：交互操作（拖拽、调整大小）均自动对齐到视频帧边界，确保画面无跳动。

请端到端评估功能：

1. 负责状态管理，管理全局 Zoom 开关、焦点坐标及区间列表，包含重叠检测逻辑 `src/lib/stores/video-zoom.svelte.ts`
2. 负责渲染引擎，在 Worker 线程中进行画面合成，包含核心算法 `calculateZoomScale` 和渲染逻辑 `src/lib/workers/composite-worker/index.ts`
3. 负责预览交互，作为协调层将 Store 配置同步给 Worker，处理预览帧请求及响应时间轴事件 `src/lib/components/VideoPreviewComposite.svelte`
4. 负责时间轴交互，提供 Zoom 区间的可视化操作（拖拽、调整大小、删除） `src/lib/components/Timeline.svelte`
5. 负责焦点设置，提供在“源空间”设置焦点的可视化交互面板 `src/lib/components/VideoFocusPanel.svelte`