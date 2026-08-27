# 用户故事覆盖矩阵

## 1. 故事到端到端用例

| 用户故事 | 发布优先级 | 主端到端用例 | 自动化/技术回归支撑 | 当前证据结论 |
| --- | --- | --- | --- | --- |
| US-01 首次安装 | P1 | ONB-001～002 | i18n、window navigation 单测 | 需要新版本 Full 执行 |
| US-02 标准来源 | P0 | ENTRY-001～004 | recording startup、tab capture、coordinator | Tab 有历史实机证据；Window/Screen 每版复验 |
| US-03 GIF Area | P0 | AREA-001～007 | area layout/context/crop/frame transfer | macOS DPR2 动态主路径和产物已通过；zoom/Windows/生命周期矩阵待补 |
| US-04 会话控制 | P0 | SESSION-001～007 | session/coordinator/store/timeline/OPFS finalize | 核心状态机有覆盖；竞争与资源回收需实机 |
| US-05 Studio 交接 | P0 | STUDIO-001 | delivery profile、recording ready | 链路存在；需证明 exact ID/intent/only once |
| US-06 预览定位 | P0 | STUDIO-002～004 | decode lane/window/backpressure/scheduler/first-frame | 715 帧实录播放已推进；动态视觉断言仍不可省略 |
| US-07 时间编辑 | P0 | EDIT-002～003、EXPORT-006 | trim/focus/timeline/export parity | 需真实交互和文件回读 |
| US-08 构图品牌 | P1 | EDIT-001、EDIT-004～005、EXPORT-006 | crop/size/background store | Original/Styled 往返实机通过；组合几何和持久化需 Full |
| US-09 视频导出 | P0 | EXPORT-004～007 | export worker、dimensions、H.264 config、cleanup | MP4/WebM 有历史证据；每版至少 Smoke 一个视频格式 |
| US-10 邮件 GIF | P0 | EXPORT-001～003、006～007 | defaults/advisory/preflight/schedule/artifact inspector | 8 秒 320×179/80 帧动态产物已回读；实际动画与体积仍是每版 P0 |
| US-11 Manager | P0 | MANAGER-001～004 | OPFS list、theme contract | UI 已实现；删除/残缺/升级持久化需纳入发布 |
| US-12 恢复升级 | P0 | ENTRY-004、SESSION-004～007、STUDIO-004、MANAGER-004 | operationId/revision、capture errors、worker generation | 部分历史证据；完整重启/升级仍不足 |
| US-13 隐私权限 | P0 | TRUST-001～002、GATE-004 | Manifest、静态搜索、Network 观察 | 本地架构成立；商店声明需复核 |
| US-14 A11y/i18n | P1 | A11Y-001～002、I18N-001 | semantic presentation/theme tests | 关键组件有契约；完整键盘和 locale 矩阵待执行 |
| US-15 性能稳定 | P1 | PERF-001～002 | memory budget/backpressure/performance labs | macOS 有历史证据；低配 Windows/长时 Soak 未闭环 |

## 2. 发布层级覆盖

| 用例域 | Smoke | Full | Extended |
| --- | --- | --- | --- |
| CLI/构建门禁 | 全部 | 全部 | 全部 |
| 首次安装 | 不强制 | 全新安装 + 升级 | 多 locale/策略环境 |
| 标准录制 | Tab | Tab + Window + Screen | 多显示器、受限来源、硬件回退 |
| GIF Area | 主路径 + fail-closed | cancel/reselect/DPR/scroll/resize | 多显示器、高 DPR、页面复杂变换 |
| 会话 | countdown/close/pause/stop | source ended/SW 回收/并发/三轮 | 浏览器重启、长时竞争压力 |
| Studio | handoff/首帧/动态播放 | Seek/旧录制/错误恢复 | 长 GOP、超长时间线、低配设备 |
| 编辑 | Trim + 一项构图 | 全部控制与组合 | 极端尺寸/复杂动画/历史数据 |
| 导出 | GIF + MP4 或 WebM | 三格式 + 编辑 parity + 取消 | 大文件、硬件回退、长时导出 |
| Manager | 列表/打开 | 删除/批删/残缺/升级 | 大量录制和存储压力 |
| 信任/A11y/i18n | 本地网络观察、主键盘路径 | 权限/对比度/en/zh/fallback | 屏幕阅读器和扩展 locale 矩阵 |
| 性能 | 目标机主路径无阻断 | 1080p + 连续三轮 | 低配 Windows、10/30/60 分钟 |

## 3. 自动化优先级

### 第一批：稳定可自动化

- GATE-001～006；
- AREA-004 的坐标换算和无效输入契约；
- STUDIO-003 的确定性 Seek 数据；
- EXPORT-001～003 的默认、帧计划、结构和体积风险；
- TRUST-002 的 Manifest 与发布文案静态审计；
- CASE-CATALOG 结构和覆盖完整性。

### 第二批：浏览器辅助自动化

- Action/Manager/Studio 的导航、焦点、主题和无横向溢出；
- 使用固定 GIF Lab 页面完成 Area 主路径；
- Studio 两时间点截图差异；
- 导出下载捕获、格式签名和媒体 metadata 回读；
- Manager 打开精确 recording ID 与删除确认。

### 保留人工或半自动

- Chrome Display Picker、Stop Sharing、多显示器；
- 浏览器/扩展完整重启；
- 肉眼判断动画语义与严重视觉瑕疵；
- 低配设备资源曲线、30/60 分钟 Soak；
- 屏幕阅读器完整体验。
