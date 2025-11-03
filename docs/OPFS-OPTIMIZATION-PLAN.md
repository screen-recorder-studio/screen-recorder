# OPFS录制系统优化计划

## 🎯 优化目标

1. 提高系统稳定性和可靠性
2. 优化内存使用和性能
3. 增强错误处理和恢复能力
4. 改进用户体验

---

## 🔴 高优先级问题

### 1. OPFS Writer内存管理优化

**问题描述：**
- Fallback模式下，`fallbackDataParts` 在内存中累积所有数据
- 只在finalize时一次性写入，可能导致内存溢出
- 长时间录制时风险更高

**优化方案：**

```typescript
// src/lib/workers/opfs-writer-worker.ts

const BATCH_SIZE = 10 * 1024 * 1024; // 10MB批次大小
let currentBatchSize = 0;

async function appendData(u8: Uint8Array) {
  if (dataSyncHandle) {
    // SyncAccessHandle路径：直接同步写入
    const written = dataSyncHandle.write(u8, { at: dataOffset });
    dataOffset += (typeof written === 'number' ? written : u8.byteLength);
  } else {
    // Fallback路径：分批写入
    fallbackDataParts.push(u8);
    currentBatchSize += u8.byteLength;
    
    // 达到批次大小时立即写入
    if (currentBatchSize >= BATCH_SIZE) {
      await flushDataFallback();
      currentBatchSize = 0;
    }
  }
}

async function flushDataFallback() {
  if (!dataHandle || fallbackDataParts.length === 0) return;
  
  const writable = await (dataHandle as any).createWritable({ keepExistingData: true });
  
  // 批量写入
  for (const part of fallbackDataParts) {
    await writable.write(part);
  }
  
  await writable.close();
  fallbackDataParts = [];
}
```

**预期效果：**
- 内存占用降低90%以上
- 支持更长时间的录制
- 避免OOM错误

---

### 2. iframe sink可靠性增强

**问题描述：**
- iframe sink创建失败时没有降级方案
- 页面导航时iframe可能失效
- 缺少重连机制

**优化方案：**

```typescript
// src/extensions/content.ts

let sinkReconnectAttempts = 0;
const MAX_SINK_RECONNECT = 3;
const SINK_RECONNECT_DELAY = 1000;

async function ensureSinkIframe(): Promise<Window | null> {
  // 检查现有sink是否仍然有效
  if (state.sinkWin) {
    try {
      state.sinkWin.postMessage({ type: 'ping' }, '*');
      return state.sinkWin;
    } catch (e) {
      console.warn('[Sink] Existing sink invalid, recreating...');
      state.sinkWin = null;
    }
  }

  // 重试创建
  while (sinkReconnectAttempts < MAX_SINK_RECONNECT) {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:1px; height:1px; opacity:0; border:0; z-index:2147483647;';
      iframe.src = chrome.runtime.getURL('opfs-writer.html?mode=iframe');
      document.documentElement.appendChild(iframe);
      
      await new Promise((r) => iframe.onload = r);
      const win = iframe.contentWindow;
      
      if (!win) throw new Error('iframe.contentWindow is null');
      
      // 握手确认
      const ok = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          window.removeEventListener('message', onMsg);
          resolve(false);
        }, 4000);
        
        function onMsg(ev: MessageEvent) {
          if (ev.source === win && ev.data?.type === 'sink-ready') {
            clearTimeout(timer);
            window.removeEventListener('message', onMsg);
            resolve(true);
          }
        }
        
        window.addEventListener('message', onMsg);
        win.postMessage({ type: 'ping' }, '*');
      });
      
      if (ok) {
        state.sinkWin = win;
        sinkReconnectAttempts = 0; // 重置计数
        console.log('[Sink] Created successfully');
        return win;
      }
      
      throw new Error('Sink handshake failed');
      
    } catch (e) {
      sinkReconnectAttempts++;
      console.warn(`[Sink] Creation failed (attempt ${sinkReconnectAttempts}/${MAX_SINK_RECONNECT}):`, e);
      
      if (sinkReconnectAttempts < MAX_SINK_RECONNECT) {
        await new Promise(r => setTimeout(r, SINK_RECONNECT_DELAY * sinkReconnectAttempts));
      }
    }
  }
  
  // 所有重试失败，降级到background转发
  console.error('[Sink] All reconnect attempts failed, falling back to background forwarding');
  return null;
}

// 降级到background转发的逻辑
function fallbackToBackgroundForwarding() {
  // 修改chunk处理逻辑，通过background转发
  state.worker.onmessage = (ev) => {
    const msg = ev.data || {};
    
    if (msg.type === 'chunk') {
      // 通过background转发到OPFS Writer
      try {
        chrome.runtime.sendMessage({
          type: 'FORWARD_CHUNK',
          data: msg.data,
          ts: msg.ts,
          kind: msg.kind
        });
      } catch (e) {
        console.error('[Fallback] Failed to forward chunk:', e);
      }
    }
    // ... 其他消息处理
  };
}
```

**预期效果：**
- 提高录制成功率
- 自动恢复连接
- 降级方案保证基本功能

