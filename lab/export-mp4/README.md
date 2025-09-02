# Canvas to MP4 Export Lab

这是一个实验性页面，演示如何使用 **WebCodecs API** 和 **MediaBunny** 库将 Canvas 动画导出为高质量的 MP4 视频文件。

## 📁 文件说明

### 🎯 MP4 导出页面
- **`mp4-demo.html`** - 🌟 **专业 MP4 导出页面（推荐）**
  - 专门针对 MP4 格式优化
  - 使用正确的 MediaBunny API
  - 支持多种 H.264/H.265 编码器
  - 提供完整的质量控制选项
- **`text-animation-demo.html`** - 📝 **文字动画 MP4 导出页面（新增）**
  - 专门用于文字动画导出
  - 6种精美文字动画效果
  - 完整的文字样式控制
  - 支持多行文字和自定义内容
- **`mediabunny-test.html`** - 🔧 **MediaBunny API 测试页面**
  - 使用正确的 MediaBunny API 语法
  - 详细的日志和错误信息
  - 适合验证 MediaBunny 功能

### 其他页面
- `index.html` - 完整功能的主实验页面
- `demo.html` - 简化版演示页面（WebM 格式）
- `test.html` - MediaBunny 库测试页面
- **`simple-test.html`** - 🔧 **简单录制测试页面（推荐用于调试）**
- `debug.html` - 详细调试工具页面

### JavaScript 模块
- `canvas-exporter.js` - Canvas 导出核心逻辑（WebCodecs + MediaBunny）
- `animations.js` - Canvas 动画系统
- `text-animations.js` - 文字动画系统（新增）
- `main.js` - 主应用逻辑
- `../../mediabunny-loader.js` - MediaBunny 库加载器

## 🚀 快速开始

### 🎬 方法一：专业 MP4 导出（强烈推荐）
打开 `mp4-demo.html` 获得最佳的 MP4 导出体验：
- ✅ **专门优化的 MP4 导出流程**
- ✅ **支持 H.264/H.265 高质量编码**
- ✅ **多种质量预设（标清到4K）**
- ✅ **标准 MP4 格式，兼容所有播放器**
- ✅ **专业级参数控制**

### 📝 方法一A：文字动画 MP4 导出（新功能）
打开 `text-animation-demo.html` 体验专业的文字动画导出：
- ✅ **6种精美文字动画效果**
- ✅ **完整的文字样式控制**
- ✅ **支持多行文字和自定义内容**
- ✅ **实时预览和参数调整**
- ✅ **高质量 MP4 导出**

### 方法二：基础演示
打开 `demo.html` 体验基本的视频录制：
- 使用标准的 MediaRecorder API
- 输出 WebM 格式
- 兼容性更好，功能稳定

### 方法三：完整功能
打开 `index.html` 体验所有功能：
- 完整的实验性功能
- 多种输出格式选择

## 🎯 功能特性

### 核心功能
- ✅ Canvas 动画实时预览
- ✅ 使用 WebCodecs API 进行硬件加速编码
- ✅ 通过 MediaBunny 库导出标准 MP4 格式
- ✅ 支持多种视频编码器（H.264, H.265, VP9, AV1）
- ✅ 可配置的视频参数（比特率、帧率、时长）
- ✅ 实时进度显示和状态反馈

### 动画类型

#### 几何动画（mp4-demo.html）
1. **弹跳球** - 经典的物理弹跳动画
2. **旋转方块** - 多层旋转几何图形
3. **波浪图案** - 数学函数驱动的波浪效果
4. **粒子系统** - 动态粒子连线效果

#### 文字动画（text-animation-demo.html）
1. **打字机效果** - 逐字符显示，带闪烁光标
2. **淡入效果** - 逐行淡入显示
3. **滑入效果** - 从右侧滑入的动画
4. **缩放效果** - 从小到大的缩放动画
5. **彩虹文字** - 动态彩色文字效果
6. **弹跳文字** - 字符上下弹跳动画

### 编码器支持
- **H.264 (AVC)** - 最广泛支持的编码器
- **H.265 (HEVC)** - 高效压缩，较新的浏览器支持
- **VP9** - Google 开发的开源编码器
- **AV1** - 下一代开源编码器

## 🛠️ 技术架构

### 核心技术栈
```
WebCodecs API ──→ 硬件加速编码
      ↓
MediaBunny ──→ MP4 容器封装
      ↓
Canvas 2D ──→ 动画渲染
```

### 文件结构
```
lab/export-mp4/
├── index.html          # 主页面
├── main.js             # 应用主逻辑
├── canvas-exporter.js  # Canvas 导出核心
├── animations.js       # 动画系统
└── README.md          # 说明文档
```

## 🚀 使用方法

### 1. 基本操作
1. 打开页面后会自动开始播放动画
2. 选择动画类型和参数
3. 配置视频编码设置
4. 点击"开始录制并导出 MP4"
5. 等待处理完成后预览和下载

