# Control → Studio 端到端留存风险评估

> 评估目标：围绕当前版本“用户卸载率高”的问题，从录制起点到 Studio 编辑/导出完成一次端到端审查，只做评估、不改代码。  
> 评估范围：`packages/extension/src/routes/control/+page.svelte`、`packages/extension/src/routes/studio/+page.svelte`，以及它们直接依赖的后台、offscreen、OPFS、导出链路。
> 说明：文中涉及的源码行号基于本次评估时的仓库快照（2026-03-07），后续代码演进后可能发生漂移。

## 1. 评估方法与基线

### 1.1 评估方法
- 静态代码审查：控制面板、Studio、background、offscreen、OPFS reader/writer、导出面板与导出 worker。
- 基线验证：
  - `pnpm install`：成功
  - `pnpm check`：失败，但为既有问题，不在本次范围内
  - `pnpm build:extension`：成功

### 1.2 当前已知基线问题（与本任务无关）
- `packages/extension/src/routes/opfs-drive/+page.svelte:221`：既有 TS error
- `packages/extension/src/routes/sidepanel/+page.svelte:982`：既有 TS error
- 另外存在若干既有 Svelte/Tailwind warning，不影响本次仅输出文档

## 2. 先说结论

当前版本**底层能力并不弱**：录制主链路已经切到 `Offscreen + WebCodecs + OPFS`，Studio 也具备按需读取、关键帧对齐、导出到 WebM/MP4/GIF 的完整能力。

但从用户留存角度看，真正拉高卸载率的不是“不能录”，而是下面三类体验：

1. **开始录制时的确定感不足**  
   权限选择、准备中、倒计时、真正开始之间，状态反馈不够强，异常也不够可解释。

2. **Studio 打开与导出阶段的失败反馈太弱**  
   出错后大多只打印 console 或落到泛化空状态，用户侧缺少“发生了什么 / 现在怎么办”。

3. **部分流程存在“看起来成功、其实没有拿到结果”的隐性失败**  
   例如 WebM 从 OPFS 回读失败时，界面仍按成功流收口，这类情况最容易触发“不信任 → 卸载”。

一句话总结：**当前版本的主要问题不是功能缺失，而是关键转化节点缺少确定性反馈与失败兜底。**

## 3. 实际端到端用户路径

## 3.1 从 Control 开始录制

### 阶段 A：进入控制面板
- Control 载入后读取扩展版本、倒计时设置, 并向 background 拉取当前录制状态：`packages/extension/src/routes/control/+page.svelte:145-169`
- 当前 UI 支持的模式只有 `tab / window / screen` 三种：`packages/extension/src/routes/control/+page.svelte:323-343`

### 阶段 B：点击 Start
- `startRecording()` 先把界面切到 `preparing`，同时开启 30 秒超时：`packages/extension/src/routes/control/+page.svelte:121-130,354-379`
- 请求被发到 background：`packages/extension/src/extensions/background.ts:519-546`
- background 再转发到 offscreen：`packages/extension/src/extensions/background.ts:1062-1095`
- offscreen 通过 `getDisplayMedia()` 拉起系统权限选择器：`packages/extension/src/extensions/offscreen-main.ts:328-401,404-427`

### 阶段 C：倒计时与真正开始
- offscreen 初始化 WebCodecs / OPFS writer 后，发送 `STREAM_META` 触发 Control 倒计时：`packages/extension/src/extensions/offscreen-main.ts:584-600`
- Control 页面本地倒计时结束后广播 `COUNTDOWN_DONE`：`packages/extension/src/routes/control/+page.svelte:301-321`
- background 再广播 `COUNTDOWN_DONE_BROADCAST` 给 offscreen：`packages/extension/src/extensions/background.ts:1024-1036`
- offscreen 收到后真正进入编码录制并发出 `STREAM_START`：`packages/extension/src/extensions/offscreen-main.ts:604-619`
- Control 切到录制中并开始本地计时：`packages/extension/src/routes/control/+page.svelte:215-225`

## 3.2 录制过程中

- offscreen 每秒发一次 `BADGE_TICK` 同步时长：`packages/extension/src/extensions/offscreen-main.ts:20-42`
- Control 既有本地 250ms 刷新，也消费 `BADGE_TICK`：`packages/extension/src/routes/control/+page.svelte:80-112,181-192`
- 暂停/恢复通过 `REQUEST_TOGGLE_PAUSE` 走 background → offscreen：`packages/extension/src/routes/control/+page.svelte:382-395`、`packages/extension/src/extensions/background.ts:585-604`

## 3.3 停止录制并进入 Studio

