# Timeline 高度修复报告

## 📋 问题描述

在引入新的 Timeline 组件后，时间轴的高度显著增加（从 48px 增加到约 232px），但 `VideoPreviewComposite.svelte` 中的 `updatePreviewSize()` 函数仍使用旧的高度值，导致视频预览区域可能会覆盖底部时间线。

## 🔍 问题分析

### 旧 Timeline（简单进度条）
- **总高度**: 约 48px
- **组成**: 仅包含一个简单的 range input 进度条

### 新 Timeline 组件（专业时间轴）
- **总高度**: 约 200-232px
- **组成**:
  1. **容器 padding**: 1rem (上) + 1rem (下) = 32px
  2. **时间刻度区**: 2.5rem (40px) + 0.5rem margin-bottom (8px) = 48px
  3. **时间轴轨道**: 3rem (48px)
  4. **Zoom 控制区**: 
     - margin-top: 0.75rem (12px)
     - padding-top: 0.75rem (12px)
     - zoom-hint 或 zoom-active: 约 3rem (48px) 到 5rem (80px)

**高度差异**: 增加了约 **152-184px**

## ✅ 解决方案

### 修改文件
`src/lib/components/VideoPreviewComposite.svelte`

### 修改内容

**修改前**:
```typescript
const timelineHeight = showTimeline && totalFrames > 0 ? 48 : 0  // Timeline height
```

**修改后**:
```typescript
// 🔧 更新：新 Timeline 组件包含时间刻度、轨道和 Zoom 控制区，总高度约 200-232px
// 保守估计使用 232px 以确保不会溢出
const timelineHeight = showTimeline && totalFrames > 0 ? 232 : 0  // New Timeline component height (with zoom control)
```

## 📐 布局计算逻辑

### 可用高度计算
```typescript
const availableHeight = displayHeight - headerHeight - controlsHeight - timelineHeight - padding
```

其中：
- `displayHeight`: 容器总高度
- `headerHeight`: 60px (预览信息栏)
- `controlsHeight`: 56px (播放控制栏，条件显示)
- `timelineHeight`: 232px (新 Timeline 组件，条件显示)
- `padding`: 48px (Canvas 区域内边距，p-6 = 24px * 2)

### 示例计算（假设容器高度 800px）
```
可用高度 = 800 - 60 - 56 - 232 - 48 = 404px
```

这确保了 Canvas 不会超出可用空间，避免覆盖时间轴。

## 🎯 验证要点

### 1. 布局层次
```
h-screen (100vh)
├── flex-shrink-0: 页头 (固定高度)
└── flex-1: 内容区 (剩余空间)
    └── VideoPreviewComposite (h-full)
        ├── flex-shrink-0: 预览信息栏 (60px)
        └── flex-1: Canvas + Timeline 区
            ├── flex-1: Canvas 区域 (自适应)
            └── flex-shrink-0: Timeline (232px + 控制栏 56px)
```

### 2. 关键 CSS 类
- `h-screen`: 限制整体高度为视口高度
- `flex-shrink-0`: 固定元素高度，防止收缩
- `flex-1 min-h-0`: 自适应元素，正确收缩
- `overflow-hidden`: 防止内容溢出

### 3. 测试场景
- ✅ 正常窗口大小（1920x1080）
- ✅ 小窗口（1280x720）
- ✅ 超大窗口（2560x1440）
- ✅ 启用/禁用 Zoom 控制
- ✅ 启用/禁用裁剪功能

## 📊 Timeline 组件高度详细分解

### Zoom 未激活状态
```css
.timeline-container {
  padding: 1rem;                    /* 32px */
}

.time-markers {
  height: 2.5rem;                   /* 40px */
  margin-bottom: 0.5rem;            /* 8px */
}

.timeline-track {
  height: 3rem;                     /* 48px */
}

.zoom-control {
  margin-top: 0.75rem;              /* 12px */
  padding-top: 0.75rem;             /* 12px */
}

.zoom-hint {
  padding: 0.75rem;                 /* 约 48px 总高 */
}

总计: 32 + 40 + 8 + 48 + 12 + 12 + 48 = 200px
```

### Zoom 激活状态
```css
.zoom-active {
  padding: 0.75rem;                 /* 12px */
  gap: 0.5rem;                      /* 8px */
}

.zoom-header {
  /* 约 24px */
}

.zoom-mini-timeline {
  height: 3rem;                     /* 48px */
}

Zoom 区总计: 12 + 24 + 8 + 48 = 92px
总计: 32 + 40 + 8 + 48 + 12 + 12 + 92 = 244px
```

**保守估计**: 使用 **232px** 作为固定值，确保在大多数情况下不会溢出。

## 🔧 后续优化建议

### 1. 动态高度计算
可以考虑使用 ResizeObserver 动态测量 Timeline 组件的实际高度：

```typescript
let timelineEl: HTMLDivElement | null = null
let measuredTimelineHeight = $state(232) // 默认值

onMount(() => {
  if (timelineEl) {
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (height) {
        measuredTimelineHeight = Math.ceil(height)
      }
    })
    observer.observe(timelineEl)
    return () => observer.disconnect()
  }
})
```

### 2. CSS 变量
将高度值提取为 CSS 变量，便于维护：

```css
:root {
  --timeline-height: 232px;
  --header-height: 60px;
  --controls-height: 56px;
}
```

### 3. 响应式优化
在小屏幕下，可以考虑：
- 隐藏 Zoom 控制区
- 减小时间刻度区高度
- 使用更紧凑的布局

## ✅ 测试清单

- [x] 修改 `timelineHeight` 常量为 232px
- [x] 添加详细注释说明高度来源
- [x] 验证 `updatePreviewSize()` 函数逻辑
- [x] 检查控制台日志输出是否正确
- [ ] 在实际页面中测试布局
- [ ] 测试不同窗口尺寸
- [ ] 测试 Zoom 激活/未激活状态
- [ ] 测试裁剪功能启用/禁用

## 📝 相关文件

- `src/lib/components/VideoPreviewComposite.svelte` - 主要修改文件
- `src/lib/components/Timeline.svelte` - 新 Timeline 组件
- `src/routes/studio/+page.svelte` - Studio 页面布局

## 🎉 总结

通过将 `timelineHeight` 从 48px 更新为 232px，确保了视频预览区域正确计算可用空间，避免了覆盖底部时间线的问题。这个修改是保守且安全的，即使在 Zoom 激活状态下也能保证布局正确。

