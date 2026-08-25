# Element / Area 历史录制链路端到端评估

## 1. 文档信息

- 文档状态：工程决策稿 v1.0
- 评估日期：2026-08-23
- 当前基线：Screen Recorder Studio 0.6.12
- 评估目标：判断历史 Element / Area 链路能否直接恢复，以及 Area 应如何接回当前 action 单路径录制架构
- 配套产品决策：[面向落地页与 EDM 的产品定位](./PRODUCT-POSITIONING-MARKETING-MOTION.md)
- 优先实施切片：[“GIF录制 → 选择区域 → Studio”垂直切片评估](./GIF-AREA-RECORDING-VERTICAL-SLICE-EVALUATION.md)
- 实施与验收结果：[GIF 区域录制垂直切片实施与端到端验收](./GIF-AREA-RECORDING-IMPLEMENTATION-AND-ACCEPTANCE.md)
- 本文取代 [OPFS-RECORDING-EVALUATION.md](./OPFS-RECORDING-EVALUATION.md) 中关于 Element / Area 当前可用性的判断

## 2. 执行结论

### 2.1 决策

| 议题 | 结论 |
|---|---|
| 重新打开旧 Side Panel / ElementRegionSelector 入口 | **No-go** |
| 给旧 manifest 加回权限与资源后原样发布 | **No-go** |
| 复用历史区域选择交互与几何思路 | **有条件复用** |
| 在当前 action → background → offscreen → OPFS 主干上新增 Area | **Go** |
| Area 与 Element 同期恢复 | **No-go，先 Area 后 Element** |

一句话结论：

> 历史链路已经是“被退役但代码残留的第二套录制系统”，不能通过恢复开关复活；Area 应作为当前统一录制会话的一种输入方式重建，页面内容脚本只负责选择，捕获、裁剪、编码、存储和收尾仍由现有 offscreen 主干负责。

### 2.2 评分

评分用于表达相对风险，不是精密量化：

- 当前 0.6.12 中历史 Element / Area 的实际可达性：**0 / 10**；
- 把旧入口和 manifest 项简单加回后的发布准备度：**2 / 10**；
- 旧选择 UI / 几何概念的可复用度：**5 / 10**；
- 基于当前统一主干重建 Area 的工程可行性：**8 / 10**。

## 3. 评估范围与方法

本轮沿以下链路逐段检查：

```text
入口
→ 权限与内容脚本注入
→ 元素 / 区域选择
→ 捕获源获取
→ CropTarget / RestrictionTarget
→ 倒计时
→ WebCodecs 编码
→ OPFS 写入
→ 暂停 / 停止 / 收尾
→ Studio 交接
→ 导航、崩溃和 Service Worker 恢复
```

证据包括当前源码、构建 manifest、Git 历史、现有单元测试和 Chrome 官方平台文档。本轮没有修改生产代码。

## 4. 历史链路如何形成又如何退役

### 4.1 时间线

| 日期 | Commit | 变化 |
|---|---|---|
| 2025-09-05 | `5a1d287` | 在 lab 中验证 Element / Region Capture 和扩展选区 |
| 2025-09-07 | `a1ab449` | 把区域选择、Side Panel 和内容脚本接入产品 |
| 2025-09-08 | `dc01e01` | 增加元素 / 区域录制、Worker 编码和 Studio 交接 |
| 2025-09-12 | `8e8fe87` | 引入 OPFS 路径，形成 iframe sink 方案 |
| 2025-11-15 | `d79aff0` | 从 popup 隐藏 Element / Area，并移除 Side Panel、`<all_urls>` 与 web-accessible resources |
| 2025-12-08 | `6e90845` | 进一步简化 popup 模式和停止逻辑，删除旧模式的主要分发代码 |
| 2026-03-07 | `70f0df1` | action 入口重构，继续围绕 Tab / Window / Screen 单路径演进 |
| 2026-08-15～16 | `b89b807`、`6022ee2` | 当前 Tab 录制改为无 picker 的 `tabCapture`，完善统一倒计时与 warmup 边界 |

### 4.2 关键事实

`d79aff0` 之前的 manifest 包含：

- `sidePanel` 权限；
- `side_panel.default_path`；
- `host_permissions: ["<all_urls>"]`；
- 对 `encoder-worker.js`、`opfs-writer.html`、`opfs-writer.js` 的 `web_accessible_resources` 声明。

