# 多格式视频导出设计方案

## 支持的导出格式
- **WebM** (原生格式，无需转换)
- **MP4** (使用 WebCodecs 或 mp4box.js 转换)
- **GIF** (使用 gif.js 转换)

## 技术架构

### 1. WebM 导出（原生）
```javascript
// 直接使用 MediaRecorder 录制的 WebM
// 无需转换，可以直接下载
// 支持 VP8/VP9 编码
```

### 2. MP4 导出方案

#### 方案A: WebCodecs + MP4Box.js（推荐）
```javascript
class MP4Exporter {
  async exportToMP4(webmBlob) {
    // 1. 使用 VideoDecoder 解码 WebM
    const frames = await this.decodeWebM(webmBlob);
    
    // 2. 使用 VideoEncoder 编码为 H.264
    const h264Chunks = await this.encodeToH264(frames);
    
    // 3. 使用 MP4Box.js 封装
    const mp4Blob = await this.muxToMP4(h264Chunks);
    
    return mp4Blob;
  }
}
```

**优点：**
- 性能好，支持硬件加速
- 质量可控
- 文件体积优化

**缺点：**
- WebCodecs 兼容性问题
- 实现复杂度高

#### 方案B: 纯 JavaScript 转换
```javascript
class SimpleMP4Exporter {
  async exportToMP4(webmBlob) {
    // 使用 mp4box.js 直接重新封装
    // 保持原始编码，只改变容器格式
    const mp4 = MP4Box.createFile();
    // ... 转换逻辑
    return mp4Blob;
  }
}
```

**优点：**
- 实现简单
- 兼容性好

**缺点：**
- 可能不支持所有播放器
- 编码格式受限

### 3. GIF 导出方案

```javascript
class GIFExporter {
  async exportToGIF(webmBlob, options = {}) {
    const {
      width = 480,        // GIF 宽度
      height = 270,       // GIF 高度  
      fps = 10,           // 帧率
      quality = 10,       // 质量 (1-30)
      dither = false      // 抖动
    } = options;
    
    // 1. 创建视频元素
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // 2. 初始化 GIF 编码器
    const gif = new GIF({
      workers: 2,
      quality: quality,
      width: width,
      height: height,
      workerScript: 'libs/gif.worker.js'
    });
    
    // 3. 逐帧采样和添加
    await this.sampleFrames(video, canvas, gif, fps);
    
    // 4. 渲染 GIF
    return new Promise((resolve) => {
      gif.on('finished', (blob) => {
        resolve(blob);
      });
      gif.render();
    });
  }
}
```

## 统一导出接口

```javascript
class UniversalVideoExporter {
  constructor() {
    this.webmExporter = new WebMExporter();
    this.mp4Exporter = new MP4Exporter();
    this.gifExporter = new GIFExporter();
  }
  
  async export(videoBlob, format, options = {}) {
    switch(format.toLowerCase()) {
      case 'webm':
        return this.exportWebM(videoBlob, options);
      case 'mp4':
        return this.exportMP4(videoBlob, options);
      case 'gif':
        return this.exportGIF(videoBlob, options);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
  
  async exportWebM(blob, options) {
    // WebM 原生支持，可能只需要压缩
    if (options.compress) {
      return this.webmExporter.compress(blob, options);
    }
    return blob;
  }
  
  async exportMP4(blob, options) {
    // 检测最佳转换方法
    if (this.isWebCodecsSupported()) {
      return this.mp4Exporter.exportWithWebCodecs(blob, options);
    }
    return this.mp4Exporter.exportWithMP4Box(blob, options);
  }
  
  async exportGIF(blob, options) {
    return this.gifExporter.export(blob, options);
  }
}
```

## 用户界面设计

