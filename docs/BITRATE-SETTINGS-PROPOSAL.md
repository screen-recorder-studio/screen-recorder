# 码率设置方案建议

## 🎯 核心问题

**是否需要在控制面板添加码率设置器？**

**答案：建议采用"智能默认 + 高级选项"的混合方案**

---

## 📊 用户需求分析

### 用户类型分类

| 用户类型 | 占比 | 需求 | 技术水平 | 建议方案 |
|---------|------|------|---------|---------|
| **普通用户** | 70% | 一键录制，不关心参数 | 低 | ✅ 自动码率 |
| **进阶用户** | 20% | 想要更好的质量或更小的文件 | 中 | ✅ 质量预设 |
| **专业用户** | 10% | 需要精确控制所有参数 | 高 | ✅ 高级设置 |

### 用户痛点

```typescript
// 痛点1：不知道设置多少码率合适
"我应该设置多少码率？" 
→ 解决：智能推荐 + 场景预设

// 痛点2：文件太大
"录制10分钟就5GB，太大了！"
→ 解决：提供"节省空间"模式

// 痛点3：质量不够
"录制的视频文字模糊"
→ 解决：提供"高质量"模式

// 痛点4：参数太多
"什么是BPP？什么是GOP？"
→ 解决：隐藏技术细节，提供简单选项
```

---

## 🎨 推荐方案：三级设置体系

### 方案A：简化版（推荐给大多数用户）

```svelte
<!-- 只显示质量预设 -->
<div class="quality-selector">
  <label>录制质量</label>
  <select bind:value={qualityPreset}>
    <option value="auto">🤖 自动（推荐）</option>
    <option value="space-saver">💾 节省空间</option>
    <option value="balanced">⚖️ 平衡</option>
    <option value="high-quality">⭐ 高质量</option>
  </select>
  
  <!-- 预估文件大小提示 -->
  <div class="hint">
    预计 10分钟 ≈ {estimatedSize}
  </div>
</div>
```

**质量预设映射：**

```typescript
const QUALITY_PRESETS = {
  'auto': {
    name: '自动',
    description: '根据内容智能调整',
    bpp: 'dynamic',  // 0.08-0.12
    icon: '🤖',
    estimatedSize: (duration) => '中等'
  },
  
  'space-saver': {
    name: '节省空间',
    description: '文件更小，适合长时间录制',
    bpp: 0.06,
    codec: 'vp09.00.10.08',  // VP9压缩率更高
    gopSeconds: 3,
    icon: '💾',
    estimatedSize: (duration) => {
      // 1080p@30fps: ~3 Mbps
      const mbps = 3
      return `${Math.round(mbps * duration / 8)} MB`
    }
  },
  
  'balanced': {
    name: '平衡',
    description: '质量和大小平衡（默认）',
    bpp: 0.09,
    codec: 'avc1.64002A',  // H.264
    gopSeconds: 2,
    icon: '⚖️',
    estimatedSize: (duration) => {
      // 1080p@30fps: ~5 Mbps
      const mbps = 5
      return `${Math.round(mbps * duration / 8)} MB`
    }
  },
  
  'high-quality': {
    name: '高质量',
    description: '最佳质量，文件较大',
    bpp: 0.15,
    codec: 'avc1.64002A',
    gopSeconds: 1,
    icon: '⭐',
    estimatedSize: (duration) => {
      // 1080p@30fps: ~8 Mbps
      const mbps = 8
      return `${Math.round(mbps * duration / 8)} MB`
    }
  }
}
```

### 方案B：进阶版（可折叠的高级选项）

