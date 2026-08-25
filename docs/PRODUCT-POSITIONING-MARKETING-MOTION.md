# Screen Recorder Studio 产品定位：面向落地页与 EDM 的营销动效资产工作台

## 1. 文档信息

- 文档状态：决策稿 v1.0
- 评估日期：2026-08-23
- 适用版本：0.6.12 及后续产品规划
- 配套工程评估：[Element / Area 历史链路端到端评估](./ELEMENT-AREA-RECORDING-E2E-EVALUATION.md)
- 优先实施切片：[“GIF录制 → 选择区域 → Studio”垂直切片评估](./GIF-AREA-RECORDING-VERTICAL-SLICE-EVALUATION.md)
- 媒体与交付专项：[GIF 录制意图的所有权、Studio 与导出优化评估](./GIF-MEDIA-PIPELINE-STUDIO-EXPORT-EVALUATION.md)
- 实施与验收结果：[GIF 区域录制垂直切片实施与端到端验收](./GIF-AREA-RECORDING-IMPLEMENTATION-AND-ACCEPTANCE.md)
- 决策对象：是否继续投入 GIF、区域录制和渠道化导出，以及如何收窄产品定位

## 2. 决策摘要

### 2.1 结论

这条产品方向**合理，但需要改写命题**：

> 不做“又一个支持 GIF 的录屏扩展”，而做“把 SaaS 产品操作快速变成可投放营销动效的本地工作台”。

建议将产品主路径收敛为：

```text
选择产品局部 → 录制一个短流程 → 自动清理与美化 → 按渠道约束导出 → 直接用于 EDM / Landing Page
```

其中：

1. **Area 是优先级最高的录制模式**，因为它直接减少无关像素、浏览器边框和页面噪声，同时显著降低 GIF 体积；
2. **GIF 是 EDM 的一等输出，不是落地页的默认输出**；
3. **落地页默认输出应是 WebM + MP4 + Poster + 嵌入代码**，GIF 仅作为兼容或预览资产；
4. 产品内部应始终保留一份可重复编辑的标准视频母版，“录制 GIF”只是面向用户的快捷任务，不应成为独立采集管线；
5. Element Capture 暂不作为近期承诺，后续可以用“智能选中元素并转成 Area”的方式渐进提供。

### 2.2 决策边界

| 决策项 | 结论 | 原因 |
|---|---|---|
| 继续打磨通用 Tab / Window / Screen 录制 | 维持，不作为增长主叙事 | 市场成熟且同质化严重 |
| 拾起 Area 录制 | **Go** | 与短营销动效的聚焦、体积和构图直接相关 |
| 原样恢复旧 Element / Area 管线 | **No-go** | 历史入口、状态、存储和收尾链路均已断裂 |
| 强化 GIF 导出 | **Go，有条件** | 必须转成渠道预算驱动，而不是暴露更多编码参数 |
| 用 GIF 作为 Landing 默认格式 | **No-go** | 同画面下视频格式通常小一个数量级 |
| 近期恢复 Element Capture | Later | 平台约束和动态 DOM 边界明显，价值可先由 Area 覆盖 |
| 进入云托管、链接分享、互动分析 | 暂不进入 | 会把产品带入 Loom / Arcade / Supademo 的另一条重资产战线 |

## 3. 为什么不能继续定位为“通用录屏工具”

### 3.1 市场信号

截至 2026-08-23，Chrome Web Store 可见：

| 产品 | 已被验证的主战场 | 商店用户量 | 对本项目的含义 |
|---|---|---:|---|
| Loom | 异步视频沟通、云链接、评论协作 | 7,000,000 | “录制并分享”已经有强网络效应玩家 |
| Screencastify | 教育、视频创作、互动问题 | 6,000,000 | 通用录屏和教学场景已高度成熟 |
| Screenity | 免费、开源、隐私、本地录制、区域录制、多格式导出 | 200,000 | “本地 + 开源 + Area + GIF”本身也不是独占差异点 |
| Screen Recorder Studio | 本地录制、Studio 编辑、MP4 / WebM / GIF | 131 | 当前宽泛描述尚未形成清晰心智和分发优势 |

