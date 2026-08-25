# 产品 UI 设计系统整体评估

> **状态更新（2026-08-24）**：本文件记录上一轮以 `chrome-covers` Studio 为单一视觉基准的评估。安装并应用更严格的 `frontend-design` v2.0、WCAG 2.2 AA 和场景适配协议后，原“8.6 / 10、可以发布”结论已被替代。当前有效结论见 [UI 场景适配与对比度全面评审](./UI-CONTEXT-CONTRAST-COMPREHENSIVE-REVIEW.md)。

## 结论

截至 2026-08-24，产品主任务流 `Popup → Control → Recording Manager → Studio → Export / Drive / Delete dialogs` 已形成一致的深色创作工具语言，达到当前版本的发布要求。

这次统一不等于“所有页面使用相同布局”。统一的是颜色层级、表面关系、控件状态、强调色语义、焦点反馈和弹窗行为；不同任务仍保留合适的密度与结构：Popup 是紧凑入口，Control 是录制设置，Recording Manager 是内容库，Studio 是编辑工作台。

综合评分为 **8.6 / 10**。当前最有价值的后续工作不是继续扩大视觉改造范围，而是把现有 `.studio-theme` 提炼成中性的产品级 token 层，并在组件层逐步替代兼容性 utility 映射。

## 评估方法与基准

本轮使用以下证据交叉评估：

- 对照 `/Users/wxnet/Base/Projects/chrome-covers` Studio 的壳、表面、控件和弹窗层级。
- 检查扩展 manifest、路由入口与实际消息导航，区分主链路、安装引导、录制覆盖层、历史页面和开发诊断页。
- 通过主题契约测试约束关键几何与颜色，不把视觉约定只留在 CSS 中。
- 使用 Computer Use 在真实 Microsoft Edge 扩展环境中逐页检查视觉、无障碍树、键盘焦点、选择态和删除确认，不以静态代码代替真实界面判断。
- 以全量测试、`svelte-check`、生产扩展构建和差异卫生检查作为发布兜底。

设计基准详见 [Studio 与弹窗视觉统一评估](./STUDIO-CHROME-COVERS-STYLE-UNIFICATION-EVALUATION.md)。

## 发布界面范围

| 界面 | 角色 | 统一策略 | 状态 |
| --- | --- | --- | --- |
| Popup | 默认 Action 入口 | 深色紧凑壳；蓝色视频主操作；紫色 GIF 垂直入口 | 完成并通过真实界面复核 |
| Control | 更多视频录制选项 | 深色设置面板；蓝色选择、焦点和开始操作；危险态使用红色 | 完成并通过真实界面复核 |
| Recording Manager | OPFS 录制内容库 | 56px 顶栏、1280px 内容区、暗色卡片网格、显式选择模式 | 完成并通过真实界面复核 |
| Studio | 播放、编辑与交付工作台 | zinc 深色工作台、320px 属性栏、统一时间线和编辑控件 | 已完成 |
| Export / Drive / Delete | 高风险或阶段性任务 | 统一遮罩、面板、页脚、焦点陷阱、Escape 和焦点恢复 | 已完成 |
| Countdown | 录制前沉浸状态 | 保留独立全屏蓝色倒计时，不引入编辑器导航 | 已符合体系，无需迁移 |
| Welcome | 安装与首次使用引导 | 保留营销/教育页面结构；品牌语义一致即可，不要求工作台同构 | 本轮有意不改 |

以下路由不作为当前发布主界面的视觉验收对象：`sidepanel`、`web-record`、根提示页属于历史或备用实现；`opfs-drive`、`keyframe-analyzer`、`data-analyzer` 属于开发诊断工具。后续若重新进入产品导航，必须先纳入设计系统和发布测试，而不是直接暴露现有页面。

## 统一设计契约

| 维度 | 契约 | 业务语义 |
| --- | --- | --- |
| 应用壳 | `#09090b` / zinc-950 | 工作空间底层，降低长时间使用时的视觉噪音 |
| 面板 | `#18181b` / zinc-900 | 顶栏、工具区、内容卡片与弹窗主体 |
| 抬升表面 | `#27272a` / zinc-800 | 次级按钮、分段控件、悬停与选中前景 |
| 边界 | `white/5` 至 `white/12` | 主要依靠明度差分层，避免厚重网页卡片感 |
| 主文字 | zinc-100 | 标题、当前值与主操作 |
| 次文字 | zinc-400 / zinc-500 | 描述、元数据和非激活信息 |
| 通用强调 | blue-500/600 | 视频、选择、编辑、导出与键盘焦点 |
| GIF 强调 | violet-500/600 | 只表达 GIF 身份、GIF 入口和 GIF 导出 |
| 危险强调 | red-500/600 | 删除、停止和错误；不与普通次级操作混用 |
| 几何 | 56px 顶栏、16px 弹窗圆角、12px 常规卡片圆角 | 与 `chrome-covers` 产品族保持一致 |

Recording Manager 额外使用 1280px 最大内容宽度和 260px 卡片最小宽度，保证录制库能显示有效缩略图、名称、日期、分辨率和体积，而不是把 Studio 的窄属性面板几何生搬过来。

## 分项设计评估

