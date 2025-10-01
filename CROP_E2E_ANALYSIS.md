# 🔬 视频裁剪功能 - 端到端数据流分析

## 📊 完整数据流程图

```
用户操作                 VideoCropPanel              videoCropStore              VideoPreviewComposite            Worker (composite-worker)
   |                          |                           |                              |                                   |
   | 1. 点击"裁剪"             |                           |                              |                                   |
   |------------------------->|                           |                              |                                   |
   |                          | enterCropMode()           |                              |                                   |
   |                          |-------------------------->|                              |                                   |
   |                          |                           | getCurrentFrameBitmap ------>|                                   |
   |                          |                           |                              |--- type: 'getCurrentFrameBitmap' ->|
   |                          |                           |                              |                                   |
   |                          |                           |                              |<-- type: 'frameBitmap' -----------|
   |                          |<-- frameBitmap -----------|                              |                                   |
   |                          |                           |                              |                                   |
   | 2. 拖拽调整裁剪区域       |                           |                              |                                   |
   |------------------------->| cropBox.x/y/width/height  |                              |                                   |
   |                          | (视频像素坐标)             |                              |                                   |
   |                          |                           |                              |                                   |
   | 3. 点击"应用裁剪"         |                           |                              |                                   |
   |------------------------->| applyCrop()               |                              |                                   |
   |                          |-------------------------->| store.enabled = true         |                                   |
   |                          |                           | store.mode = 'percentage'    |                                   |
   |                          |                           | store.xPercent = x/width     |                                   |
   |                          |                           | store.yPercent = y/height    |                                   |
   |                          |                           | store.widthPercent = w/width |                                   |
   |                          |                           | store.heightPercent = h/height|                                  |
   |                          |                           |                              |                                   |
   |                          | onConfirm()               |                              |                                   |
   |                          |---------------------------------------------->| exitCropMode(true)                 |
   |                          |                           |                              |                                   |
   |                          |                           |                              | isCropMode = false                |
   |                          |                           |                              |                                   |
   |                          |                           |                              | updateBackgroundConfig() --------->|
   |                          |                           |                              |--- type: 'config' ---------------->|
   |                          |                           |                              |    data: {                         |
   |                          |                           |                              |      videoCrop: {                  |
   |                          |                           |                              |        enabled: true               |
   |                          |                           |                              |        mode: 'percentage'          |
   |                          |                           |                              |        xPercent: 0.1               |
   |                          |                           |                              |        yPercent: 0.1               |
   |                          |                           |                              |        widthPercent: 0.8           |
   |                          |                           |                              |        heightPercent: 0.8          |
   |                          |                           |                              |      }                             |
   |                          |                           |                              |    }                               |
   |                          |                           |                              |                                   |
   |                          |                           |                              |                                   |- currentConfig = newConfig
   |                          |                           |                              |                                   |- calculateAndCacheLayout()
   |                          |                           |                              |                                   |  - effectiveWidth = width * widthPercent
   |                          |                           |                              |                                   |  - effectiveHeight = height * heightPercent
   |                          |                           |                              |                                   |  - 重新计算 fixedVideoLayout
   |                          |                           |                              |                                   |
   |                          |                           |                              |                                   |- renderCompositeFrame()
   |                          |                           |                              |                                   |  - srcX = xPercent * frameWidth
   |                          |                           |                              |                                   |  - srcY = yPercent * frameHeight
   |                          |                           |                              |                                   |  - srcWidth = widthPercent * frameWidth
   |                          |                           |                              |                                   |  - srcHeight = heightPercent * frameHeight
   |                          |                           |                              |                                   |  - ctx.drawImage(frame, srcX, srcY, srcWidth, srcHeight, ...)
   |                          |                           |                              |                                   |
   |                          |                           |                              |<-- type: 'frame' ------------------|
   |                          |                           |                              |    data: { bitmap, frameIndex }   |
   |                          |                           |                              |                                   |
   |                          |                           |                              | displayFrame(bitmap) ❌ 黑屏?     |
   |                          |                           |                              |                                   |
   |                          |                           |                              | seekToFrame(savedFrameIndex) ---->|
   |                          |                           |                              |--- type: 'seek' ------------------>|
   |                          |                           |                              |                                   |- renderCompositeFrame() (使用新裁剪参数)
   |                          |                           |                              |<-- type: 'frame' ------------------|
   |                          |                           |                              | displayFrame(bitmap) ✅ 应该显示   |
```

