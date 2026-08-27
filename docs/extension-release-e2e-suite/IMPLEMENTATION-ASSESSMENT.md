# 当前实现端到端评估

> 评估基线：`codex/release-gif-area-recording`，父提交 `b190775` 加本轮候选工作树。
> 评估方式：产品文档、Manifest、Action/Background/Offscreen/Studio/Manager 源码、现有自动化测试、0.6.12 发布报告与本轮 GIF Area 浏览器产物交叉检查。
> 本文是“测试设计前的实现审计”，不是本版本新一轮真实浏览器执行报告。

## 1. 总结

当前系统已经具备一条结构正确的核心闭环：

```text
Action
→ 标准录制或 GIF Area
→ RecordingCoordinator
→ Offscreen + WebCodecs
→ OPFS
→ 指定 recording 的 Studio
→ MP4 / WebM / GIF
→ Recording Manager
```

最成熟的是标准录制、OPFS 母版、Studio 时间线和视频导出技术回归。新增 GIF Area 的领域边界也合理：`area` 是捕获范围，`gif` 是交付 intent，没有产生第二套 GIF 采集器。

当前发布风险主要不是“有没有代码”，而是不同故事的证据成熟度不一致：

1. GIF Area 已在 macOS Chromium 完成动态录制、Studio 播放、Original/Styled 往返和实际 GIF 回读，但仍需把这条旅程固化为每版执行；
2. Area 仍需补齐页面 zoom、滚动、resize/navigation 失效、受限页面和 Windows 的矩阵；
3. Welcome、Control、Popup、Sidepanel 仍存在多代入口，需要证明状态语义一致；
4. EDM 只实现了默认参数、估算/风险提示和结构校验，还没有自动压到预算、fallback PNG 或完整 Landing Motion Pack；
5. Recording Manager、无障碍、本地化、隐私声明和升级兼容需要进入正式发布矩阵。

## 2. 用户故事覆盖

| 用户故事 | 当前状态 | 源码/资产证据 | 主要发布风险 |
| --- | --- | --- | --- |
| US-01 首次安装 | 部分完成 | `background.ts` 安装时打开 `welcome.html`；Welcome 可发起标准录制 | Welcome 仍使用兼容状态接口；“PRO Trial/无限时长”等文案需与真实商业和性能边界核对 |
| US-02 标准来源 | 已实现，需全矩阵复验 | Popup 提供 tab/window/screen；Background 统一处理请求 | Picker、多显示器、受限来源和取消重试依赖真实 Chrome |
| US-03 GIF Area | 已实现核心闭环 | `area-selector.ts`、Area context、crop、frame transfer、intent；macOS DPR2 动态实录 | zoom/resize/scroll、受限页和 Windows 仍需每版端测 |
| US-04 会话控制 | 较完整 | RecordingCoordinator、session store、Popup session model | Service Worker 休眠、来源主动结束、近同时 Stop 仍是高风险竞争条件 |
| US-05 Studio 交接 | 已实现 | `OPFS_RECORDING_READY` 打开 `studio.html?id=...&intent=gif` | 必须验证精确 ID、只打开一次及失败不误打开 |
| US-06 预览定位 | 技术覆盖强 | decode window/lane/backpressure、timeline/seek 单测；715 帧 GIF Area 录制播放推进 | 静止画面是历史高风险，仍必须保留 P0 视觉断言 |
| US-07 时间编辑 | 已实现 | Trim、Timeline、Focus/Zoom 与导出 parity 契约 | VFR、静态 hold、重叠效果和边界需要产物回读 |
| US-08 构图品牌 | 已实现主要控制 | Crop、aspect、BackgroundPicker、padding、radius、shadow；Original/Styled 往返已实机通过 | 上传背景持久化及更多组合配置的几何一致性 |
| US-09 视频导出 | 已实现 | MP4/WebM Worker 策略、尺寸与 metadata 测试 | 真实编码能力、取消清理、构建代次错配需浏览器验证 |
| US-10 邮件 GIF | 部分完成 | GIF intent、10fps、精确 600/480/320px、体积 advisory、memory preflight；8 秒 320×179/80 帧动态产物回读通过 | 尚无自动体积优化、fallback PNG、邮件客户端预览和多预算闭环 |
| US-11 Manager | 已实现 | OPFS 列表、缩略图、单删/批删、残缺状态与确认对话框 | 大量录制性能、删除失败部分成功、键盘焦点恢复需验证 |
| US-12 恢复升级 | 部分完成 | operationId/revision、session storage、错误码与旧数据 fallback；OPFS reader 错误即时透传 | 浏览器重启、扩展升级、旧 Worker 资产和损坏 OPFS 的真实覆盖不足 |
| US-13 隐私权限 | 基础成立 | Manifest 无 host permissions；主媒体路径使用 OPFS；无产品媒体上传调用 | 发布文案仍提到可选云发布，但当前实现未形成该能力；需做网络观察 |
| US-14 A11y/i18n | 部分完成 | 关键 dialog role/focus trap、Action/Manager semantic controls、en/zh GIF strings | 全键盘路径、全部页面对比度、非 en/zh 新字符串回退仍未系统验收 |
| US-15 性能稳定 | 部分完成 | 1080p encode plan、memory budget/backpressure、既有 labs | 低配 Windows、长时 Soak 和连续三轮真实资源曲线仍是外部证据缺口 |