这些数字是渠道快照，不等同于完整市场份额，但足以支持一个判断：**继续横向补齐录屏功能，不会自然形成定位**。

### 3.2 真正接近的竞争对象

若目标用户是 SaaS 营销、增长和产品发布团队，实际竞争对象不只包括录屏扩展，还包括：

- Arcade、Supademo 一类互动 Demo 工具；
- Screen Studio、Camtasia 一类后期美化工具；
- Figma / After Effects / 剪辑软件的人工制作流程；
- “截图 + 文案”这种最便宜的替代方案。

Supademo 已明确把 MP4 / 循环 GIF 输出用于 Email 和 Landing Page；Arcade 则围绕落地页、销售跟进、互动嵌入、品牌与分析提供完整工作流。说明“产品 Demo 用于 GTM 内容”是存在的需求，但也说明本项目不能只卖一个格式按钮。

## 4. 目标用户与待办任务

### 4.1 核心 ICP

优先用户：

- 1～50 人 SaaS 团队中的 Product Marketing、Growth、Founder、产品经理；
- 每周或每月需要发布功能、更新日志、生命周期邮件和落地页；
- 没有专职动效设计师，或不愿为一个 5 秒产品片段启动完整剪辑流程；
- 对未发布功能、客户数据或后台页面有本地处理诉求。

不优先用户：

- 以摄像头、麦克风和异步沟通为核心的团队；
- 需要 10～60 分钟教程、课堂录制或会议替代的用户；
- 需要云链接、评论、观众分析和团队内容库的企业；
- 需要复杂多轨剪辑、字幕和音频制作的专业创作者。

### 4.2 核心 Jobs To Be Done

1. 当我要发布一个新功能时，我希望在几分钟内做出一个短、清楚、能直接放到页面或邮件里的产品动效，而不必学习视频剪辑。
2. 当页面含有客户信息或内部功能时，我希望录制、编辑、导出都在本地完成。
3. 当同一段操作要投放到不同渠道时，我希望工具自动处理尺寸、格式、体积和兼容回退，而不是让我理解编码器参数。
4. 当收件人只看到第一帧或启用了减少动态效果时，我仍希望核心信息和 CTA 可理解。

## 5. 定位陈述

### 5.1 内部定位

> 面向需要持续发布 SaaS 功能的产品营销与增长团队，Screen Recorder Studio 是一个本地优先的营销动效资产工作台。它把网页中的一个重点区域快速变成适配 Email 与 Landing Page 的轻量、品牌化输出包。与通用录屏工具相比，它优化的是“投放成品”；与互动 Demo 平台相比，它无需上传、账号和托管，也不会把用户锁进专有播放器。

### 5.2 对外一句话

中文：

> 录下产品重点，几分钟导出可直接投放的邮件 GIF 和落地页动效。

英文候选：

> Turn a focused product flow into email- and landing-ready motion — locally.

### 5.3 建议的商店副标题

> Area recorder and local motion studio for SaaS emails, launches, and landing pages.

短期不建议立刻更名。应先用商店副标题、首屏截图、预设和 onboarding 验证新心智，再决定是否从 `Screen Recorder Studio` 迁移到更强调 Product Motion 的品牌名。

## 6. 核心价值支柱

### 6.1 Focus：只录产品重点

- Area 是默认推荐模式；
- Tab 是兼容和长流程模式；
- 自动避开浏览器边框、侧栏、通知和无关空白；
- 通过裁剪减少像素数量，从源头改善 GIF 体积和信息密度。

### 6.2 Finish：自动得到“像成品”的画面

- 短流程修剪；
- 点击聚焦或轻量缩放；
- 背景、圆角、阴影、留白和品牌色；
- 首帧与末帧停留；
- 可选 CTA / Play 徽标；
- 默认无声，避免把通用视频编辑功能带入主路径。

### 6.3 Fit：按渠道预算交付

用户选择的应该是“Email”或“Landing Page”，而不是 workers、dither、quality 之类实现参数。

