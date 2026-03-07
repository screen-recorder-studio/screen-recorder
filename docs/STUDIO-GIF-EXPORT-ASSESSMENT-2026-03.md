# Studio 视频编辑与 GIF 导出全面评估报告（2026-03）

## 1. 评估结论摘要

### 1.1 核心结论

1. **当前 GIF 导出链路可用，但还不能安全地作为“核心卖点”长期放大。**
   现有实现已经完成从 Studio 页面到 `gif.js` 的端到端导出闭环，并且采用了“Worker 解码/合成 + 主线程编码”的流式方案，明显优于早期一次性收集全部帧的做法。关键实现位于：
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte`
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoExportPanel.svelte`
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/export-manager.ts`
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/gif-encoder.ts`
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/export-worker/index.ts`

2. **当前引入的 GIF 库 `gif.js@0.2.0` 存在现实问题，问题不是“完全不可用”，而是“老旧、维护弱、路径和性能问题在生态里已知”。**
   工程当前依赖为 `/home/runner/work/screen-recorder/screen-recorder/packages/extension/package.json` 中的 `gif.js: ^0.2.0`，实际安装版本也是 `0.2.0`。官方 README 明确要求显式提供 `workerScript`，并且上游仓库已多年缺乏活跃维护；其 issue 中长期存在 worker 路径定位问题（Issue #115）。参考：
   - gif.js README: <https://github.com/jnordberg/gif.js>
   - gif.js Issue #115: <https://github.com/jnordberg/gif.js/issues/115>
   - gif.js.optimized npm: <https://www.npmjs.com/package/gif.js.optimized>

3. **是否需要 GIF 压缩能力：需要，而且应该被视为 GIF 产品化能力的一部分。**
   当前产品已经支持 `fps / scale / quality / dither / workers`，但这更像“导出参数调优”，还不是完整的“GIF 压缩能力”。行业通行优化手段还包括：颜色数压缩、lossy 压缩、透明区域优化、重复帧/局部帧优化、文件体积目标控制。参考：
   - EZGIF GIF 优化帮助：<https://ezgif.com/help/optimizing-gifs>
   - EZGIF GIF Optimizer：<https://ezgif.com/optimize>
   - Gifsicle Manual：<https://www.lcdf.org/gifsicle/man.html>

4. **低风险修复空间很大。**
   不替换编码库、不重写导出架构，也可以先做一批低风险增强，把可靠性、错误反馈、预估准确性、参数预设、超时策略、GIF 导出引导等问题明显改善。

---

## 2. 评估范围与方法

### 2.1 范围

本次评估覆盖两部分：

1. **Studio 视频编辑页面现状**，重点文件：
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte`
2. **Studio 的 GIF 导出端到端链路**，包括：
   - 导出入口 UI
   - 导出参数对话框
   - ExportManager
   - export-worker
   - 主线程 GIF 编码器
   - 静态 `gif.js` / `gif.worker.js` 资源

### 2.2 方法

- 阅读 CLAUDE.md 和工程架构说明
- 静态审查 Studio 与导出链路代码
- 验证当前工程依赖与打包产物
- 运行现有命令获取工程基线
- 结合外部网络资料评估 `gif.js` 现状与 GIF 压缩必要性

---

## 3. 工程与验证基线

### 3.1 工程现状

根据 `/home/runner/work/screen-recorder/screen-recorder/CLAUDE.md`：

- 工程是 **pnpm Workspace Monorepo**
- 核心包是 `/home/runner/work/screen-recorder/screen-recorder/packages/extension`
- Studio 页面是 SvelteKit 路由 `/studio`
- 当前没有自动化测试套件，主要依赖 `pnpm check` 与 `pnpm build:extension` 做工程验证

### 3.2 本次实际验证结果

已执行：

```bash
cd /home/runner/work/screen-recorder/screen-recorder
pnpm install
pnpm check
pnpm build:extension
```

结果：

