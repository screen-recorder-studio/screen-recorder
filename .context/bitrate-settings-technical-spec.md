# 码率设置完整技术方案

## 📋 概述

本文档提供视频录制码率设置功能的完整技术实现方案，包括UI设计、数据流、存储方案和代码实现。

---

## 🎯 功能目标

### 用户需求
- **普通用户（70%）**：一键录制，自动选择最佳质量
- **进阶用户（20%）**：通过简单预设控制质量和文件大小
- **专业用户（10%）**：精确控制码率、编解码器等参数

### 技术目标
- 提供3个质量预设（节省空间、平衡、高质量）
- 支持自定义码率（2-25 Mbps）
- 支持编解码器选择（H.264、VP9、VP8）
- 实时显示预估文件大小
- 持久化用户设置

---

## 🏗️ 架构设计

### 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Popup UI (控制面板)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ 质量预设    │  │ 高级选项     │  │ 设置页面       │ │
│  │ 下拉框      │  │ (可折叠)     │  │ (独立路由)     │ │
│  └─────────────┘  └──────────────┘  └────────────────┘ │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│              Settings Manager (设置管理器)               │
│  • 加载/保存设置 (chrome.storage.local)                 │
│  • 质量预设映射                                          │
│  • 参数验证                                              │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│           Quality Config Generator (配置生成器)          │
│  • 根据预设生成编码配置                                  │
│  • 计算码率 (BPP算法)                                    │
│  • 选择编解码器                                          │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│              Recording Engine (录制引擎)                 │
│  • Offscreen (Tab/Window/Screen)                        │
│  • Content Script (Area/Element)                        │
│  • WebCodecs Worker                                     │
└─────────────────────────────────────────────────────────┘
```

### 数据流

```
用户选择质量预设
    ↓
保存到 chrome.storage.local
    ↓
开始录制时读取设置
    ↓
生成编码配置 (codec, bitrate, gop, etc.)
    ↓
传递给 WebCodecs Worker
    ↓
应用配置并开始编码
```

---

## 📊 质量预设定义

### 预设配置表

| 预设 | BPP | 编解码器 | GOP | 码率模式 | 1080p@30fps<br>码率 | 10分钟<br>文件大小 |
|------|-----|---------|-----|---------|-------------------|------------------|
| 💾 节省空间 | 0.06 | VP9优先 | 3秒 | VBR | 3.7 Mbps | 225 MB |
| ⚖️ 平衡 | 0.09 | H.264 | 2秒 | VBR | 5.6 Mbps | 375 MB |
| ⭐ 高质量 | 0.15 | H.264 | 1秒 | VBR | 9.3 Mbps | 600 MB |
| 🔧 自定义 | 用户指定 | 用户选择 | 用户选择 | 用户选择 | 用户指定 | 计算显示 |

### 技术参数映射

```typescript
// src/lib/utils/quality-presets.ts

export type QualityPreset = 'space-saver' | 'balanced' | 'high-quality' | 'custom'

export interface QualityConfig {
  bpp: number
  codec: 'auto' | 'h264' | 'vp9-first' | 'vp8'
  gopSeconds: number
  bitrateMode: 'constant' | 'variable'
  hardwareAcceleration: 'prefer-hardware' | 'prefer-software' | 'no-preference'
  latencyMode: 'realtime' | 'quality'
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  'space-saver': {
    bpp: 0.06,
    codec: 'vp9-first',
    gopSeconds: 3,
    bitrateMode: 'variable',
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality'
  },
  
  'balanced': {
    bpp: 0.09,
    codec: 'auto',
    gopSeconds: 2,
    bitrateMode: 'variable',
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'realtime'
  },
  
  'high-quality': {
    bpp: 0.15,
    codec: 'auto',
    gopSeconds: 1,
    bitrateMode: 'variable',
    hardwareAcceleration: 'no-preference',
    latencyMode: 'quality'
  },
  
  'custom': {
    bpp: 0.09,  // 默认值，会被用户设置覆盖
    codec: 'auto',
    gopSeconds: 2,
    bitrateMode: 'variable',
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'realtime'
  }
}
```

---

## 💾 数据存储方案

### 存储结构

```typescript
// chrome.storage.local 存储结构

