# GIF 库与开源生态调研（2026-03）

## 1. 调研目标

基于上一轮评估中对 `gif.js@0.2.0` 的担忧，本次补充回答两个问题：

1. **比 `gif.js` 更“新”的 GIF 相关库还有哪些？**
2. **GitHub 上主流相关开源项目，实际都在使用哪些 GIF 技术栈？**

本次调研仅输出结论与建议，不修改代码。

---

## 2. 核心结论

### 2.1 一句话结论

如果只看“浏览器内直接编码 GIF”的 JavaScript 库，`gif.js` 不是唯一选择，**`modern-gif`、`gifenc`、`@skyra/gifenc`、`ffmpeg.wasm` 路线**都值得评估；但如果看 **主流开源项目的真实实践**，结论更明显：

> **成熟项目普遍不是只靠一个前端 GIF JS 库，而是使用“生成 + 优化”的组合式技术栈。**

也就是说，行业主流方案大致分成三类：

1. **纯前端 JS 编码**：`gif.js`、`modern-gif`、`gifenc`
2. **浏览器/客户端 FFmpeg 路线**：`ffmpeg.wasm` 或原生 `ffmpeg`
3. **高质量/高压缩后处理路线**：`gifsicle`、`gifski`、自研编码器

### 2.2 对本项目最重要的判断

对 `/home/runner/work/screen-recorder/screen-recorder/packages/extension` 这种 **Chrome Extension + Svelte + Web Worker + OPFS** 架构来说：

- **若追求最小迁移成本**：优先评估 `modern-gif`
- **若追求更底层可控性与更现代 API**：优先评估 `gifenc`
- **若追求更接近专业工具的质量/压缩能力**：应认真评估 `ffmpeg.wasm + gifski/gifsicle` 或类似双阶段方案
- **若只是想找一个“比 gif.js 更新一点的平替”，但不重构整体能力模型**：可以把 `modern-gif` 作为第一候选

---

## 3. 当前项目现状（作为对照基线）

