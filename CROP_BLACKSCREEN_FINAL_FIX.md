# 🔧 裁剪后黑屏问题 - 最终修复

## 📋 问题诊断

### 🐛 根本原因

**Canvas 元素被条件渲染销毁导致 bitmapCtx 失效**

#### 问题代码结构（修复前）

```svelte
<div class="flex flex-col h-full">
  {#if !isCropMode}
    <!-- 普通预览模式 -->
    <div>
      <canvas bind:this={canvas}></canvas>
    </div>
    
    <!-- 时间轴和控制栏 -->
    ...
  {:else}
    <!-- 裁剪模式 -->
    <VideoCropPanel />
  {/if}
</div>
```

#### 问题时间线

```
1. 用户点击"确认裁剪"
2. exitCropMode(true) 被调用
3. 第 928 行：isCropMode = false ✅
4. ⚠️ Svelte 检测到 isCropMode 变化，开始重新渲染 DOM
5. ⚠️ Canvas 元素从 {:else} 块切换到 {#if} 块
6. ⚠️ 旧的 Canvas 元素被销毁
7. ⚠️ canvas 变量暂时为 null
8. ⚠️ bitmapCtx 失效（因为 canvas 被销毁）
9. 第 945 行：updateBackgroundConfig() 发送消息到 Worker
10. Worker 渲染帧并发送 'frame' 消息
11. 主线程 onmessage 收到 'frame' 消息
12. 第 380 行：检查 if (!isCropMode) 通过 ✅
13. 第 381 行：调用 displayFrame()
14. 第 589 行：if (!bitmapCtx) return ❌ 因为 canvas 刚被销毁！
15. 💥 黑屏！Canvas 还没来得及重新初始化
```

### 🔍 关键发现

1. **Canvas 生命周期问题**
   - Canvas 在 `{#if !isCropMode}` 块内
   - 切换模式时 Canvas 被销毁并重新创建
   - `bind:this={canvas}` 在重新创建前为 null

2. **时序竞态条件**
   - Worker 发送帧的速度 > Canvas 重新初始化的速度
   - `displayFrame()` 在 Canvas 初始化前被调用
   - `bitmapCtx` 为 null 导致提前返回

3. **为什么日志显示正常但画面黑屏**
   - `isCropMode` 确实变成了 false
   - `displayFrame()` 确实被调用
   - 但 `bitmapCtx` 为 null，函数提前返回
   - 没有实际执行 `transferFromImageBitmap()`

---

## ✅ 解决方案

### 核心思路

**Canvas 始终存在，通过 CSS 控制显示/隐藏，而不是销毁/重建**

### 修复代码

#### 1. 移除条件渲染的 Canvas

```svelte
<!-- 修复前：Canvas 在条件块内 -->
{#if !isCropMode}
  <div>
    <canvas bind:this={canvas}></canvas>
  </div>
{:else}
  <VideoCropPanel />
{/if}

<!-- 修复后：Canvas 独立存在，用 CSS 隐藏 -->
<!-- Canvas 区域 - 通过 class:hidden 控制显示 -->
<div class:hidden={isCropMode}>
  <canvas bind:this={canvas}></canvas>
</div>

<!-- 裁剪面板 - 独立的条件渲染 -->
{#if isCropMode}
  <VideoCropPanel />
{/if}
```

#### 2. 完整修复代码

```svelte
<!-- Video preview container -->
<div class="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden {className}">
  <!-- Preview info bar - 始终显示 -->
  <div class="flex-shrink-0 flex justify-between items-center p-3 border-b border-gray-700">
    <div class="flex items-center gap-2">
      <Monitor class="w-4 h-4 text-gray-400" />
      <span class="text-sm font-semibold text-gray-100">Video Preview</span>
    </div>
    
    <!-- 裁剪按钮 -->
    <button onclick={enterCropMode}>
      <Crop class="w-3.5 h-3.5" />
      {#if videoCropStore.enabled}已裁剪{:else}裁剪{/if}
    </button>
  </div>

  <!-- Canvas display area - 🔧 关键修复：始终存在，通过 CSS 控制显示/隐藏 -->
  <div class="flex-1 flex items-center justify-center p-4 min-h-0" class:hidden={isCropMode}>
    <div class="relative bg-black flex items-center justify-center rounded overflow-hidden" 
         style="width: {previewWidth}px; height: {previewHeight}px;">
      <canvas
        bind:this={canvas}
        class="block rounded transition-opacity duration-300"
        class:opacity-50={isProcessing}
        style="width: {previewWidth}px; height: {previewHeight}px;"
      ></canvas>
      
      <!-- 加载状态 -->
      {#if isProcessing}
        <div class="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
          <LoaderCircle class="w-8 h-8 text-blue-500 animate-spin mb-2" />
          <span class="text-sm">Processing video...</span>
        </div>
      {/if}
    </div>
    
    <!-- 播放控制栏 -->
    {#if showControls}
      <div class="flex-shrink-0 flex items-center justify-center gap-2 p-3 border-t border-gray-700">
        <!-- 控制按钮 -->
      </div>
    {/if}
    
    <!-- 时间轴 -->
    {#if showTimeline && totalFrames > 0}
      <div class="flex-shrink-0 p-3 border-t border-gray-700">
        <!-- 时间轴滑块 -->
      </div>
    {/if}
  </div>
  
  <!-- 🆕 裁剪模式 - 独立显示，不销毁 Canvas -->
  {#if isCropMode}
    <div class="flex-1 flex items-center justify-center p-4 min-h-0">
      {#if currentFrameBitmap && videoInfo}
        <VideoCropPanel
          frameBitmap={currentFrameBitmap}
          videoWidth={videoInfo.width}
          videoHeight={videoInfo.height}
          displayWidth={previewWidth}
          displayHeight={previewHeight}
          onConfirm={() => exitCropMode(true)}
          onCancel={() => exitCropMode(false)}
        />
      {/if}
    </div>
  {/if}
</div>
```