- Email：按体积预算自动调节时长、分辨率、帧率和颜色；
- Landing：自动生成现代视频格式、poster 和嵌入片段；
- 超预算时给出可解释的优化建议，并支持一键应用；
- 导出前就显示“可投放 / 需优化”，而不是导出后才发现文件不可用。

### 6.4 Local：本地与可携带

- 录制、编辑和导出留在浏览器本地；
- 不强制登录或上传；
- 输出是标准文件和代码片段，不依赖专有播放器；
- 以隐私和可携带性区分托管式互动 Demo，但不把“隐私”作为唯一卖点。

## 7. 渠道成品定义

### 7.1 Email Safe GIF

建议把以下内容固化成产品预设，而不是文档提示：

| 项目 | 建议默认值 | 产品行为 |
|---|---:|---|
| 宽度 | 480～600 px | 与常见邮件内容列匹配 |
| 时长 | 3～6 秒 | 超过后提示裁短或拆分 |
| 帧率 | 6～10 fps | UI 操作优先保留关键变化帧 |
| 体积目标 | ≤ 1 MB | 作为“Email Safe”绿色门槛 |
| 循环 | 2～3 次 | 不再默认无限循环 |
| 第一帧 | 独立可读 | 兼容只显示第一帧的客户端 |
| 静态回退 | 同步导出 PNG | 保留标题、价值点或 CTA |
| 无障碍 | 禁止高频闪烁 | 导出前做基础提示或检测 |

Litmus 建议邮件 GIF 尽量不超过 1 MB；Mailchimp 指出部分 Outlook 版本只显示第一帧。因此“第一帧设计”和“体积预算”必须是核心产品能力，而不是高级设置。

当前统一导出弹窗已经支持 GIF 帧率、质量、缩放、worker、抖动和体积区间估算，但默认仍是 `10 fps / quality 10 / 75% / 无限循环`，且没有渠道预算闭环。真实产物测试中：

- 64.60 秒、1440×810、647 帧的 GIF 为 107,141,128 bytes；
- 7.74 秒、1440×810、78 帧的高运动 GIF 仍为 40,497,763 bytes。

这说明“导得出来”与“能用于 EDM”是两套验收标准。

### 7.2 Landing Motion Pack

默认输出包：

```text
feature-demo.webm
feature-demo.mp4
feature-demo-poster.webp
embed.html
README.txt（尺寸、体积、推荐用法）
```

推荐嵌入模板：

```html
<video autoplay muted loop playsinline poster="feature-demo-poster.webp">
  <source src="feature-demo.webm" type="video/webm">
  <source src="feature-demo.mp4" type="video/mp4">
</video>
```

产品还应提供：

- `prefers-reduced-motion` 回退示例；
- 懒加载建议；
- 可配置有限循环或暂停按钮；
- 预计下载体积和移动网络提示；
- GIF 仅作为可选兼容资产。

web.dev 的示例中，同一动画为 3.7 MB GIF、551 KB MP4 和 341 KB WebM，验证了 Landing 默认使用视频的必要性。W3C WCAG 2.2 还要求：自动开始、持续超过 5 秒且与其他内容并行的移动内容，应提供暂停、停止或隐藏机制。因此 Landing 预设不能只生成一个无限自动播放的文件。

### 7.3 统一母版原则

```text
一次录制（高质量视频母版）
  ├─ Email Safe GIF + fallback PNG
  ├─ Landing WebM + MP4 + poster + snippet
  └─ 后续其他渠道预设
```

不要新增一条“直接录 GIF”的底层链路。GIF 需要反复降帧、缩放、调色和试探体积，只有保留标准视频母版才能做到非破坏性重导出。

## 8. Area 在定位中的战略作用

Area 不是录制模式列表里的第四个按钮，而是这次定位成立的关键输入能力：

1. **聚焦叙事**：短营销动效通常只需展示一个组件或一段产品流程；
2. **压缩成本**：GIF 体积近似随像素数和变化帧增长，缩小录制区域比导出后盲目降质更有效；
3. **构图稳定**：输出可以直接匹配邮件列宽和 Landing 卡片比例；
4. **隐私控制**：用户可以主动排除导航、账号信息和其他客户内容；
5. **后期简化**：减少 Studio 再次裁剪的必要性，缩短完成时间。

