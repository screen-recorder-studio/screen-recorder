# Control → Studio 低风险技术修复方案

> 目标：基于《Control → Studio 端到端留存风险评估》，识别**低耦合、低回归、可快速上线**的修复项。  
> 说明：本方案只给出技术修复建议，不实施代码修改。
> 注：文中源码行号基于本次评估时的仓库快照（2026-03-07），后续代码演进后可能发生漂移。

## 1. 修复策略原则

优先选择以下类型的问题：

- **不改录制底层协议**，只改 UI 状态与文案反馈
- **不改 OPFS 数据结构**，只改页面上的状态分流与错误收口
- **不改导出 worker 主流程**，只改面板层的用户提示与异常透出
- **不引入新依赖**，复用现有 store / message / empty state / dialog 组件

## 2. 建议拆分为两批

### 第一批：近乎无风险，可直接进入开发
1. Control 恢复真实录制模式
2. Studio 首屏 loading 与 worker ready 对齐
3. Studio 接通 `invalid-recording` 分支
4. 导出失败时显示用户可见错误
5. WebM OPFS 回读失败时不要静默成功
6. Stop 后补一个“正在保存录制”状态提示

### 第二批：中风险，但仍建议尽快排期
1. Preparing 阶段增加更明确的进度与超时策略
2. Studio 首次 reader 初始化增加 timeout
3. 录制过程增加中途存储剩余量监测
4. 导出过程中增加取消能力

## 3. 低风险修复项明细

## 3.1 Control 恢复真实录制模式

### 问题
- 当前 `REQUEST_RECORDING_STATE` 返回了录制态，但 Control 初始化时没有消费 `state.mode`，导致重开面板时模式可能显示错误。

### 证据
- Control 初始化未恢复模式：`packages/extension/src/routes/control/+page.svelte:157-166`
- background 有 `currentRecording.mode`：`packages/extension/src/extensions/background.ts:971-980`

### 方案
- 在 Control 初始化响应中，若 `resp.state.mode` 为 `tab/window/screen`，同步写入 `selectedMode`
- 在 `STATE_UPDATE` 分支中继续保持现有回写逻辑

### 风险评估
- **低**
- 只影响 UI 展示，不影响录制链路

### 验收标准
- 录制 screen/window 时关闭并重开 Control，模式标签与状态条显示正确

## 3.2 Studio 首屏 loading 与 worker ready 对齐

### 问题
- 当前只要调用了 `loadRecordingById()`，页面就会离开首屏 loading，但真实数据尚未 ready。

### 证据
- `loadRecordingById(dirId)` 后立刻 `isResolvingInitialRecording = false`：`packages/extension/src/routes/studio/+page.svelte:495-499`
- 数据真正 ready/range 回来在 `readerWorker.onmessage`：`packages/extension/src/routes/studio/+page.svelte:339-407`

### 方案
- 将 `isResolvingInitialRecording` 的关闭时机后移到：
  - 首个 `ready` + `range` 成功之后；或
  - `error` / empty 分支确认之后
- 对 drawer 切换录制也引入相同 loading 态

### 风险评估
- **低**
- 只改 Studio 壳层状态，不改 reader worker 协议

### 验收标准
- Studio 打开时只会看到：
  - 明确 loading
  - 明确空状态
  - 明确内容页  
  不再出现中间空白态

## 3.3 接通 `invalid-recording` 分支

### 问题
- 空状态组件支持 `invalid-recording`，但实际不会被赋值，导致错误归因不够准确。

### 证据
- 定义存在：`packages/extension/src/routes/studio/+page.svelte:26-27`
- 组件支持：`packages/extension/src/lib/components/studio/StudioEmptyState.svelte:13-24`
- 实际赋值集中在 Studio 的 `readerWorker.onmessage` 错误处理和 `onMount` 初始分流逻辑中，当前只落到 `no-recording / opfs-unavailable / load-failed`，没有任何 `invalid-recording` 赋值：`packages/extension/src/routes/studio/+page.svelte`

### 方案
- 在以下场景显式映射为 `invalid-recording`：
  - `getLatestValidRecording()` 返回空但存在不可用录制
  - `opfs-reader-worker` 抛出索引/元数据解析错误
  - 指定 `id` 存在，但 `isRecordingUsable()` 不通过

### 风险评估
- **低**
- 只增加错误分流，不改变主逻辑

### 验收标准
- `no-recording / invalid-recording / opfs-unavailable / load-failed` 四类原因能被明确区分

## 3.4 导出失败时显示用户可见错误

### 问题
- GIF/WebM/MP4 导出失败都只写 console，没有页面反馈。

### 证据
- `TODO: Show error message`：  
  `packages/extension/src/lib/components/VideoExportPanel.svelte:230-233,448-451,553-556`

### 方案
- 在 `VideoExportPanel` 内增加一个本地 `exportErrorMessage` 状态
- 三个 `catch` 中统一写入：
  - 失败原因
  - 推荐动作（重试 / 降低分辨率 / 去 Drive 查看原文件）
