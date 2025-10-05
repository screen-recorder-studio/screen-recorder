# 🔧 Zoom 轨道预览功能优化

## 📅 优化日期
2025-10-05

## 🐛 问题描述

### **原始问题**
❌ 鼠标在 Zoom 轨道上移动时，无法预览视频帧
❌ 只有在主时间轴上移动才能预览
❌ 这对于设置 Zoom 区间非常不方便

### **期望行为**
✅ 鼠标在 Zoom 轨道上移动时，也能预览视频帧
✅ 显示灰色预览竖线
✅ 蓝色播放头保持不动
✅ 拖拽创建区间时不触发预览

---

## 🔍 根本原因

### **问题分析**

Timeline 组件有两个主要区域：

1. **主时间轴** (`timeline-track`)
   - ✅ 有 `onmousemove` 事件监听器
   - ✅ 鼠标移动时触发预览

2. **Zoom 轨道** (`zoom-hint` / `zoom-mini-timeline`)
   - ❌ 没有 `onmousemove` 事件监听器
   - ❌ 鼠标移动时不触发预览

### **代码对比**

#### **主时间轴** (有预览)
```svelte
<div
  class="timeline-track"
  bind:this={timelineTrackEl}
  onmousemove={handleTimelineMouseMove}  <!-- ✅ 有预览 -->
  onmouseleave={handleTimelineMouseLeave}
  onclick={handleTimelineClick}
>
  ...
</div>
```

#### **Zoom 轨道** (无预览 - 修复前)
```svelte
<div
  class="zoom-hint"
  bind:this={zoomTrackEl}
  onmousedown={handleZoomTrackMouseDown}
  <!-- ❌ 缺少 onmousemove -->
  <!-- ❌ 缺少 onmouseleave -->
>
  ...
</div>
```

---

## 💡 解决方案

### **核心思路**

1. ✅ 为 Zoom 轨道添加 `onmousemove` 和 `onmouseleave` 事件监听器
2. ✅ 创建专门的 Zoom 轨道预览处理函数
3. ✅ 拖拽创建区间时禁用预览（通过 `isDraggingZoom` 标志）
4. ✅ 使用 `pixelToTimeMs(e.clientX, zoomTrackEl)` 计算正确的时间位置

---

## 🔧 实施细节

### **修改 1: 添加 Zoom 轨道预览处理函数** (行 350-378)

```typescript
// 🆕 Zoom 轨道鼠标移动处理（预览）
function handleZoomTrackMouseMove(e: MouseEvent) {
  // 🔧 拖拽创建区间时不触发预览
  if (!zoomTrackEl || isDraggingZoom || isProcessing) {
    return
  }

  isHoveringTimeline = true
  hoverPreviewTimeMs = pixelToTimeMs(e.clientX, zoomTrackEl)

  // 触发预览回调
  onHoverPreview?.(hoverPreviewTimeMs)
}

// 🆕 Zoom 轨道鼠标离开处理
function handleZoomTrackMouseLeave() {
  if (!isHoveringTimeline || isDraggingZoom) return

  isHoveringTimeline = false
  onHoverPreviewEnd?.()
}
```

**关键点**:

#### **1. 拖拽时禁用预览**
```typescript
if (!zoomTrackEl || isDraggingZoom || isProcessing) {
  return
}
```

**原因**: 
- 拖拽创建区间时，鼠标移动应该更新区间范围
- 不应该触发预览，避免干扰用户操作

#### **2. 使用正确的元素引用**
```typescript
hoverPreviewTimeMs = pixelToTimeMs(e.clientX, zoomTrackEl)
```

**原因**:
- `pixelToTimeMs()` 需要元素引用来计算正确的位置
- Zoom 轨道和主时间轴的位置可能不同

#### **3. 共享预览状态**
```typescript
isHoveringTimeline = true  // 与主时间轴共享状态
```

**原因**:
- 预览状态是全局的，不区分来源
- 简化状态管理

---

### **修改 2: Zoom 提示区域添加事件监听器** (行 712-725)

