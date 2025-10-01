# 🔬 黑屏问题最终诊断

## 🎯 **问题确认**

从日志分析：

### **Worker 端（正常）：**
```
⚙️ [COMPOSITE-WORKER] Updating config...
📐 [COMPOSITE-WORKER] Layout calculation: {...}
✂️ [COMPOSITE-WORKER] Applying video crop: {...}
✅ [COMPOSITE-WORKER] Crop rendered successfully: {...}
🎨 [COMPOSITE-WORKER] Frame rendered: 1348x960 at (285, 60)
[progress] VideoComposite - message processing complete: config  ← Worker 处理完成

⏭️ [COMPOSITE-WORKER] Seeking to frame: 0
✅ [COMPOSITE-WORKER] Rendering frame 0
✂️ [COMPOSITE-WORKER] Applying video crop: {...}
✅ [COMPOSITE-WORKER] Crop rendered successfully: {...}
📤 [COMPOSITE-WORKER] Frame bitmap sent to main thread  ← 只有 seek 发送了
[progress] VideoComposite - message processing complete: seek
```

### **主线程（异常）：**
```
❌ 完全没有 "📺 [VideoPreview] Received frame from worker" 日志
❌ 完全没有 "📀 [VideoPreview] displayFrame called" 日志
```

---

## 💡 **根本原因**

### **发现：`case 'config':` 没有发送帧消息**

对比两个代码路径：

#### ✅ **`case 'seek':` - 有发送确认日志（第 1284 行）**
```typescript
case 'seek':
  const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig);
  if (bitmap) {
    self.postMessage({
      type: 'frame',
      data: { bitmap, frameIndex: currentFrameIndex, timestamp: frame.timestamp }
    }, { transfer: [bitmap] });
    console.log('📤 [COMPOSITE-WORKER] Frame bitmap sent to main thread');  ← 有日志
  }
```

#### ❌ **`case 'config':` - 没有发送确认日志（第 1392-1400 行）**
```typescript
case 'config':
  const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig);
  if (bitmap) {
    self.postMessage({
      type: 'frame',
      data: { bitmap, frameIndex: currentFrameIndex, timestamp: frame.timestamp }
    }, { transfer: [bitmap] });
    // ❌ 缺少日志！说明这个 if 块没有执行
  }
```

**结论：** `renderCompositeFrame()` 在 `case 'config':` 中**返回了 null**！

---

## 🔍 **可能原因分析**

### **原因 1：`calculateAndCacheLayout()` 失败** 🎯

**代码路径（composite-worker/index.ts:256-287）：**

```typescript
function calculateAndCacheLayout() {
  if (!currentConfig || !videoInfo) {
    console.error('❌ [COMPOSITE-WORKER] Cannot calculate layout: missing config or video info');
    fixedVideoLayout = null;  // ← 设置为 null
    return;
  }
  
  const { outputWidth, outputHeight } = calculateOutputSize(
    currentConfig,
    videoInfo.width,
    videoInfo.height
  );
  
  if (!offscreenCanvas || offscreenCanvas.width !== outputWidth || offscreenCanvas.height !== outputHeight) {
    initializeCanvas(outputWidth, outputHeight);
  }
  
  const layout = calculateVideoLayout(
    currentConfig,
    outputWidth,
    outputHeight,
    videoInfo.width,
    videoInfo.height
  );
  
  fixedVideoLayout = layout;
  
  console.log('📐 [COMPOSITE-WORKER] Fixed layout calculated:', {
    videoInfo,
    canvasSize: { width: outputWidth, height: outputHeight },
    layout,
    config: currentConfig
  });
}
```

**如果 `fixedVideoLayout` 在 `calculateAndCacheLayout()` 后变成 null：**
```typescript
if (decodedFrames[currentFrameIndex] && fixedVideoLayout) {
  // ❌ 这个条件失败，不会渲染帧
}
```

---

### **原因 2：`renderCompositeFrame()` 内部错误**

查看 `renderCompositeFrame()` 的错误处理（composite-worker/index.ts:510-674）：

```typescript
function renderCompositeFrame(frame: VideoFrame, layout: VideoLayout, config: BackgroundConfig) {
  if (!ctx || !offscreenCanvas) {
    console.error('❌ [COMPOSITE-WORKER] Canvas not initialized');
    return null;  // ← 返回 null
  }
  
  try {
    // ... 渲染逻辑 ...
    
    return offscreenCanvas.transferToImageBitmap();
  } catch (error) {
    console.error('❌ [COMPOSITE-WORKER] Render error:', error);
    return null;  // ← 捕获异常返回 null
  }
}
```