| 命令 | 结果 | 说明 |
|---|---|---|
| `pnpm install` | ✅ 成功 | 依赖可正常安装 |
| `pnpm build:extension` | ✅ 成功 | 扩展生产构建通过，且产物中包含 `build/gif/gif.js`、`build/gif/gif.worker.js` |
| `pnpm check` | ❌ 失败 | 失败原因是与本议题无关的两个既有 TypeScript 错误，不是 GIF 导出链路导致 |

`pnpm check` 当前的两个既有错误：
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/opfs-drive/+page.svelte:221`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/sidepanel/+page.svelte:982`

因此本次评估的基线应表述为：

> **当前工程构建成功；静态检查存在既有遗留错误，但与 Studio GIF 导出评估不是直接耦合问题。**

---

## 4. Studio 页面：当前视频编辑能力评估

## 4.1 `+page.svelte` 的真实职责

`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte` 主要承担的是 **Studio 壳层编排**，而不是直接做 GIF 编码。

它的职责主要有：

1. **录制加载与路由解析**
   - 读取 URL 中的 `id`
   - 如果没有 `id`，自动回退到最新可用录制
   - 通过 OPFS reader worker 打开录制目录

2. **预览窗口调度**
   - 维护 `durationMs / windowStartMs / windowEndMs / globalTotalFrames / keyframeInfo`
   - 通过 `computeFrameWindow()` 计算播放、seek、scrub、prefetch 的窗口
   - 驱动 `VideoPreviewComposite`

3. **Studio 编辑外壳**
   - 提供背景、圆角、边距、阴影、比例控制入口
   - 管理最近录制抽屉（现在是 `StudioDriveOverlay`）

4. **导出入口装配**
   - 将 `workerEncodedChunks / totalFramesAll / opfsDirId / sourceFps` 传入 `VideoExportPanel`

### 4.2 Studio 编辑能力优点

1. **录制读取路径清晰**
   - 支持显式 `id` 和“最新录制回退”两种进入模式
2. **预览窗口按关键帧对齐**
   - `computeFrameWindow()` 对 seek/play/prefetch 使用不同策略，逻辑完整
3. **Studio 壳层已经具备产品化基础**
   - 头部、预览区、右侧编辑区、Drive overlay 结构完整
4. **导出与编辑配置已打通**
   - 背景、crop、trim 等编辑结果会进入导出参数

### 4.3 Studio 编辑能力的不足

1. **Studio 主页面对 GIF 的“产品心智”还不够强**
   - `+page.svelte` 本身没有 GIF 专属可视化预警或推荐
   - 用户只有在打开导出对话框之后，才接触到 GIF 设置

2. **编辑能力偏“样式型”，缺少 GIF 导出导向的“体积型”引导**
   - 当前主编辑面板集中在背景、阴影、圆角、边距
   - 对 GIF 更敏感的“时长、帧率、颜色、文件大小”并不在主路径上

3. **错误反馈主要仍依赖 console**
   - OPFS reader 在错误时会切到空态，但导出失败侧仍缺少明确用户提示

结论：

> Studio 页面做“视频编辑器壳层”已经基本合格，但如果要把 GIF 作为核心卖点，当前页面对 GIF 场景的引导、约束和预警都还不够。

---

## 5. GIF 导出链路：端到端梳理

## 5.1 当前导出链路

完整链路如下：

```text
Studio +page.svelte
  -> VideoExportPanel.svelte
  -> UnifiedExportDialog.svelte
  -> ExportManager.exportEditedVideo()
  -> export-worker/index.ts
  -> 主线程 GifEncoder
  -> static/gif/gif.js + static/gif/gif.worker.js
  -> Blob 下载
```

### 5.2 各层职责

#### A. `VideoExportPanel.svelte`

文件：
`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoExportPanel.svelte`

职责：
- 懒加载 `/gif/gif.js`
- 组装导出参数
- 合并背景配置、trim 配置、数据源模式（`chunks` / `opfs`）
- 接收导出进度并驱动 UI

