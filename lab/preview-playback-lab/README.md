# Preview Playback Lab

这个 Lab 用真实 Chrome WebCodecs 完成“Canvas → VideoEncoder → EncodedVideoChunk → VideoDecoder → VideoFrame”，再把解码帧送入两种预览调度方式：

- `source`：只有源帧索引变化时才合成，复现稀疏/VFR 区间内编辑效果冻结。
- `clock`：每个显示时钟 tick 都提交期望展示时刻；同一源帧使用 last-frame-hold，但编辑效果时间继续前进；Worker 过载时只保留最新请求。

## 运行

从仓库根目录运行：

```bash
pnpm --filter extension exec vite --host 127.0.0.1 --port 4178
```

然后打开：

```text
http://127.0.0.1:4178/lab/preview-playback-lab/
```

默认场景为“动 2 秒 → 静态 4 秒 → 动 2 秒”。橙色箭头属于源视频；青色指针属于随展示时间变化的编辑效果。静态区橙色箭头应保持不动，候选侧青色指针仍应连续旋转。

## 验收

- WebCodecs 编码帧数与解码帧数一致。
- 工程真实 `composite-worker` 用 1920×1080 源帧和 1920×1080 合成画布，对同一源帧的不同展示时间返回对应 request/time，且 Zoom 合成像素结果不同。
- 候选在 4 秒静态区至少重绘 120 次，且明显高于源帧驱动基线。
- 前台 60Hz Chrome、轻量负载时，候选 p95 显示间隔不高于 25ms。
- 候选 p95 展示时刻与单调媒体时钟漂移不高于 34ms。
- 压力场景恢复后的最大漂移不高于 34ms，且显著低于源帧驱动基线，证明没有追播过时位图。
- 精确定位探针在 0、静态区边界、静态区内部、恢复运动边界和末尾全部命中 last-frame-hold 应选的源帧。

`pressure` 场景会每 2 秒注入约 70ms 的 Worker 阻塞，目标不是消灭不可避免的单次长帧，而是确认候选不会在阻塞后排队播放过时帧。

## 一手资料

- [WebCodecs](https://www.w3.org/TR/webcodecs/)
- [Chrome WebCodecs best practices](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)
- [requestVideoFrameCallback](https://wicg.github.io/video-rvfc/)
- [Long Animation Frames](https://www.w3.org/TR/long-animation-frames/)