interface StoredSettings {
  settings: {
    // 倒计时设置（已有）
    countdownSeconds?: number
    
    // 质量设置（新增）
    qualityPreset: QualityPreset
    
    // 自定义设置（当 qualityPreset === 'custom' 时使用）
    customSettings?: {
      bitrate?: number          // Mbps (2-25)
      codec?: 'auto' | 'h264' | 'vp9' | 'vp8'
      gopSeconds?: number       // 0.5-10
      bitrateMode?: 'constant' | 'variable'
      hardwareAcceleration?: 'prefer-hardware' | 'prefer-software' | 'no-preference'
      latencyMode?: 'realtime' | 'quality'
    }
  }
}

// 默认值
const DEFAULT_SETTINGS: StoredSettings = {
  settings: {
    countdownSeconds: 3,
    qualityPreset: 'balanced',
    customSettings: {
      bitrate: 8,
      codec: 'auto',
      gopSeconds: 2,
      bitrateMode: 'variable',
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime'
    }
  }
}
```

### 存储操作

```typescript
// src/lib/utils/settings-manager.ts

export class SettingsManager {
  private static STORAGE_KEY = 'settings'
  
  // 加载设置
  static async load(): Promise<StoredSettings['settings']> {
    try {
      const result = await chrome.storage.local.get([this.STORAGE_KEY])
      return result[this.STORAGE_KEY] || DEFAULT_SETTINGS.settings
    } catch (error) {
      console.error('Failed to load settings:', error)
      return DEFAULT_SETTINGS.settings
    }
  }
  
  // 保存设置
  static async save(settings: Partial<StoredSettings['settings']>): Promise<void> {
    try {
      const current = await this.load()
      const updated = { ...current, ...settings }
      await chrome.storage.local.set({ [this.STORAGE_KEY]: updated })
    } catch (error) {
      console.error('Failed to save settings:', error)
      throw error
    }
  }
  
  // 保存质量预设
  static async saveQualityPreset(preset: QualityPreset): Promise<void> {
    await this.save({ qualityPreset: preset })
  }
  
  // 保存自定义设置
  static async saveCustomSettings(custom: StoredSettings['settings']['customSettings']): Promise<void> {
    await this.save({ customSettings: custom })
  }
  
