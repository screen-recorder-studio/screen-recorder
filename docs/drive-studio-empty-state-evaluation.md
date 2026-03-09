# Drive / Studio 无数据状态评估报告

> English summary: This document evaluates the current empty-state behavior in Drive and Studio when no recordings exist, identifies the incorrect Drive entry to `/sidepanel`, and recommends routing both empty-state recording CTAs through the existing Control window flow.

## 1. 背景与目标

本次评估聚焦以下页面在“没有任何视频数据”时的首屏体验：

- `packages/extension/src/routes/drive/+page.svelte`
- `packages/extension/src/routes/studio/+page.svelte`

目标期望是：

1. 当用户打开 Drive 或 Studio 且没有录制数据时，页面应明确引导用户去录制；
2. 点击“录制”后，应打开录制控制台 `packages/extension/src/routes/control/+page.svelte`；
3. 方案应尽量复用现有 background 路由能力，避免引入新的窗口管理分叉逻辑。

## 2. 当前实现评估

### 2.1 Drive 页面

Drive 页本身负责初始化 i18n 和录制列表数据，然后将状态传入 `RecordingList.svelte`：

- 页面入口：`packages/extension/src/routes/drive/+page.svelte:1-109`
- 数据加载：`loadRecordings()` 调用共享 OPFS 查询层 `listRecordings(true)`；见 `packages/extension/src/routes/drive/+page.svelte:16-28`

真正的空状态 UI 位于：

- `packages/extension/src/lib/components/drive/RecordingList.svelte:160-168`

当前行为如下：

1. `recordings.length === 0` 时显示空状态标题、描述与“Start Recording”按钮；
2. 该按钮使用静态链接：`<a href="/sidepanel">...</a>`；
3. 没有经过 background 的 `OPEN_CONTROL_WINDOW` 消息，也没有降级 fallback。

#### 结论

Drive 当前已经具备“引导去录制”的视觉文案，但**跳转目标错误**：

- 需求目标是打开 `control/+page.svelte`；
- 现实现跳往 `/sidepanel`；
- 这会导致无数据场景下的用户路径与 Studio、Popup、Background 已有入口不一致。

### 2.2 Studio 页面

Studio 已经实现了较完整的无数据状态机制：

- 空状态状态机：`packages/extension/src/routes/studio/+page.svelte:27-30`
- 初始录制解析流程：`packages/extension/src/routes/studio/+page.svelte:516-577`
- 空状态视图渲染：`packages/extension/src/routes/studio/+page.svelte:807-820`
- 空状态组件：`packages/extension/src/lib/components/studio/StudioEmptyState.svelte:1-79`

Studio 对无数据场景的处理分为多类：

- `no-recording`
- `invalid-recording`
- `opfs-unavailable`
- `load-failed`

在无 `id` 参数时，Studio 会：

1. 先调用 `listRecordings(true)`；
2. 再调用 `getLatestValidRecording(true)`；
3. 如果没有任何录制，则进入 `no-recording` 空状态；
4. 如果存在录制但都不可用，则进入 `invalid-recording`。

“开始录制”按钮行为位于：

- `packages/extension/src/routes/studio/+page.svelte:448-455`

当前逻辑：

1. 发送 `chrome.runtime.sendMessage({ type: 'OPEN_CONTROL_WINDOW' })`；
2. 若消息不可用，则 fallback 到 `window.open('/control.html', '_blank')`。

#### 结论

Studio 的无数据状态**已基本符合需求**：

- 能引导用户去录制；
- 点击录制会打开 Control；
- 且复用了 background 的统一开窗机制。

Studio 目前更像是本次需求的“正确参考实现”。

## 3. 与现有架构的一致性评估

### 3.1 已存在的统一入口

Background 已提供统一开窗能力：

- `packages/extension/src/extensions/background.ts:146-201`：`openOrFocusControlWindow()`
- `packages/extension/src/extensions/background.ts:607-617`：处理 `OPEN_CONTROL_WINDOW`
- `packages/extension/src/extensions/background.ts:619-629`：处理 `OPEN_DRIVE`

其优势：

1. 可复用已有 Control popup/window 生命周期管理；
2. 若控制台窗口已存在，会优先聚焦而不是重复创建；
3. 与 Popup、Studio 的现有行为一致。

### 3.2 共享录制查询层

Drive / Studio 已共用：

- `packages/extension/src/lib/utils/opfs-recordings.ts`

因此“是否有数据”的判断基础本身已经统一，问题主要集中在**无数据状态的交互出口不一致**，而非数据判定逻辑不一致。

## 4. 核心问题清单

### 问题 1：Drive 空状态录制入口错误

- 现状：跳转 `/sidepanel`
- 目标：打开 `/control.html`
- 影响：用户在 Drive 无数据场景下不能直接进入目标录制控制台

### 问题 2：Drive 与 Studio 的入口策略不一致

- Studio：`OPEN_CONTROL_WINDOW` + fallback
- Drive：静态链接
- 影响：行为分叉，后续维护成本高

### 问题 3：页面级开窗逻辑存在重复风险

Studio 已内联一套“打开 Control / Drive”的逻辑；
如果 Drive 再独立补一套，后续容易继续散落重复实现。

## 5. 风险评估

### 低风险项

- Drive 空状态按钮从链接改成按钮回调，风险低；
- 复用 `OPEN_CONTROL_WINDOW` 属于现有能力复用，不改动后台协议；
- Studio 只需轻量对齐，不需要改动无数据判定逻辑。

### 需要注意的点

1. Drive 的空状态位于 `RecordingList.svelte`，因此应通过 props 注入回调，避免组件内硬编码新导航逻辑；
2. 浏览器普通页面 / 非扩展运行环境下，仍需保留 `window.open('/control.html')` 兜底；
3. 不应扩大到无关的录制数据读取逻辑或 OPFS 逻辑变更。

## 6. 评估结论

结论如下：

1. **Studio 当前实现方向正确，基本满足需求**；
2. **Drive 当前实现不满足需求**，因为空状态录制按钮仍然跳往 `/sidepanel`；
3. 最合理的最小改动是：让 Drive 的空状态按钮复用与 Studio 相同的“打开 Control”策略；
4. 为降低重复代码，可将“打开 Control / Drive”的逻辑抽成轻量级工具函数，再由 Drive/Studio 复用。

## 7. 建议的后续动作

1. 新增导航工具函数，统一封装：
   - 打开 Control
   - 打开 Drive
2. Drive 页向 `RecordingList.svelte` 传入 `onStartRecording`；
3. 将 `RecordingList.svelte` 中空状态按钮从静态链接改为按钮回调；
4. Studio 改为复用同一工具函数，保持空状态行为一致；
5. 补充方案评审文档并实施最小代码优化。
