# 时间轴组件重设计需求分析

## 📋 需求概览

### 当前实现分析
- **文件位置**: `src/lib/components/VideoPreviewComposite.svelte` (行 1607-1722)
- **当前方案**: 使用 HTML `<input type="range">` 实现的水平滑块
- **功能**: 支持时间裁剪（trim）、拖拽跳转、播放进度显示

### 新需求要点
1. **时间刻度显示** - 在时间轴上显示时间标记
2. **竖线进度指示器** - 用竖线替代当前的滑块圆点
3. **Zoom 控制区** - 底部新增缩放操作，默认显示 "Click and drag to zoom"

---

## 🎨 设计规范

### 1. 时间刻度 (Time Markers)

#### 视觉设计
```
┌─────────────────────────────────────────────────────┐
│ 0:00    0:05    0:10    0:15    0:20    0:25   0:30 │ ← 主要刻度 (每5秒)
│  |   |   |   |   |   |   |   |   |   |   |   |   |  │ ← 次要刻度 (每1秒)
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
└─────────────────────────────────────────────────────┘
```

#### 刻度算法
- **主要刻度间隔**: 
  - 视频 < 30秒: 每 5秒
  - 视频 30-120秒: 每 10秒
  - 视频 > 120秒: 每 30秒
  
- **次要刻度间隔**: 主要刻度的 1/5

- **自适应逻辑**: 
  ```typescript
  function calculateTickInterval(durationSec: number): { major: number, minor: number } {
    if (durationSec <= 30) return { major: 5, minor: 1 }
    if (durationSec <= 120) return { major: 10, minor: 2 }
    if (durationSec <= 600) return { major: 30, minor: 6 }
    return { major: 60, minor: 12 }
  }
  ```

#### 样式规范
- **主要刻度**: 
  - 高度: 8px
  - 颜色: `text-gray-400`
  - 字体: `text-xs font-mono`
  
- **次要刻度**: 
  - 高度: 4px
  - 颜色: `text-gray-600`

---

### 2. 竖线进度指示器 (Playhead)

#### 视觉设计
```
     刻度标记
        ↓
    ┌───┴───┐
    │ 0:15  │  ← 时间气泡提示
    └───┬───┘
        │
        ║  ← 竖线指示器（红色）
        ║
━━━━━━━╋━━━━━━━━  ← 时间轴
        ║
```

#### 实现要点
- **竖线样式**:
  - 宽度: 2px
  - 颜色: `bg-red-500` (播放时) / `bg-blue-500` (暂停时)
  - 高度: 从刻度区域顶部到时间轴底部
  - Z-index: 30 (高于裁剪手柄)

- **时间气泡 (Tooltip)**:
  - 显示当前时间
  - 背景: `bg-gray-900/90`
  - 圆角: `rounded`
  - Padding: `px-2 py-1`
  - 跟随竖线移动

- **交互**:
  - 可拖拽竖线进行跳转
  - 鼠标悬停显示时间提示
  - 播放时自动移动

---

### 3. Zoom 控制区

#### 视觉设计
```
┌─────────────────────────────────────────────────────┐
│ 控制按钮 + 信息                                       │
├─────────────────────────────────────────────────────┤
│ 时间刻度 + 进度竖线 + 裁剪区域                          │
├─────────────────────────────────────────────────────┤
│ 🔍 Click and drag to zoom                            │ ← Zoom 控制区
│ ├────────[═══════════]──────────────────────┤       │
│ 0:00                                    0:30        │
└─────────────────────────────────────────────────────┘
```

#### 功能特性

**默认状态**:
- 显示提示文字: "Click and drag to zoom"
- 图标: 放大镜 🔍 (lucide `ZoomIn`)
- 颜色: `text-gray-500`

**交互后**:
- 显示缩放选区（带手柄的区域选择器）
- 选区高亮: `bg-blue-500/20`
- 两侧手柄可拖拽调整范围
- 显示缩放比例，如 "Zoom: 0:05 - 0:15"

**实现逻辑**:
```typescript
// Zoom 状态
let zoomStartMs = $state(0)
let zoomEndMs = $state(timelineMaxMs)
let isZooming = $state(false)
let zoomActive = $state(false)

// 应用 zoom 到主时间轴
function applyZoom() {
  // 重新计算可视范围
  // 调整刻度密度
  // 更新进度条显示范围
}

// 重置 zoom
function resetZoom() {
  zoomStartMs = 0
  zoomEndMs = timelineMaxMs
  zoomActive = false
}
```

---

## 🏗️ 组件结构重构

### 新的层次结构

