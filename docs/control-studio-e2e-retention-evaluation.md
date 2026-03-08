# Control → Studio 端到端留存评估（2026-03-08 刷新版）

> 目标：结合 `CLAUDE.md` 对工程整体架构的说明，从录制起点 `packages/extension/src/routes/control/+page.svelte` 一路评估到 `packages/extension/src/routes/studio/+page.svelte`，识别影响卸载率/流失率的关键体验断点，并给出能力建设建议。  
> 说明：本次仅输出评估文档，不修改代码。  
> 基线：`pnpm install` 成功；`pnpm build:extension` 成功；`pnpm check` 仍存在既有 warning/诊断，不属于本任务范围。

---

## 1. 先说结论

当前版本的**底层能力已经比较完整**，问题主要不在“不能录”“不能导出”，而在下面三件事：

1. **录制前半段缺少确定性反馈**  
   Control 已有 `preparing / countdown / saving` 状态，但“等待系统授权”“offscreen 初始化”“真正开始编码”仍被压缩成少量 UI 反馈，用户容易误判为卡住。

2. **Studio 默认结果不够“开箱即惊艳”**  
   现有编辑能力很强，但默认成片仍偏原始：默认背景配置虽然是 `wallpaper` 类型，实际没有预置壁纸对象时会回退为白底；圆角默认 `0`、阴影默认关闭，用户第一次看到的成片质感不够强。

3. **已有高级能力不少，但暴露方式还不够产品化**  
   项目已经支持 OPFS、关键帧对齐、裁剪、缩放聚焦、多格式导出、最近录制切换等，但用户仍需要自己摸索多个按钮和面板，产品“会用”和“好用”之间还有距离。

一句话总结：**当前版本更像“能力完整的工程产品”，但还没完全变成“默认体验就让用户愿意留下来”的消费级产品。**

---

## 2. 评估方法与工程上下文

### 2.1 来自 `CLAUDE.md` 的关键工程认知

根据 `/home/runner/work/screen-recorder/screen-recorder/CLAUDE.md`：

- 这是一个 **Chrome Extension MV3**，最小 Chrome 116。
- 主体在 `packages/extension/`，采用 **SvelteKit 2 + Svelte 5 runes + TypeScript + Tailwind CSS 4 + Vite 7**。
- 录制主链路是：
  - UI：Control / Studio
  - Service Worker：`background.ts`
  - Offscreen：`offscreen-main.ts`
  - OPFS：writer/reader workers
- Studio 依赖 OPFS 中的 `data.bin / index.jsonl / meta.json` 做按范围读取和关键帧对齐。

这意味着：**当前问题优先应该从 UI 默认体验、状态反馈、能力暴露方式下手，而不是贸然重做录制底层。**

### 2.2 本次实际查看的关键文件

- `packages/extension/src/routes/control/+page.svelte`
- `packages/extension/src/routes/studio/+page.svelte`
- `packages/extension/src/extensions/background.ts`
- `packages/extension/src/extensions/offscreen-main.ts`
- `packages/extension/src/lib/components/VideoExportPanel.svelte`
- `packages/extension/src/lib/components/UnifiedExportDialog.svelte`
- `packages/extension/src/lib/components/VideoPreviewComposite.svelte`
- `packages/extension/src/lib/workers/opfs-reader-worker.ts`
- `packages/extension/src/lib/utils/opfs-recordings.ts`
- `packages/extension/src/lib/stores/background-config.svelte.ts`

---

## 3. 当前端到端链路：从 Start 到 Export

## 3.1 Control：起点体验

Control 页面当前职责比较清晰：

- 头部：标题、版本号、Drive、关闭按钮（`control/+page.svelte:432-461`）
- 模式选择：仅暴露 `tab / window / screen`（`control/+page.svelte:328-348,477-520`）
- 状态反馈：`recording / paused / preparing / saving`（`control/+page.svelte:32-43,522-594`）
- 主按钮：Start / Stop / Pause / Resume（`control/+page.svelte:633-714`）
- 倒计时：1~5 秒（`control/+page.svelte:716-738`）
- Tips：按当前阶段显示提示（`control/+page.svelte:740-765`）