状态含义：

- “已实现”表示源码主链路存在，不等于本次发布已经 PASS；
- “较完整/技术覆盖强”表示有较丰富自动化契约，仍需真实扩展主旅程；
- “部分完成”中的未实现能力不得在发布文案中包装成已交付。

## 3. 架构与体验风险

### 3.1 多代入口并存

Popup、Control 和 Welcome 已使用 `REQUEST_START_RECORDING`，但初始化仍混用 `REQUEST_RECORDING_SESSION` 与 `REQUEST_RECORDING_STATE`；Sidepanel 仍保留旧 `START_CAPTURE/STOP_CAPTURE` 路径。发布测试必须把 Action 定义为主入口，并单独测试其他入口不会制造第二个 owner 或覆盖主会话。

### 3.2 GIF 的成功判定过低

文件存在、签名为 GIF89a、Studio 时钟前进都不能证明用户录到了动画。发布验收必须同时满足：

- 源页面存在可观察的周期运动；
- Studio 至少两个时间点的帧像素/视觉状态不同；
- 导出 GIF 解码后至少两个展示帧不同；
- 帧间延迟和总时长落在允许误差内。

### 3.3 EDM 定位与实际能力边界

当前已具备邮件友好的初始参数和 1 MB/5 MB 风险分级，但体积仍是估算，且没有自动迭代帧率、尺寸、调色板来命中预算。因此可发布承诺应是“提供邮件导出建议并校验实际产物”，不能承诺“一键保证适配所有 EDM”。

### 3.4 本地优先声明

录制母版、编辑配置和输出均在浏览器本地处理，Manifest 也没有广泛站点权限。测试仍需观察 DevTools Network，区分用户主动打开 GitHub/官网链接与媒体数据外传，并核对商店文案中的“可选云发布”是否删除或明确标记为未来能力。

## 4. 发布建议

- 将 [TEST-CASES.md](./TEST-CASES.md) 中的 Smoke 作为每个候选构建硬门禁。
- 本轮可对 GIF Area 垂直切片作 macOS Chromium 单平台 Go；整个扩展只能在 Window/Screen、Manager、恢复、A11y/i18n 等剩余 P0/P1 用例执行后再作 Full 发布签字。
- 每次商店发布至少执行 macOS 或 Windows 的 Full；另一平台未执行时只能写“单平台灰度可发布”。
- GIF Area、动态 Studio 播放、实际 GIF 动画、Manager 打开/删除和本地网络观察列为不可豁免 P0。
- 将低配 Windows、多显示器、高 DPR 和 30 分钟 Soak 放入 Extended；媒体管线或权限变更时强制执行。
- 未实现的 fallback PNG、自动压缩命中预算和 Landing Motion Pack 进入产品 backlog，不以测试用例伪装成现有能力。