```svelte
<div class="timeline-container">
  <!-- 控制按钮区 (现有，保持不变) -->
  <div class="controls-row">...</div>
  
  <!-- 主时间轴区 (重构) -->
  <div class="timeline-main">
    <!-- 时间刻度 -->
    <div class="time-markers">
      {#each timeMarkers as marker}
        <div class="marker" class:major={marker.isMajor}>
          {#if marker.isMajor}
            <span class="marker-label">{marker.timeLabel}</span>
          {/if}
        </div>
      {/each}
    </div>
    
    <!-- 时间轴轨道 -->
    <div class="timeline-track" bind:this={timelineContainerEl}>
      <!-- 裁剪区域遮罩 -->
      {#if trimStore.enabled}
        <div class="trim-overlay-left" />
        <div class="trim-overlay-right" />
        <div class="trim-active-region" />
      {/if}
      
      <!-- 进度竖线 -->
      <div class="playhead" style="left: {playheadPercent}%">
        <div class="playhead-line" />
        <div class="playhead-tooltip">{currentTimeLabel}</div>
      </div>
      
      <!-- 裁剪手柄 -->
      {#if trimStore.enabled}
        <button class="trim-handle trim-start" />
        <button class="trim-handle trim-end" />
      {/if}
    </div>
  </div>
  
  <!-- Zoom 控制区 (新增) -->
  <div class="zoom-control">
    {#if !zoomActive}
      <div class="zoom-hint">
        <ZoomIn class="w-4 h-4" />
        <span>Click and drag to zoom</span>
      </div>
    {:else}
      <div class="zoom-mini-timeline">
        <!-- 缩略时间轴 -->
        <!-- 缩放选区 -->
      </div>
    {/if}
  </div>
</div>
```

---

## 📦 状态管理

### 新增状态变量

```typescript
// 时间刻度
let timeMarkers = $derived.by(() => {
  const markers = []
  const { major, minor } = calculateTickInterval(uiDurationSec)
  
  // 生成主要刻度
  for (let t = 0; t <= uiDurationSec; t += major) {
    markers.push({
      timeSec: t,
      timeMs: t * 1000,
      timeLabel: formatTimeSec(t),
      isMajor: true,
      position: (t / uiDurationSec) * 100
    })
  }
  
  // 生成次要刻度
  for (let t = minor; t < uiDurationSec; t += minor) {
    if (t % major !== 0) {
      markers.push({
        timeSec: t,
        timeMs: t * 1000,
        isMajor: false,
        position: (t / uiDurationSec) * 100
      })
    }
  }
  
  return markers.sort((a, b) => a.timeSec - b.timeSec)
})

// 进度条位置
const playheadPercent = $derived.by(() => {
  const currentMs = (windowStartIndex + currentFrameIndex) / frameRate * 1000
  return (currentMs / timelineMaxMs) * 100
})

const currentTimeLabel = $derived(
  formatTimeSec((windowStartIndex + currentFrameIndex) / frameRate)
)

// Zoom 状态
let zoomStartMs = $state(0)
let zoomEndMs = $state(0)
let isZooming = $state(false)
let zoomActive = $state(false)
let isDraggingZoomStart = $state(false)
let isDraggingZoomEnd = $state(false)
```

---

## 🎯 交互功能

### 1. 竖线拖拽
```typescript
function handlePlayheadDrag(e: MouseEvent) {
  e.preventDefault()
  
  const handleMove = (moveEvent: MouseEvent) => {
    const newTimeMs = pixelToTimeMs(moveEvent.clientX)
    handleTimelineInput(newTimeMs)
  }
  
  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}
```

### 2. Zoom 选区创建
```typescript
function handleZoomStart(e: MouseEvent) {
  if (!timelineContainerEl) return
  
  const startX = e.clientX
  const startMs = pixelToTimeMs(startX)
  
  isZooming = true
  zoomStartMs = startMs
  zoomEndMs = startMs
  
  const handleMove = (moveEvent: MouseEvent) => {
    zoomEndMs = pixelToTimeMs(moveEvent.clientX)
  }
  
  const handleUp = () => {
    isZooming = false
    
    // 验证选区有效性
    if (Math.abs(zoomEndMs - zoomStartMs) > 1000) { // 至少1秒
      zoomActive = true
      applyZoom()
    } else {
      // 选区太小，重置
      zoomStartMs = 0
      zoomEndMs = timelineMaxMs
    }
    
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }
  
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}
```

### 3. Zoom 应用逻辑
```typescript
function applyZoom() {
  // 1. 计算缩放比例
  const zoomRatio = timelineMaxMs / (zoomEndMs - zoomStartMs)
  
  // 2. 调整刻度密度（增加刻度数量）
  const adjustedTickInterval = calculateTickInterval(
    (zoomEndMs - zoomStartMs) / 1000
  )
  
  // 3. 更新可视范围（如果需要请求新窗口数据）
  if (onRequestWindow) {
    const centerMs = (zoomStartMs + zoomEndMs) / 2
    const beforeMs = (centerMs - zoomStartMs)
    const afterMs = (zoomEndMs - centerMs)
    
    onRequestWindow({ centerMs, beforeMs, afterMs })
  }
  
  console.log(`🔍 [Zoom] Applied: ${formatTimeSec(zoomStartMs / 1000)} - ${formatTimeSec(zoomEndMs / 1000)}`)
}
```

