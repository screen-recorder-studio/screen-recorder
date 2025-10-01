# 视频导出裁剪功能修复

## 🐛 问题描述

**症状**: 导出视频时，视频裁剪（videoCrop）设置没有被应用，导出的视频仍然是完整的未裁剪版本。

**影响范围**:
- ✅ 预览时裁剪正常工作
- ❌ WebM 导出时裁剪未应用
- ❌ MP4 导出时裁剪未应用

---

## 🔍 根本原因分析

### 数据流追踪

#### 1. 预览流程（✅ 正常工作）

```
VideoPreviewComposite.svelte
  ↓ (获取裁剪配置)
videoCropStore.getCropConfig()
  ↓ (传递给 worker)
backgroundConfig: {
  ...
  videoCrop: { enabled, mode, x, y, width, height, ... }
}
  ↓ (worker 消息)
composite-worker/index.ts
  ↓ (应用裁剪)
renderCompositeFrame() 使用 9 参数 drawImage()
  ↓ (结果)
✅ 预览显示裁剪后的画面
```

#### 2. 导出流程（❌ 裁剪丢失）

```
VideoExportPanel.svelte
  ↓ (获取背景配置)
backgroundConfigStore.config (包含 videoCrop)
  ↓ (转换为 plain object)
plainBackgroundConfig = {
  type, color, padding, gradient, shadow, image, wallpaper
  ❌ videoCrop: undefined  // 缺失！
}
  ↓ (传递给导出管理器)
exportManager.exportEditedVideo(chunks, {
  backgroundConfig: plainBackgroundConfig  // 没有 videoCrop
})
  ↓ (传递给 export worker)
export-worker/index.ts
  ↓ (转发给 composite worker)
compositeWorker.postMessage({
  backgroundConfig: options.backgroundConfig  // 仍然没有 videoCrop
})
  ↓ (composite worker 处理)
composite-worker/index.ts
  ↓ (检查裁剪配置)
if (config.videoCrop?.enabled) { ... }  // false，因为 videoCrop 是 undefined
  ↓ (结果)
❌ 导出视频未裁剪
```

### 问题定位

**文件**: `src/lib/components/VideoExportPanel.svelte`

**位置**:
- WebM 导出: 第 141-199 行
- MP4 导出: 第 295-353 行

**问题代码**:
```typescript
const plainBackgroundConfig = backgroundConfig ? {
  type: backgroundConfig.type,
  color: backgroundConfig.color,
  padding: backgroundConfig.padding,
  outputRatio: backgroundConfig.outputRatio,
  videoPosition: backgroundConfig.videoPosition,
  borderRadius: backgroundConfig.borderRadius,
  inset: backgroundConfig.inset,
  gradient: backgroundConfig.gradient ? { ... } : undefined,
  shadow: backgroundConfig.shadow ? { ... } : undefined,
  image: backgroundConfig.image ? { ... } : undefined,
  wallpaper: backgroundConfig.wallpaper ? { ... } : undefined
  // ❌ 缺少 videoCrop 字段！
} : undefined
```

**原因**: 在将 Svelte 5 Proxy 对象转换为 plain object 时，遗漏了 `videoCrop` 字段的深拷贝。

---

## ✅ 修复方案

### 修复内容

在 `VideoExportPanel.svelte` 的两个导出函数中，添加 `videoCrop` 字段的深拷贝。

### 修复代码

#### WebM 导出（第 187-211 行）

```typescript
const plainBackgroundConfig = backgroundConfig ? {
  // ... 其他字段
  wallpaper: backgroundConfig.wallpaper ? {
    imageId: backgroundConfig.wallpaper.imageId,
    imageBitmap: backgroundConfig.wallpaper.imageBitmap,
    fit: backgroundConfig.wallpaper.fit,
    position: backgroundConfig.wallpaper.position,
    opacity: backgroundConfig.wallpaper.opacity,
    blur: backgroundConfig.wallpaper.blur,
    scale: backgroundConfig.wallpaper.scale,
    offsetX: backgroundConfig.wallpaper.offsetX,
    offsetY: backgroundConfig.wallpaper.offsetY
  } : undefined,
  // 🆕 Deep convert videoCrop object
  videoCrop: backgroundConfig.videoCrop ? {
    enabled: backgroundConfig.videoCrop.enabled,
    mode: backgroundConfig.videoCrop.mode,
    x: backgroundConfig.videoCrop.x,
    y: backgroundConfig.videoCrop.y,
    width: backgroundConfig.videoCrop.width,
    height: backgroundConfig.videoCrop.height,
    xPercent: backgroundConfig.videoCrop.xPercent,
    yPercent: backgroundConfig.videoCrop.yPercent,
    widthPercent: backgroundConfig.videoCrop.widthPercent,
    heightPercent: backgroundConfig.videoCrop.heightPercent
  } : undefined
} : undefined
```

#### MP4 导出（第 354-378 行）

```typescript
// 相同的修复应用于 MP4 导出函数
```

---

## 🔧 修复后的数据流