---

### 3. 倒计时窗口清理机制

**问题描述：**
- 依赖 `COUNTDOWN_DONE` 消息，可能遗漏
- 窗口可能被用户手动关闭
- 缺少超时清理

**优化方案：**

```typescript
// src/extensions/background.ts

let countdownCleanupTimer: any = null;
const COUNTDOWN_TIMEOUT = 10000; // 10秒超时

async function ensureCountdownWindow(value: number, kind?: string, mode?: string) {
  // 清理旧的超时定时器
  if (countdownCleanupTimer) {
    clearTimeout(countdownCleanupTimer);
    countdownCleanupTimer = null;
  }
  
  // 清理现有窗口
  if (countdownWinId) {
    try {
      await chrome.windows.remove(countdownWinId);
      countdownWinId = null;
    } catch (e) {
      console.warn('[Countdown] Failed to remove existing window:', e);
    }
  }
  
  // 创建新窗口
  const popupWidth = 260;
  const popupHeight = (kind === 'area' || kind === 'element') ? 240 : 180;
  
  const current = await chrome.windows.getCurrent();
  let left: number | undefined, top: number | undefined;
  
  if (current && typeof current.left === 'number' && typeof current.top === 'number') {
    left = current.left + Math.max(0, Math.round(((current.width || popupWidth) - popupWidth) / 2));
    top = current.top + Math.max(0, Math.round(((current.height || popupHeight) - popupHeight) / 2));
  }
  
  chrome.windows.create({
    url: chrome.runtime.getURL('countdown.html?s=' + value),
    type: 'popup',
    width: popupWidth,
    height: popupHeight,
    left,
    top,
    focused: true
  }, win => {
    if (win && win.id != null) {
      countdownWinId = win.id;
      console.log('[Countdown] Window created:', { id: countdownWinId });
      
      // 设置超时清理
      countdownCleanupTimer = setTimeout(() => {
        console.warn('[Countdown] Timeout reached, force cleaning up');
        forceCleanupCountdown();
      }, COUNTDOWN_TIMEOUT);
    }
  });
}

function forceCleanupCountdown() {
  if (countdownCleanupTimer) {
    clearTimeout(countdownCleanupTimer);
    countdownCleanupTimer = null;
  }
  
  if (countdownWinId) {
    const id = countdownWinId;
    countdownWinId = null;
    
    chrome.windows.remove(id, () => {
      console.log('[Countdown] Force cleaned up window:', id);
      
      // 发送广播（即使没有收到COUNTDOWN_DONE）
      try {
        chrome.runtime.sendMessage({
          type: 'COUNTDOWN_DONE_BROADCAST',
          ts: Date.now(),
          forced: true
        });
      } catch (e) {
        console.warn('[Countdown] Failed to broadcast after force cleanup:', e);
      }
    });
  }
}

// 修改COUNTDOWN_DONE处理
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'COUNTDOWN_DONE') {
    // 清理超时定时器
    if (countdownCleanupTimer) {
      clearTimeout(countdownCleanupTimer);
      countdownCleanupTimer = null;
    }
    
    const doBroadcast = async () => {
      try {
        await restoreFocusToRecordingTarget();
        
        setTimeout(() => {
          try {
            chrome.runtime.sendMessage({
              type: 'COUNTDOWN_DONE_BROADCAST',
              ts: Date.now(),
              afterClose: true
            });
          } catch {}
        }, 140);
      } catch (e) {
        console.warn('[Countdown] Error in broadcast:', e);
      }
    };
    
    if (countdownWinId) {
      const id = countdownWinId;
      chrome.windows.remove(id, () => {
        countdownWinId = null;
        console.log('[Countdown] Window closed:', id);
        doBroadcast();
      });
    } else {
      console.warn('[Countdown] COUNTDOWN_DONE received but no window ID tracked');
      doBroadcast();
    }
  }
});
```

**预期效果：**
- 防止窗口泄漏
- 自动恢复异常情况
- 提高系统健壮性

---

### 4. 状态持久化

**问题描述：**
- 扩展重启后录制状态丢失
- 用户可能不知道录制是否在进行
- 无法恢复中断的录制

**优化方案：**

