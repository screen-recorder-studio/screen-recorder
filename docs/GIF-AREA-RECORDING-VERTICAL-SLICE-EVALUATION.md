# “GIF录制 → 选择区域 → Studio”垂直切片评估

## 1. 文档信息

- 文档状态：实施决策稿 v1.0
- 评估日期：2026-08-23
- 当前基线：Screen Recorder Studio 0.6.12
- 用户流程：Action 中点击“GIF录制” → 在当前页面选择区域 → 录制 → 进入现有 Studio
- 上位产品定位：[面向落地页与 EDM 的营销动效资产工作台](./PRODUCT-POSITIONING-MARKETING-MOTION.md)
- 历史架构结论：[Element / Area 历史录制链路端到端评估](./ELEMENT-AREA-RECORDING-E2E-EVALUATION.md)
- 媒体与交付专项：[GIF 录制意图的所有权、Studio 与导出优化评估](./GIF-MEDIA-PIPELINE-STUDIO-EXPORT-EVALUATION.md)
- 实施与验收结果：[GIF 区域录制垂直切片实施与端到端验收](./GIF-AREA-RECORDING-IMPLEMENTATION-AND-ACCEPTANCE.md)

## 2. 执行结论

### 2.1 决策

建议优先实施，结论为 **Go with gates**。

这是一条产品价值清晰、能复用当前主干的垂直切片，但它不是“在 Action 多加一个按钮”的小改动。完成定义必须覆盖：

```text
GIF 工作流入口
→ durable 选区会话
→ 当前 Tab 捕获
→ 真实帧级区域裁剪
→ 当前 WebCodecs / OPFS
→ Studio 打开指定 recording
→ 导出对话框默认选择 GIF
```

只有到 Studio 还不够。若用户点击“GIF录制”后，Studio 的导出默认仍是 MP4，这条路径在技术上连通、在产品上却没有闭环。

### 2.2 总体评分

| 维度 | 评分 | 判断 |
|---|---:|---|
| 产品价值 | 9 / 10 | 与 EDM / 产品动效定位高度一致 |
| 当前主干复用率 | 8 / 10 | Tab Capture、offscreen、编码、OPFS、Studio 均可复用 |
| UI 改动风险 | 4 / 10 | Action 和轻量选择器边界清晰 |
| 状态机改动风险 | 6 / 10 | 必须增加 selecting、area 和 intent，不能旁路 coordinator |
| 裁剪与坐标风险 | 8 / 10 | zoom、DPR、首帧尺寸和动态 resize 是主要技术风险 |
| 平台手势风险 | 7 / 10 | 需验证选区延迟后 `tabCapture` 是否仍稳定 |
| Studio 交接风险 | 3 / 10 | 当前 OPFS ready 已自动打开指定 recording |

综合判断：**中高复杂度、低架构分叉风险，适合作为下一条优先垂直切片。**

## 3. 先定义正确的产品语义

### 3.1 `GIF` 不是录制模式

建议领域模型明确分开：

```ts
type RecordingMode = 'tab' | 'window' | 'screen' | 'area'
type RecordingIntent = 'video' | 'gif'
```

本切片是：

```ts
{ mode: 'area', intent: 'gif', source: 'tab' }
```

含义是：

- `area` 决定捕获范围；
- `gif` 决定进入 Studio 后的默认交付路径；
- 录制母版仍是当前 WebCodecs 视频和 OPFS 索引；
- GIF 继续在 Studio 非破坏性导出；
- 以后可让同一母版重导出 MP4 / WebM，而不重新录制。

禁止新增 `mode: 'gif'` 或独立 GIF 采集器，否则会再次产生第二套暂停、停止、存储和恢复逻辑。

### 3.2 Action 中的“GIF录制”是任务入口

不建议把它做成与 Tab / Window / Screen 并列的第四个“来源模式”。当前三个选项回答“录哪里”，而 GIF 回答“做什么成品”，混在同一网格会增加认知成本。

建议 Action 结构：

```text
┌──────────────────────────────┐
│ [ GIF录制 ]                  │
│ 框选页面区域，录制后进入 Studio │
├──────────────────────────────┤
│ 常规录制                     │
│ [标签页] [窗口] [屏幕]        │
│            [开始录制]         │
└──────────────────────────────┘
```

