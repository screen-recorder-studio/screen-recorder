# Screen Recorder Studio - 新功能实现 TODO

> **文档说明**: 本文档包含四个新用户故事的详细实现计划，包括需求背景、技术约束、业务路径和 AI 提示词。

> **最后更新**: 2026-01-08 | **技术评审状态**: ✅ 已优化

---

## 📋 目录

1. [🎯 ROI 分析：低难度高收益需求推荐](#🎯-roi-分析低难度高收益需求推荐)
2. [US-1.6: 摄像头 + 语音录制](#us-16-摄像头--语音录制)
3. [US-1.7: 页面标注工具](#us-17-页面标注工具)
4. [US-1.8: 鼠标轨迹录制](#us-18-鼠标轨迹录制)
5. [US-1.9: Web 页面录制（非扩展）](#us-19-web-页面录制非扩展)
6. [📊 总结与工作量估算](#📊-总结)
7. [F-7: Veo 虚拟主播集成](#🎬-f-7-veo-虚拟主播集成未来功能)
8. [F-6 Phase 1: 基础字幕功能](#🎤-f-6-phase-1-基础字幕功能quick-win)

---

## ⚠️ 技术注意事项

在实现本文档中的功能时，请注意以下关键技术点：

### **WebCodecs API**
- `EncodedVideoChunk` 和 `EncodedAudioChunk` **没有 `.data` 属性**
- 必须使用 `chunk.copyTo(buffer)` 方法获取编码数据
- 使用 `Transferable` 对象传递数据以提高性能

### **AudioEncoder**
- 需要 `AudioData` 对象作为输入，而非 `AudioBuffer`
- 推荐使用 `AudioWorklet` 处理音频流（性能更好）
- 可降级到 `ScriptProcessorNode`（已弃用但兼容性更好）

### **OPFS (Origin Private File System)**
- 使用 `FileSystemSyncAccessHandle` 进行高频写入（Worker 中）
- 索引文件定期刷新（每 100 个 chunk）
- 音频需要记录 `duration` 用于同步

### **CaptureController**
- 仅 Chrome 109+ 支持
- 需要在调用前检测 API 可用性
- 不支持时自动降级为系统指针

---

## 🤖 统一 AI Prompt 模板（推荐直接复用）

> 目的：让 AI 输出“能落地的改动”，避免跑偏（乱造协议/乱造文件/时间戳单位不一致/靠行号定位）。

把下面模板复制到你的 AI 对话里，然后把【占位符】替换掉即可。

```
# 任务
实现【功能名 / 用户故事 ID】，目标是【一句话目标】。

## 约束（必须遵守）
1) 禁止硬编码行号：不要引用“第 xxx 行”。请用搜索定位符号/关键字。
  - 你必须先搜索并阅读相关实现，再开始改动。
2) 禁止瞎编/先读后改：在新增任何 message type、文件名、目录名、字段名之前，必须先阅读并复用现有实现。
  - 不要凭空新造消息协议（worker message types）、OPFS 目录结构、索引格式。
  - 若确实需要扩展：必须在同一处集中定义协议，并同步更新所有发送/接收方。
3) 时间戳单位统一：跨模块传递的时间戳一律使用 WebCodecs 的 timestamp 语义（微秒 us）。
  - 来源为 performance.now()/Date.now()（毫秒 ms）时，必须在边界处转换：us = ms * 1000。
  - VideoFrame.timestamp / Encoded*Chunk.timestamp / 索引文件 timestamp 字段必须同单位（us）。
4) 最小改动原则：只实现本需求，避免顺手重构/改名/大范围格式化。
5) 失败处理要明确：权限拒绝、API 不支持、设备缺失等需要明确降级或报错路径。

## 仓库与构建信息（以本仓库为准）
- 包管理：pnpm
- 开发：pnpm dev
- 生产构建：pnpm build
- 扩展构建：pnpm build:extension（产物在 build/）

## 现有实现导读（你必须先阅读/搜索这些）
请用全局搜索定位并阅读：
- Offscreen：OFFSCREEN_START_RECORDING / handleOffscreenStartRecording / STREAM_START / STREAM_META
- OPFS Writer：msg.type === 'init' | 'append' | 'finalize'（以及 meta.json/index.jsonl 写入）
- OPFS Reader（如涉及）：msg.type === 'open' | 'range'
- Composite Worker（如涉及）：OffscreenCanvas / drawImage / 主渲染循环

## 需要修改的文件（候选，按需确认）
- 【文件 1】（原因：...）
- 【文件 2】（原因：...）

## 输出要求
1) 先给出“你打算改哪些文件/新增哪些消息/新增哪些 OPFS 文件（如有）”的清单。
2) 说明每一处改动如何满足需求与约束（尤其是时间戳 us 与协议一致性）。
3) 给出可执行的验证步骤与验收标准（AC），包含至少：
  - 主流程成功
  - 1-2 个错误/降级场景
  - 时间戳/同步正确性（如涉及多轨）

## 验收标准（示例，可按功能调整）
- ✅ 【关键能力 1】在【场景】下工作
- ✅ 时间戳单位全链路为微秒 us（可通过日志/索引字段核对）
- ✅ 不引入未定义的消息名/文件名（与现有协议一致或集中扩展）
- ✅ 失败/降级路径明确且不会卡死录制/导出流程

现在开始：先搜索并总结现有协议与存储结构，再提出改动方案与补丁。
```


## 🎯 ROI 分析：低难度高收益需求推荐

> 基于 `feature-feasibility-analysis.md` 的全面分析，以下按 **ROI（投资回报率）** 排序推荐优先实现的需求。

### **ROI 评估标准**

| 维度 | 权重 | 说明 |
|------|------|------|
| **用户价值** | 40% | 解决用户核心痛点的程度 |
| **技术可行性** | 30% | API 成熟度、浏览器支持度 |
| **实现成本** | 20% | 开发工作量（人天） |
| **差异化价值** | 10% | 相比竞品的独特优势 |

### **🏆 优先级排序（按 ROI 从高到低）**

| 排名 | 需求 | ROI 评分 | 工作量 | 理由 |
|------|------|---------|--------|------|
| 🥇 **1** | **US-1.7: 页面标注工具** | ⭐⭐⭐⭐⭐ | **3-5 天** | 极低成本，高可见度，简化实现后无技术风险 |
| 🥈 **2** | **F-6 Phase 1: 基础字幕功能** | ⭐⭐⭐⭐ | **10-15 天** | Web Speech API 免费可用，字幕是视频刚需 |
| 🥉 **3** | **US-1.8: 鼠标轨迹录制** | ⭐⭐⭐⭐ | **10-15 天** | 教程场景刚需，CaptureController 已验证 |
| 4 | **F-1: 音频录制（仅音频）** | ⭐⭐⭐⭐ | **5-8 天** | AudioEncoder 成熟，可先做音频再做摄像头 |
| 5 | **US-1.6: 摄像头 + 语音录制** | ⭐⭐⭐ | **28-40 天** | 完整功能复杂度高，建议拆分实施 |
| 6 | **F-5 简化版: 静态虚拟人** | ⭐⭐ | **5-7 天** | 无 AI，使用预设头像 + 音量驱动动画 |
| 7 | **F-7: Veo 虚拟主播** | ⭐ | **30-45 天** | 依赖外部 API，成本高，适合付费用户 |

---

### **🚀 快速胜利（Quick Wins）推荐**

以下需求可在 **1-2 周内** 完成，立即提升产品竞争力：

#### **Quick Win #1: 页面标注工具（US-1.7）**

| 项目 | 内容 |
|------|------|
| **工作量** | 3-5 天 |
| **用户价值** | ⭐⭐⭐⭐⭐ 教程/演示场景的核心需求 |
| **技术风险** | 🟢 极低（纯前端 Canvas 绑定） |
| **竞品对比** | Loom、Screencast 均有此功能 |
| **ROI 理由** | 投入产出比最高，3 天换来专业级功能 |

**为什么优先做？**
- ✅ 简化实现后只需修改 Content Script，无需后端
- ✅ 标注自动被屏幕录制捕获，无需单独存储
- ✅ 用户可见度高，明显提升产品专业感

---

#### **Quick Win #2: 基础字幕功能（F-6 Phase 1）**

| 项目 | 内容 |
|------|------|
| **工作量** | 10-15 天 |
| **用户价值** | ⭐⭐⭐⭐ 无障碍访问 + SEO 优化 |
| **技术风险** | 🟢 低（Web Speech API 成熟） |
| **竞品对比** | 大多数竞品需付费才有字幕 |
| **ROI 理由** | 免费 API + 中等工作量 = 高性价比 |

**实现范围**：
```
录制语音 → Web Speech API STT → 字幕数据 → 编辑器校对 → 渲染到视频
```

**技术要点**：
- 使用 `webkitSpeechRecognition` 实时转写（Chrome/Edge）
- 存储格式：SRT 或 WebVTT
- 编辑器：时间轴 + 文本修正 UI

---

#### **Quick Win #3: 仅音频录制（F-1 拆分版）**

| 项目 | 内容 |
|------|------|
| **工作量** | 5-8 天 |
| **用户价值** | ⭐⭐⭐⭐ 语音讲解是刚需 |
| **技术风险** | 🟢 低（AudioEncoder 已成熟） |
| **ROI 理由** | 比完整 US-1.6 快 4 倍，先交付核心价值 |

**为什么先做音频？**
- ✅ 摄像头 + 音频 + 画中画太复杂，容易延期
- ✅ 纯音频录制 + 同步是 80% 用户的核心需求
- ✅ 摄像头功能可作为 Phase 2 交付

**拆分策略**：
| Phase | 内容 | 工作量 |
|-------|------|--------|
| **Phase 1** | 音频录制 + OPFS 存储 | 5-8 天 |
| **Phase 2** | 摄像头录制 + PiP UI | 10-14 天 |
| **Phase 3** | 编辑端音画同步合成 | 15-20 天 |

---

### **📋 建议实施顺序**

基于 ROI 分析，推荐按以下顺序实施：

```
Week 1-2:   US-1.7 页面标注工具（3-5 天）
            ↓
Week 2-3:   F-1 Phase 1 音频录制（5-8 天）
            ↓
Week 4-5:   US-1.8 鼠标轨迹录制（10-15 天）
            ↓
Week 6-8:   F-6 Phase 1 基础字幕（10-15 天）
            ↓
Week 9-12:  F-1 Phase 2-3 摄像头 + 编辑端（25-34 天）
```

**总计**: 约 53-77 天完成所有高 ROI 需求

---

## US-1.6: 摄像头 + 语音录制

### 📝 用户故事

> 作为一名**教育工作者**，我需要在录制屏幕操作的同时录制我的摄像头画面和语音讲解，并将它们合成到最终视频中（画中画效果），以便学生能够看到我的面部表情和听到我的讲解，增强教学效果。

### 🎯 需求背景

- **目标用户**: 教育工作者、在线讲师、技术博主、产品演示者
- **核心价值**: 提升视频的人性化和互动性，增强观众的参与感和理解度
- **使用场景**: 
  - 在线教育课程录制
  - 产品演示和讲解
  - 技术教程制作
  - 企业培训视频
- **预期收益**: 
  - 提升用户留存率（相比纯屏幕录制）
  - 增强视频的专业性和可信度
  - 支持多语言配音（后期扩展）

### 🔧 技术约束

#### **浏览器 API 限制**
- `getUserMedia()` 需要 HTTPS 或 localhost 环境
- 摄像头和麦克风权限需要用户授权
- Chrome 94+ 支持 `AudioEncoder` API
- 音视频流需要独立编码器实例

#### **OPFS 存储限制**
- 需要扩展现有 OPFS 存储结构
- 音频和摄像头视频需要独立索引文件
- 存储开销：约 6.4-11.4 MB/分钟（音频 + 摄像头）

#### **性能约束**
- 同时运行 3 个编码器（屏幕 + 摄像头 + 音频）
- 需要音画同步机制（基于 timestamp）
- 合成时需要解码 2 个视频流 + 1 个音频流

#### **架构约束**
- 必须在 Offscreen Document 中运行（MV3 限制）
- 编码器必须在 Worker 中运行（避免阻塞主线程）
- 需要扩展现有的消息总线协议

### 📂 可能修改的业务路径和文件

#### **阶段 1: 录制端 - 摄像头和音频捕获**（7-11 天）

**核心文件**:
1. **`src/extensions/offscreen-main.ts`** (主要修改)
   - 添加 `getUserMedia()` 调用获取摄像头和麦克风流
   - 创建独立的 `VideoEncoder` 实例编码摄像头视频
   - 创建 `AudioEncoder` 实例编码音频
   - 管理 3 个编码器的生命周期

2. **`src/lib/workers/opfs-writer-worker.ts`** (扩展)
   - 添加 `camera.bin` 和 `camera-index.jsonl` 写入逻辑
   - 添加 `audio.bin` 和 `audio-index.jsonl` 写入逻辑
   - 扩展消息协议支持多轨道写入

3. **`src/extensions/background.ts`** (轻微修改)
   - 添加摄像头/音频启用选项到录制配置
   - 扩展 `STREAM_META` 消息包含摄像头/音频元数据

4. **`src/routes/popup/+page.svelte`** (UI 扩展)
   - 添加摄像头启用开关
   - 添加音频启用开关
   - 添加设备选择下拉框（摄像头/麦克风）
   - 添加实时预览组件

5. **`src/lib/stores/recording.svelte.ts`** (状态扩展)
   - 添加 `cameraEnabled: boolean`
   - 添加 `audioEnabled: boolean`
   - 添加 `selectedCameraId: string`
   - 添加 `selectedMicrophoneId: string`

**新增文件**:
- **`src/lib/workers/audio-encoder-worker.ts`** (新建)
  - 独立的音频编码器 Worker
  - 使用 `AudioEncoder` API 编码为 Opus

**OPFS 存储结构扩展**:
```
rec_<id>/
├── data.bin              # 屏幕录制视频数据
├── index.jsonl           # 屏幕录制视频索引
├── camera.bin            # 🆕 摄像头视频数据
├── camera-index.jsonl    # 🆕 摄像头视频索引
├── audio.bin             # 🆕 音频数据
├── audio-index.jsonl     # 🆕 音频索引
└── meta.json             # 元数据（扩展包含摄像头/音频配置）
```

**meta.json 扩展**:
```json
{
  "id": "rec_xxx",
  "createdAt": 1234567890,
  "completed": true,
  "codec": "vp9",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "camera": {
    "enabled": true,
    "codec": "vp9",
    "width": 1280,
    "height": 720,
    "fps": 30,
    "deviceId": "camera_device_id"
  },
  "audio": {
    "enabled": true,
    "codec": "opus",
    "sampleRate": 48000,
    "channels": 2,
    "bitrate": 192000,
    "deviceId": "microphone_device_id"
  }
}
```

#### **阶段 2: 编辑端 - 画中画合成**（17-24 天）

**核心文件**:
1. **`src/lib/workers/composite-worker/index.ts`** (主要修改)
   - 添加摄像头视频解码器
   - 添加音频解码器
   - 实现画中画合成逻辑（Canvas 叠加）
   - 实现音频混合逻辑

2. **`src/lib/workers/opfs-reader-worker.ts`** (扩展)
   - 添加读取 `camera.bin` 和 `camera-index.jsonl` 逻辑
   - 添加读取 `audio.bin` 和 `audio-index.jsonl` 逻辑
   - 支持多轨道窗口化加载

3. **`src/routes/studio/+page.svelte`** (UI 扩展)
   - 添加画中画配置面板
   - 添加摄像头位置选择（4 个角落）
   - 添加摄像头大小调节（小/中/大）
   - 添加音频音量调节

4. **`src/lib/components/VideoPreviewComposite.svelte`** (扩展)
   - 支持显示画中画预览
   - 支持音频播放

5. **`src/lib/stores/camera-pip.svelte.ts`** (新建)
   - 画中画配置状态管理
   - `position: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'`
   - `size: 'small' | 'medium' | 'large'`
   - `borderRadius: number`
   - `borderWidth: number`
   - `borderColor: string`

**画中画合成逻辑**:
```typescript
// composite-worker/index.ts
function renderPictureInPicture(
  mainCanvas: OffscreenCanvas,
  mainFrame: VideoFrame,
  cameraFrame: VideoFrame,
  config: PiPConfig
) {
  const ctx = mainCanvas.getContext('2d')!

  // 1. 绘制主视频（屏幕录制）
  ctx.drawImage(mainFrame, 0, 0, mainCanvas.width, mainCanvas.height)

  // 2. 计算摄像头画面位置和大小
  const pipSize = calculatePiPSize(mainCanvas.width, mainCanvas.height, config.size)
  const pipPosition = calculatePiPPosition(mainCanvas.width, mainCanvas.height, pipSize, config.position)

  // 3. 绘制摄像头画面（带圆角和边框）
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(pipPosition.x, pipPosition.y, pipSize.width, pipSize.height, config.borderRadius)
  ctx.clip()
  ctx.drawImage(cameraFrame, pipPosition.x, pipPosition.y, pipSize.width, pipSize.height)
  ctx.restore()

  // 4. 绘制边框
  if (config.borderWidth > 0) {
    ctx.strokeStyle = config.borderColor
    ctx.lineWidth = config.borderWidth
    ctx.beginPath()
    ctx.roundRect(pipPosition.x, pipPosition.y, pipSize.width, pipSize.height, config.borderRadius)
    ctx.stroke()
  }
}
```

**音画同步逻辑**:
```typescript
// composite-worker/index.ts
function syncAudioVideo(
  screenTimestamp: number,
  cameraTimestamp: number,
  audioTimestamp: number
): { screenFrame: VideoFrame, cameraFrame: VideoFrame, audioSamples: Float32Array } {
  // 1. 找到最接近的摄像头帧
  const cameraFrame = findClosestFrame(cameraFrames, screenTimestamp)

  // 2. 找到对应的音频样本
  const audioSamples = extractAudioSamples(audioBuffer, screenTimestamp, frameDuration)

  return { screenFrame, cameraFrame, audioSamples }
}
```

### 🤖 AI 提示词

#### **提示词 1: 录制端实现**

```
# 任务：实现摄像头 + 语音录制功能

## 需求背景
当前 Screen Recorder Studio 支持屏幕/窗口/Tab 录制，但缺少摄像头和音频录制能力。
需要添加摄像头画面和语音讲解录制，以支持教育工作者制作讲解型视频。

## 技术栈约束

### **项目技术栈**
- **框架**: SvelteKit 2 + Svelte 5（使用 Runes 语法：`$state`、`$derived`、`$effect`）
- **语言**: TypeScript 5.x
- **构建工具**: Vite 7
- **Chrome Extension**: Manifest V3
- **视频编码**: WebCodecs API (VideoEncoder, AudioEncoder, VideoDecoder, AudioDecoder)
- **存储**: Origin Private File System (OPFS)

### **Chrome Extension 架构**
- **Service Worker**: `src/extensions/background.ts`（消息路由、状态管理）
- **Offscreen Document**: `src/extensions/offscreen-main.ts`（媒体流捕获、编码）
- **Content Script**: `src/extensions/content.ts`（页面交互、元素选择）
- **Popup**: `src/routes/popup/+page.svelte`（录制控制界面）
- **Studio**: `src/routes/studio/+page.svelte`（编辑界面）

### **构建过程**
```bash
# 开发模式（监听文件变化，自动重新构建）
pnpm dev

# 构建生产版本
pnpm build

# 构建扩展（生成可在 chrome://extensions 加载的产物）
pnpm build:extension

# 构建输出目录（本仓库为 build/）
build/
├── manifest.json          # Extension 配置
├── background.js          # Service Worker
├── offscreen.html         # Offscreen Document 页面
├── offscreen.js           # Offscreen Document 脚本
├── content.js             # Content Script
└── ...
```

### **Extension 源码位置**
- **Extension 脚本**: `src/extensions/`
  - `background.ts` - Service Worker（消息路由、Tab 状态管理）
  - `offscreen-main.ts` - Offscreen Document（媒体流捕获、WebCodecs 编码）
  - `content.ts` - Content Script（页面交互、元素/区域选择）
- **构建配置**: `vite.config.ts`（Extension 构建配置）
- **Manifest**: `static/manifest.json`（Extension 清单文件）

### **重要说明**
1. **修改 Extension 脚本后需要重新构建**: 修改 `src/extensions/` 下的文件后，需要运行 `pnpm dev` 或 `pnpm build`
2. **重新加载 Extension**: 构建后需要在 Chrome 扩展管理页面点击"重新加载"按钮
3. **Svelte 5 Runes 语法**: 所有 Svelte 组件和 Store 使用 Runes 语法（`$state`、`$derived`、`$effect`）

## 技术约束
1. **浏览器 API**: 使用 getUserMedia() 获取摄像头和麦克风流
2. **编码器**: 使用 VideoEncoder 编码摄像头视频（VP9/H.264），使用 AudioEncoder 编码音频（Opus 192kbps）
3. **架构**: 必须在 Offscreen Document 中运行（Chrome MV3 限制，Service Worker 无法访问 getUserMedia）
4. **存储**: 扩展 OPFS 存储结构，添加 camera.bin、camera-index.jsonl、audio.bin、audio-index.jsonl
5. **性能**: 同时运行 3 个编码器（屏幕 + 摄像头 + 音频），需要注意性能开销

## 现有代码结构
- **录制入口**: src/extensions/offscreen-main.ts（处理 OFFSCREEN_START_RECORDING 消息）
- **编码器**: src/extensions/encoder-worker.ts（屏幕视频编码器）
- **OPFS 写入**: src/lib/workers/opfs-writer-worker.ts（流式写入 data.bin 和 index.jsonl）
- **状态管理**: src/lib/stores/recording.svelte.ts（录制状态，使用 Svelte 5 Runes）
- **UI**: src/routes/popup/+page.svelte（录制配置界面，使用 Svelte 5 Runes）

## 强约束（请严格遵守）
1. **禁止瞎编/先读后改**：在新增任何 message type、文件名、目录名、字段名之前，必须先阅读并复用现有实现（尤其是 `offscreen-main.ts` 的消息分发、`opfs-writer-worker.ts` 的消息协议与 `rec_<id>/` 存储结构）。
  - 不要凭空创建诸如 `append-camera`/`append-audio`/`append-mouse` 等消息名，除非你已经确认当前代码协议确实需要扩展，并在同一处集中定义与更新所有发送/接收方。
  - 不要新造 `rec_<id>/` 下的文件名/索引格式；优先按现有 `data.bin` + `index.jsonl` + `meta.json` 的模式扩展。
2. **时间戳单位统一**：所有跨模块传递的时间戳一律使用 WebCodecs 的 `timestamp` 语义（**微秒 us**）。
  - 如果来源是 `performance.now()`（毫秒 ms）或 `Date.now()`（毫秒 ms），必须在边界处转换：$us = ms \times 1000$。
  - `VideoFrame.timestamp` / `Encoded*Chunk.timestamp` / 索引文件 `timestamp` 字段必须使用同一单位（us），否则多轨同步会错位。
3. **禁止硬编码行号**：不要按“第 xxx 行”定位代码。请使用搜索定位符号/关键字（例如：`OFFSCREEN_START_RECORDING`、`handleOffscreenStartRecording`、`STREAM_START`、`STREAM_META`、`finalize`、`append`）。

## 需要修改的文件

### 1. src/extensions/offscreen-main.ts
**修改点**:
- 在 handleOffscreenStartRecording() 中添加 getUserMedia() 调用
- 创建独立的 VideoEncoder 实例编码摄像头视频
- 创建 AudioEncoder 实例编码音频
- 将编码后的数据发送到 OPFS Writer（使用不同的消息类型区分屏幕/摄像头/音频）

**参考现有代码**:
请用搜索定位以下关键点（避免行号漂移）：
- `OFFSCREEN_START_RECORDING` / `handleOffscreenStartRecording`
- `case 'complete'`（录制完成与 finalize 流程）
- `STREAM_START` / `STREAM_META`（录制开始与元数据广播）

**实现要点**:
```typescript
// 1. 获取摄像头和麦克风流（带错误处理）
let cameraStream: MediaStream | null = null
let audioStream: MediaStream | null = null

try {
  // 检查 API 可用性
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia API not available')
  }

  // 获取摄像头流
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: options.cameraDeviceId ? { exact: options.cameraDeviceId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    },
    audio: false
  })
} catch (e) {
  const error = e as Error
  if (error.name === 'NotAllowedError') {
    console.error('Camera permission denied by user')
    chrome.runtime.sendMessage({ type: 'STREAM_ERROR', error: 'CAMERA_PERMISSION_DENIED' })
  } else if (error.name === 'NotFoundError') {
    console.error('No camera device found')
    chrome.runtime.sendMessage({ type: 'STREAM_ERROR', error: 'CAMERA_NOT_FOUND' })
  } else if (error.name === 'OverconstrainedError') {
    console.error('Camera constraints not satisfiable, trying fallback')
    // 降级尝试：不指定设备 ID
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    })
  } else {
    console.error('Camera access failed:', error)
    chrome.runtime.sendMessage({ type: 'STREAM_ERROR', error: `CAMERA_ERROR: ${error.message}` })
  }
}

try {
  // 获取麦克风流
  audioStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: {
      deviceId: options.microphoneDeviceId ? { exact: options.microphoneDeviceId } : undefined,
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 2 },
      echoCancellation: true,
      noiseSuppression: true
    }
  })
} catch (e) {
  const error = e as Error
  if (error.name === 'NotAllowedError') {
    console.error('Microphone permission denied by user')
    chrome.runtime.sendMessage({ type: 'STREAM_ERROR', error: 'MIC_PERMISSION_DENIED' })
  } else if (error.name === 'NotFoundError') {
    console.error('No microphone device found')
    // 麦克风可选，继续录制但无音频
    console.warn('Continuing without audio')
  } else {
    console.error('Microphone access failed:', error)
  }
}

