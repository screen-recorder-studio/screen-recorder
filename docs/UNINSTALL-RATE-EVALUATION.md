# 屏幕录制扩展卸载率评估报告

> 评估对象：`screen-recorder-studio`（Chrome MV3 扩展，版本 `0.6.12`）
> 评估目标：当前卸载率约 **25%**，定位影响用户留存的关键问题并给出修复建议
> 评估日期：2026-05-31
> 评估范围：`packages/extension`（首启/引导、权限、录制可靠性、导出、错误处理、国际化）

---

## 一、结论摘要（TL;DR）

25% 的卸载率对工具型扩展而言偏高。通过对源码的全面审查，问题**并非集中在单一环节，而是分布在「首次体验」与「核心录制可靠性」两条主线上**：

1. **首次体验存在明确缺陷**：新手引导页存在一处**国际化键缺失的真实 Bug**（非英语用户看到的引导步骤始终是英文），并且缺少卸载反馈渠道，无法获知真实卸载原因。
2. **核心录制链路存在「静默丢数据」风险**：在编码背压与 OPFS 写入两处，达到阈值后会**静默丢弃帧/数据块且不告知用户**。一旦用户的录制内容缺帧、卡顿或无法播放，几乎必然导致卸载。
3. **MV3 Service Worker 生命周期与录制状态持久化之间存在隐患**：长时间录制时后台被回收会导致状态丢失。

本次已**直接修复**了第 1 类中可低风险确定修复的国际化 Bug（见第六节）。其余涉及录制管线的改动风险较高、需要真机回归测试，本报告以「问题定位 + 修复建议」形式给出，不在本次直接改动，避免引入回归。

---

## 二、评估方法与工程概览

- 技术栈：SvelteKit 5 + TypeScript + Vite + TailwindCSS 4，`@sveltejs/adapter-static` 构建为扩展静态资源。
- 录制内核：`desktopCapture` + `getDisplayMedia` + WebCodecs（`VideoEncoder` / `MediaStreamTrackProcessor`），通过 Offscreen Document 执行，数据落盘到 **OPFS**（Origin Private File System）。
- 关键源码体量（行数）反映复杂度集中点：
  - `src/extensions/content.ts`（2253）、`src/lib/components/VideoPreviewComposite.svelte`（2335）
  - `src/lib/workers/export-worker/index.ts`（1980）、`composite-worker/index.ts`（1984）
  - `src/extensions/background.ts`（1261）、`src/extensions/offscreen-main.ts`（930）
- 权限（`static/manifest.json`）：`desktopCapture`、`downloads`、`storage`、`unlimitedStorage`、`activeTab`、`scripting`、`tabs`、`offscreen`；`minimum_chrome_version: 116`。

---

## 三、影响卸载率的问题清单（按优先级）

### P0 —— 直接造成「录制内容损坏/丢失」（最强卸载动机）

#### P0-1 编码背压静默丢帧，且无任何用户提示
- 位置：`src/extensions/encoder-worker.ts:16,104-110`
  ```text
  const BACKPRESSURE_MAX = 15; // drop frames if encode queue grows beyond this
  if (encoder.encodeQueueSize > BACKPRESSURE_MAX) { ...drop frame... }
  ```
- 问题：当编码队列积压超过阈值时直接丢弃当前帧。若被丢弃的是**关键帧（keyframe）**，会导致后续 delta 帧无法解码，表现为播放卡顿、跳帧甚至整段无法播放。
- 风险点：当前实现**没有丢帧计数**，也**不会在录制结束后告知用户**质量受损。用户只会感觉「录出来的视频坏了」。

#### P0-2 OPFS 待写队列溢出后静默丢弃数据块
- 位置：`src/extensions/offscreen-main.ts:74,232-234`
  ```text
  const OPFS_PENDING_CHUNKS_MAX = 500
  if (opfsPendingChunks.length >= OPFS_PENDING_CHUNKS_MAX) {
    console.warn('...Pending chunks queue full..., dropping oldest chunk')
    opfsPendingChunks.shift()   // 丢弃最旧的数据块
  }
  ```
- 问题：当 OPFS writer 初始化延迟或磁盘写入变慢时，编码后的数据块在内存缓冲。一旦缓冲达到 500 块上限，会**丢弃最旧的数据块**（在 30fps 下约相当于十余秒画面）。同样**仅有 `console.warn`，用户无感知**。
- 影响：用户看到「录制成功」，但视频开头若干秒缺失。