“GIF录制”应是直接动作：点击后立即进入当前页面选区，不要求用户再点击一次通用“开始录制”。

## 4. 推荐用户流程

### 4.1 正常流程

1. 用户在目标网页点击扩展 Action；
2. 点击“GIF录制”；
3. Background 校验页面是否可注入、当前是否已有活动录制；
4. 创建 `operationId`，会话进入 `selecting`；
5. popup 收到成功响应后关闭；
6. 当前页面出现区域选择层；
7. 用户拖拽区域，看到宽高与“取消 / 重选 / 开始录制”；
8. 点击“开始录制”；
9. 当前 Tab 进入 capture warmup，页面内显示 3、2、1；
10. 倒计时层确认移除后，offscreen 跨过正式首帧边界；
11. action badge 显示时长；用户再次打开 Action 暂停或停止；
12. 停止后复用当前 OPFS finalize；
13. Background 打开 `studio.html?id=<recordingId>&intent=gif`；
14. Studio 正常加载、允许现有编辑；
15. 用户点击导出时，统一导出对话框默认选中 GIF。

### 4.2 选择器 MVP 边界

首版只需要：

- 固定视口区域；
- 鼠标 / 触控板拖拽；
- 暗色遮罩和区域尺寸；
- 取消、重新框选、确认；
- `Esc` 取消；
- 最小区域限制；
- 页面导航、resize、zoom 后使旧选择失效。

首版不需要：

- 八方向 resize handles；
- 跟随 DOM 元素；
- 跨 iframe 元素选择；
- 页面滚动时选取视口外区域；
- 页面内暂停 / 停止控制条；
- 标注能力；
- 直接生成 GIF 而不进入 Studio。

录制中继续复用现有 Action 的暂停 / 停止 UI 和 badge。选择器确认页应明确提示“录制开始后，再次点击扩展图标可停止”。

## 5. 推荐架构

### 5.1 目标链路

```text
Popup: GIF录制
  │ REQUEST_AREA_GIF_SELECTION
  ▼
Background + RecordingCoordinator
  ├─ operationId / revision
  ├─ phase=selecting
  └─ storage.session operation context
  │ inject area-selector.js / css
  ▼
Current Tab: typed Area Selector
  │ AREA_SELECTION_CONFIRMED
  ▼
Background
  ├─ validate operationId + sender.tab.id + sender.documentId
  ├─ acquire tabCapture stream id
  └─ phase=requesting
  ▼
Offscreen
  ├─ Tab stream
  ├─ discarded warmup frames + in-page countdown
  ├─ resolve crop from actual first frame
  ├─ fail-closed crop
  ├─ current cadence / pause / WebCodecs
  └─ current OPFS Writer
  ▼
OPFS_RECORDING_READY
  ▼
Studio?id=...&intent=gif
  └─ current editor + preferred export format GIF
```

### 5.2 不复用旧 content capture

不要把 Action 重新接到这些旧消息：

- `ENTER_SELECTION`；
- `START_CAPTURE`；
- `STOP_CAPTURE`；
- `ELEMENT_RECORDING_COMPLETE`。

它们属于 `tabStates + content.ts capture + iframe sink` 的历史系统。新切片应新建独立、强类型、选择专用的 `area-selector`，Content Script 不持有 stream、encoder、worker、OPFS 或 Studio handoff。

### 5.3 新选择器应单独构建

建议新增：

```text
src/extensions/area-selector.ts
static/area-selector.css
scripts/build-area-selector.mjs
```

通过 `chrome.scripting.insertCSS()` 和 `executeScript({ files })` 注入。它们不需要加入 `web_accessible_resources`，也不需要恢复 `<all_urls>`。

不要继续扩展 2253 行且带 `@ts-nocheck` 的历史 `content.ts`。该文件还混有当前标注能力，继续加入新 Area 会扩大职责耦合。

## 6. 会话与消息契约

### 6.1 状态机变化

当前状态缺少选择阶段，建议扩展为：

```text
idle
  → selecting
  → requesting
  → countdown
  → recording ⇄ paused
  → stopping
  → finalizing
  → idle

selecting → idle       用户取消
任意活动态 → failed    页面、捕获、裁剪或存储失败
```

