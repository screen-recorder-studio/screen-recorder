# Drive / Studio 无数据状态技术方案

## 1. 目标

基于评估报告，技术方案目标如下：

1. Drive 与 Studio 在“无视频数据”场景下都提供明确的录制引导；
2. 点击“录制”统一打开 `control.html`；
3. 优先走 background 的 `OPEN_CONTROL_WINDOW`，保持窗口复用与聚焦能力；
4. 保留非扩展上下文 fallback；
5. 以最小改动完成，不触碰 OPFS 读写主流程。

## 2. 候选方案对比

### 方案 A：仅修 Drive 的静态链接

做法：

- 仅把 `RecordingList.svelte` 中 `/sidepanel` 改成 `/control.html`

优点：

- 改动最少

缺点：

- 不能复用 background 的 Control 窗口管理；
- 会绕开现有 `OPEN_CONTROL_WINDOW` 的“聚焦已有窗口”能力；
- 与 Studio 现有入口模式不一致。

### 方案 B：Drive 直接内联 Studio 的消息发送逻辑

做法：

- 在 Drive 页或 `RecordingList.svelte` 内新增 `chrome.runtime.sendMessage({ type: 'OPEN_CONTROL_WINDOW' })`；
- catch 时 fallback 到 `window.open('/control.html', '_blank')`

优点：

- 满足需求；
- 技术实现简单

缺点：

- 与 Studio 形成重复代码；
- 后续若调整入口策略，需要多处同步修改。

### 方案 C：抽取轻量导航工具并复用（推荐）

做法：

1. 新增轻量导航工具：
   - `openControlWindow()`
   - `openDrivePage()`
2. Studio 空状态复用该工具；
3. Drive 通过回调 props 调用该工具；
4. 保持 `OPEN_CONTROL_WINDOW` / `OPEN_DRIVE` 为主路径，`window.open()` 为 fallback。

优点：

- 满足需求；
- 与 background 现有机制完全一致；
- 复用性好，重复代码少；
- 变更范围仍然很小。

缺点：

- 比方案 A 多一个工具文件与少量调用点调整。

## 3. 最终方案选择

最终采用 **方案 C：抽取轻量导航工具并复用**。

原因：

1. 它仍然是低风险、最小范围的前端改动；
2. 能保留当前架构里最正确的入口方式；
3. 能同时修复 Drive 的需求偏差，并顺手收敛 Studio 的重复逻辑；
4. 方案足够轻量，不会引入额外状态复杂度。

## 4. 详细设计

### 4.1 新增统一导航工具

文件建议：

- `packages/extension/src/lib/utils/window-navigation.ts`

提供函数：

```ts
openControlWindow(): Promise<void>
openDrivePage(): Promise<void>
```

行为：

1. 先尝试 `chrome.runtime.sendMessage(...)`；
2. 若失败，则 fallback 到 `window.open(...)`；
3. 不引入新协议，只复用 background 既有消息类型。

### 4.2 Drive 页面改造

涉及文件：

- `packages/extension/src/routes/drive/+page.svelte`
- `packages/extension/src/lib/components/drive/RecordingList.svelte`

改造点：

1. Drive 页新增 `handleStartRecording()`；
2. 通过 props 传给 `RecordingList`；
3. `RecordingList` 空状态里的 `<a href="/sidepanel">` 改为 `<button>`；
4. 点击后调用 `onStartRecording`。

### 4.3 Studio 页面改造

涉及文件：

- `packages/extension/src/routes/studio/+page.svelte`

改造点：

1. 删除页面内联的 `OPEN_CONTROL_WINDOW` / `OPEN_DRIVE` 逻辑；
2. 改为调用统一导航工具；
3. 无需修改现有空状态判定流程。

## 5. 影响范围

### 直接影响

- Drive 无数据状态的“开始录制”行为
- Studio 空状态录制/打开 Drive 的导航实现方式

### 不受影响

- OPFS 录制查询逻辑
- Studio 录制解析与时间轴逻辑
- Control 页面录制状态机
- Background 消息协议

## 6. 验证方案

### 静态验证

1. `cd /home/runner/work/screen-recorder/screen-recorder/packages/extension && npx svelte-check --tsconfig ./tsconfig.json`
2. `cd /home/runner/work/screen-recorder/screen-recorder/packages/extension && npx vite build`

说明：

- 仓库当前存在既有 `svelte-check` 报错/警告，需要区分本次变更是否新增问题；
- 以“没有引入新的报错”为验收标准。

### 手动验证

1. 打开 Drive 空状态，确认按钮文案正常；
2. 点击 Drive 空状态“Start Recording”，应打开 Control；
3. 打开 Studio 空状态，确认点击“Start Recording”仍打开 Control；
4. 确认 Studio 的 “Open Drive” 仍正常；
5. 截图留档。