### 已经做得好的地方

1. **录制态恢复已比旧版本更可靠**  
   `REQUEST_RECORDING_STATE` 初始化时会恢复 `isRecording / isPaused / elapsedMs / mode`，其中 mode 恢复已经补上（`control/+page.svelte:157-169`）。

2. **Stop 后已有显式 saving 态**  
   点击 Stop 后，页面会进入 `saving`，不再像旧文档里那样“无反馈收口”（`control/+page.svelte:402-412,586-594,636-644`）。

3. **倒计时统一放在权限确认之后**  
   background/offscreen 会在拿到 stream 后再触发 `STREAM_META`，避免用户还没授权时就先倒计时（`background.ts:528-540`，`offscreen-main.ts:591-600`）。

### 当前仍然影响留存的点

#### 风险 A：Control 的 30 秒 UI 超时，与 background 的 45 秒启动超时不一致

- Control 自己的 `PREPARING_TIMEOUT_MS = 30_000`（`control/+page.svelte:40-43,121-130`）
- background 对 offscreen start 的消息超时是 `45_000`（`background.ts:9-11`）

**影响**：

- 用户可能在 30 秒时先看到“超时/失败”，但后台启动流程其实还没彻底结束。
- 这会制造“UI 说失败了，系统又像还在工作”的不确定感。

#### 风险 B：Preparing 仍然只有一个大状态，不够可解释

当前用户只能看到 `Preparing...`，但真实过程至少包含：

1. 等系统权限选择器
2. 获取 `getDisplayMedia()` 成功
3. 初始化 WebCodecs
4. 初始化 OPFS writer
5. 进入倒计时

这些节点目前只在内部消息里区分，UI 侧没有把它们翻译成用户可理解的子状态（`control/+page.svelte:359-384`，`offscreen-main.ts:426-455,584-600`）。

**影响**：

- 首次使用时最容易被误判为“卡住了”。
- 对新用户尤其伤，因为这发生在第一关键转化点。

#### 风险 C：主入口仍只暴露三种模式，与项目能力上限不一致

- `CLAUDE.md` 明确写了支持 page regions / DOM elements
- Control 当前只暴露 `tab / window / screen`（`control/+page.svelte:328-348`）
- background 仍保留了 capability 检测逻辑，用于判断 content script 是否可用（`background.ts:43-109`）

**影响**：

- 工程能力比产品入口更强，但用户感知不到。
- 对从商店介绍、文档、README 带着“区域录制/元素录制”预期来的用户，会有落差。

#### 风险 D：音频默认关闭，且入口没有任何解释

- Control 发起录制时固定传 `audio: false`（`control/+page.svelte:367-370`）
- background 安装默认设置里却有 `audioEnabled: true`（`background.ts:117-125`）
- offscreen 也会记录拿到的 `audioTracks` 数量，但当前 getDisplayMedia 选项里同样固定 `audio: false`（`offscreen-main.ts:333-359,369-377,430-440`）

**影响**：

- 用户很容易默认认为“屏幕录制应该包含系统音频/标签页音频”。
- 当前实现不一定是 bug，但**产品预期管理不够**，很容易形成“录出来怎么没声音”的负反馈。

---

## 3.2 Recording Pipeline：技术链路总体健康，但失败提示还可继续前移

当前主链路是：

```text
Control
  -> background REQUEST_START_RECORDING
  -> offscreen OFFSCREEN_START_RECORDING
  -> getDisplayMedia
  -> WebCodecs configure
  -> OPFS writer init
  -> STREAM_META（进入倒计时）
  -> COUNTDOWN_DONE_BROADCAST
  -> STREAM_START
  -> BADGE_TICK
  -> REQUEST_STOP_RECORDING
  -> STREAM_END
  -> OPFS finalize
  -> OPFS_RECORDING_READY
  -> background 打开 Studio
```

