# ✅ 视频预览功能完整实现报告

## 📅 完成日期
2025-10-05

## 🎯 功能概述

成功实现了专业视频编辑器级别的**鼠标悬停预览**功能，包括：

1. ✅ **鼠标悬停预览帧**：在时间线上移动鼠标时，实时显示对应的视频帧
2. ✅ **灰色预览竖线**：明确指示当前预览位置
3. ✅ **蓝色播放头固定**：预览期间播放头保持在原位置不动
4. ✅ **鼠标移出恢复**：自动恢复到原播放位置和播放状态
5. ✅ **Zoom 区间管理**：支持创建、显示、删除 Zoom 区间，不允许重叠

---

## 📁 文件变更清单

### **新增文件**

#### 1. `src/lib/stores/video-zoom.svelte.ts` (140 行)
**功能**: Zoom 状态管理 Store

**核心方法**:
- `addInterval(startMs, endMs)`: 添加区间（带重叠检测）
- `removeInterval(index)`: 删除指定区间
- `clearAll()`: 清除所有区间
- `getZoomConfig()`: 获取配置对象
- `isInZoomInterval(timeMs)`: 判断时间是否在区间内

---

### **修改文件**

#### 2. `src/lib/components/Timeline.svelte` (~200 行变更)

**Props 扩展**:
```typescript
interface Props {
  // 🆕 Zoom 区间列表
  zoomIntervals?: Array<{ startMs: number; endMs: number }>
  
  // 🆕 回调函数
  onZoomChange?: (startMs: number, endMs: number) => boolean
  onZoomRemove?: (index: number) => void
  onHoverPreview?: (timeMs: number) => void
  onHoverPreviewEnd?: () => void
}
```

**核心功能**:
- ✅ 鼠标移动处理：`handleTimelineMouseMove()`
- ✅ 鼠标离开处理：`handleTimelineMouseLeave()`
- ✅ Zoom 区间创建：支持重叠检测
- ✅ 预览竖线 UI：灰色渐变，带时间提示
- ✅ Zoom 区间可视化：蓝色色块，支持删除

---

#### 3. `src/lib/workers/composite-worker/index.ts` (~28 行新增)

**新增消息类型**: `preview-frame`

```typescript
case 'preview-frame':
  // 🆕 预览帧请求（不改变播放状态）
  const previewFrameIndex = Math.max(0, Math.min(data.frameIndex, decodedFrames.length - 1));
  
  if (previewFrameIndex < decodedFrames.length && currentConfig && fixedVideoLayout) {
    const frame = decodedFrames[previewFrameIndex];
    const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig);
    
    if (bitmap) {
      self.postMessage({
        type: 'preview-frame',
        data: { bitmap, frameIndex: previewFrameIndex }
      }, { transfer: [bitmap] });
    }
  }
  break;
```

**关键特性**:
- ✅ **不修改** `currentFrameIndex`（播放位置保持不变）
- ✅ 独立的消息类型，与 `seek` 分离
- ✅ 复用现有的渲染逻辑

---

#### 4. `src/lib/components/VideoPreviewComposite.svelte` (~150 行变更)

**状态添加**:
```typescript
// 🆕 预览相关状态
let isPreviewMode = $state(false)
let previewTimeMs = $state(0)
let previewFrameIndex = $state<number | null>(null)
let savedPlaybackState = $state<{ frameIndex: number; isPlaying: boolean } | null>(null)
let hoverPreviewThrottleTimer: number | null = null
const HOVER_PREVIEW_THROTTLE_MS = 50
```

**核心修改**:

##### **A. `currentTimeMs` 计算优化** (行 1084-1092)
```typescript
const currentTimeMs = $derived.by(() => {
  // 🔧 预览模式下，显示保存的播放位置（蓝色播放头不动）
  if (isPreviewMode && savedPlaybackState) {
    return Math.floor((savedPlaybackState.frameIndex) / frameRate * 1000)
  }
  // 正常模式，显示当前播放位置
  return Math.floor((windowStartIndex + currentFrameIndex) / frameRate * 1000)
})
```

##### **B. Worker 消息处理** (行 378-392)
```typescript
case 'preview-frame':
  if (data.bitmap) {
    displayFrame(data.bitmap)
    previewFrameIndex = data.frameIndex
  }
  break
```

##### **C. 预览处理函数** (行 1437-1493)
```typescript
function handleHoverPreview(timeMs: number) {
  // 节流控制
  if (hoverPreviewThrottleTimer) return
  
  // 进入预览模式
  if (!isPreviewMode) {
    isPreviewMode = true
    savedPlaybackState = {
      frameIndex: windowStartIndex + currentFrameIndex,
      isPlaying: isPlaying
    }
    if (isPlaying) pause()
  }
  
  // 计算预览帧索引
  const globalFrameIndex = Math.floor((timeMs / 1000) * frameRate)
  const windowFrameIndex = globalFrameIndex - windowStartIndex
  
  // 请求预览帧
  compositeWorker?.postMessage({
    type: 'preview-frame',
    data: { frameIndex: windowFrameIndex }
  })
}
```