#### B. `UnifiedExportDialog.svelte`

文件：
`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/UnifiedExportDialog.svelte`

GIF 可配置项：
- `fps`
- `quality`
- `scale`
- `workers`
- `repeat`
- `dither`
- `transparent`

#### C. `ExportManager`

文件：
`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/export-manager.ts`

职责：
- 创建 export worker
- 监听 `gif-init / gif-add-frame / gif-render`
- 在主线程上创建 `GifEncoder`
- 将 worker 发来的帧逐张喂给 `gif.js`

#### D. `export-worker/index.ts`

文件：
`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/export-worker/index.ts`

职责：
- 从内存块或 OPFS 读取帧
- 在 OffscreenCanvas 中完成背景合成
- 根据 `gifOptions.fps` 计算 stride 抽帧
- 逐帧将 `ImageData` 发回主线程
- 请求主线程完成最终 GIF render

#### E. `gif-encoder.ts`

文件：
`/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/gif-encoder.ts`

职责：
- 使用全局 `window.GIF`
- 指定 `workerScript`
- 为每帧创建临时 canvas 后调用 `gif.addFrame()`
- 监听 `progress / finished / error`

---

## 6. 当前引入的 GIF 库是否“有问题”

## 6.1 结论

**有问题，但不是“已经坏掉”，而是“存在明确的工程与生态风险”。**

更准确地说：

- **功能层面：** 当前还能工作
- **工程层面：** 依赖老旧库，必须额外处理 worker 路径与主线程编码问题
- **产品层面：** 如果要把 GIF 当核心卖点，仅靠 `gif.js@0.2.0` 现状不够稳

## 6.2 代码层面确认到的事实

1. 工程当前依赖 `gif.js@^0.2.0`
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/package.json`
2. 本地静态资源直接携带了老版本脚本
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/static/gif/gif.js`
   - `/home/runner/work/screen-recorder/screen-recorder/packages/extension/static/gif/gif.worker.js`
3. 运行时通过 `window.GIF` 使用，而不是 ESM 模块化接入
4. `gif-encoder.ts` 中显式处理了 `workerScript` 路径，这本身就说明库接入有路径敏感问题
5. 生产构建产物中已包含 `build/gif/gif.js` 与 `build/gif/gif.worker.js`，说明当前项目已经部分规避了最常见的路径失效问题

## 6.3 外部网络调研结果

### A. 上游维护状态偏弱

- `gif.js` 官方仓库长期缺乏活跃维护，README 和示例都保留着较老的接入方式
- 社区存在 `gif.js.optimized` 之类优化分支，但其 npm 发布也已多年未更新

这意味着：

> 当前依赖不是“现代、活跃、可持续演进”的 GIF 技术底座。

### B. worker 路径问题是官方生态已知问题

- 官方 README 要求显式提供 `workerScript`
- GitHub Issue #115 讨论的就是在打包工具/部署路径下 `gif.worker.js` 无法正确定位

当前项目已经通过静态资源 + `chrome.runtime.getURL('gif/gif.worker.js')` + `/gif/gif.worker.js` fallback 缓解了这个问题，但风险没有彻底消失：

- 扩展环境与普通 Web 环境存在差异
- 路径 fallback 仍依赖运行环境正确解析 `/gif/...`
- 一旦后续切换构建策略、CDN、静态资源前缀，问题可能回归

### C. 性能与内存问题是这个库的长期现实约束

即使项目已经做了流式传帧，`gif.js` 仍有几个天然约束：

1. 最终编码仍依赖主线程 `GIF` 实例
2. 每帧仍要在主线程创建临时 `canvas` 再 `putImageData`
3. GIF 本身是 256 色格式，对视频内容天然不友好
4. 长时长、高分辨率、高帧率输出时，耗时和体积都很容易失控

## 6.4 可以明确确认的问题点

### 问题 1：库老旧，长期可维护性弱