  // 重置为默认
  static async reset(): Promise<void> {
    await chrome.storage.local.set({ [this.STORAGE_KEY]: DEFAULT_SETTINGS.settings })
  }
}
```

---

## 🎨 UI实现方案

### 方案1：Popup内嵌（简化版）

**位置**：`src/routes/popup/+page.svelte`

**布局**：在倒计时设置下方添加质量选择

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { Sparkles, Info, Settings as SettingsIcon } from 'lucide-svelte'
  import { SettingsManager } from '$lib/utils/settings-manager'
  import type { QualityPreset } from '$lib/utils/quality-presets'
  
  let qualityPreset: QualityPreset = 'balanced'
  let showAdvanced = false
  
  // 自定义设置
  let customBitrate = 8
  let customCodec: 'auto' | 'h264' | 'vp9' | 'vp8' = 'auto'
  
  // 加载设置
  onMount(async () => {
    const settings = await SettingsManager.load()
    qualityPreset = settings.qualityPreset || 'balanced'
    
    if (settings.customSettings) {
      customBitrate = settings.customSettings.bitrate || 8
      customCodec = settings.customSettings.codec || 'auto'
    }
  })
  
  // 保存质量预设
  async function handleQualityChange() {
    await SettingsManager.saveQualityPreset(qualityPreset)
    if (qualityPreset === 'custom') {
      showAdvanced = true
    }
  }
  
  // 保存自定义设置
  async function handleCustomChange() {
    await SettingsManager.saveCustomSettings({
      bitrate: customBitrate,
      codec: customCodec
    })
  }
  
  // 预估文件大小
  function estimateFileSize(preset: QualityPreset): string {
    const sizes = {
      'space-saver': '225 MB',
      'balanced': '375 MB',
      'high-quality': '600 MB',
      'custom': `${Math.round(customBitrate * 60 * 10 / 8)} MB`
    }
    return sizes[preset] || '375 MB'
  }
  
  // 获取描述
  function getDescription(preset: QualityPreset): string {
    const descriptions = {
      'space-saver': '文件更小，适合长时间录制',
      'balanced': '推荐设置，质量和大小平衡',
      'high-quality': '最佳质量，适合文字密集内容',
      'custom': '自定义参数，满足特殊需求'
    }
    return descriptions[preset] || ''
  }
</script>

<!-- 质量设置 -->
<div class="flex flex-col gap-2 mt-3 p-3 bg-white border border-gray-200 rounded-lg">
  <div class="flex items-center gap-2">
    <Sparkles class="w-4 h-4 text-purple-500" />
    <label class="text-sm font-medium text-gray-700">录制质量</label>
  </div>
  
  <select 
    bind:value={qualityPreset}
    on:change={handleQualityChange}
    class="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
  >
    <option value="space-saver">💾 节省空间</option>
    <option value="balanced">⚖️ 平衡（推荐）</option>
    <option value="high-quality">⭐ 高质量</option>
    <option value="custom">🔧 自定义...</option>
  </select>
  
  <!-- 提示信息 -->
  <div class="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 p-2 rounded">
    <Info class="w-3 h-3 mt-0.5 flex-shrink-0" />
    <div class="flex-1">
      <div>{getDescription(qualityPreset)}</div>
      <div class="text-gray-500 mt-1">
        预计 10分钟 ≈ {estimateFileSize(qualityPreset)} (1080p@30fps)
      </div>
    </div>
  </div>
  
  <!-- 高级选项（自定义时显示） -->
  {#if qualityPreset === 'custom'}
  <div class="mt-2 pt-2 border-t border-gray-200 space-y-3">
    <!-- 码率滑块 -->
    <div>
      <label class="text-xs font-medium text-gray-600 flex items-center justify-between">
        <span>码率</span>
        <span class="text-purple-600">{customBitrate} Mbps</span>
      </label>
      <input 
        type="range" 
        min="2" 
        max="25" 
        step="1"
        bind:value={customBitrate}
        on:change={handleCustomChange}
        class="w-full mt-1"
      />
      <div class="flex justify-between text-xs text-gray-500 mt-1">
        <span>2 Mbps</span>
        <span>25 Mbps</span>
      </div>
    </div>
    
    <!-- 编解码器 -->
    <div>
      <label class="text-xs font-medium text-gray-600">编解码器</label>
      <select 
        bind:value={customCodec}
        on:change={handleCustomChange}
        class="w-full text-xs mt-1 border border-gray-300 rounded px-2 py-1"
      >
        <option value="auto">自动选择（推荐）</option>
        <option value="h264">H.264（兼容性最好）</option>
        <option value="vp9">VP9（文件更小）</option>
        <option value="vp8">VP8（兼容性好）</option>
      </select>
    </div>
  </div>
  {/if}
</div>
```

### 方案2：独立设置页面（完整版）

**新增路由**：`src/routes/settings/+page.svelte`

**导航**：在popup中添加设置按钮

```svelte
<!-- src/routes/popup/+page.svelte -->

<script lang="ts">
  function openSettings() {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') })
  }
</script>

<!-- 在popup顶部添加设置按钮 -->
<div class="flex items-center justify-between p-3 border-b">
  <h1 class="text-lg font-semibold">Video Recorder</h1>
  <button 
    on:click={openSettings}
    class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
    title="设置"
  >
    <SettingsIcon class="w-5 h-5 text-gray-600" />
  </button>
</div>
```

**设置页面完整实现**：