##### **D. 预览结束处理** (行 1495-1542)
```typescript
function handleHoverPreviewEnd() {
  if (!isPreviewMode) return
  
  isPreviewMode = false
  previewFrameIndex = null
  
  if (savedPlaybackState) {
    const savedGlobalFrameIndex = savedPlaybackState.frameIndex
    const savedWindowFrameIndex = savedGlobalFrameIndex - windowStartIndex
    
    // 恢复到保存的帧位置
    if (savedWindowFrameIndex >= 0 && savedWindowFrameIndex < totalFrames) {
      compositeWorker?.postMessage({
        type: 'seek',
        data: { frameIndex: savedWindowFrameIndex }
      })
      currentFrameIndex = savedWindowFrameIndex
    } else {
      seekToGlobalFrame(savedGlobalFrameIndex)
    }
    
    // 恢复播放状态
    if (savedPlaybackState.isPlaying) {
      requestAnimationFrame(() => play())
    }
    
    savedPlaybackState = null
  }
}
```

##### **E. Zoom 区间管理** (行 1520-1560)
```typescript
function handleZoomChange(startMs: number, endMs: number): boolean {
  if (startMs === 0 && endMs === 0) {
    videoZoomStore.clearAll()
    updateBackgroundConfig(backgroundConfig)
    return true
  }
  const success = videoZoomStore.addInterval(startMs, endMs)
  if (success) updateBackgroundConfig(backgroundConfig)
  return success
}

function handleZoomRemove(index: number) {
  videoZoomStore.removeInterval(index)
  updateBackgroundConfig(backgroundConfig)
}
```

##### **F. 时间显示修复** (行 1762)
```typescript
<!-- 使用 currentTimeMs 而非重新计算 -->
{formatTimeSec(currentTimeMs / 1000)} / {formatTimeSec(uiDurationSec)}
```

##### **G. 播放控制优化** (行 982-1000)
```typescript
function play() {
  // 🔧 如果在预览模式，退出预览
  if (isPreviewMode) {
    isPreviewMode = false
    savedPlaybackState = null
  }
  // ... 原有逻辑
}
```

---

## 🎨 用户交互流程

### **预览功能完整流程**

```
1. 用户在 Timeline 上移动鼠标
   ↓
2. Timeline.handleTimelineMouseMove()
   - 计算鼠标位置对应的时间
   - 触发 onHoverPreview(timeMs)
   ↓
3. VideoPreviewComposite.handleHoverPreview()
   - 首次进入：保存当前状态，暂停播放
   - 计算预览帧索引（全局 → 窗口内）
   - 发送 preview-frame 消息到 worker
   ↓
4. Worker 处理 preview-frame
   - 渲染预览帧（不改变 currentFrameIndex）
   - 返回 preview-frame 消息
   ↓
5. VideoPreviewComposite 接收预览帧
   - 显示预览帧
   - currentTimeMs 保持不变（显示保存的位置）
   - 蓝色播放头保持不动
   - 灰色预览线跟随鼠标
   ↓
6. 用户移出 Timeline
   ↓
7. Timeline.handleTimelineMouseLeave()
   - 触发 onHoverPreviewEnd()
   ↓
8. VideoPreviewComposite.handleHoverPreviewEnd()
   - 计算保存的窗口内帧索引
   - 发送 seek 消息恢复到保存的帧
   - 更新 currentFrameIndex
   - 恢复播放状态（如果之前在播放）
   - currentTimeMs 自动恢复
   ↓
9. 完成恢复
   - 蓝色播放头回到原位置
   - 视频显示原播放帧
   - 灰色预览线消失
```

---

## 🔍 关键技术要点

### **1. 播放位置与预览完全分离**

| 状态 | 播放位置 | 预览位置 |
|------|---------|---------|
| **数据** | `currentFrameIndex` | `previewFrameIndex` |
| **时间** | `currentTimeMs` | `previewTimeMs` |
| **UI** | 蓝色播放头 | 灰色预览线 |
| **Worker 消息** | `seek` | `preview-frame` |

### **2. 响应式状态管理**

```typescript
// currentTimeMs 根据模式自动切换计算方式
const currentTimeMs = $derived.by(() => {
  if (isPreviewMode && savedPlaybackState) {
    return Math.floor((savedPlaybackState.frameIndex) / frameRate * 1000)  // 预览模式
  }
  return Math.floor((windowStartIndex + currentFrameIndex) / frameRate * 1000)  // 正常模式
})
```

**优势**:
- ✅ 自动更新，无需手动管理
- ✅ 单一数据源，避免不一致
- ✅ 简化代码逻辑

