# Chrome Offscreen API Manager

这个工具集提供了完整的Chrome扩展Offscreen API管理功能，让你可以轻松地在Chrome扩展中使用offscreen文档。

## 文件说明

- `offscreen-manager.ts` - 核心管理工具，提供所有offscreen文档的生命周期管理功能
- `offscreen-examples.ts` - 基础使用示例和最佳实践
- `offscreen-usage-guide.ts` - 详细的实际使用案例和高级功能演示
- `offscreen-README.md` - 本文档

## 快速开始

### 1. 确保manifest.json配置正确

```json
{
  "manifest_version": 3,
  "permissions": [
    "offscreen"
  ]
}
```

### 2. 创建offscreen.html文件

在扩展根目录创建`offscreen.html`：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Offscreen Document</title>
</head>
<body>
  <script src="offscreen.js"></script>
</body>
</html>
```

### 3. 基本使用

```typescript
import {
  ensureOffscreenDocument,
  withOffscreen,
  getRecommendedJustification
} from './offscreen-manager';

// 确保offscreen文档存在（自动使用推荐的justification）
await ensureOffscreenDocument({
  reasons: ['BLOBS']
  // justification 会自动生成
});

// 或者手动指定justification
await ensureOffscreenDocument({
  reasons: ['BLOBS'],
  justification: 'Process video data for download'
});

// 使用offscreen文档执行操作
const result = await withOffscreen(async () => {
  // 在这里执行需要DOM的操作
  return await processData();
}, {
  reasons: ['WORKERS', 'BLOBS']
  // justification 会自动生成为多个reasons的组合说明
});
```

## 核心功能

### 检查支持性

```typescript
import { isOffscreenSupported } from './offscreen-manager';

if (isOffscreenSupported()) {
  // 可以使用offscreen功能
}
```

### 文档生命周期管理

```typescript
import { 
  hasOffscreenDocument, 
  createOffscreenDocument, 
  closeOffscreenDocument 
} from './offscreen-manager';

// 检查文档是否存在
const exists = await hasOffscreenDocument();

// 创建文档
await createOffscreenDocument({
  url: 'offscreen.html',
  reasons: ['CLIPBOARD', 'BLOBS'],
  justification: 'Handle clipboard and blob operations'
});

// 关闭文档
await closeOffscreenDocument();
```

### 便利函数

```typescript
import { withOffscreen } from './offscreen-manager';

// 自动管理文档生命周期
const result = await withOffscreen(
  async () => {
    // 你的操作
    return processData();
  },
  {
    reasons: ['WORKERS'],
    justification: 'Process data with web workers',
    keepAlive: false // 操作完成后自动关闭
  }
);
```

## 支持的Reasons

根据Chrome官方文档，支持以下reasons：

- `TESTING` - 仅用于测试目的
- `AUDIO_PLAYBACK` - 音频播放（30秒无音频后自动关闭）
- `IFRAME_SCRIPTING` - 嵌入和脚本化iframe以修改其内容
- `DOM_SCRAPING` - 嵌入iframe并抓取其DOM以提取信息
- `BLOBS` - 与Blob对象交互（包括URL.createObjectURL()）
- `DOM_PARSER` - 使用DOMParser API
- `USER_MEDIA` - 与用户媒体流交互（如getUserMedia()）
- `DISPLAY_MEDIA` - 与显示媒体流交互（如getDisplayMedia()）
- `WEB_RTC` - 使用WebRTC API
- `CLIPBOARD` - 与剪贴板API交互
- `LOCAL_STORAGE` - 访问localStorage
- `WORKERS` - 生成Web Workers
- `BATTERY_STATUS` - 使用navigator.getBattery
- `MATCH_MEDIA` - 使用window.matchMedia
- `GEOLOCATION` - 使用navigator.geolocation

## 自动Justification生成

工具提供了自动justification生成功能，为每个reason提供合适的说明：

```typescript
import {
  getRecommendedJustification,
  getRecommendedJustificationForReasons
} from './offscreen-manager';

// 获取单个reason的推荐justification
const justification = getRecommendedJustification('CLIPBOARD');
// 返回: "Read from and write to the system clipboard for data transfer"

// 获取多个reasons的组合justification
const multiJustification = getRecommendedJustificationForReasons(['WORKERS', 'BLOBS']);
// 返回: "Extension requires background processing, blob processing capabilities for core functionality"

// 在创建文档时自动使用推荐justification
await ensureOffscreenDocument({
  reasons: ['CLIPBOARD', 'WORKERS']
  // justification 会自动生成
});
```

## 常见使用场景

### 1. 剪贴板操作

```typescript
import { copyToClipboard } from './offscreen-examples';

await copyToClipboard('Hello World!');
```

### 2. 音频播放

```typescript
import { playAudioInBackground } from './offscreen-examples';

await playAudioInBackground('notification.mp3');
```

### 3. 数据处理

```typescript
import { processDataWithWorker } from './offscreen-examples';

const processedData = await processDataWithWorker(rawData);
```

### 4. HTML解析

```typescript
import { parseHTMLContent } from './offscreen-examples';

const parsedData = await parseHTMLContent('<div>Hello</div>');
```

## 错误处理

所有函数都返回结果对象或抛出异常：

```typescript
import { ensureOffscreenDocument } from './offscreen-manager';

const result = await ensureOffscreenDocument({
  reasons: ['BLOBS'],
  justification: 'Process files'
});

if (!result.success) {
  console.error('Failed to create offscreen document:', result.error);
}
```

## 生命周期管理器

对于复杂的应用，可以使用生命周期管理器：

```typescript
import { OffscreenLifecycleManager } from './offscreen-examples';

const manager = new OffscreenLifecycleManager();

// 初始化
await manager.setup();

// 检查状态
const isReady = await manager.isReady();

// 清理
await manager.cleanup();
```

## 消息路由

对于复杂的消息处理：

```typescript
import { offscreenRouter } from './offscreen-examples';

// 注册处理器
offscreenRouter.registerHandler('PROCESS_DATA', async (data) => {
  return processData(data);
});

// 发送消息
const result = await offscreenRouter.sendToOffscreen('PROCESS_DATA', myData);
```

## 最佳实践

1. **选择最小的reasons集合** - 只选择你真正需要的功能
2. **提供清晰的justification** - 这可能会显示给用户
3. **合理管理生命周期** - 不需要时及时关闭文档
4. **错误处理** - 始终处理可能的错误情况
5. **性能考虑** - offscreen文档创建有开销，避免频繁创建/销毁

## 兼容性

- Chrome 109+ 支持基本offscreen API
- Chrome 116+ 支持hasDocument()方法
- 自动降级到兼容的检查方法

## 注意事项

1. 一个扩展同时只能有一个offscreen文档
2. offscreen文档无法获得焦点
3. 只有chrome.runtime API在offscreen文档中可用
4. AUDIO_PLAYBACK类型的文档会在30秒无音频后自动关闭
5. offscreen文档的URL必须是扩展包中的静态HTML文件
