# Studio 默认视觉预设 — 最终实施方案

> 基于 `STUDIO-DEFAULT-APPEARANCE-EVALUATION.md` 和 `STUDIO-DEFAULT-APPEARANCE-TECHNICAL-DESIGN.md` 的评估结论，本文档为最终实施方案。
>
> 目标：录制完成进入 Studio 后，用户立即看到已应用背景、圆角、阴影等视觉效果的视频，而非白底原片。

## 1. 对两份文档的评审结论

### 1.1 评估报告（EVALUATION）准确且完整

核心结论已验证正确：

1. Studio 首屏确实经过 composite worker 合成链路，不是裸播原始视频。
2. `defaultBackgroundConfig` 设置 `type: 'wallpaper'` 但缺少 `wallpaper` 实体，导致降级为白色。
3. Composite worker 在 `renderBackground()` 中对 `wallpaper` 类型但无数据的情况回退到 `ctx.fillStyle = config.color`（即 `#ffffff`）。
4. `borderRadius: 0` 且无 `shadow`，即使有 padding 也不会形成卡片化效果。

### 1.2 技术方案草案（TECHNICAL-DESIGN）方向正确但需简化

草案提出的"双层默认 + 一次性注入 + 可降级"方向完全正确。但存在以下可简化之处：

| 草案建议 | 评审意见 | 实施决策 |
|---------|---------|---------|
| 新增 `StudioDefaultAppearancePreset` 接口 | 首版不需要独立预设对象类型；直接用已有 `BackgroundConfig` + 常量即可 | ❌ 不引入新类型 |
| 3 个状态变量控制注入 | `hasUserCustomizedAppearance` 难以精确追踪（用户改了又改回来算不算？）；首版用更简单的方式 | ✅ 简化为 1 个标志 |
| Phase 3 用户偏好持久化 | 正确但非当前优先级 | ⏳ 不在本次实施范围 |
| 首版推荐渐变 + 卡片化 | 完全同意，渐变无需异步资源，稳定性最高 | ✅ 采纳 |
| 异步壁纸增强 | 方向正确，但需要在同步预设已经足够好的前提下做 | ✅ 采纳作为 Layer 2 |

---

## 2. 最终实施方案

### 2.1 核心策略

**改变 `defaultBackgroundConfig` 的初值，让 store 创建时即为有辨识度的默认预设。**

理由：
- 当前 `defaultBackgroundConfig` 是 store 唯一初值来源
- Store 是全局单例，每次 Studio 页面加载时 store 已经处于默认状态
- 直接修改默认值是最简单、最可靠、侵入最小的方案
- 不需要额外的注入时机控制——store 自然就是正确的默认状态

草案中"不建议只改 `defaultBackgroundConfig`"的三个理由在首版实际上不成立：
1. "语义不清" — store 初值就应该是产品希望用户看到的默认效果；
2. "无法表达一次性注入" — 首版不需要，store 初值天然只生效一次；
3. "不利于扩展到异步壁纸" — 异步壁纸增强可以在 Studio 页面层独立做，不影响默认值。

### 2.2 分层实施

#### Layer 1：同步基础预设（修改 `defaultBackgroundConfig`）

修改 `packages/extension/src/lib/stores/background-config.svelte.ts` 中的默认值：

```typescript
const defaultBackgroundConfig: BackgroundConfig = {
  type: 'gradient',                   // 从 'wallpaper' 改为 'gradient'
  color: '#667eea',                   // 渐变失败时的 fallback 色（柔和蓝紫）
  gradient: {                         // 新增：默认渐变配置
    type: 'linear',
    angle: 135,
    stops: [
      { color: '#667eea', position: 0 },
      { color: '#764ba2', position: 1 }
    ]
  },
  padding: 60,
  outputRatio: '16:9',
  videoPosition: 'center',
  borderRadius: 16,                   // 从 0 改为 16
  shadow: {                           // 新增：默认阴影
    offsetX: 0,
    offsetY: 8,
    blur: 32,
    color: 'rgba(0, 0, 0, 0.3)'
  },
  customWidth: 1920,
  customHeight: 1080
}
```

渐变选择理由：
- `#667eea → #764ba2` 为经典蓝紫渐变，适配绝大多数屏幕录制内容
- 135° 角产生左上→右下的视觉流向，现代感强
- 饱和度适中，不会干扰视频内容本身

#### Layer 2：异步壁纸增强（Studio 页面层）

在 Studio `+page.svelte` 中，录制加载完成后异步尝试加载默认壁纸：