// 验证至少有摄像头流
if (!cameraStream) {
  throw new Error('Failed to acquire camera stream')
}

// 2. 创建摄像头视频编码器
const cameraEncoder = new VideoEncoder({
  output: (chunk, metadata) => {
    // ⚠️ EncodedVideoChunk 没有 .data 属性，需要使用 copyTo() 方法
    const buffer = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(buffer)

    // 发送到 OPFS Writer（使用 Transferable）
    opfsWriter.postMessage({
      type: 'append-camera',
      buffer,
      timestamp: chunk.timestamp,
      chunkType: chunk.type,
      isKeyframe: chunk.type === 'key'
    }, [buffer])
  },
  error: (e) => console.error('Camera encoder error:', e)
})

// 3. 创建音频编码器
const audioEncoder = new AudioEncoder({
  output: (chunk, metadata) => {
    // ⚠️ EncodedAudioChunk 没有 .data 属性，需要使用 copyTo() 方法
    const buffer = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(buffer)

    // 发送到 OPFS Writer（使用 Transferable）
    opfsWriter.postMessage({
      type: 'append-audio',
      buffer,
      timestamp: chunk.timestamp,
      duration: chunk.duration
    }, [buffer])
  },
  error: (e) => console.error('Audio encoder error:', e)
})

// 4. 配置编码器（注意：configure() 是同步方法，不需要 await）
cameraEncoder.configure({
  codec: 'vp09.00.10.08', // VP9 Profile 0, Level 1.0
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  framerate: 30,
  latencyMode: 'realtime', // 实时编码，降低延迟
  hardwareAcceleration: 'prefer-hardware' // 优先使用硬件加速
})

audioEncoder.configure({
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 192000
  // ⚠️ 注意：AudioEncoder 不支持 hardwareAcceleration 选项
})

// 5. 从流中读取帧并编码（使用 MediaStreamTrackProcessor）
const cameraTrack = cameraStream.getVideoTracks()[0]
const cameraProcessor = new MediaStreamTrackProcessor({ track: cameraTrack })
const cameraReader = cameraProcessor.readable.getReader()

// 摄像头帧处理循环
async function processCameraFrames() {
  try {
    while (true) {
      const { done, value: frame } = await cameraReader.read()
      if (done) break

      // 关键帧策略：每 60 帧（约 2 秒）强制一个关键帧
      const keyFrame = cameraFrameCount % 60 === 0
      cameraEncoder.encode(frame, { keyFrame })
      frame.close() // ⚠️ 必须关闭 VideoFrame 以释放资源
      cameraFrameCount++
    }
  } catch (e) {
    console.error('Camera frame processing error:', e)
  }
}

