# Studio 默认视觉预设技术方案

> 目标：基于对当前 Studio 实现的评估，提出一套“录制完成进入 Studio 后，默认看到已应用背景图 / 圆角 / 阴影等视觉效果”的可落地技术方案。
>
> 范围：本方案仅输出设计，不修改代码。

## 1. 方案目标

本方案要解决的不是单一的白底问题，而是把 Studio 首屏从“编辑起点”升级为“半成品终点”。

具体目标：

1. **首屏即有成品感**  
   用户结束录制进入 Studio 后，立即看到已应用默认视觉效果的视频。

2. **默认即可用，继续可调**  
   默认配置不是终局，而是一个质量足够高的起点；用户仍可通过右侧面板继续修改。

3. **预览与导出一致**  
   默认配置必须继续复用 `backgroundConfigStore`，确保 `VideoPreviewComposite` 与 `VideoExportPanel` 一致。

4. **不额外增加用户负担**  
   用户无需理解“先选背景 / 再加圆角 / 再加阴影”这套流程，也能先看到好结果。

5. **为后续偏好记忆与模板推荐留扩展点**  
   当前先做默认预设，后续可扩展到“记住最近一次 Studio 风格”或“按场景推荐模板”。

---

## 2. 现状约束

## 2.1 当前配置源是 `backgroundConfigStore`

- 预览：`VideoPreviewComposite` 从 `backgroundConfigStore.config` 读取配置并送入 worker（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoPreviewComposite.svelte:89-90,1191-1315`）
- 导出：`VideoExportPanel` 同样读取该 store（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoExportPanel.svelte:81-82,170-207`）

结论：**任何默认预设都应通过该 store 注入**，不要新造第二套状态源。

## 2.2 当前默认值不适合作为产品默认预设

`defaultBackgroundConfig` 当前更像“技术安全初值”，而不是“Studio 首屏模板”：

- `type: 'wallpaper'` 但无 `wallpaper` 实体（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/stores/background-config.svelte.ts:13-22`）
- `borderRadius: 0`
- `shadow` 缺失
- fallback color 为纯白

结论：需要把“store 初始值”和“Studio 首屏默认预设”这两个概念区分开。

## 2.3 默认背景图涉及异步图片装载

如果默认预设直接选用内置壁纸，则依赖：

- `WALLPAPER_PRESETS`
- `backgroundConfigStore.handleWallpaperSelection()`
- `imageBackgroundManager.processPresetImage()` 的 fetch + `createImageBitmap()`

来源：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/data/wallpaper-presets.ts:5-278`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/stores/background-config.svelte.ts:835-844`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/image-background-manager.ts:81-124`

结论：若默认预设包含背景图，必须设计同步 fallback，避免首屏闪白。

---

## 3. 推荐方案概览

推荐采用 **“双层默认 + 一次性注入 + 可降级”** 方案：

### 层 1：同步基础预设（必须立即可用）

在 Studio 首次进入时，先同步应用一个**无需异步资源即可立即生效**的基础预设，至少包含：

- 默认背景色或渐变
- 默认 padding
- 默认 borderRadius
- 默认 shadow
- 默认 outputRatio

作用：保证用户一进入 Studio 就不再看到“白色原片”。

### 层 2：异步增强预设（可选背景图）

如果产品希望首屏最终落到“背景图”而非渐变/纯色，则在同步基础预设之后，再异步尝试加载默认壁纸；成功后无缝升级为图像背景，失败则保留基础预设。

作用：兼顾“立刻可见”和“最终更精美”。

### 注入策略：只在 Studio 会话首次进入且尚未编辑时自动执行

避免覆盖用户手工调整的样式，也避免用户在同一会话内切换 recording 时被反复重置。

---

## 4. 为什么不建议只改 `defaultBackgroundConfig`

表面上，直接把：

- `type` 改成 `solid-color` 或 `gradient`
- `borderRadius` 改成非零
- 加上默认 `shadow`

