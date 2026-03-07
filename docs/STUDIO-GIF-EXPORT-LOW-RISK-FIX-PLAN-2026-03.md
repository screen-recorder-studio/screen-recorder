# Studio GIF 导出低风险技术修复方案（2026-03）

## 1. 文档目的

本方案基于以下评估报告输出：

- `/home/runner/work/screen-recorder/screen-recorder/docs/STUDIO-GIF-EXPORT-ASSESSMENT-2026-03.md`

目标不是重写 GIF 架构，而是识别：

1. **哪些问题可以在当前架构下低风险修复**
2. **哪些问题不适合当前阶段动手**
3. **如何以最小改动提升 GIF 的产品完成度**

---

## 2. 设计原则

1. **不替换当前 GIF 底座**
   - 继续使用现有 `gif.js + export-worker + GifEncoder` 链路
2. **不改录制格式与 OPFS 结构**
3. **优先做产品化增强而非架构重写**
4. **所有改动应可独立验证与回滚**
5. **优先处理用户感知最强的问题：失败提示、体积控制、参数预设、导出预期管理**

---

## 3. 问题分级与处理建议

## 3.1 可归入“无风险/极低风险”的修改

这里的“无风险”定义为：

- 不改变编码底层协议
- 不改变录制文件格式
- 不替换第三方库
- 仅增强 UI、校验、提示、参数映射、超时策略或统计逻辑

### R0-1：补齐 GIF 导出失败的用户可见错误提示

**现状**
- `VideoExportPanel.svelte` 中 GIF 导出失败后只有 `console.error`
- 注释里仍保留 `TODO: Show error message`

**建议改动**
- 在 `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoExportPanel.svelte` 增加可见错误状态
- 将以下失败场景映射为用户文案：
  - `gif.js` 加载失败
  - `gif.worker.js` 初始化失败
  - 导出超时
  - 空帧/无可导出帧
  - OPFS 源读取失败

**风险**：极低

**价值**：高

**验收标准**
- 用户导出失败时不再只看控制台
- 至少能明确区分“资源加载失败”和“导出超时”

---

### R0-2：增加 GIF 导出预设

**现状**
- 只有离散参数：`fps / quality / scale / workers / dither`
- 用户需要自己试错

**建议改动**
- 在 `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/UnifiedExportDialog.svelte` 增加预设：
  - `小体积`：8fps / 50% / quality 15 / dither off
  - `平衡`：10fps / 75% / quality 10 / dither FloydSteinberg
  - `高质量`：15fps / 100% / quality 5 / dither Stucki
  - `社媒分享`：10fps / 60%-75% / quality 10
- 预设底层仍映射到现有参数，不引入新依赖

**风险**：极低

**价值**：高

**验收标准**
- 用户可一键选压缩策略
- 导出参数仍然可手动覆盖

---

### R0-3：为超大 GIF 增加前置风险提示

**现状**
- 当前只显示粗略估算大小
- 不会主动拦截或提示高风险参数组合

**建议改动**
- 当满足以下任一条件时，在导出对话框中显示 warning：
  - 输出时长 > 15 秒
  - 预计帧数 > 150
  - 输出尺寸 > 1280×720
  - 预估大小 > 20MB
- 文案建议：
  - 建议降低 FPS
  - 建议降低 Scale
  - 建议改用 MP4/WebM

**风险**：极低

**价值**：高

**验收标准**
- 用户在不合理配置下能在导出前看到风险，而不是导出后才发现文件过大

---

### R0-4：修正 GIF 体积预估逻辑与文案

**现状**
- `gifEstimatedSize` 采用经验公式，解释性不强
- `quality` 命名容易让用户误解

**建议改动**
- 优化 `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/UnifiedExportDialog.svelte` 中的预估逻辑
- 文案层面明确：
  - 当前“质量”实质是采样强度
  - “更清晰”通常意味着“更慢、更大”
- 显示“这是估算值，复杂背景与颜色变化会显著影响最终大小”

**风险**：极低

**价值**：中高

**验收标准**
- 用户不会把估算结果视为精确承诺
- 参数语义更清晰

---

### R0-5：补齐 dither 算法说明

**现状**
- UI 中暴露了 `FloydSteinberg / FalseFloydSteinberg / Stucki / Atkinson`
- 但没有说明何时使用、是否会增大体积

**建议改动**
- 在 `UnifiedExportDialog.svelte` 增加简短帮助文本
- 说明：
  - `None`：文件更小，渐变可能分层
  - `FloydSteinberg`：通用默认
  - `Stucki/Atkinson`：更平滑，但可能更慢/更大

**风险**：极低

**价值**：中

---

### R0-6：修正导出进度/总帧数展示对 OPFS 场景的偏差