**可能触发 null 的情况：**
1. `ctx` 或 `offscreenCanvas` 为 null
2. 渲染过程中抛出异常（例如 `drawImage` 参数错误）
3. `transferToImageBitmap()` 失败

---

## 🔧 **已添加的诊断日志**

### **Worker 端（composite-worker/index.ts:1387-1420）：**

```typescript
case 'config':
  calculateAndCacheLayout();
  
  // 🆕 诊断日志 1：检查渲染条件
  console.log('🔍 [COMPOSITE-WORKER] Checking frame render conditions:', {
    hasFrame: !!decodedFrames[currentFrameIndex],
    hasLayout: !!fixedVideoLayout,
    currentFrameIndex,
    decodedFramesLength: decodedFrames.length
  });
  
  if (decodedFrames[currentFrameIndex] && fixedVideoLayout) {
    // 🆕 诊断日志 2：开始渲染
    console.log('✅ [COMPOSITE-WORKER] Rendering frame for config update:', currentFrameIndex);
    
    const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig);
    
    // 🆕 诊断日志 3：检查渲染结果
    console.log('🖼️ [COMPOSITE-WORKER] renderCompositeFrame returned:', {
      hasBitmap: !!bitmap,
      bitmapWidth: bitmap?.width,
      bitmapHeight: bitmap?.height
    });
    
    if (bitmap) {
      // 🆕 诊断日志 4：发送前确认
      console.log('📤 [COMPOSITE-WORKER] Sending frame bitmap to main thread...');
      
      self.postMessage({
        type: 'frame',
        data: { bitmap, frameIndex: currentFrameIndex, timestamp: frame.timestamp }
      }, { transfer: [bitmap] });
      
      // 🆕 诊断日志 5：发送成功确认
      console.log('✅ [COMPOSITE-WORKER] Frame bitmap sent successfully from config handler');
    } else {
      // 🆕 诊断日志 6：渲染失败
      console.error('❌ [COMPOSITE-WORKER] renderCompositeFrame returned null in config handler!');
    }
  } else {
    // 🆕 诊断日志 7：条件不满足
    console.warn('⚠️ [COMPOSITE-WORKER] Cannot render frame in config handler - conditions not met');
  }
```

### **主线程端（VideoPreviewComposite.svelte:551-580）：**

```typescript
function displayFrame(bitmap: ImageBitmap, frameIndex: number, timestamp: number) {
  // 🆕 诊断日志 1：函数调用
  console.log('📀 [VideoPreview] displayFrame called:', {
    frameIndex,
    hasBitmap: !!bitmap,
    bitmapWidth: bitmap.width,
    bitmapHeight: bitmap.height,
    hasBitmapCtx: !!bitmapCtx,
    hasCanvas: !!canvas,
    canvasWidth: canvas?.width,
    canvasHeight: canvas?.height
  });
  
  if (!bitmapCtx) {
    // 🆕 诊断日志 2：Context 缺失
    console.error('❌ [VideoPreview] Bitmap context not available', {
      hasCanvas: !!canvas,
      canvasWidth: canvas?.width,
      canvasHeight: canvas?.height
    });
    return;
  }
  
  try {
    // 🆕 诊断日志 3：开始转移
    console.log('🎨 [VideoPreview] Transferring bitmap to canvas...');
    bitmapCtx.transferFromImageBitmap(bitmap);
    
    // 🆕 诊断日志 4：转移成功
    console.log('✅ [VideoPreview] Frame displayed successfully:', frameIndex);
    
    // ... 更新状态 ...
  } catch (error) {
    console.error('❌ [VideoPreview] Display error:', error);
  }
}
```

---

## 🧪 **测试步骤**

1. **重新编译项目**（确保新代码生效）
   ```bash
   npm run build  # 或 npm run dev
   ```

2. **清除浏览器缓存并强制刷新** (Cmd+Shift+R on Mac)

3. **打开浏览器控制台**

4. **录制视频 → 点击"裁剪" → 调整区域 → 点击"应用裁剪"**

5. **立即检查控制台日志**

---

## 📊 **预期日志序列**

