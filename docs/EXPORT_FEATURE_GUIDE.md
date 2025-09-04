# 📹 视频导出功能使用指南

## 🎯 功能概述

新增的视频导出功能支持将录制的视频导出为 **WebM** 和 **MP4** 两种格式，包含完整的背景合成效果。

### ✨ 主要特性

- **一键导出**：无需复杂配置，使用默认参数快速导出
- **双格式支持**：WebM (原生) 和 MP4 (转码)
- **背景合成**：保留录制时的背景效果
- **Worker 架构**：所有密集计算在 Worker 中完成，UI 保持流畅
- **实时进度**：显示导出进度和预估时间

## 🏗️ 技术架构

```
VideoExportPanel (UI组件)
    ↓
ExportManager (服务层)
    ↓
WebM Export Worker / MP4 Export Worker
    ↓
文件下载
```

### 核心组件

1. **VideoExportPanel.svelte** - 导出界面组件
2. **ExportManager.ts** - 导出管理服务
3. **webm-export-worker.ts** - WebM 格式导出
4. **mp4-export-worker.ts** - MP4 导出（使用 Mediabunny）
5. **video-composite-worker.ts** - 背景合成处理

## 🚀 使用方法

### 1. 录制视频
- 在 sidepanel 中点击"开始录制"
- 选择要录制的屏幕/窗口
- 完成录制后，系统会显示预览

### 2. 导出视频
- 在"视频导出面板"中选择格式：
  - **📹 导出 WebM** - 快速导出，保持原始编码
  - **🎥 导出 MP4** - 转码导出，兼容性更好

### 3. 监控进度
- 实时显示导出进度
- 显示当前处理阶段：
  - 准备中 (Preparing)
  - 合成背景 (Compositing)
  - 编码中 (Encoding)
  - 封装容器 (Muxing)
  - 完成中 (Finalizing)

## ⚙️ 默认参数

### WebM 导出
- **编码格式**：VP8/VP9 (保持原始)
- **分辨率**：1920x1080
- **帧率**：30fps
- **比特率**：8 Mbps

### MP4 导出
- **编码格式**：H.264 Baseline Profile (自适应 Level)
- **分辨率**：1920x1080 (支持多种分辨率)
- **帧率**：30fps
- **比特率**：8 Mbps
- **AVC Level**：根据分辨率自动选择 (Level 3.0 - 6.0)

## 🔧 技术实现

### WebM 导出流程
1. 获取原始 VP8/VP9 编码块
2. 应用背景合成 (可选)
3. 封装到 WebM 容器
4. 生成下载文件

### MP4 导出流程
1. 解码 VP8/VP9 → VideoFrame
2. 应用背景合成 (可选)
3. 重新编码为 H.264
4. 封装到 MP4 容器
5. 生成下载文件

### Worker 系统
- **主线程**：UI 交互和进度显示
- **Export Worker**：格式转换和容器封装
- **Composite Worker**：背景合成处理
- **Transcode Worker**：视频转码 (MP4)

## 📊 性能特性

### 内存管理
- 分块处理大视频文件
- 及时释放 VideoFrame 资源
- 避免内存泄漏

### 并发处理
- Worker 多线程架构
- 非阻塞 UI 操作
- 可取消的导出任务

### 错误处理
- 完善的错误捕获
- 用户友好的错误提示
- 自动降级机制

## 🎨 背景合成

### 支持的效果
- **渐变背景**：多色渐变效果
- **纯色背景**：单色背景
- **圆角视频**：可调节圆角半径
- **阴影效果**：可配置阴影参数
- **视频内缩**：调整视频在背景中的位置

### 配置参数
```typescript
backgroundConfig: {
  type: 'gradient',           // 背景类型
  color: '#3b82f6',          // 主色调
  padding: 60,               // 边距
  outputRatio: '16:9',       // 输出比例
  videoPosition: 'center',   // 视频位置
  borderRadius: 25,          // 圆角半径
  inset: 80,                 // 内缩距离
  shadow: {                  // 阴影效果
    offsetX: 20,
    offsetY: 30,
    blur: 60,
    color: 'rgba(0, 0, 0, 0.6)'
  }
}
```

## 🔍 调试信息

### 控制台日志
- `🎬 [Export]` - 导出流程日志
- `📦 [WebM-Worker]` - WebM 处理日志
- `🎥 [MP4-Worker]` - MP4 处理日志
- `🎨 [Composite]` - 合成处理日志

### 错误排查
1. **WebCodecs 不支持**：自动降级到 MediaRecorder
2. **内存不足**：分块处理和内存清理
3. **编码失败**：详细错误信息和重试机制
4. **下载失败**：Chrome API 和直接下载双重保障
5. **MP4 分辨率错误**：自动选择合适的 AVC Level
6. **编码器配置失败**：智能降级到兼容的编码配置

### 常见问题解决

#### MP4 导出失败 - AVC Level 错误
**问题**：`The provided resolution has a coded area which exceeds the maximum coded area supported by the AVC level`

**解决方案**：
- 系统会自动检测分辨率并选择合适的 AVC Level
- 支持的分辨率范围：720x576 (Level 3.0) 到 3840x2160 (Level 5.1)
- 如果主要编码器不支持，会自动尝试降级选项

#### MP4 视频无法播放
**问题**：导出成功但视频文件无法播放

**解决方案**：
- 已实现完整的 MP4 容器格式
- 包含所有必需的 MP4 box：ftyp, moov, mdat, trak, mdia, minf, stbl 等
- 正确的时间戳和偏移量计算
- 兼容标准 MP4 播放器

#### 编码器支持检查
系统会按以下顺序尝试编码器：
1. `avc1.42E028` - Level 4.0 (1920x1080)
2. `avc1.42E01F` - Level 3.1 (1280x720)
3. `avc1.42E01E` - Level 3.0 (720x576)
4. `avc1.42001E` - Constrained Baseline Level 3.0
5. `avc1.420014` - Constrained Baseline Level 2.0

#### MP4 容器结构
完整的 MP4 文件结构：
```
ftyp (文件类型)
moov (电影头部)
  ├── mvhd (电影头部数据)
  └── trak (视频轨道)
      ├── tkhd (轨道头部)
      └── mdia (媒体)
          ├── mdhd (媒体头部)
          ├── hdlr (处理器引用)
          └── minf (媒体信息)
              ├── vmhd (视频媒体头部)
              ├── dinf (数据信息)
              └── stbl (样本表)
                  ├── stsd (样本描述)
                  ├── stts (时间到样本)
                  ├── stsc (样本到块)
                  ├── stsz (样本大小)
                  └── stco (块偏移)
mdat (媒体数据)
```

## 📈 后续扩展

### 计划功能
- [ ] 自定义导出参数
- [ ] 批量导出
- [ ] 更多视频格式支持
- [ ] 高级背景效果
- [ ] 导出预设管理

### 性能优化
- [ ] 硬件加速编码
- [ ] 流式处理
- [ ] 增量编码
- [ ] 智能质量调整

---

## 🎉 总结

新的视频导出功能提供了完整的端到端解决方案，从录制到导出，支持现代 Web 技术栈，确保高性能和良好的用户体验。通过 Worker 架构和合理的组件设计，实现了功能的模块化和可扩展性。
