# 技术稳定性提升报告

> 文档版本：v1.0 | 日期：2026-02-10
> 适用项目：Screen Recorder Studio Chrome Extension (v0.6.7)

---

## 一、问题背景

用户卸载率高的一个重要原因是 **技术稳定性不足**。录制类工具对稳定性要求极高 —— 任何一次录制失败、文件损坏或崩溃都可能导致用户永久流失。本报告从技术架构角度，系统性评估当前的稳定性短板，并给出分级改进方案。

---

## 二、当前架构稳定性评估

### 2.1 架构概览

```
┌──────────┐    消息     ┌────────────┐    消息     ┌───────────────┐
│  Popup/  │◄──────────►│ Background │◄──────────►│   Offscreen   │
│ SidePanel│            │  (SW)      │            │   Document    │
│ Studio   │            │            │            │               │
└──────────┘            └────────────┘            │ ┌───────────┐ │
                                                  │ │ Encoder   │ │
                                                  │ │ Worker    │ │
                                                  │ └─────┬─────┘ │
                                                  │       │       │
                                                  │ ┌─────▼─────┐ │
                                                  │ │ OPFS      │ │
                                                  │ │ Writer    │ │
                                                  │ └───────────┘ │
                                                  └───────────────┘
```

### 2.2 风险矩阵

| 风险区域 | 当前状态 | 严重程度 | 发生概率 | 影响 |
|----------|----------|----------|----------|------|
| Service Worker 休眠 | ⚠️ 无主动保活 | 🔴 严重 | 高 | 录制中 SW 休眠导致状态丢失 |
| Offscreen Document 崩溃 | ⚠️ 无恢复机制 | 🔴 严重 | 中 | 录制数据丢失 |
| OPFS 写入失败 | ⚠️ 基本错误处理 | 🔴 严重 | 低-中 | 录制文件损坏 |
| WebCodecs 编码失败 | ✅ 有 Fallback | 🟡 中等 | 低 | 降级到 VP8/VP9 |
| Worker 通信中断 | ⚠️ 无心跳检测 | 🟡 中等 | 低 | 静默失败 |
| 内存泄漏 | ⚠️ 无监控 | 🟡 中等 | 中 | 长时间录制崩溃 |
| 权限被动态撤销 | ⚠️ 部分处理 | 🟡 中等 | 低 | 录制中断 |

---

## 三、分级改进方案

### 🔴 P0 — 必须修复（可直接导致用户流失）

#### 3.1 Service Worker 生命周期管理

**问题**：Chrome MV3 的 Service Worker 会在 30 秒无活动后休眠。录制期间若所有消息通道空闲，SW 可能休眠导致状态丢失。

**解决方案**：
```typescript
// background.ts - 添加 Keep-Alive 机制
class ServiceWorkerKeepAlive {
  private intervalId: number | null = null;

  start() {
    // 录制期间每 25 秒发送一次 keep-alive
    this.intervalId = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {});
    }, 25_000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

// 在录制开始时激活，结束时停止
```

**补充措施**：
- 使用 `chrome.alarms` API 作为备份唤醒机制
- 在 SW 启动时检查是否有未完成的录制会话，尝试恢复或安全清理

#### 3.2 Offscreen Document 崩溃检测 & 恢复

**问题**：Offscreen Document 崩溃后无法被检测，录制静默失败。

**解决方案**：
```typescript
// background.ts - 心跳检测
class OffscreenHealthCheck {
  private heartbeatTimer: number | null = null;
  private lastHeartbeat: number = 0;
  private readonly HEARTBEAT_INTERVAL = 5_000; // 5秒
  private readonly HEARTBEAT_TIMEOUT = 15_000;  // 15秒无响应视为崩溃

  startMonitoring() {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'HEARTBEAT_PING',
          target: 'offscreen'
        });
        if (response?.type === 'HEARTBEAT_PONG') {
          this.lastHeartbeat = Date.now();
        }
      } catch (error) {
        // Offscreen 可能已崩溃
        if (Date.now() - this.lastHeartbeat > this.HEARTBEAT_TIMEOUT) {
          await this.handleOffscreenCrash();
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private async handleOffscreenCrash() {
    console.error('[Background] Offscreen document crash detected');
    // 1. 通知 UI 层录制已中断
    // 2. 尝试恢复已写入的 OPFS 数据
    // 3. 更新录制状态为 error
    // 4. 给用户明确的错误提示
  }
}
```