就能解决大部分问题。

这确实是一个**最低成本修复**，但它不够完整，原因有三点：

1. **语义不清**  
   `defaultBackgroundConfig` 是 store 安全初值，不等于“Studio 首屏策略”。

2. **无法表达“一次性注入”**  
   未来若要支持“用户最近一次配置优先”，单靠默认对象很难控制注入时机。

3. **不利于扩展到异步默认壁纸**  
   默认对象是同步结构，不适合承载“先给安全 fallback、后升级成 wallpaper”的两阶段行为。

因此建议：

- **短期** 可以把默认对象修正成合理的安全初值；
- **正式方案** 仍应引入 Studio 首屏默认预设注入层。

---

## 5. 详细设计

## 5.1 新增概念：StudioDefaultAppearancePreset

建议新增一个 Studio 专用预设描述对象，职责是定义“进入 Studio 首屏时希望默认看到什么”。

建议字段：

说明: 以下示例直接复用仓库现有类型，分别来自  
`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/types/background.d.ts` 中的 `GradientConfig`、`BackgroundConfig`。

```ts
interface StudioDefaultAppearancePreset {
  id: string
  name: string
  baseConfig: {
    type: 'solid-color' | 'gradient'
    color: string
    gradient?: GradientConfig
    padding: number
    outputRatio: BackgroundConfig['outputRatio']
    videoPosition: BackgroundConfig['videoPosition']
    borderRadius: number
    shadow?: BackgroundConfig['shadow']
  }
  wallpaperPresetId?: string
}
```

建议默认内容：

- `baseConfig`：一个轻量、审美稳定、无需异步资源的渐变或柔和纯色
- `wallpaperPresetId`：可选，对应一张系统内置壁纸，用于后续异步升级

## 5.2 新增能力：backgroundConfigStore.applyStudioDefaultPreset()

建议在 `backgroundConfigStore` 中增加明确方法，而不是让页面拼装一堆 `updateColor / updateShadow / updateBorderRadius` 调用。

建议接口：

说明: 以下接口中的 `ImagePreset` 也复用现有类型，定义位于  
`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/types/background.d.ts`。

```ts
applyStudioDefaultPreset(preset: StudioDefaultAppearancePreset): void
applyStudioDefaultWallpaper(preset: ImagePreset): Promise<void>
resetToStudioDefaultPreset(): Promise<void>
```

职责分工：

- `applyStudioDefaultPreset()`：同步写入基础预设
- `applyStudioDefaultWallpaper()`：异步装载壁纸并升级当前 config
- `resetToStudioDefaultPreset()`：供未来“恢复默认样式”按钮复用

这样可以把默认策略沉淀为稳定 API，而不是散落在页面生命周期里。

## 5.3 新增状态：Studio 首次自动注入保护

建议在 `+page.svelte` 或专门的 Studio session store 中维护以下状态：

```ts
let hasAppliedStudioDefaultPreset = false
let hasUserCustomizedAppearance = false
let lastPresetAppliedRecordingId: string | null = null
```

### 语义建议

- `hasAppliedStudioDefaultPreset`：本次 Studio 会话是否已自动注入过默认预设
- `hasUserCustomizedAppearance`：用户是否已手工修改过背景/圆角/阴影等
- `lastPresetAppliedRecordingId`：记录默认预设上次自动应用到哪条 recording

### 触发原则

默认预设自动注入只在满足以下条件时发生：

1. 当前 recording 已成功加载；
2. 当前会话尚未自动注入过，或当前 recording 尚未注入过；
3. 用户尚未手工改过视觉配置。

这样可以避免“切 recording 把用户刚调好的样式重置掉”。

## 5.4 注入时机设计

推荐时机：**Studio 页面完成首次有效录制加载之后**。

即：

- `loadRecordingById()` 收到 reader worker `range` 并进入可预览状态后；
- 或 `VideoPreviewComposite` 已就绪且开始处理首屏数据前；
- 但更推荐在页面层完成，因为它更接近“产品进入 Studio”语义。