- 点击 Stop 后，Control 只发送 `REQUEST_STOP_RECORDING`：`packages/extension/src/routes/control/+page.svelte:398-406`
- offscreen 停止 WebCodecs、停止 stream、触发 `STREAM_END`：`packages/extension/src/extensions/offscreen-main.ts:677-737`
- 编码 complete 后异步 finalize OPFS writer，成功后发出 `OPFS_RECORDING_READY`：`packages/extension/src/extensions/offscreen-main.ts:201-209,532-580`
- background 关闭 control 窗口，自动新开 Studio：`packages/extension/src/extensions/background.ts:359-410`

## 3.4 Studio 加载录制

- Studio 启动时优先读取 URL 上的 `id`；没有则自动找最近一条可用录制：`packages/extension/src/routes/studio/+page.svelte:482-525`
- 真正读取录制依赖 OPFS reader worker：`packages/extension/src/routes/studio/+page.svelte:307-411`
- reader worker 读取 `meta.json / index.jsonl / data.bin`，先发 `ready` 再拉首屏 range：`packages/extension/src/lib/workers/opfs-reader-worker.ts:62-91,253-295`
- Studio 收到首个 `range` 后，设置 `workerEncodedChunks`、窗口时间范围，并把 `recordingStore` 更新为 `completed`：`packages/extension/src/routes/studio/+page.svelte:368-399`

## 3.5 编辑与导出

- Studio 主预览使用 `VideoPreviewComposite`，窗口切换统一走 `computeFrameWindow()` + `handleWindowRequest()`：`packages/extension/src/routes/studio/+page.svelte:97-274,775-793`
- 右侧编辑能力来自多个 store：背景、圆角、Padding、阴影，以及 trim/crop：`packages/extension/src/routes/studio/+page.svelte:815-856`
- 导出入口在 `VideoExportPanel`：`packages/extension/src/routes/studio/+page.svelte:815-824`
- 实际导出由 `ExportManager` 分发到 worker：`packages/extension/src/lib/components/VideoExportPanel.svelte:141-237,341-557`、`packages/extension/src/lib/services/export-manager.ts:16-52`

## 4. 正向评价：哪些地方已经做得不错

### 4.1 录制完成后自动直达 Studio
- `OPFS_RECORDING_READY` 到达后自动关闭控制窗并打开 Studio：`packages/extension/src/extensions/background.ts:374-383`
- 这是很好的“任务闭环”设计，减少用户找文件/找入口的成本

### 4.2 Studio 支持“无 id 自动回到最新录制”
- `getLatestValidRecording()` 让 Studio 可以当作“最近结果页”：`packages/extension/src/routes/studio/+page.svelte:500-507`
- 这对留存是加分项，因为用户从入口回 Studio 时不需要记住录制 id

### 4.3 录制数据链路已经具备工程化基础
- OPFS 写入、`index.jsonl`、关键帧信息、按窗口读取都已具备：`packages/extension/src/lib/workers/opfs-reader-worker.ts:98-193,395-458`
- 这意味着很多留存问题其实可以通过**低风险 UI/状态修复**改善，而不必大改底层

## 5. 留存风险清单（按漏斗阶段排序）

## 5.1 阶段一：开始录制

### P0-1. Preparing 阶段反馈弱，等待时间长，用户难判断是否卡住
**证据**
- Preparing 超时固定 30 秒：`packages/extension/src/routes/control/+page.svelte:40-43,121-130`
- Preparing 态只展示转圈与文案，没有更细粒度反馈，也没有取消动作：`packages/extension/src/routes/control/+page.svelte:569-576,656-686`

**影响**
- 用户点击 Start 后，系统权限选择器、offscreen 初始化、倒计时、真正开始录制之间存在多个状态切换。
- 但对用户可见的只有“Preparing...”，且最长可等 30 秒。
- 在首次使用、系统权限弹窗被遮挡、用户犹豫不点授权时，极易被感知为“扩展卡死”。

**留存风险**
- 高。它发生在首个关键转化点，失败感知最强。

### P0-2. 重新打开 Control 时，当前录制模式可能显示错误
**证据**
- 初始化时只恢复 `isRecording / isPaused / elapsedMs`，没有恢复 `mode`：`packages/extension/src/routes/control/+page.svelte:157-166`
- 但 background 记录了 `currentRecording.mode`：`packages/extension/src/extensions/background.ts:971-980,1084-1089`
- 录制状态条右侧直接展示 `selectedMode`：`packages/extension/src/routes/control/+page.svelte:558-563`

