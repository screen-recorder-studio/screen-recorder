# Action 入口到 Studio 工作台技术设计文档

## 1. 文档信息

- 项目：Screen Recorder Studio
- 文档类型：技术设计文档
- 关联文档：
  - `/home/runner/work/screen-recorder/screen-recorder/docs/action-entry-retention-evaluation.md`
  - `/home/runner/work/screen-recorder/screen-recorder/docs/action-entry-product-design.md`
- 设计范围：
  1. Action 菜单入口改造
  2. Drive 直达能力
  3. Studio 直达最近录制能力
  4. Studio 空状态
  5. Studio 内嵌 Drive 抽屉
- 约束条件：
  - 本项目为 Chrome Extension MV3
  - 基于 SvelteKit + `sveltekit-adapter-chrome-extension`
  - 当前页面以独立 route 预渲染为独立 HTML
  - OPFS 为录制资产唯一真实来源

---

## 2. 目标与非目标

## 2.1 技术目标

本设计需要在**尽量少改动现有录制主链路**的前提下，实现以下能力：

1. 用户点击浏览器 action 后，优先进入一个轻量 launcher，而不是直接进入 `control.html`
2. Launcher 中可直达：
   - 录制 Control
   - Drive
   - Studio
3. 当 Studio 无 `id` 参数时，能够自动打开最近一条可用录制
4. 当不存在可用录制时，Studio 渲染空状态而不是空白预览区
5. 在 Studio 中以内嵌抽屉方式展示 Drive 列表，支持切换当前编辑对象

## 2.2 非目标

本次技术设计**不包含**：

1. 录制协议或编码链路重写
2. OPFS 文件格式修改
3. Studio 解码 / 渲染性能优化
4. 导出链路重构
5. 账号体系、云同步、远程存储

---

## 3. 当前实现基线

## 3.1 Action 当前入口

当前实现位于：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/extensions/background.ts`
- `chrome.action.onClicked.addListener(...)`

现状：

1. action 点击后由 background 主动打开 `control.html`
2. 使用 `chrome.windows.create({ type: 'popup' })`
3. 维护 `controlWinId`，实现窗口复用与聚焦

结论：

- 当前 action 不是原生 popup launcher
- 当前入口偏“直接执行录制任务”
- 不适合承载多任务分流

## 3.2 现有页面能力

### 已存在页面

预渲染 route 已包含：

- `/popup`
- `/control`
- `/drive`
- `/studio`

配置来源：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/svelte.config.js`

结论：

- 无需新增框架级路由能力
- 技术上可以复用 `/popup` 作为 action launcher
- 也可以新增单独 launcher route，但从最小改动原则看，优先复用 `/popup`

## 3.3 Drive 当前实现

Drive 页面位于：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/drive/+page.svelte`

核心能力：

1. 遍历 OPFS 根目录下 `rec_*` 目录
2. 读取 `meta.json`
3. 生成 `RecordingSummary`
4. 以创建时间倒序排序
5. 删除录制
6. 打开指定 `studio.html?id=...`

结论：

- “最近录制”的判定逻辑已基本存在
- 但当前逻辑直接写在 Drive 页面中，尚未抽出为共享能力

## 3.4 Studio 当前实现

Studio 页面位于：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/studio/+page.svelte`

现状：

1. 通过 URL 参数 `id` 加载指定录制
2. 基于 `OPFSReaderWorker` 拉取 summary 与 range 数据
3. 预览区依赖 `workerEncodedChunks`
4. 顶部已有 Drive 按钮，但行为是 `window.open("/drive.html", "_blank")`
5. 当没有 `id` 或没有 chunks 时，没有完整空状态

结论：

- Studio 当前更像“指定录制编辑页”
- 还不是“可直接进入的工作台”

## 3.5 Drive 组件化现状

已存在组件：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/drive/RecordingList.svelte`
- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/components/drive/RecordingCard.svelte`

现状问题：

1. `RecordingList` 仍假设自己处于 Drive 页面上下文
2. 选择、批量删除、顶部操作栏均为页面式设计
3. `RecordingCard` 内的“编辑”行为是打开新页 Studio，而不是回调式选择

