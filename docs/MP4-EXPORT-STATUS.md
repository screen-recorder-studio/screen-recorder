# MP4 导出功能现状说明

## 当前状态

**重要说明**：由于浏览器技术限制，目前无法在浏览器中直接将 WebM 视频转换为 MP4 格式。

## 技术原因

### 为什么不能直接转换？

1. **编解码器不兼容**
   - WebM 使用 VP8/VP9 视频编码
   - MP4 使用 H.264/H.265 视频编码
   - 需要完整的解码和重新编码过程

2. **浏览器限制**
   - WebCodecs API 在 Worker 中功能受限
   - 无法在 Worker 中访问 DOM（video 元素）
   - MediaStreamTrackProcessor 在 Worker 中不可用

3. **MP4Box.js 的局限**
   - MP4Box.js 只能处理容器格式
   - 不能进行视频编解码转换
   - 只能重新封装已经是 H.264 的视频

## 当前实现

当用户选择导出 MP4 时：

1. 系统会尝试转换
2. 转换失败后，返回原始 WebM 文件
3. 显示警告信息，说明如何手动转换

## 推荐解决方案

### 方案 1：使用桌面软件（推荐）

#### VLC Media Player（免费）
1. 打开 VLC
2. 选择"媒体" → "转换/保存"
3. 添加 WebM 文件
4. 选择 MP4 作为输出格式
5. 开始转换

#### HandBrake（免费）
1. 下载安装 [HandBrake](https://handbrake.fr/)
2. 打开 WebM 文件
3. 选择 MP4 预设
4. 点击开始

#### FFmpeg（命令行）
```bash
ffmpeg -i input.webm -c:v libx264 -crf 23 -c:a aac output.mp4
```

### 方案 2：在线转换服务

- [CloudConvert](https://cloudconvert.com/webm-to-mp4)
- [Convertio](https://convertio.co/webm-mp4/)
- [Online-Convert](https://www.online-convert.com/)

**注意**：在线服务可能有文件大小限制和隐私考虑

### 方案 3：服务器端转换

如果您有服务器，可以：
1. 上传 WebM 文件到服务器
2. 使用服务器上的 FFmpeg 转换
3. 下载转换后的 MP4 文件

## 未来改进方向

### 短期方案
1. **集成 ffmpeg.wasm**
   - 在浏览器中运行 FFmpeg
   - 文件大小约 30MB
   - 性能较慢但可行

### 长期方案
1. **改进 WebCodecs 实现**
   - 在主线程而非 Worker 中执行
   - 实现完整的解码-编码流程
   - 需要重构现有架构

2. **服务器端 API**
   - 提供转换服务
   - 更快的转换速度
   - 支持更多格式

## 用户操作指南

### 当前推荐工作流程

1. **录制视频** → 选择 WebM 格式
2. **需要 MP4？** → 下载 WebM 文件
3. **转换** → 使用 VLC 或其他工具
4. **完成** → 获得 MP4 文件

### 为什么还保留 MP4 选项？

- 提醒用户需要转换
- 提供转换指导
- 为未来升级预留接口

## 技术细节

### 文件结构
- `export.worker.js` - 导出管理
- `simple-mp4-converter.js` - 转换尝试和错误处理
- `formatExportManager.js` - UI 交互管理

### 错误处理流程
```
用户选择 MP4
  ↓
尝试转换
  ↓
转换失败
  ↓
返回 WebM + 警告信息
  ↓
提供转换建议
```

## FAQ

**Q: 为什么其他网站可以导出 MP4？**
A: 可能的原因：
- 他们直接录制为 H.264（需要更多浏览器权限）
- 使用服务器端转换
- 使用了大型 JavaScript 库（如 ffmpeg.wasm）

**Q: 什么时候能支持 MP4？**
A: 当以下条件之一满足时：
- 集成 ffmpeg.wasm（增加约 30MB 下载）
- 提供服务器端转换 API
- WebCodecs API 改进并广泛支持

**Q: WebM 格式有什么问题吗？**
A: WebM 是现代格式，被大多数浏览器和播放器支持。主要限制是某些老旧设备或软件可能不支持。

## 联系和反馈

如果您有更好的解决方案或建议，欢迎提供反馈。
