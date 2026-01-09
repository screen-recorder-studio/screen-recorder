## 性能 / 内存问题记录（基于 `.prompt` 指引的链路评估）

| 环节 | 位置 | 问题 | 影响 | 状态 | 建议/动作 |
| --- | --- | --- | --- | --- | --- |
| 预览窗口切换/悬停预览 | `src/lib/components/VideoPreviewComposite.svelte` + `composite-worker` | 鼠标悬停到当前窗口外的时间戳时，只要窗口数据返回得较慢且用户又移动了位置，原有逻辑不会重新发起窗口请求，导致 Timeline 预览长期显示 loading/落在错误帧 | 长时预览或拖动时间轴时无法精准定位帧，用户体验降级 | **已修复** | 为预览窗口请求增加 in-flight 跟踪与自动补发：窗口 ready 仍未覆盖最新 `previewTimeMs` 时会立即重新请求，并避免窗口内重复帧的多余消息。 |
| OPFS 读取 | `src/lib/workers/opfs-reader-worker.ts` | `index.jsonl` 读取一次性 `text()` + 全量 `split`，长录制（>几万帧）会把整份索引加载进内存 | 内存峰值随录制时长线性增长，解码前的解析耗时也会增加；在 4K/长时录制下有 OOM 风险 | 未解决 | 切换到流式解析（逐行读取或 chunked 解析），并考虑按窗口范围增量加载索引/数据而不是全量常驻内存。 |
| OPFS 写入 | `src/extensions/offscreen-main.ts` → `opfs-writer-worker.ts` | 采用“每帧一写”方式直接追加到 OPFS，缺乏批量缓冲/对齐；长时间录制时 OPFS IOPS 和碎片化风险升高 | 录制端磁盘/CPU 抖动，可能放大前台页面卡顿 | 未解决 | 为 OPFS writer 增加 0.5s~1s 的写入缓冲或批量 flush，同时保留关键帧及时刷写，降低 I/O 压力。 |
| 录制端内存占用 | `src/extensions/offscreen-main.ts` (`recordedChunks` 元数据常驻) | 即使启用 OPFS 写入，`recordedChunks` 仍为每个片段保留对象（size、ts、type），长时录制下该数组持续增长 | 内存随帧数线性增长（元数据而非二进制，但仍会在长录制时积累 MB 级别开销） | 未解决 | 在 OPFS 写入成功后按时间片清理或分段归档 `recordedChunks` 元数据，只保留必要的计数和最近片段信息。 |

### 备注
- 编码端关键帧间隔在 `offscreen-main.ts` 中固定为 ~2 秒（`keyEvery = framerate * 2`），Seek/预览友好；若要进一步优化随机预览，可在 4K/高帧率下考虑 1–1.5 秒 GOP。
- Studio 侧 Hover 预览改动后，仍建议结合 `.prompt/evaluate-playback-flow.md` 中的预读策略（双缓冲/滑动窗口）来降低“loading”频率。