### **如果一切正常：**
```
⚙️ [COMPOSITE-WORKER] Updating config...
📐 [COMPOSITE-WORKER] Layout calculation: {...}
🔍 [COMPOSITE-WORKER] Checking frame render conditions: {hasFrame: true, hasLayout: true, ...}
✅ [COMPOSITE-WORKER] Rendering frame for config update: 0
✂️ [COMPOSITE-WORKER] Applying video crop: {...}
✅ [COMPOSITE-WORKER] Crop rendered successfully: {...}
🖼️ [COMPOSITE-WORKER] renderCompositeFrame returned: {hasBitmap: true, width: 1920, height: 1080}
📤 [COMPOSITE-WORKER] Sending frame bitmap to main thread...
✅ [COMPOSITE-WORKER] Frame bitmap sent successfully from config handler
📺 [VideoPreview] Received frame from worker: {...}
📀 [VideoPreview] displayFrame called: {...}
🎨 [VideoPreview] Transferring bitmap to canvas...
✅ [VideoPreview] Frame displayed successfully: 0
```

### **如果条件不满足：**
```
⚙️ [COMPOSITE-WORKER] Updating config...
📐 [COMPOSITE-WORKER] Layout calculation: {...}
🔍 [COMPOSITE-WORKER] Checking frame render conditions: {hasFrame: false/hasLayout: false, ...}
⚠️ [COMPOSITE-WORKER] Cannot render frame in config handler - conditions not met
```

### **如果渲染返回 null：**
```
⚙️ [COMPOSITE-WORKER] Updating config...
📐 [COMPOSITE-WORKER] Layout calculation: {...}
🔍 [COMPOSITE-WORKER] Checking frame render conditions: {hasFrame: true, hasLayout: true, ...}
✅ [COMPOSITE-WORKER] Rendering frame for config update: 0
✂️ [COMPOSITE-WORKER] Applying video crop: {...}
🖼️ [COMPOSITE-WORKER] renderCompositeFrame returned: {hasBitmap: false, width: undefined, height: undefined}
❌ [COMPOSITE-WORKER] renderCompositeFrame returned null in config handler!
```

---

## 🎯 **诊断决策树**

```
日志中是否有 "🔍 Checking frame render conditions"?
├─ 否 → calculateAndCacheLayout() 之前就出错了
│
├─ 是 → 检查日志内容
   ├─ hasFrame: false → decodedFrames 为空或索引越界
   ├─ hasLayout: false → fixedVideoLayout 为 null（calculateAndCacheLayout 失败）
   │
   ├─ 两者都是 true → 检查下一条日志
      ├─ 有 "✅ Rendering frame for config update" → 进入了渲染流程
      │  ├─ 检查 "🖼️ renderCompositeFrame returned"
      │     ├─ hasBitmap: false → renderCompositeFrame 返回 null
      │     │  → 检查 Worker 中是否有 "❌ Canvas not initialized" 或其他错误
      │     │
      │     ├─ hasBitmap: true → 渲染成功
      │        ├─ 有 "📤 Sending frame" → 消息已发送
      │        │  ├─ 主线程有 "📺 Received frame" → 消息已接收
      │        │  │  ├─ 有 "📀 displayFrame called" → displayFrame 被调用
      │        │  │  │  ├─ 有 "✅ Frame displayed" → 成功！应该能看到画面
      │        │  │  │  └─ 无 "✅ Frame displayed" → transferFromImageBitmap 失败
      │        │  │  └─ 无 "📀 displayFrame called" → isCropMode检查失败或被跳过
      │        │  └─ 主线程无 "📺 Received frame" → Worker 消息丢失（极罕见）
      │        └─ 无 "📤 Sending frame" → 不应该发生（if bitmap 应该为 true）
      │
      └─ 无 "✅ Rendering frame" → 不应该发生（条件应该满足）
```

---

## 🚀 **下一步行动**

请重新测试并提供：
1. **完整的控制台日志**（从点击"应用裁剪"开始到黑屏结束）
2. **特别关注以下关键日志：**
   - `🔍 [COMPOSITE-WORKER] Checking frame render conditions`
   - `🖼️ [COMPOSITE-WORKER] renderCompositeFrame returned`
   - `📤 [COMPOSITE-WORKER] Sending frame bitmap`
   - `📺 [VideoPreview] Received frame from worker`

根据日志输出，我们就能精确定位问题点！ 🎯