`selecting` 必须属于当前 `RecordingCoordinator`，不能只保存在 selector 页面或 Background 内存 Map 中。

### 6.2 Session 字段

建议扩展可序列化状态：

```ts
interface RecordingSessionState {
  phase: RecordingPhase
  operationId: string | null
  revision: number
  mode: RecordingMode
  intent: RecordingIntent
  countdownRemaining: number
  elapsedMs: number
  errorCode: string | null
  updatedAt: number
}
```

目标 Tab、document 和选区属于 operation context，可单独保存在 `chrome.storage.session`：

```ts
interface AreaRecordingContextV1 {
  version: 1
  operationId: string
  targetTabId: number
  targetDocumentId: string
  intent: 'gif'
  countdown: number
  selection: AreaSelectionDescriptorV1 | null
}
```

这样不会把完整几何信息广播给所有 recording UI，同时可抵抗 Service Worker 休眠。

### 6.3 选择描述符

```ts
interface AreaSelectionDescriptorV1 {
  version: 1
  rectCss: { x: number; y: number; width: number; height: number }
  viewportCss: { width: number; height: number }
  visualViewport: {
    offsetLeft: number
    offsetTop: number
    width: number
    height: number
    scale: number
  }
  devicePixelRatio: number
  selectedAt: number
}
```

Background 不信任 payload 中的 tab 或 document 标识，必须从 `message.sender.tab.id` 和 `message.sender.documentId` 读取并与 context 比较。

### 6.4 建议消息

- `REQUEST_AREA_GIF_SELECTION`：Action 发起；
- `AREA_SELECTION_OPENED`：selector 完成挂载；
- `AREA_SELECTION_CONFIRMED`：附 descriptor；
- `AREA_SELECTION_CANCELLED`；
- `AREA_SELECTION_FAILED`；
- `AREA_COUNTDOWN_TICK`：Background → selector；
- `AREA_SELECTOR_DISMISSED`：正式帧前的清屏确认；
- 当前 `REQUEST_TOGGLE_PAUSE`、`REQUEST_STOP_RECORDING`、STREAM、OPFS 消息保持不变。

迟到消息若 `operationId`、tab 或 document 不匹配，应返回 `STALE_AREA_OPERATION`，不得改变当前 session。

## 7. 捕获与用户手势评估

### 7.1 首选方案：确认选区后取 Tab stream

Chrome 官方说明：

- `activeTab` 在用户执行 Action 后生效，并持续到页面导航或标签关闭；
- `tabCapture` 只能在扩展被用户调用后启动；
- `targetTabId` 必须是扩展已获得 `activeTab` 的标签；
- Chrome 116 起，Service Worker 获取的 stream ID 可在 offscreen document 中消费。

因此首选流程是：Action 建立授权 → 用户选区 → Background 在同一 Tab、同一 document 上调用 `getMediaStreamId()`。

但官方示例均在 Action 手势后立即取流，没有明确承诺选择耗时后的行为。正式开发前必须先完成真实 Chrome spike：

| 场景 | 预期 |
|---|---|
| 点击后立即确认 | 成功 |
| 10 秒后确认 | 成功 |
| 30 秒后确认 | 成功 |
| 60 秒后确认 | 成功 |
| 选择期间切换 Tab 再返回 | 明确失败或按设计恢复，不能捕获错误 Tab |
| 同 Tab navigation 后确认 | 必须失败 |

### 7.2 备选方案：Action 手势内预先建立 stream

若延迟确认会导致 `TAB_CAPTURE_PERMISSION_DENIED`，备选链路为：

1. 点击“GIF录制”时立即获取 stream ID；
2. offscreen 立即消费并保持 Tab stream；
3. selection 阶段只丢弃帧，不初始化 encoder / OPFS；
4. 确认选区后进入 countdown 和正式帧；
5. 取消选择则立即关闭 stream。

此方案会让浏览器在选区阶段就显示捕获状态，工程复杂度也更高，但仍不需要系统 picker 或旧 content capture。

不要把一次性 stream ID 缓存到选区结束后再消费；Chrome 文档明确说明该 ID 只能消费一次，并会在几秒后过期。

## 8. 区域裁剪设计

### 8.1 发布切片必须是真实裁剪

不建议把首版实现成“完整 Tab 写入 OPFS，进入 Studio 后自动设置 crop”：