这些内容在 `d79aff0` 中被一起移除。当前 manifest 只保留 action popup，且没有 Side Panel、host permissions 或 web-accessible resources。这证明旧功能是被有意退役，而不是单纯遗漏一个 UI 按钮。

## 5. 当前主路径与历史路径的架构差异

### 5.1 当前稳定主路径

```text
Action Popup
  → REQUEST_START_RECORDING
  → RecordingCoordinator
       ├─ operationId / revision
       └─ chrome.storage.session
  → Background
       ├─ Tab: chrome.tabCapture.getMediaStreamId
       └─ Window / Screen: display capture
  → Offscreen Document
       ├─ 倒计时与 warmup 边界
       ├─ MediaStreamTrackProcessor
       ├─ WebCodecs Worker
       └─ OPFS Writer Worker（30 秒 finalize 确认）
  → OPFS Recording
  → Studio
```

当前路径的关键优点：

- background 是会话事实源；
- 单次操作有 `operationId` 和递增 revision；
- 状态保存在 `chrome.storage.session`，可抵抗 Service Worker 休眠；
- offscreen 是唯一捕获与编码所有者；
- 编码配置以正式帧尺寸为准；
- 暂停时间会从输出时间线中剔除；
- OPFS 收尾等待显式完成，而不是固定睡眠后终止；
- Tab 模式可通过 `tabCapture` 捕获指定当前标签页，无需用户在系统 picker 中再次选择。

### 5.2 历史 Element / Area 路径

```text
Side Panel / ElementRegionSelector
  → Background.tabStates（Service Worker 内存 Map）
  → 注入 content.ts
       ├─ 选择 UI、遮罩、控制条、标注、预览
       ├─ navigator.mediaDevices.getDisplayMedia
       ├─ RestrictionTarget / CropTarget
       ├─ fetch encoder-worker.js → Blob Worker
       ├─ iframe: opfs-writer.html?mode=iframe
       └─ 页面内暂停 / 停止 / 清理
  → ELEMENT_RECORDING_COMPLETE 或 OPFS
  → Side Panel
  → Studio
```

它不是当前主路径的一个模式，而是独立拥有状态、捕获、编码、存储和控制面的第二套系统。

## 6. 端到端逐段评估

| 阶段 | 当前事实 | 结论 | 严重度 |
|---|---|---|---|
| 1. 产品入口 | Element / Area 仅残留在 Side Panel；manifest 不再注册 Side Panel；action 只有 Tab / Window / Screen | 不可达 | P0 |
| 2. 权限与注入 | 有 `activeTab + scripting`，可注入当前显式激活页；但旧 iframe / worker 未声明为 web-accessible | 选择器可重做，旧资源链不可用 | P0 |
| 3. 区域选择 | 能拖拽、遮罩、显示控制条；区域以 viewport fixed 定位 | 交互概念可复用，代码不宜原样复用 | P1 |
| 4. 元素选择 | 能点选 DOM 元素并生成透明目标；只在 scroll / resize 同步 | 动态布局、iframe、Shadow DOM、元素消失均缺少契约 | P1 |
| 5. 捕获源 | 页面中调用 `getDisplayMedia({ preferCurrentTab: true })`，用户仍可选错窗口或屏幕 | 无法保证目标就是当前 Tab | P0 |
| 6. 裁剪 | `restrictTo` / `cropTo` 失败只记 warning，然后继续录制 | 可能静默产出全屏或全 Tab，隐私与正确性不可接受 | P0 |
| 7. 倒计时 | 旧消息没有统一 `operationId`；等待广播或 `(countdown + 2)s` 超时 | 会出现静默等待，无法与当前会话可靠关联 | P0 |
| 8. 编码 | 内容脚本维护独立 Worker、尺寸推导和背压逻辑；文件 `@ts-nocheck` | 与当前 offscreen 编码主干分叉，维护风险高 | P0 |
| 9. OPFS | 依赖网页内 1px extension iframe；当前 manifest 阻止导航；失败后仍继续编码 | 当前构建下不可用，并可能无提示丢全部数据 | P0 |
| 10. 停止与 finalize | 先发 `end-request`，200ms 后可能 finalize；Worker flush 后又发 end；旧 writer 1.5s 后强制终止 | 存在尾帧丢失、截断和重复 finalize 竞态 | P0 |
| 11. 状态与控制 | `tabStates` 与当前 `RecordingCoordinator` 并存；旧事件没有 durable operation | action 可误判 idle，并发启动或停止错误对象 | P0 |
| 12. Studio 交接 | 一次性 handoff 依赖 `encodedChunks`，但 WebCodecs 路径明确不再累计；Side Panel 的 cache save 被注释 | 非 OPFS 交接是死路，OPFS 当前又被 manifest 阻断 | P0 |
| 13. 恢复与清理 | 页面导航会重置部分内存状态；捕获失败、刷新和 iframe 生命周期清理不完整 | 易残留 UI、stream、worker 或孤儿录制 | P1 |
| 14. 安全 | iframe sink 接收任意 `window.message`，未校验 origin、source 或 session nonce | 若重新公开资源，会扩大页面干扰 OPFS 会话的攻击面 | P0 |
| 15. 测试 | 当前 recording-session、tab-capture、倒计时有测试；Element / Area 内容路径基本无针对性测试 | 不具备回归发布条件 | P1 |