| 维度 | 评分 | 评估 |
| --- | ---: | --- |
| 跨页面一致性 | 9.0 | 主链路不再在浅色网页、暗色编辑器和独立白弹窗之间跳变；表面与状态语义稳定。 |
| 信息层级 | 8.8 | Popup 的 GIF / 视频分组、Manager 的内容 / 批量操作、Studio 的预览 / 属性关系清晰。 |
| 操作可辨识性 | 9.1 | GIF 录制在视觉和无障碍树中均为完整按钮；Manager 的 Edit、Delete 和选择模式有明确反馈。 |
| 状态与反馈 | 8.7 | 蓝、紫、红三类语义收敛；加载、空态、错误、选择和确认都有独立呈现。 |
| 可访问性 | 8.6 | 关键弹窗具备 `alertdialog`、安全初始焦点、Tab 循环、Escape 和焦点恢复；按钮状态语义完整。 |
| 响应与密度 | 8.3 | Popup 密度好；Manager 网格可响应；Control 在实际弹窗尺寸合理，在最大化页面下会产生较多空白但不影响产品使用。 |
| 可维护性 | 7.7 | 已有主题契约和共享 class，但仍使用 scoped utility 兼容层，长期应迁移为中性 token 与原生组件变体。 |

## Recording Manager 专项结果

此前 Manager 是独立的浅色文件管理页面，和 Studio 之间存在明显产品断层。现在完成了以下闭环：

- 顶栏采用 Studio 同源的 56px 深色表面，并显示录制数量、排序规则和主入口。
- 内容区使用紧凑工具条与响应式卡片网格；卡片同时承载缩略图、时长、名称、日期、分辨率和体积。
- 信息按钮改为明确的可聚焦控件，详情使用暗色 tooltip，不再依赖含义不清的图标或 emoji。
- 选择任意录制后进入显式 selection mode，批量删除与清除选择只在当前任务需要时出现。
- 删除确认使用暗色 `alertdialog`；Cancel 获得安全初始焦点，Tab / Shift+Tab 被限制在弹窗内，Escape 关闭后焦点回到触发按钮。
- 最终删除未在浏览器验收中执行，避免破坏真实 OPFS 样本；删除调用路径由既有测试覆盖。

空库状态已实现 Start Recording 引导并通过静态检查与生产构建。本轮浏览器使用的持久化测试资料包含三条录制，因此不把空库状态列为真实界面已验证项。

## Computer Use 真实界面设计审查

本轮设计 skill 对实现产生了直接影响，而不只是用于截图确认：

1. 发现 Popup 原先仍是白色独立界面，因此将其纳入产品 token；复核后 GIF 入口保持高辨识紫色 CTA，并在无障碍树中暴露为 `Record GIF` 按钮。
2. 发现 Control 与 Studio / Manager 仍有明显亮暗跳变，因此统一输入、模式卡、倒计时、提示和状态色，同时保留它作为录制设置页的宽布局。
3. Manager 的选择态、元数据 tooltip 和删除弹窗逐项操作验证；修正了重复排序提示、卡片选择标签和确认弹窗焦点边界。
4. 复核未发现浅色孤岛、不可见主操作、颜色语义冲突或最终删除误触风险。

## 发布判断

当前版本满足以下发布条件：

- 用户从扩展图标进入 GIF 或视频录制，到 Manager 或 Studio，不会遇到主视觉语言切换。
- 通用操作使用蓝色，GIF 身份使用紫色，删除/停止使用红色；三者不会彼此争抢含义。
- Manager 的卡片、批量选择、信息查看与删除确认同时支持鼠标和键盘路径。
- Studio 与弹窗维持既有录制、OPFS、播放、编辑和导出业务逻辑。
- 生产扩展可构建，release logging policy 通过；测试与静态检查结果见最终交付记录。

因此，本轮建议 **可以发布**，不需要再以“统一风格”为由阻塞 GIF 垂直切片。

## 最终验证记录

- TDD：Recording Manager 主题契约与 selection mode 测试 2/2 通过。
- 全量回归：73 个测试文件、361 个测试全部通过。
- 静态检查：`svelte-check` 为 0 errors、20 warnings；warning 集中在 4 个既有视频编辑/导出组件，本轮 Manager、Popup 与 Control 未新增错误。
- 生产构建：`pnpm --filter extension build:extension` 通过；87 个 JavaScript bundle 通过 release logging policy 校验。
- 差异卫生：`git diff --check` 通过。
- 真实扩展复核：Popup、Control、Manager library / selection、元数据详情和 Delete alertdialog 均通过；确认了键盘循环、Escape 与焦点恢复。最终删除未执行。

## 后续设计治理建议

### P1：建立中性产品 token 层

`.studio-theme` 已实际服务 Popup、Control、Manager 和 Studio。下一轮应改名或抽取为 `.creator-theme` / `.product-theme`，将 shell、surface、border、text、accent、danger、focus 等变量作为产品级契约；Studio 只保留自己的几何布局。

### P1：逐步移除 utility 兼容映射

当前兼容层能低风险迁移行为复杂的旧组件，但 `!important` 和按 utility 名称覆写不适合作为长期组件 API。建议按使用频率依次迁移 Button、Segmented Control、Field、Card、Alert、Dialog，再删除对应映射。

### P2：隔离历史与诊断路由

为 `sidepanel`、`web-record` 和诊断页增加开发构建开关或明确的内部入口。若产品重新启用其中任一路由，先完成状态机归属、导航角色和设计验收，避免形成第二套录制入口。

### P2：补充视觉回归基线

为 Popup idle、Control idle、Manager library / selection、Studio GIF、Export GIF、Delete dialog 建立固定视口截图基线。空库状态使用隔离 profile 或可注入 fixture 验证，避免依赖和破坏真实 OPFS 数据。