```svelte
<div class="settings-panel">
  <!-- 基础设置：始终可见 -->
  <div class="basic-settings">
    <label>录制质量</label>
    <select bind:value={qualityPreset}>
      <option value="auto">自动</option>
      <option value="space-saver">节省空间</option>
      <option value="balanced">平衡</option>
      <option value="high-quality">高质量</option>
      <option value="custom">自定义...</option>
    </select>
  </div>
  
  <!-- 高级设置：折叠 -->
  {#if qualityPreset === 'custom' || showAdvanced}
  <details class="advanced-settings">
    <summary>⚙️ 高级设置</summary>
    
    <div class="setting-group">
      <label>
        码率
        <span class="hint">影响质量和文件大小</span>
      </label>
      <div class="bitrate-control">
        <input 
          type="range" 
          min="2" 
          max="25" 
          step="1"
          bind:value={bitratePreset}
        />
        <span>{bitratePreset} Mbps</span>
      </div>
      <div class="bitrate-hint">
        {getBitrateHint(bitratePreset)}
      </div>
    </div>
    
    <div class="setting-group">
      <label>
        编解码器
        <span class="hint">影响兼容性和压缩率</span>
      </label>
      <select bind:value={codecPreference}>
        <option value="auto">自动选择</option>
        <option value="h264">H.264（兼容性最好）</option>
        <option value="vp9">VP9（文件更小）</option>
      </select>
    </div>
    
    <div class="setting-group">
      <label>
        硬件加速
        <span class="hint">更快但可能质量略低</span>
      </label>
      <select bind:value={hardwareAccel}>
        <option value="prefer-hardware">优先硬件</option>
        <option value="prefer-software">优先软件</option>
        <option value="no-preference">无偏好</option>
      </select>
    </div>
  </details>
  {/if}
</div>
```

### 方案C：专业版（独立设置页面）

```svelte
<!-- 在popup中添加设置按钮 -->
<button on:click={openSettings}>
  <Settings class="w-4 h-4" />
</button>

<!-- 设置页面（独立路由或模态框） -->
<div class="settings-page">
  <h2>录制设置</h2>
  
  <section>
    <h3>视频质量</h3>
    
    <div class="setting-item">
      <label>码率模式</label>
      <select bind:value={bitrateMode}>
        <option value="auto">自动</option>
        <option value="cbr">恒定码率（CBR）</option>
        <option value="vbr">可变码率（VBR）</option>
      </select>
      <p class="description">
        VBR可以在保持质量的同时减小文件大小
      </p>
    </div>
    
    <div class="setting-item">
      <label>目标码率</label>
      <div class="bitrate-slider">
        <input 
          type="range" 
          min="1" 
          max="50" 
          step="0.5"
          bind:value={targetBitrate}
        />
        <input 
          type="number" 
          min="1" 
          max="50" 
          step="0.5"
          bind:value={targetBitrate}
        />
        <span>Mbps</span>
      </div>
      <div class="bitrate-presets">
        <button on:click={() => targetBitrate = 2}>低</button>
        <button on:click={() => targetBitrate = 5}>中</button>
        <button on:click={() => targetBitrate = 8}>高</button>
        <button on:click={() => targetBitrate = 16}>极高</button>
      </div>
    </div>
    
    <div class="setting-item">
      <label>关键帧间隔</label>
      <input 
        type="number" 
        min="0.5" 
        max="10" 
        step="0.5"
        bind:value={gopSeconds}
      />
      <span>秒</span>
      <p class="description">
        更短的间隔可以更精确定位，但文件更大
      </p>
    </div>
  </section>
  
  <section>
    <h3>编码器</h3>
    
    <div class="setting-item">
      <label>编解码器偏好</label>
      <div class="codec-options">
        <label>
          <input type="radio" bind:group={codecPref} value="h264" />
          H.264（推荐）
        </label>
        <label>
          <input type="radio" bind:group={codecPref} value="vp9" />
          VP9（更小）
        </label>
        <label>
          <input type="radio" bind:group={codecPref} value="vp8" />
          VP8（兼容）
        </label>
      </div>
    </div>
    
    <div class="setting-item">
      <label>硬件加速</label>
      <select bind:value={hwAccel}>
        <option value="prefer-hardware">优先硬件</option>
        <option value="prefer-software">优先软件</option>
        <option value="no-preference">无偏好</option>
      </select>
    </div>
    
    <div class="setting-item">
      <label>延迟模式</label>
      <select bind:value={latencyMode}>
        <option value="realtime">实时（低延迟）</option>
        <option value="quality">质量（高延迟）</option>
      </select>
    </div>
  </section>
  
  <section>
    <h3>场景优化</h3>
    
    <div class="setting-item">
      <label>内容类型</label>
      <select bind:value={contentType}>
        <option value="auto">自动检测</option>
        <option value="text">文字密集（代码、文档）</option>
        <option value="video">视频播放</option>
        <option value="gaming">游戏录制</option>
        <option value="presentation">演示文稿</option>
      </select>
      <p class="description">
        根据内容类型自动优化编码参数
      </p>
    </div>
  </section>
  
  <div class="actions">
    <button on:click={resetToDefaults}>恢复默认</button>
    <button on:click={saveSettings}>保存</button>
  </div>
</div>
```