---

## 🎨 样式规范

### Tailwind CSS 类

```css
/* 时间轴容器 */
.timeline-container {
  @apply flex-shrink-0 px-6 py-3 bg-gray-800;
}

/* 时间刻度容器 */
.time-markers {
  @apply relative w-full h-6 mb-1;
}

/* 主要刻度 */
.marker.major {
  @apply absolute h-2 border-l border-gray-400;
}

.marker.major .marker-label {
  @apply absolute -top-5 -left-6 w-12 text-center text-xs font-mono text-gray-400;
}

/* 次要刻度 */
.marker:not(.major) {
  @apply absolute h-1 border-l border-gray-600;
}

/* 时间轴轨道 */
.timeline-track {
  @apply relative w-full h-8 bg-gray-700 rounded cursor-pointer;
}

/* 进度竖线 */
.playhead {
  @apply absolute top-0 bottom-0 z-30 pointer-events-none;
}

.playhead-line {
  @apply w-0.5 h-full bg-red-500 shadow-lg;
  animation: pulse-glow 2s ease-in-out infinite;
}

.playhead-tooltip {
  @apply absolute -top-8 left-1/2 -translate-x-1/2 
         px-2 py-1 bg-gray-900/90 text-white text-xs font-mono 
         rounded shadow-lg whitespace-nowrap;
}

/* Zoom 控制区 */
.zoom-control {
  @apply mt-3 pt-3 border-t border-gray-700;
}

.zoom-hint {
  @apply flex items-center justify-center gap-2 
         py-2 text-sm text-gray-500 cursor-pointer 
         hover:text-gray-400 transition-colors;
}

.zoom-mini-timeline {
  @apply relative w-full h-12 bg-gray-900/50 rounded;
}

/* 裁剪区域样式保持不变 */
.trim-overlay-left,
.trim-overlay-right {
  @apply absolute top-0 h-full bg-black/40 pointer-events-none rounded;
}

.trim-active-region {
  @apply absolute top-0 h-full bg-blue-500/20 pointer-events-none;
}

/* 脉冲动画 */
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 5px rgba(239, 68, 68, 0.5); }
  50% { box-shadow: 0 0 15px rgba(239, 68, 68, 0.8); }
}
```

---

## 🔧 实现优先级

### Phase 1: 基础重构（核心功能）
1. ✅ 移除 `<input type="range">`
2. ✅ 实现自定义时间轴轨道
3. ✅ 添加时间刻度显示
4. ✅ 实现竖线进度指示器
5. ✅ 保持现有裁剪功能

### Phase 2: Zoom 功能
1. ✅ 添加 Zoom 控制区 UI
2. ✅ 实现选区拖拽创建
3. ✅ 实现 Zoom 应用逻辑
4. ✅ 添加重置 Zoom 功能

### Phase 3: 优化和美化
1. ✅ 添加动画效果
2. ✅ 优化拖拽体验
3. ✅ 添加键盘快捷键支持
4. ✅ 响应式布局调整

---

## 📝 技术考虑

### 性能优化
- **刻度渲染**: 使用 `$derived` 避免重复计算
- **拖拽节流**: 使用 `requestAnimationFrame` 优化拖拽性能
- **Zoom 缓存**: 缓存缩放状态，避免重复请求数据

### 兼容性
- **现有功能**: 确保 trim、window 切换等功能不受影响
- **状态同步**: 保持与 `trimStore`、`windowStartIndex` 等的同步
- **Props 接口**: 保持组件 Props 接口不变

### 可访问性
- **键盘导航**: 支持方向键、Home/End 键
- **ARIA 标签**: 添加适当的 ARIA 属性
- **焦点管理**: 合理的 Tab 顺序

---

## 🧪 测试场景

1. **短视频** (< 30秒): 刻度间隔 5秒
2. **中等视频** (30-120秒): 刻度间隔 10秒
3. **长视频** (> 2分钟): 刻度间隔 30秒
4. **Zoom 操作**: 创建、调整、重置
5. **Trim + Zoom**: 两个功能同时使用
6. **窗口切换**: Zoom 状态下的连续播放

---

## 📚 参考

### 类似产品
- **DaVinci Resolve**: 专业级时间轴
- **Adobe Premiere**: 标准视频编辑时间轴
- **Final Cut Pro**: Mac 视频编辑软件
- **CapCut**: 现代化的简化时间轴

### 技术文档
- Svelte 5 Runes: https://svelte-5-preview.vercel.app/docs/runes
- Tailwind CSS: https://tailwindcss.com/docs
- Lucide Icons: https://lucide.dev/icons