## 7. P0 根因详解

### 7.1 入口不是“隐藏”，而是已从产品声明中移除

当前 [manifest.json](../packages/extension/static/manifest.json) 没有 `side_panel` 和 `sidePanel` 权限；[popup/+page.svelte](../packages/extension/src/routes/popup/+page.svelte) 的模式数组也只有 `tab / window / screen`。虽然 [sidepanel/+page.svelte](../packages/extension/src/routes/sidepanel/+page.svelte) 与 [ElementRegionSelector.svelte](../packages/extension/src/lib/components/ElementRegionSelector.svelte) 仍在源码中，但打包后的用户没有入口。

因此第一项工作不是“恢复按钮”，而是决定新 Area 属于哪套状态机和哪条录制主干。

### 7.2 当前 manifest 会直接阻断旧 OPFS sink 和 Worker 加载

[content.ts](../packages/extension/src/extensions/content.ts) 在网页中执行：

- `fetch(chrome.runtime.getURL('encoder-worker.js'))`；
- 创建 `chrome.runtime.getURL('opfs-writer.html?mode=iframe')` 的 iframe。

Chrome 官方文档明确指出，扩展资源默认不对网页可访问；网页导航到未列入 `web_accessible_resources` 的扩展资源会被阻止。当前 manifest 没有任何此类声明，所以旧路径即使被触发，也会在编码 / 写入边界失败。

不建议为了恢复旧方案重新对 `<all_urls>` 公开这些资源，因为它会重新引入权限提示、扩展指纹和页面干扰面，而当前 offscreen 架构本就能避免网页 iframe。

### 7.3 裁剪是 fail-open，不是 fail-closed

历史 `startCapture()`：

1. 先调用 `getDisplayMedia()`；
2. Element 模式尝试 `RestrictionTarget.fromElement()` 和 `restrictTo()`；
3. 再尝试从透明目标生成 `CropTarget` 并调用 `cropTo()`；
4. 两种调用失败都只输出 warning；
5. 随后继续配置编码器并录制。

这意味着 API 不支持、用户选错捕获源、元素不再存在或目标不合格时，系统可能输出完整捕获源。对于“只录某个客户数据区域”的用户，这既是产品错误，也是隐私风险。

Area 的发布底线必须是：**裁剪未被确认，就不产生录制结果**。

### 7.4 sink 失败后，编码数据没有有效回退

历史 WebCodecs chunk 回调明确“不再累计 `encodedChunks`，仅通过 iframe sink 零拷贝写入 OPFS”。但是：

- `ensureSinkIframe()` 的失败不会阻止录制开始；
- chunk 不会进入 `state.encodedChunks`；
- 停止时的一次性回退只有在 `state.encodedChunks.length > 0` 时才触发。

所以 sink 失败时不是“性能下降”，而是编码完成后没有数据去向。Side Panel 的 `ELEMENT_RECORDING_COMPLETE` 也依赖同一个永远为空的数组。

### 7.5 停止顺序存在确定性竞态

旧路径停止时：

