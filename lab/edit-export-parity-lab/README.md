# Edit / Export Parity Lab

这个浏览器 Lab 用同一份确定性稀疏 WebCodecs 源素材，专项验证 Slice + Crop + Zoom 的预览/导出一致性：

1. Canvas 生成带网格、圆形、正方形和运动标记的 320×180 稀疏源帧，再用 WebCodecs VP8/VP9 编码；
2. 三个实例都使用工程真实 `composite-worker`：
   - Preview：原始编辑配置 + 源时间；
   - Export：Trim 后重基的 Zoom 配置 + 导出相对时间；
   - Unrebased baseline：原始编辑配置 + 导出相对时间，用于确定性证明“未将编辑时间轴重基”会导致失配；
3. Export 合成帧通过项目当前安装的 Mediabunny 1.35 `CanvasSource` 写成 H.264 MP4；
4. 同时通过 Mediabunny `Input` / `VideoSampleSink` 和 `HTMLVideoElement` 回读文件时长、显示尺寸与多个 checkpoint 像素。

Lab 直接导入生产 `edit-export-parity` 时间契约模块和生产 Composite Worker，不复制其核心逻辑。

## 运行

从仓库根目录启动 Vite：

```bash
packages/extension/node_modules/.bin/vite --host 127.0.0.1 --port 4180
```

打开：

```text
http://127.0.0.1:4180/lab/edit-export-parity-lab/
```

点击“运行完整验证”。Chrome 需要支持 WebCodecs H.264 编码。

## 验收阈值

- 稀疏源素材：编码 chunk 数必须等于 13，且首帧和后续帧的时间戳严格递增；
- 未压缩 Worker 像素一致性：所有 checkpoint 的 Preview/Export RGB MAE `≤ 0.05`；
- 未重基基线反证：至少两个 Zoom checkpoint 的 Preview/Baseline RGB MAE `≥ 8`；
- MP4 时长：Mediabunny 与 `HTMLVideoElement` 均在目标 4 秒的 `± 0.12s` 内；
- MP4 显示尺寸：两条回读路径都必须是 `640×360`；
- MP4 像素：每个 checkpoint 对 Preview 的 RGB MAE `≤ 18`，Mediabunny 与 Video 两条回读路径都必须通过；
- 至少覆盖 Slice 起点、两个 Zoom 区间、区间间隙和 Slice 末段五个 checkpoint。

MP4 是有损 H.264，因此文件回读不要求逐字节一致；未压缩生产 Worker 的 Raw 对比承担严格时间/编辑契约断言。

## 证据边界与发布前阻断项

这是 **Contract Lab**：它调用真实 Composite Worker 和真实 Mediabunny MP4 编码/回读，但由 Lab 自己编排帧，证明 Slice 时间重基、Crop、Zoom 与 MP4 像素结果的契约一致。它不等价于 Studio → ExportManager → export-worker 的完整接线测试，不能用本页 PASS 外推其他格式已经可发布。

仍需真实 Studio E2E 覆盖：

- MP4、WebM、GIF 三种格式各跑一次 Slice + Crop + Zoom；尤其确认 GIF 的合成请求完整传递展示时间；
- VFR/static-hold 区间内的 Zoom 过渡（本 Lab 的 10fps 导出会对同一稀疏源帧反复合成，已覆盖核心契约，但仍需真实导出接线）；
- `timelineVersion=1` 旧录制 + Trim；不得因为导出 schedule gate 而回退为整段导出；
- memory chunks 模式下 Slice 起点落在 delta frame 的素材；送入 WebCodecs 的窗口首块必须从关键帧开始。

上述任一真实 E2E 未通过，都应视为对应格式的发布阻断项。