```typescript
// 在 loadRecordingById 的 "ready" 回调中，录制数据加载完成后
// 异步尝试加载默认壁纸来升级背景
async function applyDefaultWallpaperEnhancement() {
  try {
    const preset = getWallpaperById('gradient-abstract-1')
    if (!preset) return
    await backgroundConfigStore.handleWallpaperSelection(preset)
  } catch (e) {
    // 静默失败，保留 Layer 1 渐变效果
    console.warn('[Studio] Default wallpaper enhancement failed, keeping gradient:', e)
  }
}
```

注入条件：
- 仅在 Studio 会话首次加载录制时触发（用 `hasAppliedDefaultPreset` 标志控制）
- 用户手动切换录制时不再重复触发（保持当前配置）
- 加载失败时静默保留 Layer 1 渐变效果

壁纸选择：`gradient-abstract-1`（`/wallpapers/gradient-7206609_1920.webp`）
- 抽象渐变图，无具象主体
- 色调与 Layer 1 渐变相近，升级过渡自然
- 已包含在 `WALLPAPER_PRESETS` 中

#### Layer 3：BackgroundPicker Tab 同步

修改 `BackgroundPicker/index.svelte` 的 `$effect`，让 tab 始终与实际 config type 同步：

```typescript
$effect(() => {
  activeTab = currentType
})
```

目前代码中 `if (currentType !== 'wallpaper')` 的条件会导致当默认是 gradient 时 tab 仍显示为 wallpaper，需要修复。

### 2.3 变更文件清单

| 文件 | 变更 | 风险 |
|------|------|------|
| `packages/extension/src/lib/stores/background-config.svelte.ts` | 修改 `defaultBackgroundConfig` 初值 | 低 — 只改常量 |
| `packages/extension/src/routes/studio/+page.svelte` | 添加异步壁纸增强逻辑 | 低 — 失败静默降级 |
| `packages/extension/src/lib/components/BackgroundPicker/index.svelte` | 修复 tab 同步逻辑 | 低 — UI 同步修正 |

### 2.4 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `composite-worker/index.ts` | 已支持 gradient + shadow + borderRadius 渲染 |
| `VideoPreviewComposite.svelte` | 只读取 store config，不需改动 |
| `VideoExportPanel.svelte` | 共用同一 store，自动同步 |
| `image-background-manager.ts` | 壁纸加载逻辑已完整 |
| `wallpaper-presets.ts` | 预设数据已包含需要的壁纸 |
| `background.d.ts` | 类型定义已覆盖所有需要的字段 |

---

## 3. 降级与容错

### 3.1 渐变渲染失败

Composite worker `renderBackground()` 在 `createGradient()` 失败时已有 fallback：
```typescript
if (gradientStyle) {
  ctx.fillStyle = gradientStyle
} else {
  ctx.fillStyle = config.color  // 回退到 #667eea
}
```

### 3.2 默认壁纸加载失败

Layer 2 壁纸增强用 try/catch 包裹，失败时保留 Layer 1 渐变效果，不弹错误、不阻断预览。

### 3.3 用户快速切换录制

壁纸增强仅在首次加载时触发一次。切换录制时保持当前配置，不会被覆盖。

---

## 4. 验证清单

### 4.1 基础功能验证

- [ ] 新建录制 → 进入 Studio：首屏显示渐变背景 + 圆角 + 阴影
- [ ] 渐变背景色与预期一致（蓝紫渐变 135°）
- [ ] borderRadius 为 16px，视频有圆角
- [ ] shadow 可见（向下 8px 偏移，32px 模糊）
- [ ] 壁纸异步加载后背景升级为图片

### 4.2 降级验证

- [ ] 壁纸加载失败时保持渐变背景
- [ ] 控制面板中各项显示与实际配置一致

### 4.3 编辑与导出一致性

- [ ] 用户修改背景后预览即时更新
- [ ] 导出结果与预览一致
- [ ] 默认配置导出结果正确

### 4.4 会话行为

- [ ] 切换录制时保持当前视觉配置
- [ ] 重新打开 Studio 时恢复默认预设

---

## 5. 未来扩展方向（不在本次实施范围）

1. **用户偏好持久化**：将最近一次 Studio 配置存入 `chrome.storage.local`，下次优先恢复
2. **内容自适应模板**：根据视频横竖屏、分辨率自动选择不同默认模板
3. **预设库扩展**：提供多套预设模板供用户一键切换