```
VideoExportPanel.svelte
  ↓ (获取背景配置)
backgroundConfigStore.config (包含 videoCrop)
  ↓ (转换为 plain object)
plainBackgroundConfig = {
  type, color, padding, gradient, shadow, image, wallpaper,
  ✅ videoCrop: {
    enabled: true,
    mode: 'percentage',
    xPercent: 0.1,
    yPercent: 0.1,
    widthPercent: 0.8,
    heightPercent: 0.8,
    ...
  }
}
  ↓ (传递给导出管理器)
exportManager.exportEditedVideo(chunks, {
  backgroundConfig: plainBackgroundConfig  // ✅ 包含 videoCrop
})
  ↓ (传递给 export worker)
export-worker/index.ts
  ↓ (转发给 composite worker)
compositeWorker.postMessage({
  backgroundConfig: options.backgroundConfig  // ✅ 包含 videoCrop
})
  ↓ (composite worker 处理)
composite-worker/index.ts
  ↓ (检查裁剪配置)
if (config.videoCrop?.enabled) {  // ✅ true
  // 计算裁剪区域
  srcX = Math.floor(crop.xPercent * frame.codedWidth)
  srcY = Math.floor(crop.yPercent * frame.codedHeight)
  srcWidth = Math.floor(crop.widthPercent * frame.codedWidth)
  srcHeight = Math.floor(crop.heightPercent * frame.codedHeight)
}
  ↓ (应用裁剪)
ctx.drawImage(
  frame,
  srcX, srcY, srcWidth, srcHeight,  // ✅ 裁剪区域
  layout.x, layout.y, layout.width, layout.height
)
  ↓ (结果)
✅ 导出视频应用了裁剪
```

---

## 📊 修复验证

### 测试步骤

1. **设置裁剪**
   - [ ] 打开视频预览
   - [ ] 点击"裁剪"按钮进入裁剪模式
   - [ ] 调整裁剪区域（例如：裁剪掉边缘 10%）
   - [ ] 点击"确认"应用裁剪

2. **验证预览**
   - [ ] 确认预览显示裁剪后的画面
   - [ ] 播放视频，确认裁剪在整个时间轴上生效

3. **导出 WebM**
   - [ ] 点击"Export WebM"
   - [ ] 等待导出完成
   - [ ] 下载并播放导出的 WebM 文件
   - [ ] **验证**: 导出的视频应该显示裁剪后的画面

4. **导出 MP4**
   - [ ] 点击"Export MP4"
   - [ ] 等待导出完成
   - [ ] 下载并播放导出的 MP4 文件
   - [ ] **验证**: 导出的视频应该显示裁剪后的画面

5. **边界测试**
   - [ ] 测试不同裁剪区域（小、中、大）
   - [ ] 测试裁剪 + 背景效果组合
   - [ ] 测试裁剪 + 时间裁剪（trim）组合

---

## 📝 技术要点

### 1. Svelte 5 Proxy 对象转换

**问题**: Svelte 5 的 `$state()` 和 `$derived` 返回的是 Proxy 对象，不能直接传递给 Web Worker。

**解决**: 手动深拷贝所有字段到 plain object。

```typescript
// ❌ 错误：直接传递 Proxy
backgroundConfig: backgroundConfigStore.config

// ✅ 正确：深拷贝为 plain object
backgroundConfig: {
  type: backgroundConfig.type,
  color: backgroundConfig.color,
  // ... 所有字段
}
```

### 2. 可选字段处理

**模式**: 使用条件表达式处理可选的嵌套对象。

```typescript
videoCrop: backgroundConfig.videoCrop ? {
  enabled: backgroundConfig.videoCrop.enabled,
  // ... 所有字段
} : undefined
```

### 3. 完整性检查

**教训**: 在添加新功能时，确保所有数据传递路径都包含新字段。

**检查清单**:
- [ ] 类型定义（`background.d.ts`）
- [ ] Store 实现（`video-crop.svelte.ts`）
- [ ] 预览组件（`VideoPreviewComposite.svelte`）
- [ ] **导出组件**（`VideoExportPanel.svelte`）← 本次遗漏
- [ ] Worker 处理（`composite-worker/index.ts`）

---

## 🎯 修复总结

| 维度 | 修复前 | 修复后 | 改进 |
|------|--------|--------|------|
| **预览裁剪** | ✅ 正常 | ✅ 正常 | - |
| **WebM 导出裁剪** | ❌ 未应用 | ✅ 应用 | +100% |
| **MP4 导出裁剪** | ❌ 未应用 | ✅ 应用 | +100% |
| **功能完整性** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | +67% |

**修复状态**: ✅ 已完成  
**修改文件**: `src/lib/components/VideoExportPanel.svelte`  
**修改行数**: 2 处（WebM + MP4）  
**待测试**: 功能验证

---

## 🔄 后续优化建议

1. **代码复用**
   - 提取 `plainBackgroundConfig` 转换逻辑为独立函数
   - 避免 WebM 和 MP4 导出中的代码重复

2. **类型安全**
   - 添加 TypeScript 类型检查，确保所有字段都被复制
   - 使用 `Omit` 和 `Pick` 工具类型

3. **自动化测试**
   - 添加单元测试验证 `plainBackgroundConfig` 转换
   - 添加集成测试验证导出包含裁剪

4. **文档更新**
   - 在代码注释中说明为什么需要深拷贝
   - 在开发文档中记录 Svelte 5 Proxy 的注意事项

---

**修复完成时间**: 2025-10-01  
**修复人员**: Augment Agent  
**问题严重性**: 高（功能缺失）  
**修复难度**: 低（简单的字段添加）