---

## 💡 推荐实施方案

### 阶段1：最小可行方案（MVP）

**只添加质量预设，无需暴露码率**

```svelte
<!-- src/routes/popup/+page.svelte -->

<script lang="ts">
  // 添加质量预设状态
  let qualityPreset: 'auto' | 'space-saver' | 'balanced' | 'high-quality' = 'balanced'
  
  // 加载保存的设置
  onMount(async () => {
    try {
      const stored = await chrome.storage.local.get(['settings'])
      qualityPreset = stored?.settings?.qualityPreset || 'balanced'
    } catch {}
  })
  
  // 保存设置
  async function saveQualityPreset(preset: string) {
    try {
      const stored = await chrome.storage.local.get(['settings'])
      const settings = stored?.settings || {}
      settings.qualityPreset = preset
      await chrome.storage.local.set({ settings })
    } catch {}
  }
  
  // 质量预设变化时保存
  $: if (qualityPreset) {
    saveQualityPreset(qualityPreset)
  }
</script>

<!-- 在倒计时设置下方添加质量设置 -->
<div class="flex items-center gap-2 mt-3 p-2 bg-white border border-gray-200 rounded-lg">
  <label class="text-xs font-medium text-gray-600 flex items-center gap-1">
    <Sparkles class="w-3 h-3 text-gray-500" /> 
    质量
  </label>
  <select 
    bind:value={qualityPreset}
    class="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
  >
    <option value="space-saver">💾 节省空间</option>
    <option value="balanced">⚖️ 平衡（推荐）</option>
    <option value="high-quality">⭐ 高质量</option>
  </select>
</div>
```

**修改编码配置以使用预设：**

```typescript
// src/lib/utils/webcodecs-config.ts

export function getQualityPresetConfig(
  preset: string,
  width: number,
  height: number,
  fps: number
) {
  const presets = {
    'space-saver': {
      bpp: 0.06,
      codec: 'vp9-first',
      gopSeconds: 3,
      bitrateMode: 'variable' as const
    },
    'balanced': {
      bpp: 0.09,
      codec: 'auto',
      gopSeconds: 2,
      bitrateMode: 'variable' as const
    },
    'high-quality': {
      bpp: 0.15,
      codec: 'auto',
      gopSeconds: 1,
      bitrateMode: 'variable' as const
    }
  }
  
  const config = presets[preset] || presets['balanced']
  const bitrate = Math.floor(width * height * fps * config.bpp)
  
  return {
    codec: config.codec,
    width,
    height,
    framerate: fps,
    bitrate: Math.max(2_000_000, Math.min(bitrate, 25_000_000)),
    bitrateMode: config.bitrateMode,
    gopSeconds: config.gopSeconds
  }
}
```

**在录制时应用预设：**

```typescript
// src/extensions/offscreen-main.ts

// 获取质量预设
const stored = await chrome.storage.local.get(['settings'])
const qualityPreset = stored?.settings?.qualityPreset || 'balanced'

// 应用预设配置
const config = getQualityPresetConfig(
  qualityPreset,
  width,
  height,
  framerate
)

wcWorker.postMessage({ 
  type: 'configure', 
  config 
})
```

### 阶段2：添加高级选项（可选）

**为进阶用户提供更多控制**

```svelte
<!-- 添加高级设置折叠面板 -->
<details class="mt-3 p-2 bg-white border border-gray-200 rounded-lg">
  <summary class="text-xs font-medium text-gray-600 cursor-pointer">
    ⚙️ 高级设置
  </summary>
  
  <div class="mt-2 space-y-2">
    <!-- 码率滑块 -->
    <div class="setting-item">
      <label class="text-xs text-gray-600">
        码率: {customBitrate} Mbps
      </label>
      <input 
        type="range" 
        min="2" 
        max="25" 
        step="1"
        bind:value={customBitrate}
        class="w-full"
      />
      <div class="text-xs text-gray-500">
        {getBitrateHint(customBitrate, width, height)}
      </div>
    </div>
    
    <!-- 编解码器选择 -->
    <div class="setting-item">
      <label class="text-xs text-gray-600">编解码器</label>
      <select bind:value={codecPref} class="text-xs w-full">
        <option value="auto">自动</option>
        <option value="h264">H.264</option>
        <option value="vp9">VP9</option>
      </select>
    </div>
  </div>
</details>
```