结论：

- 可以复用
- 但需要轻量改造成“可嵌入模式”

---

## 4. 总体技术方案

## 4.1 方案概览

本次建议采用以下总体方案：

1. **将 action 切换为原生 popup launcher**
2. **复用现有 `/popup` 页作为 launcher UI**
3. **将 Drive 的 OPFS 枚举逻辑抽取为共享 utility**
4. **在 background 中增加“打开最近录制 / 打开 Drive”的消息处理**
5. **让 Studio 在无 `id` 时支持 fallback 到最近录制**
6. **在 Studio 页面内部增加显式空状态与 Drive 抽屉**

## 4.2 设计原则

1. **录制主链路不动**
   - `control.html` 继续承担录制控制面板职责
2. **入口重构优先于核心逻辑重构**
   - 只改变入口与页面组织方式
3. **共享 OPFS 查询逻辑**
   - 避免 Drive 与 Studio 各自维护一份“最近录制”算法
4. **页面内状态优先**
   - Studio 空状态和抽屉尽量由页面本身控制，不新增复杂全局 store
5. **新增消息最少化**
   - 尽量让 background 负责“页面打开”
   - 页面负责“数据渲染”

---

## 5. 目标架构

## 5.1 页面级架构

```text
Chrome Action
  ↓
popup.html (Launcher)
  ├─ Record → background → open/focus control.html
  ├─ Drive  → background or page direct open → drive.html
  └─ Studio → background → resolve latest recording → studio.html?id=... / studio.html

studio.html
  ├─ load by id
  ├─ fallback to latest recording
  ├─ render empty state
  └─ open embedded drive drawer

drive.html
  └─ use shared OPFS recording loader
```

## 5.2 模块级架构

建议新增一层共享工具：

```text
src/lib/utils/opfs-recordings.ts
  ├─ listRecordings()
  ├─ getLatestValidRecording()
  ├─ readRecordingSummary()
  └─ invalidateRecordingsCache()
```

调用关系：

```text
Drive page ─────┐
                ├─> opfs-recordings.ts
Studio page ────┤
Background* ────┘
```

说明：

- Background 不能直接访问页面上下文的 DOM，但可以在扩展页面里通过打开页面完成分发；
- 若 background 直接访问 OPFS 成本较高或上下文不稳定，可改为：
  - popup 触发打开 `studio.html`
  - `studio.html` 自行完成最近录制 fallback
- 本文推荐采用“**background 负责打开，studio 负责兜底**”的双保险设计。

---

## 6. 详细技术设计

## 6.1 Action Launcher 设计

## 6.1.1 路由策略

推荐方案：

- 保留 `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/routes/popup/+page.svelte`
- 将其从“迷你录制面板”改造成“launcher”
- 在 manifest 中把 action 入口改为 popup 页面

原因：

1. 已有预渲染 route
2. 命名与浏览器扩展 popup 语义一致
3. 避免新增 route 带来的重复维护

## 6.1.2 Manifest 调整方向

当前：

- `manifest.json` 只有 `action.default_title`
- action 点击由 background 捕获并开 `control.html`

目标：

- `action.default_popup = "popup.html"`
- background 中保留 Control 打开能力，但不再作为默认点击行为

注意：

- 这是后续实现方案，本次文档不修改代码
- 如果为兼容旧行为需要阶段性保留 `onClicked`，需明确避免 popup 与 onClicked 双重触发冲突

## 6.1.3 Launcher 行为

Launcher 只做三件事：

1. 打开 / 聚焦录制窗口
2. 打开 Drive
3. 打开 Studio 最近录制

不做：

1. 录制模式切换
2. 录制状态全量展示
3. 历史资产预览

### 建议事件流

```text
popup button click
  → chrome.runtime.sendMessage({ type: 'OPEN_CONTROL_WINDOW' })
  → chrome.runtime.sendMessage({ type: 'OPEN_DRIVE' })
  → chrome.runtime.sendMessage({ type: 'OPEN_LATEST_RECORDING' })
```