### 2. 参数配置

#### 视频编码设置
- **编码器**: 选择支持的视频编码器
- **比特率**: 控制视频质量和文件大小
  - 1 Mbps: 低质量，小文件
  - 2.5 Mbps: 中等质量（推荐）
  - 5-10 Mbps: 高质量，大文件

#### 录制设置
- **帧率**: 视频流畅度
  - 24 FPS: 电影标准
  - 30 FPS: 网络视频标准（推荐）
  - 60 FPS: 高流畅度
- **时长**: 1-30 秒可调

#### 动画设置
- **动画类型**: 4 种预设动画效果
- **动画速度**: 0.1x - 3.0x 可调

## 🔧 技术实现

### WebCodecs 集成
```javascript
// 检查编码器支持
const support = await Mediabunny.canEncodeVideo(codec);

// 创建 Canvas 视频源
const videoSource = new Mediabunny.CanvasSource(canvas, {
    codec: 'avc',
    bitrate: 2500000
});
```

### MediaBunny 输出
```javascript
// 创建 MP4 输出
const output = new Mediabunny.Output({
    format: new Mediabunny.Mp4OutputFormat({
        fastStart: true
    }),
    target: new Mediabunny.BufferTarget()
});

// 添加视频轨道
output.addVideoTrack(videoSource, { frameRate: 30 });
```

### 帧精确录制
```javascript
// 逐帧录制
for (let frame = 0; frame < totalFrames; frame++) {
    const timestamp = frame / fps;
    
    // 渲染动画帧
    animations.renderFrame(timestamp);
    
    // 添加到视频流
    await videoSource.add(timestamp, 1/fps);
}
```

## 🌟 优势特点

### 相比传统方案
1. **更高质量**: 直接使用 WebCodecs 硬件编码
2. **更好兼容性**: MediaBunny 生成标准 MP4 文件
3. **更精确控制**: 帧级别的精确录制
4. **更好性能**: 避免了 MediaRecorder 的限制

### 相比 MediaRecorder
- ✅ 支持更多编码器选项
- ✅ 更精确的比特率控制
- ✅ 更好的质量设置
- ✅ 标准 MP4 格式输出
- ✅ 帧精确的录制控制

## 🔍 浏览器兼容性

### WebCodecs API 支持
- ✅ Chrome 94+
- ✅ Edge 94+
- ❌ Firefox (开发中)
- ❌ Safari (未支持)

### 编码器支持情况
| 编码器 | Chrome | Edge | 说明 |
|--------|--------|------|------|
| H.264  | ✅     | ✅   | 广泛支持 |
| H.265  | ⚠️     | ⚠️   | 部分支持 |
| VP9    | ✅     | ✅   | 良好支持 |
| AV1    | ✅     | ✅   | 较新支持 |

## 🐛 故障排除

### ⚠️ 视频尺寸为 0 的问题
如果遇到导出的视频文件大小为 0，请按以下步骤排查：

1. **使用 `simple-test.html` 进行基础测试**：
   - 这是最简单的录制测试页面
   - 可以快速验证 Canvas 录制功能是否正常

2. **检查 Canvas 内容**：
   - 确保 Canvas 在录制前有可见内容
   - 动画必须正在运行
   - 检查浏览器控制台是否有错误

3. **验证浏览器支持**：
   - 使用 `debug.html` 检查详细的兼容性信息
   - 确认 MediaRecorder API 支持
   - 检查支持的 MIME 类型

### 常见问题
1. **编码器不支持**: 尝试切换到 H.264
2. **导出失败**: 检查浏览器 WebCodecs 支持
3. **文件过大**: 降低比特率或缩短时长
4. **播放问题**: 确保使用支持 MP4 的播放器
5. **Canvas 为空**: 确保动画正在运行且有可见内容

### 调试信息
打开浏览器开发者工具查看详细的控制台输出，包括：
- 编码器支持检查结果
- 录制进度信息
- 错误详情和堆栈跟踪

## 📈 性能优化

### 建议设置
- **1080p 以下**: 使用 H.264, 2.5 Mbps
- **1080p**: 使用 H.264, 5 Mbps
- **4K**: 使用 H.265 或 AV1, 10+ Mbps

### 系统要求
- 现代多核 CPU（推荐 8 核以上）
- 充足内存（推荐 8GB 以上）
- 支持硬件编码的 GPU（可选但推荐）

## 🔮 未来扩展

### 计划功能
- [ ] 音频轨道支持
- [ ] 自定义动画脚本
- [ ] 批量导出功能
- [ ] 更多输出格式（WebM, MOV）
- [ ] 云端编码支持

### 技术改进
- [ ] Worker 线程优化
- [ ] 内存使用优化
- [ ] 更好的错误处理
- [ ] 实时预览优化