### 已经做得好的地方

1. **录制完成后自动打开 Studio**  
   `OPFS_RECORDING_READY` 到达后，background 会直接关闭 control 并打开 `studio.html?id=...`（`offscreen-main.ts:201-209`，`background.ts` 对应消息处理逻辑）。这是非常正确的闭环设计。

2. **低存储已有 warning 通道**  
   OPFS writer fatal error/warning 能够通过 `STREAM_WARNING / STREAM_ERROR` 抛回 UI（`offscreen-main.ts:94-100,153-172`）。

3. **关键帧写入与 OPFS 索引完整**  
   reader worker 依赖 `index.jsonl` 读取 `timestamp / offset / size / isKeyframe`，为 Studio 的快速首屏和关键帧对齐打下基础（`opfs-reader-worker.ts:15-34,98-193,253-295`）。

### 仍需关注的点

#### 风险 E：录制前缺少用户可见的“环境预检”

虽然 background 里已经有 `computeCapabilities(tabId)`，能识别：

- `chrome://` / `chrome-extension://` / Web Store 禁区
- `file://` 是否允许访问
- 内容脚本注入是否可用

但这些能力目前没有真正转化成 Control 起点的可见预检（`background.ts:43-100`）。

**影响**：

- 用户在不支持页面、受限页面、权限未开启场景下，仍可能要先点 Start 才知道不行。
- 失败反馈来得太晚。

---

## 3.3 Studio：当前版本已经明显进步，但默认成片和能力暴露仍是主要增长点

Studio 现在的整体结构：

- 左侧：主预览、时间轴、播放/裁剪/聚焦能力（`studio/+page.svelte:713-824`）
- 右侧：最近录制、导出、背景、圆角、Padding、阴影（`studio/+page.svelte:827-888`）
- 外层：Loading / Empty / Content 三态（`studio/+page.svelte:781-824`）

### 已经做得好的地方

1. **首屏 loading 已与 worker 回包对齐**  
   `loadRecordingById()` 里会在 `ready + range` 成功后再把 `isResolvingInitialRecording` 置为 `false`（`studio/+page.svelte:307-421`）。这比旧文档记录的实现更可靠。

2. **`invalid-recording` 分支已经接通**  
   无论是显式 `id` 校验失败，还是 worker 解析出错，都会进入 `invalid-recording`（`studio/+page.svelte:408-417,506-545`，`StudioEmptyState.svelte:5-24`）。

3. **导出错误已经具备可见反馈**  
   `VideoExportPanel` 现在有 `exportErrorMessage / exportErrorHint / exportErrorAction`，WebM 回读失败也会提示“去 Drive 找文件”，不再是假成功（`VideoExportPanel.svelte:89-92,332-344,455-470,673-722`）。

4. **编辑能力其实已经不少**  
   背景、宽高比、圆角、Padding、阴影、Crop、Trim、Zoom Focus、多格式导出都在系统里（`studio/+page.svelte:843-884`，`VideoPreviewComposite.svelte:2262-2345`，`UnifiedExportDialog.svelte:55-303`）。

### 当前仍然影响留存的点

#### 风险 F：默认背景配置名义上是 wallpaper，实际首屏往往仍是“白底原片”

这是当前最值得优先处理的产品问题之一。

- 默认背景配置：
  - `type: 'wallpaper'`
  - `color: '#ffffff'`
  - `padding: 60`
  - `borderRadius: 0`
  （`background-config.svelte.ts:13-22`）
- 但默认并没有预置 `lastWallpaperConfig` 或 `config.wallpaper`
- `getCurrentBackgroundStyle()` 在 wallpaper 没有预览图时会回退为占位/纯色（`background-config.svelte.ts:770-777,884-889`）

**结果就是**：

