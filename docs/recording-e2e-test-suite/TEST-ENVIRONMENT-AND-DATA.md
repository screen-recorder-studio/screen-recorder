# 测试环境与测试数据

## 1. 每轮必须记录的环境信息

执行测试前复制下表到发布报告。浏览器和操作系统会影响屏幕选择器、捕获帧率、硬件编码器与窗口行为，缺失环境信息的结果不可用于跨平台结论。

| 字段 | 记录值 |
| --- | --- |
| 扩展版本 |  |
| Git commit |  |
| 构建时间 |  |
| Chrome 完整版本 |  |
| Chrome Channel | Stable / Beta / Dev |
| 操作系统与版本 |  |
| CPU / GPU |  |
| 硬件加速 | 开启 / 关闭 |
| 显示器数量与分辨率 |  |
| 页面缩放 | 100% / 其他 |
| `devicePixelRatio` |  |
| 扩展安装方式 | 商店 / Unpacked |
| 是否清理旧 OPFS 数据 |  |
| 测试人员 |  |
| 测试时间与时区 |  |

## 2. 发布环境矩阵

### P0：每次发布必须覆盖

| 轴 | 必测值 | 说明 |
| --- | --- | --- |
| 浏览器 | 当前 Chrome Stable | 主发布目标 |
| 操作系统 | macOS Stable 环境；Windows Stable 环境 | Picker、窗口源与编码器具有平台差异 |
| 录制来源 | 当前标签页、浏览器标签页、窗口、整个屏幕 | 覆盖无 Picker 与系统 Picker 路径 |
| 页面 | 普通 HTTPS 页面 | 主用户场景 |
| 输出 | MP4 与 WebM，720p 与 1080p | 两条主导出路径；WebM 不得只由共享 MP4 结果外推 |
| 时长 | 30 秒质量卡；90 秒以上长录制 | 覆盖短链路与跨窗口读取 |
| 时间模式 | 正常运动、动→静→动、暂停→恢复 | 覆盖 CFR-like、稀疏 VFR 和 active clock |
| 性能 | 标准机 + 4 核/8GB Windows 低配机 | 验证实时录制、预览内存和导出 RTF |

### P1：重要版本或录制链路变化时覆盖

| 轴 | 建议值 | 说明 |
| --- | --- | --- |
| Chrome | 最低支持版本、当前 Stable | 防止使用高版本 API 后失去兼容性 |
| macOS | 单屏、双屏 | Picker 焦点和整屏尺寸不同 |
| Windows | 100%、125%、150% 缩放 | 验证 DPR、窗口尺寸和像素对齐 |
| 受限页面 | `chrome://extensions`、Chrome Web Store | 验证无法注入内容脚本时的降级路径 |
| 输出 | GIF | 若本版本发布 GIF，验证独立桥接与可变 delay |
| 分辨率 | 原始画布、4K、720p、自定义偶数尺寸 | 验证导出选项真正接线 |
| 压力 | CPU throttling 或 Lab pressure 场景 | 验证不追播过期帧 |

### P2：周期性兼容测试

| 轴 | 建议值 | 说明 |
| --- | --- | --- |
| Chrome Beta | 最新 Beta | 提前发现 WebCodecs 和 Picker 变化 |
| Linux | 主流发行版 | 硬件编码和桌面捕获差异 |
| GIF | 默认与低帧率配置 | GIF 具有独立的可变延迟语义 |
| 超长录制 | 10 分钟、30 分钟 | 内存、OPFS、窗口切换和 finalize 稳定性 |
| 音频 | 无音频、麦克风、系统音频 | 音视频 active clock 与暂停同步 |

## 2.1 性能设备分层

| Tier | 最低代表环境 | 用途 | 发布要求 |
| --- | --- | --- | --- |
| Low | Windows Stable、4 logical cores、8GB RAM、集成显卡 | 老电脑真实下限；Screen/Window、software fallback | 本次性能专项 P1 必测 |
| Standard | 8 logical cores、16GB RAM、主流集成/独立显卡 | 默认 1080p/30 主路径 | 每次发布必测 |
| High | Apple Silicon/高端桌面、≥32GB RAM | 4K 输入、长录制、压力对照 | 不能代替 Low Tier |