**影响**
- 用户录着 screen/window 时重新打开 control，界面可能仍显示默认 `tab`。
- 这会直接削弱用户对状态的信任。

**留存风险**
- 中。不是功能失败，但属于“看上去不靠谱”的信任伤害。

### P1-3. Control 起点暴露的录制模式，与项目能力描述不一致
**证据**
- `CLAUDE.md` 的 `Project Overview` 与 `UI Pages` 章节描述支持 tabs/windows/screens/page regions/DOM elements
- Control 实际只暴露 `tab / window / screen`：`packages/extension/src/routes/control/+page.svelte:323-343`

**影响**
- 如果用户预期“区域录制 / 元素录制”能在主入口直接找到，会产生能力落差。
- 这更像产品发现问题，而非技术 bug。

**留存风险**
- 中。尤其对从商店页或文档页带着预期进入的新用户。

## 5.2 阶段二：录制进行中 / 停止后收口

### P0-4. 低存储只在初始化时检查，长录制仍可能在中后段失败
**证据**
- OPFS writer 初始化时只做一次 quota 检查：`packages/extension/src/lib/workers/opfs-writer-worker.ts:165-185`
- offscreen 录制过程中持续把 chunk 推入 pending/append，并没有基于剩余空间做中途拦截：`packages/extension/src/extensions/offscreen-main.ts:222-251,497-523`
- 一旦 writer fatal error，会直接 `emitStreamError()` 并中止：`packages/extension/src/extensions/offscreen-main.ts:160-172`

**影响**
- 现在已有“录前空间不足”的保护，但没有“长录制过程中空间持续下降”的保护。
- 录几十分钟后失败，对用户的挫败感明显高于“开始前就提醒”。

**留存风险**
- 高。因为它可能直接造成“录了很久，结果没有”。

### P1-5. Stop 之后的收口体验偏技术导向，缺少“正在保存”可视反馈
**证据**
- 点击 Stop 后 Control 侧只是发送消息，没有进入“正在保存录制”状态：`packages/extension/src/routes/control/+page.svelte:398-406`
- offscreen 在编码 complete 后还会等待 OPFS finalize：`packages/extension/src/extensions/offscreen-main.ts:538-553`
- background 最终靠 `OPFS_RECORDING_READY` 决定是否打开 Studio：`packages/extension/src/extensions/background.ts:359-410`

**影响**
- 用户点击 Stop 后，录制和保存并不是同一时刻完成，但 UI 没有明确告诉用户“文件正在落盘，请稍候”。
- 对长录制尤为明显。

**留存风险**
- 中。更偏体验问题，但在长视频场景下会放大。

## 5.3 阶段三：Studio 打开录制

### P0-6. Studio 初始 loading 过早消失，用户会看到一段“空白但非失败”的过渡
**证据**
- 命中 `id` 时，`loadRecordingById(dirId)` 被调用后立刻把 `isResolvingInitialRecording = false`：`packages/extension/src/routes/studio/+page.svelte:495-499`
- 但真正的数据 ready/range 是异步 worker 回来的：`packages/extension/src/routes/studio/+page.svelte:339-407`

**影响**
- 用户会先离开 loading 态，但这时 `workerEncodedChunks` 还没回来。
- 页面不是明确的 loading，也不是明确的 error，而是“空着/闪一下”，容易被理解为异常。

**留存风险**
- 高。Studio 是录制结果的第一印象页，这种“半加载”非常伤信任。

### P0-7. Studio 错误态过于泛化，`invalid-recording` 分支实际上没有被使用
**证据**
- `emptyStateReason` 类型定义包含 `invalid-recording`：`packages/extension/src/routes/studio/+page.svelte:26-27`
- 但实际赋值只出现了 `no-recording / opfs-unavailable / load-failed`：`packages/extension/src/routes/studio/+page.svelte:405-406,468-469,509-515,521-522`
- 空状态组件虽然支持 `invalid-recording` 文案，但当前流程不会走到：`packages/extension/src/lib/components/studio/StudioEmptyState.svelte:13-24`

**影响**
- “没有录制”、“录制损坏”、“读取失败”、“浏览器不支持 OPFS” 被压扁成少数几个笼统文案。
- 用户拿不到下一步动作建议，也无法判断是偶发问题还是录制已损坏。

**留存风险**
- 高。结果页失败但不可解释，是最容易触发卸载的场景之一。

### P1-8. OPFS reader 主加载没有超时保护
**证据**
- `fetchWindowData()` 与 `fetchSingleFrameGOP()` 都有 timeout：`packages/extension/src/routes/studio/+page.svelte:605-614,661-670`
- 但 `loadRecordingById()` 的首次 `open → ready → getRange` 链路没有 timeout：`packages/extension/src/routes/studio/+page.svelte:307-411`