### 推荐原因

1. 已经拿到 recording 上下文，后续若要按横竖屏做不同默认模板更方便。
2. 页面层更容易判断“是否首次进入 / 是否从 Drive 切换 / 是否用户已编辑”。
3. 不污染底层 worker 与纯渲染逻辑。

---

## 6. 推荐默认预设内容

## 6.1 基础预设（同步立即生效）

为满足“进入即见效”，建议首版默认采用以下基础策略：

### 方案 A（推荐）：柔和渐变 + 卡片化视频

- 背景：低饱和浅色渐变
- padding：48~72
- borderRadius：16~24
- shadow：轻阴影（小偏移 + 中低模糊 + 低透明度）
- outputRatio：保留当前 16:9 默认

优点：

- 同步可用
- 稳定、兼容大多数录屏内容
- 不依赖网络/图片解码
- 足够体现“不是原片了”

### 方案 B：柔和纯色 + 卡片化视频

- 背景：极浅灰蓝 / 极浅暖灰
- 其余同上

优点：更稳；缺点：视觉辨识度不如渐变。

### 方案 C：默认壁纸直出

不建议作为首版唯一路径。因为首屏要承担异步资源加载风险。

## 6.2 异步增强预设（可选升级为背景图）

若产品希望默认就有更强品牌感，可在基础预设生效后：

1. 选择一张最稳的内置壁纸（建议抽象/科技类，避免具象主体过多）
2. 后台调用 `handleWallpaperSelection()` 装载
3. 成功后把当前背景升级为 wallpaper
4. 失败则静默保留基础预设

这样用户体验是：

- 最差也能立刻看到“非白底 + 圆角 + 阴影”
- 最好能在几十到几百毫秒内进一步升级成品牌化背景图

---

## 7. 与现有组件的协作方式

## 7.1 与 `BackgroundPicker` 的关系

`BackgroundPicker` 继续作为用户手动修改入口，不需要改变其主职责。  
但需要注意：当前 `activeTab` 默认就是 `wallpaper`（`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/BackgroundPicker/index.svelte:21-29`）。

建议配套调整策略：

- 如果默认首屏基础预设采用 `gradient`，则 tab 初始视觉也应与真实配置一致；
- 如果最终异步升级为 wallpaper，再自然切到 wallpaper 状态。

否则又会出现“UI 在说壁纸，画面却不是壁纸”的落差。

## 7.2 与 `VideoPreviewComposite` 的关系

`VideoPreviewComposite` 不应承担“决定是否套默认预设”的职责。它应继续只做两件事：

- 读取当前 `backgroundConfigStore.config`
- 把配置传给 composite worker

这样职责最清晰，也最利于后续维护。

## 7.3 与 `VideoExportPanel` 的关系

`VideoExportPanel` 无需改导出逻辑，只要确保默认预设已注入 `backgroundConfigStore`，导出自然同步生效。  
这也是本方案刻意坚持单一配置源的原因。

---

## 8. 方案分阶段实施建议

## Phase 1：低风险闭环（优先）

目标：快速消除“白色原片”观感。

建议动作：

1. 修正 `defaultBackgroundConfig` 的安全初值语义
   - 不再使用“`wallpaper` 但无 wallpaper 数据”这种错位默认值
2. 引入同步基础预设
   - 默认渐变/纯色
   - 默认圆角
   - 默认阴影
3. 在 Studio 首次有效录制加载后自动注入一次

收益：

- 风险最低
- 用户立刻能感知改善
- 不依赖默认壁纸资源装载成功

## Phase 2：默认壁纸增强

目标：把默认首屏进一步升级为品牌化、模板化体验。

建议动作：

1. 增加默认 wallpaper preset 选择
2. 基础预设生效后异步升级为壁纸
3. 失败静默回退，不影响首屏基础效果

收益：

- 观感更强
- 更容易体现产品差异化

## Phase 3：用户偏好记忆