```svelte
<!-- src/routes/settings/+page.svelte -->

<script lang="ts">
  import { onMount } from 'svelte'
  import { 
    ArrowLeft, Save, RotateCcw, Info, 
    Video, Sliders, Cpu, Zap 
  } from 'lucide-svelte'
  import { SettingsManager } from '$lib/utils/settings-manager'
  import type { QualityPreset } from '$lib/utils/quality-presets'
  
  // 状态
  let qualityPreset: QualityPreset = 'balanced'
  let customBitrate = 8
  let customCodec: 'auto' | 'h264' | 'vp9' | 'vp8' = 'auto'
  let customGopSeconds = 2
  let customBitrateMode: 'constant' | 'variable' = 'variable'
  let customHardwareAccel: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'prefer-hardware'
  let customLatencyMode: 'realtime' | 'quality' = 'realtime'
  
  let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle'
  
  // 加载设置
  onMount(async () => {
    const settings = await SettingsManager.load()
    qualityPreset = settings.qualityPreset || 'balanced'
    
    if (settings.customSettings) {
      customBitrate = settings.customSettings.bitrate || 8
      customCodec = settings.customSettings.codec || 'auto'
      customGopSeconds = settings.customSettings.gopSeconds || 2
      customBitrateMode = settings.customSettings.bitrateMode || 'variable'
      customHardwareAccel = settings.customSettings.hardwareAcceleration || 'prefer-hardware'
      customLatencyMode = settings.customSettings.latencyMode || 'realtime'
    }
  })
  
  // 保存设置
  async function saveSettings() {
    saveStatus = 'saving'
    try {
      await SettingsManager.saveQualityPreset(qualityPreset)
      
      if (qualityPreset === 'custom') {
        await SettingsManager.saveCustomSettings({
          bitrate: customBitrate,
          codec: customCodec,
          gopSeconds: customGopSeconds,
          bitrateMode: customBitrateMode,
          hardwareAcceleration: customHardwareAccel,
          latencyMode: customLatencyMode
        })
      }
      
      saveStatus = 'saved'
      setTimeout(() => { saveStatus = 'idle' }, 2000)
    } catch (error) {
      console.error('Failed to save settings:', error)
      saveStatus = 'error'
      setTimeout(() => { saveStatus = 'idle' }, 2000)
    }
  }
  
  // 重置为默认
  async function resetToDefaults() {
    if (confirm('确定要重置所有设置为默认值吗？')) {
      await SettingsManager.reset()
      location.reload()
    }
  }
  
  // 返回
  function goBack() {
    window.close()
  }
  
  // 预估文件大小
  function estimateFileSize(): string {
    const bitrate = qualityPreset === 'custom' ? customBitrate : 
                    qualityPreset === 'space-saver' ? 3 :
                    qualityPreset === 'high-quality' ? 8 : 5
    return `${Math.round(bitrate * 60 * 10 / 8)} MB`
  }
</script>

<div class="min-h-screen bg-gray-50">
  <!-- 头部 -->
  <header class="bg-white border-b sticky top-0 z-10">
    <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button 
          on:click={goBack}
          class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft class="w-5 h-5" />
        </button>
        <h1 class="text-xl font-semibold">录制设置</h1>
      </div>
      
      <div class="flex items-center gap-2">
        <button
          on:click={resetToDefaults}
          class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
        >
          <RotateCcw class="w-4 h-4" />
          重置
        </button>
        
        <button
          on:click={saveSettings}
          disabled={saveStatus === 'saving'}
          class="px-4 py-2 text-sm bg-purple-600 text-white hover:bg-purple-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <Save class="w-4 h-4" />
          {saveStatus === 'saving' ? '保存中...' : 
           saveStatus === 'saved' ? '已保存' : 
           saveStatus === 'error' ? '保存失败' : '保存'}
        </button>
      </div>
    </div>
  </header>
  
  <!-- 主内容 -->
  <main class="max-w-4xl mx-auto px-4 py-8">
    <!-- 质量预设 -->
    <section class="bg-white rounded-lg shadow-sm p-6 mb-6">
      <div class="flex items-center gap-2 mb-4">
        <Video class="w-5 h-5 text-purple-600" />
        <h2 class="text-lg font-semibold">视频质量</h2>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label class="relative cursor-pointer">
          <input 
            type="radio" 
            bind:group={qualityPreset} 
            value="space-saver"
            class="peer sr-only"
          />
          <div class="border-2 border-gray-200 peer-checked:border-purple-600 peer-checked:bg-purple-50 rounded-lg p-4 transition-all">
            <div class="text-2xl mb-2">💾</div>
            <div class="font-medium mb-1">节省空间</div>
            <div class="text-sm text-gray-600">文件更小，适合长时间录制</div>
            <div class="text-xs text-gray-500 mt-2">~225 MB / 10分钟</div>
          </div>
        </label>
        
        <label class="relative cursor-pointer">
          <input 
            type="radio" 
            bind:group={qualityPreset} 
            value="balanced"
            class="peer sr-only"
          />
          <div class="border-2 border-gray-200 peer-checked:border-purple-600 peer-checked:bg-purple-50 rounded-lg p-4 transition-all">
            <div class="text-2xl mb-2">⚖️</div>
            <div class="font-medium mb-1">平衡（推荐）</div>
            <div class="text-sm text-gray-600">质量和大小平衡</div>
            <div class="text-xs text-gray-500 mt-2">~375 MB / 10分钟</div>
          </div>
        </label>
        
        <label class="relative cursor-pointer">
          <input 
            type="radio" 
            bind:group={qualityPreset} 
            value="high-quality"
            class="peer sr-only"
          />
          <div class="border-2 border-gray-200 peer-checked:border-purple-600 peer-checked:bg-purple-50 rounded-lg p-4 transition-all">
            <div class="text-2xl mb-2">⭐</div>
            <div class="font-medium mb-1">高质量</div>
            <div class="text-sm text-gray-600">最佳质量，文件较大</div>
            <div class="text-xs text-gray-500 mt-2">~600 MB / 10分钟</div>
          </div>
        </label>
      </div>
      
      <label class="relative cursor-pointer block mt-4">
        <input 
          type="radio" 
          bind:group={qualityPreset} 
          value="custom"
          class="peer sr-only"
        />
        <div class="border-2 border-gray-200 peer-checked:border-purple-600 peer-checked:bg-purple-50 rounded-lg p-4 transition-all">
          <div class="flex items-center gap-2">
            <div class="text-2xl">🔧</div>
            <div>
              <div class="font-medium">自定义</div>
              <div class="text-sm text-gray-600">手动配置所有参数</div>
            </div>
          </div>
        </div>
      </label>
    </section>
    
    <!-- 自定义设置（仅在选择自定义时显示） -->
    {#if qualityPreset === 'custom'}
    <section class="bg-white rounded-lg shadow-sm p-6 mb-6">
      <div class="flex items-center gap-2 mb-4">
        <Sliders class="w-5 h-5 text-purple-600" />
        <h2 class="text-lg font-semibold">自定义参数</h2>
      </div>
      
      <div class="space-y-6">
        <!-- 码率 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            码率
            <span class="text-purple-600 font-semibold ml-2">{customBitrate} Mbps</span>
          </label>
          <input 
            type="range" 
            min="2" 
            max="25" 
            step="0.5"
            bind:value={customBitrate}
            class="w-full"
          />
          <div class="flex justify-between text-xs text-gray-500 mt-1">
            <span>2 Mbps (低)</span>
            <span>25 Mbps (高)</span>
          </div>
          <div class="mt-2 p-3 bg-blue-50 rounded-lg text-sm text-gray-700">
            <Info class="w-4 h-4 inline mr-1" />
            预计文件大小：{estimateFileSize()} / 10分钟 (1080p@30fps)
          </div>
        </div>
        
        <!-- 编解码器 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">编解码器</label>
          <select 
            bind:value={customCodec}
            class="w-full border border-gray-300 rounded-lg px-3 py-2"
          >
            <option value="auto">自动选择（推荐）</option>
            <option value="h264">H.264（兼容性最好）</option>
            <option value="vp9">VP9（文件更小）</option>
            <option value="vp8">VP8（兼容性好）</option>
          </select>
        </div>
        
        <!-- GOP间隔 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            关键帧间隔
            <span class="text-purple-600 font-semibold ml-2">{customGopSeconds} 秒</span>
          </label>
          <input 
            type="range" 
            min="0.5" 
            max="10" 
            step="0.5"
            bind:value={customGopSeconds}
            class="w-full"
          />
          <div class="flex justify-between text-xs text-gray-500 mt-1">
            <span>0.5秒 (频繁)</span>
            <span>10秒 (稀疏)</span>
          </div>
          <div class="mt-2 text-xs text-gray-600">
            更短的间隔可以更精确定位，但文件更大
          </div>
        </div>
        
        <!-- 码率模式 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">码率模式</label>
          <div class="grid grid-cols-2 gap-3">
            <label class="cursor-pointer">
              <input 
                type="radio" 
                bind:group={customBitrateMode} 
                value="variable"
                class="peer sr-only"
              />
              <div class="border-2 border-gray-200 peer-checked:border-purple-600 peer-checked:bg-purple-50 rounded-lg p-3 transition-all">
                <div class="font-medium text-sm">可变码率 (VBR)</div>
                <div class="text-xs text-gray-600 mt-1">质量更稳定，文件更小</div>
              </div>
            </label>
            
            <label class="cursor-pointer">
              <input 
                type="radio" 
                bind:group={customBitrateMode} 
                value="constant"
                class="peer sr-only"
              />
              <div class="border-2 border-gray-200 peer-checked:border-purple-600 peer-checked:bg-purple-50 rounded-lg p-3 transition-all">
                <div class="font-medium text-sm">恒定码率 (CBR)</div>
                <div class="text-xs text-gray-600 mt-1">文件大小可预测</div>
              </div>
            </label>
          </div>
        </div>
      </div>
    </section>
    
    <!-- 编码器设置 -->
    <section class="bg-white rounded-lg shadow-sm p-6 mb-6">
      <div class="flex items-center gap-2 mb-4">
        <Cpu class="w-5 h-5 text-purple-600" />
        <h2 class="text-lg font-semibold">编码器</h2>
      </div>
      
      <div class="space-y-4">
        <!-- 硬件加速 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">硬件加速</label>
          <select 
            bind:value={customHardwareAccel}
            class="w-full border border-gray-300 rounded-lg px-3 py-2"
          >
            <option value="prefer-hardware">优先硬件（推荐）</option>
            <option value="prefer-software">优先软件</option>
            <option value="no-preference">无偏好</option>
          </select>
          <div class="mt-2 text-xs text-gray-600">
            硬件加速更快但质量可能略低
          </div>
        </div>
        
        <!-- 延迟模式 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">延迟模式</label>
          <select 
            bind:value={customLatencyMode}
            class="w-full border border-gray-300 rounded-lg px-3 py-2"
          >
            <option value="realtime">实时（低延迟）</option>
            <option value="quality">质量（高延迟）</option>
          </select>
        </div>
      </div>
    </section>
    {/if}
  </main>
</div>

<style>
  /* 自定义滑块样式 */
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    border-radius: 3px;
    background: #e5e7eb;
    outline: none;
  }
  
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #9333ea;
    cursor: pointer;
  }
  
  input[type="range"]::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #9333ea;
    cursor: pointer;
    border: none;
  }
</style>
```