每个 Tier 至少记录：硬件加速、`navigator.hardwareConcurrency`、可用时的 `navigator.deviceMemory`、实际 encoder codec/profile、source/applied 尺寸、帧率、queue peak、RTF。`prefer-software` 只是压力代理，不能写成真实低配设备通过。

## 3. 标准测试素材

### DATA-01：录制质量测试卡

位置：`lab/recording-quality-page/`

建议录制脚本：

1. 动画运行 10 秒。
2. “暂停动画”5 秒，页头计时仍继续。
3. 继续动画 3 秒。
4. “冻结画面”至少 10 秒，页面像素完全静止。
5. 解除冻结并继续 5 秒。
6. 停止录制。

覆盖圆和正方形、16:9/1:1、1px 线、网格、文字、色条、灰阶、匀速运动、快速运动、旋转、复合 Transform、普通静止与真正 0Hz 静止。

### DATA-02：稀疏 VFR 三样本

时间轴示例：

```text
sample A: 0ms
sample B: 5000ms
sample C: 20000ms
session end: 25000ms
```

逻辑持续时间应为：

```text
A: [0, 5000)
B: [5000, 20000)
C: [20000, 25000)
```

用于验证 last-frame-hold、Seek、静态区 Zoom、总时长和末样本持续时间。不得把它显示或导出成 3 秒视频。

### DATA-03：单帧长时长

```text
sample A: 0ms
session end: 25000ms
```

用于验证静态尾部。预览任意时刻都应显示 A；导出主路径应持续约 25 秒，而不是 `1 / nominalFps`。

### DATA-04：正常 30fps

- 时长：25 秒。
- 样本数量：约 750。
- 内容：持续运动和计时器。

用于证明新时间模型没有破坏普通录制。容许捕获端自然少量丢帧，但预览和导出时长必须跟随 session duration。

### DATA-05：暂停时间轴

脚本：动 2 秒 → 暂停 5 秒 → 恢复并动 2 秒 → 静止 5 秒 → 停止。

预期 active duration 约 9 秒，而不是 14 秒。恢复后的源时间戳即使跨过暂停区间，也必须映射到 pause-aware active timeline。

### DATA-06：长录制与跨窗口读取

- 时长：至少 90 秒。
- 样本：至少 2,000 个。
- 内容：全程可观察的计时器、旋转和位置变化。
- 关键定位点：5%、25%、50%、75%、95%，以及各读取窗口边界前后。

用于验证窗口加载、旧请求淘汰、播放连续性和快速 Seek。

### DATA-07：长 GOP

- 一个关键帧后包含超过 Reader/Preview 保留上限的 delta 帧。
- Seek 目标位于 GOP 尾部。

预期 Reader 要么使用连续 preroll 正确解码到目标，要么返回显式 typed error；禁止返回不包含目标帧的“成功”窗口。

### DATA-08：奇偶尺寸矩阵

| 尺寸 | 预期 |
| --- | --- |
| 1920×1080 | H.264 保持 1920×1080 |
| 1920×1088 | 合法对照，显示高度确为 1088 |
| 1918×1080 | 偶数尺寸，按浏览器实际能力验证 |
| 1919×1079 | 奇数负例；生产归一到偶数或明确拒绝 |
| 4632×2406 | 高 DPR 原始 captureSize 示例 |

### DATA-09：组合编辑素材

使用 DATA-01 或 DATA-06，保证 Trim 区间内同时存在：

- Crop 边界可见的安全框和圆形。
- 至少一个 1.0–1.5 秒 Zoom 区间。
- 一段真正静态区域。
- Trim 起止点附近可识别的计时或位置标记。

### DATA-10：连续三轮资源回收

同一扩展会话内依次执行：