近期应明确 Area 的语义是“固定视口区域”：页面滚动时，录制的是该屏幕位置经过的内容，而不是跟随某个 DOM 节点。跟随元素属于另一个产品承诺。

## 9. 功能优先级

### 9.1 Must：定位成立所需

- action 中的 Area 录制入口；
- 可靠、失败关闭的区域裁剪链路；
- 3～10 秒短流程的顺滑修剪；
- Email Safe GIF 预设与 1 MB 预算优化；
- 第一帧回退预览和 PNG 输出；
- Landing Motion Pack；
- 录制母版保留与重复导出；
- 导出结果的实际体积校验，而不只是估算。

### 9.2 Should：形成成品感

- 首尾停留；
- 自动识别静止段并建议删除；
- CTA / Play 徽标；
- 品牌背景与预设复用；
- 一键复制 `<video>` 片段；
- 导出历史中标记目标渠道和预算结果。

### 9.3 Later：有需求证据后再做

- “智能选择元素”，底层仍转成 Area；
- Element Capture 原生 API 加速；
- 多片段拼接；
- 团队品牌模板；
- 可选托管、链接和基础分析。

### 9.4 明确非目标

- 会议和异步视频沟通；
- 摄像头主持人、复杂音频和字幕；
- 长教程录制；
- 互动 Demo 编辑器；
- 完整 DAM / 云内容库；
- 通用专业视频剪辑器。

## 10. 建议的主体验

```text
点击 action
  → 选择「录制区域」
  → 在页面拖拽并确认
  → 倒计时与短流程录制
  → Studio 自动打开
  → 选择「Email」或「Landing」
  → 自动应用渠道预设并显示预算状态
  → 一键优化 / 导出成品包
```

关键交互原则：

- 先让用户选择用途，低级编码参数收进“高级”；
- 导出页用“适合邮件”“超出预算 620 KB”等结果语言；
- 失败时不给出错误的全屏录制作为降级结果；
- Area 选择、暂停、停止和 Studio 交接必须共享同一个录制会话状态；
- 允许重新裁切或重导出，不要求用户重新录制。

## 11. 衡量方式

### 11.1 北极星指标

> 每周成功生成并通过目标渠道预算校验的动效资产数。

“开始录制次数”不适合作为核心指标，因为它无法区分试用、失败和真正投放。

### 11.2 核心漏斗

```text
选择 Area
→ 完成录制
→ 打开 Studio
→ 选择渠道预设
→ 首次导出成功
→ 通过体积 / 格式校验
→ 7 天内再次创作
```

建议埋点：

- `area_selection_started / confirmed / cancelled / failed`；
- `recording_started / finalized / failed`，并携带统一 `operationId`；
- `preset_selected(email|landing)`；
- `budget_passed_first_try`；
- `auto_optimize_applied`；
- `export_completed` 的格式、尺寸、时长、体积区间；
- 从点击 action 到获得成品的总耗时。

本地优先不等于完全没有产品分析；可以采用默认关闭、明确同意、仅上传匿名事件的方式验证定位，也可以先通过访谈和手工可用性测试完成早期验证。

## 12. 分阶段验证建议

### 阶段 A：先验证任务，不扩功能面

- 访谈 8～12 位 SaaS PMM、Growth 或 Founder；
- 收集他们最近实际投放的 Email / Landing 动效；
- 用现有 Studio 加人工操作完成 15～20 个真实任务；
- 验证 Area、时长、体积、第一帧和品牌样式是否真是高频阻力。

### 阶段 B：做最小渠道闭环

- 只上线 Area + Email Safe + Landing Pack；
- Element、云托管、互动和音频全部延后；
- 目标是首次用户在 3 分钟左右获得一份可投放资产，而不是展示更多设置项。

### 阶段 C：用结果决定扩张

建议的继续投入信号：

- 多数目标用户无需解释就选择 Area；
- Email GIF 首次或一键优化后能稳定进入预算；
- 用户会为同一母版导出多个渠道版本；
- 一周内出现重复创作，而不只是一次尝鲜；
- 用户主动要求品牌模板、批量输出或团队复用。