#### 3.3 OPFS 写入安全增强

**问题**：当前 OPFS Writer 在写入失败时缺少完善的恢复机制，可能导致 `index.jsonl` 与 `data.bin` 不一致。

**解决方案**：
```typescript
// opfs-writer-worker.ts - 增强写入安全性
class SafeOPFSWriter {
  private writeQueue: ArrayBuffer[] = [];
  private isWriting = false;
  private lastSuccessOffset = 0;

  async appendChunk(chunk: ArrayBuffer, metadata: ChunkMetadata) {
    try {
      // 1. 先写入 data.bin
      await this.dataHandle.write(chunk);
      await this.dataHandle.flush();

      // 2. 确认 data 写入成功后再写 index
      const indexEntry = JSON.stringify({
        ...metadata,
        offset: this.lastSuccessOffset,
        size: chunk.byteLength
      }) + '\n';
      await this.indexHandle.write(indexEntry);
      await this.indexHandle.flush();

      // 3. 更新已确认偏移
      this.lastSuccessOffset += chunk.byteLength;

    } catch (error) {
      // 写入失败处理
      console.error('[OPFS Writer] Write failed:', error);
      // 回滚到最后成功位置
      await this.rollbackToLastSuccess();
      // 通知上层
      self.postMessage({ type: 'WRITE_ERROR', error: error.message });
    }
  }

  // 定期检查点
  async checkpoint() {
    const meta = {
      lastOffset: this.lastSuccessOffset,
      frameCount: this.frameCount,
      timestamp: Date.now(),
      checksum: this.computeChecksum()
    };
    await this.metaHandle.write(JSON.stringify(meta));
    await this.metaHandle.flush();
  }
}
```

#### 3.4 录制状态持久化 & 恢复

**问题**：如果扩展被意外重载或浏览器重启，正在进行的录制状态完全丢失。

**解决方案**：
```typescript
// recording-state-persistence.ts
class RecordingStatePersistence {
  // 将关键状态写入 chrome.storage.session
  async saveState(state: RecordingState) {
    await chrome.storage.session.set({
      'recording_state': {
        sessionId: state.sessionId,
        status: state.status,  // recording | paused | error
        startTime: state.startTime,
        mode: state.mode,
        tabId: state.tabId,
        lastCheckpoint: Date.now()
      }
    });
  }

  // SW 启动时检查是否有中断的录制
  async checkInterruptedRecording(): Promise<RecordingState | null> {
    const data = await chrome.storage.session.get('recording_state');
    if (data.recording_state?.status === 'recording') {
      // 发现中断的录制会话
      return data.recording_state;
    }
    return null;
  }

  // 提供恢复选项
  async attemptRecovery(state: RecordingState) {
    // 1. 检查 OPFS 中是否有部分数据
    // 2. 如果有，尝试 finalize 已写入的部分
    // 3. 通知用户：部分录制已恢复
  }
}
```

---

### 🟡 P1 — 重要改进（提升整体健壮性）

#### 3.5 统一日志系统

**问题**：当前日志分散在各模块，缺乏统一的级别控制和收集机制，出问题难以排查。