注：

- 若希望尽量少加消息，Drive 也可以由 popup 直接 `window.open('/drive.html', '_blank')`
- 但从职责统一角度，建议打开新页面的行为都由 background 控制

---

## 6.2 Background 扩展设计

## 6.2.1 目标职责

background 需要承担以下新职责：

1. 统一打开 / 聚焦 Control
2. 统一打开 Drive
3. 打开最近录制对应的 Studio
4. 在录制完成后使最近录制缓存失效

## 6.2.2 推荐新增消息

建议新增以下 runtime message：

### `OPEN_CONTROL_WINDOW`

职责：

- 复用现有 `controlWinId` 管理逻辑
- 等价于当前 `chrome.action.onClicked` 的开窗能力

返回：

```ts
{ ok: true }
```

### `OPEN_DRIVE`

职责：

- 打开或聚焦 Drive 页面

返回：

```ts
{ ok: true }
```

### `GET_LATEST_RECORDING`

职责：

- 返回最近一条可用录制摘要

返回：

```ts
{ ok: true, recording: RecordingSummary | null }
```

### `OPEN_LATEST_RECORDING`

职责：

- 直接打开最近录制
- 若不存在则打开空态 Studio

返回：

```ts
{ ok: true, opened: 'studio-latest' | 'studio-empty' }
```

## 6.2.3 类型定义位置

当前仓库存在：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/types/background.d.ts`

建议：

1. 不要把无关配置类型继续堆进这里
2. 为 background 消息新增独立消息类型定义，优先考虑：
   - 继续在现有类型文件中扩展“消息类型”
   - 或新建 `/src/lib/types/runtime-messages.ts`

推荐后者，原因是职责更清晰。

## 6.2.4 Control 打开逻辑复用

现有 `background.ts` 已有成熟的 `controlWinId` 复用逻辑。  
实现时应将其从 `chrome.action.onClicked` 回调内抽成可复用函数，例如：

```ts
async function openOrFocusControlWindow(): Promise<void>
```

这样可被：

1. Action Launcher 的“录制”按钮复用
2. Studio 空状态的“开始录制”按钮复用
3. 后续欢迎页等其他入口复用

## 6.2.5 最近录制缓存

为减少重复扫描 OPFS，建议增加轻量缓存：

```ts
type LatestRecordingCache = {
  value: RecordingSummary | null
  updatedAt: number
}
```

建议：

- TTL：30~60 秒
- 在 `OPFS_RECORDING_READY` 时主动失效
- 在删除录制后由页面触发失效

原因：

- Launcher 和 Studio fallback 可能频繁读取最近录制
- 每次遍历 OPFS 都会增加页面响应时间

---

## 6.3 OPFS 共享查询层设计

## 6.3.1 为什么需要抽取

当前 Drive 页面把以下逻辑写在页面内：

1. 遍历根目录
2. 过滤 `rec_*`
3. 读取 `meta.json`
4. 推导 size / duration / fps
5. 排序

这些逻辑后续也会被以下功能使用：

1. Action Launcher “最近录制摘要”
2. Studio fallback
3. Studio Drawer 列表
4. Drive 正常页面

如果不抽取，会出现：

- 逻辑重复
- “最近录制”判定标准不一致
- 修复时多处同步

## 6.3.2 建议新增文件

建议新增：

- `/home/runner/work/screen-recorder/screen-recorder/packages/extension/src/lib/utils/opfs-recordings.ts`

## 6.3.3 建议导出能力

### `listRecordings()`

职责：

- 列出所有可识别录制
- 与 Drive 当前排序逻辑一致

```ts
async function listRecordings(): Promise<RecordingSummary[]>
```

### `getLatestValidRecording()`

职责：

- 返回排序后的第一条可用录制

```ts
async function getLatestValidRecording(): Promise<RecordingSummary | null>
```

### `invalidateRecordingsCache()`

职责：

- 清理本地缓存

```ts
function invalidateRecordingsCache(): void
```

### `isRecordingUsable(summary)`

职责：

- 统一“可用录制”标准

建议标准：

1. 有 `meta.json`
2. 目录可访问
3. 必须文件存在：
   - `data.bin`
   - `index.jsonl`
4. duration / chunks 不为显著非法值

## 6.3.4 数据模型

建议把 `RecordingSummary` 类型也抽离到共享定义，避免 page 内重复声明。

推荐位置：

- `/src/lib/types/recording.ts`

至少包含：

```ts
interface RecordingSummary {
  id: string
  displayName: string
  createdAt: number
  duration: number
  resolution: string
  size: number
  totalChunks: number
  codec?: string
  fps?: number
  thumbnail?: string
  meta?: any
}
```

---

## 6.4 Studio 页面设计

## 6.4.1 入口模式

Studio 应支持两种打开方式：

### 模式 A：带 `id`

URL：

```text
/studio.html?id=rec_xxx
```

行为：

- 直接加载指定录制
- 若读取失败，进入“录制不可读取”空状态

### 模式 B：不带 `id`

URL：

```text
/studio.html
```

行为：

1. 先尝试获取最近一条可用录制
2. 若存在，则自动装载
3. 若不存在，则渲染空状态

## 6.4.2 初始化状态设计

建议在 `+page.svelte` 内新增页面级状态：

```ts
let currentRecordingId = $state<string>('')
let showEmptyState = $state(false)
let emptyStateReason = $state<'no-recording' | 'invalid-recording' | 'opfs-unavailable' | 'load-failed'>('no-recording')
let isResolvingInitialRecording = $state(true)
let showDriveDrawer = $state(false)
let drawerRecordings = $state<RecordingSummary[]>([])
let drawerLoading = $state(false)
let drawerError = $state('')
```

## 6.4.3 初始化流程

```text
onMount
  → parse location.search
  → if id exists:
       load by id
     else:
       getLatestValidRecording()
         → found: set currentRecordingId and load
         → not found: showEmptyState = true