```text
reader.cancel
→ worker.postMessage(stop)
→ 立即向 sink 发送 end-request
→ sink 固定等待 200ms 后 finalize
→ worker flush / 最后 chunks / end 可能稍后才到
```

此外，旧 `finalizeOpfsWriter()` 最多等待约 1.5 秒便终止 writer。高分辨率、长录制或系统繁忙时，最后 chunks 可能在 writer 已关闭后到达。当前 offscreen 路径已经用 `waitForOpfsFinalization(..., 30_000)` 解决了同类问题，旧方案没有保留价值。

### 7.6 存在两个互不承认的会话事实源

历史消息处理依赖 `background.ts` 的 `tabStates: Map<tabId, state>`：

- 纯 Service Worker 内存，休眠会丢失；
- `START_CAPTURE` 在真实权限和捕获成功前就把 `recording` 设为 true；
- 旧 STREAM 消息属于 global 类型，局部 `state` 更新会被 `try/catch` 静默吞掉；
- `CONTENT_REPORT` 计算 next state 后广播，却不把它持久写回 Map；
- action 当前读取的是 `RecordingCoordinator`，不是 `tabStates`。

结果是旧页面可以认为自己在录制，而 action 仍显示 idle，并允许另一条 offscreen 录制启动。当前 pause / stop 命令也只面向 offscreen，不会可靠控制旧 content 录制。

### 7.7 Studio 交接没有闭环

历史交接有两条：

1. OPFS：依赖当前不可加载的 iframe sink；
2. 一次性 chunks：数组不再累计，且 Side Panel 中 `recordingCache.save(...)` 已被注释。

Side Panel 仍会拼出 `studio.html?id=rec_...`，但该 ID 未必存在于 OPFS 或缓存中。因此“成功打开 Studio 标签页”不等于 Studio 有可读录制。

## 8. 为什么 Area 应先于 Element

### 8.1 Area 已覆盖当前定位的大部分价值

- 能让用户只录一个产品组件或重点流程；
- 可以显著降低 GIF 像素量；
- 语义清楚：固定视口矩形；
- 不需要跟踪 DOM 生命周期；
- 与任意框架、Canvas、WebGL 和 Shadow DOM 内容兼容，只要最终能被 Tab 捕获。

### 8.2 Element 的额外不确定性

Chrome 官方 Element Capture 文档说明：

- 只对当前 Tab 的 self-capture 生效；
- 目标元素必须仍然存在且满足 eligibility；
- 目标需要形成可独立确定的连续二维区域，官方建议使用独立 stacking context；
- 目标在运行时变得不合格时可能停止产帧；
- 透明区域没有 alpha，可能得到意外黑色区域。

历史实现还没有覆盖：

- 元素因 SPA 更新被替换；
- ResizeObserver / MutationObserver 驱动的尺寸变化；
- 嵌套 iframe 和跨源 frame；
- Shadow DOM；
- CSS transform、zoom、sticky / fixed、遮挡语义；
- 元素离开视口或祖先变成 `display: none`。

近期如要提供“选元素”，建议产品语义是“智能生成一个初始 Area”，而不是承诺录制 DOM 子树。真正的 `RestrictionTarget` 可以在后续实验中作为优化，不作为首版正确性基础。

## 9. 推荐目标架构

### 9.1 核心原则

1. **一个会话事实源**：Background + RecordingCoordinator；
2. **一个捕获所有者**：Offscreen Document；
3. **一个存储实现**：当前 OPFS Writer Worker；
4. **Content 只选择，不捕获、不编码、不写 OPFS**；
5. **Area 裁剪失败即终止**，绝不降级成完整 Tab 成品；
6. **每条消息携带同一个 operationId**；
7. **不恢复 Side Panel、`<all_urls>` 或 iframe sink**。

### 9.2 新链路

```text
Action：选择 Area
  → Background 创建 operationId，状态进入 selecting
  → scripting 注入轻量、强类型的 area-selector
  → 用户拖拽 / 调整 / 确认
  → AREA_SELECTION_CONFIRMED(operationId, descriptor)
  → Background 校验当前 tab / document / viewport
  → tabCapture.getMediaStreamId(targetTabId)
  → Offscreen 获取完整 Tab 帧
  → 按 descriptor 在帧级裁剪
  → 现有倒计时 / cadence / WebCodecs / OPFS
  → OPFS_RECORDING_READY(operationId, recordingId)
  → Studio
```