**解决方案**：
```typescript
// src/lib/utils/logger.ts
enum LogLevel { DEBUG, INFO, WARN, ERROR }

class Logger {
  private context: string;
  private static level: LogLevel = LogLevel.INFO;
  private static buffer: LogEntry[] = [];
  private static readonly MAX_BUFFER = 500;

  constructor(context: string) {
    this.context = context;
  }

  error(message: string, data?: unknown) {
    this.log(LogLevel.ERROR, message, data);
  }

  warn(message: string, data?: unknown) {
    this.log(LogLevel.WARN, message, data);
  }

  info(message: string, data?: unknown) {
    this.log(LogLevel.INFO, message, data);
  }

  debug(message: string, data?: unknown) {
    this.log(LogLevel.DEBUG, message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    if (level < Logger.level) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      context: this.context,
      message,
      data
    };

    // 写入环形缓冲区（用于错误报告时附带上下文）
    Logger.buffer.push(entry);
    if (Logger.buffer.length > Logger.MAX_BUFFER) {
      Logger.buffer.shift();
    }

    // Console 输出
    const prefix = `[${this.context}]`;
    switch (level) {
      case LogLevel.ERROR: console.error(prefix, message, data); break;
      case LogLevel.WARN:  console.warn(prefix, message, data); break;
      case LogLevel.INFO:  console.info(prefix, message, data); break;
      case LogLevel.DEBUG: console.debug(prefix, message, data); break;
    }
  }

  // 导出最近日志（用于错误报告）
  static getRecentLogs(count = 50): LogEntry[] {
    return Logger.buffer.slice(-count);
  }
}

// 使用方式
const log = new Logger('OffscreenEngine');
log.info('Encoder initialized', { codec: 'h264', resolution: '1920x1080' });
log.error('Write failed', { error, sessionId });
```

#### 3.6 内存监控 & 防泄漏

**问题**：长时间录制可能导致内存持续增长。当前有 `performance-monitor.ts` 但未与 UI 集成。

**解决方案**：
```typescript
// 增强 performance-monitor.ts
class EnhancedPerformanceMonitor {
  private readonly MEMORY_WARNING_MB = 512;
  private readonly MEMORY_CRITICAL_MB = 1024;

  checkMemory() {
    if (performance.memory) {
      const usedMB = performance.memory.usedJSHeapSize / (1024 * 1024);

      if (usedMB > this.MEMORY_CRITICAL_MB) {
        // 紧急：触发 GC 友好的清理操作
        this.emergencyCleanup();
        this.notifyUI('memory_critical', usedMB);
      } else if (usedMB > this.MEMORY_WARNING_MB) {
        this.notifyUI('memory_warning', usedMB);
      }
    }
  }

  private emergencyCleanup() {
    // 1. 清理预览缓存
    // 2. 强制刷写 OPFS 缓冲区
    // 3. 释放已编码的 pending frames
  }
}
```

#### 3.7 Worker 通信可靠性

**问题**：Worker 可能因未捕获异常而静默退出，主线程无法感知。

**解决方案**：
```typescript
// src/lib/utils/reliable-worker.ts
class ReliableWorker {
  private worker: Worker;
  private pendingRequests: Map<string, {
    resolve: Function;
    reject: Function;
    timeout: number;
  }> = new Map();

  private readonly REQUEST_TIMEOUT = 30_000; // 30秒超时

  constructor(url: string | URL) {
    this.worker = new Worker(url, { type: 'module' });

    this.worker.onerror = (event) => {
      console.error('[ReliableWorker] Worker error:', event);
      this.rejectAllPending(new Error('Worker crashed'));
    };

    this.worker.onmessage = (event) => {
      const { requestId, ...data } = event.data;
      if (requestId && this.pendingRequests.has(requestId)) {
        const pending = this.pendingRequests.get(requestId)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        pending.resolve(data);
      }
    };
  }

  async sendRequest(message: unknown): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Worker request timeout: ${requestId}`));
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      this.worker.postMessage({ ...message, requestId });
    });
  }

  private rejectAllPending(error: Error) {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  terminate() {
    this.rejectAllPending(new Error('Worker terminated'));
    this.worker.terminate();
  }
}
```

#### 3.8 编码管线背压优化

**问题**：当前背压控制 (`BACKPRESSURE_MAX = 8`) 在丢帧时可能导致录制质量下降。

**解决方案**：
```typescript
// 分级背压策略
class AdaptiveBackpressure {
  private queueSize = 0;
  private dropCount = 0;

