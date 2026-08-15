# Recording performance Lab

这个页面把性能问题拆成三个可独立归因的阶段：

1. `record/encode`：确定性源画面直接作为原始 `VideoFrame` 送入 WebCodecs，encoder 的目标尺寸负责缩放；记录真实耗时、最大 `encodeQueueSize` 和输出 chunk 数。
2. `preview`：编码 chunk 交给工程真实 `composite-worker`，逐个 `renderAtTime`，记录响应 p95。
3. `WebM export`：完整 chunks 交给真实 `ExportManager → export-worker → composite-worker → Mediabunny`，记录真实 RTF 与 Blob 大小。

运行：

```bash
cd packages/extension
pnpm exec vite --host 127.0.0.1 --port 4183 --config ../../lab/recording-performance-lab/vite.config.ts
```

打开 `http://127.0.0.1:4183/lab/recording-performance-lab/`。

## 场景与发布预算

- 低配代理：1920×1080 source 缩到 1280×720/24fps，请求 `prefer-software`；录制 RTF ≤1、预览 p95 ≤41.7ms、WebM 导出 RTF ≤2。
- 标准：1920×1080/30fps；录制 RTF ≤1、预览 p95 ≤33.3ms、WebM 导出 RTF ≤2。
- 4K Balanced：直接把 3840×2160 原始 `VideoFrame` 送入配置为 1920×1080/30 的
  encoder，不在 Canvas 预缩放；录制 RTF 必须 ≤0.9，给实时录制至少保留 10% 余量。
- 4K 压力：3840×2160/30fps，仅手工运行；因为当前预览 fallback 理论上可保留 270 个解码帧，不能把它放进默认自动矩阵。

RTF 是 wall time / video duration。商店差评中的 60 分钟导出 4 天相当于 96× RTF；本 Lab 会直接给出 60 分钟投影。

## Chrome 151 基线（2026-08-16）

测试机：12 logical cores、32GB `deviceMemory`。

| 场景 | Capture RTF | Preview p95 | WebM export RTF | 60min 投影 | 结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1080p source → 720p/24，software hint | 0.08× | 2.2ms | 0.15× | 9min | PASS |
| 1080p/30，browser preference | 0.14× | 4.6ms | 0.23× | 14min | PASS |
| 4K source → Balanced 1080p/30 | 0.15× | 5.0ms | 0.24× | 14min | PASS |
| 4K/30 direct stress | 1.12× | 13.7ms | 0.73× | 44min | **FAIL: capture** |

三组都没有 Lab 级丢帧，最大 encoder queue 为 5。4K direct 在这台较强机器上仍不能实时完成
录制编码，证明默认原始 4K 路径没有足够余量；它不能作为“低配可用”的发布证据。

真实扩展端测（Tab capture、2560×1203 viewport、约 2× DPR）也通过：Balanced 编码后
Studio 为 1920×1080 composition；持续 01:31.86 得到 2755 帧（29.99fps）。播放预览的
固定 2.19 秒窗口从 00:00.46 前进到 00:02.73，旋转盘和 CSS Transform 卡片均连续变化。

同一静态审计还发现：DedicatedWorker 中 `performance.memory` 分支不可用，Reader 当前窗口最多
140 帧、预取最多 120 帧，hover GOP 又可另外保留 140 帧，最坏约 400 张解码帧同时存活。
按代码的 RGBA 估算，1080p 约 3.09GiB、4K 约 12.36GiB。因此发布前必须建立与分辨率相关的
硬内存预算和预览代理尺寸，hover 只保留目标帧；不能只把帧数上限调低，否则会缩短播放跑道并
重新引入切窗卡顿。

## 证据边界

- `prefer-software` 只是 WebCodecs hint，浏览器可忽略；它是低配压力代理，不等于一台真实旧电脑。
- 素材只有 1–2 秒，用于吞吐和队列回归；正式发布仍需 10 分钟、60 分钟 soak，以及一台 4 核/8GB Windows 机器。
- 录制阶段使用相同 WebCodecs/缩放原语，但不调用 `getDisplayMedia`、OPFS writer；上面的真实扩展结果补足了 Tab 主旅程，Window/Screen 和低配 Windows 仍需单独端测。
- 内存读数使用非标准 `performance.memory`，不可用时明确显示 `unavailable`。

一手资料：WebCodecs 的 `hardwareAcceleration` 只是 hint，浏览器可忽略；`quality` 模式禁止为满足码率/帧率丢帧，而 `realtime` 允许丢帧。见 [W3C WebCodecs](https://www.w3.org/TR/webcodecs/#videoencoderconfig)。Chrome 官方也建议把逐帧 WebCodecs 工作放在 Worker 中，避免高频回调阻塞主线程：[Chrome WebCodecs best practices](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)。
