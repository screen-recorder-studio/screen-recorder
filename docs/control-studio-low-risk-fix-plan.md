# Control → Studio 低成本低风险迭代计划（2026-03-08 刷新版）

> 目标：基于当前代码现状，挑选**最小改动、最低耦合、最高用户感知收益**的迭代项，优先解决“默认体验不够惊艳、关键节点不够确定”这两个核心问题。  
> 说明：本计划只给出详细实施方案，不在本次任务中修改代码。

---

## 1. 迭代筛选原则

本计划只保留符合以下条件的事项：

- **不改 OPFS 数据结构**
- **不重写 WebCodecs / offscreen 主链路**
- **尽量只改 UI、状态收口、默认配置、入口组织方式**
- **优先复用现有能力**（background state、store、ExportManager、现有组件）
- **能在 0.5~2 天内独立交付并验证**

---

## 2. 推荐分三批做

### Sprint 1：先把“第一印象”和“卡住感”解决

1. 默认 Studio 美化模板
2. Studio 一键模板预设
3. Preparing 子状态 + timeout 对齐
4. Studio 首屏主加载 timeout + retry

### Sprint 2：再把“可控感”和“可发现性”补齐

5. 导出中取消
6. Studio 快速完成引导
7. 录制前预检提示

### Sprint 3：再考虑入口扩展和音频策略

8. 主入口补区域/元素录制
9. 音频开关与预期管理

> 其中 Sprint 1 是本次定义的“低成本、低风险、建议优先上线”的核心范围。

---

## 3. Sprint 1 详细计划

## 3.1 方案一：默认 Studio 美化模板

### 要解决的问题

当前默认背景配置虽然是 `wallpaper`，但没有默认壁纸对象时会回退为白色/占位背景；同时圆角默认 `0`、阴影默认关闭。用户第一次打开 Studio 时，最容易看到的是“白底矩形原片”。

### 代码证据

- 默认背景配置：`background-config.svelte.ts:13-22`
- 默认 `borderRadius: 0`
- 默认只有 `type: 'wallpaper'`，没有默认 `wallpaper` 实体
- wallpaper 为空时会回退占位/纯色：`background-config.svelte.ts:884-889`

### 方案内容

新增一套**首条录制默认模板**，例如：

- 背景：预置渐变或内置壁纸
- 圆角：20~32
- Padding：60（沿用当前）
- 阴影：轻阴影 preset

### 为什么低风险

- 只改默认 store 初始化或首次进入 Studio 的默认套用逻辑
- 不影响录制数据结构
- 不影响导出格式与 worker
- 用户仍可手动改回原样

### 预估成本

**0.5 ~ 1 天**

### 涉及文件

- `packages/extension/src/lib/stores/background-config.svelte.ts`
- 可能补充：`packages/extension/src/routes/studio/+page.svelte`

### 验收标准

- 新录制进入 Studio 后，不再默认看到白底矩形原片
- 未手动操作时，导出结果已经具备基础美化效果
- 老用户已有自定义配置时，不强制覆盖历史配置

### 预期收益

- 直接提升第一印象
- 降低“我还要自己调半天”的心理成本
- 最接近用户问题描述中的核心诉求

---

## 3.2 方案二：Studio 一键模板预设

### 要解决的问题

当前背景、圆角、Padding、阴影都能调，但用户必须逐项操作，导致“能力强但不够快”。

### 方案内容

在 Studio 右侧顶部或 BackgroundPicker 上方增加模板区：

- Clean Demo
- Creator Gradient
- Dark Glass
- Business Presentation

每个模板本质上只是批量设置现有 store：

- `backgroundConfigStore.update...`
- `updateBorderRadius`
- `updatePadding`
- `updateShadow`
- `updateOutputRatio`

### 为什么低风险

- 全部复用现有状态结构
- 不改导出算法
- 不改录制链路
- 仅增加“组合应用”的产品层入口

### 预估成本

**1 ~ 1.5 天**

### 涉及文件

- `packages/extension/src/routes/studio/+page.svelte`
- `packages/extension/src/lib/components/BackgroundPicker/index.svelte`
- `packages/extension/src/lib/stores/background-config.svelte.ts`

### 验收标准

- 用户点击模板后，预览即时变化
- 模板应用后仍可用现有单项控件继续微调
- 导出结果与预览一致

### 预期收益

- 把“功能丰富”变成“上手很快”
- 明显降低首次编辑成本
- 提高导出率与分享率

---

## 3.3 方案三：Preparing 子状态 + timeout 对齐

### 要解决的问题

当前 Control 的 preparing 反馈仍然太粗：

- UI timeout：30 秒
- background/offscreen timeout：45 秒
- 用户只看到一个 Preparing 文案

### 代码证据

- Control 30 秒超时：`control/+page.svelte:40-43,121-130`
- background offscreen start timeout：`background.ts:9-11`
- offscreen 真正流程包含多个阶段：`offscreen-main.ts:426-455,584-600`

### 方案内容

把 preparing 细分为至少 3 个用户可理解状态：

1. 等待屏幕选择/权限确认
2. 正在初始化录制引擎
3. 即将开始倒计时

同时统一 timeout 策略：

- UI 与 background 使用同一超时值
- 超时后文案明确区分“用户未授权”与“系统初始化过慢”

### 为什么低风险

- 不需要改录制数据协议
- 只是在现有消息流上增加更清晰的 UI 映射
- 主要风险在文案和状态同步，技术面可控