若用户主要把产品当成普通录屏，或最终仍回到其他剪辑工具完成交付，应重新评估定位，而不是继续堆叠录制模式。

## 13. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 高运动 UI 很难压到 1 MB | Email 预设经常失败 | 关键帧采样、局部 Area、限时、减色，并允许拆成两个片段 |
| “Landing + GIF”造成错误心智 | 页面性能恶化 | Landing 默认只推荐视频包，明确显示 GIF 体积差异 |
| Area 恢复拖累录制稳定性 | 破坏现有主链路 | 复用当前 offscreen 管线，旧链路不原样复活 |
| 定位过窄导致流量下降 | 获取量变小 | 保留通用录制能力，但商店叙事和 onboarding 聚焦高价值场景 |
| 本地产品缺少分享与分析 | 对 GTM 团队价值不足 | 先以文件可携带、隐私和速度切入；有需求证据后再做可选托管 |
| 区域选择在特殊页面不可用 | 体验不一致 | 受保护页面明确禁用并解释，提供 Tab 录制后在 Studio 裁剪 |

## 14. 最终建议

未来一阶段的资源排序建议是：

1. 先把 Area 作为当前统一录制主干的一种输入方式稳定恢复；
2. 同步把 GIF 导出从“参数面板”改造成“Email Safe 成品流程”；
3. 为 Landing 输出视频包而不是继续优化大 GIF；
4. 用真实渠道成品和重复使用率验证定位；
5. Element 只在 Area 已稳定且用户明确需要“自动跟随 DOM 元素”后再投入。

这是一条从“技术功能竞争”转向“任务结果竞争”的路线。Area 是必要能力，GIF 是重要格式，但真正的产品是**从网页操作到可投放营销资产的最短可靠路径**。

## 15. 外部资料

以下资料均于 2026-08-23 访问：

- [Loom Chrome Web Store](https://chromewebstore.google.com/detail/loom-%E2%80%93-screen-recorder-sc/liecbddmkiiihnedobmlmillhodjkdmb?hl=en-GB)
- [Screencastify Chrome Web Store](https://chromewebstore.google.com/detail/screencastify-screen-vide/mmeijimgabbpbgpdklnllpncmdofkcpn)
- [Screenity Chrome Web Store](https://chromewebstore.google.com/detail/screenity-screen-recorder/kbbdabhdfibnancpjfhlkhafgdilcnji?hl=en)
- [Screen Recorder Studio Chrome Web Store](https://chromewebstore.google.com/detail/screen-recorder-studio-un/bondbeldfibfmdjlcnomlaooklacmfpa)
- [Supademo：Share, Embed, Export](https://supademo.com/features/sharing)
- [Arcade：Interactive Demo](https://docs.arcade.software/kb/build/interactive-demo)
- [Arcade：Embeds and Email](https://docs.arcade.software/kb/build/interactive-demo/share/how-to-embed-your-arcades)
- [Litmus：Animated GIFs in Email](https://www.litmus.com/blog/a-guide-to-animated-gifs-in-email)
- [Mailchimp：Animated GIFs in Email](https://mailchimp.com/resources/how-to-make-the-most-out-of-email-gifs/)
- [web.dev：Replace animated GIFs with video](https://web.dev/articles/replace-gifs-with-videos)
- [W3C WCAG 2.2：Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)

## 16. 工程内证据

- 当前 GIF 默认和参数：[UnifiedExportDialog.svelte](../packages/extension/src/lib/components/UnifiedExportDialog.svelte)
- 真实 GIF 体积样本：[gif-export-estimate.test.ts](../packages/extension/src/lib/export/gif-export-estimate.test.ts)
- 0.6.12 真实导出记录：[EXECUTION-REPORT-0.6.12-20260816.md](./recording-e2e-test-suite/EXECUTION-REPORT-0.6.12-20260816.md)
- 当前 action 入口：[popup/+page.svelte](../packages/extension/src/routes/popup/+page.svelte)