- 用户看到的并不是“自动带壁纸的精修成片”，而更接近“白底 + 原始矩形视频”。
- 这与用户对“Studio”二字的心理预期不一致。

这也正好对应了问题描述里的例子：**“录制完成后，视频背景还是白色”**。从代码角度看，这不是偶发问题，而是当前默认配置的自然结果。

#### 风险 G：用户要做出好看的视频，需要手动操作 3~5 个控件

想做出一个更像演示视频的结果，通常要手动完成：

- 选背景
- 调圆角
- 调 Padding
- 再决定要不要阴影
- 最后再导出

虽然每个单项控件都做了，但缺少一个**一键套用模板**的入口。对于首次用户，这意味着：

- 功能看起来很多
- 但“第一条作品”的改造成本仍然偏高

#### 风险 H：Studio 首次加载主链路仍然没有显式 timeout

`fetchWindowData()` 和 `fetchSingleFrameGOP()` 有 timeout（`studio/+page.svelte:610-643,667-699`），但 `loadRecordingById()` 主链路里的首次 `open -> ready -> getRange` 仍然没有单独 timeout（`studio/+page.svelte:307-421`）。

**影响**：

- 极端情况下如果 worker 卡住，首屏会一直转 loading。
- 用户感知会变成“录制完成了，但 Studio 打不开”。

#### 风险 I：导出期间仍然不能取消

- `ExportManager.cancelExport()` 已经存在（`export-manager.ts:247-254`）
- 但 `UnifiedExportDialog` 的 Cancel 按钮在导出时被直接禁用（`UnifiedExportDialog.svelte:689-699`）

**影响**：

- 长视频导出时，用户缺少掌控感。
- 即使技术上已有 cancel 基础，产品层还没把它真正交给用户。

#### 风险 J：部分高级能力藏得比较深，发现成本偏高

典型例子：

- Crop 在 `VideoPreviewComposite` 工具区里，不在右侧统一编辑面板里（`VideoPreviewComposite.svelte:2262-2345`）
- Trim 在时间轴上，通过交互式拖拽和 toggle 触发，而不是一个明显的“编辑模块”
- Zoom Focus 也主要通过时间轴/预览交互触发，而非右侧面板

**影响**：

- 工程上是完整的；产品上却容易让用户以为“只有背景/圆角/导出”。
- 能力存在 ≠ 用户能发现和用起来。

---

## 4. 当前系统应增加哪些能力，才能真正提升用户体验

下面不是“底层重构清单”，而是**最能提升留存感知**的能力方向。

## 4.1 第一优先：默认就能产出更像样的成片

### 能力 1：首条视频默认套用“轻量美化模板”

建议默认配置至少做到：

- 非纯白背景（预置壁纸 / 渐变 / 品牌色模板）
- 默认圆角（如 20~32）
- 默认轻阴影
- 保留当前已有的 16:9 + 60 padding

**为什么高价值**：

- 用户第一次看到的结果直接决定对产品的第一印象。
- 这是最典型的“减少用户操作次数，直接提升惊艳感”的能力。

### 能力 2：提供“一键模板”而不是只给单项控件

建议增加 3~5 套模板，例如：

- Clean Demo
- Creator Gradient
- Dark Glass
- Business Presentation

模板本质上只是把现有 `background / padding / radius / shadow / ratio` 组合起来，不需要新增底层能力。

**为什么高价值**：

- 用户不需要理解每个控件，也能快速做出可分享视频。
- 尤其适合第一次导出前的“快速润色”。

## 4.2 第二优先：录制前后的确定性反馈更强

### 能力 3：录制前预检与准备阶段可解释化

建议增加：

- 等待权限选择器
- 正在初始化录制引擎
- 即将开始倒计时
- 若超时，给出明确下一步动作

并把 timeout 策略统一，避免 UI 和后台各说各话。

**为什么高价值**：

- 用户最怕“不知道系统是不是死了”。
- 这类优化通常不需要动底层协议，只要把内部状态翻译成对用户友好的文案即可。