#### P0-3 OPFS 写入/完成（finalize）链路缺乏崩溃恢复
- 位置：`src/extensions/offscreen-main.ts:544-560`（延迟 finalize 的逻辑）、OPFS writer worker 的 index/meta 写入。
- 问题：录制「完成」消息到达时若仍有 pending chunk，则将 finalize 推迟（设 `opfsEndPending`）。若后续不再有消息触发，`meta.json` 的 `completed` 可能始终为 `false`，读取端会因元数据不完整而打开失败。
- 影响：录制结束后「文件打不开」，且没有任何修复/重试入口。

### P1 —— 失败「无声化」，用户得不到反馈

#### P1-1 导出/编码失败缺乏稳定的 UI 反馈
- 位置：`src/lib/services/export-manager.ts`、`src/extensions/offscreen-main.ts` 的错误路径主要为 `console.error` + 重新抛出，跨 worker/offscreen 经 `postMessage` 传递，**投递不保证**。
- 影响：导出看似在进行，实际已失败，界面挂起或无产物，用户无从判断，倾向于「这扩展坏了」并卸载。

#### P1-2 屏幕捕获被取消/拒绝时，错误文案不具引导性
- 位置：`src/extensions/offscreen-main.ts:394-407`（区分 `AbortError`/`NotAllowedError` 等），最终在引导/控制页以原始 message 展示。
- 问题：文案如「User cancelled screen sharing」对新手不友好，没有「如何重试 / 如何开启权限」的指引。用户第一次尝试就受挫的概率高。

### P2 —— 首次体验与可发现性

#### P2-1 【已修复】新手引导页国际化键缺失，非英语用户看到英文步骤
- 位置：`src/routes/welcome/+page.svelte:147-154,756-813`
- 问题：引导页「你的录制流程」使用 `journey_step1..4` 共 8 个键，但**所有语言包（含 `en`）均未定义这些键**；语言包里仅保留了已弃用、且源码不再引用的 `welcome_step*` 旧键。
  - 验证：`grep journey_step static/_locales/*/messages.json` 命中 0；`grep welcome_step src/` 命中 0（旧键已无引用）。
  - 后果：所有语言的用户都只能命中组件内的英文 `FALLBACK_MESSAGES`，**本地化引导失效**——对非英语用户尤其突兀，削弱首启信任感。
- 处理：本次已直接修复（见第六节）。

#### P2-2 缺少卸载反馈渠道（无法度量真实卸载原因）
- 位置：`src/extensions/background.ts:112` 仅在 `onInstalled` 打开 `welcome.html`，**未设置 `chrome.runtime.setUninstallURL`**。
- 影响：无法通过卸载问卷收集真实流失原因，导致 25% 这个数字「只有结果、没有归因」，优化缺乏数据闭环。建议（非本次改动，需要外部问卷 URL）补充卸载反馈页。

#### P2-3 Popup 缺少零状态引导
- 位置：`src/routes/popup/+page.svelte`
- 问题：Popup 同时呈现「录制 / 云盘 / 工作室」三张等权重卡片，对**零录制的新用户**没有「先点录制」的视觉引导。虽然点击「工作室/云盘」会进入有「开始录制」按钮的空状态页（非死胡同），但首启决策成本偏高。

### P3 —— 健壮性与长录制

- **P3-1 MV3 Service Worker 生命周期**：`background.ts` 的录制态（`currentRecording`、`tabStates`）主要存于内存，未在录制期间持久化到 `chrome.storage.local`；后台被回收后 UI/徽章/停止路由可能失效（`OFFSCREEN_START_TIMEOUT_MS=45s` 也大于 SW 约 30s 的空闲回收阈值）。
- **P3-2 长录制内存增长**：`recordedChunks` 元数据随时长线性增长（数小时录制累计可观），超长录制存在 OOM 风险。
- **P3-3 能力检测与降级缺失**：直接假定 WebCodecs / `MediaStreamTrackProcessor` 可用（无痕模式或实验性开关下可能不可用），无前置探测与降级路径。
- **P3-4 残留会话无清理**：崩溃后遗留 `completed:false` 的 OPFS 录制目录无自动清理，长期占用配额。