---

## 🔍 关键代码路径追踪

### **1. 裁剪参数设置（VideoCropPanel.svelte:269-295）**

```typescript
function applyCrop() {
  // 转换为百分比（基于视频像素尺寸）
  videoCropStore.enabled = true
  videoCropStore.mode = 'percentage'
  videoCropStore.xPercent = cropBox.x / videoWidth      // 例如：200/1920 = 0.104
  videoCropStore.yPercent = cropBox.y / videoHeight      // 例如：100/1080 = 0.093
  videoCropStore.widthPercent = cropBox.width / videoWidth   // 例如：1520/1920 = 0.792
  videoCropStore.heightPercent = cropBox.height / videoHeight // 例如：880/1080 = 0.815
  
  // 同步像素坐标（用于显示）
  videoCropStore.x = cropBox.x
  videoCropStore.y = cropBox.y
  videoCropStore.width = cropBox.width
  videoCropStore.height = cropBox.height
  
  onConfirm?.()  // 触发 VideoPreviewComposite 的 exitCropMode(true)
}
```

---

### **2. 配置传递给 Worker（VideoPreviewComposite.svelte:1161）**

```typescript
async function updateBackgroundConfig(newConfig: typeof backgroundConfig) {
  const plainConfig = {
    type: newConfig.type,
    color: newConfig.color,
    padding: newConfig.padding,
    // ... 其他配置 ...
    
    // 🆕 关键：裁剪配置通过 getCropConfig() 获取
    videoCrop: videoCropStore.getCropConfig()
    //           ↓
    //       返回 {
    //         enabled: true,
    //         mode: 'percentage',
    //         xPercent: 0.104,
    //         yPercent: 0.093,
    //         widthPercent: 0.792,
    //         heightPercent: 0.815
    //       }
  }
  
  compositeWorker.postMessage({
    type: 'config',
    data: { backgroundConfig: plainConfig }
  })
}
```

---

### **3. Worker 布局计算（composite-worker/index.ts:158-176）**

```typescript
function calculateVideoLayout(...) {
  let effectiveWidth = videoWidth    // 例如：1920
  let effectiveHeight = videoHeight  // 例如：1080
  
  if (config.videoCrop?.enabled) {
    const crop = config.videoCrop
    if (crop.mode === 'percentage') {
      // 🔧 使用裁剪后的尺寸计算布局
      effectiveWidth = Math.floor(videoWidth * crop.widthPercent)   // 1920 * 0.792 = 1520
      effectiveHeight = Math.floor(videoHeight * crop.heightPercent) // 1080 * 0.815 = 880
    }
    
    console.log('📐 [COMPOSITE-WORKER] Layout using cropped dimensions:', {
      original: { width: videoWidth, height: videoHeight },
      cropped: { width: effectiveWidth, height: effectiveHeight }
    })
  }
  
  // 使用 effectiveWidth/Height 计算布局
  const videoAspectRatio = effectiveWidth / effectiveHeight  // 1520/880 = 1.727
  // ... 计算 layout.x, layout.y, layout.width, layout.height
}
```

---

### **4. Worker 帧渲染（composite-worker/index.ts:564-615）**

```typescript
function renderCompositeFrame(frame: VideoFrame, layout: VideoLayout, config: BackgroundConfig) {
  // 默认使用整个帧
  let srcX = 0, srcY = 0, srcWidth = frame.codedWidth, srcHeight = frame.codedHeight
  
  if (config.videoCrop?.enabled) {
    const crop = config.videoCrop
    
    if (crop.mode === 'percentage') {
      // 🔧 计算裁剪区域（帧像素坐标）
      srcX = Math.floor(crop.xPercent * frame.codedWidth)      // 0.104 * 1920 = 200
      srcY = Math.floor(crop.yPercent * frame.codedHeight)     // 0.093 * 1080 = 100
      srcWidth = Math.floor(crop.widthPercent * frame.codedWidth)   // 0.792 * 1920 = 1520
      srcHeight = Math.floor(crop.heightPercent * frame.codedHeight) // 0.815 * 1080 = 880
    }
    
    // 边界检查
    srcX = Math.max(0, Math.min(srcX, frame.codedWidth))
    srcY = Math.max(0, Math.min(srcY, frame.codedHeight))
    srcWidth = Math.min(srcWidth, frame.codedWidth - srcX)
    srcHeight = Math.min(srcHeight, frame.codedHeight - srcY)
    
    console.log('✂️ [COMPOSITE-WORKER] Applying video crop:', {
      mode: crop.mode,
      original: { width: frame.codedWidth, height: frame.codedHeight },
      crop: { x: srcX, y: srcY, width: srcWidth, height: srcHeight }
    })
  }
  
  // 🎨 使用 9 参数 drawImage 绘制裁剪后的区域
  ctx.drawImage(
    frame,
    srcX, srcY, srcWidth, srcHeight,                    // 源区域（裁剪）
    layout.x, layout.y, layout.width, layout.height      // 目标区域
  )
  
  return offscreenCanvas.transferToImageBitmap()
}
```