// 6. 音频处理（使用 AudioWorklet 或 ScriptProcessorNode）
// ⚠️ 注意：AudioEncoder 需要 AudioData 对象，不是 AudioBuffer
if (audioStream) {
  const audioContext = new AudioContext({ sampleRate: 48000 })
  const source = audioContext.createMediaStreamSource(audioStream)

  // 使用 AudioWorklet（推荐）或降级到 ScriptProcessorNode
  // ⚠️ Extension / Offscreen 环境建议使用 chrome.runtime.getURL() 加载 worklet
  // 同时确保该文件会被打包进 build/ 并可被 Offscreen Document 访问
  await audioContext.audioWorklet.addModule(chrome.runtime.getURL('workers/audio-processor.js'))
  const audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor')

  audioWorkletNode.port.onmessage = (e) => {
    const { samples, timestamp } = e.data
    // 创建 AudioData 并编码
    // ⚠️ 时间戳单位需与 WebCodecs 保持一致（通常使用微秒 us）
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: 48000,
      numberOfFrames: samples[0].length,
      numberOfChannels: 2,
      timestamp,
      data: new Float32Array([...samples[0], ...samples[1]])
    })
    audioEncoder.encode(audioData)
    audioData.close()
  }

  source.connect(audioWorkletNode)
}
```

### 2. src/lib/workers/opfs-writer-worker.ts
**修改点**:
- 添加 camera.bin 和 camera-index.jsonl 文件句柄
- 添加 audio.bin 和 audio-index.jsonl 文件句柄
- 扩展消息协议支持 'append-camera' 和 'append-audio' 消息类型
- 在 meta.json 中添加摄像头和音频配置

**参考现有代码**:
请用搜索定位以下关键点（避免行号漂移）：
- `openDataFile` / `appendData` / `closeData`
- `msg.type === 'init'` / `msg.type === 'append'` / `msg.type === 'finalize'`

**实现要点**:
```typescript
// 1. 添加新的文件句柄
let cameraDataHandle: FileSystemFileHandle | null = null
let cameraSyncHandle: FileSystemSyncAccessHandle | null = null
let cameraIndexHandle: FileSystemFileHandle | null = null
let cameraIndexBuffer: string[] = []

let audioDataHandle: FileSystemFileHandle | null = null
let audioSyncHandle: FileSystemSyncAccessHandle | null = null
let audioIndexHandle: FileSystemFileHandle | null = null
let audioIndexBuffer: string[] = []

// 2. 在 init 消息中创建文件
if (msg.type === 'init') {
  // ... 现有代码 ...

  // 创建摄像头文件
  cameraDataHandle = await recDir.getFileHandle('camera.bin', { create: true })
  cameraSyncHandle = await cameraDataHandle.createSyncAccessHandle()
  cameraIndexHandle = await recDir.getFileHandle('camera-index.jsonl', { create: true })

  // 创建音频文件
  audioDataHandle = await recDir.getFileHandle('audio.bin', { create: true })
  audioSyncHandle = await audioDataHandle.createSyncAccessHandle()
  audioIndexHandle = await recDir.getFileHandle('audio-index.jsonl', { create: true })
}

// 3. 处理 append-camera 消息
let cameraOffset = 0
let cameraChunksWritten = 0

if (msg.type === 'append-camera') {
  if (!cameraSyncHandle) throw new Error('Camera writer not initialized')
  const u8 = new Uint8Array(msg.buffer)

  // ⚠️ SyncAccessHandle.write() 返回写入的字节数
  const written = cameraSyncHandle.write(u8, { at: cameraOffset })
  const actualOffset = cameraOffset
  cameraOffset += (typeof written === 'number' ? written : u8.byteLength)

  cameraIndexBuffer.push(JSON.stringify({
    offset: actualOffset,
    size: u8.byteLength,
    timestamp: msg.timestamp,
    type: msg.chunkType,
    isKeyframe: msg.isKeyframe
  }) + '\n')

  cameraChunksWritten++

  // 每 100 个 chunk 刷新一次索引
  if (cameraChunksWritten % 100 === 0) {
    await flushCameraIndex()
  }
}

// 4. 处理 append-audio 消息
let audioOffset = 0
let audioChunksWritten = 0

if (msg.type === 'append-audio') {
  if (!audioSyncHandle) throw new Error('Audio writer not initialized')
  const u8 = new Uint8Array(msg.buffer)

  const written = audioSyncHandle.write(u8, { at: audioOffset })
  const actualOffset = audioOffset
  audioOffset += (typeof written === 'number' ? written : u8.byteLength)

  audioIndexBuffer.push(JSON.stringify({
    offset: actualOffset,
    size: u8.byteLength,
    timestamp: msg.timestamp,
    duration: msg.duration // ⚠️ 音频需要记录 duration 用于同步
  }) + '\n')

  audioChunksWritten++

  if (audioChunksWritten % 100 === 0) {
    await flushAudioIndex()
  }
}

// 5. 刷新索引文件的辅助函数
async function flushCameraIndex() {
  if (!cameraIndexHandle || cameraIndexBuffer.length === 0) return
  const text = cameraIndexBuffer.join('')
  const fh = await recDir.getFileHandle('camera-index.jsonl', { create: true })
  const writable = await (fh as any).createWritable({ keepExistingData: false })
  await writable.write(new Blob([text], { type: 'text/plain' }))
  await writable.close()
}

async function flushAudioIndex() {
  if (!audioIndexHandle || audioIndexBuffer.length === 0) return
  const text = audioIndexBuffer.join('')
  const fh = await recDir.getFileHandle('audio-index.jsonl', { create: true })
  const writable = await (fh as any).createWritable({ keepExistingData: false })
  await writable.write(new Blob([text], { type: 'text/plain' }))
  await writable.close()
}
```

### 3. src/routes/popup/+page.svelte
**修改点**:
- 添加摄像头启用开关
- 添加音频启用开关
- 添加设备选择下拉框
- 添加实时预览组件

**实现要点**:
```svelte
<script lang="ts">
  import { recordingStore } from '$lib/stores/recording.svelte'

  let cameraEnabled = $state(false)
  let audioEnabled = $state(false)
  let cameras = $state<MediaDeviceInfo[]>([])
  let microphones = $state<MediaDeviceInfo[]>([])
  let selectedCameraId = $state('')
  let selectedMicrophoneId = $state('')

  // 枚举设备
  async function enumerateDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices()
    cameras = devices.filter(d => d.kind === 'videoinput')
    microphones = devices.filter(d => d.kind === 'audioinput')
    if (cameras.length > 0) selectedCameraId = cameras[0].deviceId
    if (microphones.length > 0) selectedMicrophoneId = microphones[0].deviceId
  }

  $effect(() => {
    enumerateDevices()
  })
</script>