- OPFS 仍保存选区外像素，与用户对“区域录制”的隐私预期不符；
- 存储和编码成本没有下降；
- crop 状态丢失时会暴露完整画面；
- Studio 首帧和最终 GIF 可能出现语义差异；
- 它验证的是 Studio 裁剪，不是 Area Recording。

这种方案可用于开发期 UI 原型，但不能作为公开发布版本。

### 8.2 正确坐标映射

不要使用：

```ts
pixelX = cssX * devicePixelRatio
```

浏览器 zoom、系统显示缩放和 Tab Capture 内部缩放都会让它失真。应以 offscreen 收到的实际首帧为事实源：

```text
scaleX = firstFrame.displayWidth  / selection.viewportCss.width
scaleY = firstFrame.displayHeight / selection.viewportCss.height

pixelRect = map(selection.rectCss, scaleX, scaleY)
```

随后：

1. clamp 到首帧边界；
2. 对 x / y / width / height 做编码兼容的整数和偶数对齐；
3. 记录请求 rect 与实际 rect；
4. 用裁剪后的宽高调用现有 `resolveRecordingEncodePlan()`；
5. 对每个 formal frame 应用同一 crop；
6. 若后续帧尺寸改变，首版直接失败，不静默重新映射。

### 8.3 插入现有 offscreen 的位置

当前 offscreen 已有正确的 warmup 与 formal lane 边界。Area 应插入在：

```text
warmup first frame
→ resolve/validate crop
→ configure encoder from cropped dimensions
→ init OPFS with cropped metadata
→ countdown UI dismissed
→ fresh formal processor
→ crop frame
→ active timeline timestamp
→ current WebCodecs worker
```

裁剪可优先验证 `VideoFrame` 的 `visibleRect` 构造路径；若目标 Chrome 组合不稳定，再使用 OffscreenCanvas。两者都必须保留 fail-closed：裁剪失败就进入 failed，不得继续编码完整 Tab。

### 8.4 倒计时与 UI 清屏

Tab 模式当前不会创建独立倒计时窗口。Area 正好可以利用页面 selector 显示倒计时，同时 offscreen 丢弃 warmup frames：

1. offscreen 发出 countdown meta；
2. Background 将 tick 定向发给 target Tab；
3. selector 显示 3、2、1；
4. zero tick 时 selector 删除所有 DOM 和 CSS；
5. Content 返回 `AREA_SELECTOR_DISMISSED`；
6. Background 再响应 offscreen；
7. offscreen 保留现有 compositor guard，并创建新的 formal processor。

这条确认链比固定睡眠更可靠，也是“成品里绝不出现选区框”的关键。

## 9. OPFS 与 Studio 交接

### 9.1 可直接复用的部分

当前链路已经具备：

- Worker 流式写入 OPFS；
- 30 秒 finalize 确认；
- `OPFS_RECORDING_READY(operationId, id)`；
- Background 自动打开 `studio.html?id=<id>`；
- Studio 校验 recording 可用性并加载首帧；
- 当前 Studio 编辑与 GIF 导出。

因此 Area 不应增加新的 handoff 方式。

### 9.2 需要扩展的 metadata

当前 offscreen 的 `normalizeMeta()` 和 OPFS writer 只保留 codec、width、height、fps 等字段。建议增加：

```ts
capture: {
  mode: 'area'
  source: 'tab'
  intent: 'gif'
  mappingVersion: 1
  requestedRectCss: Rect
  actualRectPx: Rect
  sourceFrameSize: { width: number; height: number }
}
```

默认不要持久化页面 URL、标题或 DOM 信息。

### 9.3 Studio 的最小产品闭环

Background 打开：

```text
studio.html?id=<recordingId>&intent=gif
```

Studio 保持当前编辑体验，不自动弹出导出对话框，避免打断首帧加载和用户编辑。但应：

- 解析并保留 `intent=gif`；
- 把 `preferredFormat="gif"` 传给 `VideoExportPanel`；
- `UnifiedExportDialog` 第一次打开时默认选择 GIF；
- 用户仍可改选 MP4 / WebM；
- 从 Drive 重新打开时，可从 OPFS meta 恢复 intent；
- 切换到另一条 recording 时重新解析该 recording 的 intent。