---

## 🔧 配置生成器实现

```typescript
// src/lib/utils/quality-config-generator.ts

import { QUALITY_PRESETS, type QualityPreset, type QualityConfig } from './quality-presets'
import { computeBitrate } from './webcodecs-config'

export interface EncodingConfig {
  codec: string
  width: number
  height: number
  framerate: number
  bitrate: number
  bitrateMode: 'constant' | 'variable'
  hardwareAcceleration: 'prefer-hardware' | 'prefer-software' | 'no-preference'
  latencyMode: 'realtime' | 'quality'
  gopFrames: number
}

export class QualityConfigGenerator {
  /**
   * 根据质量预设生成编码配置
   */
  static generate(
    preset: QualityPreset,
    width: number,
    height: number,
    framerate: number,
    customSettings?: Partial<QualityConfig>
  ): EncodingConfig {
    // 获取预设配置
    const config = preset === 'custom' && customSettings
      ? { ...QUALITY_PRESETS.custom, ...customSettings }
      : QUALITY_PRESETS[preset]
    
    // 计算码率
    const bitrate = customSettings?.bpp
      ? Math.floor(width * height * framerate * customSettings.bpp)
      : Math.floor(width * height * framerate * config.bpp)
    
    // 限制码率范围
    const clampedBitrate = Math.max(2_000_000, Math.min(bitrate, 25_000_000))
    
    // 计算GOP帧数
    const gopFrames = Math.max(framerate, Math.round(framerate * config.gopSeconds))
    
    return {
      codec: config.codec,
      width,
      height,
      framerate,
      bitrate: clampedBitrate,
      bitrateMode: config.bitrateMode,
      hardwareAcceleration: config.hardwareAcceleration,
      latencyMode: config.latencyMode,
      gopFrames
    }
  }
  
  /**
   * 预估文件大小（字节）
   */
  static estimateFileSize(
    bitrate: number,
    durationSeconds: number
  ): number {
    return Math.floor(bitrate * durationSeconds / 8)
  }
  
  /**
   * 格式化文件大小
   */
  static formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`
    } else if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    } else {
      return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    }
  }
}
```

---

## 🔄 集成到录制流程

### Offscreen录制集成

```typescript
// src/extensions/offscreen-main.ts