```html
<!-- 格式选择 -->
<div class="export-format-selector">
  <h3>选择导出格式</h3>
  
  <div class="format-options">
    <label class="format-option">
      <input type="radio" name="format" value="webm" checked>
      <div class="format-card">
        <span class="format-icon">🎬</span>
        <span class="format-name">WebM</span>
        <span class="format-desc">原始格式，最佳质量</span>
      </div>
    </label>
    
    <label class="format-option">
      <input type="radio" name="format" value="mp4">
      <div class="format-card">
        <span class="format-icon">📹</span>
        <span class="format-name">MP4</span>
        <span class="format-desc">通用格式，兼容性好</span>
      </div>
    </label>
    
    <label class="format-option">
      <input type="radio" name="format" value="gif">
      <div class="format-card">
        <span class="format-icon">🎞️</span>
        <span class="format-name">GIF</span>
        <span class="format-desc">动图格式，易于分享</span>
      </div>
    </label>
  </div>
  
  <!-- 格式特定选项 -->
  <div id="format-options" class="format-specific-options">
    <!-- WebM 选项 -->
    <div class="webm-options" data-format="webm">
      <label>质量: <select name="webm-quality">
        <option value="high">高质量</option>
        <option value="medium">中等质量</option>
        <option value="low">低质量</option>
      </select></label>
    </div>
    
    <!-- MP4 选项 -->
    <div class="mp4-options hidden" data-format="mp4">
      <label>编码器: <select name="mp4-codec">
        <option value="h264">H.264 (兼容性最佳)</option>
        <option value="h265">H.265 (体积更小)</option>
      </select></label>
      <label>预设: <select name="mp4-preset">
        <option value="fast">快速</option>
        <option value="medium">平衡</option>
        <option value="slow">高质量</option>
      </select></label>
    </div>
    
    <!-- GIF 选项 -->
    <div class="gif-options hidden" data-format="gif">
      <label>尺寸: <select name="gif-size">
        <option value="480">480p</option>
        <option value="360">360p</option>
        <option value="240">240p</option>
      </select></label>
      <label>帧率: <select name="gif-fps">
        <option value="10">10 FPS</option>
        <option value="15">15 FPS</option>
        <option value="5">5 FPS</option>
      </select></label>
      <label>质量: <input type="range" name="gif-quality" min="1" max="30" value="10"></label>
    </div>
  </div>
</div>
```

## 性能优化策略

### 1. 分块处理
- 大视频分段处理，避免内存溢出
- 使用 Stream API 进行流式处理

### 2. Web Worker
- GIF 编码在 Worker 中执行
- MP4 转码可以在 Worker 中进行

### 3. 进度反馈
```javascript
class ExportProgress {
  constructor(onProgress) {
    this.onProgress = onProgress;
    this.stages = {
      decode: { weight: 0.3, progress: 0 },
      encode: { weight: 0.5, progress: 0 },
      mux: { weight: 0.2, progress: 0 }
    };
  }
  
  updateStage(stage, progress) {
    this.stages[stage].progress = progress;
    const total = Object.entries(this.stages)
      .reduce((sum, [_, s]) => sum + s.weight * s.progress, 0);
    this.onProgress(total);
  }
}
```

## 错误处理

```javascript
class ExportError extends Error {
  constructor(message, format, stage) {
    super(message);
    this.format = format;
    this.stage = stage;
  }
}

// 使用示例
try {
  const result = await exporter.export(blob, 'mp4');
} catch (error) {
  if (error instanceof ExportError) {
    console.error(`Export failed at ${error.stage} for ${error.format}`);
    // 提供降级方案
    if (error.format === 'mp4') {
      console.log('Falling back to WebM export...');
      return exporter.export(blob, 'webm');
    }
  }
}
```

## 预估文件大小

```javascript
function estimateFileSize(originalSize, format, options) {
  const estimates = {
    webm: {
      high: originalSize * 1.0,
      medium: originalSize * 0.6,
      low: originalSize * 0.3
    },
    mp4: {
      h264: originalSize * 0.8,
      h265: originalSize * 0.5
    },
    gif: {
      // GIF 通常会更大
      480: originalSize * 1.5,
      360: originalSize * 1.0,
      240: originalSize * 0.6
    }
  };
  
  return estimates[format][options.quality || options.codec || options.size];
}
```

## 实施计划

### 第一阶段：基础 WebM 优化
1. 实现 WebM 质量调整
2. 添加简单的压缩选项
3. 优化下载体验

### 第二阶段：MP4 支持
1. 集成 mp4box.js
2. 实现基础 MP4 转换
3. 添加编码选项

### 第三阶段：GIF 支持
1. 集成 gif.js
2. 实现视频转 GIF
3. 优化 GIF 质量和大小

### 第四阶段：高级功能
1. 批量导出
2. 预设配置
3. 云端转换选项

## 兼容性矩阵

| 格式 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| WebM | ✅ | ✅ | ⚠️ | ✅ |
| MP4  | ✅ | ✅ | ✅ | ✅ |
| GIF  | ✅ | ✅ | ✅ | ✅ |

注：
- ✅ 完全支持
- ⚠️ 部分支持（可能需要特殊处理）
- ❌ 不支持

## 测试用例

1. **小视频测试** (< 10MB)
   - 各种格式导出
   - 质量验证

2. **大视频测试** (> 100MB)
   - 内存管理
   - 性能优化

3. **边界条件**
   - 超短视频 (< 1秒)
   - 超长视频 (> 10分钟)
   - 特殊分辨率
