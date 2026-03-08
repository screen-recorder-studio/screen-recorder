# 录制端深度评估报告

> 评估时间：2026-03-06  
> 评估范围：视频录制扩展录制端（Control 弹窗录制、Welcome 页面录制、Web 版录制）  
> 评估目标：识别导致用户卸载率高的录制体验和技术问题

---

## 一、总体评估摘要

录制端采用 **WebCodecs + OPFS** 架构，设计思路先进，但在用户体验和可靠性方面存在多个严重问题。核心问题在于：**错误处理对用户不透明**、**录制启动流程过于复杂**、**关键路径缺乏保护机制**。这些问题直接导致用户在首次使用时遇到"无反应"、"卡住"等体验，进而卸载扩展。

---

## 二、三个录制入口评估

### 2.1 Control 弹窗录制（主要入口）

**文件**: `packages/extension/src/routes/control/+page.svelte`

#### UX 评估

| 项目 | 评分 | 说明 |
|------|------|------|
| 启动便捷性 | ⭐⭐⭐⭐ | 点击扩展图标一步弹出，位置居中 |
| 模式选择 | ⭐⭐⭐⭐ | Tab/Window/Screen 三选一，图标直观 |
| 录制反馈 | ⭐⭐ | 录制中状态展示有限，无时长显示 |
| 错误反馈 | ⭐ | **严重缺陷：所有错误静默处理，用户无感知** |
| 倒计时体验 | ⭐⭐⭐ | 倒计时全屏遮罩，有音效提示 |
| 暂停/恢复 | ⭐⭐⭐⭐ | 按钮文案切换清晰 |

#### 核心问题

1. **错误反馈完全缺失**：`startRecording()` 的 catch 块仅 `console.error`，用户在 getDisplayMedia 被拒绝、offscreen 文档创建失败等情况下，看到的只是按钮从 "Preparing..." 恢复为 "Start Recording"，没有任何错误提示。

2. **preparing 阶段无超时保护**：如果 offscreen 文档创建失败或 WebCodecs Worker 配置超时，control 页面会永久停留在 `phase='preparing'` 状态，按钮被禁用，用户只能关闭窗口。

3. **isLoading 状态未在所有错误路径重置**：`startRecording()` 虽然有 `finally { isLoading = false }`，但 `STREAM_ERROR` 消息处理中虽设置了 `isLoading = false`，可如果消息未到达（Service Worker 重启），isLoading 将保持 true。

### 2.2 Welcome 页面录制（首次使用入口）

**文件**: `packages/extension/src/routes/welcome/+page.svelte`

#### UX 评估

| 项目 | 评分 | 说明 |
|------|------|------|
| 首次引导 | ⭐⭐⭐⭐ | 安装后直接展示，引导清晰 |
| 录制流程 | ⭐⭐⭐ | 与 Control 页面一致 |
| 错误反馈 | ⭐ | 同样缺少错误 UI |
| 倒计时设置 | ⭐⭐ | **硬编码 3 秒，忽略用户自定义设置** |
| 跳过倒计时 | ⭐⭐⭐⭐⭐ | 有 Skip 按钮，体验好 |

#### 核心问题

1. **倒计时硬编码**：使用 `const COUNTDOWN_SECONDS = 3` 常量，不读取用户在 Control 页面设置的 countdownSeconds 值。虽然 background 层会从 storage 读取，但如果 payload 已携带 countdown=3，background 不再覆盖。

2. **与 Control 页面代码大量重复**：录制逻辑（状态管理、消息监听、倒计时）与 Control 页面几乎完全重复，维护成本高。

3. **stopRecording 立即设置 isRecording=false**：不等待 `STREAM_END` 消息确认，可能导致状态不一致。

### 2.3 Web 版录制

**文件**: `packages/extension/src/routes/web-record/+page.svelte`

#### UX 评估

| 项目 | 评分 | 说明 |
|------|------|------|
| 独立性 | ⭐⭐⭐⭐⭐ | 不依赖扩展 Background，纯 Web API |
| 错误反馈 | ⭐⭐⭐⭐ | 有独立的 error 状态和 UI 展示 |
| API 检测 | ⭐⭐⭐⭐⭐ | 完善的安全上下文、API 兼容性检查 |
| 资源清理 | ⭐⭐⭐ | 有 onDestroy 清理，但部分路径可能遗漏 |

#### 核心问题

1. **Worker 路径依赖 import.meta.url**：`new URL('$lib/workers/...', import.meta.url)` 的路径解析可能在生产构建中出问题。

2. **无倒计时功能**：不像扩展版有倒计时准备，点击即开始录制。

---

## 三、录制到 OPFS 端到端评估

### 3.1 数据流图

```
用户点击 Start → Control Page
    ↓ REQUEST_START_RECORDING
Background Service Worker
    ↓ ensureOffscreenDocument（无超时）
    ↓ OFFSCREEN_START_RECORDING
Offscreen Document
    ↓ getDisplayMedia（用户授权弹窗）
    ↓ MediaStreamTrackProcessor → VideoFrame Reader
    ↓ WebCodecs Worker（configure → encode → chunk）
    ↓ 每个 chunk → OPFS Writer Worker（append）
    ↓ data.bin + index.jsonl
    ↓ STREAM_META → countdown → COUNTDOWN_DONE
    ↓ STREAM_START → 正式录制
    ↓ ...
    ↓ STOP → WebCodecs flush → OPFS finalize → meta.json
    ↓ OPFS_RECORDING_READY
Background → 关闭 Control 窗口，打开 Studio
```