import { SettingsManager } from '../lib/utils/settings-manager'
import { QualityConfigGenerator } from '../lib/utils/quality-config-generator'

async function startRecording(options) {
  // ... 现有代码
  
  // 获取质量设置
  const settings = await SettingsManager.load()
  const qualityPreset = settings.qualityPreset || 'balanced'
  
  // 生成编码配置
  const encodingConfig = QualityConfigGenerator.generate(
    qualityPreset,
    width,
    height,
    framerate,
    settings.customSettings
  )
  
  // 配置WebCodecs Worker
  wcWorker.postMessage({
    type: 'configure',
    config: {
      width: encodingConfig.width,
      height: encodingConfig.height,
      framerate: encodingConfig.framerate,
      bitrate: encodingConfig.bitrate,
      codec: encodingConfig.codec,
      bitrateMode: encodingConfig.bitrateMode,
      hardwareAcceleration: encodingConfig.hardwareAcceleration,
      latencyMode: encodingConfig.latencyMode
    }
  })
  
  // 使用GOP配置
  const keyEvery = encodingConfig.gopFrames
  
  // ... 其余代码
}
```

### Content Script录制集成

```typescript
// src/extensions/content.ts

import { SettingsManager } from '../lib/utils/settings-manager'
import { QualityConfigGenerator } from '../lib/utils/quality-config-generator'