当前工程仍使用：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/package.json`
  - `gif.js: ^0.2.0`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/static/gif/gif.js`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/static/gif/gif.worker.js`

而且导出链路仍是：

```text
Studio -> VideoExportPanel -> ExportManager -> export-worker -> 主线程 GifEncoder -> gif.js
```

所以本次调研的重点不是“GIF 能不能导出”，而是：

- 现有底座是否已经过旧
- 生态里更现代的可替代路线有哪些
- 主流项目实际怎么做

---

## 4. 候选库调研：比 gif.js 更新的有哪些

## 4.1 先定义“更新”的含义

这里的“更新”不单指发布时间，还包括：

1. **仓库创建时间与现代化程度**
2. **近两年是否仍有维护**
3. **是否支持现代 bundler / TypeScript / Worker / ESM**
4. **是否适配浏览器内导出场景**

因此，本节不会把所有“能处理 GIF 的库”混在一起，而是按适配方向分组。

---

## 4.2 A 类：浏览器内直接编码型（最接近当前 gif.js 路线）

### A1. `modern-gif`

- GitHub: <https://github.com/qq15725/modern-gif>
- npm: <https://www.npmjs.com/package/modern-gif>
- 仓库信息（GitHub）
  - 创建于 2023-02-08
  - 最近推送：2024-12-25
  - `stargazers_count`: 60
- README 特性：
  - Encode / Decode
  - 最大颜色数控制（`maxColors`）
  - 压缩 size
  - Web Worker
  - TypeScript

#### 优点

1. **比 gif.js 新得多**，API 和打包方式更现代。
2. **直接支持 `maxColors`**，天然更接近“压缩能力”而不是单纯导出。
3. **支持 Worker 和 TypeScript**，适合现代前端工程。
4. 同时支持 encode/decode，后续如果做 GIF 二次压缩或重编码会更灵活。

#### 风险/不足

1. GitHub 星数不高，生态成熟度不如 `gif.js` 历史积累。
2. 维护状态属于“有一定更新，但不是超高活跃的大项目”。
3. 还需要验证长视频、多帧、复杂背景下的稳定性。

#### 对本项目的适配判断

**很值得优先做 PoC。**

原因：
- 它最接近当前项目的运行环境和产品形态
- 比 `gif.js` 更现代
- 自带颜色数控制，对 GIF 压缩能力有直接帮助

---

### A2. `gifenc`

- GitHub: <https://github.com/mattdesl/gifenc>
- npm: <https://www.npmjs.com/package/gifenc>
- 仓库信息（GitHub）
  - 创建于 2021-02-23
  - 最近推送：2024-09-19
  - `stargazers_count`: 331
- README 特性：
  - 浏览器 + Node.js（ESM + CJS）
  - 小体积
  - V8 优化
  - 多 Worker
  - 可手动控制 palette / indexed bitmap / per-frame palette

#### 优点

1. **底层能力强，性能导向明显。**
2. 直接暴露调色板与索引位图控制，比 `gif.js` 更适合做高阶优化。
3. 更适合“自己掌控编码过程”的团队。

#### 风险/不足

1. README 明确提到：**当前没有 dithering 支持**，更适合 flat/vector 风格，而不是视频/照片类场景。
2. API 更底层，迁移成本比 `modern-gif` 高。
3. npm 发布不新，但仓库本身并不算死库。

#### 对本项目的适配判断

**适合作为“中级偏底层候选”，不一定适合作为第一替换候选。**

原因：
- 本项目处理的是录屏视频而非扁平图形
- GIF 视频化场景往往比 `gifenc` README 推荐的 use case 更复杂

---

### A3. `@skyra/gifenc`

- GitHub: <https://github.com/skyra-project/gifenc>
- npm: <https://www.npmjs.com/package/@skyra/gifenc>
- 文档: <https://skyra-project.github.io/gifenc/>
- 仓库信息（GitHub）
  - 创建于 2021-07-23
  - 最近推送：2026-03-07
  - `stargazers_count`: 33
- 官方定位：**Node.js server-side animated GIF generation**

#### 优点

1. 源仓库维护较活跃。
2. 文档较完整。
3. 适合 Node.js 服务端或 Electron 主进程类场景。

#### 风险/不足

1. **核心定位偏 Node/server-side，不是浏览器优先。**
2. 对 Chrome Extension 前端页面直接替换帮助有限。
3. 作为浏览器内编码库不如 `modern-gif`、`gifenc` 自然。

#### 对本项目的适配判断

**可了解，但不应作为首选。**

---

## 4.3 B 类：工具链型（不是简单“库替换”，而是能力升级）

### B1. `ffmpeg.wasm`

- GitHub: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- 官方文档: <https://ffmpegwasm.netlify.app/docs/getting-started/installation/>
- GitHub 信息
  - 创建于 2019-10-16
  - 最近推送：2026-02-01
  - `stargazers_count`: 17238
- 官方定位：**FFmpeg for browser, powered by WebAssembly**

#### 优点

1. **生态成熟度和通用能力远超单一 GIF JS 库。**
2. 可以直接使用 FFmpeg 的 GIF 参数链路：
   - `palettegen`
   - `paletteuse`
   - `fps`
   - `scale`
   - 各类滤镜
3. 很多主流项目的思路都更接近 FFmpeg，而不是单纯 JS GIF encoder。
4. 如果以后要扩展 WebP / APNG / AVIF / 视频后处理，也更统一。

#### 风险/不足

1. **包体和运行时成本大。**
2. 在浏览器环境中要处理跨源、SharedArrayBuffer、加载耗时等工程细节。
3. 对 Chrome Extension 来说，集成与首屏体验需要仔细设计。

#### 对本项目的适配判断

**如果目标是“把 GIF 做成核心卖点”，它非常值得评估。**

但这已经不是“小修小补”，而是技术底座升级路线。

---

### B2. `gifski`

- GitHub: <https://github.com/ImageOptim/gifski>
- 官网: <https://gif.ski>
- 仓库信息（GitHub）
  - 创建于 2017-11-01
  - 最近推送：2026-02-28
  - `stargazers_count`: 5431
- README 特性：
  - 基于 `pngquant/libimagequant`
  - 高质量 cross-frame palettes
  - temporal dithering
  - CLI + C library
  - 支持从 FFmpeg 直接 pipe 输入

#### 优点

1. **质量导向非常强**，在 GIF 质量方面口碑极好。
2. 本身就考虑了跨帧 palette 与 temporal dithering，明显比很多传统 GIF encoder 更专业。
3. 非常适合做“高质量 GIF 导出”卖点。

#### 风险/不足

1. 不是简单的前端 JS 库，需要走 native / Rust / C / WASM 集成路线。
2. 和当前项目前端主线程 `gif.js` 路线差异很大。
3. 许可证和集成方式都需要专项评估。

#### 对本项目的适配判断

**适合作为“高质量方案”的中长期候选。**

如果未来要做“专业 GIF 导出”，`gifski` 是必须关注的方向。

---

### B3. `gifsicle`

- GitHub: <https://github.com/kohler/gifsicle>
- 变更日志: <https://www.lcdf.org/gifsicle/changes.html>
- 仓库信息（GitHub）
  - 创建于 2013-05-17
  - 最近推送：2026-01-31
  - `stargazers_count`: 4171
- 官方定位：Create, manipulate, and optimize GIF images and animations

#### 优点

1. **GIF 优化能力很强**，特别是：
   - `--optimize=3`
   - `--lossy`
   - `--colors`
   - `--dither`
2. 活跃维护至今。
3. 很适合做 GIF 导出后的二次压缩与优化。

#### 风险/不足

1. 它更像“优化器”而不是浏览器 UI 里直接编码的前端库。
2. 若在扩展内使用，需要 native/wasm/外部流程的设计。
3. 适合作为二阶段 pipeline，不适合作为当前 `gif.js` 的直接平替。

#### 对本项目的适配判断

**非常适合进入“后处理优化”备选池。**

如果以后产品要宣传“更小体积 GIF”，`gifsicle` 很可能比单换一个 JS encoder 更有价值。

---

## 4.4 C 类：不建议优先投入的路线

### C1. `gif.js.optimized`

- 相对 `gif.js` 有一些优化，但它并不是真正意义上的“现代新路线”
- 发布和维护也很老

**结论：不建议作为主升级方向。**

### C2. `omggif`

- 生态里仍有使用，但更偏底层/老派工具库
- 不构成对当前项目最优的“现代化替换候选”

**结论：可了解，不建议优先。**

---

## 5. 候选库横向比较

| 方案 | 类型 | 适配浏览器扩展 | 压缩能力 | 工程复杂度 | 适合本项目程度 |
|---|---|---:|---:|---:|---:|
| `modern-gif` | 浏览器内直接编码 | 高 | 中 | 低-中 | 高 |
| `gifenc` | 浏览器内底层编码 | 中-高 | 中 | 中 | 中高 |
| `@skyra/gifenc` | Node/server-side 编码 | 低 | 中 | 中 | 低 |
| `ffmpeg.wasm` | 浏览器 FFmpeg 工具链 | 中 | 高 | 高 | 高 |
| `gifski` | 高质量编码器 | 低（需桥接） | 很高 | 高 | 高（中长期） |
| `gifsicle` | GIF 优化器 | 低（需桥接） | 很高 | 中高 | 高（后处理） |
| `gif.js` | 老牌浏览器编码 | 高 | 低-中 | 低 | 当前基线 |

---

## 6. GitHub 主流项目调研：实际都在用什么

## 6.1 样本选择说明

本节选择的项目都满足至少一项：

- 录屏 / GIF 导出强相关
- 开源且 GitHub 热度较高
- 能通过源码或依赖直接确认其 GIF 技术栈

样本项目：

1. `alyssaxuu/screenity`（17.9k⭐）
2. `wulkano/Kap`（19.1k⭐）
3. `siddharthvaddem/openscreen`（7.7k⭐）
4. `NickeManarin/ScreenToGif`（26.4k⭐）
5. `ShareX/ShareX`（35.8k⭐）

---

## 6.2 `alyssaxuu/screenity`

- 仓库：<https://github.com/alyssaxuu/screenity>
- GitHub 热度：`stargazers_count = 17988`

### 源码证据

1. `package.json` 仍包含：
   - `gif.js: ^0.2.0`
   - `mediabunny: ^1.24.4`
2. `/src/pages/EditorWebCodecs/utils/toGIF.js`：
   - `import GIF from "gif.js";`
   - 明确使用 `workerScript: "/assets/vendor/gif.js/gif.worker.js"`
3. `/src/pages/Editor/utils/toGIF.js`：
   - 传入 `ffmpeg`
   - 通过 `ffmpeg.run(..., output.gif)` 生成 GIF

### 结论

`Screenity` 不是单一路线，而是出现了 **`gif.js` 与 FFmpeg 并存** 的迹象。

这说明什么？

- 即使是非常成功的浏览器录屏扩展，也没有完全把 GIF 技术栈押在一个纯前端 JS 编码器上。
- 随着编辑能力和导出要求变复杂，项目往往会逐步引入更强的视频工具链。

---

## 6.3 `wulkano/Kap`

- 仓库：<https://github.com/wulkano/Kap>
- GitHub 热度：`stargazers_count = 19128`

### 源码证据

1. `package.json` 依赖中包含：
   - `ffmpeg-static`
   - `gifsicle`
2. `/main/converters/process.ts`：
   - `Mode.convert -> ffmpegPath`
   - `Mode.compress -> gifsiclePath`
   - 即：**转换走 ffmpeg，压缩走 gifsicle**

### 结论

Kap 的做法非常有代表性：

> **生成 GIF 不够，后面还要压缩。**

这和当前项目只有 `gif.js` 单库导出相比，最大的差距不是“能不能导出”，而是：

- Kap 的 GIF pipeline 已经天然分成两步
  1. 转换
  2. 压缩

这也是为什么 Kap 这类桌面录屏工具更容易把 GIF 做成稳定能力。

---

## 6.4 `siddharthvaddem/openscreen`

- 仓库：<https://github.com/siddharthvaddem/openscreen>
- GitHub 热度：`stargazers_count = 7742`

### 源码证据

1. `package.json`：
   - `gif.js: ^0.2.0`
   - `mediabunny: ^1.25.1`
2. `/src/lib/exporter/gifExporter.ts`：
   - `import GIF from 'gif.js'`
   - `new URL('gif.js/dist/gif.worker.js', import.meta.url)`
   - 直接构造 `new GIF({...})`

### 结论

OpenScreen 和本项目的技术取向非常接近：

- Electron / Web 技术栈
- GIF 仍由 `gif.js` 承担
- 视频编辑效果先渲染，再喂给 GIF encoder

这意味着：

- `gif.js` 直到 2026 仍然在相关开源项目中被实际使用
- 但也恰恰说明：**很多同类项目也还没有彻底解决“现代 GIF 高质量 + 小体积 + 稳定导出”的问题**

也就是说，`gif.js` 仍在用，不等于它就是最优解。

---

## 6.5 `NickeManarin/ScreenToGif`

- 仓库：<https://github.com/NickeManarin/ScreenToGif>
- GitHub 热度：`stargazers_count = 26477`

### 源码与文档证据

1. README 明确它是专业级 GIF / 视频 / APNG / PSD 导出工具
2. `/ScreenToGif/Util/GifskiInterop.cs`：
   - 明确存在 `GifskiInterop`
   - 说明项目集成了 **Gifski**
3. 相关文档与源码搜索还显示它集成了 **FFmpeg** 路线

### 结论

ScreenToGif 的方向非常清晰：

> **专业 GIF 工具不会只依赖一个“简单 GIF JS encoder”。**

它走的是：
- 自身编码能力
- `Gifski`
- `FFmpeg`

多编码器并存路线。

这也是最值得本项目借鉴的产品思路之一：

- 基础导出和高级导出未必必须共用同一个编码底座
- “高质量 GIF” 与 “快速出图 GIF” 可以是两条不同路径

---

## 6.6 `ShareX/ShareX`

- 仓库：<https://github.com/ShareX/ShareX>
- GitHub 热度：`stargazers_count = 35795`

### 源码证据

1. `/ShareX.HelpersLib/GIF/AnimatedGifCreator.cs`
   - 说明 ShareX 有自带 `AnimatedGifCreator`
2. `/ShareX.ScreenCaptureLib/ScreenRecording/ScreenRecorder.cs`
   - `SaveAsGIF()` 走 `AnimatedGifCreator`
   - `FFmpegEncodeAsGIF()` 使用：
     - `palettegen`
     - `paletteuse`
     - 可配置 `dither`

### 结论

ShareX 也是**双路线甚至多路线**：

- 一条是内建 GIF 编码器
- 一条是 FFmpeg GIF 导出链路

这进一步说明：

- 主流项目并不执着于“只找一个 GIF JS 库”
- 更常见的做法是：**按场景选择不同编码器**

---

## 7. 从 GitHub 生态归纳出的趋势

综合以上项目，可以得出 4 个非常明确的趋势。

### 趋势 1：`gif.js` 仍在被用，但不再是唯一答案

证据：
- `screenity` 使用 `gif.js`
- `openscreen` 使用 `gif.js`

说明：
- 它仍然是“可用的工程基线”
- 但新项目往往会逐步引入别的路线补强

### 趋势 2：成熟项目普遍引入 FFmpeg

证据：
- `screenity` 里已有 FFmpeg 导出路径
- `Kap` 用 `ffmpeg-static`
- `ScreenToGif` 集成 FFmpeg
- `ShareX` 明确有 `FFmpegEncodeAsGIF()`

说明：
- 一旦项目不仅是“做个简单 GIF”，而是处理真实视频导出，FFmpeg 几乎不可避免

### 趋势 3：高质量/小体积 GIF 依赖后处理优化器

证据：
- `Kap` 使用 `gifsicle`
- `ScreenToGif` 使用 `Gifski`
- `ShareX` 使用 FFmpeg palettegen/paletteuse

说明：
- 仅靠“基础编码器”通常无法把质量、体积、速度同时做得好

### 趋势 4：专业工具更倾向“多编码器并存”

证据：
- `ScreenToGif`
- `ShareX`
- `screenity`

说明：
- “快速导出”与“高质量导出”往往不是同一条技术路径
- 这对本项目的路线选择很重要

---

## 8. 对本项目的建议

## 8.1 短期建议：先看 `modern-gif`

如果目标是：
- 找一个比 `gif.js` 更新的浏览器内替代方案
- 尽量保留当前 `Studio -> Worker -> 主线程` 的总体模式
- 不立刻引入巨大包体和重型 wasm

那么建议：

> **先做 `modern-gif` PoC。**

原因：
- 更新、更现代
- 支持 Worker、TypeScript
- 自带 `maxColors`，更接近真正的 GIF 压缩产品需求
- 从产品维度比 `gif.js` 更接近“下一代基线”

## 8.2 中期建议：评估 `ffmpeg.wasm` 路线

如果目标是：
- 做更专业的 GIF 输出
- 和 MP4/WebM 路线统一更多视频处理能力
- 支持 palettegen/paletteuse 等成熟视频转 GIF 参数

那么建议：

> **把 `ffmpeg.wasm` 列为重点专题。**

这条路线虽然重，但更接近行业主流项目的长期解法。

## 8.3 长期建议：单库替换不够，最终要做“双阶段”能力

从 Kap / ScreenToGif / ShareX 的经验看，本项目最终更可能走向：

```text
阶段 1：生成 GIF
阶段 2：优化 GIF（体积 / palette / lossy / dithering / 透明区域）
```

所以真正值得规划的，不是单纯“把 gif.js 换成谁”，而是：

1. **基础导出引擎** 选谁
2. **后处理优化器** 选谁
3. 是否需要“快速导出”和“高质量导出”两种模式

---

## 9. 最终结论

### 9.1 关于“更现代的库还有哪些”

最值得关注的候选顺序建议如下：

1. **`modern-gif`**：最像 `gif.js` 的现代替代者
2. **`gifenc`**：更底层、更可控，但更偏工程能力型
3. **`ffmpeg.wasm`**：不是直接平替，但最值得做长期方案评估
4. **`gifski` / `gifsicle`**：更适合作为高质量/压缩增强链路

### 9.2 关于“主流开源项目都用哪些 GIF 库”

结论不是“大家都用同一个库”，而是：

- 浏览器项目里，`gif.js` 仍在被使用
- 更成熟的桌面/专业工具几乎都会引入：
  - `ffmpeg`
  - `gifsicle`
  - `gifski`
  - 自研编码器
- **行业主流不是单库方案，而是组合式方案**

### 9.3 对本项目的最实用建议

如果要继续走最稳的产品演进路径：

1. **先用 `modern-gif` 做替换性 PoC**
2. **并行调研 `ffmpeg.wasm` 的扩展内可行性**
3. **把 `gifsicle/gifski` 视为后处理优化能力，而不是首个替换对象**

---

## 10. 参考资料

### 10.1 当前仓库内文档

- `/home/runner/work/screen-recorder/screen-recorder/docs/STUDIO-GIF-EXPORT-ASSESSMENT-2026-03.md`
- `/home/runner/work/screen-recorder/screen-recorder/docs/STUDIO-GIF-EXPORT-LOW-RISK-FIX-PLAN-2026-03.md`

### 10.2 候选库

- `modern-gif`: <https://github.com/qq15725/modern-gif>
- `gifenc`: <https://github.com/mattdesl/gifenc>
- `@skyra/gifenc`: <https://github.com/skyra-project/gifenc>
- `ffmpeg.wasm`: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `gifski`: <https://github.com/ImageOptim/gifski>
- `gifsicle`: <https://github.com/kohler/gifsicle>

### 10.3 开源项目样本

- `alyssaxuu/screenity`: <https://github.com/alyssaxuu/screenity>
- `wulkano/Kap`: <https://github.com/wulkano/Kap>
- `siddharthvaddem/openscreen`: <https://github.com/siddharthvaddem/openscreen>
- `NickeManarin/ScreenToGif`: <https://github.com/NickeManarin/ScreenToGif>
- `ShareX/ShareX`: <https://github.com/ShareX/ShareX>