---

## 🎯 修复效果

### 修复后的时间线

```
1. 用户点击"确认裁剪"
2. exitCropMode(true) 被调用
3. 第 928 行：isCropMode = false ✅
4. ✅ Svelte 更新 class:hidden={isCropMode}
5. ✅ Canvas 元素从 hidden 变为可见（但不销毁）
6. ✅ canvas 变量保持有效
7. ✅ bitmapCtx 保持有效
8. 第 945 行：updateBackgroundConfig() 发送消息到 Worker
9. Worker 渲染帧并发送 'frame' 消息
10. 主线程 onmessage 收到 'frame' 消息
11. 第 380 行：检查 if (!isCropMode) 通过 ✅
12. 第 381 行：调用 displayFrame()
13. 第 589 行：if (!bitmapCtx) 检查通过 ✅
14. 第 605 行：bitmapCtx.transferFromImageBitmap(bitmap) ✅
15. ✅ 画面正常显示！
```

### 关键改进

1. **Canvas 生命周期稳定**
   - Canvas 元素在组件生命周期内始终存在
   - 不会因为模式切换而销毁/重建
   - `bind:this={canvas}` 始终有效

2. **消除时序竞态**
   - `bitmapCtx` 始终有效
   - Worker 发送的帧可以立即显示
   - 不需要等待 Canvas 重新初始化

3. **性能优化**
   - 避免 Canvas 重复创建/销毁
   - 减少 DOM 操作
   - 更流畅的模式切换

---

## 🧪 测试验证

### 测试步骤

1. **进入裁剪模式**
   - [ ] 点击"裁剪"按钮
   - [ ] 验证裁剪面板显示
   - [ ] 验证 Canvas 被隐藏（但未销毁）

2. **取消裁剪**
   - [ ] 点击"取消"按钮
   - [ ] 验证裁剪面板消失
   - [ ] 验证 Canvas 立即显示原画面

3. **应用裁剪**
   - [ ] 调整裁剪区域
   - [ ] 点击"确认"按钮
   - [ ] ✅ 验证画面立即显示裁剪后的效果（不黑屏）
   - [ ] 验证裁剪配置已保存

4. **多次切换**
   - [ ] 重复进入/退出裁剪模式
   - [ ] 验证每次都能正常显示
   - [ ] 验证无内存泄漏

### 预期结果

- ✅ 退出裁剪模式后立即显示画面
- ✅ 无黑屏现象
- ✅ 裁剪效果正确应用
- ✅ 控制台无错误日志

---

## 📊 技术总结

### 问题类型

**React/Svelte 条件渲染导致的生命周期问题**

### 核心教训

1. **避免销毁关键 DOM 元素**
   - Canvas、Video 等有状态的元素应该保持存在
   - 使用 CSS 控制显示/隐藏，而不是条件渲染

2. **注意异步操作的时序**
   - Worker 消息可能在 DOM 更新前到达
   - 需要确保接收方（Canvas）始终就绪

3. **Svelte 的条件渲染特性**
   - `{#if}` 会销毁/重建 DOM
   - `class:hidden` 只改变样式，不销毁 DOM
   - 选择合适的方式控制显示

### 最佳实践

```svelte
<!-- ❌ 不推荐：销毁/重建 Canvas -->
{#if showCanvas}
  <canvas bind:this={canvas}></canvas>
{/if}

<!-- ✅ 推荐：保持 Canvas，用 CSS 控制 -->
<canvas bind:this={canvas} class:hidden={!showCanvas}></canvas>
```

---

## 🔗 相关文件

- `src/lib/components/VideoPreviewComposite.svelte` - 主修复文件
- `src/lib/components/VideoCropPanel.svelte` - 裁剪面板
- `src/lib/stores/video-crop.svelte.ts` - 裁剪状态管理
- `src/lib/workers/composite-worker/index.ts` - Worker 渲染逻辑

---

## ✅ 修复状态

- [x] 问题诊断完成
- [x] 根本原因确认
- [x] 修复方案实施
- [ ] 测试验证
- [ ] 代码审查
- [ ] 文档更新

