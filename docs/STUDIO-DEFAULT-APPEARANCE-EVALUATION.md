# Studio 默认视觉效果评估报告

> 评估目标：围绕 `packages/extension/src/routes/studio/+page.svelte` 及其直接依赖，分析“录制结束进入 Studio 后，看到的是白色原片、没有默认视觉处理”的现状、成因、影响与改进方向。
>
> 评估范围：仅做静态代码审查与构建基线核对，不修改业务代码。
>
> 评估时间：2026-03-08

## 1. 结论摘要

当前 Studio **并不是完全没有走样式合成链路**，而是“**已经走了合成链路，但默认配置几乎等同于无样式**”，最终在用户感知上表现为“白色原片”。

核心结论有四点：

1. **Studio 首屏预览一定会经过合成 Worker**，不是直接把原始视频裸播出来。  
   证据：`VideoPreviewComposite` 在处理首批 `encodedChunks` 时，会把 `backgroundConfig` 一并发送给 composite worker 进行 `process`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoPreviewComposite.svelte:795-923`）。

2. **默认背景配置定义存在错位**：默认 `type` 是 `wallpaper`，但默认配置里并没有 `wallpaper` 实体。  
   证据：`defaultBackgroundConfig` 定义为 `type: 'wallpaper'`，同时只有 `color/padding/outputRatio/videoPosition/borderRadius/customWidth/customHeight`，没有 `wallpaper` 字段（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/stores/background-config.svelte.ts:13-22`）。