- 在 `UnifiedExportDialog` 或按钮下方展示错误 banner

### 风险评估
- **低**
- 只加显示层，不动导出 worker

### 验收标准
- 任意导出失败后，用户能明确看到失败原因与下一步建议

## 3.5 WebM OPFS 回读失败时不要静默成功

### 问题
- 导出文件已经写到 OPFS，但回读下载失败时，当前逻辑只打印 warning，然后仍然关闭对话框。

### 证据
- 回读失败仅 warning：`packages/extension/src/lib/components/VideoExportPanel.svelte:426-439`
- 随后仍关闭 dialog：`packages/extension/src/lib/components/VideoExportPanel.svelte:445-446`

### 方案
- 将该分支从“静默吞掉”改为“显式成功但未下载”或“显式失败待用户处理”：
  - 方案 A：提示“文件已保存到 Drive，可前往 Drive 下载”
  - 方案 B：保持导出 dialog 打开，并给出“打开 Drive / 重试下载”按钮

### 风险评估
- **低**
- 不改 worker，只改成功收口逻辑

### 验收标准
- 回读失败时，用户至少知道：
  - 文件是否已经存在于 OPFS
  - 现在应该点哪里继续拿到文件

## 3.6 Stop 后增加“正在保存录制”提示

### 问题
- Stop 不等于文件已完成保存，但当前页面没有保存态。

### 证据
- Stop 只发消息：`packages/extension/src/routes/control/+page.svelte:398-406`
- finalize OPFS 发生在 offscreen 完成编码之后：`packages/extension/src/extensions/offscreen-main.ts:538-553`

### 方案
- Control 增加 `saving` 或 `finishing` 子阶段
- Stop 点击后：
  - 按钮禁用
  - 状态文案切成“正在保存录制”
  - 等待 `OPFS_RECORDING_READY / STREAM_ERROR`

### 风险评估
- **低**
- 只是页面状态补全，不影响消息协议

### 验收标准
- 用户点击 Stop 后，不会再误以为“点完立刻就结束了”

## 4. 中风险修复项（建议排期，但不建议和第一批混做）

## 4.1 Preparing 阶段升级为更可解释的状态机

### 问题
- Preparing 只有一个大状态，无法区分：
  - 等系统权限选择
  - 权限已给，正在初始化
  - 倒计时开始前

### 方案
- 新增细分文案或子状态：
  - `awaiting-permission`
  - `initializing-recorder`
  - `countdown`
- 允许用户在 preparing 态取消

### 风险评估
- **中**
- 会影响 control/offscreen/background 的状态协作

## 4.2 Studio reader 首次加载增加 timeout

### 问题
- 主加载链路没有 timeout，理论上可能卡死在 waiting 状态。

### 方案
- `loadRecordingById()` 对首次 `ready` 设定超时
- 超时后落到 `load-failed`，并提供“重试 / 打开 Drive / 重新录制”

### 风险评估
- **中**
- 要避免和正常的大文件慢加载误判

## 4.3 录制中途增加存储余量监测

### 问题
- 目前只在 writer init 时检查一次磁盘余量。

### 方案
- 在 writer append/progress 周期性调用 `navigator.storage.estimate()`
- 建立阈值：
  - warning：提示用户尽快停止
  - hard stop：优雅结束录制并明确提示原因

### 风险评估
- **中**
- 会增加录制过程中的 I/O/估算调用，需要性能验证

## 4.4 导出过程中增加取消能力

### 问题
- `ExportManager.cancelExport()` 已存在，但 UI 没接线。

### 方案
- 在导出 dialog 中增加 Cancel 按钮
- 调用 `exportManager.cancelExport()`
- 中断后保留当前参数，允许重试

### 风险评估
- **中**
- 需要验证 worker cancel 后的资源清理完整性

## 5. 推荐实施顺序

## Sprint 1：先修“看不见的问题”
1. Control 模式恢复
2. Studio 首屏 loading 对齐
3. `invalid-recording` 分支接通
4. 导出错误可视化
5. WebM 回读失败不再静默
6. Stop 后保存态

## Sprint 2：再修“容易误判为卡死的问题”
1. Preparing 状态细化
2. Studio 首次 reader timeout
3. 导出取消能力

## Sprint 3：最后修“长视频稳定性”
1. 录制过程存储余量监测
2. 基于长视频场景补充手工回归 checklist

## 6. 建议验收指标

上线后建议重点观察以下指标：

- Start 点击后 10 秒内进入 `STREAM_START` 的成功率
- Stop 后成功进入 Studio 的比率
- Studio 首次打开失败率
- 导出失败率（按 WebM / MP4 / GIF 分开）
- 导出失败后重试成功率
- 用户从 Studio 空状态点击“重新录制 / 打开 Drive”的转化率

## 7. 最终建议

若目标是**尽快压低卸载率**，建议不要一上来改底层编码与 OPFS 协议，而是优先修复：

1. **状态看不懂**
2. **失败看不见**
3. **成功不确定**

这些问题大都集中在 Control 与 Studio 壳层，属于低耦合修复，收益会明显高于风险。
