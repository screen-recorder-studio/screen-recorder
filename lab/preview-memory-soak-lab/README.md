# Preview Memory Soak Lab

这个 Lab 通过一个 **Lab-only bootstrap** 实例化工程真实 `composite-worker`，验证：

- `main` 当前窗口与 `next` 预取窗口在多次 cutover 中保持唯一所有权；
- `decodeSingleFrame` 的 hover GOP 帧在 bitmap 返回后全部关闭；
- composite 输出固定为 `640×360`，缓存帧尺寸以 production `previewMemoryPlan` 为准；
- conservative tier 下 1080p 保留原尺寸，4K 自动降为代理帧；
- production 发布的 decode queue high watermark 不得小于实测 peak；
- Crop 5% + Zoom 1.1× 后，四角彩色标记仍存在、中心圆宽高比须在 `0.92–1.08`；
- 每个 cutover 从发出 `process` 到下一窗口首帧返回的间隙不超过 `250ms`；
- 运行 9 秒、多次 cutover 后，生产 `dispose` 是否能达到 `cleanup=0`。

## 运行

```bash
cd packages/extension
pnpm exec vite --host 127.0.0.1 --port 4184 --config ../../lab/preview-memory-soak-lab/vite.config.ts
```

打开 `http://127.0.0.1:4184/`，选择单场景或依次运行 1080p/4K。

静态与纯 fixture：

```bash
packages/extension/node_modules/.bin/vitest run --root . lab/preview-memory-soak-lab/memory-soak-fixture.test.ts
packages/extension/node_modules/.bin/tsc -p lab/preview-memory-soak-lab/tsconfig.json --noEmit
```

## 验收矩阵

| 阶段 | main | next | hover | 预期 |
| --- | ---: | ---: | ---: | --- |
| main ready | 3 | 0 | 0 | 主窗口持有 3 帧 |
| prefetch + hover complete | 3 | 3 | 0 | hover 曾持有帧，但 bitmap 后清零 |
| cutover | 3 | 0 | 0 | 旧 main 已关闭，原 next 成为新 main |
| stable after prefetch | 3 | 3 | 0 | 多轮切窗总 live frame 不增长 |
| production dispose | 0 | 0 | 0 | 必须通过，production `disposed` 后 snapshot 为零 |
| Lab forced cleanup | 0 | 0 | 0 | 只释放测试资源，不算生产通过 |

1080p source 每帧理论 RGBA 为 `8,294,400 bytes`；4K source 每帧为 `33,177,600 bytes`。实际 retained bytes 使用 worker 发布的 `previewWidth × previewHeight × 4`，不能用 `640×360` composite 输出尺寸替代。

## 2026-08-16 Chrome 实跑

| 场景 | Retained plan | Stable main/next/hover | Lane peak main/next/hover | Queue peak/high | 8 次 cutover max | Crop+Zoom | Dispose |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| 1080p | `1920×1080`, full-size | `3/3/0` | `3/3/1` | `3/8` | `78.2ms` | `9/9` PASS | `0` PASS |
| 4K | `2730×1536`, proxy | `3/3/0` | `4/4/1`¹ | `2/2` | `55.0ms` | `9/9` PASS | `0` PASS |

¹ 4K lane peak 包含 source decode frame 与新建 proxy frame 在同步转换瞬间的短暂重叠；稳定窗口仍严格为 `3 main + 3 next`。两场景均运行约 `9.16s`，cutover 门槛为 `≤250ms`，Chrome console `error/warn = 0`。

## Telemetry 与证据边界

production `composite-worker` 的三个帧数组是模块私有状态，公开协议有 `dispose`，但没有 ownership snapshot。bootstrap 在加载真实 worker 前：

1. 包装原生 `VideoDecoder`，按 `process`、`appendWindow`、`decodeSingleFrame` 的 chunk 提交批次标记输出帧所有者；
2. 记录 production 对 `VideoFrame.close()` 的真实调用；
3. 在预取窗口被 production 复用为当前窗口时，把存活记录从 `next` 迁移为 `main`；
4. 捕获 production 发布的 preview plan / queue watermark，并统计真实 decoder queue peak；
5. 只为 Lab 提供 snapshot 与 forced cleanup。

因此，切窗、hover、proxy 转换、queue 背压与 dispose 断言都观察真实 production 行为。`labCleanup` 仅在 production dispose 之后作兜底释放；它永远不参与 PASS 判定。

这个 Lab 每个窗口只合成 3 帧（4fps fixture），9 秒是多轮 cutover 的 soak 时长。它证明 ownership、竞态、Crop/Zoom 几何、queue 水位和资源释放边界，**不代表 30fps 解码或合成吞吐测试**。

## 验收阈值

- main/next 稳定帧数必须精确为 `3/3`，hover 响应后 live 必须为 `0` 且 peak 至少为 `1`；
- `allocated - closed === totalAlive`，production dispose 后 frame/bytes 都必须为 `0`；
- main decoder queue peak `≤` worker 发布的 high watermark；
- 至少 8 次 cutover，单次 `process → 首帧 → Canvas readback` 最大间隙 `≤250ms`；
- 9 个 Crop+Zoom checkpoint 均须检出四角标记，圆形宽高比在 `0.92–1.08`；
- 浏览器 console 不得出现 worker `error/warn`。
