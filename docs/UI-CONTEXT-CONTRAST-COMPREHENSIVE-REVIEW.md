# UI 场景适配与对比度全面评审

> 初始评审日期：2026-08-24
> 评审方法：`frontend-design` v2.0、WCAG 2.2 AA、真实扩展渲染记录、源码与确定性颜色测量
> 初始结论：**Needs Work / 当时不应按 UI 可发布状态验收**

## 2026-08-25 实施更新

本轮已完成主要 UI 阻断项的实现，当前状态提升为 **Release Candidate / 需完成浏览器加载与人工无障碍门禁后发布**。这不是对下方初始审计的覆盖；初始问题清单保留，方便追踪设计决策和剩余债务。

### 已落地

- 新增 `browser / workspace / marketing` surface contract。Popup、Control、Recording Manager 改为默认浅色、随系统切换暗色；Studio 保持固定暗色。
- 建立语义颜色和确定性对比度测试。主文字、辅助文字、蓝/紫/红实底 CTA 均达到普通文本 4.5:1；交互边界达到非文本 3:1。
- 新增开发专用 `/lab/ui-system`，覆盖三种 surface、按钮状态、空态/错误态、长文案、窄屏、reduced-motion、Popup/Manager/Studio 代表性 fixture；测试页未进入扩展 manifest 入口。
- `GIF 录制` 保持真实按钮语义和独立紫色主路径；Popup 的键盘焦点顺序与可见焦点已验证。
- Recording Manager 完成自适应主题、可访问名称、死代码清理，并以 `IntersectionObserver` 延迟 OPFS 读取和缩略图解码。
- Studio Focus 点改为真实按钮，支持方向键 1% 微调、Shift+方向键 5% 微调，并增加 X/Y 数值输入作为非拖拽路径。
- Welcome 的低对比、小字号信息已提高到可读基线；全局 i18n loading shell 改为自适应，避免固定浅色闪屏。
- utility 兼容层的 `!important` 从初始 49 处降到 18 处；剩余集中在导出兼容层，未把本轮扩大为高风险的完整重写。

### 验证证据

| 项目 | 当前结果 |
| --- | --- |
| 单元/组件测试 | 76 个文件、392 个测试通过 |
| `svelte-check` | 0 errors；18 个既有响应式初始化 warning |
| 扩展构建 | 通过；97 个 bundle 的发布日志策略通过 |
| UI Lab 桌面与 375px | 无横向溢出；三种主题、长文案、focus 与状态 fixture 通过 |
| Popup 本地渲染 | `GIF 录制` 为命名按钮；焦点顺序、focus ring、蓝/紫 CTA 通过 |
| Manager / Studio 本地渲染 | 空态、主题和横纵向溢出检查通过 |
| 真实 Edge 新构建 | 通过：Popup 无障碍树确认 `Record GIF` 为命名按钮；Drive 实际加载 3 条 OPFS 录制及缩略图；Studio 实际加载录制，播放从 00:00.00 前进到 00:02.09 / Frame 62 |
| 200% 文本、forced-colors、屏幕阅读器 | 尚未形成可靠实机证据，仍是发布前人工门禁 |

### 问题关闭情况

| 问题 | 状态 | 说明 |
| --- | --- | --- |
| UI-001 / 002 / 003 | 已关闭 | 场景主题、文本/CTA/交互边界对比度已建立 contract 并修复 |
| UI-004 | 部分关闭 | 已转向语义 surface；导出兼容层仍保留 18 处 `!important` |
| UI-005 | 已关闭 | Focus 支持键盘和 X/Y 数值输入 |
| UI-006 | 部分关闭 | 对比度和字号已修复；Welcome 内容精简仍可继续 |
| UI-007 / 008 / 009 / 012 | 已关闭 | 自适应主题、可见区解码、loading shell、Manager 语义/死代码已处理 |
| UI-010 | 部分关闭 | 375px 和长文案已验证；200% / forced-colors / screen reader 待实机 |
| UI-011 | 未关闭 | 历史与诊断路由仍需单独收口 |

### 当前发布判断

代码和自动化构建已达到候选发布状态，最初的视觉/对比度硬阻断已经关闭，真实 Edge 也已验证 Popup、Recording Manager、Studio 与 Studio 动态播放。正式标记“UI 可发布”前仍需要：跑一次真实 Popup → GIF 区域录制 → Studio → GIF 导出完整业务链路，并完成 200% 文本、forced-colors 与屏幕阅读器抽查。

## 初始评审结论（保留）

当前产品的功能主链路已经建立，但上一轮“把所有主页面统一成 Studio 暗色”的方向过度追求表面一致，忽略了界面所在的宿主场景：