<!-- 摄像头选项 -->
<div class="space-y-2">
  <label class="flex items-center gap-2">
    <input type="checkbox" bind:checked={cameraEnabled} />
    <span>启用摄像头</span>
  </label>

  {#if cameraEnabled}
    <select bind:value={selectedCameraId} class="w-full">
      {#each cameras as camera}
        <option value={camera.deviceId}>{camera.label || '摄像头 ' + camera.deviceId.slice(0, 8)}</option>
      {/each}
    </select>
  {/if}
</div>

<!-- 音频选项 -->
<div class="space-y-2">
  <label class="flex items-center gap-2">
    <input type="checkbox" bind:checked={audioEnabled} />
    <span>启用音频</span>
  </label>

  {#if audioEnabled}
    <select bind:value={selectedMicrophoneId} class="w-full">
      {#each microphones as mic}
        <option value={mic.deviceId}>{mic.label || '麦克风 ' + mic.deviceId.slice(0, 8)}</option>
      {/each}
    </select>
  {/if}
</div>
```

## 实现步骤
1. 修改 offscreen-main.ts 添加 getUserMedia() 调用和编码器
2. 修改 opfs-writer-worker.ts 添加多轨道写入支持
3. 修改 popup 添加 UI 控件
4. 测试录制功能，确保 3 个编码器同时工作
5. 验证 OPFS 存储结构正确

## 验证标准
- ✅ 能够同时录制屏幕、摄像头和音频
- ✅ OPFS 中生成 6 个文件（data.bin, index.jsonl, camera.bin, camera-index.jsonl, audio.bin, audio-index.jsonl）
- ✅ meta.json 包含摄像头和音频配置
- ✅ 录制过程流畅，无明显性能问题

请实现上述功能。
```

#### **提示词 2: 编辑端画中画合成**

```
# 任务：实现画中画合成功能

## 需求背景
录制端已经实现了摄像头和音频录制，现在需要在编辑端实现画中画合成，将摄像头画面叠加到屏幕录制画面上。

## 技术栈约束

### **项目技术栈**
- **框架**: SvelteKit 2 + Svelte 5（使用 Runes 语法：`$state`、`$derived`、`$effect`）
- **语言**: TypeScript 5.x
- **构建工具**: Vite 7
- **视频解码**: WebCodecs API (VideoDecoder, AudioDecoder)
- **Canvas 合成**: OffscreenCanvas（在 Worker 中运行）
- **存储**: Origin Private File System (OPFS)

### **构建过程**
```bash
# 开发模式（监听文件变化，自动重新构建）
pnpm dev

# 构建生产版本
pnpm build
```

### **重要说明**
1. **Worker 文件修改后需要重新构建**: 修改 `src/lib/workers/` 下的文件后，需要运行 `pnpm dev` 或 `pnpm build`
2. **Svelte 5 Runes 语法**: 所有 Svelte 组件和 Store 使用 Runes 语法（`$state`、`$derived`、`$effect`）
3. **OffscreenCanvas**: 合成逻辑在 Worker 中运行，使用 OffscreenCanvas 进行 Canvas 操作

## 技术约束
1. **解码器**: 需要同时解码屏幕视频和摄像头视频（2 个 VideoDecoder 实例）
2. **音频**: 需要解码音频并混合到最终输出
3. **合成**: 使用 OffscreenCanvas 在 Composite Worker 中合成
4. **同步**: 基于 timestamp 对齐屏幕视频、摄像头视频和音频
5. **性能**: 窗口化加载需要同时加载 2 个视频轨道

## 现有代码结构
- **Studio 主页**: src/routes/studio/+page.svelte（主控制器，使用 Svelte 5 Runes）
- **视频预览**: src/lib/components/VideoPreviewComposite.svelte（播放控制，使用 Svelte 5 Runes）
- **OPFS 读取**: src/lib/workers/opfs-reader-worker.ts（读取 data.bin 和 index.jsonl）
- **合成 Worker**: src/lib/workers/composite-worker/index.ts（解码和合成）

## 需要修改的文件

### 1. src/lib/workers/opfs-reader-worker.ts
**修改点**:
- 添加读取 camera.bin 和 camera-index.jsonl 的逻辑
- 添加读取 audio.bin 和 audio-index.jsonl 的逻辑
- 扩展 'range' 消息返回多轨道数据

**参考现有代码**:
请用搜索定位以下关键点（避免行号漂移）：
- `msg.type === 'open'`（打开目录、读取 meta/索引）
- `msg.type === 'range'`（按范围读取 chunks 并返回给合成/预览）

**实现要点**:
```typescript
// 1. 在 open 消息中读取所有索引文件
let cameraIndexEntries: any[] = []
let audioIndexEntries: any[] = []

if (msg.type === 'open') {
  // ... 现有代码读取 index.jsonl ...

  // 读取摄像头索引
  try {
    const cameraIndexFile = await dir.getFileHandle('camera-index.jsonl')
    const cameraIndexBlob = await cameraIndexFile.getFile()
    const cameraIndexText = await cameraIndexBlob.text()
    cameraIndexEntries = cameraIndexText.split('\n').filter(Boolean).map(JSON.parse)
  } catch (e) {
    console.warn('No camera index found')
  }

  // 读取音频索引
  try {
    const audioIndexFile = await dir.getFileHandle('audio-index.jsonl')
    const audioIndexBlob = await audioIndexFile.getFile()
    const audioIndexText = await audioIndexBlob.text()
    audioIndexEntries = audioIndexText.split('\n').filter(Boolean).map(JSON.parse)
  } catch (e) {
    console.warn('No audio index found')
  }
}

// 2. 在 range 消息中返回多轨道数据
if (msg.type === 'range') {
  // ... 现有代码读取屏幕视频 chunks ...

  // 读取摄像头 chunks
  const cameraChunks = await readChunksInRange(
    cameraDataFile,
    cameraIndexEntries,
    startFrame,
    endFrame
  )

  // 读取音频 chunks
  const audioChunks = await readChunksInRange(
    audioDataFile,
    audioIndexEntries,
    startFrame,
    endFrame
  )

  self.postMessage({
    type: 'range',
    chunks: screenChunks,
    cameraChunks,
    audioChunks,
    // ... 其他元数据 ...
  })
}
```

### 2. src/lib/workers/composite-worker/index.ts
**修改点**:
- 添加摄像头视频解码器
- 添加音频解码器
- 实现画中画合成逻辑
- 实现音画同步逻辑

**参考现有代码**:
请用搜索定位以下关键点（避免行号漂移）：
- `OffscreenCanvas` 创建与尺寸更新
- 主渲染循环（通常会包含 `drawImage` / `ctx` 操作）
- PiP 相关字段（例如 `pip` / `camera` / `borderRadius` 等）

**实现要点**:
```typescript
// 1. 添加摄像头解码器
let cameraDecoder: VideoDecoder | null = null
let cameraFrames: VideoFrame[] = []

function initCameraDecoder(codec: string) {
  cameraDecoder = new VideoDecoder({
    output: (frame) => {
      cameraFrames.push(frame)
    },
    error: (e) => console.error('Camera decoder error:', e)
  })

  cameraDecoder.configure({ codec })
}

// 2. 修改 renderCompositeFrame 添加画中画
function renderCompositeFrame(
  screenFrame: VideoFrame,
  layout: VideoLayout,
  config: CompositeConfig,
  frameIndex: number
): ImageBitmap | null {
  // ... 现有代码绘制屏幕视频 ...

  // 查找对应的摄像头帧
  const cameraFrame = findClosestCameraFrame(screenFrame.timestamp)

  if (cameraFrame && config.pipEnabled) {
    // 计算画中画位置和大小
    const pipSize = calculatePiPSize(canvas.width, canvas.height, config.pipSize)
    const pipPos = calculatePiPPosition(canvas.width, canvas.height, pipSize, config.pipPosition)

    // 绘制摄像头画面（带圆角）
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(pipPos.x, pipPos.y, pipSize.width, pipSize.height, config.pipBorderRadius)
    ctx.clip()
    ctx.drawImage(cameraFrame, pipPos.x, pipPos.y, pipSize.width, pipSize.height)
    ctx.restore()

    // 绘制边框
    if (config.pipBorderWidth > 0) {
      ctx.strokeStyle = config.pipBorderColor
      ctx.lineWidth = config.pipBorderWidth
      ctx.beginPath()
      ctx.roundRect(pipPos.x, pipPos.y, pipSize.width, pipSize.height, config.pipBorderRadius)
      ctx.stroke()
    }
  }

  return canvas.transferToImageBitmap()
}

// 3. 查找最接近的摄像头帧
function findClosestCameraFrame(timestamp: number): VideoFrame | null {
  if (cameraFrames.length === 0) return null

  let closest = cameraFrames[0]
  let minDiff = Math.abs(closest.timestamp - timestamp)

  for (const frame of cameraFrames) {
    const diff = Math.abs(frame.timestamp - timestamp)
    if (diff < minDiff) {
      minDiff = diff
      closest = frame
    }
  }

  return closest
}
```

### 3. src/routes/studio/+page.svelte
**修改点**:
- 添加画中画配置面板
- 传递画中画配置到 Composite Worker

**实现要点**:
```svelte
<script lang="ts">
  import { cameraPiPStore } from '$lib/stores/camera-pip.svelte'

  // 画中画配置
  let pipPosition = $derived(cameraPiPStore.position)
  let pipSize = $derived(cameraPiPStore.size)
  let pipBorderRadius = $derived(cameraPiPStore.borderRadius)
</script>

<!-- 画中画配置面板 -->
<div class="space-y-4">
  <h3 class="font-semibold">画中画设置</h3>

  <!-- 位置选择 -->
  <div>
    <label>位置</label>
    <div class="grid grid-cols-2 gap-2">
      <button onclick={() => cameraPiPStore.setPosition('top-left')}>左上</button>
      <button onclick={() => cameraPiPStore.setPosition('top-right')}>右上</button>
      <button onclick={() => cameraPiPStore.setPosition('bottom-left')}>左下</button>
      <button onclick={() => cameraPiPStore.setPosition('bottom-right')}>右下</button>
    </div>
  </div>

  <!-- 大小选择 -->
  <div>
    <label>大小</label>
    <select bind:value={pipSize} onchange={() => cameraPiPStore.setSize(pipSize)}>
      <option value="small">小</option>
      <option value="medium">中</option>
      <option value="large">大</option>
    </select>
  </div>

  <!-- 圆角 -->
  <div>
    <label>圆角: {pipBorderRadius}px</label>
    <input
      type="range"
      min="0"
      max="50"
      bind:value={pipBorderRadius}
      oninput={() => cameraPiPStore.setBorderRadius(pipBorderRadius)}
    />
  </div>
</div>
```

### 4. src/lib/stores/camera-pip.svelte.ts（新建）
**实现要点**:
```typescript
// 画中画配置状态管理
export type PiPPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type PiPSize = 'small' | 'medium' | 'large'

interface CameraPiPState {
  enabled: boolean
  position: PiPPosition
  size: PiPSize
  borderRadius: number
  borderWidth: number
  borderColor: string
}

const defaultState: CameraPiPState = {
  enabled: true,
  position: 'bottom-right',
  size: 'medium',
  borderRadius: 8,
  borderWidth: 2,
  borderColor: '#ffffff'
}

function createCameraPiPStore() {
  let state = $state<CameraPiPState>({ ...defaultState })

  return {
    get enabled() { return state.enabled },
    get position() { return state.position },
    get size() { return state.size },
    get borderRadius() { return state.borderRadius },
    get borderWidth() { return state.borderWidth },
    get borderColor() { return state.borderColor },

    setEnabled(enabled: boolean) { state.enabled = enabled },
    setPosition(position: PiPPosition) { state.position = position },
    setSize(size: PiPSize) { state.size = size },
    setBorderRadius(radius: number) { state.borderRadius = radius },
    setBorderWidth(width: number) { state.borderWidth = width },
    setBorderColor(color: string) { state.borderColor = color },

    reset() { state = { ...defaultState } }
  }
}

export const cameraPiPStore = createCameraPiPStore()
```

## 实现步骤
1. 修改 opfs-reader-worker.ts 添加多轨道读取
2. 修改 composite-worker/index.ts 添加画中画合成
3. 创建 camera-pip.svelte.ts 状态管理
4. 修改 studio/+page.svelte 添加配置面板
5. 测试画中画效果，确保音画同步

## 验证标准
- ✅ 能够在 Studio 中预览画中画效果
- ✅ 摄像头画面位置和大小可调整
- ✅ 音画同步准确（误差 < 50ms）
- ✅ 播放流畅，无明显卡顿

请实现上述功能。
```

---

## US-1.7: 页面标注工具

### 📝 用户故事

> 作为一名**技术博主**，我需要在录制网页教程时实时标注重点内容（圈选重要按钮、添加文字说明、绘制箭头指示），以便观众更容易理解关键信息和操作步骤，提升教程的清晰度和专业性。

### 🎯 需求背景

- **目标用户**: 技术博主、教育工作者、产品演示者、培训讲师
- **核心价值**: 提升教程的清晰度和专业性，帮助观众快速理解关键信息
- **使用场景**:
  - 网页操作教程录制
  - 软件功能演示
  - 在线课程制作
  - 产品使用指南
- **预期收益**:
  - 提升教程质量和观众理解度
  - 实时标注，所见即所得
  - 增强视频的专业性

### 🔧 技术约束

#### **浏览器 API 限制**
- Content Script 只能在 Tab 录制模式下注入
- Canvas 绘制层需要高 z-index 避免被页面元素遮挡
- 标注会被屏幕录制自动捕获（无需单独存储）

#### **性能约束**
- Canvas 绘制需要高效（避免影响页面性能）
- 标注需要持久显示在页面上（直到用户删除）

#### **架构约束**
- 必须在 Content Script 中运行（访问页面 DOM）
- 工具栏 UI 需要与页面隔离（避免样式冲突）
- 标注层不能干扰页面交互

### 📂 可能修改的业务路径和文件

#### **核心文件**:

1. **`src/extensions/content.ts`** (主要修改)
   - 添加标注工具栏 UI 注入逻辑
   - 添加全屏 Canvas 绘制层
   - 实现 7 种标注工具的绘制逻辑
   - 管理标注的显示和删除

2. **`src/extensions/background.ts`** (轻微修改)
   - 管理标注模式状态
   - 在录制开始时通知 Content Script 启用标注工具

**新增文件**:
- **`src/extensions/annotation-toolbar.ts`** (新建)
  - 标注工具栏 UI 组件
  - 工具选择和配置逻辑

**实现原理**:
- 标注直接绘制在页面的 Canvas 层上
- 屏幕录制会自动捕获 Canvas 上的标注
- 无需单独存储标注数据到 OPFS
- 标注会持久显示直到用户手动删除

### 🤖 AI 提示词

```
# 任务：实现页面标注工具

## 需求背景
在录制 Tab 时，需要实时标注重点内容（圈选、文字、箭头等），帮助观众理解关键信息。
标注直接绘制在页面上，屏幕录制会自动捕获，无需单独存储。

## 技术栈约束

### **项目技术栈**
- **框架**: SvelteKit 2 + Svelte 5
- **语言**: TypeScript 5.x
- **构建工具**: Vite 7
- **Chrome Extension**: Manifest V3
- **Canvas API**: 原生 Canvas 2D API

### **Chrome Extension 架构**
- **Service Worker**: `src/extensions/background.ts`（消息路由、状态管理）
- **Offscreen Document**: `src/extensions/offscreen-main.ts`（媒体流捕获、编码）
- **Content Script**: `src/extensions/content.ts`（页面交互、元素选择、标注工具）

### **Content Script 位置**
- **源码**: `src/extensions/content.ts`
- **构建输出**: `build/content.js`
- **注入方式**: 通过 manifest.json 配置自动注入到匹配的页面

### **构建过程**
```bash
# 开发模式（监听文件变化，自动重新构建）
pnpm dev

# 构建生产版本
pnpm build

# 修改 content.ts 后需要：
# 1. 等待构建完成（dev 模式自动构建）
# 2. 在 Chrome 扩展管理页面点击"重新加载"
# 3. 刷新目标网页（Content Script 在页面加载时注入）
```

### **重要说明**
1. **Content Script 修改后需要重新加载**: 修改 `src/extensions/content.ts` 后，需要重新加载 Extension 并刷新目标网页
2. **纯 TypeScript**: Content Script 是纯 TypeScript 文件，不能使用 Svelte 组件
3. **DOM 操作**: 使用原生 DOM API 创建 UI 元素（不能使用 Svelte）
4. **Canvas API**: 使用原生 Canvas 2D API 进行绘制

## 技术约束
1. **Content Script**: 必须在 Tab 录制模式下注入
2. **Canvas 绘制**: 使用全屏透明 Canvas 覆盖页面（z-index: 2147483646）
3. **自动录制**: 标注会被屏幕录制自动捕获，无需单独存储到 OPFS
4. **性能**: Canvas 绘制需要高效，避免影响页面性能
5. **持久显示**: 标注会持久显示在页面上，直到用户手动删除
6. **纯 TypeScript**: Content Script 不能使用 Svelte 组件，只能使用原生 DOM API

## 现有代码结构
- **Content Script**: src/extensions/content.ts（元素/区域选择）
- **Background**: src/extensions/background.ts（消息路由）

## 需要修改的文件

### 1. src/extensions/content.ts
**修改点**:
- 在 Tab 录制模式下注入标注工具栏
- 创建全屏 Canvas 绘制层
- 实现 7 种标注工具的绘制逻辑
- 管理标注的显示和删除

**参考现有代码**:
请用搜索定位以下关键点（避免行号漂移）：
- `Mask` / `overlay`（覆盖层创建/销毁）
- `Drag` / `mousemove` / `mousedown`（拖拽选择逻辑）
- `Selection` / `mode`（进入/退出选择模式的入口）

**实现要点**:
```typescript
// 1. 创建标注工具栏
function createAnnotationToolbar() {
  const toolbar = document.createElement('div')
  toolbar.id = 'screen-recorder-annotation-toolbar'
  toolbar.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 2147483647;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    gap: 8px;
    backdrop-filter: blur(10px);
  `

  // 添加工具按钮
  const tools = [
    { name: 'arrow', icon: '→', title: '箭头' },
    { name: 'rectangle', icon: '□', title: '矩形' },
    { name: 'circle', icon: '○', title: '圆形' },
    { name: 'freehand', icon: '✎', title: '自由绘制' },
    { name: 'text', icon: 'T', title: '文字' },
    { name: 'highlight', icon: '◆', title: '高亮' },
    { name: 'blur', icon: '⬛', title: '模糊/遮挡' }
  ]

  tools.forEach(tool => {
    const btn = document.createElement('button')
    btn.textContent = tool.icon
    btn.title = tool.title
    btn.style.cssText = `
      width: 36px;
      height: 36px;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 18px;
    `
    btn.onclick = () => selectTool(tool.name)
    toolbar.appendChild(btn)
  })

  // 添加颜色选择器
  const colorPicker = document.createElement('input')
  colorPicker.type = 'color'
  colorPicker.value = '#ff0000'
  colorPicker.style.cssText = `
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  `
  colorPicker.onchange = (e) => {
    currentColor = (e.target as HTMLInputElement).value
  }
  toolbar.appendChild(colorPicker)

  // 添加清除按钮
  const clearBtn = document.createElement('button')
  clearBtn.textContent = '🗑'
  clearBtn.title = '清除所有标注'
  clearBtn.style.cssText = `
    width: 36px;
    height: 36px;
    border: none;
    background: rgba(255, 0, 0, 0.3);
    color: white;
    border-radius: 4px;
    cursor: pointer;
    font-size: 18px;
  `
  clearBtn.onclick = () => clearAllAnnotations()
  toolbar.appendChild(clearBtn)

  document.body.appendChild(toolbar)
  return toolbar
}

// 2. 创建 Canvas 绘制层（持久显示标注）
function createAnnotationCanvas() {
  const canvas = document.createElement('canvas')
  canvas.id = 'screen-recorder-annotation-canvas'
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  canvas.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2147483646;
    pointer-events: auto;
  `

  document.body.appendChild(canvas)
  return canvas
}

// 3. 存储所有标注（用于重绘和清除）
let annotations: Array<{
  tool: string
  points: Array<{x: number, y: number}>
  color: string
  lineWidth: number
  text?: string
}> = []

// 4. 绘制标注
let currentTool = 'arrow'
let currentColor = '#ff0000'
let currentLineWidth = 3
let isDrawing = false
let startPoint = { x: 0, y: 0 }
let currentPath: Array<{x: number, y: number}> = []

canvas.addEventListener('mousedown', (e) => {
  if (!isAnnotationMode) return
  isDrawing = true
  startPoint = { x: e.clientX, y: e.clientY }
  currentPath = [{ x: e.clientX, y: e.clientY }]

  // 文字工具：直接弹出输入框
  if (currentTool === 'text') {
    const text = prompt('请输入文字：')
    if (text) {
      annotations.push({
        tool: 'text',
        points: [{ x: e.clientX, y: e.clientY }],
        color: currentColor,
        lineWidth: currentLineWidth,
        text
      })
      redrawAllAnnotations()
    }
    isDrawing = false
  }
})

canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing) return

  if (currentTool === 'freehand') {
    // 自由绘制：记录路径
    currentPath.push({ x: e.clientX, y: e.clientY })
  }

  // 实时预览（临时绘制）
  redrawAllAnnotations()
  const ctx = canvas.getContext('2d')!

  if (currentTool === 'rectangle') {
    ctx.strokeStyle = currentColor
    ctx.lineWidth = currentLineWidth
    ctx.strokeRect(
      startPoint.x,
      startPoint.y,
      e.clientX - startPoint.x,
      e.clientY - startPoint.y
    )
  } else if (currentTool === 'circle') {
    const radius = Math.sqrt(
      Math.pow(e.clientX - startPoint.x, 2) +
      Math.pow(e.clientY - startPoint.y, 2)
    )
    ctx.strokeStyle = currentColor
    ctx.lineWidth = currentLineWidth
    ctx.beginPath()
    ctx.arc(startPoint.x, startPoint.y, radius, 0, Math.PI * 2)
    ctx.stroke()
  } else if (currentTool === 'arrow') {
    drawArrow(ctx, startPoint.x, startPoint.y, e.clientX, e.clientY, currentColor, currentLineWidth)
  } else if (currentTool === 'freehand') {
    ctx.strokeStyle = currentColor
    ctx.lineWidth = currentLineWidth
    ctx.beginPath()
    ctx.moveTo(currentPath[0].x, currentPath[0].y)
    for (let i = 1; i < currentPath.length; i++) {
      ctx.lineTo(currentPath[i].x, currentPath[i].y)
    }
    ctx.stroke()
  } else if (currentTool === 'highlight') {
    ctx.fillStyle = currentColor + '40' // 25% 透明度
    ctx.fillRect(
      startPoint.x,
      startPoint.y,
      e.clientX - startPoint.x,
      e.clientY - startPoint.y
    )
  }
})

canvas.addEventListener('mouseup', (e) => {
  if (!isDrawing) return
  isDrawing = false

  // 保存标注（持久化到 Canvas）
  if (currentTool === 'rectangle') {
    annotations.push({
      tool: 'rectangle',
      points: [startPoint, { x: e.clientX, y: e.clientY }],
      color: currentColor,
      lineWidth: currentLineWidth
    })
  } else if (currentTool === 'circle') {
    annotations.push({
      tool: 'circle',
      points: [startPoint, { x: e.clientX, y: e.clientY }],
      color: currentColor,
      lineWidth: currentLineWidth
    })
  } else if (currentTool === 'arrow') {
    annotations.push({
      tool: 'arrow',
      points: [startPoint, { x: e.clientX, y: e.clientY }],
      color: currentColor,
      lineWidth: currentLineWidth
    })
  } else if (currentTool === 'freehand') {
    annotations.push({
      tool: 'freehand',
      points: currentPath,
      color: currentColor,
      lineWidth: currentLineWidth
    })
  } else if (currentTool === 'highlight') {
    annotations.push({
      tool: 'highlight',
      points: [startPoint, { x: e.clientX, y: e.clientY }],
      color: currentColor,
      lineWidth: currentLineWidth
    })
  } else if (currentTool === 'blur') {
    // 简化实现：用半透明遮挡替代真正 blur（性能更稳，且满足隐藏敏感信息）
    annotations.push({
      tool: 'blur',
      points: [startPoint, { x: e.clientX, y: e.clientY }],
      color: '#000000',
      lineWidth: 0
    })
  }

  // 重绘所有标注
  redrawAllAnnotations()
})

// 5. 重绘所有标注（持久显示）
function redrawAllAnnotations() {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  for (const ann of annotations) {
    if (ann.tool === 'rectangle') {
      const [p1, p2] = ann.points
      ctx.strokeStyle = ann.color
      ctx.lineWidth = ann.lineWidth
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
    } else if (ann.tool === 'circle') {
      const [p1, p2] = ann.points
      const radius = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
      ctx.strokeStyle = ann.color
      ctx.lineWidth = ann.lineWidth
      ctx.beginPath()
      ctx.arc(p1.x, p1.y, radius, 0, Math.PI * 2)
      ctx.stroke()
    } else if (ann.tool === 'arrow') {
      const [p1, p2] = ann.points
      drawArrow(ctx, p1.x, p1.y, p2.x, p2.y, ann.color, ann.lineWidth)
    } else if (ann.tool === 'freehand') {
      ctx.strokeStyle = ann.color
      ctx.lineWidth = ann.lineWidth
      ctx.beginPath()
      ctx.moveTo(ann.points[0].x, ann.points[0].y)
      for (let i = 1; i < ann.points.length; i++) {
        ctx.lineTo(ann.points[i].x, ann.points[i].y)
      }
      ctx.stroke()
    } else if (ann.tool === 'text') {
      ctx.fillStyle = ann.color
      ctx.font = '24px Arial'
      ctx.fillText(ann.text || '', ann.points[0].x, ann.points[0].y)
    } else if (ann.tool === 'highlight') {
      const [p1, p2] = ann.points
      ctx.fillStyle = ann.color + '40'
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
    } else if (ann.tool === 'blur') {
      const [p1, p2] = ann.points
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
    }
  }
}

// 6. 清除所有标注
function clearAllAnnotations() {
  annotations = []
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

// 7. 绘制箭头辅助函数
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number
) {
  const headLength = 15
  const angle = Math.atan2(y2 - y1, x2 - x1)

  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLength * Math.cos(angle - Math.PI / 6),
    y2 - headLength * Math.sin(angle - Math.PI / 6)
  )
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLength * Math.cos(angle + Math.PI / 6),
    y2 - headLength * Math.sin(angle + Math.PI / 6)
  )
  ctx.stroke()
}