### 能力 4：Studio 首屏加载失败时给出 Retry / Drive / 重新录制动作

现在的空状态已经有基本动作，但还可以更进一步：

- 首屏 loading 超时后，提供“重试加载”按钮
- 提供“打开 Drive 查看其它录制”
- 对无效录制给出更明确原因（元数据损坏 / 文件缺失 / OPFS 不可用）

## 4.3 第三优先：把已有高级能力做成“可发现”功能

### 能力 5：把 Crop / Trim / Focus 包装成显性编辑步骤

当前这些能力已有实现，但更像“藏在高级工具里的功能”。建议把用户流程显化为：

1. 美化背景
2. 裁掉多余边缘
3. 强调焦点区域
4. 导出

**为什么高价值**：

- 不用新增核心能力，只是重新组织入口和叙事。
- 能显著提升“Studio 很专业”的感知。

### 能力 6：导出期间支持取消 / 后台继续 / 快捷重试

这是典型的“已有基础能力，但还没做完产品层”的项目：

- cancel API 已经存在
- 进度 UI 也已经存在
- 差的是交互收口

---

## 5. 低成本 / 低风险 / 高收益机会（按优先级排序）

### P0：最值得立刻做

1. **首条视频默认美化模板**  
   直接解决“背景还是白的、看起来不高级”的第一印象问题。

2. **一键模板预设**  
   基于现有 store 组合能力，不改底层录制链路。

3. **Preparing 子状态 + timeout 对齐**  
   解决“卡住感”和前台/后台状态不一致。

4. **Studio 首屏主加载 timeout + retry**  
   避免“永远 loading”的体验黑洞。

### P1：很值得做，但可以排在第二批

5. **导出中取消**  
   需要把现有 cancel API 接到 UI，风险低于重做导出。

6. **Studio 显性编辑步骤化（模板 / Crop / Focus / Export）**  
   主要是交互层重组，不是重写算法。

7. **录制前环境预检卡片**  
   把已有 capability 结果产品化输出。

### P2：价值明确，但复杂度更高

8. **主入口暴露区域/元素录制**  
   价值高，但会涉及 control / background / content 的联动设计。

9. **音频录制开关与预期管理**  
   价值很高，但录制、编码、导出、浏览器兼容都要一起评估，不宜当成零风险改动。

---

## 6. 对“增加哪些能力可以提升用户体验”的最终建议

如果只选三件最能拉升体验的事，我建议是：

### 建议 1：默认产出“好看视频”

> 不是让用户学会编辑，而是让用户第一次导出就觉得“这视频已经能发了”。

落地方式：

- 默认背景不再是白底回退
- 默认圆角、阴影、间距有一套轻量模板
- 首次进入 Studio 自动应用，但允许用户随时切回“原始样式”

### 建议 2：提供一键模板 / 一键美化

> 让“能力丰富”变成“操作简单”。

落地方式：

- 三到五个模板卡片
- 预览即时生效
- 导出参数不受影响

### 建议 3：强化录制起点与 Studio 首屏的确定性反馈

> 留存问题往往不是功能不够，而是用户在关键节点心里没底。

落地方式：

- Preparing 子状态
- timeout 对齐
- Studio 首屏 timeout + retry
- 更明确的失败动作建议

---

## 7. 最终判断

当前版本已经从“工程能力验证阶段”走到了“可被真实用户使用的产品阶段”，但仍有两个明显短板：

1. **默认结果不够漂亮** —— 这会直接削弱分享欲和成就感；
2. **关键节点反馈还不够笃定** —— 这会直接抬高“是不是坏了”的心理成本。

对于“卸载率高”这个问题，我的判断是：

- **不是先去大改录制底层**；
- **而是先把默认美化、模板化、一致性反馈做起来**。

这类工作投入小、风险低、用户感知却非常强，是当前阶段最应该优先投入的方向。