async function startCapture() {
  // ... 现有代码
  
  // 获取质量设置
  const settings = await SettingsManager.load()
  const qualityPreset = settings.qualityPreset || 'balanced'
  
  // 生成编码配置
  const encodingConfig = QualityConfigGenerator.generate(
    qualityPreset,
    width,
    height,
    framerate,
    settings.customSettings
  )
  
  // 配置Encoder Worker
  state.worker.postMessage({
    type: 'configure',
    codec: encodingConfig.codec,
    width: encodingConfig.width,
    height: encodingConfig.height,
    framerate: encodingConfig.framerate,
    bitrate: encodingConfig.bitrate
  })
  
  // 使用GOP配置
  const keyEvery = encodingConfig.gopFrames
  
  // ... 其余代码
}
```

---

## 📝 实施清单

### 阶段1：基础功能（3.5小时）

- [ ] 创建 `src/lib/utils/quality-presets.ts`
- [ ] 创建 `src/lib/utils/settings-manager.ts`
- [ ] 创建 `src/lib/utils/quality-config-generator.ts`
- [ ] 修改 `src/routes/popup/+page.svelte` 添加质量选择
- [ ] 修改 `src/extensions/offscreen-main.ts` 集成质量设置
- [ ] 修改 `src/extensions/content.ts` 集成质量设置
- [ ] 测试3个预设的录制效果

### 阶段2：独立设置页面（8小时）

- [ ] 创建 `src/routes/settings/+page.svelte`
- [ ] 添加设置页面路由配置
- [ ] 在popup添加设置按钮
- [ ] 实现完整的自定义参数UI
- [ ] 实现保存/重置功能
- [ ] 测试所有自定义参数

### 阶段3：优化和测试（4小时）

- [ ] 添加文件大小实时预估
- [ ] 添加参数验证和错误提示
- [ ] 性能测试（不同预设的实际效果）
- [ ] 用户体验优化
- [ ] 文档更新

---

## 🎯 预期效果

### 用户体验提升

- ✅ 普通用户：一键选择质量，无需理解技术细节
- ✅ 进阶用户：通过预设快速调整质量和文件大小
- ✅ 专业用户：完全控制所有编码参数
- ✅ 所有用户：清晰的文件大小预估

### 技术指标

| 指标 | 目标 | 验证方法 |
|------|------|---------|
| 设置加载时间 | < 50ms | Performance API |
| 设置保存时间 | < 100ms | Performance API |
| UI响应时间 | < 16ms | 用户感知 |
| 配置生成时间 | < 10ms | Performance API |
| 存储空间占用 | < 1KB | chrome.storage.local |

---

## 📚 相关文档

- [VIDEO-ENCODING-ANALYSIS.md](./VIDEO-ENCODING-ANALYSIS.md) - 视频编码深度分析
- [BITRATE-SETTINGS-PROPOSAL.md](./BITRATE-SETTINGS-PROPOSAL.md) - 码率设置方案建议
- [OPFS-RECORDING-EVALUATION.md](./OPFS-RECORDING-EVALUATION.md) - OPFS录制评估
- [OPFS-OPTIMIZATION-PLAN.md](./OPFS-OPTIMIZATION-PLAN.md) - OPFS优化计划