---

## 📊 文件大小估算

### 实时估算显示

```typescript
function estimateFileSize(
  width: number,
  height: number,
  fps: number,
  duration: number, // 秒
  qualityPreset: string
): string {
  const config = getQualityPresetConfig(qualityPreset, width, height, fps)
  const bitrate = config.bitrate
  
  // 文件大小 = 码率 × 时长 / 8
  const sizeBytes = bitrate * duration / 8
  
  // 格式化
  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`
  } else if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
  } else {
    return `${(sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  }
}

// 使用示例
const size10min = estimateFileSize(1920, 1080, 30, 600, 'balanced')
// → "375 MB"
```

### 对比表格

| 质量预设 | 1080p@30fps<br>10分钟 | 1080p@60fps<br>10分钟 | 4K@30fps<br>10分钟 |
|---------|---------------------|---------------------|------------------|
| 💾 节省空间 | 225 MB | 450 MB | 900 MB |
| ⚖️ 平衡 | 375 MB | 750 MB | 1.5 GB |
| ⭐ 高质量 | 600 MB | 1.2 GB | 2.4 GB |

---

## 🎯 最终建议

### ✅ 推荐方案

**阶段1（立即实施）：**
1. ✅ 添加3个质量预设（节省空间、平衡、高质量）
2. ✅ 默认"平衡"模式
3. ✅ 显示预估文件大小
4. ✅ 保存用户选择

**阶段2（可选）：**
5. ⚙️ 添加可折叠的高级选项
6. ⚙️ 允许自定义码率（2-25 Mbps滑块）
7. ⚙️ 允许选择编解码器

**不推荐：**
- ❌ 直接暴露BPP、GOP等技术参数
- ❌ 要求用户输入具体码率数值
- ❌ 过于复杂的设置界面

### 🎨 UI设计建议

```
┌─────────────────────────────────┐
│  🎬 Video Recorder              │
├─────────────────────────────────┤
│  录制模式: [Tab ▼]              │
│                                 │
│  ⏱️ 倒计时: [3秒 ▼]            │
│                                 │
│  ✨ 质量: [⚖️ 平衡 ▼]          │
│  预计 10分钟 ≈ 375 MB           │
│                                 │
│  ▶️ [开始录制]                  │
│                                 │
│  ⚙️ 高级设置 ▼                 │
│  (折叠状态)                     │
└─────────────────────────────────┘
```

### 📝 用户教育

在设置旁边添加提示：

```svelte
<div class="quality-hint">
  <Info class="w-3 h-3" />
  <span class="text-xs text-gray-500">
    {#if qualityPreset === 'space-saver'}
      适合长时间录制，文件更小
    {:else if qualityPreset === 'balanced'}
      推荐设置，质量和大小平衡
    {:else if qualityPreset === 'high-quality'}
      最佳质量，适合文字密集内容
    {/if}
  </span>
</div>
```

---

## 🔄 实施优先级

| 优先级 | 功能 | 工作量 | 用户价值 |
|--------|------|--------|---------|
| 🔴 P0 | 3个质量预设 | 2小时 | ⭐⭐⭐⭐⭐ |
| 🟡 P1 | 文件大小估算 | 1小时 | ⭐⭐⭐⭐ |
| 🟡 P1 | 保存用户选择 | 0.5小时 | ⭐⭐⭐⭐ |
| 🟢 P2 | 高级选项（码率滑块） | 3小时 | ⭐⭐⭐ |
| 🟢 P2 | 编解码器选择 | 1小时 | ⭐⭐ |
| ⚪ P3 | 独立设置页面 | 8小时 | ⭐⭐ |

**总结：先实施P0和P1（3.5小时），满足80%用户需求**