### 3.2 关键节点评估

| 节点 | 风险等级 | 问题描述 |
|------|----------|----------|
| ensureOffscreenDocument | 🔴 高 | 无超时保护，可能无限等待 |
| getDisplayMedia | ⚠️ 中 | NotAllowedError（用户拒绝）处理正确，但上层未转为用户可见错误 |
| WebCodecs Worker configure | ⚠️ 中 | 配置失败会发送 STREAM_ERROR，但 Control 页面无错误 UI |
| OPFS Writer init | ⚠️ 中 | OPFS 不可用时无降级方案 |
| Frame encoding loop | 🔴 高 | 无帧率/内存监控，长时间录制可能导致性能下降 |
| OPFS append | ⚠️ 中 | 静默跳过失败的 chunk，录制结果可能损坏 |
| Countdown 同步门控 | ⚠️ 中 | 依赖 COUNTDOWN_DONE_BROADCAST 消息，有动态超时回退 |
| finalize（OPFS 收尾） | 🔴 高 | 仅 1500ms 超时，大文件可能不够 |
| OPFS_RECORDING_READY | ⚠️ 中 | 600ms 延迟处理可能在高负载下不够 |

### 3.3 消息可靠性评估

录制流程依赖 **chrome.runtime.sendMessage** 消息传递，存在以下风险：

1. **Service Worker 重启**：Chrome 可能在录制过程中休眠/重启 Service Worker，导致 `currentRecording` 状态丢失。Badge 定时器停止，Control 页面失去状态同步。

2. **消息丢失**：`sendMessage` 无重试机制。如果接收方 listener 未注册（时序问题），消息会被静默丢弃。

3. **sendResponse 超时**：Chrome 规定 sendResponse 必须在同步或明确返回 true 后调用。部分异步路径可能在 sendResponse 失效后才调用。

### 3.4 OPFS 存储评估

| 项目 | 状态 | 说明 |
|------|------|------|
| 存储结构 | ✅ 良好 | rec_{id}/data.bin + index.jsonl + meta.json |
| SyncAccessHandle | ✅ 优秀 | 同步写入性能高，有异步回退 |
| 时间戳精度 | ✅ 微秒级 | 使用 WebCodecs 原始时间戳 |
| 关键帧标记 | ✅ 正确 | isKeyframe 标记在 index 中持久化 |
| 存储空间检查 | ❌ 缺失 | **录制前不检查可用空间** |
| 写入错误处理 | ⚠️ 不足 | 静默跳过失败 chunk |
| 数据完整性 | ⚠️ 风险 | 异常终止时 meta.json 未标记 completed |

---

## 四、严重问题汇总

### 🔴 P0（紧急/直接影响卸载率）

| # | 问题 | 影响 | 位置 |
|---|------|------|------|
| 1 | Control 页面录制失败无任何错误反馈 | 用户认为扩展坏了 | control/+page.svelte |
| 2 | preparing 阶段无超时，可能永久卡死 | 用户被迫关闭窗口 | control/+page.svelte |
| 3 | ensureOffscreenDocument 无超时保护 | 录制启动可能无限等待 | background.ts |
| 4 | 录制前不检查 OPFS 存储空间 | 录制过程中存储满导致数据丢失 | offscreen-main.ts |

### 🟠 P1（高优先级）

| # | 问题 | 影响 | 位置 |
|---|------|------|------|
| 5 | Welcome 页面倒计时硬编码 3 秒 | 不尊重用户设置 | welcome/+page.svelte |
| 6 | 无双重录制启动保护 | 并发启动可能导致资源冲突 | offscreen-main.ts |
| 7 | OPFS finalize 超时仅 1500ms | 大文件可能写入不完整 | offscreen-main.ts |
| 8 | Welcome 页面 stopRecording 不等待确认 | 状态可能不一致 | welcome/+page.svelte |

### 🟡 P2（改进项）

| # | 问题 | 影响 | 位置 |
|---|------|------|------|
| 9 | Control 和 Welcome 录制逻辑大量重复 | 维护成本高 | 两个 page.svelte |
| 10 | OPFS chunk 写入失败静默跳过 | 录制结果可能不完整 | opfs-writer-worker.ts |
| 11 | Service Worker 重启后状态丢失 | 录制中 badge 停止更新 | background.ts |

---

## 五、评估结论

当前录制端的**架构设计优秀**（WebCodecs + OPFS + Offscreen 三层分离），但**用户体验层面存在严重缺陷**。最核心的问题是：**用户在录制失败时完全无法得到任何反馈**。这对于一个"点击即用"的工具类扩展来说，是用户卸载的首要原因。

建议优先修复 P0 问题，尤其是错误反馈机制和超时保护，可以立即改善用户体验并降低卸载率。