```typescript
// src/extensions/background.ts

interface PersistedRecordingState {
  isRecording: boolean;
  isPaused: boolean;
  mode: string;
  startTime: number;
  sessionId: string;
}

// 保存状态
async function persistRecordingState() {
  const state: PersistedRecordingState = {
    isRecording: currentRecording.isRecording,
    isPaused: currentRecording.isPaused,
    mode: recordingMode || 'unknown',
    startTime: currentRecording.startTime || Date.now(),
    sessionId: Date.now().toString()
  };
  
  try {
    await chrome.storage.local.set({ recordingState: state });
    console.log('[State] Persisted:', state);
  } catch (e) {
    console.warn('[State] Failed to persist:', e);
  }
}

// 恢复状态
async function restoreRecordingState() {
  try {
    const result = await chrome.storage.local.get(['recordingState']);
    const state = result.recordingState as PersistedRecordingState | undefined;
    
    if (state && state.isRecording) {
      console.log('[State] Restored:', state);
      
      // 检查录制是否仍在进行（通过时间判断）
      const elapsed = Date.now() - state.startTime;
      const MAX_RECORDING_TIME = 3600000; // 1小时
      
      if (elapsed < MAX_RECORDING_TIME) {
        // 恢复录制状态
        currentRecording.isRecording = state.isRecording;
        currentRecording.isPaused = state.isPaused;
        currentRecording.startTime = state.startTime;
        recordingMode = state.mode;
        
        // 恢复badge
        if (state.isRecording) {
          await startBadgeTimer();
        }
        
        return true;
      } else {
        console.warn('[State] Recording too old, clearing');
        await clearPersistedState();
      }
    }
  } catch (e) {
    console.warn('[State] Failed to restore:', e);
  }
  
  return false;
}

async function clearPersistedState() {
  try {
    await chrome.storage.local.remove(['recordingState']);
  } catch (e) {
    console.warn('[State] Failed to clear:', e);
  }
}

// 在关键点调用
chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup');
  await restoreRecordingState();
});

// 在录制状态变化时调用
async function startRecordingViaOffscreen(options) {
  // ... 现有逻辑
  await persistRecordingState();
}

async function stopRecordingViaOffscreen() {
  // ... 现有逻辑
  await clearPersistedState();
}
```

**预期效果：**
- 扩展重启后保持状态
- 用户体验更连贯
- 防止意外丢失录制

---

## 🟡 中优先级问题

### 5. WebCodecs Worker内存优化

**当前问题：**
- `chunks` 数组持续增长
- `stopEncoding` 时合并所有chunks

**优化方案：**

```typescript
// src/lib/workers/webcodecs-worker.ts

// 移除chunks数组，改为流式输出
let chunkCount = 0;
let totalBytes = 0;

function handleEncodedChunk(chunk: EncodedVideoChunk, metadata?: any) {
  try {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    
    chunkCount++;
    totalBytes += chunk.byteLength;
    
    // 直接发送，不保留
    self.postMessage({
      type: 'chunk',
      data: {
        data: data,
        size: chunk.byteLength,
        timestamp: chunk.timestamp,
        type: chunk.type,
        codedWidth: currentEncoderConfig?.width || 1920,
        codedHeight: currentEncoderConfig?.height || 1080,
        codec: (currentEncoderConfig as any)?.codec || 'auto'
      }
    });
    
  } catch (error) {
    console.error('❌ [WORKER] Chunk handling failed:', error);
    self.postMessage({
      type: 'error',
      data: (error as Error).message || 'Chunk handling failed'
    });
  }
}

async function stopEncoding() {
  try {
    if (encoder) {
      await encoder.flush();
      encoder.close();
      encoder = null;
    }

    // 只发送统计信息，不合并数据
    self.postMessage({
      type: 'complete',
      stats: {
        chunkCount,
        totalBytes
      }
    });

    console.log('✅ WebCodecs encoding completed', { chunkCount, totalBytes });
    
    // 重置计数
    chunkCount = 0;
    totalBytes = 0;

  } catch (error) {
    console.error('❌ [WORKER] Stop encoding failed:', error);
    self.postMessage({
      type: 'error',
      data: (error as Error).message || 'Stop encoding failed'
    });
  }
}
```

---

## 📊 性能监控

添加端到端性能追踪：

```typescript
// src/lib/utils/performance-monitor.ts

export class PerformanceMonitor {
  private marks: Map<string, number> = new Map();
  
  mark(name: string) {
    this.marks.set(name, performance.now());
    console.log(`[Perf] Mark: ${name}`);
  }
  
  measure(name: string, startMark: string, endMark?: string) {
    const start = this.marks.get(startMark);
    const end = endMark ? this.marks.get(endMark) : performance.now();
    
    if (start !== undefined && end !== undefined) {
      const duration = end - start;
      console.log(`[Perf] ${name}: ${duration.toFixed(2)}ms`);
      return duration;
    }
    
    return null;
  }
  
  clear() {
    this.marks.clear();
  }
}

// 使用示例
const monitor = new PerformanceMonitor();

// 在关键点添加标记
monitor.mark('recording-start');
// ... 录制逻辑
monitor.mark('recording-end');
monitor.measure('total-recording-time', 'recording-start', 'recording-end');
```

---

## ✅ 实施计划

### 第一阶段（1-2周）
- [ ] 实施OPFS Writer内存优化
- [ ] 增强iframe sink可靠性
- [ ] 添加倒计时窗口超时清理

### 第二阶段（2-3周）
- [ ] 实现状态持久化
- [ ] 优化WebCodecs Worker内存
- [ ] 添加性能监控

### 第三阶段（3-4周）
- [ ] 全面测试和调优
- [ ] 文档更新
- [ ] 用户反馈收集

---

## 📈 预期收益

1. **稳定性提升**：减少崩溃和错误率50%以上
2. **内存优化**：长时间录制内存占用降低70%
3. **用户体验**：录制成功率提升至95%以上
4. **可维护性**：代码更清晰，易于调试和扩展