不能只改 `UnifiedExportDialog` 的全局默认值为 GIF，那会改变常规录制用户的现有行为。

## 10. 代码影响面

### 10.1 直接修改

| 模块 | 变化 |
|---|---|
| `routes/popup/+page.svelte` | 新增独立“GIF录制”入口、selecting 取消态 |
| `recording-session.ts` | 增加 `area`、`gif intent`、`selecting` 和选择事件 |
| `recording-session-store.ts` | 接受并规范化新 mode / intent / phase |
| `recording-coordinator.ts` | request selection、confirm、cancel |
| `recording-popup-model.ts` | selecting 显示取消，不当作无控制 busy |
| `background.ts` | capability、注入、context、消息校验、Area countdown、start 分流 |
| `offscreen-main.ts` | area 作为 tab source、crop stage、metadata |
| `opfs-writer-worker.ts` | 持久化 capture metadata |
| `routes/studio/+page.svelte` | 解析 intent 并传给导出面板 |
| `VideoExportPanel.svelte` | preferred format prop |
| `UnifiedExportDialog.svelte` | 按录制意图初始化格式 |
| observability | mode / intent / selection 事件类型扩展 |

### 10.2 新增

- typed area selector；
- selector CSS；
- selector build entry；
- area geometry mapper；
- operation context store；
- geometry / session / message / Studio intent 测试；
- Chrome 实机 E2E 用例。

### 10.3 不应修改或恢复

- Side Panel；
- 旧 ElementRegionSelector；
- 旧 content capture；
- iframe OPFS sink；
- `<all_urls>`；
- `web_accessible_resources`；
- 独立 GIF encoder during capture。

项目当前有 54 个 locale。Action 和 selector 新文案发布前应覆盖全部 locale，或至少显式使用可读的英文 fallback；不能让缺少 key 的语言直接显示 `gif_area_*`。

## 11. 风险登记

| 风险 | 概率 | 影响 | 对策 / 门槛 |
|---|---|---|---|
| 选区耗时后 tabCapture 手势失效 | 中 | 高 | 首先做 0/10/30/60s spike；失败则预先保持 stream |
| CSS rect 到帧像素偏移 | 高 | 高 | 以真实首帧映射，覆盖 zoom / DPR E2E |
| 选择 UI 进入首帧 | 中 | 高 | dismiss ack + compositor guard + fresh processor |
| crop 失败后录到完整 Tab | 中 | 极高 | fail-closed，测试故障注入 |
| popup 关闭后选择状态丢失 | 中 | 高 | coordinator + storage.session context |
| 选择中导航或 reload | 高 | 中 | sender.documentId 校验 + tabs.onUpdated failed/cancel |
| Annotation 与 selector 冲突 | 中 | 中 | Area MVP 不启用 annotation；独立 selector namespace |
| Studio 仍默认 MP4 | 高 | 中 | intent URL + meta + preferredFormat 测试 |
| 选区太小导致 GIF 不可读 | 中 | 低 | 最小尺寸和输出尺寸提示 |
| 54 locale 漏文案 | 高 | 低 | locale completeness 自动检查 |

## 12. 测试与验收

### 12.1 单元测试

- `idle → selecting → requesting → countdown → recording → finalizing → idle`；
- selection cancel / navigation fail；
- stale operation、错误 tab、错误 document 被拒绝；
- session store 兼容旧 v1 数据；
- CSS rect 到 pixel rect 的 clamp / even alignment；
- 80%、100%、125%、200% zoom；
- DPR 1、1.5、2；
- 后续帧尺寸变化触发失败；
- regular recording 默认 MP4，GIF intent 默认 GIF；
- OPFS meta 保留 capture fields。

### 12.2 Chrome E2E

1. 点击 GIF录制，popup 关闭，selector 出现；
2. 取消后 action 恢复 idle，无残留 DOM / CSS；
3. 框选后倒计时可见，但导出的第一帧没有 selector；
4. 选区中心测试图的四边标记全部准确，外部隐私标记完全不可见；
5. action 重开可暂停 / 恢复 / 停止；
6. OPFS recording 只有裁剪后尺寸；
7. Studio 打开正确 ID，首帧和时长可用；
8. 导出弹窗默认 GIF；
9. 实际 GIF 尺寸、首帧和末帧与选区一致；
10. Tab / Window / Screen 原有路径回归通过；
11. protected URL 给出明确错误，不降级成错误捕获；
12. 连续 50 次选择 / 取消 / 录制没有孤儿 session、stream 或 OPFS 目录。

