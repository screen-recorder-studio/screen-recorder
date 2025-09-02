# 直接使用 MediaBunny 转换测试

## 🎯 页面说明

`direct-mediabunny-test.html` 是一个直接使用 MediaBunny API 进行 WebM 转 MP4 转换的测试页面，没有额外的封装层。

## 🚀 核心特性

### 1. 直接 MediaBunny API 调用
```javascript
// 直接创建 MediaBunny 输出
const output = new mediabunny.Output({
    format: new mediabunny.Mp4OutputFormat(),
    target: new mediabunny.BufferTarget()
});

// 直接创建 Canvas 视频源
const videoSource = new mediabunny.CanvasSource(canvas, {
    codec: 'avc',
    bitrate: bitrate
});

// 直接添加视频轨道
output.addVideoTrack(videoSource, { frameRate: frameRate });
```

### 2. 可配置参数
- **比特率**: 2/5/8/12 Mbps
- **帧率**: 24/30/60 FPS  
- **时长限制**: 10/30/60 秒或不限制

### 3. 实时进度显示
- 详细的转换步骤提示
- 帧级别的进度显示
- 可随时取消转换

## 🔧 技术实现

### 转换流程

1. **文件分析** - 加载 WebM 文件并获取元数据
2. **Canvas 创建** - 根据原始分辨率创建转换画布
3. **视频渲染** - 设置 60 FPS 实时渲染到 Canvas
4. **MediaBunny 输出** - 创建 MP4 输出目标
5. **Canvas 源** - 创建 CanvasSource 视频源
6. **轨道添加** - 添加视频轨道到输出
7. **帧编码** - 手动添加每一帧到视频流
8. **输出完成** - 生成最终的 MP4 文件

### 关键代码片段

#### 创建视频元素
```javascript
async function createVideoElement(webmBlob) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(webmBlob);
        video.onloadedmetadata = () => resolve(video);
        video.onerror = reject;
    });
}
```

#### 设置 Canvas 渲染
```javascript
async function setupVideoRendering(canvas, video) {
    const ctx = canvas.getContext('2d');
    
    const renderFrame = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
    };
    
    video.loop = true;
    await video.play();
    
    // 60 FPS 渲染
    renderInterval = setInterval(renderFrame, 1000 / 60);
}
```

#### 手动添加帧
```javascript
const totalFrames = Math.ceil(frameRate * duration);
const frameDuration = 1 / frameRate;

for (let i = 0; i < totalFrames; i++) {
    const timestamp = i * frameDuration;
    await videoSource.add(timestamp, frameDuration);
    
    // 更新进度
    const progress = i / totalFrames;
    updateProgress(0.4 + progress * 0.5, `编码中... ${Math.round(progress * 100)}%`);
}
```

## 🎯 使用方法

### 1. 基本测试
1. 打开 `lab/direct-mediabunny-test.html`
2. 点击"创建测试 WebM"生成测试文件
3. 选择转换参数（比特率、帧率等）
4. 点击"开始转换"
5. 观察详细的转换进度
6. 下载转换后的 MP4 文件

### 2. 自定义文件测试
1. 拖拽或选择现有的 WebM 文件
2. 根据文件特性调整参数
3. 开始转换并监控进度

### 3. 性能测试
- 测试不同比特率的质量差异
- 对比不同帧率的流畅度
- 验证时长限制功能

## 📊 参数说明

### 比特率选择
- **2 Mbps**: 适合网络传输，文件较小
- **5 Mbps**: 平衡质量和大小，推荐设置
- **8 Mbps**: 高质量，适合本地播放
- **12 Mbps**: 超高质量，文件较大

### 帧率选择
- **24 FPS**: 电影标准，文件较小
- **30 FPS**: 网络视频标准，推荐设置
- **60 FPS**: 高流畅度，文件较大

### 时长限制
- **10 秒**: 快速测试
- **30 秒**: 标准测试，推荐设置
- **60 秒**: 长视频测试
- **不限制**: 使用原始时长（注意可能很长）

## 🔍 调试信息

页面提供详细的控制台日志：

```javascript
// 源视频信息
console.log('源视频信息:', {
    originalDuration: video.duration,
    usedDuration: duration.toFixed(2) + 's',
    resolution: `${video.videoWidth}x${video.videoHeight}`,
    size: formatFileSize(originalBlob.size)
});

// Canvas 视频源创建
console.log('Canvas 视频源已创建:', {
    canvasSize: `${canvas.width}x${canvas.height}`,
    bitrate: bitrate,
    frameRate: frameRate
});

// 帧添加进度
console.log(`开始添加 ${totalFrames} 帧，时长 ${duration.toFixed(2)} 秒`);
```

## 🆚 与封装版本的对比

| 特性 | 直接 MediaBunny | 封装版本 |
|------|----------------|----------|
| 代码复杂度 | 较高 | 较低 |
| 控制精度 | 精确 | 抽象 |
| 调试难度 | 容易 | 较难 |
| 扩展性 | 高 | 中等 |
| 学习价值 | 高 | 中等 |

## 🎯 适用场景

- **学习 MediaBunny API** - 直接了解底层调用
- **性能调优** - 精确控制每个参数
- **功能扩展** - 添加自定义编码逻辑
- **问题调试** - 定位具体的 API 调用问题

## 🔧 故障排除

### 常见问题

1. **转换卡住**
   - 检查视频时长是否为 Infinity
   - 使用时长限制功能
   - 点击取消按钮重试

2. **质量问题**
   - 调整比特率设置
   - 检查原始视频分辨率
   - 尝试不同的帧率

3. **性能问题**
   - 降低比特率和帧率
   - 使用时长限制
   - 关闭其他应用释放内存

### 调试步骤

1. 打开浏览器开发者工具
2. 查看 Console 标签的详细日志
3. 监控 Network 标签的资源加载
4. 检查 Performance 标签的性能数据

这个页面提供了最直接的 MediaBunny 使用体验，适合深入了解 WebM 转 MP4 的技术细节。