- 影响：后续如果遇到现代浏览器、构建工具、性能瓶颈问题，团队大概率要自己 fork 或 patch
- 结论：**已确认存在**

### 问题 2：workerScript 路径问题属于上游已知问题

- 影响：对部署路径、扩展环境、静态资源策略敏感
- 结论：**已确认存在，但当前项目已有一定缓解**

### 问题 3：主线程编码开销依然较高

- 影响：导出时 UI 响应性、长任务稳定性和峰值耗时都可能受影响
- 结论：**已确认存在**

### 问题 4：库侧没有现代 GIF 产品常见的压缩能力封装

- 影响：只能通过比较原始的参数去“间接压缩”，用户心智和结果稳定性都一般
- 结论：**已确认存在**

---

## 7. 当前 GIF 导出实现的优点

尽管存在问题，但当前实现也有不少可保留资产。

### 7.1 已有优势

1. **已经支持 OPFS 录制直接导出**
   - 不必依赖预览窗口中仅缓存的局部帧
2. **已有流式导出架构**
   - 这比旧式“先收集所有 ImageData 再统一编码”成熟得多
3. **已有基础参数控制能力**
   - fps / scale / dither / repeat / quality / workers 都已打通
4. **已有背景合成与 trim 结合能力**
   - Studio 的编辑结果可以带入 GIF 输出
5. **构建产物已正确打出 gif 静态资源**
   - 当前线上构建至少不是“资源缺失型”的问题

结论：

> 不应该推倒重来；当前更合理的方向是“保留现有流式链路，在其上做可靠性、交互和压缩能力增强”。

---

## 8. 当前 GIF 导出实现的主要问题点

## 8.1 可靠性问题

### P1. `gif.js` 仍是懒加载脚本注入，失败后只有抛错，没有完整用户反馈

位置：
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoExportPanel.svelte:112-162`

现状：
- 通过 `document.createElement('script')` 动态注入 `/gif/gif.js`
- 失败时 `throw new Error('Failed to load gif.js library')`
- catch 中只有 `console.error`，注释仍是 `TODO: Show error message`

影响：
- 用户在真实失败场景下只能看到无响应或导出结束，没有明确解释

### P2. GIF 渲染超时是固定 5 分钟，不随帧数、尺寸、设备性能变化

位置：
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/export-worker/index.ts:1717-1822`

现状：
- 单帧操作超时固定 30 秒
- 最终渲染超时固定 300 秒

影响：
- 大 GIF 场景下可能误判超时
- 小 GIF 场景下失败反馈又偏慢

### P3. 进度和错误信息更偏内部实现，不够面向用户

现状：
- 进度分段主要是 `preparing / muxing / finalizing`
- 缺少“当前输出预计很大”“建议降低尺寸”等解释性提示

影响：
- 对普通用户不够友好
- 很难支撑“核心卖点”的感知质量

## 8.2 性能问题

### P4. 主线程逐帧创建临时 canvas，仍有明显额外开销

位置：
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/gif-encoder.ts:95-117`

现状：
- 每次 `addFrame()` 都创建新的 `<canvas>`
- `putImageData()` 后再交给 `gif.js`

影响：
- 长任务导出时会增加 GC 压力和主线程负担

### P5. Worker -> 主线程仍通过 `ImageData` 结构化克隆传输

位置：
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/export-worker/index.ts:1773-1789`

现状：
- 当前发送 `ImageData`
- 未对底层 buffer 做更激进的 transfer 优化

影响：
- 大尺寸帧仍可能造成较高传输成本

## 8.3 产品能力问题

### P6. 当前只有“参数调节”，没有真正的“GIF 压缩能力”抽象

现状：
- 已支持：`fps / scale / quality / dither`
- 未支持：`colors / lossy / transparency optimize / duplicate-frame optimize / target size`

影响：
- 对外很难宣称“GIF 优化导出”
- 用户只能靠经验反复试错

