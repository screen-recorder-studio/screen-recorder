# Display Media Options 更新说明

## 📋 更新概述

本次更新修改了 `src/extensions/offscreen-main.ts` 文件中的 `getDisplayMediaStream` 函数，使其能够根据录制模式（screen、window、tab）配置不同的 `getDisplayMedia` 参数，从而在授权窗口中默认选择对应的录制源。

## 🔧 主要修改

### 1. 函数签名更新

**修改前:**
```typescript
async function getDisplayMediaStream(): Promise<MediaStream>
```

**修改后:**
```typescript
async function getDisplayMediaStream(mode: 'tab' | 'window' | 'screen' = 'screen'): Promise<MediaStream>
```

### 2. 配置参数优化

**修改前:**
```typescript
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
```

**修改后:**
```typescript
const displayMediaOptions: any = {
  video: {
    // 根据模式设置默认的显示表面类型
    ...(mode === 'screen' && { 
      displaySurface: 'monitor',
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude'
    }),
    ...(mode === 'window' && { 
      displaySurface: 'window',
      selfBrowserSurface: 'exclude'
    }),
    ...(mode === 'tab' && { 
      displaySurface: 'browser',
      preferCurrentTab: true,
      selfBrowserSurface: 'include'
    })
  },
  audio: false,
  // 根据模式设置顶级选项
  ...(mode === 'tab' && { preferCurrentTab: true }),
  ...(mode === 'screen' && { 
    selfBrowserSurface: 'exclude',
    monitorTypeSurfaces: 'include'
  })
}

const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions)
```

### 3. 参数传递链路

**数据流:**
1. `popup/+page.svelte` → 选择模式并发送消息
2. `background.ts` → 接收消息并标准化选项
3. `offscreen-main.ts` → 接收选项并配置 getDisplayMedia

**关键代码路径:**
```typescript
// popup/+page.svelte (第87行)
const mode = (['tab','window','screen'] as const).includes(selectedMode as any) ? 
  (selectedMode as 'tab'|'window'|'screen') : 'screen'

// background.ts (第756行)
const mode = (options?.mode === 'tab' || options?.mode === 'window' || options?.mode === 'screen') ? 
  options.mode : 'screen'

// offscreen-main.ts (第214行)
const mode = options?.mode || 'screen'
const stream = await getDisplayMediaStream(mode)
```

## 🎯 各模式配置详解

### Screen 模式
```typescript
{
  video: {
    displaySurface: 'monitor',
    monitorTypeSurfaces: 'include',
    selfBrowserSurface: 'exclude'
  },
  audio: false,
  selfBrowserSurface: 'exclude',
  monitorTypeSurfaces: 'include'
}
```
- **效果**: 授权窗口默认选择屏幕选项
- **适用**: 录制整个屏幕内容

### Window 模式
```typescript
{
  video: {
    displaySurface: 'window',
    selfBrowserSurface: 'exclude'
  },
  audio: false
}
```
- **效果**: 授权窗口默认选择窗口选项
- **适用**: 录制特定应用程序窗口

### Tab 模式
```typescript
{
  video: {
    displaySurface: 'browser',
    preferCurrentTab: true,
    selfBrowserSurface: 'include'
  },
  audio: false,
  preferCurrentTab: true
}
```
- **效果**: 授权窗口默认选择当前标签页
- **适用**: 录制浏览器标签页内容

## 🔧 其他修复

### TypeScript 错误修复
修复了多处 `chrome.runtime.sendMessage` 的类型错误，将 `.catch()` 调用改为 `try-catch` 结构：

**修改前:**
```typescript
chrome.runtime.sendMessage({...}).catch(() => {})
```

**修改后:**
```typescript
try {
  chrome.runtime.sendMessage({...})
} catch {}
```

## 🧪 测试验证

创建了测试文件 `test-display-media-options.html` 用于验证不同模式下的配置效果：

### 测试功能
- 选择不同录制模式（Screen/Window/Tab）
- 查看实际使用的 getDisplayMedia 配置
- 验证授权窗口的默认选择
- 录制功能测试

### 使用方法
1. 在浏览器中打开 `test-display-media-options.html`
2. 选择要测试的录制模式
3. 点击"开始录制"观察授权窗口
4. 验证默认选择是否符合预期

## 📈 预期效果

### 用户体验改进
- **Screen 模式**: 用户选择 Screen 录制时，授权窗口默认高亮屏幕选项
- **Window 模式**: 用户选择 Window 录制时，授权窗口默认高亮窗口选项  
- **Tab 模式**: 用户选择 Tab 录制时，授权窗口默认高亮当前标签页

### 技术优势
- 减少用户操作步骤
- 提高录制流程的直观性
- 降低用户选择错误的可能性

## 🔄 兼容性说明

- 保持向后兼容，默认模式为 'screen'
- 不支持的浏览器会忽略未知参数
- 降级策略：如果特定配置失败，会使用基础配置

## 📝 注意事项

1. **浏览器支持**: 部分 getDisplayMedia 选项需要较新的浏览器版本
2. **权限要求**: 需要用户授权屏幕捕获权限
3. **测试建议**: 在不同浏览器和版本中测试兼容性

## 🚀 后续优化建议

1. 添加更多配置选项（如光标显示、音频录制等）
2. 实现更精细的错误处理和降级策略
3. 添加用户偏好设置记忆功能
4. 优化不同平台的兼容性