3. **合成 Worker 会把“wallpaper 类型但没有 wallpaper 数据”的情况降级为纯白色背景**。  
   证据：`renderBackground()` 只有在 `config.type === 'wallpaper' && config.wallpaper` 时才渲染壁纸，否则走 fallback：`ctx.fillStyle = config.color`，默认色正是 `#ffffff`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/composite-worker/index.ts:271-295`）。

4. **默认视觉强化项为“关闭”状态**：`borderRadius = 0`、`shadow` 未定义，因此即便有 padding，也不会形成明显的卡片化、产品化观感。  
   证据：默认配置中圆角为 0 且未提供阴影（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/stores/background-config.svelte.ts:13-22`）；Worker 渲染逻辑只有在 `config.shadow` 存在时才画阴影、只有 `borderRadius > 0` 时才裁圆角（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/composite-worker/index.ts:810-838`）。

因此，当前问题的本质不是“Studio 不支持默认应用配置”，而是：

- **默认配置对象本身没有被设计成一个有辨识度的默认视觉预设**；
- **Studio 首屏没有显式的“进入即套用默认预设”语义层**；
- **默认 tab、默认 store、默认资源三者之间存在语义不一致**，用户进入后看到的是“白色背景 + 无圆角 + 无阴影”的近似原片效果。

---

## 2. 本次评估的核对基线

### 2.1 工程与命令基线

已按仓库现有命令进行只读核对：

- `corepack pnpm install`：成功
- `corepack pnpm --filter extension check`：失败，但存在**既有非本任务问题**
- 展开执行 `packages/extension` 的现有构建链路（`vite build` + 各个 `scripts/*.mjs`）：成功

说明：仓库根脚本与 `packages/extension/package.json` 中的部分 script 会再次调用裸 `pnpm`，而当前沙箱环境中 `pnpm` 未加入 PATH，因此我采用了**与脚本等价的展开命令**做验证；这属于环境调用方式差异，不属于本任务代码问题。

### 2.2 与本任务无关的现有 check 问题

`corepack pnpm --filter extension check` 输出显示存在既有错误：

1. `packages/extension/src/routes/opfs-drive/+page.svelte:221`  
   `Argument of type '() => Promise<() => void>' is not assignable to parameter of type '() => (() => any) | Promise<never>'`
2. `packages/extension/src/routes/sidepanel/+page.svelte:982`  
   `Property 'convertToMainSystemFormat' does not exist on type 'ElementRecordingIntegration'`

来源：`/tmp/copilot-tool-output-1772989185596-fcjo4g.txt:438-447`

本次任务仅输出文档，不处理这些既有问题。

---

## 3. Studio 当前实现全景

## 3.1 页面职责：Studio 负责“加载录制 + 驱动预览 + 暴露编辑控件”

`+page.svelte` 的职责主要分为五层：

1. **录制解析与路由入口**  
   根据 URL `id` 或最近一条可用录制，决定当前打开哪条 OPFS 录制（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte:492-562`）。

2. **OPFS Reader Worker 调度**  
   通过 `loadRecordingById()` 打开 OPFS reader worker，读取 `summary / keyframeInfo / 首屏 range`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte:307-422`）。

3. **窗口化预览调度**  
   利用 `computeFrameWindow()`、`handleWindowRequest()`、`fetchWindowData()`、`fetchSingleFrameGOP()` 驱动窗口切换、拖动预览、连续播放和预取（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte:97-274,564-700`）。

4. **预览区渲染**  
   首屏主预览由 `VideoPreviewComposite` 承担，传入编码块、时长、窗口范围、总帧数与窗口切换回调（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte:798-821`）。

5. **编辑区与导出区挂载**  
   右侧直接挂载 `BackgroundPicker / BorderRadiusControl / PaddingControl / ShadowControl / VideoExportPanel`，说明当前 Studio 已具备背景、圆角、边距、阴影、导出的完整 UI 能力（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte:828-885`）。

结论：**Studio 已经有“应用默认配置”的承载位置，不需要先重做界面结构。**

## 3.2 预览链路：不是原片直出，而是“编码块 → 合成 Worker → Canvas”

### 首次处理流程

1. `loadRecordingById()` 收到 reader worker 的 `range` 后，把首批 chunks 放进 `workerEncodedChunks`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte:372-407`）。
2. `VideoPreviewComposite` 监听 `encodedChunks`，在 `isRecordingComplete && encodedChunks.length > 0 && compositeWorker` 时触发 `processVideo()`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoPreviewComposite.svelte:1328-1419`）。
3. `processVideo()` 会把当前 `backgroundConfig`、视频裁剪、Zoom 配置一起转成普通对象，通过 `postMessage({ type: 'process' })` 送进 composite worker（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoPreviewComposite.svelte:795-923`）。
4. composite worker 内部先画背景，再画阴影，再裁圆角，再绘制视频帧（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/composite-worker/index.ts:790-845`）。

这意味着：

- Studio 架构层面已经支持“录制完成后默认应用样式”；
- 目前用户看不到样式，不是因为链路缺失，而是因为**进入链路的默认配置不对**。

## 3.3 导出链路与预览链路共用同一套背景配置

`VideoExportPanel` 同样从 `backgroundConfigStore.config` 读取配置，再通过 `convertBackgroundConfigForExport()` 进入导出流程（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoExportPanel.svelte:81-82,170-207`）。

这件事非常重要：

- 一旦未来给 Studio 首屏增加“默认应用视觉预设”，**预览和导出天然会保持一致**；
- 不需要分别改两套配置源；
- 但也意味着默认预设如果设计不当，会同时影响导出结果，需要谨慎定义“默认何时注入、何时允许用户覆盖”。

---

## 4. “白色原片”问题的证据链

## 4.1 默认 store 从页面初始化开始就是全局单例

`backgroundConfigStore` 是模块级单例：

- `createBackgroundConfigStore()` 内部用 `$state` 保存 `config`
- 文件尾部直接 `export const backgroundConfigStore = createBackgroundConfigStore()`

来源：`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/stores/background-config.svelte.ts:697-918`

影响：

- Studio 打开时不会按录制内容动态生成默认样式；
- 首屏看到什么，完全取决于 store 的默认值或此前会话中用户手工改过什么；
- 当前并不存在“录制完成后，为该条 recording 初始化默认 Studio preset”的独立层。

## 4.2 默认配置与“想让用户进入就看到成品感”这一目标相矛盾

当前默认配置如下：

- `type: 'wallpaper'`
- `color: '#ffffff'`
- `padding: 60`
- `outputRatio: '16:9'`
- `videoPosition: 'center'`
- `borderRadius: 0`
- `customWidth: 1920`
- `customHeight: 1080`

来源：`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/stores/background-config.svelte.ts:13-22`

这里至少有三个直接问题：

### 问题 A：`wallpaper` 类型与实际数据脱节

当前默认对象没有 `wallpaper` 字段，也没有预先调用 `handleWallpaperSelection()` 或 `applyWallpaperBackground()`。  
而 `renderBackground()` 只有在 `config.wallpaper` 存在时才真正绘制壁纸（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/composite-worker/index.ts:287-289`）。

结果：默认值在语义上说“我是壁纸模式”，在渲染上却只能退回纯色。

### 问题 B：默认颜色就是纯白

当 `wallpaper` 无法成立时，fallback 是 `config.color`，默认正好是 `#ffffff`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/composite-worker/index.ts:290-293`；`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/stores/background-config.svelte.ts:15`）。

结果：用户首屏感知不是“已设计过的卡片式视频”，而是“白底包了一层视频”。对很多录屏内容来说，这种效果几乎等同于没有处理。

### 问题 C：圆角与阴影默认关闭

- `borderRadius: 0`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/stores/background-config.svelte.ts:19`）
- `shadow` 默认不存在（同文件 13-22 行）

而 worker 只有在 `borderRadius > 0` / `config.shadow` 存在时才会真正做卡片化处理（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/composite-worker/index.ts:810-838`）。

结果：当前默认效果缺少用户最容易感知的三个“成品化”信号：

- 非白板背景
- 视频圆角
- 视频投影

这正好与题述希望默认应用的“背景图、圆角、阴影等”完全对齐。

## 4.3 UI 入口默认强调“Wallpaper”，但实际首屏未必真有壁纸

`BackgroundPicker/index.svelte` 中：

- `activeTab` 初始值是 `'wallpaper'`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/BackgroundPicker/index.svelte:21`）
- tab 顺序也把 Wallpaper 放在第一个（同文件 24-29 行）
- 但真正的配置是否有壁纸资源，要看 `backgroundConfigStore.config.wallpaper`

这会形成一个 UX 落差：

- **用户看到的是“壁纸模式入口被高亮”**；
- **实际画面却只是白色 fallback**。

这会进一步放大“Studio 没有帮我做好默认效果”的感知。

## 4.4 壁纸资源体系本身是完整的，但默认流程没有接上

仓库内已经存在完整的内置壁纸体系：

- `WALLPAPER_PRESETS` 提供多类内置壁纸资源（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/data/wallpaper-presets.ts:5-278`）
- `WallpaperPanel` 通过 `backgroundConfigStore.handleWallpaperSelection(wallpaper)` 选择壁纸（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/BackgroundPicker/WallpaperPanel.svelte:48-59`）
- `ImageBackgroundManager.processPresetImage()` 会 `fetch(preset.imageUrl)`、`createImageBitmap(blob)` 并缓存起来（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/image-background-manager.ts:81-124`）

也就是说：

- 资源不是没有；
- 渲染能力不是没有；
- 缺的是**Studio 首次进入时自动把某个默认 preset materialize 成真实的 wallpaper/image config**。

---

## 5. 用户体验与留存影响评估

## 5.1 录制完成后的“第一眼价值”没有被兑现

Control → Studio 是当前产品最关键的转化节点之一。用户录完后自动进入 Studio，本应立刻看到：

- 更高级的成品感
- “哇，这已经能直接发了”的心理反馈
- 继续微调而不是从零开始打扮的状态

但当前首屏给人的感受更像：

- 视频是录到了；
- Studio 也打开了；
- 但结果仍像“未加工原片”。

这会直接导致两个认知问题：

1. **用户低估 Studio 能力**：以为它只是“播放器 + 导出按钮”；
2. **用户高估操作成本**：以为要自己从头设置背景、圆角、阴影，才可能产出好看的视频。

对降低卸载率而言，这类“第一眼价值未被看见”的问题通常非常致命。

## 5.2 当前体验增加了不必要的学习成本

虽然右侧已经有完整编辑控件（`BackgroundPicker / BorderRadiusControl / PaddingControl / ShadowControl`），但当前流程要求用户：

1. 先自己发现这些控件；
2. 再自己理解每个控件的作用；
3. 再自己试出一个“还不错”的结果。

这本质上把“模板化默认值”应该承担的认知负担，转嫁给了用户。

## 5.3 当前视觉默认值不符合“新手友好”原则

新手友好的默认值通常应满足：

- 不需要解释就能看出变好了；
- 与大多数视频内容兼容；
- 就算用户什么都不调，也能拿到像样结果；
- 允许在此基础上继续微调。

而当前默认值：

- 白色背景太中性，视觉提升弱；
- 没有圆角、没有阴影，卡片感不足；
- `wallpaper` 类型又没有真实壁纸实体，增加了语义混乱。

因此它更像“开发态默认值”，而不是“面向留存的产品默认值”。

---

## 6. 当前架构下的改造可行性评估

## 6.1 可行性：高

从代码结构看，Studio 默认应用预设是一个**中低风险、收益很高**的改造点，原因如下：

1. **配置源单一**：预览和导出都用 `backgroundConfigStore`。
2. **渲染链路现成**：composite worker 已支持背景、圆角、阴影。
3. **内置资源现成**：已有壁纸 presets 和图片处理服务。
4. **UI 控件现成**：用户进入后可以继续微调，不需要新增基础操作面板。

## 6.2 难点：不是“能不能做”，而是“默认值策略怎么定义”

真正的设计难点主要有四个：

### 难点 1：默认预设应该是“纯默认”还是“可记忆的用户偏好”

当前 store 没有持久化到 `chrome.storage` 或其他偏好存储（代码搜索未发现 Studio 背景配置的持久化逻辑）。

这意味着可以有两种产品策略：

- **策略 A：固定默认预设**  
  每次进入 Studio 都先给统一默认样式。
- **策略 B：上次使用的 Studio 样式优先**  
  有用户偏好时优先恢复用户最近一次样式，没有时才回退到产品默认预设。

如果不先定义这件事，后续实现很容易在“默认值”和“记忆值”之间摇摆。

### 难点 2：默认应用应发生在什么时机

从链路上看，至少有三个候选时机：

1. store 初始化时
2. Studio 页面 onMount 时
3. 录制加载成功后（拿到 recording summary 后）

其中：

- 放在 store 初始化最简单，但表达不出“这是 Studio 首次进入预设”；
- 放在 Studio onMount 更符合产品语义；
- 放在“录制 ready 后”则可以为后续“按录制方向/比例/内容特征套不同预设”留下扩展点。

### 难点 3：是否需要“只在首次进入时应用一次”

若未来支持：

- 用户从 Drive 切换录制
- Studio 内反复打开不同 recording
- 手工修改过样式后继续切换录制

那么需要明确：

- 默认预设是每切一次 recording 都重置？
- 还是一个 Studio 会话只自动应用一次？
- 还是每条 recording 首次打开自动应用一次，但不覆盖用户已修改的配置？

这是文档方案里必须明确的状态机问题。

### 难点 4：壁纸默认方案会引入异步资源加载

如果产品坚持默认首屏就展示背景图（而不是渐变/纯色），则首屏默认预设会依赖：

- `WALLPAPER_PRESETS`
- `processPresetImage()` 的 fetch + createImageBitmap
- transfer 到 composite worker

这会带来两个现实问题：

1. 首屏首次渲染是同步白底，还是等待异步壁纸准备好后再刷新？
2. 如果默认壁纸加载失败，fallback 是纯色还是渐变？

这决定了实现方案需要带一个**可降级的同步默认值**。

---

## 7. 建议方向（评估结论）

基于当前代码结构，我建议把问题拆成两层：

## 7.1 第一层：先定义“默认 Studio 外观预设”

这个预设不应再只是一个技术性的 `defaultBackgroundConfig`，而应是一个**明确面向首屏体验的产品预设**，至少包含：

- 一个可立即生效的背景（建议同步可用，避免异步空档）
- 非零圆角
- 默认阴影
- 合理 padding
- 与导出一致的输出比例

## 7.2 第二层：再定义“首次进入 Studio 时如何注入该预设”

我更推荐把“Studio 默认预设”作为**独立语义层**，而不是继续把所有责任都压在 `defaultBackgroundConfig` 这个 store 默认值上。原因是：

- store 默认值更适合“没有任何上下文时的安全初值”；
- Studio 首屏默认视觉更像“页面进入策略”；
- 后续若加入“用户偏好 / 新手引导 / 按内容推荐模板”，独立语义层更容易扩展。

## 7.3 产品优先级建议

建议优先级如下：

### P0：让首屏立即摆脱“白色原片”观感

最低目标：

- 不再出现 `wallpaper` 类型却没有 wallpaper 实体；
- 默认至少具备“非纯白背景 + 圆角 + 阴影”中的两到三项；
- 用户一进 Studio 就能明显感觉“已经被美化过”。

### P1：定义“默认预设 vs 用户最近设置”的关系

如果希望降低长期操作成本，这一步很关键。否则用户每次都要重新调，留存改善会有限。

### P2：再考虑内容感知型默认模板

例如横屏/竖屏、产品演示/教学录屏、浅色/深色页面对应不同默认模板。这一步有价值，但不属于当前最小闭环。

---

## 8. 风险清单

如果后续开始实现，最需要注意的风险有：

1. **覆盖用户主动编辑结果**  
   默认预设只能在“首次进入 / 尚未编辑”时自动注入，避免用户改完又被覆盖。

2. **壁纸异步加载导致首屏闪烁**  
   若默认背景图异步准备过慢，会出现“先白后变”的跳变。

3. **预览与导出不一致**  
   默认配置注入必须仍然走 `backgroundConfigStore`，不能绕开导出链路。

4. **Drive 切换 recording 的会话行为不清晰**  
   需要明确切换录制时默认预设是否重新应用。

5. **默认预设过重导致性能或审美问题**  
   阴影、超大模糊、复杂壁纸都应保守，否则首屏虽然更“花”，但不一定更“稳”。

---

## 9. 最终评估结论

### 9.1 现状判断

当前 Studio 已具备完整的“编辑器”能力，但**没有把这种能力在首屏转化成用户立刻看得见的价值**。

“白色原片”并不是渲染失败，而是：

- 默认配置语义错误（`wallpaper` 无实体）
- 默认视觉参数太弱（白底、0 圆角、无阴影）
- 缺少“进入 Studio 即套用默认成品风格”的明确策略

### 9.2 对卸载率的影响判断

这是一个**高优先级留存问题**。因为它发生在“用户刚完成一次录制、最期待看到成果”的时刻，直接影响用户对产品高级感、易用性与完成度的判断。

### 9.3 结论建议

建议尽快推进一版“Studio 默认视觉预设”方案，且方案目标不应只是修复 bug，而应明确服务于以下结果：

- 录制完成进入 Studio 时，用户立刻看到“已经像成品”的画面；
- 用户可以在默认成品基础上继续微调，而不是从零开始装修；
- 预览与导出保持一致；
- 后续可扩展到“记住用户偏好”与“智能模板推荐”。

下一步建议见配套文档：  
`/home/runner/work/screen-recorder/screen-recorder/docs/STUDIO-DEFAULT-APPEARANCE-TECHNICAL-DESIGN.md`