```

## 6.4.4 加载职责拆分

当前 Studio 把“读 URL、建 worker、处理返回”集中在页面中。  
建议继续保留这一结构，但增加“初始化录制决策层”：

### 层 1：录制决策层

职责：

- 解析 `id`
- fallback 到最近录制
- 决定空状态原因

### 层 2：录制加载层

职责：

- 初始化 `OPFSReaderWorker`
- 拉取 summary / range
- 维护 `workerEncodedChunks`

好处：

- 让无录制空状态与 worker 生命周期解耦
- 避免页面在无 `id` 时仍强行初始化 worker

## 6.4.5 空状态渲染

建议在 Studio 主内容区域分支渲染：

```svelte
{#if isResolvingInitialRecording}
  <StudioLoadingState />
{:else if showEmptyState}
  <StudioEmptyState ... />
{:else}
  <VideoPreviewComposite ... />
{/if}
```

### 推荐新增组件

- `/src/lib/components/studio/StudioEmptyState.svelte`

原因：

- 空状态具有明确独立职责
- 后续可复用不同 reason 文案

### 组件 Props 建议

```ts
interface StudioEmptyStateProps {
  reason: 'no-recording' | 'invalid-recording' | 'opfs-unavailable' | 'load-failed'
  onStartRecording: () => void
  onOpenDrive: () => void
}
```

## 6.4.6 当前录制切换

当用户在 Drawer 中点击另一条录制时：

```text
click recording item
  → close current reader worker
  → reset workerEncodedChunks
  → set currentRecordingId
  → replace history or pushState with ?id=newId
  → re-run studio load pipeline
```

推荐使用：

```ts
history.replaceState(null, '', `/studio.html?id=${encodeURIComponent(id)}`)
```

原因：

- 当前是在同一个工作台上下文切换视频
- 不应该污染大量浏览器历史栈

---

## 6.5 Studio Drawer 设计

## 6.5.1 目标

让 Studio 在当前页面内展示“最近录制切换器”，而不是打开一个新页。

## 6.5.2 形态

推荐：

- 右侧抽屉
- 覆盖在预览区上方
- 保留遮罩与关闭按钮

## 6.5.3 组件策略

不建议直接把现有 `RecordingList.svelte` 原样塞进 Studio。  
推荐两种方案：

### 方案 A：轻改 `RecordingList`

新增 props：

```ts
drawerMode?: boolean
onSelectRecording?: (recording: RecordingSummary) => void
selectedRecordingId?: string
hideBatchActions?: boolean
```

优点：

- 复用最多

缺点：

- 组件复杂度升高

### 方案 B：抽出更底层列表组件

拆成：

1. `RecordingGallery.svelte`
2. Drive page 作为页面容器
3. Studio drawer 作为轻量容器

优点：

- 职责更干净

缺点：

- 初次改造工作量更大

### 推荐

**第一阶段采用方案 A**。  
原因是本次核心目标是入口重构，不是组件体系重构。

## 6.5.4 Drawer 数据来源

Drawer 不应自行复制 Drive 页面整套读取逻辑。  
应复用 `listRecordings()`。

打开抽屉时：

```text
open drawer
  → drawerLoading = true
  → listRecordings()
  → render list
```

删除录制后：

```text
delete recording
  → invalidateRecordingsCache()
  → reload drawer list
  → if deleted current recording:
       pick next latest usable
       else show empty state
```

---

## 6.6 Drive 页面改造设计

Drive 页面本次无需体验重构，但需要做一项结构性调整：

### 目标

将当前页面内的 OPFS 列表逻辑迁移到共享层。

### 调整方式

当前：

- `+page.svelte` 内实现 `loadRecordings / readMetaJson / createRecordingSummary`

目标：

- 页面只做：
  - 状态管理
  - 删除操作
  - 调用共享 `listRecordings()`

这样可以保证：

1. Drive 与 Studio Drawer 列表一致
2. 最近录制判断一致
3. 后续任何录制元数据修复只改一处

---

## 7. 关键数据流设计

## 7.1 Action → Control

```text
popup click "Record"
  → send OPEN_CONTROL_WINDOW
  → background openOrFocusControlWindow()
  → control.html opened/focused
```

## 7.2 Action → Drive

```text
popup click "Drive"
  → send OPEN_DRIVE
  → background opens drive.html
```

## 7.3 Action → Studio 最近录制

```text
popup click "Studio"
  → send OPEN_LATEST_RECORDING
  → background getLatestValidRecording()
     → found    → open studio.html?id=...
     → notfound → open studio.html
```

## 7.4 Studio 无 id 自恢复

```text
studio onMount
  → no id in URL
  → getLatestValidRecording()
     → found    → load recording
     → notfound → showEmptyState
```

## 7.5 录制完成后刷新最近录制

```text
OPFS_RECORDING_READY
  → background invalidates recording cache
  → background opens studio.html?id=recordingId
```

## 7.6 Studio 内切换录制

```text
drawer select recording
  → close current worker
  → set currentRecordingId
  → replaceState(?id=selectedId)
  → init new worker
  → render new preview
```

---

## 8. 状态机与边界处理

## 8.1 Action Launcher 状态

最小状态：

```ts
type LauncherState =
  | 'idle'
  | 'opening-control'
  | 'opening-drive'
  | 'opening-studio'
```

原则：

- Launcher 不保留复杂异步状态
- 点击后优先关闭 popup，后续交由 background

## 8.2 Studio 页面状态

```ts
type StudioShellState =
  | 'resolving'
  | 'ready'
  | 'empty'
  | 'error'
```

### `resolving`

- 正在解析 id / 最近录制

### `ready`

- 已有合法录制并进入编辑态

### `empty`

- 无录制或不可恢复

### `error`

- 发生明确页面错误，但仍可回退到空状态

## 8.3 空状态 reason

```ts
type EmptyStateReason =
  | 'no-recording'
  | 'invalid-recording'
  | 'opfs-unavailable'
  | 'load-failed'
```

对应场景：

- `no-recording`：没有任何录制
- `invalid-recording`：存在目录但都不可用
- `opfs-unavailable`：浏览器环境不支持
- `load-failed`：指定 id 加载失败

## 8.4 当前录制被删除

需要支持两种场景：

1. 在 Drive page 删除
2. 在 Studio Drawer 删除

若当前 Studio 正在编辑的录制被删：

1. 尝试选择下一条最近录制
2. 如果没有，则进入空状态
3. 清理当前 worker 与数据

## 8.5 当前正在录制

Studio 最近录制选择必须只针对“已完成录制”。

判断标准：

- 录制目录存在
- `meta.json` 可读
- `data.bin` / `index.jsonl` 存在

不要依赖 `currentRecording.isRecording === false` 作为唯一依据。  
因为页面刷新、后台重启、残留目录等情况都会导致状态与资产不同步。

---

## 9. i18n 设计

## 9.1 现有机制

当前项目使用：

- `_locales/{lang}/messages.json`
- `_t()` 读取
- Web 模式下 `initI18n()`

因此本次新增文案必须进入 locale key。

## 9.2 建议新增 key 范围

### popup / launcher

建议 key 前缀：

- `launcher_*` 或 `popup_*`

推荐：

- 如果 `/popup` 明确转型为 launcher，建议新增 `launcher_*`
- 不建议继续复用原有录制态文案 key

### studio

新增：

- `studio_emptyTitle`
- `studio_emptyDesc`
- `studio_emptyOpenDrive`
- `studio_emptyStartRecording`
- `studio_invalidRecordingNotice`
- `studio_recentRecordings`

### drive drawer

新增：

- `drive_drawerTitle`
- `drive_drawerEmpty`
- `drive_drawerSelect`

## 9.3 文案硬编码限制

本项目已有成熟 i18n 体系。  
因此以下实现方式不应采用：

1. 在 Svelte 页面直接写中文固定文案
2. 只在英文 locale 新增不补其他 locale
3. 通过 fallback 文案长期代替 locale key

---

## 10. 性能与稳定性设计

## 10.1 OPFS 枚举成本

风险：

- Launcher 或 Studio 每次打开都全量扫描 OPFS，可能导致首屏延迟

优化：

1. 缓存最近录制摘要
2. Drawer 按需加载，不在 Studio 初始就加载全部列表
3. Drive page 正常全量加载，Studio 只先拿 latest

## 10.2 Worker 生命周期

风险：

- Studio 内切换录制时旧 worker 未销毁，造成重复消息或内存泄漏

要求：

1. 切换录制前先 terminate 当前 worker
2. 重置相关页面状态：
   - `workerEncodedChunks = []`
   - `durationMs = 0`
   - `windowStartMs = 0`
   - `windowEndMs = 0`

## 10.3 Drawer 缩略图加载成本

`RecordingCard` 会生成缩略图。  
在 Drawer 中全量启用缩略图可能带来：

- 解码开销
- 打开抽屉卡顿

建议：

1. 第一阶段允许缩略图延迟加载
2. 或为 Drawer mode 提供低成本展示模式

---

## 11. 安全与可靠性

## 11.1 URL 参数安全

Studio 通过 `id` 读取录制目录。  
实现时必须：

1. 使用 `encodeURIComponent` 写 URL
2. 对读到的 `id` 做目录名级别校验
3. 不直接拼接到不可信 HTML 中

## 11.2 OPFS 读取失败处理

所有 OPFS 读取都必须包在 try/catch 中：

1. meta 读取失败
2. 文件缺失
3. JSON 解析失败
4. 浏览器不支持

失败后不能停留在“半加载态”，必须进入：

- 空状态
- 或错误提示后再空状态

## 11.3 Background 消息健壮性

新增消息处理必须保持现有 `onMessage` 风格一致：

1. 明确 `return true`
2. 使用 `sendResponse`
3. async 分支统一 try/catch

避免：

- popup 等待响应悬挂
- service worker 因异常中断

---

## 12. 迁移与实施计划

## Phase 1：共享层与后台能力

目标：

- 先把“最近录制”与页面打开能力标准化

改动点：

1. 新增 `opfs-recordings.ts`
2. 抽出 `openOrFocusControlWindow()`
3. 增加 `OPEN_DRIVE / GET_LATEST_RECORDING / OPEN_LATEST_RECORDING`
4. 缓存失效逻辑接入 `OPFS_RECORDING_READY`

风险：

- 低

## Phase 2：Action Launcher

目标：

- 替换 action 默认入口

改动点：

1. popup 路由改造成 launcher
2. manifest 切到 `default_popup`
3. 背景 `action.onClicked` 逻辑降级或移除

风险：

- 中
- 需要确认 popup 模式下浏览器行为与当前 Control 流程兼容

## Phase 3：Studio fallback 与空状态

目标：

- 让 Studio 可直接进入

改动点：

1. Studio 支持无 `id` fallback
2. 增加 `StudioEmptyState`
3. 将 worker 初始化与录制解析解耦

风险：

- 中

## Phase 4：Studio Drawer

目标：

- 建立工作台内资产切换闭环

改动点：

1. Drive 列表组件轻改
2. 增加 drawer UI
3. 当前录制切换与删除联动

风险：

- 中

---

## 13. 验证与测试建议

## 13.1 当前测试现实

根据 CLAUDE.md，项目当前**没有完善的自动化测试套件**。  
因此本次功能落地后应采用：

1. 类型检查
2. 扩展 build 验证
3. 手工场景验证

## 13.2 核心验证场景

### Action Launcher

1. 点击 action，显示 launcher
2. 点击录制，打开 / 聚焦 Control
3. 点击 Drive，打开 Drive
4. 点击 Studio，有录制时进入最近录制
5. 点击 Studio，无录制时进入 Studio 空状态

### Studio fallback

1. 直接打开 `studio.html`
2. 能否自动进入最近录制
3. 指定 `id` 时能否正确加载
4. 指定无效 `id` 时是否进入合理空状态

### Drawer

1. 打开抽屉是否加载列表
2. 切换录制是否正确刷新预览
3. 删除当前录制后是否正确跳转下一条或空状态

### i18n

1. 新增 key 是否能正确显示
2. 不同语言环境下是否有明显缺失

---

## 14. 风险评估

## 14.1 主要风险

### 风险一：popup 改造影响现有用户习惯

说明：

- 当前用户点击 action 会立刻进入录制控制页
- 改为 launcher 后多一步选择

缓解：

1. launcher 中突出“录制”
2. 保持录制点击后立刻进入 Control
3. 可在后续数据验证后决定是否保留“最近使用入口”的智能推荐

### 风险二：Studio fallback 与录制完成自动打开逻辑冲突

说明：

- 当前 `OPFS_RECORDING_READY` 已自动打开 `studio.html?id=...`

缓解：

- 保留该逻辑不动
- fallback 只在无 `id` 时生效

### 风险三：Drawer 复用 Drive 组件导致 Studio 页面复杂化

缓解：

- 第一阶段只做轻量抽屉
- 暂不把完整 Drive 管理功能搬入 Studio

---

## 15. 最终技术结论

本次产品设计在当前工程结构下**可低风险落地**，且不需要重写录制主链路。

最优技术路径为：

1. **用 `/popup` 承接 action launcher**
2. **用共享 OPFS 查询层统一“最近录制”逻辑**
3. **由 background 统一负责页面打开**
4. **由 Studio 页面负责 fallback 与空状态**
5. **用轻量改造后的 Drive 组件承接 Studio Drawer**

如果按最小破坏原则推进，推荐落地顺序是：

1. 共享查询层
2. background 新消息与 Control 打开函数抽取
3. popup launcher
4. studio fallback + empty state
5. studio drawer

这条路径可以最大程度复用现有：

- `background.ts` 开窗能力
- Drive 的 OPFS 枚举与排序逻辑
- Studio 的 reader worker 链路
- 现有 i18n 与独立 route 架构

从工程视角看，这不是一次高风险架构变更，而是一次**入口组织、页面职责和共享查询层的重构**。