---

## ❌ **黑屏问题的可能原因**

### **原因 1：Worker 发送的 frame 消息没有被主线程显示** 🎯

**症状：**
- Worker 日志显示：`✅ [COMPOSITE-WORKER] Frame bitmap sent: 0`
- 主线程日志**缺失**：`📺 [VideoPreview] Received frame from worker`

**诊断：**
```javascript
// 在浏览器控制台运行，检查是否收到 frame 消息
// 应该看到至少 2 条日志（config 触发一次，seekToFrame 触发一次）
```

**根本原因分析：**

查看 Worker 的 `case 'config':` 处理（composite-worker/index.ts:1387-1401）：

```typescript
case 'config':
  console.log('⚙️ [COMPOSITE-WORKER] Updating config...')
  if (data.backgroundConfig) {
    currentConfig = data.backgroundConfig
    
    // 重新计算固定布局
    calculateAndCacheLayout()
    
    // 🔧 重新渲染当前帧
    if (decodedFrames[currentFrameIndex] && fixedVideoLayout) {
      const frame = decodedFrames[currentFrameIndex]
      
      const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig)
      if (bitmap) {
        self.postMessage({
          type: 'frame',
          data: {
            bitmap,
            frameIndex: currentFrameIndex,
            timestamp: frame.timestamp
          }
        }, { transfer: [bitmap] })
      }
    }
  }
  break
```

**问题：** 检查条件 `if (decodedFrames[currentFrameIndex] && fixedVideoLayout)`

可能原因：
1. `currentFrameIndex` 越界
2. `decodedFrames` 为空
3. `fixedVideoLayout` 为 `null`

---

### **原因 2：`isCropMode` 状态时序问题** ⚠️

**代码路径：**

1. 用户点击"应用裁剪"
2. `applyCrop()` 调用 `onConfirm()`
3. `exitCropMode(true)` 被调用
4. **`isCropMode = false`** ← 立即执行
5. 调用 `updateBackgroundConfig()` ← 异步
6. Worker 收到 `type: 'config'`
7. Worker 发送 `type: 'frame'`
8. 主线程收到 `type: 'frame'`
9. 检查 `if (!isCropMode)` ← **此时 `isCropMode` 已经是 `false`**
10. 调用 `displayFrame(bitmap)` ← 应该显示

**但是：** 如果 `displayFrame()` 执行失败怎么办？

---

### **原因 3：`bitmapCtx` 失效或 Canvas 未初始化** 🔥

**检查 `displayFrame()` 函数（VideoPreviewComposite.svelte:532-571）：**

```typescript
function displayFrame(bitmap: ImageBitmap, frameIndex: number, timestamp: number) {
  if (!bitmapCtx) {
    console.error('❌ [VideoPreview] Bitmap context not available')
    return
  }
  
  try {
    // 高效显示 ImageBitmap
    bitmapCtx.transferFromImageBitmap(bitmap)
    
    // 更新播放状态
    currentFrameIndex = frameIndex
    lastFrameWindowStartIndex = windowStartIndex
    currentTime = (lastFrameWindowStartIndex + frameIndex) / frameRate
  } catch (error) {
    console.error('❌ [VideoPreview] Display error:', error)
  }
}
```

**可能问题：**
- `bitmapCtx` 为 `null`（Canvas 未初始化）
- `transferFromImageBitmap()` 抛出异常
- **Canvas 被 React/Svelte 的 reconciliation 重新创建，导致 `bitmapCtx` 失效**

---

## 🔧 **紧急诊断和修复**

### **诊断步骤 1：添加详细日志到 displayFrame()**

<function_calls>
<invoke name="edit_files">
<parameter name="title">添加 displayFrame 详细日志