// 8. 处理窗口大小变化
window.addEventListener('resize', () => {
  const oldCanvas = canvas
  const oldAnnotations = [...annotations]

  // 重新创建 Canvas
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight

  // 重绘标注
  annotations = oldAnnotations
  redrawAllAnnotations()
})
```

## 实现步骤
1. 修改 content.ts 添加标注工具栏和 Canvas 绘制层
2. 实现 7 种标注工具的绘制逻辑
3. 实现标注的持久显示（存储在内存中，持续绘制在 Canvas 上）
4. 测试标注功能，确保屏幕录制能捕获标注
5. 验证录制视频包含标注

## 验证标准
- ✅ 能够在 Tab 录制时显示标注工具栏
- ✅ 7 种标注工具都能正常绘制
- ✅ 标注持久显示在页面上（直到手动清除）
- ✅ 屏幕录制自动捕获标注（无需单独存储）
- ✅ 录制视频包含标注层

请实现上述功能。
```

---

## US-1.8: 鼠标轨迹录制

### 📝 用户故事

> 作为一名**产品演示者**，我需要录制鼠标移动轨迹，并在编辑时能够切换不同的鼠标指针样式（默认箭头/手型/放大镜/自定义图片），以便制作更专业的产品演示视频，帮助观众清晰地跟随我的操作步骤。

### 🎯 需求背景

- **目标用户**: 产品演示者、技术博主、教育工作者、培训讲师
- **核心价值**: 提升演示视频的专业性，帮助观众跟随操作步骤
- **使用场景**:
  - 产品功能演示
  - 软件操作教程
  - 网页交互演示
  - 游戏操作录制
- **预期收益**:
  - 提升视频的专业性和可读性
  - 支持自定义指针样式（品牌化）
  - 后期可编辑指针样式

### 🔧 技术约束

#### **浏览器 API 限制**
- CaptureController API 仅 Chrome 109+ 支持
- 需要在 `getDisplayMedia()` 时传递 `controller` 参数
- 鼠标事件采样率受浏览器限制（通常 60fps）

#### **OPFS 存储限制**
- 鼠标轨迹数据存储为 JSONL 格式
- 存储开销：约 50 字节/事件，60fps × 300秒 = 900 KB

#### **性能约束**
- 高频鼠标事件需要节流处理
- 合成时需要高效查找对应时间戳的鼠标位置

#### **架构约束**
- 必须在 Offscreen Document 中创建 CaptureController
- 需要扩展 OPFS Writer 支持鼠标轨迹写入

### 📂 可能修改的业务路径和文件

#### **核心文件**:

1. **`src/extensions/offscreen-main.ts`** (主要修改)
   - 创建 CaptureController 实例
   - 监听 `oncapturedmousechange` 事件
   - 将鼠标事件发送到 OPFS Writer

2. **`src/lib/workers/opfs-writer-worker.ts`** (扩展)
   - 添加 `mouse.jsonl` 文件写入逻辑

3. **`src/lib/workers/composite-worker/index.ts`** (扩展)
   - 读取鼠标轨迹数据
   - 根据时间戳绘制鼠标指针

4. **`src/routes/studio/+page.svelte`** (UI 扩展)
   - 添加鼠标指针样式选择
   - 添加指针大小调节

**新增文件**:
- **`src/lib/stores/mouse-cursor.svelte.ts`** (新建)
  - 鼠标指针配置状态管理

**OPFS 存储扩展**:
```
rec_<id>/
├── data.bin              # 视频数据
├── index.jsonl           # 视频索引
├── mouse.jsonl           # 🆕 鼠标轨迹数据
└── meta.json             # 元数据
```

**mouse.jsonl 格式**:
```jsonl
{"timestamp":0,"x":100,"y":200,"isInside":true}
{"timestamp":16666,"x":105,"y":205,"isInside":true}
{"timestamp":33333,"x":110,"y":210,"isInside":true}
```

### 🤖 AI 提示词

```
# 任务：实现鼠标轨迹录制功能

## 需求背景
仅在录制 **Tab** 时，需要录制鼠标移动轨迹，以便在编辑时切换不同的指针样式，提升演示视频的专业性。

在录制 **Screen/Window** 时，本功能必须禁用/降级：不录制鼠标轨迹、不写入 `mouse.jsonl`，编辑器中的鼠标指针相关能力应不可用（置灰或隐藏）。

## 技术栈约束

### **项目技术栈**
- **框架**: SvelteKit 2 + Svelte 5（使用 Runes 语法：`$state`、`$derived`、`$effect`）
- **语言**: TypeScript 5.x
- **构建工具**: Vite 7
- **Chrome Extension**: Manifest V3
- **视频编码**: WebCodecs API (VideoEncoder, VideoDecoder)
- **存储**: Origin Private File System (OPFS)
- **鼠标捕获**: CaptureController API (Chrome 109+)

### **Chrome Extension 架构**
- **Service Worker**: `src/extensions/background.ts`（消息路由、状态管理）
- **Offscreen Document**: `src/extensions/offscreen-main.ts`（媒体流捕获、编码、鼠标事件监听）
- **Content Script**: `src/extensions/content.ts`（页面交互）

### **构建过程**
```bash
# 开发模式（监听文件变化，自动重新构建）
pnpm dev

# 构建生产版本
pnpm build

# 修改 offscreen-main.ts 后需要：
# 1. 等待构建完成（dev 模式自动构建）
# 2. 在 Chrome 扩展管理页面点击"重新加载"
```

### **Extension 源码位置**
- **Offscreen Document**: `src/extensions/offscreen-main.ts`
  - 媒体流捕获（getDisplayMedia）
  - WebCodecs 编码
  - CaptureController 鼠标事件监听
- **OPFS Writer**: `src/lib/workers/opfs-writer-worker.ts`
  - 数据写入到 OPFS
- **Composite Worker**: `src/lib/workers/composite-worker/index.ts`
  - 视频解码和合成
  - 鼠标指针绘制

### **重要说明**
1. **CaptureController API**: Chrome 109+ 支持，需要检测浏览器版本
2. **Lab 验证**: `lab/CaptureController/` 目录包含 CaptureController API 的验证代码
3. **Svelte 5 Runes**: Svelte 组件和 Store 使用 Runes 语法

## 技术约束
1. **产品约束**: 鼠标轨迹录制仅在 **Tab 录制模式** 启用；Screen/Window 必须禁用/降级（不写 `mouse.jsonl`，编辑器相关项不可用）
2. **CaptureController API**: Chrome 109+ 支持，需要在 getDisplayMedia() 时传递 controller 参数
3. **高频事件**: 鼠标事件采样率约 60fps，需要节流处理
4. **OPFS 存储**: 鼠标轨迹存储为 JSONL 格式
5. **性能**: 合成时需要高效查找对应时间戳的鼠标位置
6. **浏览器兼容性**: 需要检测 CaptureController API 支持情况

## 现有代码结构
- **Offscreen Document**: src/extensions/offscreen-main.ts（媒体流捕获）
- **OPFS Writer**: src/lib/workers/opfs-writer-worker.ts（数据写入）
- **Composite Worker**: src/lib/workers/composite-worker/index.ts（视频合成）
- **Lab 验证**: lab/CaptureController/（CaptureController API 验证）

## 需要修改的文件

### 1. src/extensions/offscreen-main.ts
**修改点**:
- 创建 CaptureController 实例
- 在 getDisplayMedia() 时传递 controller 参数
- 监听 oncapturedmousechange 事件
- 将鼠标事件发送到 OPFS Writer

**参考现有代码**:
- lab/CaptureController/capture-test.js（CaptureController 使用示例）

**实现要点**:
```typescript
// 0. 浏览器兼容性检查
function isCaptureControllerSupported(): boolean {
  return typeof CaptureController !== 'undefined'
}