目标：进一步降低重复操作成本。

建议动作：

1. 将最近一次 Studio 外观配置持久化到 `chrome.storage.local`
2. 优先恢复用户最近配置
3. 没有历史配置时再回退到产品默认预设

收益：

- 对复用场景更友好
- 长期留存收益更大

---

## 9. 状态机建议

建议定义以下优先级：

```text
用户最近一次 Studio 外观配置
  > 当前会话已编辑配置
  > 产品默认 Studio 预设
  > store 安全初值
```

### 首版最小状态机

如果当前不做用户偏好持久化，则建议最小化为：

```text
当前会话用户已编辑配置
  > 产品默认 Studio 预设
  > store 安全初值
```

含义：

- 初次进入：自动应用默认 Studio 预设
- 用户手动调整后：不再自动覆盖
- 同一会话切录制：默认保持当前风格，除非明确要求“每条录制首次打开都重置为默认模板”

我更推荐默认保持当前风格，因为这更符合“批量处理多个录制”的用户预期。

---

## 10. 失败与降级策略

## 10.1 默认壁纸加载失败

处理策略：

- 记录日志
- 保留基础预设
- 不阻断预览
- 不向用户弹错误

原因：

- 默认壁纸只是增强项，不是主流程必需项；
- 首屏稳定性优先于默认背景图完整性。

## 10.2 Reader Worker / 首屏数据较慢

处理策略：

- 默认预设注入可以早于首帧完成，但不应早于 Studio 页面基础状态初始化；
- 即使首帧尚未显示，右侧控件与 store 也应已处于目标默认状态，避免首帧出来后仍是白色 fallback。

## 10.3 用户快速切换 recording

处理策略：

- 若异步默认壁纸仍在加载，而用户已切到另一条 recording，应能取消或忽略旧请求结果；
- 可以用 `recordingId + requestToken` 做幂等保护。

---

## 11. 验证方案

虽然本次不改代码，但建议后续开发完成后至少验证以下场景：

### 11.1 首次进入 Studio

- 录制完成自动进入 Studio
- 首屏立即可见默认视觉效果
- 不再出现白底近似原片

### 11.2 手动调整后导出

- 修改背景/圆角/阴影
- 预览效果与导出结果一致

### 11.3 默认壁纸失败降级

- 模拟内置壁纸装载失败
- 仍保留基础预设，不出现白屏/空背景

### 11.4 切换 recording

- 从 Studio Drive Overlay 切换不同录制
- 验证默认预设是否按设计重复应用或保持当前风格

### 11.5 重开 Studio

- 关闭再打开 Studio
- 验证“产品默认预设 / 最近用户配置”优先级是否符合预期

---

## 12. 推荐落地顺序

结合当前“只要先降低卸载率”的目标，我推荐如下落地顺序：

1. **先做同步基础预设**  
   这是见效最快、风险最低、对首屏体验改善最大的部分。

2. **再决定是否增加默认背景图异步升级**  
   若希望更强品牌感，再做 Layer 2。

3. **最后补用户偏好记忆**  
   这是降低长期重复操作成本的关键，但不是解决当前首屏问题的阻塞项。

---

## 13. 最终推荐

### 推荐技术路线

采用：

- **Studio 首屏默认预设注入层**
- **同步基础预设 + 可选异步壁纸增强**
- **单一配置源仍然使用 `backgroundConfigStore`**
- **只在首次进入且未编辑时自动应用**

### 推荐原因

这条路线同时满足：

- 解决当前白色原片问题
- 不破坏现有预览/导出链路
- 改造范围集中
- 可平滑扩展到“记住用户最近样式”

### 对当前 issue 的直接回应

这套方案能确保用户在录制结束进入 Studio 时：

- 不是先看到白色原片；
- 而是先看到已经套好默认背景、圆角、阴影的结果；
- 然后再决定是否继续细调。

这正是降低用户操作成本、改善 Studio 第一印象、进而改善卸载率的最关键一步。
