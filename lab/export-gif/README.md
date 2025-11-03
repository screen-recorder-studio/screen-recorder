# GIF 导出测试 - gif.js 实现

这是一个使用 gif.js 库实现的 GIF 导出测试应用，支持从多种源（Canvas 动画、视频文件、摄像头）生成 GIF 图片。

## 功能特性

### 🎯 支持的输入源
- **Canvas 动画**: 实时渲染的动画效果
- **视频文件**: 支持上传本地视频文件转换为 GIF
- **摄像头**: 直接从摄像头录制内容生成 GIF

### ⚙️ 可调整的参数
- **质量**: 1-30（数值越小质量越好）
- **工作线程数**: 1-8 个并行处理线程
- **帧率**: 1-30 FPS
- **录制时长**: 1-10 秒
- **尺寸**: 可调整输出 GIF 的宽度和高度

## gif.js 使用方法

### 基本初始化
```javascript
var gif = new GIF({
  workers: 2,        // 工作线程数
  quality: 10,       // 质量（1-30，越小越好）
  width: 400,        // 输出宽度
  height: 300,       // 输出高度
  workerScript: 'gif.worker.js',  // Worker 脚本路径
  
  // 高级参数
  repeat: 0,         // 重复次数（-1=不重复，0=永远）
  background: '#fff', // 背景色（透明区域）
  transparent: null,  // 透明色（如 0x00FF00）
  dither: false,     // 抖动算法（见下方说明）
  debug: false       // 调试模式
});
```

### 添加帧
```javascript
// 从 image 元素添加
gif.addFrame(imageElement);

// 从 canvas 元素添加（带延迟）
gif.addFrame(canvasElement, {delay: 200});

// 从 canvas context 复制像素
gif.addFrame(ctx, {
  copy: true,      // 复制像素数据
  delay: 100       // 帧延迟（毫秒）
});
```

### 事件处理
```javascript
// 进度事件
gif.on('progress', function(p) {
  console.log('进度: ' + Math.round(p * 100) + '%');
});

// 完成事件
gif.on('finished', function(blob) {
  // blob 是生成的 GIF 文件
  window.open(URL.createObjectURL(blob));
});
```

### 渲染 GIF
```javascript
gif.render();  // 开始渲染过程
```

## 配置选项详解

### GIF 构造函数选项
| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| repeat | Number | 0 | 重复次数（-1=不重复，0=永远） |
| quality | Number | 10 | 像素采样间隔（1=最高质量但最慢，30=最低质量但最快） |
| workers | Number | 2 | Web Worker 线程数 |
| workerScript | String | 'gif.worker.js' | Worker 脚本 URL |
| background | String | '#fff' | 透明区域的背景色 |
| width | Number | null | 输出宽度（null=自动） |
| height | Number | null | 输出高度（null=自动） |
| transparent | String | null | 透明色（如 0x00FF00 = 绿色） |
| dither | String/Boolean | false | 抖动方法（见下方） |
| debug | Boolean | false | 是否输出调试信息 |

### 支持的抖动算法
- `false` - 无抖动（默认）
- `'FloydSteinberg'` - Floyd-Steinberg 算法
- `'FalseFloydSteinberg'` - False Floyd-Steinberg 算法
- `'Stucki'` - Stucki 算法
- `'Atkinson'` - Atkinson 算法
- 可添加 `-serpentine` 后缀使用蛇形扫描（如 `'FloydSteinberg-serpentine'`）

### addFrame 选项
| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| delay | Number | 500 | 帧延迟（毫秒） |
| copy | Boolean | false | 是否复制像素数据 |
| dispose | Number | -1 | 帧处置代码（见 GIF89a 规范） |

### 帧处置方式（dispose）
- `-1` - 自动选择
- `0` - 无处置（No disposal）
- `1` - 不处置（Do not dispose）
- `2` - 恢复为背景色（Restore to background）
- `3` - 恢复为前一帧（Restore to previous）

## 实现细节

### 录制流程
1. 用户选择输入源（Canvas/视频/摄像头）
2. 调整参数设置（质量、帧率、尺寸等）
3. 点击"开始录制"初始化 GIF 编码器
4. 按照设定的帧率捕获帧
5. 达到设定时长后自动停止
6. 渲染生成最终的 GIF 文件
7. 显示结果并提供下载选项

### 性能优化
- 使用 Web Workers 并行处理，避免阻塞主线程
- 可调整工作线程数以平衡性能和资源使用
- 支持进度反馈，实时显示编码进度
- 合理的默认参数设置，平衡质量和文件大小

## 新功能特性

### 📱 专业版视频转 GIF (video-to-gif.html)

#### 预设模板
应用程序提供了 5 个优化预设，适合不同使用场景：

1. **💎 高质量模式**
   - 质量: 1，帧率: 24 FPS
   - 最佳画质，适合需要高质量 GIF 的场景

2. **⚖️ 平衡模式**
   - 质量: 10，帧率: 15 FPS
   - 画质和文件大小的良好平衡

3. **💾 小文件模式**
   - 质量: 20，帧率: 10 FPS，缩放: 50%
   - 最小化文件大小，适合网络分享

4. **🌊 流畅动画**
   - 质量: 5，帧率: 30 FPS
   - 高帧率，动画流畅，适合动作场景

5. **🕹️ 复古风格**
   - 质量: 15，帧率: 12 FPS，缩放: 50%
   - 经典 GIF 效果，带有怀旧感

#### 高级设置
- **抖动算法**：改善色彩过渡，减少色带
- **透明色**：设置特定颜色为透明
- **背景色**：定义透明区域的填充色
- **帧处置**：控制动画帧之间的过渡方式
- **调试模式**：在控制台输出详细处理信息

## 测试方法

### 本地测试
```bash
# 使用 npx serve 启动静态服务器
cd lab/export-gif
npx serve . -p 5001

# 访问测试页面
http://localhost:5001/test.html        # 简单测试
http://localhost:5001/index.html       # 主应用
http://localhost:5001/video-to-gif.html # 专业版
```

### 功能测试点
1. **Canvas 动画录制**: 验证动画帧的正确捕获
2. **视频转 GIF**: 上传视频文件并转换
3. **摄像头录制**: 实时捕获摄像头内容
4. **参数调整**: 测试不同参数对输出的影响
5. **下载功能**: 验证生成的 GIF 可正常下载
6. **预设模板**: 测试不同预设的效果
7. **帧预览**: 在转换前预览将要提取的帧
8. **抖动算法**: 对比不同抖动算法的视觉效果
9. **透明色**: 测试透明色功能
10. **帧处置**: 观察不同帧处置方式的动画效果

## 注意事项

1. **浏览器兼容性**: 需要支持 Web Workers 和 Canvas API
2. **内存使用**: 高质量和大尺寸会增加内存消耗
3. **处理时间**: 复杂的 GIF 可能需要较长的处理时间
4. **文件大小**: GIF 格式文件较大，考虑使用合理的质量设置

## 扩展功能建议

1. **添加滤镜效果**: 在录制前应用图像滤镜
2. **支持裁剪**: 允许用户选择录制区域
3. **批量处理**: 支持多个视频批量转换
4. **优化算法**: 实现更高效的色彩量化算法
5. **预览功能**: 录制前预览效果

## 相关资源

- [gif.js GitHub](https://github.com/jnordberg/gif.js)
- [gif.js 文档](https://jnordberg.github.io/gif.js/)
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)