### 预估成本

**0.5 ~ 1 天**

### 涉及文件

- `packages/extension/src/routes/control/+page.svelte`
- `packages/extension/src/extensions/background.ts`
- `packages/extension/src/extensions/offscreen-main.ts`

### 验收标准

- 点击 Start 后，用户能明确知道当前卡在哪个阶段
- 30s/45s 不一致问题被消除
- 超时后给出明确下一步动作（重试 / 检查权限）

### 预期收益

- 降低首次使用误判“卡死”的概率
- 提升 Start → Recording 的转化体验

---

## 3.4 方案四：Studio 首屏主加载 timeout + retry

### 要解决的问题

Studio 现在已经把 loading 与 worker range 返回对齐，但首次 `open -> ready -> getRange` 主链路仍然没有独立 timeout。

### 代码证据

- 主加载逻辑：`studio/+page.svelte:307-421`
- 预取与单帧 GOP 已有 timeout：`studio/+page.svelte:610-643,667-699`

### 方案内容

给首次加载增加独立 timeout，例如 4~6 秒：

- 超时 -> 切到 `load-failed`
- 展示 `Retry` 按钮
- 同时保留 `Open Drive / Start Recording`

### 为什么低风险

- 不改 reader worker 协议
- 只改 Studio 壳层状态机
- 已有空状态组件可以复用

### 预估成本

**0.5 天**

### 涉及文件

- `packages/extension/src/routes/studio/+page.svelte`
- `packages/extension/src/lib/components/studio/StudioEmptyState.svelte`

### 验收标准

- 首屏加载不会无限转圈
- 加载失败后用户有明确重试动作
- 大文件正常场景不被误判

### 预期收益

- 避免“录完却打不开”导致的高挫败体验
- 提高 Studio 首次可用性

---

## 4. Sprint 2 详细计划（仍然建议做，但优先级次于 Sprint 1）

## 4.1 方案五：导出中取消

### 现状

- `ExportManager.cancelExport()` 已实现：`export-manager.ts:247-254`
- `UnifiedExportDialog` 的 Cancel 按钮导出时被禁用：`UnifiedExportDialog.svelte:689-699`

### 方案内容

- 导出中把 Cancel 按钮从“关闭对话框”改为“取消导出”
- 取消后保留当前参数，允许用户立即重试

### 预估成本

**0.5 ~ 1 天**

### 风险

**低到中**。主要是验证 worker cancel 后资源是否完整释放。

---

## 4.2 方案六：Studio 快速完成引导

### 要解决的问题

用户未必知道应该先改背景、再裁剪、再导出。

### 方案内容

增加轻量引导条：

1. 套模板
2. 裁掉多余边缘（可选）
3. 导出 MP4/WebM/GIF

### 预估成本

**0.5 天**

### 风险

**低**。纯展示与入口组织。

---

## 4.3 方案七：录制前预检提示

### 要解决的问题

background 已具备 capability 检测，但用户侧感知较弱。

### 方案内容

在 Control 增加录制前提示区：

- 会弹出系统共享选择器
- 某些页面不能注入/不能选区域
- 建议关闭敏感页面
- 存储空间不足时建议先清理

### 预估成本

**0.5 ~ 1 天**

### 风险

**低**。即使先做静态提示，也已经有价值。

---

## 5. 暂不归入“低风险快迭代”的事项

下面这些方向价值不低，但不适合本轮当成“低成本低风险”处理：

### 5.1 主入口补区域/元素录制

价值：高  
风险：中

原因：

- 需要把 Control、background、content、权限能力判断串起来
- 不只是加一个按钮，还涉及入口可用性和失败分流

### 5.2 音频录制开关

价值：高  
风险：中到高

原因：

- Control、offscreen、导出、浏览器兼容、权限提示都要一并评估
- 一旦做不好，可能引入更多兼容性问题

---

## 6. 建议实施顺序（最现实版本）

### 第一周

1. 默认 Studio 美化模板
2. Studio 一键模板预设

### 第二周

3. Preparing 子状态 + timeout 对齐
4. Studio 首屏 timeout + retry

### 第三周

5. 导出中取消
6. 快速完成引导
7. 录制前预检提示

---

## 7. 每项迭代建议观察的指标

### 指标 1：录制进入 Studio 的完成率

关注：

- Start 点击后进入 `STREAM_START` 的成功率
- Stop 后成功进入 Studio 的比率

### 指标 2：Studio 导出率

关注：

- 打开 Studio 后是否完成首次导出
- 是否在未编辑直接离开

### 指标 3：首次编辑深度

关注：

- 模板使用率
- 背景、圆角、阴影至少改动 1 次的比例
- Crop / Focus 的点击率

### 指标 4：失败感知下降

关注：

- Preparing 阶段超时率
- Studio 首屏加载失败率
- 导出取消率 / 导出失败率

---

## 8. 最终建议

如果只能做最少的事，我建议立刻做下面四项：

1. **默认 Studio 美化模板**
2. **一键模板预设**
3. **Preparing 子状态 + timeout 对齐**
4. **Studio 首屏 timeout + retry**

它们共同特点是：

- 代码改动面小
- 不碰底层数据格式
- 不重写录制/导出算法
- 用户感知非常强

对“卸载率高”这个问题来说，这四项是当前阶段**投入产出比最高**的一组低成本迭代。