### 9.3 状态机

建议把当前状态扩展为：

```text
idle
  → selecting
  → requesting
  → countdown
  → recording ⇄ paused
  → stopping
  → finalizing
  → idle

任意活动态 → failed
selecting → idle（用户取消）
```

`selecting` 不能只存在于 content 内存中。它必须保存 `operationId`、`mode: area`、`targetTabId` 和更新时间，这样 action 重新打开、Service Worker 休眠或用户点击取消时仍能得到一致结果。

### 9.4 选择描述符

建议版本化：

```ts
interface AreaSelectionDescriptorV1 {
  version: 1
  operationId: string
  targetTabId: number
  documentId: string
  capturedAt: number
  rectCss: { x: number; y: number; width: number; height: number }
  viewportCss: { width: number; height: number }
  visualViewport: { offsetLeft: number; offsetTop: number; scale: number }
  devicePixelRatio: number
}
```

消息至少包括：

- `AREA_SELECTION_CONFIRMED`；
- `AREA_SELECTION_CANCELLED`；
- `AREA_SELECTION_FAILED`；
- `AREA_SELECTION_INVALIDATED`（导航、resize、zoom 或 document 变化）。

所有消息必须验证 `operationId + tabId + documentId`，拒绝上一轮选择或旧页面发来的结果。

### 9.5 裁剪策略

推荐首版在 offscreen 的帧处理阶段做确定性裁剪：

```text
CSS rect
  → 根据正式首帧尺寸与选择时 viewport 建立 scaleX / scaleY
  → clamp 到源帧
  → 按编码器要求做偶数对齐
  → VideoFrame visibleRect 或 OffscreenCanvas 裁剪
  → 以裁剪后第一帧配置编码器
```

不要简单使用 `devicePixelRatio * CSS rect`。浏览器 zoom、显示缩放、Tab Capture 降采样和首帧实际尺寸都会让该公式失真。正式首帧应是像素尺寸事实源。

原生 `CropTarget` 可以保留为后续性能实验。Chrome 文档主要以 self-capture 为使用前提，而当前主路径是在 extension offscreen 中消费 `tabCapture` stream；在真实 Chrome 组合上证明兼容性之前，不能让它成为唯一正确性路径。

### 9.6 选择期间与正式录制前的页面 UI

- 选择阶段可以显示遮罩、尺寸、确认和取消；
- 确认后先移除所有选区 UI；
- 等待至少一个 compositor 边界，再开始 formal frame lane；
- 录制中的暂停 / 停止应复用全局 action / background 命令；
- 若需要页面浮动条，它只能是控制客户端，不能拥有录制状态；
- 浮动条必须在裁剪区域外，或在正式录制前隐藏；
- 裁剪未确认时禁止写入任何有效录制 chunk。

## 10. 复用、重写与隔离清单

| 对象 | 决策 | 说明 |
|---|---|---|
| `RecordingCoordinator` 与 session store | 保留并扩展 | 增加 `area` 和 `selecting`，沿用 operation / revision 语义 |
| 当前 action popup model | 保留并扩展 | 增加 Area 入口、选择中与取消状态 |
| `tab-capture.ts` | 直接复用 | 继续无 picker 捕获明确的 target tab |
| `offscreen-main.ts` 当前 warmup / cadence / pause | 直接复用 | 在 formal frame 进入编码前插入 crop stage |
| 当前 WebCodecs Worker | 直接复用 | 以裁剪后首帧配置尺寸 |
| 当前 OPFS Writer 与 Studio OPFS 读取 | 直接复用 | 元数据增加 capture mode 与 rect |
| 旧区域拖拽、遮罩和最小尺寸思路 | 参考复用 | 抽成独立、强类型、可测试的小模块 |
| 旧 ElementRegionSelector / Side Panel 流程 | 隔离 | 不作为新入口，不再扩展 |
| `background.ts` 的旧 tabStates 消息分支 | 新链路上线后删除 | 新路径不得再次写入它 |
| `content.ts` 的 Element / Area 捕获、编码、预览和 sink 代码 | 抽离后删除 | 保留仍被当前标注功能使用的部分，先做依赖确认 |
| `opfs-writer.ts` iframe sink 分支 | 删除 | 保留当前 extension/offscreen 所需 writer 部分 |
| `element-recording-integration.ts` 与 chunks handoff | 验证无引用后删除 | 新路径只使用 OPFS recording ID |
| manifest 的 `<all_urls>` / Side Panel / WAR | 不恢复 | MVP 用 `activeTab + scripting` 即可 |

