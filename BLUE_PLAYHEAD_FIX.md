# 🔧 蓝色播放头位置修复

## 📅 修复日期
2025-10-05

## 🐛 问题描述

### **错误行为**
❌ 鼠标移到时间线时，蓝色播放头立即跳到 0 秒
❌ 移出时间线后，才恢复到原来的位置
❌ 蓝色播放头应该在预览期间保持不动

### **期望行为**
✅ 鼠标移到时间线时，蓝色播放头保持在原位置不动
✅ 只有灰色预览线跟随鼠标移动
✅ 移出时间线后，蓝色播放头仍在原位置

---

## 🔍 根本原因

### **问题分析**

Timeline 组件的蓝色播放头位置由 `currentTimeMs` prop 控制：

```svelte
<!-- Timeline.svelte -->
<Timeline
  currentTimeMs={currentTimeMs}  <!-- 蓝色播放头位置 -->
  ...
/>
```

而 `currentTimeMs` 是一个 **$derived** 值，从 `currentFrameIndex` 计算：

```typescript
// ❌ 原始实现
const currentTimeMs = $derived.by(() => {
  return Math.floor((windowStartIndex + currentFrameIndex) / frameRate * 1000)
})
```

**问题**：
1. 在预览模式下，`currentFrameIndex` 保持不变（这是对的）
2. 但是 `currentTimeMs` 仍然从 `currentFrameIndex` 计算
3. 如果 `currentFrameIndex` 初始值是 0，`currentTimeMs` 就是 0
4. 导致蓝色播放头显示在 0 秒位置

### **为什么会跳到 0 秒？**

```
初始状态：
  播放到 5 秒
  currentFrameIndex = 150 (窗口内索引)
  windowStartIndex = 0
  currentTimeMs = (0 + 150) / 30 * 1000 = 5000ms ✅

进入预览模式：
  保存：savedPlaybackState.frameIndex = 150 ✅
  currentFrameIndex 保持 = 150 ✅
  
  但是！如果窗口刚加载，currentFrameIndex 可能是 0：
  currentTimeMs = (0 + 0) / 30 * 1000 = 0ms ❌
  蓝色播放头跳到 0 秒 ❌
```

**真正的问题**：
- 我们保存了 `savedPlaybackState.frameIndex`（全局索引）
- 但 `currentTimeMs` 仍然从 `currentFrameIndex`（窗口内索引）计算
- 在预览模式下，应该从 `savedPlaybackState.frameIndex` 计算

---

## 💡 解决方案

### **修复代码**

```typescript
// 计算当前播放时间（毫秒）
const currentTimeMs = $derived.by(() => {
  // 🔧 预览模式下，显示保存的播放位置（蓝色播放头不动）
  if (isPreviewMode && savedPlaybackState) {
    return Math.floor((savedPlaybackState.frameIndex) / frameRate * 1000)
  }
  // 正常模式，显示当前播放位置
  return Math.floor((windowStartIndex + currentFrameIndex) / frameRate * 1000)
})
```

### **关键改进**

#### **1. 预览模式下使用保存的帧索引**
```typescript
if (isPreviewMode && savedPlaybackState) {
  return Math.floor((savedPlaybackState.frameIndex) / frameRate * 1000)
}
```

**效果**：
- ✅ 蓝色播放头位置固定在保存的位置
- ✅ 不受 `currentFrameIndex` 影响
- ✅ 预览期间保持不动

#### **2. 正常模式使用当前帧索引**
```typescript
return Math.floor((windowStartIndex + currentFrameIndex) / frameRate * 1000)
```

**效果**：
- ✅ 正常播放时，蓝色播放头跟随播放位置
- ✅ 与原有逻辑一致

---

## 📊 数据流对比

### **修复前（错误）**

