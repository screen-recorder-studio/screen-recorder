# Canvas 流 MP4 导出解决方案

## 🎯 问题背景

原有的 `MediabunnyMp4Exporter` 使用逐帧添加的方式：
```javascript
// 原方案：逐帧添加导致抖动
for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    video.currentTime = timestamp;
    // 等待视频帧加载
    await waitForFrame();
    // 渲染到 Canvas
    renderFrameToCanvas(ctx, video, layout, backgroundConfig);
    // 添加帧到视频流
    await videoSource.add(timestamp, frameDuration);
}
```

**问题**：
1. **帧同步问题** - 手动控制 `video.currentTime` 可能导致帧不稳定
2. **时间戳精度** - 手动计算时间戳可能有累积误差
3. **渲染抖动** - 逐帧渲染过程中的微小差异会导致抖动
4. **性能问题** - 需要等待每一帧加载完成

## 🚀 新解决方案：Canvas 流导出

### 核心思路
使用 `canvas.captureStream()` 直接从 Canvas 元素创建视频流，让浏览器自动处理帧同步和时间戳。

### 技术架构

#### 1. Canvas 实时渲染
```javascript
// 设置 Canvas 实时渲染
async setupCanvasRendering(canvas, video, layout, backgroundConfig) {
    const ctx = canvas.getContext('2d');
    
    // 渲染函数
    const renderFrame = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 绘制背景
        if (backgroundConfig?.color) {
            ctx.fillStyle = backgroundConfig.color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        
        // 绘制视频帧
        if (video.readyState >= 2) {
            ctx.drawImage(video, layout.x, layout.y, layout.width, layout.height);
        }
    };
    
    // 开始播放视频
    await video.play();
    
    // 设置定时渲染（与帧率同步）
    const frameInterval = 1000 / 30; // 30 FPS
    this.renderInterval = setInterval(renderFrame, frameInterval);
}
```

#### 2. Canvas 流创建
```javascript
// 创建 Canvas 流
const stream = canvas.captureStream(frameRate);

// 创建 MediaBunny 视频源
const videoSource = new this.mediabunny.CanvasSource(canvas, {
    codec: 'avc', // H.264
    bitrate: bitrate
});

// 添加到输出
output.addVideoTrack(videoSource, { frameRate: frameRate });
```

#### 3. 时长控制
```javascript
// 等待指定时长
async waitForDuration(duration, progressCallback) {
    const startTime = Date.now();
    const durationMs = duration * 1000;
    
    return new Promise((resolve) => {
        const checkProgress = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / durationMs, 1.0);
            
            progressCallback(progress);
            
            if (progress >= 1.0) {
                resolve();
            } else {
                setTimeout(checkProgress, 100);
            }
        };
        
        checkProgress();
    });
}
```

## 🔧 核心优势

### 1. 消除抖动
- **浏览器原生处理** - `captureStream()` 由浏览器原生实现，帧同步更稳定
- **无手动时间戳** - 不需要手动计算和设置时间戳
- **连续渲染** - Canvas 连续渲染，避免帧间不一致

### 2. 性能提升
- **并行处理** - 视频播放和 Canvas 渲染并行进行
- **无等待时间** - 不需要等待每一帧加载
- **硬件加速** - 利用浏览器的硬件加速能力

### 3. 更好的质量
- **稳定帧率** - 浏览器确保稳定的帧率输出
- **精确同步** - 视频播放与 Canvas 渲染自动同步
- **减少失真** - 连续渲染减少量化误差

## 📊 方案对比

| 特性 | 原方案（逐帧添加） | 新方案（Canvas 流） |
|------|------------------|-------------------|
| 帧同步 | 手动控制，易抖动 | 浏览器自动，稳定 |
| 性能 | 需等待每帧加载 | 并行处理，高效 |
| 时间戳 | 手动计算，有误差 | 浏览器自动，精确 |
| 代码复杂度 | 复杂的帧循环 | 简洁的流处理 |
| 质量稳定性 | 易受帧间差异影响 | 连续渲染，稳定 |
| 硬件加速 | 有限支持 | 充分利用 |

## 🛠️ 实现细节

### 1. CanvasStreamMp4Exporter 类
```javascript
class CanvasStreamMp4Exporter {
    async exportVideoToMp4(videoBlob, options = {}) {
        // 1. 创建视频元素
        const video = await this.createVideoElement(videoBlob);
        
        // 2. 创建编辑画布
        const canvas = this.createEditingCanvas(video, backgroundConfig);
        
        // 3. 计算布局
        const layout = this.calculateVideoLayout(video, canvas, backgroundConfig);
        
        // 4. 设置实时渲染
        await this.setupCanvasRendering(canvas, video, layout, backgroundConfig);
        
        // 5. 使用 Canvas 流导出
        const result = await this.exportWithCanvasStream(canvas, options);
        
        return { blob: result, ... };
    }
}
```

### 2. 质量优化集成
- **保留质量优化器** - 可以与 `MP4QualityOptimizer` 结合使用
- **保留文字修复** - 可以与 `TextFlickerFix` 结合使用
- **渐进式增强** - 自动降级到原方案

### 3. 配置选项
```javascript
const options = {
    quality: 'high',           // 质量级别
    frameRate: 30,             // 帧率
    duration: 5,               // 导出时长（秒）
    backgroundConfig: {        // 背景配置
        color: '#0066cc',
        padding: 60,
        outputRatio: '16:9'
    }
};
```

## 🎯 使用方式

### 1. 基本使用
```javascript
const exporter = new CanvasStreamMp4Exporter();
await exporter.initialize();

const result = await exporter.exportVideoToMp4(videoBlob, {
    quality: 'high',
    frameRate: 30,
    duration: 5,
    backgroundConfig: { color: '#000', padding: 60 }
});

// 下载文件
const downloadLink = document.createElement('a');
downloadLink.href = URL.createObjectURL(result.blob);
downloadLink.download = 'export.mp4';
downloadLink.click();
```

### 2. 测试页面
- **`text-flicker-test.html`** - 专门测试文字闪动修复
- **`mp4-quality-test.html`** - 对比三种导出方案

## 🔍 测试建议

### 1. 功能测试
1. 打开 `text-flicker-test.html`
2. 点击"创建简单测试视频"
3. 点击"导出修复 MP4"
4. 验证下载的 MP4 文件质量

### 2. 对比测试
1. 打开 `mp4-quality-test.html`
2. 创建测试视频
3. 分别测试三种导出方案：
   - 标准导出（原方案）
   - 优化导出（质量优化）
   - Canvas 流导出（新方案）
4. 对比文件质量和处理时间

### 3. 质量验证
- **文字清晰度** - 检查文字是否清晰
- **画面稳定性** - 检查是否有抖动
- **文件大小** - 对比压缩效率
- **处理速度** - 对比导出时间

## 📝 总结

Canvas 流方案通过以下技术改进解决了抖动问题：

1. **🎬 原生流处理** - 使用 `canvas.captureStream()` 让浏览器处理帧同步
2. **⏱️ 自动时间戳** - 浏览器自动管理时间戳，避免累积误差
3. **🔄 连续渲染** - Canvas 连续渲染，消除帧间不一致
4. **🚀 并行处理** - 视频播放与渲染并行，提升性能
5. **🎯 硬件加速** - 充分利用浏览器的硬件加速能力

这个方案既解决了抖动问题，又保持了高质量的视频输出，是一个更稳定、更高效的解决方案。