不要直接删除整个 `content.ts`：它还混有当前录制的标注能力。正确做法是先把“标注”“选择”“历史捕获”三个职责拆开，再删除只属于旧链路的分支。

## 11. 权限与平台策略

### 11.1 MVP 权限

当前已有的 `activeTab + scripting + tabCapture + offscreen` 足以支持建议架构：

- Chrome 明确允许在用户执行 action 等显式手势后，用 `activeTab + scripting` 注入当前页面；
- 权限在页面导航或标签关闭时撤销，正好可以作为选择失效边界；
- Chrome 116 起，Service Worker 获取的 `tabCapture.getMediaStreamId()` 可由 offscreen document 消费；
- 项目当前 `minimum_chrome_version` 正是 116。

不建议为了 Area 重新申请 `<all_urls>`。如果未来要跨导航持续跟踪元素，应把它当成单独功能，以 optional host permission 重新评估。

### 11.2 明确不可支持页面

首版应在 UI 中明确禁用：

- `chrome://`、`chrome-extension://` 等受保护页面；
- Chrome Web Store 等禁止脚本注入的页面；
- 已经导航离开 activeTab 授权 origin 的页面；
- 无法稳定获得 viewport 契约的特殊页面。

降级方案是“录制整个 Tab 后在 Studio 裁剪”，而不是伪装成实时 Area 成功。

## 12. E2E 测试矩阵

### 12.1 入口与状态

- action 选择 Area 后 popup 关闭，选择器仍正常；
- action 重新打开显示 `selecting`；
- 重复点击开始被同一 coordinator 拒绝；
- 选择取消回到 idle；
- selecting / countdown / recording 任一阶段均可停止；
- Service Worker 休眠再唤醒后状态、operationId 一致；
- 旧 operation 的迟到消息不能改变新会话。

### 12.2 页面与几何

- DPR 1 / 1.5 / 2；
- 浏览器 zoom 80% / 100% / 125% / 200%；
- 小于最小尺寸、奇数尺寸、越界和贴边区域；
- 页面滚动、sticky / fixed 元素；
- 选择后 resize、zoom、全屏切换；
- 页面 reload、SPA navigation、tab close、切换 active tab；
- Canvas、WebGL、视频和 CSS transform 内容；
- iframe 区域作为像素被录制，但不承诺跨 frame 元素语义。

### 12.3 录制生命周期

- 倒计时 UI 不进入第一帧；
- 选区遮罩和控制条不进入任何帧；
- 暂停期间的时间戳被正确剔除；
- 浏览器“停止共享”触发完整收尾；
- 选择后立即停止、第一帧前停止、编码器配置中停止；
- Worker 崩溃、OPFS quota、finalize timeout；
- 连续录制 100 次，不残留 iframe、stream、worker 或孤儿 OPFS 目录；
- 10 秒、1 分钟、10 分钟录制的首尾帧和时长一致。

### 12.4 Studio 与导出

- Studio 打开的 recording ID 一定存在；
- meta 中记录 CSS rect、pixel rect、mapping version、source frame size；
- Studio 预览尺寸与实际 Area 一致；
- MP4 / WebM / GIF 使用同一裁剪画面；
- trim、zoom、背景与导出后无二次偏移；
- Email / Landing 预设能读取 Area 原始宽高并正确计算预算。

## 13. 发布门槛

P0 验收：

1. **零次错误全 Tab 输出**：任何裁剪失败都必须中止；
2. **零选区 UI 帧**：遮罩、提示、倒计时和控制条不出现在成品；
3. **单一 operationId**：从选择到 OPFS ready 全链路一致；
4. **像素边界可解释**：偶数对齐后，与预期区域误差不超过 1 px；
5. **Studio 可读率 100%**：收到 ready 的录制都可打开首帧、末帧和索引；
6. **停止不截断**：最后一个已接受编码帧在 OPFS index 中可见；
7. **无并发双录制**：Area 与 Tab / Window / Screen 互斥；
8. **100 次短录稳定性**：无孤儿会话、无持续增长内存、无残留页面 UI。