**影响**
- 如果 reader worker 进入非异常但无响应状态，Studio 首屏可能卡住且没有升级路径。
- 这在用户视角就是“Studio 打不开”。

**留存风险**
- 中高。

## 5.4 阶段四：编辑与导出

### P0-9. 三种导出失败都只写 console，没有任何用户可见错误反馈
**证据**
- GIF 导出失败：`packages/extension/src/lib/components/VideoExportPanel.svelte:230-233`
- WebM 导出失败：`packages/extension/src/lib/components/VideoExportPanel.svelte:448-451`
- MP4 导出失败：`packages/extension/src/lib/components/VideoExportPanel.svelte:553-556`
- 三处都只有 `console.error(...)`，后面明确写着 `TODO: Show error message`

**影响**
- 用户看到的现象通常只是“导出按钮转了一下又回来了”。
- 对非开发者而言，这就是“导出功能不稳定 / 经常没反应”。

**留存风险**
- 极高。导出是结果兑现阶段，失败且无提示最伤口碑。

### P0-10. WebM 保存到 OPFS 后若回读下载失败，当前流程会“静默成功”
**证据**
- WebM 导出成功后，如果 worker 返回 `savedToOpfs`，UI 会尝试从 OPFS 再读回来并下载：`packages/extension/src/lib/components/VideoExportPanel.svelte:426-439`
- 如果这一步失败，只打印 warning，不报错、不提示、不 fallback：`packages/extension/src/lib/components/VideoExportPanel.svelte:437-438`
- 随后仍然关闭导出对话框，按成功流结束：`packages/extension/src/lib/components/VideoExportPanel.svelte:445-446`

**影响**
- 用户可能以为“导出完成了”，但本地并没有实际拿到文件。
- 这是最典型的“假成功”。

**留存风险**
- 极高。

### P1-11. 导出期间没有可见的取消/中断能力
**证据**
- `ExportManager` 提供了 `cancelExport()`：`packages/extension/src/lib/services/export-manager.ts:247-254`
- 但 `VideoExportPanel` 内没有对用户暴露取消动作，也没有任何调用：`packages/extension/src/lib/components/VideoExportPanel.svelte:141-557`

**影响**
- 长视频导出卡住时，用户只能被动等待或关闭页面。
- 从可控性角度看，会强化“扩展把我锁住了”的挫败感。

**留存风险**
- 中。

## 6. 风险优先级排序

### 最优先（最可能直接影响卸载）
1. 导出失败无用户提示
2. WebM 回读失败后静默成功
3. Studio 首屏 loading 过早消失 / 错误态不清楚
4. Preparing 阶段等待感太重
5. 长录制场景下缺少持续存储保护

### 次优先（影响信任与可预期性）
1. Control 录制模式回显错误
2. Stop 后缺少“正在保存”提示
3. reader 首次加载缺少 timeout
4. 导出没有取消能力

### 产品观察项
1. Control 主入口暴露的录制能力少于项目总体能力描述

## 7. 哪些问题最适合先做

如果目标是**在不动底层录制架构的前提下尽快降低卸载率**，我建议优先做以下类型：

1. **只改 UI 状态机与提示文案**  
   例如：Preparing/Saving/Load failed/Export failed 的可视反馈。

2. **只改 Studio 首屏 gating，不改 reader 协议**  
   例如：ready/range 回来前保持 loading，而不是直接进入空白态。

3. **只改导出面板的失败/成功收口**  
   例如：把 console 错误转成可见错误；WebM 回读失败时明确告诉用户文件已存到哪里。

4. **只补现有分支的状态映射**  
   例如：把 `invalid-recording` 真正接入，而不是新增大功能。

这些项都比“重写录制链路 / 重做导出管线 / 改 OPFS 存储结构”更适合作为短期留存修复。

## 8. 最终判断

当前版本并不是“录制与编辑能力不足”，而是**关键节点的确定性反馈不足**：

- 开始录制时，用户不知道系统是不是卡住；
- 打开 Studio 时，用户不知道结果是否真的可读；
- 导出失败时，用户甚至不知道失败了；
- 个别场景下，界面还会制造“其实没成功但看起来成功了”的假象。

对于屏幕录制工具来说，用户最在意的是三件事：

1. **我点了以后到底有没有开始录？**
2. **我刚录完的东西有没有真的保存下来？**
3. **我现在能不能稳定导出拿走？**

当前代码最需要修的，正是这三件事对应的反馈层，而不是底层编码层。