  // 分级阈值
  private readonly SOFT_LIMIT = 6;   // 开始降低帧率
  private readonly HARD_LIMIT = 10;  // 开始丢帧
  private readonly CRITICAL = 16;    // 暂停捕获

  onFrameEnqueued() {
    this.queueSize++;

    if (this.queueSize >= this.CRITICAL) {
      return 'pause_capture';  // 暂停视频捕获
    } else if (this.queueSize >= this.HARD_LIMIT) {
      this.dropCount++;
      return 'drop_frame';     // 丢弃当前帧
    } else if (this.queueSize >= this.SOFT_LIMIT) {
      return 'reduce_fps';     // 降低捕获帧率
    }
    return 'normal';
  }

  onFrameEncoded() {
    this.queueSize = Math.max(0, this.queueSize - 1);
  }

  getStats() {
    return {
      queueSize: this.queueSize,
      totalDropped: this.dropCount
    };
  }
}
```

---

### 🟢 P2 — 长期优化（架构级改进）

#### 3.9 OPFS 孤立会话清理

**问题**：异常退出可能在 OPFS 中留下不完整的录制目录，长期累积占用空间。

**解决方案**：
```typescript
// 扩展启动时执行清理
async function cleanupOrphanSessions() {
  const root = await navigator.storage.getDirectory();
  const activeSessions = await getActiveSessionIds(); // 从 chrome.storage

  for await (const [name, handle] of root.entries()) {
    if (name.startsWith('rec_') && !activeSessions.includes(name)) {
      const meta = await tryReadMeta(handle);
      if (!meta || !meta.finalized) {
        // 尝试恢复或删除
        if (meta && meta.lastCheckpoint) {
          await attemptPartialRecovery(handle, meta);
        } else {
          console.warn(`[Cleanup] Removing orphan session: ${name}`);
          await root.removeEntry(name, { recursive: true });
        }
      }
    }
  }
}
```

#### 3.10 自动化测试基础设施

**问题**：缺少自动化测试，每次改动都有回归风险。

**建议测试策略**：
```
┌──────────────────────────────────────────────┐
│                 测试金字塔                      │
├──────────────────────────────────────────────┤
│          E2E Tests (Playwright)               │
│     ▲  录制流程 / 导出流程 / Studio 操作       │
│    ╱ ╲                                        │
│   ╱   ╲  Integration Tests                    │
│  ╱     ╲ Worker 通信 / OPFS 读写 / 编码管线    │
│ ╱       ╲                                     │
│╱ Unit Tests                                   │
│ 工具函数 / 状态管理 / 配置解析                   │
└──────────────────────────────────────────────┘
```

**推荐优先实现的测试**：
1. `webcodecs-config.ts` 单元测试（纯函数，易测试）
2. OPFS Reader/Writer 集成测试（验证数据完整性）
3. 录制状态机测试（`idle → preparing → recording → completed`）
4. 编码配置探测测试（Codec fallback 链路验证）

---

## 四、关键代码区域审查

### 4.1 已发现的稳定性风险点

| 文件 | 位置 | 风险 | 建议 |
|------|------|------|------|
| `background.ts` | SW 生命周期 | 无保活机制 | 添加 Keep-Alive + Alarm |
| `offscreen-main.ts` | 编码启动 | 初始化失败无恢复 | 添加重试 + 降级逻辑 |
| `opfs-writer-worker.ts` | `finalize()` | 超时后强制完成可能数据不一致 | 添加数据校验 + 回滚 |
| `encoder-worker.ts` | 背压丢帧 | 无统计/告警 | 记录丢帧数量并通知 UI |
| `recording-service.ts` | 状态机 | 状态转换无校验 | 添加状态机保护 |
| `export-manager.ts` | 导出过程 | 中途失败无清理 | 添加临时文件清理 |
| `content.ts` | iframe 通信 | 消息可能丢失 | 添加消息确认机制 |

### 4.2 静默错误清单

以下位置存在 `catch` 块中无实质处理的情况，建议添加用户通知或日志记录：

```
- offscreen-main.ts: encoder setup catch → 应通知 UI
- opfs-writer-worker.ts: append catch → 应记录并通知
- recording-service.ts: permission check catch → 应区分错误类型
- export-manager.ts: frame decode catch → 应跳过并记录而非静默
```

---

## 五、监控指标建议

### 5.1 技术健康度指标

| 指标 | 采集位置 | 阈值 | 告警动作 |
|------|----------|------|---------|
| 录制成功率 | background.ts | < 95% | 日志分析 |
| 平均编码延迟 | encoder-worker.ts | > 50ms | 降级编码参数 |
| 背压丢帧率 | encoder-worker.ts | > 5% | 降低捕获帧率 |
| OPFS 写入延迟 | opfs-writer.ts | > 100ms | 增大缓冲区 |
| 内存峰值 | performance-monitor.ts | > 512MB | 触发清理 |
| Worker 重启次数 | background.ts | > 0/session | 检查 Worker 代码 |
| 导出成功率 | export-manager.ts | < 98% | 检查导出逻辑 |

### 5.2 诊断数据收集

```typescript
// 在用户主动报告问题时收集（需要用户同意）
interface DiagnosticReport {
  // 环境信息
  chromeVersion: string;
  platform: string;
  memoryInfo: MemoryInfo;