若无法满足第 1 项，Area 不应发布为实时区域录制，只能保留“录完整 Tab 后在 Studio 裁剪”的替代路径。

## 14. 建议实施顺序

### Phase 0：封存旧链路与建立契约

- 给旧消息和 Side Panel 代码标记 legacy；
- 补充静态依赖图，确认 annotation 对 `content.ts` 的使用；
- 先写 session / message / geometry 单元测试；
- 新 Area 放在 feature flag 后，不碰当前默认模式。

### Phase 1：选择器接入统一会话

- `RecordingMode` 增加 `area`；
- 状态机增加 `selecting`；
- action 增加 Area 入口；
- 新建小型 typed selector，只返回 descriptor；
- 完成取消、导航失效和 stale operation 防护。

### Phase 2：Offscreen 裁剪与存储闭环

- 用正式首帧校准坐标；
- 加入 crop stage 和 fail-closed 校验；
- 扩充 OPFS meta；
- 复用当前 finalize 与 Studio 打开逻辑；
- 跑录制、暂停、停止、Studio 的完整 E2E。

### Phase 3：稳定性与产品闭环

- 完成 zoom / DPR / resize 矩阵；
- 增加视觉 golden 和首尾帧校验；
- 接入 Email Safe / Landing Pack；
- 收集 Area 使用率、失败原因和体积收益。

### Phase 4：重新评估 Element

只有以下信号出现才进入：

- 用户频繁重新框选同一动态组件；
- 固定 Area 无法覆盖真实营销任务；
- 真实页面验证表明 `RestrictionTarget` 在目标架构中可靠；
- 团队愿意承担 iframe、Shadow DOM、动态布局和 eligibility 的产品边界。

## 15. 最终判断

拾起区域录制是合理决策，但“拾起”的对象应是**能力和用户价值**，不是历史实现。

最安全、也最符合当前工程演进的方案是：

```text
保留旧选择经验
+ 扩展当前 durable session
+ 复用 tabCapture / offscreen / WebCodecs / OPFS / Studio
- 页面内捕获
- 页面内编码
- iframe sink
- Side Panel 第二状态机
```

这样 Area 会成为当前单一路径的一个可靠模式，而不是重新引入一套已经被历史证明难以维护的平行录制系统。

## 16. 关键源码证据

- 当前 manifest：[manifest.json](../packages/extension/static/manifest.json)
- 当前 action 模式：[popup/+page.svelte](../packages/extension/src/routes/popup/+page.svelte)
- 当前 durable session：[recording-session.ts](../packages/extension/src/lib/recording/recording-session.ts)
- 当前 session store：[recording-session-store.ts](../packages/extension/src/lib/recording/recording-session-store.ts)
- 当前 coordinator：[recording-coordinator.ts](../packages/extension/src/lib/recording/recording-coordinator.ts)
- 当前无 picker Tab 捕获：[tab-capture.ts](../packages/extension/src/lib/recording/tab-capture.ts)
- 当前 offscreen 主干：[offscreen-main.ts](../packages/extension/src/extensions/offscreen-main.ts)
- 历史消息状态与入口：[background.ts](../packages/extension/src/extensions/background.ts)
- 历史选择、捕获、编码与 handoff：[content.ts](../packages/extension/src/extensions/content.ts)
- 历史 iframe sink：[opfs-writer.ts](../packages/extension/src/extensions/opfs-writer.ts)
- 历史 Side Panel：[sidepanel/+page.svelte](../packages/extension/src/routes/sidepanel/+page.svelte)
- 历史选择器：[ElementRegionSelector.svelte](../packages/extension/src/lib/components/ElementRegionSelector.svelte)

## 17. Chrome 官方资料

以下资料均于 2026-08-23 访问：

- [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Web Accessible Resources](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)
- [chrome.tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Region Capture / CropTarget](https://developer.chrome.com/docs/web-platform/region-capture/)
- [Element Capture / RestrictionTarget](https://developer.chrome.com/docs/web-platform/element-capture)
