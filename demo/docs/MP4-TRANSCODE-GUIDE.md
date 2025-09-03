# MP4 转码实现指南

## 概述

本项目现在实现了使用 WebCodecs API 将 WebM 视频转码为 MP4 格式的完整流程。

## 转码流程

### 1. WebM 到 MP4 转码步骤

```
WebM (VP8/VP9) → 解码 → 原始帧 → 编码 (H.264) → MP4 容器
```

具体流程：
1. **解析 WebM**：提取视频流和元数据
2. **解码视频**：使用 VideoDecoder 解码 VP8/VP9 编码的帧
3. **重新编码**：使用 VideoEncoder 编码为 H.264
4. **封装 MP4**：使用 MP4Box.js 封装为 MP4 容器

### 2. 关键组件

#### WebCodecsTranscoder 类
- 位置：`popup/webcodecs-transcoder.js`
- 功能：完整的转码实现
- 主要方法：
  - `transcode()`: 主转码方法
  - `demuxWebM()`: 解析 WebM 文件
  - `decodeFrames()`: 解码视频帧
  - `encodeFrames()`: 编码为 H.264
  - `muxToMP4()`: 封装为 MP4

#### Export Worker 集成
- 位置：`popup/export.worker.js`
- 功能：Worker 线程中执行转码
- 优先使用 WebCodecs，失败时降级处理

## 浏览器兼容性

### 支持的浏览器
- Chrome 94+ (完整支持)
- Edge 94+ (完整支持)
- Opera 80+ (完整支持)
- Chrome for Android 94+

### 不支持的浏览器
- Firefox (WebCodecs API 尚未实现)
- Safari (部分支持，需要启用实验性功能)
- IE/旧版 Edge

## 测试方法

### 1. 检查 WebCodecs 支持
```javascript
// 在控制台运行
if (typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined') {
  console.log('✅ WebCodecs API 支持');
} else {
  console.log('❌ WebCodecs API 不支持');
}
```

### 2. 测试转码功能
1. 录制一段视频（WebM 格式）
2. 点击"选择格式"按钮
3. 选择 MP4 格式
4. 设置导出选项：
   - 分辨率：1920x1080
   - 比特率：5 Mbps
   - 帧率：30 fps
5. 点击导出
6. 等待转码完成

### 3. 监控转码进度
打开浏览器控制台，可以看到详细的转码日志：
```
Starting WebM to MP4 transcoding...
Demuxing WebM file...
Video metadata: 1920x1080, 10s, 30fps
Initializing decoder...
Initializing encoder...
Decoding 300 chunks...
Encoding 300 frames to H.264...
Encoding progress: 10.0%
...
Muxing to MP4 container...
```

## 性能优化建议

### 1. 硬件加速
转码器默认启用硬件加速：
```javascript
hardwareAcceleration: 'prefer-hardware'
```

### 2. 内存管理
- 及时释放 VideoFrame 对象
- 分批处理大文件
- 使用 OffscreenCanvas 减少内存占用

### 3. 编码参数优化
```javascript
// 高质量设置
{
  codec: 'avc1.640028',  // H.264 High Profile
  bitrate: 8000000,      // 8 Mbps
  framerate: 60
}

// 平衡设置
{
  codec: 'avc1.42001E',  // H.264 Baseline Profile
  bitrate: 5000000,      // 5 Mbps
  framerate: 30
}

// 低质量/快速设置
{
  codec: 'avc1.42001E',
  bitrate: 2000000,      // 2 Mbps
  framerate: 24
}
```

## 已知限制

1. **浏览器限制**
   - WebCodecs API 仅在部分现代浏览器中可用
   - 需要 HTTPS 或 localhost 环境

2. **性能限制**
   - 大文件转码可能需要较长时间
   - 内存使用量较高（特别是高分辨率视频）

3. **功能限制**
   - 当前实现不包含音频转码
   - 不支持字幕轨道
   - 不支持多轨道视频

## 故障排查

### 问题：转码失败
**解决方案**：
1. 检查浏览器是否支持 WebCodecs
2. 确认视频文件未损坏
3. 查看控制台错误信息

### 问题：输出文件无法播放
**解决方案**：
1. 确认编码参数正确
2. 使用标准 H.264 profile
3. 检查 MP4 容器封装是否正确

### 问题：转码速度慢
**解决方案**：
1. 降低输出分辨率
2. 降低比特率
3. 使用硬件加速
4. 关闭其他占用 GPU 的程序

## 未来改进

1. **音频支持**
   - 添加音频解码/编码
   - 支持多音轨

2. **性能优化**
   - 实现流式处理
   - 添加 WebAssembly 加速
   - 支持多线程处理

3. **格式支持**
   - 支持更多输入格式（MP4, MOV, AVI）
   - 支持 HEVC/H.265 编码
   - 支持 AV1 编码

4. **用户体验**
   - 添加预览功能
   - 实时进度显示
   - 批量转码支持

## 相关文件

- `popup/webcodecs-transcoder.js` - WebCodecs 转码器实现
- `popup/export.worker.js` - Worker 导出管理
- `popup/formatExportManager.js` - 格式导出管理器
- `libs/mp4box.all.js` - MP4 容器处理库