> 说明：P0/P1/P3 中关于录制管线的判断来源于源码静态审查，建议在真机上通过「长录制 + 慢磁盘 + 后台回收」场景复现确认后再改动，以免引入回归。

---

## 四、权限与隐私评估

- **正面**：未申请 `<all_urls>` 等宽泛 host 权限；强调「100% 本地处理、无水印、无上传」，隐私卖点清晰。
- **关注点**：`tabs` + `scripting` 组合在安装弹窗中观感偏「敏感」。这是录制当前标签所必需，但应在商店描述与首启引导中**显式解释用途**，降低安装期与早期卸载顾虑。

---

## 五、与卸载率的关联度排序（修复 ROI 建议）

| 优先级 | 问题 | 卸载关联度 | 修复风险 | 建议处理 |
|---|---|---|---|---|
| P0-1 | 背压静默丢帧 | 高 | 中 | 增加丢帧计数 + 结束时质量提示；评估提升阈值/反压等待 |
| P0-2 | OPFS 队列溢出静默丢块 | 高 | 中 | 改为反压等待而非丢弃；溢出时显式报错 |
| P0-3 | finalize 无恢复 | 高 | 中 | finalize 兜底定时器 + 启动时扫描修复未完成会话 |
| P1-1 | 导出失败无 UI | 中高 | 低 | 统一错误通道，保证失败必有可见提示 |
| P1-2 | 拒绝/取消文案 | 中 | 低 | 增加「重试 / 如何开启权限」引导 |
| P2-1 | 引导国际化缺键 | 中 | 低 | **本次已修复** |
| P2-2 | 无卸载反馈 | 中（归因） | 低 | 接入 `setUninstallURL` 问卷 |
| P2-3 | Popup 零状态 | 低中 | 低 | 首次高亮「录制」入口 |
| P3-* | SW/内存/降级/残留 | 中 | 中高 | 状态持久化、能力探测、残留清理 |

---

## 六、本次直接修复内容

### 修复：补全新手引导页缺失的 `journey_step*` 国际化键（P2-1）

- **根因**：引导流程从旧的 `welcome_step*`（3 步）重构为 `journey_step*`（4 步：固定到工具栏 / 录制 / 快速编辑 / 导出视频与 GIF）后，**只更新了组件代码，未更新语言包**，导致新键在所有语言包中缺失、旧键沦为无用残留。
- **改动**：在 `en`、`zh_CN`、`zh_TW` 三个语言包中补全 8 个 `journey_step1..4 {Title,Desc}` 键。
  - `en` 作为 `default_locale`（源语言）补齐后，`chrome.i18n` 可正确返回英文，不再依赖组件内兜底。
  - `zh_CN` / `zh_TW` 提供准确中文译文，简/繁体中文用户引导本地化恢复正常。
  - 其余语言保持现状（继续命中组件英文兜底），**与修复前行为一致，无回归**。
- **文件**：
  - `packages/extension/static/_locales/en/messages.json`
  - `packages/extension/static/_locales/zh_CN/messages.json`
  - `packages/extension/static/_locales/zh_TW/messages.json`
- **验证**：三个 JSON 文件均通过 `JSON.parse` 校验；`grep journey_step` 在上述三语言包中均命中 8 条。

> 注：其余 51 个语言包未在本次补齐译文，是为避免引入不可靠的机器翻译。建议后续由本地化流程统一补齐（兜底逻辑已确保此前不会出现空白文案）。

---

## 七、后续建议（不在本次改动范围）

1. **数据闭环优先**：先接入 `setUninstallURL` 卸载问卷，用真实归因驱动后续优先级，再决定 P0 录制管线的投入。
2. **录制可靠性专项**：针对 P0-1/P0-2/P0-3，在真机以「长时长 + 限速磁盘 + 后台回收」复现，改「静默丢弃」为「反压等待 + 显式错误 + 结束质量报告」。
3. **失败可见性**：建立统一的录制/导出错误上报与 UI 提示通道（P1-1），杜绝「无声失败」。
4. **首启体验**：补充权限用途说明与拒绝后的重试引导（P1-2、P2-3）。
5. **健壮性**：录制态持久化到 `chrome.storage.local`、能力探测与降级、残留会话清理（P3）。