function getChromeVersion(): number {
  const match = navigator.userAgent.match(/Chrome\/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

// 1. 创建 CaptureController（带兼容性检查）
let captureController: CaptureController | null = null
let mouseTrackingEnabled = false

if (isCaptureControllerSupported()) {
  const chromeVersion = getChromeVersion()
  if (chromeVersion >= 109) {
    try {
      captureController = new CaptureController()
      mouseTrackingEnabled = true
      console.log('✅ CaptureController initialized (Chrome', chromeVersion, ')')
    } catch (e) {
      console.warn('⚠️ CaptureController creation failed:', e)
    }
  } else {
    console.warn(`⚠️ CaptureController requires Chrome 109+, current: ${chromeVersion}`)
  }
} else {
  console.warn('⚠️ CaptureController API not available in this browser')
}

// 2. 监听鼠标事件（带错误处理）
let lastMouseEventTime = 0
const MOUSE_THROTTLE_MS = 16 // 约 60fps

if (captureController) {
  captureController.oncapturedmousechange = (event) => {
    try {
      const now = performance.now()

      // 节流：每 16ms 最多记录一次
      if (now - lastMouseEventTime < MOUSE_THROTTLE_MS) return
      lastMouseEventTime = now

      // 验证事件数据有效性
      if (typeof event.surfaceX !== 'number' || typeof event.surfaceY !== 'number') {
        console.warn('Invalid mouse event data:', event)
        return
      }

      const mouseEvent = {
        timestamp: now * 1000, // 转换为微秒
        x: event.surfaceX,
        y: event.surfaceY,
        isInside: event.surfaceX !== -1 && event.surfaceY !== -1
      }

      // 发送到 OPFS Writer
      opfsWriter?.postMessage({
        type: 'append-mouse',
        event: mouseEvent
      })
    } catch (e) {
      console.error('Error processing mouse event:', e)
    }
  }
}

// 3. 在 getDisplayMedia() 时传递 controller（带降级处理）
let stream: MediaStream

try {
  const displayMediaOptions: DisplayMediaStreamOptions = {
    video: {
      displaySurface: options.mode, // 'monitor' | 'window' | 'browser'
      cursor: mouseTrackingEnabled ? 'never' : 'always' // 如果不支持鼠标追踪，显示系统指针
    }
  }

  // 仅在支持时添加 controller
  if (captureController) {
    (displayMediaOptions as any).controller = captureController
  }

  stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)
} catch (e) {
  const error = e as Error
  if (error.name === 'NotAllowedError') {
    console.error('Screen capture permission denied')
    chrome.runtime.sendMessage({ type: 'STREAM_ERROR', error: 'SCREEN_PERMISSION_DENIED' })
    throw error
  } else if (error.name === 'NotSupportedError') {
    console.error('Screen capture not supported')
    chrome.runtime.sendMessage({ type: 'STREAM_ERROR', error: 'SCREEN_NOT_SUPPORTED' })
    throw error
  } else {
    console.error('getDisplayMedia failed:', error)
    chrome.runtime.sendMessage({ type: 'STREAM_ERROR', error: `SCREEN_ERROR: ${error.message}` })
    throw error
  }
}

// 4. 通知 UI 鼠标追踪状态
chrome.runtime.sendMessage({
  type: 'STREAM_META',
  meta: {
    mouseTrackingEnabled,
    chromeVersion: getChromeVersion()
  }
})
```

**⚠️ 兼容性说明**:
- CaptureController API 仅 Chrome 109+ 支持
- 不支持的浏览器将降级为显示系统鼠标指针
- Lab 验证代码位于 `lab/CaptureController/capture-test.js`

### 2. src/lib/workers/opfs-writer-worker.ts
**修改点**:
- 添加 `mouse.jsonl` 文件写入逻辑

**实现要点**:
```typescript
// 1. 添加鼠标轨迹文件句柄和缓冲区
let mouseHandle: FileSystemFileHandle | null = null
let mouseSyncHandle: FileSystemSyncAccessHandle | null = null
let mouseBuffer: string[] = []
let mouseOffset = 0

// 2. 在 init 消息中创建文件（使用 SyncAccessHandle 提高性能）
if (msg.type === 'init') {
  // ... 现有代码 ...
  mouseHandle = await recDir.getFileHandle('mouse.jsonl', { create: true })
  // ⚠️ 使用 SyncAccessHandle 进行高频写入
  mouseSyncHandle = await mouseHandle.createSyncAccessHandle()
}

// 3. 处理 append-mouse 消息
if (msg.type === 'append-mouse') {
  const line = JSON.stringify(msg.event) + '\n'
  mouseBuffer.push(line)

  // 每 100 个事件刷新一次（约 1.6 秒 @ 60fps）
  if (mouseBuffer.length >= 100) {
    await flushMouse()
  }
}

// 4. 刷新鼠标轨迹到文件
async function flushMouse() {
  if (!mouseSyncHandle || mouseBuffer.length === 0) return

  try {
    const text = mouseBuffer.join('')
    const encoder = new TextEncoder()
    const u8 = encoder.encode(text)

    // ⚠️ 使用 SyncAccessHandle.write() 追加写入
    const written = mouseSyncHandle.write(u8, { at: mouseOffset })
    mouseOffset += (typeof written === 'number' ? written : u8.byteLength)

    mouseBuffer = []
  } catch (e) {
    console.error('Failed to flush mouse events:', e)
  }
}

// 5. 在 finalize 消息中关闭句柄
if (msg.type === 'finalize') {
  // 刷新剩余的鼠标事件
  await flushMouse()

  // 关闭 SyncAccessHandle
  try { mouseSyncHandle?.flush() } catch {}
  try { mouseSyncHandle?.close() } catch {}
  mouseSyncHandle = null
}
```

### 3. src/lib/workers/composite-worker/index.ts
**修改点**:
- 读取鼠标轨迹数据
- 根据时间戳绘制鼠标指针

**实现要点**:
```typescript
// 1. 加载鼠标轨迹数据
let mouseEvents: MouseEvent[] = []

async function loadMouseEvents(opfsDirId: string) {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(opfsDirId)

  try {
    const mouseFile = await dir.getFileHandle('mouse.jsonl')
    const blob = await mouseFile.getFile()
    const text = await blob.text()
    mouseEvents = text.split('\n').filter(Boolean).map(JSON.parse)
  } catch (e) {
    console.warn('No mouse events found')
  }
}

// 2. 在 renderCompositeFrame 中绘制鼠标指针
function renderCompositeFrame(
  frame: VideoFrame,
  layout: VideoLayout,
  config: CompositeConfig,
  frameIndex: number
): ImageBitmap | null {
  // ... 现有代码绘制视频 ...

  // 查找对应的鼠标位置
  const mousePos = findMousePosition(frame.timestamp)

  if (mousePos && mousePos.isInside && config.showMouseCursor) {
    drawMouseCursor(ctx, mousePos.x, mousePos.y, config.cursorStyle, config.cursorSize)
  }

  return canvas.transferToImageBitmap()
}

// 3. 查找鼠标位置（二分查找）
function findMousePosition(timestamp: number): MouseEvent | null {
  if (mouseEvents.length === 0) return null

  // 二分查找最接近的事件
  let left = 0
  let right = mouseEvents.length - 1
  let closest = mouseEvents[0]
  let minDiff = Math.abs(closest.timestamp - timestamp)

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const event = mouseEvents[mid]
    const diff = Math.abs(event.timestamp - timestamp)

    if (diff < minDiff) {
      minDiff = diff
      closest = event
    }

    if (event.timestamp < timestamp) {
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  return closest
}

// 4. 绘制鼠标指针
function drawMouseCursor(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  style: 'default' | 'hand' | 'magnifier' | 'custom',
  size: number
) {
  if (style === 'default') {
    // 绘制默认箭头指针
    ctx.fillStyle = '#000'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + size)
    ctx.lineTo(x + size * 0.35, y + size * 0.65)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (style === 'hand') {
    // 绘制手型指针（简化版）
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.arc(x, y, size * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  // ... 其他样式 ...
}
```

### 4. src/lib/stores/mouse-cursor.svelte.ts（新建）
**实现要点**:
```typescript
// 鼠标指针配置状态管理
export type CursorStyle = 'default' | 'hand' | 'magnifier' | 'custom'

interface MouseCursorState {
  enabled: boolean
  style: CursorStyle
  size: number
  customImageUrl?: string
}

const defaultState: MouseCursorState = {
  enabled: true,
  style: 'default',
  size: 20
}

function createMouseCursorStore() {
  let state = $state<MouseCursorState>({ ...defaultState })

  return {
    get enabled() { return state.enabled },
    get style() { return state.style },
    get size() { return state.size },
    get customImageUrl() { return state.customImageUrl },

    setEnabled(enabled: boolean) { state.enabled = enabled },
    setStyle(style: CursorStyle) { state.style = style },
    setSize(size: number) { state.size = size },
    setCustomImageUrl(url: string) { state.customImageUrl = url },

    reset() { state = { ...defaultState } }
  }
}

export const mouseCursorStore = createMouseCursorStore()
```

## 实现步骤
1. 修改 offscreen-main.ts 添加 CaptureController 和鼠标事件监听
2. 修改 opfs-writer-worker.ts 添加鼠标轨迹写入
3. 修改 composite-worker/index.ts 添加鼠标指针绘制
4. 创建 mouse-cursor.svelte.ts 状态管理
5. 测试鼠标轨迹录制和回放

## 验证标准
- ✅ 仅在 **Tab 录制模式** 下能够录制鼠标移动轨迹
- ✅ 鼠标轨迹保存到 mouse.jsonl
- ✅ 在 **Screen/Window** 录制模式下不启用鼠标轨迹录制（不写 `mouse.jsonl`，编辑器相关项不可用/降级）
- ✅ 能够在 Studio 中预览鼠标指针
- ✅ 支持切换不同指针样式
- ✅ 导出视频包含鼠标指针

请实现上述功能。
```

---

## US-1.9: Web 页面录制（非扩展）

### 📝 用户故事

> 作为一名**跨平台用户（Windows/macOS/Linux）**，我希望在不安装 Chrome 扩展的情况下，直接在 Web 页面中开始录制（屏幕/窗口/标签页），并且将录制数据写入**当前域名对应的 OPFS**，以便后续在同一套 Studio 工作流中完成预览、编辑和导出。

### 🎯 需求背景

- **为什么要做 Web 版**:
  - 覆盖不同操作系统与不同部署环境（不依赖扩展安装/分发）
  - 企业环境/受管设备可能无法安装扩展（只是其中一类典型场景）
  - 需要“打开网页即可录制”的低门槛入口
  - 复用现有 OPFS → Studio → Export 的核心技术优势

- **核心目标（MVP）**:
  - 在 Web 页面完成“开始录制 → 停止录制 → 生成一条 OPFS 录制记录”
  - 写入格式与现有一致（`rec_<id>/data.bin` + `index.jsonl` + `meta.json`）
  - Drive/Studio/Export **无需为 Web 录制做额外适配**（同一 origin 内）

### ✅ 范围与非目标

**范围（必须）**
- ✅ Web 页面可启动录制（基于 `navigator.mediaDevices.getDisplayMedia()`）
- ✅ 编码后实时写入该域名 OPFS（复用现有 OPFS Writer Worker 协议：`init/append/finalize`）
- ✅ 录制完成后可在现有 Drive/Studio 页面读到并编辑/导出
- ✅ Web 页面支持多语言，并允许通过 URL 参数控制语言（例如 `/web-record?l=en`）

**非目标（本故事不做）**
- ❌ 不要求替换/改造现有扩展录制链路（保证扩展稳定运行）
- ❌ 不做 Web 与扩展之间的录制互通/迁移（不同 origin 的 OPFS 天然隔离）
- ❌ 不强制实现与扩展完全一致的 UI/功能（例如倒计时、跨页面状态同步、徽标等）

### 🔧 技术约束（关键）

#### **Origin / OPFS 隔离**
- Web 录制写入的是**当前站点（origin）的 OPFS**。
- Chrome 扩展写入的是 `chrome-extension://<id>` 的 OPFS。
- 两者**不可互读**，属于浏览器安全模型的正常行为。

#### **Web 端录制能力限制**
- Web 页面环境可以调用 `getDisplayMedia()`，但**无法像扩展一样可靠地“强制 Tab/Window/Screen 模式”**（最终由浏览器 picker 与权限决定）。
- 需要 HTTPS 或 localhost（安全上下文）才能正常获取媒体与使用 OPFS。

#### **保持扩展端最小改动**
- Web 录制实现应尽量复用 `src/lib/workers/*` 的通用 worker（例如 `opfs-writer-worker.ts`、`webcodecs-worker.ts`）。
- 不应改动扩展的 Background/Offscreen 消息协议与状态机。

#### **多语言（Web 端）**
- 当前仓库的 i18n 工具（`$lib/utils/i18n`）在扩展环境可走 `chrome.i18n.getMessage`，但 Web 环境没有 `chrome.i18n`。
- 因此 Web 录制页需要：
  - 使用与扩展一致的 key（便于复用文案体系），并为 Web 环境提供 `fallbackMessages`。
  - 通过 URL 查询参数 `l` 控制语言，例如：`/web-record?l=en`。
  - 未提供 `l` 时，回退到浏览器语言（例如 `navigator.language`）或默认语言（建议 `zh`）。

### 📂 可能修改的业务路径和文件（建议）

#### **新增入口页面（Web 版）**
- 新增一个 Web 专用录制页面路由（参考 `src/routes/control/+page.svelte` 的 UI 结构，但不要依赖 `chrome.*` API）。
  - 建议：`src/routes/web-record/+page.svelte`（满足 `/web-record?l=en` 的入口约定；与扩展 control 分离，避免误用 `chrome.runtime`）

#### **复用的通用 Worker**
- `src/lib/workers/webcodecs-worker.ts`
  - 负责 WebCodecs 编码，向主线程发送 `EncodedVideoChunk` 对应的 `ArrayBuffer`/时间戳信息
- `src/lib/workers/opfs-writer-worker.ts`
  - 负责在 Worker 内写入 OPFS：`data.bin` + `index.jsonl` + `meta.json`
  - 协议：`{type:'init'}` → 多次 `{type:'append'}` → `{type:'finalize'}`

> 参考实现可对照：`src/routes/sidepanel/+page.svelte` 里已有初始化 OPFS writer 的用法（用于开发/验证）。

### 🧩 数据与协议（必须与现有一致）

**目录结构**
```
rec_<id>/
├── data.bin
├── index.jsonl
└── meta.json
```

**时间戳单位**
- 全链路一律使用微秒（us）：
  - `EncodedVideoChunk.timestamp` / `VideoFrame.timestamp` / `index.jsonl.timestamp`
  - 若来源为 `performance.now()`（ms），在边界处统一转换：`us = ms * 1000`

### 实现步骤（MVP）

1. **新增 Web 录制页面**：提供开始/停止按钮与基础状态显示（录制中/错误）。
  - 解析 `l` 参数：`const lang = new URLSearchParams(location.search).get('l')`。
  - 将 `lang` 写入本页的语言选择逻辑（优先级：URL 参数 → 本地持久化 → 浏览器语言 → 默认语言）。
2. **初始化 OPFS Writer Worker**：开始录制时生成 `id`（如时间戳/uuid），发送 `init` 并等待 `ready`。
3. **启动 getDisplayMedia**：获取 `MediaStream`（仅视频即可，音频后续再扩展）。
4. **启动编码 Worker**：将 `VideoFrame` 或等价帧输入送入 `webcodecs-worker` 编码。
5. **写入 OPFS**：收到编码结果后，将 `buffer/timestamp/chunkType/isKeyframe/...` 转发给 `opfs-writer-worker` 的 `append`。
6. **停止与 finalize**：停止捕获与编码，调用 OPFS writer `finalize`，确保 `meta.json.completed=true`。
7. **验收联调**：停止后跳转/提示用户进入 Drive/Studio，确认能读取并预览/导出。

### 验证标准（AC）

- ✅ 在 Web 页面点击开始后，能弹出浏览器捕获选择器并成功开始录制
- ✅ 停止录制后，OPFS 中生成 `rec_<id>/data.bin`、`index.jsonl`、`meta.json` 且 `meta.json.completed=true`
- ✅ 现有读取端（Drive/Studio/Export）在同一站点 origin 下能直接识别该条录制并完成预览/编辑/导出
- ✅ 访问 `/web-record?l=en` 时页面文案切换为英文（或对应语言）；不带 `l` 时使用默认/浏览器语言回退
- ✅ 权限拒绝、API 不支持、非安全上下文时给出明确报错，不会卡死在“录制中”状态

### 🤖 AI 提示词

#### **提示词 1: Web 录制页面（MVP，最小改动）**

```
# 任务
为 Screen Recorder Studio 实现“US-1.9 Web 页面录制（非扩展）”的最小可用版本：
在 Web 页面直接录制（getDisplayMedia），编码后写入当前站点 OPFS，并复用现有 Drive/Studio/Export 读取、编辑、导出能力。

## 强约束（必须遵守）
1) 扩展稳定性优先：不要改造现有 Chrome 扩展录制链路（src/extensions/background.ts / offscreen-main.ts 等的状态机与消息协议尽量不动）。
  - Web 录制作为新入口实现，功能独立，不影响扩展可用性。
2) OPFS / origin 隔离：Web 录制写入的是当前站点 origin 的 OPFS；与 chrome-extension:// 的 OPFS 互相隔离，不能互读。
  - 不要尝试做“Web 与扩展互通/迁移”。
3) 必须复用现有写入格式与协议：
  - 目录结构：rec_<id>/data.bin + index.jsonl + meta.json
  - Writer 协议：opfs-writer-worker 的 init/append/finalize（不要自创新的消息名与文件名）。
4) 时间戳单位统一为微秒 us：
  - EncodedVideoChunk.timestamp / VideoFrame.timestamp / index.jsonl.timestamp 全链路保持一致。
  - 如果用 performance.now()（ms）作为来源，需要在边界处转换：us = ms * 1000。
5) 多语言（Web）：页面必须支持多语言，并可通过 URL 参数控制，例如 /web-record?l=en。
  - 仓库现有 $lib/utils/i18n 在 Web 环境没有 chrome.i18n，需要提供 fallbackMessages。
  - **i18n 本地化加载**:
    - 页面加载时解析 URL 参数 `?l=en` (默认 `en`)。
    - 使用 `fetch('/_locales/' + lang + '/messages.json')` 获取语言包。
    - **格式转换**: Chrome 语言包结构为 `{ "key": { "message": "Text" } }`，必须转换为扁平对象 `{ "key": "Text" }` 后，传给 `_t` 函数的 `fallbackMessages` 参数。
6) 禁止硬编码行号：用搜索关键字/符号定位。

## 现有可复用实现（请先搜索阅读再改）
- OPFS Writer Worker：src/lib/workers/opfs-writer-worker.ts（init/append/finalize、meta.json/index.jsonl/data.bin 写入）
- WebCodecs Worker：src/lib/workers/webcodecs-worker.ts（编码输出如何组织、timestamp 语义）
- 录制入口 UI 参考：src/routes/control/+page.svelte（但 Web 版不能依赖 chrome.* API）
- i18n 工具：src/lib/utils/i18n.ts（_t(key, subs, fallbackMessages)）

## 实现范围（MVP）
- 新增 Web 路由页面：src/routes/web-record/+page.svelte
  - 解析查询参数 l（例如 en/zh）；未提供时回退到浏览器语言或默认语言。
  - UI 仅需要：开始/停止 + 基础状态（录制中/错误）。
- 录制：navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
- 编码：复用 webcodecs-worker（不要把编码放主线程）
- 写入：复用 opfs-writer-worker（写入 rec_<id>/...；finalize 写 completed=true）

## 验收标准（必须达成）
- ✅ /web-record 页面可以开始与停止录制
- ✅ 停止后 OPFS 里生成 rec_<id>/data.bin、index.jsonl、meta.json（completed=true）
- ✅ Drive/Studio/Export 在同一站点 origin 下可以识别并正常预览/编辑/导出该条录制
- ✅ /web-record?l=en 可切英文；不带 l 时有合理回退
- ✅ 权限拒绝/API 不支持/非安全上下文时给出清晰错误提示，不会卡死

请先输出：你将修改/新增哪些文件、为什么；再给出补丁与验证步骤。
```

---

## 📊 总结

### **四个用户故事的优先级和工作量**

| 用户故事 | 优先级 | 预计工作量 | 依赖关系 | 实现复杂度 | 风险等级 |
|---------|--------|-----------|---------|-----------|---------|
| **US-1.6: 摄像头 + 语音录制** | P1 | 28-40 天 | 无 | 高 | 🟡 中 |
| **US-1.7: 页面标注工具** | P2 | 3-5 天 | 无 | 低（简化后） | 🟢 低 |
| **US-1.8: 鼠标轨迹录制** | P2 | 10-15 天 | 无 | 中 | 🟡 中 |
| **US-1.9: Web 页面录制（非扩展）** | P1 | 3-7 天 | 无 | 中 | 🟡 中 |

### **工作量详细分解**

#### **US-1.6 摄像头 + 语音录制（28-40 天）**

| 阶段 | 任务 | 工作量 | 技术难点 |
|------|------|--------|---------|
| **阶段 1** | 录制端实现 | 10-14 天 | |
| | - getUserMedia 集成 | 2-3 天 | 权限处理、设备枚举 |
| | - VideoEncoder 摄像头编码 | 2-3 天 | MediaStreamTrackProcessor |
| | - AudioEncoder + AudioWorklet | 3-4 天 | ⚠️ AudioData 创建较复杂 |
| | - OPFS Writer 扩展 | 2-3 天 | 多轨道索引管理 |
| | - UI 控件（设备选择） | 1-2 天 | Svelte 5 Runes |
| **阶段 2** | 编辑端实现 | 18-26 天 | |
| | - 多轨道 OPFS Reader | 3-4 天 | 窗口化加载同步 |
| | - 双 VideoDecoder 解码 | 3-4 天 | 内存管理 |
| | - AudioDecoder + AudioContext | 3-5 天 | 音频渲染管线 |
| | - 画中画 Canvas 合成 | 4-6 天 | ⚠️ 实时合成性能 |
| | - 音画同步算法 | 3-4 天 | ⚠️ 时间戳对齐 |
| | - UI（PiP 配置、音量控制） | 2-3 天 | |

#### **US-1.7 页面标注工具（3-5 天）**

| 任务 | 工作量 | 说明 |
|------|--------|------|
| Content Script Canvas 层 | 1-2 天 | 简化实现 |
| 7 种绘图工具 | 1-2 天 | 箭头、矩形、圆形等 |
| 工具栏 UI | 0.5-1 天 | 颜色选择、清除 |

#### **US-1.8 鼠标轨迹录制（10-15 天）**

| 任务 | 工作量 | 说明 |
|------|--------|------|
| CaptureController 集成 | 2-3 天 | 兼容性检测、降级处理 |
| OPFS 鼠标轨迹写入 | 1-2 天 | SyncAccessHandle |
| Composite Worker 指针绘制 | 3-4 天 | 二分查找、多种样式 |
| 指针样式资源 | 1-2 天 | SVG/PNG 指针图片 |
| UI 配置面板 | 2-3 天 | 样式选择、大小调节 |
| 测试和调优 | 1-2 天 | 性能验证 |

### **实施建议**

1. **Q1 2026**: 实现 US-1.6（摄像头 + 语音录制）
   - Sprint 1-2: 录制端（10-14 天）
   - Sprint 3-5: 编辑端（18-26 天）
   - **里程碑**: 能够录制并回放带摄像头和音频的视频

2. **Q2 2026**: 实现 US-1.7 和 US-1.8
   - **US-1.7（页面标注工具）**: 3-5 天
   - **US-1.8（鼠标轨迹录制）**: 10-15 天
   - **里程碑**: 完整的专业级屏幕录制工具

### **技术风险与缓解措施**

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| **音画同步精度** | 🟡 中 | 使用统一的 `performance.now()` 时间基准；预留 100ms 容差 |
| **3 个编码器性能** | 🟡 中 | 优先使用硬件加速；摄像头降至 720p 30fps |
| **AudioWorklet 复杂度** | 🟡 中 | 提供 ScriptProcessorNode 降级方案 |
| **CaptureController 兼容性** | 🟢 低 | 自动检测并降级为系统指针 |
| **Canvas 标注性能** | 🟢 低 | 使用 `requestAnimationFrame` 节流 |

### **US-1.7 简化说明**

原本设计过于复杂，包含：
- ❌ 标注数据存储到 OPFS
- ❌ 归一化坐标系统
- ❌ 编辑端标注渲染
- ❌ 时间戳管理

**简化后的实现**：
- ✅ 标注直接绘制在页面的 Canvas 层上
- ✅ 屏幕录制自动捕获 Canvas 上的标注
- ✅ 无需单独存储标注数据
- ✅ 标注持久显示直到用户手动清除
- ✅ 实现简单，工作量从 12-18 天降至 3-5 天

---

## 🎬 F-7: Veo 虚拟主播集成（未来功能）

> **状态**: 规划中 | **优先级**: P3 | **预计工作量**: 30-45 天
>
> **前置条件**: 需要 US-1.6（摄像头 + 语音录制）完成后实施

### 📋 功能概述

使用 Google Veo 3/3.1 API 生成 AI 虚拟主播视频，与屏幕录制合成，为不愿露脸的用户提供专业的视频讲解体验。

**核心工作流**:
```
录制桌面 + 语音 → 语音转文本 → 编辑脚本 → Veo 生成虚拟主播 → 合成最终视频
```

### 🔧 技术实现

#### **1. 依赖安装**

```bash
# Google Gen AI SDK
npm install @google/genai

# Google Cloud Speech-to-Text (可选，用于语音转文本)
npm install @google-cloud/speech
```

#### **2. 环境配置**

```typescript
// .env.local
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_CLOUD_PROJECT=your_project_id
```

#### **3. Veo API 服务封装**

**新建文件**: `src/lib/services/veo-service.ts`

> ⚠️ **API 说明**: Veo 3 API 目前通过 Google AI Studio 和 Vertex AI 提供。
> 以下代码使用 `@google/genai` SDK（Gemini API），实际的 Veo API 接口可能有所不同。
> 建议在正式实现前参考最新的 [Google AI for Developers 文档](https://ai.google.dev/)。

```typescript
import { GoogleGenAI } from '@google/genai'

// Veo 模型选项（2026年1月最新）
export type VeoModel =
  | 'veo-3.0-generate-001'      // 稳定版 Standard ($0.40/秒)
  | 'veo-3.0-fast-generate-001' // 稳定版 Fast ($0.15/秒) ← 推荐
  | 'veo-3.1-generate-preview'  // 预览版 Standard
  | 'veo-3.1-fast-generate-preview' // 预览版 Fast
  | 'veo-2.0-generate-001'      // Veo 2（无音频）

export interface VeoGenerateOptions {
  prompt: string
  model?: VeoModel
  aspectRatio?: '16:9' | '9:16'
  durationSeconds?: number // 最大 8 秒（单次生成限制）
  negativePrompt?: string  // 排除内容
  seed?: number            // 可复现性
}

export interface VeoGenerateResult {
  videoUri: string
  videoBlob?: Blob         // 下载后的视频数据
  durationSeconds: number
  cost: number             // 预估成本 (USD)
  generationTimeMs: number // 生成耗时
}

class VeoService {
  private ai: GoogleGenAI

  constructor(apiKey: string) {
    // ⚠️ GoogleGenAI SDK 构造函数参数格式可能变化，请参考最新文档
    this.ai = new GoogleGenAI({ apiKey })
  }

  /**
   * 生成单个视频片段（最长 8 秒）
   *
   * ⚠️ 注意事项：
   * 1. 单次生成最长 8 秒，更长视频需要分段生成后拼接
   * 2. 生成时间约 30秒-2分钟，需要轮询等待
   * 3. 返回的是临时 URI，需要在有效期内下载
   */
  async generateVideo(options: VeoGenerateOptions): Promise<VeoGenerateResult> {
    const model = options.model || 'veo-3.0-fast-generate-001'
    const duration = Math.min(options.durationSeconds || 8, 8)
    const startTime = performance.now()

    try {
      // ⚠️ 实际 API 调用格式可能不同，以下为示例
      const operation = await this.ai.models.generateVideos({
        model,
        prompt: options.prompt,
        config: {
          aspectRatio: options.aspectRatio || '16:9',
          numberOfVideos: 1,
          durationSeconds: duration,
          personGeneration: 'allow_adult',
          // Veo 3/3.1 支持原生音频生成
          includeAudio: model.includes('veo-3')
        }
      })

      // 轮询等待生成完成（指数退避）
      let pollInterval = 5000 // 5 秒
      const maxPollInterval = 30000 // 最大 30 秒

      while (!operation.done) {
        await this.sleep(pollInterval)
        await operation.refresh()
        pollInterval = Math.min(pollInterval * 1.5, maxPollInterval)
      }

      const video = operation.response?.generatedVideos?.[0]
      if (!video?.video?.uri) {
        throw new Error('Video generation failed: no video URI returned')
      }

      const generationTimeMs = performance.now() - startTime

      // 计算成本（基于实际定价）
      const pricePerSecond = this.getPricePerSecond(model)
      const cost = duration * pricePerSecond

      return {
        videoUri: video.video.uri,
        durationSeconds: duration,
        cost,
        generationTimeMs
      }
    } catch (error) {
      console.error('Veo generation error:', error)
      throw error
    }
  }

  /**
   * 下载生成的视频
   *
   * ⚠️ 视频 URI 有有效期限制，需要及时下载
   */
  async downloadVideo(videoUri: string): Promise<Blob> {
    const response = await fetch(videoUri)
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.statusText}`)
    }
    return response.blob()
  }

  /**
   * 生成长视频（自动分段）
   *
   * ⚠️ 注意：分段生成的视频在拼接时可能有连续性问题
   * 建议使用一致的人物描述和场景设定
   */
  async generateLongVideo(
    segments: Array<{ prompt: string; durationSeconds: number }>,
    options?: {
      model?: VeoModel
      aspectRatio?: '16:9' | '9:16'
      onProgress?: (completed: number, total: number) => void
    }
  ): Promise<VeoGenerateResult[]> {
    const results: VeoGenerateResult[] = []

    // 预计算总片段数
    let totalSubSegments = 0
    for (const segment of segments) {
      totalSubSegments += Math.ceil(segment.durationSeconds / 8)
    }
    let completed = 0

    for (const segment of segments) {
      // 将长片段分割成 8 秒以内的子片段
      const subSegments = this.splitSegment(segment, 8)

      for (const subSegment of subSegments) {
        const result = await this.generateVideo({
          prompt: subSegment.prompt,
          durationSeconds: subSegment.durationSeconds,
          model: options?.model,
          aspectRatio: options?.aspectRatio
        })
        results.push(result)

        completed++
        options?.onProgress?.(completed, totalSubSegments)
      }
    }

    return results
  }

  /**
   * 估算成本（不包含税费和其他费用）
   */
  estimateCost(durationSeconds: number, model: VeoModel = 'veo-3.0-fast-generate-001'): number {
    const pricePerSecond = this.getPricePerSecond(model)
    return durationSeconds * pricePerSecond
  }

  /**
   * 获取模型价格（2026年1月定价）
   */
  private getPricePerSecond(model: VeoModel): number {
    const pricing: Record<VeoModel, number> = {
      'veo-3.0-generate-001': 0.40,
      'veo-3.0-fast-generate-001': 0.15,
      'veo-3.1-generate-preview': 0.40,
      'veo-3.1-fast-generate-preview': 0.15,
      'veo-2.0-generate-001': 0.35
    }
    return pricing[model] || 0.15
  }

  private splitSegment(
    segment: { prompt: string; durationSeconds: number },
    maxDuration: number
  ): Array<{ prompt: string; durationSeconds: number }> {
    const result: Array<{ prompt: string; durationSeconds: number }> = []
    let remaining = segment.durationSeconds

    while (remaining > 0) {
      const duration = Math.min(remaining, maxDuration)
      result.push({ prompt: segment.prompt, durationSeconds: duration })
      remaining -= duration
    }

    return result
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const createVeoService = (apiKey: string) => new VeoService(apiKey)
```

#### **4. 语音转文本服务**

**新建文件**: `src/lib/services/stt-service.ts`

```typescript
// 使用 Web Speech API（浏览器端）或 Google Cloud STT（服务端）

export interface TranscriptSegment {
  text: string
  startTime: number // 秒
  endTime: number
  confidence: number
  words: Array<{
    word: string
    startTime: number
    endTime: number
  }>
}

/**
 * 浏览器端语音识别（免费，但精度较低）
 */
export async function transcribeWithWebSpeech(audioBlob: Blob): Promise<TranscriptSegment[]> {
  // 使用 Web Speech API
  // 注意：需要用户交互触发，且不支持离线
  throw new Error('Not implemented - use Google Cloud STT for production')
}

/**
 * Google Cloud Speech-to-Text（付费，高精度）
 * 需要后端 API 代理
 */
export async function transcribeWithGoogleSTT(
  audioBlob: Blob,
  language: string = 'zh-CN'
): Promise<TranscriptSegment[]> {
  const formData = new FormData()
  formData.append('audio', audioBlob)
  formData.append('language', language)

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    throw new Error(`Transcription failed: ${response.statusText}`)
  }

  return response.json()
}
```

#### **5. 虚拟主播脚本编辑器**

**新建文件**: `src/lib/components/VeoScriptEditor.svelte`

```svelte
<script lang="ts">
  import type { TranscriptSegment } from '$lib/services/stt-service'

  interface Props {
    segments: TranscriptSegment[]
    onSave: (segments: VeoScriptSegment[]) => void
  }

  interface VeoScriptSegment {
    startTime: number
    endTime: number
    text: string
    emotion: 'neutral' | 'excited' | 'thoughtful' | 'serious'
    gesture: 'explaining' | 'pointing' | 'nodding' | 'none'
  }

  let { segments, onSave }: Props = $props()

  let editedSegments = $state<VeoScriptSegment[]>(
    segments.map(s => ({
      startTime: s.startTime,
      endTime: s.endTime,
      text: s.text,
      emotion: 'neutral',
      gesture: 'explaining'
    }))
  )

  const emotions = ['neutral', 'excited', 'thoughtful', 'serious'] as const
  const gestures = ['explaining', 'pointing', 'nodding', 'none'] as const

  function handleSave() {
    onSave(editedSegments)
  }
</script>

<div class="script-editor">
  <h3>编辑虚拟主播脚本</h3>

  {#each editedSegments as segment, i}
    <div class="segment">
      <div class="time">
        {formatTime(segment.startTime)} - {formatTime(segment.endTime)}
      </div>

      <textarea
        bind:value={segment.text}
        rows="2"
      />

      <div class="controls">
        <select bind:value={segment.emotion}>
          {#each emotions as emotion}
            <option value={emotion}>{emotion}</option>
          {/each}
        </select>

        <select bind:value={segment.gesture}>
          {#each gestures as gesture}
            <option value={gesture}>{gesture}</option>
          {/each}
        </select>
      </div>
    </div>
  {/each}

  <button onclick={handleSave}>保存脚本</button>
</div>
```

### 📊 成本控制策略

| 策略 | 描述 | 预估成本 |
|------|------|---------|
| **完整 Veo** | 5分钟全部使用 Veo 3 Fast | $45 |
| **混合模式** | 仅开场/结尾使用 Veo（30秒） | $4.5 |
| **关键片段** | 仅重要讲解使用 Veo（1分钟） | $9 |

**推荐**: 使用 **混合模式**，将成本控制在 $5-$10/视频。

### 🚀 实施路线图

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| **Phase 1** | Veo API 集成 + 基础生成 | 5-7 天 |
| **Phase 2** | 语音转文本 + 脚本编辑器 | 7-10 天 |
| **Phase 3** | 视频合成 + PiP 布局 | 10-15 天 |
| **Phase 4** | 成本优化 + 用户体验 | 8-13 天 |

### ⚠️ 风险与注意事项

1. **API 成本**: Veo API 按秒计费，需要严格控制生成时长
2. **生成时间**: 单个 8 秒视频需要 30秒-2分钟生成，长视频需要后台处理
3. **API 限制**: Preview 模型可能有更严格的速率限制
4. **音频同步**: Veo 3/3.1 原生支持音频，但需要验证唇形同步精度

---

## 🎤 F-6 Phase 1: 基础字幕功能（Quick Win）

> **优先级**: 🥈 ROI 排名第 2 | **工作量**: 10-15 天 | **技术风险**: 🟢 低

### 📝 功能描述

> 作为一名**内容创作者**，我希望录制的视频能够自动生成字幕，并支持手动校对和编辑，以便提升视频的可访问性和观看体验。

### 🎯 核心价值

| 价值点 | 说明 |
|--------|------|
| **无障碍访问** | 听障用户可以通过字幕理解内容 |
| **静音观看** | 公共场所/办公室场景的刚需 |
| **SEO 优化** | 字幕文本可被搜索引擎索引 |
| **多语言** | 可作为翻译的基础（未来功能） |

### 🔧 技术实现

#### **1. 语音转文本（Web Speech API）**

```typescript
// src/lib/services/speech-to-text.ts

export interface SubtitleSegment {
  id: string
  startTime: number  // 毫秒
  endTime: number    // 毫秒
  text: string
  confidence: number // 0-1
}

export class SpeechToTextService {
  private recognition: SpeechRecognition | null = null
  private segments: SubtitleSegment[] = []
  private startTimestamp: number = 0

  constructor() {
    // 检查浏览器支持
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported')
      return
    }

    this.recognition = new SpeechRecognition()
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.lang = 'zh-CN' // 可配置
  }

  /**
   * 开始转写
   */
  start(): void {
    if (!this.recognition) return

    this.segments = []
    this.startTimestamp = performance.now()

    this.recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1]
      const transcript = result[0].transcript
      const confidence = result[0].confidence
      const isFinal = result.isFinal

      if (isFinal) {
        const now = performance.now()
        this.segments.push({
          id: crypto.randomUUID(),
          startTime: now - this.startTimestamp - 2000, // 回退 2 秒估算
          endTime: now - this.startTimestamp,
          text: transcript.trim(),
          confidence
        })
      }
    }

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error)
    }

    this.recognition.start()
  }

  /**
   * 停止转写
   */
  stop(): SubtitleSegment[] {
    this.recognition?.stop()
    return this.segments
  }

  /**
   * 导出为 SRT 格式
   */
  exportSRT(): string {
    return this.segments.map((seg, index) => {
      const start = this.formatTime(seg.startTime)
      const end = this.formatTime(seg.endTime)
      return `${index + 1}\n${start} --> ${end}\n${seg.text}\n`
    }).join('\n')
  }

  /**
   * 导出为 WebVTT 格式
   */
  exportWebVTT(): string {
    const header = 'WEBVTT\n\n'
    const cues = this.segments.map((seg, index) => {
      const start = this.formatTimeVTT(seg.startTime)
      const end = this.formatTimeVTT(seg.endTime)
      return `${index + 1}\n${start} --> ${end}\n${seg.text}`
    }).join('\n\n')
    return header + cues
  }

  private formatTime(ms: number): string {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const f = ms % 1000
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${f.toString().padStart(3, '0')}`
  }

  private formatTimeVTT(ms: number): string {
    return this.formatTime(ms).replace(',', '.')
  }
}
```

#### **2. OPFS 字幕存储**

```
rec_xxx/
├── meta.json          # 增加 hasSubtitles: true
├── index.jsonl
├── data.bin
├── audio.bin
└── subtitles.json     # 🆕 字幕数据
```

```typescript
// subtitles.json 格式
interface SubtitleData {
  version: 1
  language: string        // 'zh-CN', 'en-US'
  segments: SubtitleSegment[]
  source: 'auto' | 'manual' | 'imported'
  lastModified: number
}
```

#### **3. 字幕编辑器 UI**

```svelte
<!-- src/lib/components/SubtitleEditor.svelte -->
<script lang="ts">
  import type { SubtitleSegment } from '$lib/services/speech-to-text'

  let {
    segments = $bindable<SubtitleSegment[]>([]),
    currentTime = 0,
    onSeek = (time: number) => {}
  } = $props()

  let editingId = $state<string | null>(null)

  // 当前播放位置高亮的字幕
  const activeSegment = $derived(
    segments.find(s => currentTime >= s.startTime && currentTime <= s.endTime)
  )

  function handleTextChange(id: string, newText: string) {
    const index = segments.findIndex(s => s.id === id)
    if (index !== -1) {
      segments[index] = { ...segments[index], text: newText }
    }
  }

  function handleTimeChange(id: string, field: 'startTime' | 'endTime', value: number) {
    const index = segments.findIndex(s => s.id === id)
    if (index !== -1) {
      segments[index] = { ...segments[index], [field]: value }
    }
  }

  function handleDelete(id: string) {
    segments = segments.filter(s => s.id !== id)
  }

  function handleAdd() {
    segments = [...segments, {
      id: crypto.randomUUID(),
      startTime: currentTime,
      endTime: currentTime + 3000,
      text: '新字幕',
      confidence: 1
    }]
  }

  function formatTime(ms: number): string {
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const f = Math.floor((ms % 1000) / 10)
    return `${m}:${s.toString().padStart(2, '0')}.${f.toString().padStart(2, '0')}`
  }
</script>

<div class="subtitle-editor">
  <div class="toolbar">
    <button onclick={handleAdd}>+ 添加字幕</button>
  </div>

  <div class="segments">
    {#each segments as segment (segment.id)}
      <div
        class="segment"
        class:active={activeSegment?.id === segment.id}
        onclick={() => onSeek(segment.startTime)}
      >
        <div class="time-inputs">
          <input
            type="text"
            value={formatTime(segment.startTime)}
            onchange={(e) => { /* 解析时间 */ }}
          />
          <span>→</span>
          <input
            type="text"
            value={formatTime(segment.endTime)}
            onchange={(e) => { /* 解析时间 */ }}
          />
        </div>

        <textarea
          value={segment.text}
          oninput={(e) => handleTextChange(segment.id, e.currentTarget.value)}
        />

        <div class="actions">
          {#if segment.confidence < 0.8}
            <span class="low-confidence" title="置信度低，建议校对">⚠️</span>
          {/if}
          <button onclick={() => handleDelete(segment.id)}>🗑️</button>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .segment.active {
    background: var(--color-primary-light);
    border-left: 3px solid var(--color-primary);
  }

  .low-confidence {
    color: orange;
  }
</style>
```

#### **4. 字幕渲染（Composite Worker）**

```typescript
// 在 composite-worker 中添加字幕渲染

interface SubtitleRenderConfig {
  enabled: boolean
  fontSize: number        // 默认 24
  fontFamily: string      // 默认 'Arial'
  color: string           // 默认 '#FFFFFF'
  backgroundColor: string // 默认 'rgba(0,0,0,0.7)'
  position: 'bottom' | 'top'
  margin: number          // 距离边缘的距离
}

function renderSubtitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  config: SubtitleRenderConfig,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (!text || !config.enabled) return

  ctx.font = `${config.fontSize}px ${config.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'

  const x = canvasWidth / 2
  const y = config.position === 'bottom'
    ? canvasHeight - config.margin
    : config.margin + config.fontSize

  // 测量文本宽度
  const metrics = ctx.measureText(text)
  const padding = 10

  // 绘制背景
  ctx.fillStyle = config.backgroundColor
  ctx.fillRect(
    x - metrics.width / 2 - padding,
    y - config.fontSize - padding / 2,
    metrics.width + padding * 2,
    config.fontSize + padding
  )

  // 绘制文本
  ctx.fillStyle = config.color
  ctx.fillText(text, x, y)
}
```

### 📊 工作量分解

| 任务 | 工作量 | 说明 |
|------|--------|------|
| Speech-to-Text 服务 | 2-3 天 | Web Speech API 封装 |
| OPFS 字幕存储 | 1-2 天 | 扩展现有存储结构 |
| 字幕编辑器 UI | 3-4 天 | 时间轴 + 文本编辑 |
| Composite Worker 渲染 | 2-3 天 | 字幕叠加到视频 |
| 导出集成 | 1-2 天 | SRT/WebVTT 导出 |
| 测试和调优 | 1 天 | |

**总计**: 10-15 天

### ⚠️ 注意事项

1. **Web Speech API 限制**：
   - 需要 HTTPS 或 localhost
   - 需要麦克风权限
   - 识别结果会发送到 Google 服务器（隐私考虑）

2. **准确率**：
   - 中文识别约 85-90%，建议提供校对 UI
   - 专业术语识别较差，考虑未来添加自定义词典

3. **浏览器兼容**：
   - Chrome/Edge 完全支持
   - Firefox/Safari 不支持或有限支持
   - 需要检测并提供降级方案（手动输入）