```text
Screen 30s → WebM
Screen 30s → MP4
Screen 30s → WebM
```

三轮之间不重载扩展、不刷新后台；每轮记录 operationId、live track、Worker 数、VideoFrame ownership、OPFS 文件和导出 RTF，用于区分首次成功与长期资源泄漏。

### DATA-11：性能 Soak

- 每次发布：10 分钟 Balanced 1080p/30。
- 周期执行：30 分钟与 60 分钟。
- 每 2 分钟包含一段 10 秒静态、一次暂停/恢复、一次快速 Seek 和一次跨窗口播放。
- 最终分别导出 WebM/MP4，记录真实 wall time、媒体时长、RTF、峰值/结束内存和 finalize 时间。

## 4. 输出验收工具

| 工具 | 用途 | 必须记录 |
| --- | --- | --- |
| Chrome Studio | 产品预览、编辑和导出 | 操作步骤、截图、Console 错误 |
| Preview Playback Lab | 预览时钟、压力和 Seek | 样本数、p95 interval、p95/max drift、命中率 |
| Recording Quality Page | 几何、清晰度、色彩和运动 | 录制来源、DPR、画面截图 |
| Recording Start Latency Lab | 倒计时预热与正式首帧边界 | picker/encoder/storage/boundary/first-frame 时间、warm-up close 数 |
| Recording Performance Lab | 录制/预览/导出吞吐 | applied plan、RTF、queue、drop、60 分钟投影 |
| H.264 Probe | Chrome 对尺寸/level 的真实支持 | UA、支持矩阵、实际 chunk 数与字节数 |
| Preview Memory Soak Lab | 缓存预算、所有权、切窗和 dispose | retained plan、lane peak、queue peak、cutover、alive bytes |
| Mediabunny 回读 | 容器时长、轨道尺寸、编码和包统计 | duration、coded/display size、codec、packet rate |
| Chrome DevTools | 错误、性能和内存 | Console 导出、Performance/Memory 证据 |

## 5. 定量阈值

| 指标 | P0 验收线 |
| --- | --- |
| 预览 p95 显示间隔 | 前台轻载不高于 25ms |
| 预览 p95 时钟漂移 | 不高于 34ms |
| 压力恢复最大时钟漂移 | 恢复后不高于 34ms，不追播旧帧 |
| 精确 Seek 命中率 | 关键点 100% |
| 导出时长误差 | 不超过一个目标输出帧 |
| 最后输出帧结束时间 | `lastTimestamp + lastDuration ≈ sessionEnd` |
| 输出尺寸 | coded/display 尺寸符合格式契约和用户选择 |
| 静态段 | 完整保留，无提前结束、黑帧或整体加速 |
| Pause | 暂停时间不进入 active duration |
| Console | 无未解释 error、解码失败或无限请求循环 |
| 正式首帧延迟 | 当前 Stable ≤100ms；Low Tier ≤250ms（Picker 时间单列） |
| 低配/标准录制 RTF | ≤1.0 |
| 4K → Balanced 1080p 录制 RTF | ≤0.90 |
| WebM/MP4 导出 RTF | ≤2.0 |
| Preview cutover | ≤250ms |
| Preview retained budget | unknown/≤4GB：≤256MiB；≥8GB：≤512MiB |
| Preview transient headroom | ≤retained budget 的 25% |
| 连续三轮性能退化 | 第三轮相对第一轮不超过 20% |
| Production dispose | 所有 preview lane/frame/bytes 为 0 |

## 6. 证据命名

建议把证据放入发布任务的外部附件目录，不提交大体积视频到 Git。命名格式：

```text
<version>-<os>-<chrome>-<case-id>-<source>-<timestamp>.<ext>
```

示例：

```text
0.6.13-macos-chrome151-PREVIEW-004-tab-20260815T153000+0800.json
0.6.13-win11-chrome151-QUALITY-002-window-20260816T101500+0800.mp4
```

每个 FAIL 至少保留：操作录像或截图、Console、实际文件/元数据、精确时间点和最小复现数据。
