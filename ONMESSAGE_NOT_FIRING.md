# 🚨 黑屏问题 - onmessage 未触发

## 🎯 问题确认

**Worker 端：**
- ✅ 渲染成功（有 "Frame rendered" 日志）
- ✅ 发送消息成功（有 "Frame bitmap sent" 日志）
- ✅ 发送了 2 次（config 一次 + seek 一次）

**主线程：**
- ❌ 完全没有 `📨 [VideoPreview] Worker message received` 日志
- ❌ 说明 `compositeWorker.onmessage` 根本没有被触发！

---

## 💡 可能的根本原因

### **原因 1：Worker 被替换或销毁** 🎯

**检查点：**
```typescript
// 在 updateBackgroundConfig() 或其他地方是否重新创建了 Worker？
compositeWorker = new Worker(...)  // ← 这会销毁旧的监听器！
```

### **原因 2：消息被 addEventListener 拦截**

在 `enterCropMode()` 中（第 880 行）：
```typescript
compositeWorker!.addEventListener('message', handler, { once: false })
```

虽然理论上 `addEventListener` 和 `onmessage` 应该并行工作，但可能存在某些边界情况。

### **原因 3：组件重新渲染导致闭包失效**

Svelte 的响应式更新可能导致 `compositeWorker.onmessage` 被重新赋值或失效。

---

## 🔧 已添加的诊断

### **1. 消息计数器**
```typescript
let workerMessageCount = 0

compositeWorker.onmessage = (event) => {
  workerMessageCount++
  console.log(`📨 [VideoPreview] Worker message #${workerMessageCount} received:`, ...)
}
```

### **2. 详细消息内容**
```typescript
console.log(`📨 [VideoPreview] Worker message #${workerMessageCount} received:`, event.data.type, {
  type: event.data.type,
  hasData: !!event.data.data,
  hasBitmap: !!event.data.data?.bitmap
})
```

---

## 🧪 测试步骤

1. **重新启动开发服务器**
2. **清除缓存并刷新浏览器** (Cmd+Shift+R)
3. **打开控制台**
4. **录制视频**
5. **观察日志中的消息计数：**
   - 应该看到 `📨 [VideoPreview] Worker message #1 received: ready`
   - 应该看到 `📨 [VideoPreview] Worker message #2 received: frame`
   - 等等...

6. **点击"裁剪" → 调整 → "应用裁剪"**
7. **检查是否有新的 `📨 Worker message` 日志**

---

## 📊 预期结果

### **如果 onmessage 正常工作：**
```
📨 [VideoPreview] Worker message #1 received: initialized
📨 [VideoPreview] Worker message #2 received: ready
📨 [VideoPreview] Worker message #3 received: frame
...
[应用裁剪后]
📨 [VideoPreview] Worker message #X received: frame  ← config 触发的
📺 [VideoPreview] Received frame from worker: {...}
📀 [VideoPreview] displayFrame called: {...}
✅ [VideoPreview] Frame displayed successfully: 0

📨 [VideoPreview] Worker message #Y received: frame  ← seek 触发的
📺 [VideoPreview] Received frame from worker: {...}
📀 [VideoPreview] displayFrame called: {...}
✅ [VideoPreview] Frame displayed successfully: 0
```

### **如果 onmessage 不工作（当前状态）：**
```
📨 [VideoPreview] Worker message #1 received: initialized
📨 [VideoPreview] Worker message #2 received: ready
📨 [VideoPreview] Worker message #3 received: frame
...
[应用裁剪后]
❌ 没有任何 "📨 Worker message" 日志
❌ Worker 发送了消息但主线程没有收到
```

---

## 🔍 进一步诊断

### **如果消息计数器停止增长：**

**检查 1：Worker 是否存活？**
```javascript
// 在浏览器控制台运行
window.compositeWorker  // 应该能访问到 Worker 对象
```

**检查 2：手动发送测试消息**
```javascript
// 在浏览器控制台运行
if (window.compositeWorker) {
  window.compositeWorker.postMessage({ type: 'test' })
  // 应该看到错误或日志
}
```

**检查 3：addEventListener 是否干扰**
```typescript
// 修改 enterCropMode，移除 addEventListener，改用全局标志位
// 在 compositeWorker.onmessage 中检查标志位来处理 frameBitmap
```

---

## 💡 临时解决方案

### **方案 A：使用全局消息处理**

将 `frameBitmap` 的处理移到 `compositeWorker.onmessage` 的 `case` 中：

```typescript
// 在 enterCropMode 中设置标志
let waitingForFrameBitmap = false
let frameBitmapResolver: ((bitmap: ImageBitmap) => void) | null = null

async function enterCropMode() {
  // ...
  
  const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
    const timeout = setTimeout(() => {
      waitingForFrameBitmap = false
      frameBitmapResolver = null
      reject(new Error('Timeout'))
    }, 3000)
    
    waitingForFrameBitmap = true
    frameBitmapResolver = (bitmap) => {
      clearTimeout(timeout)
      waitingForFrameBitmap = false
      frameBitmapResolver = null
      resolve(bitmap)
    }
  })
  
  compositeWorker.postMessage({
    type: 'getCurrentFrameBitmap',
    data: { frameIndex: currentFrameIndex }
  })
  
  // ...
}

// 在 compositeWorker.onmessage 中
case 'frameBitmap':
  if (waitingForFrameBitmap && frameBitmapResolver) {
    frameBitmapResolver(data.bitmap)
  }
  break
```

### **方案 B：完全移除 addEventListener**

检查是否可以直接在 `onmessage` 中处理所有消息，不使用 `addEventListener`。

---

## 🚀 下一步

1. **测试并提供新的日志**（特别关注消息计数器）
2. **如果消息计数器确认 onmessage 未触发，尝试方案 A**
3. **如果方案 A 有效，说明问题确实在 addEventListener**

请提供测试结果！ 🔬