```svelte
<!-- 默认提示状态 -->
<div
  class="zoom-hint"
  bind:this={zoomTrackEl}
  onmousedown={handleZoomTrackMouseDown}
  onmousemove={handleZoomTrackMouseMove}      <!-- 🆕 添加预览 -->
  onmouseleave={handleZoomTrackMouseLeave}    <!-- 🆕 添加预览结束 -->
  role="button"
  tabindex="0"
  aria-label="Click and drag to create zoom interval"
>
  <ZoomIn class="w-4 h-4" />
  <span>Click and drag to create zoom interval</span>
</div>
```

**适用场景**: 没有 Zoom 区间时的提示状态

---

### **修改 3: Zoom 缩略时间轴添加事件监听器** (行 747-755)

```svelte
<!-- Zoom 缩略时间轴 -->
<div
  class="zoom-mini-timeline"
  bind:this={zoomTrackEl}
  onmousemove={handleZoomTrackMouseMove}      <!-- 🆕 添加预览 -->
  onmouseleave={handleZoomTrackMouseLeave}    <!-- 🆕 添加预览结束 -->
>
  <!-- 全时间轴背景 -->
  <div class="zoom-full-range"></div>
  
  <!-- Zoom 区间列表 -->
  {#each zoomIntervals as interval, index}
    ...
  {/each}
</div>
```

**适用场景**: 已有 Zoom 区间时的激活状态

---

## 📊 功能对比

### **修复前**

| 区域 | 鼠标移动 | 预览功能 | 灰色竖线 |
|------|---------|---------|---------|
| 主时间轴 | ✅ | ✅ | ✅ |
| Zoom 轨道 | ❌ | ❌ | ❌ |

**问题**:
- 用户需要在主时间轴上预览，然后记住时间
- 切换到 Zoom 轨道创建区间
- 无法直接在 Zoom 轨道上预览确认位置

### **修复后**

| 区域 | 鼠标移动 | 预览功能 | 灰色竖线 |
|------|---------|---------|---------|
| 主时间轴 | ✅ | ✅ | ✅ |
| Zoom 轨道 | ✅ | ✅ | ✅ |

**优势**:
- ✅ 用户可以直接在 Zoom 轨道上预览
- ✅ 边预览边确定 Zoom 区间的起止位置
- ✅ 工作流更流畅，无需切换区域

---

## 🎨 用户交互流程

### **场景 1: 在 Zoom 轨道上预览并创建区间**

```
1. 用户将鼠标移到 Zoom 轨道
   ↓
2. handleZoomTrackMouseMove() 触发
   - 检查：不在拖拽状态 ✅
   - 计算：hoverPreviewTimeMs = pixelToTimeMs(e.clientX, zoomTrackEl)
   - 触发：onHoverPreview(hoverPreviewTimeMs)
   ↓
3. VideoPreviewComposite 显示预览帧
   - 灰色预览竖线显示在 Zoom 轨道上
   - 蓝色播放头保持不动
   - 视频显示预览帧
   ↓
4. 用户找到合适的起始位置
   - 按下鼠标开始拖拽
   - isDraggingZoom = true
   - 预览自动停止（因为 isDraggingZoom 检查）
   ↓
5. 用户拖拽创建区间
   - 鼠标移动更新区间范围
   - 不触发预览（isDraggingZoom = true）
   ↓
6. 用户松开鼠标
   - 创建 Zoom 区间
   - isDraggingZoom = false
   ↓
7. 用户继续在 Zoom 轨道上移动鼠标
   - 预览功能恢复
   - 可以预览已创建的区间
```

### **场景 2: 在 Zoom 区间上预览**

```
1. 已有 Zoom 区间显示在 Zoom 轨道上
   ↓
2. 用户将鼠标移到某个区间上
   ↓
3. handleZoomTrackMouseMove() 触发
   - 计算鼠标位置对应的时间
   - 触发预览
   ↓
4. 视频显示该区间内的帧
   - 用户可以确认区间是否正确
   - 如果不满意，可以删除重新创建
```

---

## ✅ 测试验证