- Popup 和 Control 是浏览器附着界面，用户刚从浅色 Chrome 工具栏进入，纯黑面板产生明显割裂。
- Studio 是独立创作工作台，沉浸式暗色合理。
- Recording Manager 是全页内容库，可以使用自适应主题或浅色默认，不需要通过纯黑证明它属于同一产品。
- Welcome 是安装和教育页面，浅色营销/服务模式合理。

新的视觉命题应为：

> **浏览器附着面轻量、原生、可随系统明暗适配；创作工作台沉浸、深色、克制；品牌一致性由蓝色视频、紫色 GIF、红色危险操作以及共同的组件行为维持，而不是由全局黑色维持。**

按新安装 skill 的加权框架，当前约为 **57 / 100**；更重要的是，场景适配和 WCAG 2.2 AA 两个硬门槛均未通过，因此加权总分不能把它提升为可发布。

## UI skill 选择与安装

### 最终选择

已安装 [`PracticalSwan/agent-skills@frontend-design`](https://github.com/PracticalSwan/agent-skills/tree/main/frontend-design)，本地路径为：

`/Users/wxnet/.agents/skills/frontend-design`

Skills CLI 已确认它注册给 Codex。安装时的安全评估为 Gen Safe、Socket 0 alerts、Snyk Low Risk。

选择它的原因：

1. 把“用户、任务和产品场景适配”列为第一权重，明确反对把暗色、卡片或流行视觉作为通用答案。
2. 把 WCAG 2.2 AA、真实渲染、键盘、响应式与完整状态设为硬门槛。
3. 自带标准库实现的对比度计算工具，可将视觉判断落到确定性数据。
4. 明确支持 Codex，并要求诚实记录未验证项。

### 候选比较

| Skill | 优点 | 未选择为首选的原因 |
| --- | --- | --- |
| [PracticalSwan frontend-design](https://github.com/PracticalSwan/agent-skills/tree/main/frontend-design) | 场景适配、WCAG 2.2 AA、状态、响应式、性能和真实渲染一体化 | 最符合本工程当前问题 |
| [Microsoft frontend-design-review](https://github.com/microsoft/skills/tree/main/.github/skills/frontend-design-review) | 来源权威；设计系统、质量支柱和创意方向完整 | 将 WCAG 2.1 A 作为最低、AA 作为理想，低于本轮需要的硬门槛 |
| [mastepanoski ui-design-review](https://github.com/mastepanoski/claude-skills) | 视觉精致度与品牌一致性检查细致 | 自身建议再搭配独立 WCAG skill，不适合只安装一个的约束 |

安装量只作为生态成熟度信号，不代替任务适配、规范版本、验证工具和 Codex 兼容性判断。

## 评审范围与证据等级

| 界面 | 证据 | 状态 |
| --- | --- | --- |
| Popup idle | 同构建真实 Edge 截图、无障碍树、源码、颜色测量 | 完整评审 |
| Control idle | 同构建真实 Edge 截图、无障碍树、源码、颜色测量 | 完整评审 |
| Recording Manager library / selection / delete | 真实 Edge 截图和键盘记录、源码、颜色测量 | 完整评审；最终删除未执行 |
| Studio 编辑态、GIF 导出、Drive / Delete dialogs | 前一轮真实 Edge 操作记录、源码、静态检查、颜色测量 | 完整评审 |
| Welcome | 源码、历史渲染记录；本轮 Edge 原生媒体菜单阻断完整无障碍树 | 部分渲染证据 |
| Countdown | 源码与历史渲染记录 | 静态与历史证据 |
| 空库、200% 文本、强制色、屏幕阅读器 | 当前没有可靠独立 fixture | 未验证，不声明通过 |

本轮重新启动 Edge 后，ScreenCaptureKit 只返回窗口标题，未返回截图和完整树。因此报告复用同一构建在上一轮刚生成的真实扩展渲染记录，并用源码与确定性测量交叉验证；没有把工具异常包装成新的实机通过。

## 设计模式与页面判断

| 页面 | 正确模式 | 当前判断 | 发布状态 |
| --- | --- | --- | --- |
| Popup | 浏览器附着型 product surface | 信息层级基本清楚，但强制暗色与浅色 Chrome 割裂 | 阻断 |
| Control | 浏览器弹窗型 product surface | 设置结构清楚，但同样强制暗色，最大化时横向铺满且空白过大 | 阻断 |
| Recording Manager | 内容库 / workspace | 网格和批量模式改善明显；文字、按钮和边界对比度失败 | 阻断 |
| Studio | 沉浸式 workspace | 暗色方向正确；低对比辅助文字、表单边界与指针专用交互仍失败 | 阻断 |
| Export / Drive / Delete dialogs | 宿主工作台上的 modal task | 结构与焦点管理较好；utility 兼容层造成状态对比度不可控 | 阻断 |
| Welcome | onboarding / service | 浅色方向正确；卡片过多、9px 文案和 emoji 使界面显得模板化 | 需改进 |
| Countdown | immersive transient state | 状态单一、层级明确、深色合理 | 可保留 |

## 对比度测量

测量使用已安装 skill 自带的 `contrast-checker.py`。WCAG 2.2 AA 要求普通文本至少 4.5:1；用于识别控件和状态的非文本视觉信息至少 3:1。[W3C 文本对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)、[W3C 非文本对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)。

### 文本

| 组合 | 实测 | 要求 | 结果 | 典型位置 |
| --- | ---: | ---: | --- | --- |
| `#71717a` / `#09090b` | 4.12:1 | 4.5:1 | Fail | Popup 分区标题、Studio 辅助文字 |
| `#71717a` / `#18181b` | 3.67:1 | 4.5:1 | Fail | Manager 元数据、弹窗关闭按钮 |
| `#52525b` / `#18181b` | 2.29:1 | 4.5:1 | Fail | Studio 版本、说明、空态特性 |
| `#52525b` / `#09090b` | 2.57:1 | 4.5:1 | Fail | 工作区低层级说明 |
| `#a1a1aa` / `#18181b` | 6.91:1 | 4.5:1 | Pass | 合理的暗色辅助文字基线 |
| white / blue-500 `#3b82f6` | 3.68:1 | 4.5:1 | Fail | Manager Edit / Start、部分 Studio 小按钮 |
| white / blue-600 `#2563eb` | 5.17:1 | 4.5:1 | Pass | 推荐的蓝色实底按钮 |
| white / violet-500 `#8b5cf6` | 4.23:1 | 4.5:1 | Fail | 小字号 GIF 实底状态 |
| white / violet-600 `#7c3aed` | 5.70:1 | 4.5:1 | Pass | 推荐的 GIF 实底按钮 |
| white / red-500 `#ef4444` | 3.76:1 | 4.5:1 | Fail | 小字号停止/危险按钮 |
| white / red-600 `#dc2626` | 4.83:1 | 4.5:1 | Pass | 推荐的危险实底按钮 |
| slate-400 `#94a3b8` / white | 2.56:1 | 4.5:1 | Fail | Welcome 9–10px 细节文案 |
| slate-500 `#64748b` / white | 4.76:1 | 4.5:1 | Pass | 合理的浅色辅助文字基线 |

### 控件边界

| 组合 | 实测 | 要求 | 结果 |
| --- | ---: | ---: | --- |
| zinc-700 `#3f3f46` / panel `#18181b` | 1.70:1 | 3:1 | Fail |
| `white/10` 在 panel 上的近似有效色 `#303033` / `#18181b` | 1.35:1 | 3:1 | Fail |
| field `#09090b` / panel `#18181b` | 1.12:1 | 3:1 | Fail |
| blue-400 `#60a5fa` / panel `#18181b` | 6.97:1 | 3:1 | Pass |

低对比分隔线如果只是装饰，不一定必须达到 3:1；但当前输入框、选择器、按钮和状态边界依赖这些线条来证明控件存在，因此不能统一按“装饰”豁免。

## 严重度排序的问题

### Blocker — UI-001：Popup / Control 错用 Studio 强制暗色

`popup/+page.svelte`、`control/+page.svelte` 都挂载 `.studio-theme`；`app.css` 又直接声明 `color-scheme: dark` 和 `#09090b`。当前没有 `prefers-color-scheme`、用户主题设置或宿主场景 token。

Chrome 官方将 Action popup 定义为用户点击浏览器工具栏后出现、用于调用多个扩展能力的小窗口；这类界面应 purposeful and minimal，而不是独立工作台。[Chrome 扩展 UI 组件](https://developer.chrome.com/docs/extensions/develop/ui)、[Action popup](https://developer.chrome.com/docs/extensions/reference/api/action)。

建议：

- Popup 默认采用浅色中性表面，跟随系统暗色时再切换暗色。
- Control 使用同一 browser-surface token，但保留更宽的设置布局。
- 不再让两者继承 `.studio-theme`；共享语义 token，不共享工作台壳。

### Blocker — UI-002：普通文字存在系统性 WCAG AA 失败

静态检索在发布主链路中发现 42 处 `text-zinc-500`、`text-zinc-600` 或被映射成 `#71717a` 的 `text-gray-400` 使用。不是每一处都落在相同背景，但已经确认多个真实组合低于 4.5:1。

建议：

- 暗色信息文字最低使用 `#a1a1aa`；`#71717a` 只用于非文本装饰或满足 3:1 的大图形。
- 浅色信息文字最低使用 slate-500 `#64748b`。
- 移除承载信息的 9px / 10px 字号；浏览器附着面正文不低于 12px，优先 13px。

### Blocker — UI-003：主按钮和控件边界未通过 AA

白字落在 blue-500、violet-500、red-500 上时，普通小字号均未达到 4.5:1。大量 `white/5–10` 边界和 `#09090b` 输入底色也不足以在 `#18181b` 面板上识别控件。

建议：

- 实底 CTA 使用 blue-600、violet-600、red-600 或更深。
- 对需要边界才能识别的表单控件，默认边界至少使用在相邻表面上达到 3:1 的 token。
- 装饰 divider 和 interactive border 分成两个 token，不能继续共用 `white/10`。

### Major — UI-004：主题架构依赖 utility 覆盖，无法证明完整状态

`app.css` 有 49 个 `!important`，把 `.bg-white`、`.text-gray-*`、`.border-gray-*` 在 Popup、Control 和 Export 中强行翻译为暗色；发布主链路仍出现 34 个不同的六位十六进制颜色。

这会导致：

- 相同 utility 在不同语义下被映射为同一颜色；
- hover、selected、disabled、loading 和错误态需要逐个打补丁；
- 组件源码看起来是浅色，运行时却是暗色，评审和维护难以建立可靠心智模型。

建议建立产品级语义 token：`canvas`、`surface`、`surface-raised`、`text`、`text-muted`、`control-border`、`divider`、`focus`、`accent-video`、`accent-gif`、`danger`，再让 browser / workspace / marketing 三种 surface context 提供值。

### Major — UI-005：Studio Focus 编辑是指针专用交互

`VideoFocusPanel.svelte` 的 stage 和 focus dot 使用 `pointerdown/move/up`，没有角色、键盘操作或等价的 X/Y 输入。`svelte-check` 也明确报告两条静态元素交互警告。

这不符合新 skill 的键盘硬门槛，也涉及 WCAG 对 drag alternative 和键盘可操作性的要求。建议把 focus dot 变成可聚焦控件，支持方向键微调、Shift 加速，并提供数值输入或“居中/四角”预设作为非拖拽路径。

### Major — UI-006：Welcome 正确使用浅色，但视觉与内容层级过载

Welcome 同时使用安装成功胶囊、PRO Trial 胶囊、四张功能卡、三张录制模式卡、信任条、四步 Journey 卡和多个 emoji。它具备信息，但首屏出现过多视觉容器，削弱“开始第一次录制”这一唯一任务。

另有 9px slate-400 文案，实测仅 2.56:1。建议保留一段价值说明、一个录制选择器和三条可信承诺；把 Journey 下移，移除 UI 内 emoji，最小信息文字改为 slate-500 / 12px。

### Major — UI-007：没有真正的明暗自适应策略

当前只声明 `color-scheme: dark`。Web 平台支持通过 `prefers-color-scheme` 配置成对 token；`light-dark()` 更简洁，但 Chrome 123 才完整可用，而 manifest 当前最低 Chrome 版本是 116。[web.dev `light-dark()`](https://web.dev/articles/light-dark)。

建议：

- 保持最低 Chrome 116 时使用 CSS variables + `@media (prefers-color-scheme: dark)`。
- 只有在最低版本提升到 123 后才依赖 `light-dark()`。
- Studio 可固定 dark；Popup、Control、Manager 使用 light/dark 成对 token。

### Major — UI-008：Manager 首次加载的缩略图策略存在规模风险

每个 `RecordingCard` mount 后都会读取 OPFS 并在缺少缓存时创建 VideoDecoder 生成首帧。当前三条录制正常，但几十条录制会并发读取和解码；网格没有窗口化、分页或可见区调度。

建议在 UI lab 中加入 100 条 fixture，验证首次进入的交互延迟与滚动；实现并发队列和 IntersectionObserver 延迟生成，不把三条数据的顺畅外推为规模性能通过。

### Moderate — UI-009：初始加载态会在暗色页面前闪现浅色

全局 `+layout.svelte` 的 i18n loading 固定为 `bg-gray-50 / text-gray-400`。Studio、Manager 或暗色弹窗首次加载时会短暂出现浅色闪屏，且文字本身对比度偏低。

建议 loading shell 根据目标路由 surface context 使用同一 token，或把 i18n 初始化前移，避免跨主题闪烁。

### Moderate — UI-010：窄宽、200% 文本和强制色没有发布证据

Popup 固定 360px，Studio 固定 `h-screen` 与工具栏几何；当前没有 200% 文本、长中文/英文、窄视口、forced-colors 或 screen reader 的稳定 fixture。不能以“没有看见溢出”推断通过。

### Moderate — UI-011：历史与诊断路由仍存在第二套视觉语言

`sidepanel`、`web-record`、根提示页及诊断页面仍保留旧浅色实现，根提示页还要求用户使用已经退出当前 manifest 主入口的 sidepanel。

建议用开发构建开关隔离诊断路由，并让根页面重定向到当前入口或给出准确导航。否则它们迟早会被误认为发布页面。

### Minor — UI-012：Manager 组件仍有语义与死代码债务

- Info 按钮的可访问名称只有录制名称，没有“查看详情”动作。
- Checkbox 名称只有录制名称，没有“选择录制”动作。
- `showPreview/openPreview` modal 代码存在，但当前缩略图和 Edit 都直接进入 Studio，预览路径不可达。

建议明确可访问名称并删除不可达预览实现，避免下一轮错误修复不存在的流程。

## 推荐的主题架构

### Browser surface：Popup / Control / Manager

- 默认浅色：白色或 slate-50 canvas、白色 surface、slate-900 主文字、slate-600/500 辅助文字。
- 系统暗色：zinc-950 canvas、zinc-900 surface、zinc-100 主文字、zinc-400 辅助文字。
- 视频实底 blue-600、GIF 实底 violet-600、危险实底 red-600。
- 浏览器附着面的圆角和阴影更克制，避免做成悬浮在 Chrome 上的“黑色应用截图”。

### Workspace surface：Studio

- 保留 zinc-950 / zinc-900 沉浸层级。
- 信息文字不低于 zinc-400。
- 控件边界与装饰 divider 分离；interactive border 必须达到 3:1。
- 蓝、紫、红全部从 600 档作为白字实底起点。

### Marketing surface：Welcome

- 保留浅色。
- 合并卡片，突出一次任务和一条主 CTA。
- 正文最低 slate-500，辅助信息最低 12px。

## 必要的 UI 测试页面

建议新增仅开发构建可访问的 UI System Lab。这不是另一个产品页面，而是可重复的视觉与无障碍 fixture：

- browser light / browser dark / workspace dark 三种 surface context；
- Button、Field、Segmented、Card、Alert、Dialog 的 default / hover / focus / active / disabled / busy；
- Popup idle / selecting / recording / error；
- Manager loading / empty / 3 items / 100 items / selection / delete；
- Studio empty / GIF / video / export progress / export error；
- 中文长文案、英文长词、200% text、375 / 768 / 1440 宽度；
- `prefers-reduced-motion` 和 forced-colors 检查入口；
- 对每个语义 token 运行对比度断言，并建立固定视口截图基线。

## 建议实施顺序

1. **TDD 建立 surface-context 与 contrast contract**：先让当前失败组合成为测试。
2. **Popup / Control 改为 light-first adaptive browser surface**：优先解决用户每天第一次看到的割裂。
3. **统一 CTA、信息文字和 interactive border token**：关闭全产品 AA 阻断项。
4. **重构 Export 与录制入口的 utility 覆盖**：逐步移除 `!important` 兼容层。
5. **修复 Studio Focus 键盘/非拖拽路径**。
6. **建立 UI System Lab 并补齐 200%、长文案、100 条 Manager 和强制色验证**。
7. **完成真实 Chrome / Edge 浏览器回归后再恢复“可发布”标记**。

## 硬门槛状态

| 硬门槛 | 状态 | 说明 |
| --- | --- | --- |
| 用户与任务场景适配 | Fail | Popup / Control 错用 Studio 强制暗色 |
| WCAG 2.2 AA | Fail | 普通文本、CTA、控件边界有确定性失败 |
| 功能正确性 | Pass | 现有测试和录制主链路此前已通过 |
| 完整状态 | Partial | loading / error / dialog 较完整；空库和规模 fixture 不完整 |
| 响应式与 200% 文本 | Unverified | 缺少稳定证据 |
| 真实渲染 | Partial | 主页面已有同构建记录；本轮重启后截图服务异常 |
| 性能 | Unverified | 没有 Manager 规模和 Web Vitals 测量 |

最终判断：先完成前三个实施阶段，再进行发布级浏览器验证；当前不应以“风格已统一”作为 UI 完成标准。