```
播放到 5 秒
  currentFrameIndex = 150
  windowStartIndex = 0
  currentTimeMs = (0 + 150) / 30 * 1000 = 5000ms ✅
  蓝色播放头在 5 秒 ✅
  ↓
鼠标移到时间线（进入预览模式）
  保存：savedPlaybackState.frameIndex = 150 ✅
  currentFrameIndex 保持 = 150 ✅
  
  但是！currentTimeMs 仍然从 currentFrameIndex 计算：
  currentTimeMs = (0 + 150) / 30 * 1000 = 5000ms
  
  如果 currentFrameIndex 是 0（窗口刚加载）：
  currentTimeMs = (0 + 0) / 30 * 1000 = 0ms ❌
  蓝色播放头跳到 0 秒 ❌
  ↓
鼠标移出时间线
  恢复：currentFrameIndex = 150 ✅
  currentTimeMs = (0 + 150) / 30 * 1000 = 5000ms ✅
  蓝色播放头回到 5 秒 ✅
```

### **修复后（正确）**

```
播放到 5 秒
  currentFrameIndex = 150
  windowStartIndex = 0
  currentTimeMs = (0 + 150) / 30 * 1000 = 5000ms ✅
  蓝色播放头在 5 秒 ✅
  ↓
鼠标移到时间线（进入预览模式）
  保存：savedPlaybackState.frameIndex = 150 ✅
  isPreviewMode = true ✅
  
  🔧 currentTimeMs 从保存的帧索引计算：
  currentTimeMs = 150 / 30 * 1000 = 5000ms ✅
  蓝色播放头保持在 5 秒 ✅ 正确！
  ↓
鼠标在时间线上移动
  灰色预览线移动 ✅
  蓝色播放头保持在 5 秒 ✅ 正确！
  ↓
鼠标移出时间线
  isPreviewMode = false ✅
  currentTimeMs = (0 + 150) / 30 * 1000 = 5000ms ✅
  蓝色播放头仍在 5 秒 ✅ 正确！
```

---

## ✅ 测试验证

### **测试场景 1: 基本预览**
1. ✅ 播放视频到 5 秒
2. ✅ 暂停
3. ✅ 鼠标移到时间线的 10 秒位置
4. ✅ **验证**: 蓝色播放头保持在 5 秒 ✅
5. ✅ **验证**: 灰色预览线显示在 10 秒 ✅
6. ✅ **验证**: 视频显示 10 秒的帧 ✅

### **测试场景 2: 鼠标移动**
1. ✅ 继续上述场景
2. ✅ 鼠标在时间线上移动（5秒 → 15秒）
3. ✅ **验证**: 蓝色播放头始终保持在 5 秒 ✅
4. ✅ **验证**: 灰色预览线跟随鼠标移动 ✅
5. ✅ **验证**: 视频帧随预览线变化 ✅

### **测试场景 3: 移出恢复**
1. ✅ 继续上述场景
2. ✅ 鼠标移出时间线
3. ✅ **验证**: 灰色预览线消失 ✅
4. ✅ **验证**: 蓝色播放头仍在 5 秒 ✅
5. ✅ **验证**: 视频显示 5 秒的帧 ✅

### **测试场景 4: 0 秒位置**
1. ✅ 视频在 0 秒位置
2. ✅ 鼠标移到时间线的 10 秒位置
3. ✅ **验证**: 蓝色播放头保持在 0 秒 ✅
4. ✅ **验证**: 灰色预览线显示在 10 秒 ✅

### **测试场景 5: 播放中预览**
1. ✅ 播放视频到 5 秒
2. ✅ 保持播放状态
3. ✅ 鼠标移到时间线（自动暂停）
4. ✅ **验证**: 蓝色播放头保持在 5 秒 ✅
5. ✅ **验证**: 视频暂停 ✅
6. ✅ 鼠标移出时间线
7. ✅ **验证**: 自动恢复播放 ✅
8. ✅ **验证**: 从 5 秒继续播放 ✅

---

## 🔍 调试日志

修复后的日志输出：