### **测试场景 1: Zoom 轨道预览**
1. ✅ 鼠标移到 Zoom 轨道（提示状态）
2. ✅ **验证**: 显示灰色预览竖线 ✅
3. ✅ **验证**: 蓝色播放头保持不动 ✅
4. ✅ **验证**: 视频显示预览帧 ✅

### **测试场景 2: 拖拽创建区间时不预览**
1. ✅ 鼠标移到 Zoom 轨道
2. ✅ 按下鼠标开始拖拽
3. ✅ **验证**: 预览停止 ✅
4. ✅ **验证**: 区间范围正常更新 ✅
5. ✅ 松开鼠标创建区间
6. ✅ **验证**: 区间创建成功 ✅

### **测试场景 3: Zoom 区间上预览**
1. ✅ 创建一个 Zoom 区间（如 5-10 秒）
2. ✅ 鼠标移到该区间上
3. ✅ **验证**: 显示灰色预览竖线 ✅
4. ✅ **验证**: 视频显示区间内的帧 ✅

### **测试场景 4: 跨区域预览**
1. ✅ 鼠标在主时间轴上预览
2. ✅ 移动到 Zoom 轨道
3. ✅ **验证**: 预览继续工作 ✅
4. ✅ 移回主时间轴
5. ✅ **验证**: 预览继续工作 ✅

### **测试场景 5: 移出 Zoom 轨道**
1. ✅ 鼠标在 Zoom 轨道上预览
2. ✅ 移出 Zoom 轨道
3. ✅ **验证**: 预览结束 ✅
4. ✅ **验证**: 恢复到原播放位置 ✅

---

## 📝 代码变更

### **文件**: `src/lib/components/Timeline.svelte`

**修改位置**:
- 行 350-378: 添加 Zoom 轨道预览处理函数
- 行 712-725: Zoom 提示区域添加事件监听器
- 行 747-755: Zoom 缩略时间轴添加事件监听器

**代码行数**: ~30 行新增

---

## 🎯 关键要点

### **1. 统一的预览机制**
- ✅ 主时间轴和 Zoom 轨道使用相同的预览逻辑
- ✅ 共享 `isHoveringTimeline` 状态
- ✅ 共享 `hoverPreviewTimeMs` 数据

### **2. 智能的预览控制**
- ✅ 拖拽时自动禁用预览（`isDraggingZoom` 检查）
- ✅ 处理中禁用预览（`isProcessing` 检查）
- ✅ 避免干扰用户操作

### **3. 正确的位置计算**
- ✅ 使用 `pixelToTimeMs(e.clientX, zoomTrackEl)` 传递正确的元素引用
- ✅ 确保预览位置准确

### **4. 一致的用户体验**
- ✅ 无论在哪个区域，预览行为一致
- ✅ 灰色预览竖线、蓝色播放头、视频帧显示都相同
- ✅ 用户无需学习不同的交互方式

---

## 🚀 用户体验提升

### **修复前的工作流**
```
1. 在主时间轴上移动鼠标预览
2. 记住想要的时间点（如 5 秒）
3. 切换到 Zoom 轨道
4. 凭记忆点击 5 秒位置
5. 拖拽创建区间
6. 如果位置不对，删除重来
```

**问题**: 需要记忆，容易出错

### **修复后的工作流**
```
1. 直接在 Zoom 轨道上移动鼠标
2. 边预览边找到想要的起始位置
3. 按下鼠标开始拖拽
4. 拖拽到结束位置
5. 松开鼠标创建区间
6. 继续在 Zoom 轨道上预览确认
```

**优势**: 直观、准确、高效

---

## ✅ 总结

本次优化成功为 Zoom 轨道添加了预览功能：

- ✅ **统一的预览体验**：主时间轴和 Zoom 轨道预览行为一致
- ✅ **智能的预览控制**：拖拽时自动禁用，避免干扰
- ✅ **提升工作效率**：边预览边创建区间，无需记忆
- ✅ **代码简洁**：复用现有预览逻辑，仅 30 行新增代码

现在用户可以在 Zoom 轨道上直接预览视频帧，大大提升了设置 Zoom 区间的便利性！🎉