### **3. 性能优化**

#### **节流控制**
```typescript
const HOVER_PREVIEW_THROTTLE_MS = 50  // 50ms 节流

if (hoverPreviewThrottleTimer) return
hoverPreviewThrottleTimer = window.setTimeout(() => {
  hoverPreviewThrottleTimer = null
}, HOVER_PREVIEW_THROTTLE_MS)
```

**效果**: 避免鼠标快速移动时频繁 seek，提升性能

#### **条件渲染**
```svelte
{#if isHoveringTimeline && !isDraggingPlayhead && ...}
  <!-- 预览竖线 -->
{/if}
```

**效果**: 仅在需要时渲染预览 UI

### **4. 防御性编程**

#### **窗口边界检查**
```typescript
if (windowFrameIndex >= 0 && windowFrameIndex < totalFrames) {
  // 在当前窗口内
} else {
  // 不在当前窗口
  console.warn('⚠️ Frame outside current window')
}
```

#### **状态恢复保护**
```typescript
if (savedPlaybackState) {
  // 恢复逻辑
  savedPlaybackState = null  // 清理状态
}
```

---

## ✅ 功能测试清单

### **基础功能**
- [x] 鼠标移到时间线，显示灰色预览竖线
- [x] 预览竖线跟随鼠标移动
- [x] 视频帧实时更新为预览帧
- [x] 蓝色播放头保持在原位置不动
- [x] 时间显示正确（不显示 NaN）
- [x] 鼠标移出时间线，恢复到原播放位置
- [x] 灰色预览竖线消失

### **播放状态**
- [x] 暂停时预览，移出后保持暂停
- [x] 播放时预览，自动暂停，移出后恢复播放
- [x] 预览期间点击播放按钮，退出预览并开始播放

### **边界情况**
- [x] 0 秒位置预览
- [x] 视频末尾预览
- [x] 快速移动鼠标（节流测试）
- [x] 预览期间点击时间轴
- [x] 预览期间拖拽播放头

### **Zoom 区间**
- [x] 创建 Zoom 区间（拖拽）
- [x] 显示 Zoom 区间（蓝色色块）
- [x] 删除单个区间
- [x] 清除所有区间
- [x] 重叠检测（拒绝重叠区间）

---

## 📊 代码统计

| 文件 | 新增行数 | 修改行数 | 总变更 |
|------|---------|---------|--------|
| `video-zoom.svelte.ts` | 140 | 0 | 140 |
| `Timeline.svelte` | 150 | 50 | 200 |
| `composite-worker/index.ts` | 28 | 0 | 28 |
| `VideoPreviewComposite.svelte` | 120 | 30 | 150 |
| **总计** | **438** | **80** | **518** |

---

## 🐛 修复的问题

### **问题 1: 蓝色播放头跟随鼠标移动** ✅
**原因**: 使用 `seekToGlobalTime()` 改变了 `currentFrameIndex`
**解决**: 使用独立的 `preview-frame` 消息，不改变播放位置

### **问题 2: 移出时恢复到 0 秒** ✅
**原因**: 恢复时使用了错误的 `currentFrameIndex`
**解决**: 使用保存的 `savedPlaybackState.frameIndex`

### **问题 3: 时间显示 NaN** ✅
**原因**: 时间显示重复计算，可能得到 `NaN`
**解决**: 使用 `currentTimeMs / 1000`，单一数据源

---

## 🚀 后续扩展方向

### **Phase 2: Zoom 放大功能**（待实现）

1. 🔲 扩展 `BackgroundConfig` 类型（添加 `videoZoom`）
2. 🔲 修改 `composite-worker` 实现放大逻辑
3. 🔲 实现平滑过渡动画（10 帧过渡）
4. 🔲 支持自定义放大倍数
5. 🔲 支持自定义放大中心点

### **Phase 3: 高级预览功能**（可选）

1. 🔲 跨窗口预览（预览帧不在当前窗口时切换窗口）
2. 🔲 预览帧缓存（避免重复渲染）
3. 🔲 预览加载提示（渲染时显示加载状态）
4. 🔲 键盘快捷键（左右箭头预览前后帧）

---

## ✅ 总结

本次实现成功完成了专业级视频预览功能：

- ✅ **完整的预览机制**：独立的预览消息，不影响播放状态
- ✅ **清晰的 UI 反馈**：灰色预览线 + 蓝色播放头，职责明确
- ✅ **精确的状态管理**：保存/恢复播放位置和播放状态
- ✅ **性能优化**：节流控制，条件渲染
- ✅ **防御性编程**：边界检查，状态保护
- ✅ **Zoom 区间管理**：支持创建、显示、删除，重叠检测

代码质量高，架构清晰，易于维护和扩展。为后续实现 Zoom 放大功能打下了坚实的基础。🎉