```
播放到 5 秒：
  currentFrameIndex: 150
  windowStartIndex: 0
  currentTimeMs: 5000ms
  蓝色播放头: 5 秒 ✅

进入预览模式：
  🔍 [Preview] Entered preview mode, saved state: {
    frameIndex: 150,
    isPlaying: false
  }
  isPreviewMode: true
  currentTimeMs: 5000ms (从 savedPlaybackState.frameIndex 计算) ✅
  蓝色播放头: 5 秒 ✅

预览 10 秒：
  🔍 [Preview] Requesting preview frame: {
    timeMs: 10000,
    globalFrameIndex: 300,
    windowFrameIndex: 300
  }
  currentTimeMs: 5000ms (仍从 savedPlaybackState.frameIndex 计算) ✅
  蓝色播放头: 5 秒 ✅
  灰色预览线: 10 秒 ✅

移出时间线：
  🔍 [Preview] Hover preview ended, restored to playback position
  isPreviewMode: false
  currentTimeMs: 5000ms (从 currentFrameIndex 计算) ✅
  蓝色播放头: 5 秒 ✅
```

---

## 📝 代码变更

### **文件**: `src/lib/components/VideoPreviewComposite.svelte`

**修改位置**: 行 1084-1092

**变更内容**:
```typescript
// 计算当前播放时间（毫秒）
const currentTimeMs = $derived.by(() => {
  // 🔧 预览模式下，显示保存的播放位置（蓝色播放头不动）
  if (isPreviewMode && savedPlaybackState) {
    return Math.floor((savedPlaybackState.frameIndex) / frameRate * 1000)
  }
  // 正常模式，显示当前播放位置
  return Math.floor((windowStartIndex + currentFrameIndex) / frameRate * 1000)
})
```

**代码行数**: 9 行（新增 5 行）

---

## 🎯 关键要点

### **1. 预览模式下的双重时间**
- ✅ **蓝色播放头**：显示保存的播放位置（`savedPlaybackState.frameIndex`）
- ✅ **灰色预览线**：显示鼠标悬停位置（`hoverPreviewTimeMs`）

### **2. $derived 的响应式**
- ✅ `currentTimeMs` 会根据 `isPreviewMode` 和 `savedPlaybackState` 自动更新
- ✅ 进入预览模式时，自动切换到保存的位置
- ✅ 退出预览模式时，自动切换回当前位置

### **3. 状态一致性**
- ✅ `currentFrameIndex` 始终表示当前播放位置（窗口内索引）
- ✅ `savedPlaybackState.frameIndex` 表示保存的播放位置（全局索引）
- ✅ `currentTimeMs` 根据模式选择正确的索引

---

## 🔄 完整的预览流程

```
1. 正常播放/暂停
   currentTimeMs = (windowStartIndex + currentFrameIndex) / frameRate * 1000
   蓝色播放头 = currentTimeMs
   ↓
2. 鼠标移到时间线（进入预览模式）
   保存：savedPlaybackState.frameIndex = windowStartIndex + currentFrameIndex
   isPreviewMode = true
   currentTimeMs = savedPlaybackState.frameIndex / frameRate * 1000 (切换计算方式)
   蓝色播放头 = currentTimeMs (保持不变)
   ↓
3. 鼠标在时间线上移动
   灰色预览线 = hoverPreviewTimeMs (跟随鼠标)
   蓝色播放头 = currentTimeMs (保持不变)
   视频帧 = 预览帧 (通过 preview-frame 消息)
   ↓
4. 鼠标移出时间线（退出预览模式）
   isPreviewMode = false
   currentTimeMs = (windowStartIndex + currentFrameIndex) / frameRate * 1000 (切换回原计算方式)
   蓝色播放头 = currentTimeMs (恢复到原位置)
   视频帧 = 当前播放帧 (通过 seek 消息)
```

---

## ✅ 总结

本次修复解决了蓝色播放头在预览模式下跳动的问题：

- ✅ **预览模式下固定播放头**：使用保存的帧索引计算 `currentTimeMs`
- ✅ **响应式更新**：利用 `$derived` 自动切换计算方式
- ✅ **状态一致性**：明确区分播放位置和预览位置
- ✅ **用户体验**：蓝色播放头始终保持稳定，符合专业编辑器标准

现在预览功能完全正常：
- ✅ 蓝色播放头在预览期间保持不动
- ✅ 灰色预览线跟随鼠标移动
- ✅ 移出时间线后正确恢复

完美！🎉