### P7. 导出体积预估公式过于粗略

位置：
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/UnifiedExportDialog.svelte:225-233`

现状：
- `gifEstimatedSize` 是经验公式，不依赖真实颜色复杂度、重复帧比例、背景复杂度

影响：
- 预估结果容易偏差大
- 用户对参数选择缺少可信依据

### P8. 参数名称容易造成误解

现状：
- `gif.js` 的 `quality` 实际是像素采样间隔，值越小质量越高，但这不是普通用户理解的“图像质量”
- UI 虽做了预设，但依然容易误导

影响：
- 用户可能错误理解“更高质量 = 更高文件大小/更慢”之间的关系

### P9. 缺少 GIF 场景下最关键的“压缩预设”

现状：
- 目前只有零散参数，没有“社媒分享 / 小体积 / 演示预览 / 高保真”这样的组合预设

影响：
- 导出成功率与用户满意度都依赖用户自行摸索

### P10. 缺少导出前风险提示

现状：
- 没有对“长于 N 秒 / 大于 N 分辨率 / 预计超过 N MB”的 GIF 输出做醒目预警

影响：
- 用户可能直接尝试不合理参数，得到漫长等待或超大文件

---

## 9. 是否需要同时支持 GIF 压缩能力

## 9.1 结论

**需要。**

如果团队计划把 GIF 导出作为核心卖点，那么“仅能导出 GIF”不够，至少还要做到：

1. **让用户更容易导出可分享的 GIF**
2. **让用户更少试错**
3. **让结果更可预测**
4. **让导出速度、体积、视觉质量之间的取舍更清晰**

否则产品会面临典型问题：

- 导出成功但文件过大
- 画面质量差但用户不知道怎么调
- 导出太久、进度不可信
- 用户不知道 GIF 和 MP4/WebM 的最佳使用场景

## 9.2 当前已经具备的“压缩雏形”

严格说，当前并不是完全没有压缩能力，而是只有**基础参数压缩**：

| 能力 | 当前是否支持 | 说明 |
|---|---|---|
| 降低 FPS | ✅ | 通过抽帧直接减少帧数 |
| 缩放尺寸 | ✅ | 通过 `scale` 降低输出分辨率 |
| Dither 控制 | ✅ | 对低色深过渡有帮助 |
| workers 调整 | ✅ | 影响编码速度，不直接等价于压缩 |
| repeat 设置 | ✅ | 影响循环行为，不直接压缩 |
| 透明色 | ✅ | 仅基础支持 |

这些手段能改善体积，但还不等于完整的“GIF 压缩能力”。

## 9.3 行业通行的 GIF 优化手段

根据 EZGIF 官方帮助和 Gifsicle 手册，GIF 优化通常包括：

1. **Resize / Crop**
2. **降低帧率、删除冗余帧**
3. **减少颜色数（palette / colors）**
4. **Dithering 开关与算法选择**
5. **Lossy 压缩**
6. **透明区域优化 / 仅编码变化区域**
7. **多轮 optimize（例如 `gifsicle -O3 --lossy=80 --colors 64`）**

结论：

> 如果要把 GIF 当成产品卖点，至少应把“体积控制”从“用户手动调参数”提升到“产品可理解、可预测、可推荐的压缩策略”。

---

## 10. GIF 压缩能力的实现成本评估

## 10.1 方案分层

### 方案 A：仅做现有参数预设化（低成本）

内容：
- 增加“小体积 / 平衡 / 高质量 / 社媒分享”预设
- 预设本质仍映射到现有 `fps / scale / quality / dither`
- 增加体积预警和推荐文案

成本评估：**低**

优点：
- 不改编码核心
- 基本无架构风险
- 可以很快提升用户体验

缺点：
- 不是真正的 palette/lossy 压缩
- 上限有限

### 方案 B：在当前链路中补“真实压缩参数”（中成本）

内容：
- 增加 colors / palette / duplicate-frame / transparency optimize 等控制
- 需要评估 `gif.js` 原库是否足够支持，或是否需要 fork/patch

成本评估：**中**

优点：
- 能显著改善结果质量与可控性

缺点：
- 老库扩展成本不确定
- 需要更多兼容性验证

### 方案 C：引入更强的本地后处理优化（中高成本）

内容：
- 在浏览器侧增加二次优化流程，例如基于 gifsicle/wasm 的后处理
- 首先生成 GIF，再做 `optimize/colors/lossy`

成本评估：**中高**

优点：
- 更接近专业 GIF 优化工具
- 可以形成更强卖点

缺点：
- 包体、内存、性能成本都更高
- 需要重新设计导出进度与失败处理

### 方案 D：替换/自维护 GIF 编码底座（高成本）

内容：
- 替换 `gif.js` 或 fork 并长期维护
- 重新处理 worker、颜色量化、优化阶段

成本评估：**高**

优点：
- 长期可控

缺点：
- 实施与维护成本都高

## 10.2 推荐策略

建议分阶段推进：

1. **先做方案 A（低风险产品增强）**
2. **再评估方案 B（可控的真实压缩能力）**
3. **最后再考虑方案 C / D（技术底座升级）**

---

## 11. 哪些问题是当前最值得优先处理的

按“对 GIF 卖点影响”排序：

| 优先级 | 问题 | 原因 |
|---|---|---|
| P0 | 导出失败无用户反馈 | 会直接损害信任感 |
| P0 | 缺少压缩预设与风险提示 | 用户很难稳定导出可分享 GIF |
| P0 | 体积预估粗糙 | 用户难以理解参数后果 |
| P1 | 固定超时策略 | 长任务体验不稳定 |
| P1 | 主线程逐帧临时 canvas 开销 | 影响性能上限 |
| P1 | 老库可维护性弱 | 是中长期风险 |
| P2 | 缺少 palette / lossy / target-size 等能力 | 影响“专业级 GIF 导出”定位 |

---

## 12. 本次评估的最终判断

### 12.1 可以对外怎么说

**现在可以说：**
- Studio 已具备 GIF 导出能力
- 支持背景合成、trim、缩放和基础参数控制
- 构建链路与扩展打包产物正常

**现在还不建议强势宣传为：**
- 专业级 GIF 优化导出
- 极致稳定的大型 GIF 工作流
- 强压缩/小体积 GIF 专家模式

### 12.2 最终建议

> 当前 GIF 导出功能已经具备“可用基础”，但若要成为核心卖点，必须补上两类能力：
>
> 1. **低风险产品化增强**：错误反馈、压缩预设、风险提示、预估修正、超时与进度策略优化；
> 2. **中长期技术增强**：更真实的 GIF 压缩能力（palette/lossy/optimize）以及对老旧 `gif.js` 依赖的替代或自维护方案。

---

## 13. 参考资料

### 13.1 工程内代码与文档

- `/home/runner/work/screen-recorder/screen-recorder/CLAUDE.md`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/VideoExportPanel.svelte`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/UnifiedExportDialog.svelte`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/export-manager.ts`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/services/gif-encoder.ts`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/export-worker/index.ts`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/workers/export-worker/strategies/gif.ts`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/package.json`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/static/gif/gif.js`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/static/gif/gif.worker.js`

### 13.2 外部资料

- gif.js 官方仓库：<https://github.com/jnordberg/gif.js>
- gif.js README：<https://github.com/jnordberg/gif.js/blob/master/README.md>
- gif.js Issue #115：<https://github.com/jnordberg/gif.js/issues/115>
- gif.js.optimized npm：<https://www.npmjs.com/package/gif.js.optimized>
- EZGIF GIF 优化帮助：<https://ezgif.com/help/optimizing-gifs>
- EZGIF GIF Optimizer：<https://ezgif.com/optimize>
- Gifsicle Manual：<https://www.lcdf.org/gifsicle/man.html>