### 12.3 发布硬门槛

- 任何 crop 错误都不产生完整 Tab 录制；
- 选区外测试像素在 OPFS 解码帧和 GIF 中均不存在；
- Action 到 Studio 全链只有一个 operationId；
- 偶数对齐后四边误差不超过 1 px；
- selector 和倒计时不进入正式帧；
- Studio ready 的 recording 可读率 100%；
- GIF intent 只影响该 recording，不改变常规录制默认格式；
- 现有 302 项测试继续通过，并补齐新测试。

虽然产品交付边界是“进入 Studio”，测试边界必须继续走到真实 GIF 文件。否则无法证明“GIF录制”入口选择的区域和最终成品一致。

## 13. 实施拆分

建议以 feature flag 保护，分四个可审查阶段合并：

### Slice A：契约与平台 spike

- 新 session phase / mode / intent；
- operation context store；
- delayed tabCapture 实机验证；
- 纯函数 geometry mapper 和测试。

### Slice B：Action 与选择器

- “GIF录制”入口；
- typed selector；
- confirm / cancel / navigation invalidation；
- action 重开后的 selecting UI。

### Slice C：真实录制闭环

- Area 复用 Tab stream；
- countdown dismiss handshake；
- offscreen crop；
- OPFS capture metadata；
- pause / stop / finalize 回归。

### Slice D：Studio 意图与 E2E

- `intent=gif`；
- preferred export format；
- 真实 GIF E2E；
- locale 和 observability；
- 关闭 feature flag 前跑完整回归矩阵。

按当前代码影响面，这是一条 **M-high** 规模切片。单人完成实现与 Chrome 实机稳定性验证，可按约 8～12 个有效工程日估算；若必须采用“Action 时预先保持 stream”的备选方案，还需增加约 2～4 日。该数字只用于排序，不是交付承诺。

## 14. 最终建议

建议立即推进，但先完成两个前置 proof：

1. 选区延迟后的 `tabCapture` 手势有效性；
2. `VideoFrame` 裁剪在目标 Chrome 版本上的像素与性能验证。

两个 proof 通过后，按以下边界实施：

```text
新增：Action GIF intent + typed Area selector + offscreen crop + Studio GIF preference
复用：Coordinator + tabCapture + warmup + WebCodecs + OPFS + current Studio
禁止：旧 content capture + iframe sink + Side Panel + full-Tab-then-crop 发布方案
```

这条切片完成后，不仅恢复了区域录制，还验证了新的产品主路径：用户从一个渠道任务进入，录制聚焦内容，并在当前 Studio 中完成交付。

## 15. 关键源码

- Action：[popup/+page.svelte](../packages/extension/src/routes/popup/+page.svelte)
- 会话状态：[recording-session.ts](../packages/extension/src/lib/recording/recording-session.ts)
- 会话协调：[recording-coordinator.ts](../packages/extension/src/lib/recording/recording-coordinator.ts)
- 会话持久化：[recording-session-store.ts](../packages/extension/src/lib/recording/recording-session-store.ts)
- Background 主路由：[background.ts](../packages/extension/src/extensions/background.ts)
- Tab Capture：[tab-capture.ts](../packages/extension/src/lib/recording/tab-capture.ts)
- Offscreen 主干：[offscreen-main.ts](../packages/extension/src/extensions/offscreen-main.ts)
- OPFS Writer：[opfs-writer-worker.ts](../packages/extension/src/lib/workers/opfs-writer-worker.ts)
- Studio：[studio/+page.svelte](../packages/extension/src/routes/studio/+page.svelte)
- 导出面板：[VideoExportPanel.svelte](../packages/extension/src/lib/components/VideoExportPanel.svelte)
- 统一导出对话框：[UnifiedExportDialog.svelte](../packages/extension/src/lib/components/UnifiedExportDialog.svelte)

## 16. Chrome 官方资料

以下资料均于 2026-08-23 访问：

- [Audio recording and screen capture](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- [chrome.tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
