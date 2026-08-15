# Production Export Worker E2E Lab

这个 Lab 从 localhost 直接调用工程真实 `ExportManager.exportEditedVideo`，由 Manager 创建真实 `export-worker/index.ts`。memory source 路径不依赖 Chrome API 或 OPFS；仅需 Lab Vite 配置补齐扩展工程的 `$lib` 路径别名，不新增生产测试注入缝。

验证链路：

```text
确定性 Canvas → WebCodecs VP8 chunks
  → 真实 ExportManager → 生产 createMemoryTrimExportPlan
      （keyframe preroll + visible range）
  → 真实 export-worker → 真实 composite-worker
  → Mediabunny CanvasSource → MP4/WebM Blob
  → Mediabunny Input / VideoSampleSink
  → Preview 源时间 checkpoint 像素对比
```

默认打通 MP4/H.264；WebM 使用相同入口，可从下拉框运行，但在未实际执行前保持 `unverified`。GIF 的 export-worker 分支可达，但还需要 ExportManager 在主线程完成 `gif-init` / `gif-add-frame` / `gif-render` 握手，并正确提供 gif.js 静态 worker 资产，因此矩阵将其显式标为 `bridge-required`，不把 MP4 结论外推到 WebM/GIF。

## TDD

```bash
packages/extension/node_modules/.bin/vitest run \
  lab/production-export-worker-e2e-lab/export-e2e-fixture.test.ts --root .

packages/extension/node_modules/.bin/tsc --noEmit \
  -p lab/production-export-worker-e2e-lab/tsconfig.json
```

测试固定以下边界：直接使用生产 Slice plan、保留 keyframe preroll 但不输出 preroll、半开区间、不修改源 chunks、格式矩阵，以及时长/尺寸/像素的组合验收。

## 运行

```bash
packages/extension/node_modules/.bin/vite --host 127.0.0.1 --port 4182 \
  --config lab/production-export-worker-e2e-lab/vite.config.ts
```

打开 `http://127.0.0.1:4182/lab/production-export-worker-e2e-lab/`，点击“运行真实导出”。

## 验收

- 真实 export-worker 必须返回非空 Blob；
- 文件时长与 Slice 目标 `3.000s` 误差不超过 `0.12s`；
- Mediabunny 回读显示尺寸必须是 `640×360`；
- 7 个 checkpoint 必须覆盖普通画面、两段 Zoom 稳态以及入口/退出 transition；
- 每个导出 checkpoint 对 Preview 源时间像素 RGB MAE 不超过 `18`；
- Worker 不得发出 `error`，页面控制台不得有 error/warning。

## 尚未覆盖的发布验证

- GIF 的 ExportManager 主线程编码桥和最终文件像素；
- OPFS 时间线、`timelineVersion=1` 旧录制 Trim；
- 更长 GOP、真实录制素材上的 memory delta 起点回退（本页已用 1.100s delta 起点验证生产 preroll/visible-range 核心接线）；
- 非帧对齐的 Trim start 与 last-frame-hold 语义仍是已知 P1；本页刻意使用帧对齐的 1.100s，不用容差掩盖错一帧；
- 真实 Studio UI 的配置序列化、取消与下载接线。