**现状**
- 某些 UI 进度初始化仍可能依赖 `encodedChunks.length`
- 但 OPFS 导出并不等于当前窗口缓存帧数

**建议改动**
- 优先使用 `totalFramesAll` / trim 后的全局帧数做 GIF 进度展示
- 避免让用户看到“总帧数过少”或前后不一致

**风险**：低

**价值**：中高

---

### R0-7：将 GIF 库与 worker 资源检查前置化

**现状**
- 只有用户真正点击 GIF 导出时才尝试懒加载 `gif.js`
- 问题暴露较晚

**建议改动**
- 在导出对话框打开时就做一次轻量检查
- 或者在首次进入 Studio 时记录资源可用性状态
- 仍不改变真正的编码逻辑

**风险**：低

**价值**：中

---

## 3.2 低风险但需要小心验证的修改

### R1-1：将固定 5 分钟超时改为“基于输出规模的动态超时”

**现状**
- `GIF_RENDER_TIMEOUT = 300000`

**建议改动**
- 使用 `expectedFrames + outputSize` 粗略计算超时：
  - 例如最小 60 秒，最大 10 分钟
- 对非常小的 GIF 更快失败
- 对中大型 GIF 减少误杀

**风险**：低

**注意点**
- 不要把超时设置得无限长
- 要保留统一错误码，方便 UI 提示

---

### R1-2：复用主线程 canvas，避免每帧重复创建 DOM canvas

**现状**
- `gif-encoder.ts` 在 `addFrame()` 中每帧创建临时 canvas

**建议改动**
- `GifEncoder` 内部维护一个可复用 canvas/context
- 仅在尺寸变化时重建

**风险**：低

**收益**
- 降低 GC 压力
- 提升长任务稳定性

**注意点**
- 必须验证不同尺寸/trim/crop 组合不会造成脏数据复用

---

### R1-3：增加“导出建议切换到 MP4/WebM”的分流提示

**现状**
- 用户可以随意把大视频导出成 GIF

**建议改动**
- 当时长、分辨率、预计体积过高时，增加提示：
  - “当前配置更适合导出 MP4/WebM；GIF 适合短片段与分享预览”

**风险**：低

**价值**：高

---

## 3.3 当前阶段不建议做成“低风险”的修改

以下事项重要，但不应归为“无风险修复”，建议另立专题。

### R2-1：替换 `gif.js` 为新库

**原因**
- 会改变编码底座、兼容性、worker 行为、体积和性能特征
- 需要完整回归验证

**风险等级**：高

---

### R2-2：引入真正的 palette / colors / lossy 后处理能力

**原因**
- 如果仍基于 `gif.js` 原链路实现，扩展成本和可维护性不确定
- 如果引入 wasm/gifsicle 方案，会带来包体、内存和二次处理问题

**风险等级**：中高

---

### R2-3：改造 Worker 与主线程之间的图像传输模型

**原因**
- 会触达导出主路径
- 容易引入帧错乱、颜色异常、transfer 失效等问题

**风险等级**：中高

---

### R2-4：重写 Studio 页面，将 GIF 控件前置到主编辑界面

**原因**
- 属于交互方案级调整，不是修 bug
- 会影响整体 Studio 信息架构

**风险等级**：中

---

## 4. 推荐实施顺序

### 第一阶段：无风险体验修复

1. 补齐导出失败错误提示
2. 增加 GIF 导出预设
3. 增加超大 GIF 风险提示
4. 修正文案与体积估算说明
5. 补充 dither 帮助说明

### 第二阶段：低风险稳定性优化

6. 调整 OPFS 场景下的 GIF 进度统计
7. 前置资源检查
8. 动态超时
9. 复用主线程 canvas

### 第三阶段：专题评估

10. palette / lossy / target-size 真实压缩能力
11. 更换或自维护 GIF 技术底座
12. 是否引入本地后处理优化链路

---

## 5. 交付物建议

如果进入修复阶段，建议拆成两个 PR：

### PR-A：纯低风险产品增强

范围：
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoExportPanel.svelte`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/UnifiedExportDialog.svelte`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/utils/export-utils.ts`
- i18n 文案文件

目标：
- 错误反馈
- 预设
- 风险提示
- 文案修正
- 预估增强

### PR-B：低风险性能/稳定性增强

范围：
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/gif-encoder.ts`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/export-worker/index.ts`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/export-manager.ts`

目标：
- 动态超时
- canvas 复用
- 进度统计修正
- 资源检查前置

---

## 6. 最终建议

> 当前阶段最值得做的，不是立刻重写 GIF 架构，而是先完成一批“低风险、用户感知强、能快速验证”的增强项，把 GIF 导出从“能用”提升到“更可信、更可控、更像卖点”。

一句话概括：

- **先把体验做稳**
- **再把压缩做强**
- **最后再决定是否升级 GIF 技术底座**
