# 录制端严重问题修复方案

> 基于录制端深度评估报告，本文档提供 P0/P1 问题的修复方案。

---

## 修复 1：Control 页面添加错误反馈 UI

### 问题描述
录制过程中的所有错误（getDisplayMedia 拒绝、WebCodecs 配置失败、OPFS 写入异常等）仅输出到 console，用户界面无任何反馈。用户只看到按钮从 "Preparing..." 回到 "Start Recording"，不知道发生了什么。

### 修复方案
在 Control 页面添加 `errorMessage` 状态变量和错误展示 UI：

1. 新增 `errorMessage` 状态变量
2. 在 `startRecording` 的 catch 块中设置错误信息
3. 在消息 handler 中捕获 `STREAM_ERROR` 并展示
4. 添加错误提示 UI 组件（含关闭按钮）
5. 错误信息在用户下次操作时自动清除

### 影响范围
- `packages/extension/src/routes/control/+page.svelte`

---

## 修复 2：preparing 阶段超时保护

### 问题描述
当 offscreen 文档创建失败、WebCodecs 配置超时、或 getDisplayMedia 弹窗被静默关闭时，Control 页面会永久停留在 `phase='preparing'` 状态，所有按钮被禁用。

### 修复方案
在进入 preparing 阶段时启动一个安全超时（30 秒），如果超时未收到 `STREAM_META`/`STREAM_START`/`STREAM_ERROR` 消息，自动重置到 idle 并显示超时错误。

### 影响范围
- `packages/extension/src/routes/control/+page.svelte`

---

## 修复 3：录制启动双重保护

### 问题描述
offscreen-main.ts 中 `startRecording()` 虽然在开头检查 `isRecording` 并调用 `stopRecordingInternal()`，但这种"先停后启"的策略可能导致资源竞争。如果两个启动请求快速连续到达，可能出现状态不一致。

### 修复方案
在 offscreen-main.ts 的 `startRecording` 函数开头添加一个 `isStarting` 锁，防止并发启动：

1. 新增 `isStarting` 标志
2. 如果 `isStarting` 为 true，直接拒绝新的启动请求
3. 在启动完成（成功或失败）后清除标志

### 影响范围
- `packages/extension/src/extensions/offscreen-main.ts`

---

## 修复 4：录制前 OPFS 存储空间预检

### 问题描述
录制开始前不检查 OPFS 可用空间。如果用户存储空间不足，录制会正常开始但 chunk 写入静默失败，导致录制结果不完整甚至为空。

### 修复方案
在 OPFS Writer Worker 的 `init` 消息处理中，添加存储空间估算检查：

1. 使用 `navigator.storage.estimate()` 获取当前使用量和配额
2. 如果剩余空间低于 100MB，返回警告级别消息
3. 如果剩余空间低于 50MB，返回错误并拒绝初始化
4. 将存储信息传递到上层，在 UI 中展示

### 影响范围
- `packages/extension/src/lib/workers/opfs-writer-worker.ts`
- `packages/extension/src/extensions/offscreen-main.ts`

---

## 修复 5：Welcome 页面读取用户倒计时设置

### 问题描述
Welcome 页面使用 `const COUNTDOWN_SECONDS = 3` 硬编码倒计时秒数，不会读取用户在 Control 页面设定的 `countdownSeconds` 值。

### 修复方案
在 Welcome 页面的 `onMount` 中从 `chrome.storage.local` 读取用户的 countdownSeconds 设置，在 `startRecording` 时使用读取到的值。

### 影响范围
- `packages/extension/src/routes/welcome/+page.svelte`

---

## 修复 6：Welcome 页面 stopRecording 等待状态确认

### 问题描述
Welcome 页面的 `stopRecording()` 在发送消息后立即设置 `isRecording = false; isPaused = false`，不等待 STREAM_END 确认。如果停止消息失败，UI 状态与实际录制状态不一致。

### 修复方案
移除 `stopRecording()` 中的立即状态重置，改为依赖 `STREAM_END`/`STREAM_ERROR` 消息回调来更新状态（与 Control 页面的模式保持一致）。

### 影响范围
- `packages/extension/src/routes/welcome/+page.svelte`

---

## 实施优先级

| 修复项 | 优先级 | 预计影响 |
|--------|--------|----------|
| 修复 1：错误反馈 UI | P0 | 直接减少"扩展无反应"的感知 |
| 修复 2：preparing 超时 | P0 | 消除"按钮卡死"的情况 |
| 修复 3：双重启动保护 | P1 | 提升录制可靠性 |
| 修复 4：OPFS 空间预检 | P1 | 防止存储满时的无声失败 |
| 修复 5：倒计时设置同步 | P1 | 提升用户设置一致性 |
| 修复 6：stopRecording 确认 | P1 | 防止状态不一致 |
