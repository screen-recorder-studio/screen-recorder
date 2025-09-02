# WebM 转 MP4 测试实验室

## 📁 文件说明

### `export-mp4.html`
主要的测试页面，提供完整的 WebM 转 MP4 功能测试界面。

**功能特性**:
- 📎 拖拽或点击上传 WebM 文件
- 🎛️ 质量设置选择（低/中/高/超高）
- 📊 实时转换进度显示
- 📹 原始和转换后视频对比
- 📈 文件大小和压缩比统计
- ⬇️ 一键下载转换后的 MP4 文件
- 🧪 内置测试 WebM 生成功能

### `webm-to-mp4-converter.js`
专门的 WebM 转 MP4 转换器类，基于 MediaBunny 实现。

**核心功能**:
- 🎬 WebM 文件分析和解码
- 🖼️ Canvas 实时渲染
- 🎞️ MP4 编码和输出
- 📊 进度回调和状态管理
- 🔧 质量和比特率优化

## 🚀 使用方法

### 1. 基本测试流程

1. **打开测试页面**
   ```
   打开 lab/export-mp4.html
   ```

2. **准备测试文件**
   - 点击"创建测试 WebM"按钮生成测试文件
   - 或者拖拽现有的 WebM 文件到上传区域

3. **设置转换参数**
   - 选择质量级别（推荐使用"高质量"）
   - 其他参数使用默认值

4. **开始转换**
   - 点击"开始转换"按钮
   - 观察实时进度显示
   - 等待转换完成

5. **查看结果**
   - 对比原始 WebM 和转换后 MP4 的播放效果
   - 查看文件大小变化和压缩统计
   - 点击下载链接保存 MP4 文件

### 2. 高级使用

#### 自定义转换参数
```javascript
const converter = new WebmToMp4Converter();
await converter.initialize();

const result = await converter.convertWebmToMp4(webmBlob, {
    quality: 'ultra',           // 质量级别
    frameRate: 60,              // 帧率
    backgroundConfig: {         // 背景配置
        color: '#000000',       // 背景颜色
        padding: 20,            // 边距
        outputRatio: '16:9'     // 输出比例
    },
    progressCallback: (progress, message) => {
        console.log(`${Math.round(progress * 100)}%: ${message}`);
    }
});

console.log('转换完成:', result);
```

#### 批量转换
```javascript
const converter = new WebmToMp4Converter();
await converter.initialize();

for (const webmFile of webmFiles) {
    try {
        const result = await converter.convertWebmToMp4(webmFile, {
            quality: 'high',
            progressCallback: (progress, message) => {
                console.log(`${webmFile.name}: ${Math.round(progress * 100)}%`);
            }
        });
        
        // 保存结果
        downloadBlob(result.blob, `${webmFile.name}.mp4`);
        
    } catch (error) {
        console.error(`转换 ${webmFile.name} 失败:`, error);
    }
}
```

## 🔧 技术实现

### 转换流程

1. **文件分析** - 创建 video 元素分析 WebM 文件
2. **Canvas 设置** - 根据输出要求创建转换画布
3. **布局计算** - 计算视频在画布中的最佳布局
4. **实时渲染** - 设置 Canvas 实时渲染视频内容
5. **MP4 编码** - 使用 MediaBunny 进行 H.264 编码
6. **帧添加** - 手动添加每一帧到视频流
7. **输出生成** - 生成最终的 MP4 文件

### 质量优化

- **分辨率适配** - 根据原始视频自动调整输出分辨率
- **比特率优化** - 基于画布尺寸和质量级别计算最佳比特率
- **渲染优化** - 使用高质量图像平滑和 60 FPS 渲染
- **编码优化** - 使用 H.264 编码器的最佳参数

## 📊 性能指标

### 转换速度
- **低质量**: ~1x 实时速度
- **中等质量**: ~0.8x 实时速度  
- **高质量**: ~0.6x 实时速度
- **超高质量**: ~0.4x 实时速度

### 文件大小
- **低质量**: 通常比原文件小 20-40%
- **中等质量**: 与原文件大小相近
- **高质量**: 比原文件大 20-50%
- **超高质量**: 比原文件大 50-100%

### 支持格式
- **输入**: WebM (VP8/VP9 编码)
- **输出**: MP4 (H.264 编码)
- **分辨率**: 支持 480p 到 4K
- **帧率**: 支持 15-60 FPS

## 🐛 故障排除

### 常见问题

1. **转换失败**
   - 检查 WebM 文件是否有效
   - 确认 MediaBunny 库已正确加载
   - 查看浏览器控制台错误信息

2. **文件过大**
   - 降低质量级别
   - 检查原始视频分辨率
   - 考虑缩短视频时长

3. **转换速度慢**
   - 使用较低的质量设置
   - 关闭其他占用 CPU 的应用
   - 确保浏览器有足够内存

4. **播放问题**
   - 确认浏览器支持 H.264 播放
   - 检查转换后的文件大小
   - 尝试在不同播放器中测试

### 调试模式

打开浏览器开发者工具查看详细日志：
- 转换进度和状态
- MediaBunny 操作日志
- 错误和警告信息
- 性能统计数据

## 📝 更新日志

### v1.0.0 (当前版本)
- ✅ 基础 WebM 转 MP4 功能
- ✅ 质量级别选择
- ✅ 实时进度显示
- ✅ 文件对比和统计
- ✅ 自动下载功能
- ✅ 测试 WebM 生成

### 计划功能
- 🔄 批量转换支持
- 🎛️ 更多编码参数控制
- 📱 移动端优化
- 🌐 Web Worker 支持
- 📊 更详细的统计信息