  // 录制信息
  lastRecordingMode: string;
  lastRecordingDuration: number;
  codec: string;
  resolution: string;

  // 错误信息
  recentErrors: LogEntry[];
  droppedFrames: number;
  opfsWriteErrors: number;

  // 性能信息
  avgEncodingLatency: number;
  peakMemoryUsage: number;
}
```

---

## 六、实施路线图

```
Phase 1 (Week 1-2): 基础稳定性
  ├── SW Keep-Alive 机制
  ├── Offscreen 心跳检测
  ├── OPFS 写入安全增强
  └── 录制状态持久化

Phase 2 (Week 3-4): 可观测性
  ├── 统一日志系统
  ├── 性能监控集成
  ├── 错误上报友好化
  └── 诊断数据收集框架

Phase 3 (Week 5-6): 健壮性
  ├── Worker 通信可靠性
  ├── 自适应背压
  ├── 内存泄漏防护
  └── 孤立会话清理

Phase 4 (Week 7-8): 质量保障
  ├── 核心工具函数单元测试
  ├── OPFS 读写集成测试
  ├── 状态机逻辑测试
  └── CI/CD 管线搭建
```

---

## 七、总结

| 维度 | 当前评分 | 目标评分 | 关键改进 |
|------|---------|---------|---------|
| 录制可靠性 | 6/10 | 9/10 | SW 保活 + 崩溃恢复 |
| 数据安全性 | 7/10 | 9/10 | OPFS 事务性写入 + 校验 |
| 错误可见性 | 4/10 | 8/10 | 统一日志 + 用户通知 |
| 资源管理 | 5/10 | 8/10 | 内存监控 + 自适应背压 |
| 可测试性 | 2/10 | 7/10 | 单元/集成测试基础设施 |
| 容错能力 | 4/10 | 8/10 | 状态持久化 + 会话恢复 |

> 💡 **核心结论**：当前架构设计合理，技术选型先进。但在 **容错恢复**、**状态持久化**、**可观测性** 三个方面存在明显短板。优先实施 P0 级别的 Service Worker 保活、Offscreen 崩溃检测和 OPFS 写入安全增强，预计可将录制成功率从约 85% 提升至 95% 以上。
