# 时间线刻度需求评估与实现分析

## 📋 需求分析

### 用户需求
> "时间线刻度需要跟视频总长度进行计算，刻度平均分配，当前仅显示了 00:00 刻度。"

### 需求拆解
1. **刻度应该根据视频总长度动态计算**
2. **刻度应该平均分配在时间轴上**
3. **当前问题：只显示了 00:00 一个刻度**

---

## 🔍 当前实现分析

### 代码位置
- **组件**: `src/lib/components/Timeline.svelte`
- **算法**: 行 92-106 (`calculateTickInterval`)
- **生成逻辑**: 行 108-148 (`timeMarkers`)

### 当前算法

```typescript
function calculateTickInterval(durationSec: number): { major: number; minor: number } {
  // 超短视频（< 3秒）：每秒一个主刻度，每0.2秒一个次刻度
  if (durationSec <= 3) return { major: 1, minor: 0.2 }
  // 短视频（3-10秒）：每2秒一个主刻度，每0.5秒一个次刻度
  if (durationSec <= 10) return { major: 2, minor: 0.5 }
  // 中短视频（10-30秒）：每5秒一个主刻度，每1秒一个次刻度
  if (durationSec <= 30) return { major: 5, minor: 1 }
  // 中等视频（30-120秒）：每10秒一个主刻度，每2秒一个次刻度
  if (durationSec <= 120) return { major: 10, minor: 2 }
  // 长视频（2-10分钟）：每30秒一个主刻度，每6秒一个次刻度
  if (durationSec <= 600) return { major: 30, minor: 6 }
  // 超长视频（> 10分钟）：每60秒一个主刻度，每12秒一个次刻度
  return { major: 60, minor: 12 }
}
```

### 刻度生成逻辑

```typescript
const timeMarkers = $derived.by((): TimeMarker[] => {
  if (durationSec <= 0) return []
  
  const markers: TimeMarker[] = []
  const { major, minor } = calculateTickInterval(durationSec)
  
  // 生成主要刻度（带时间标签）
  for (let t = 0; t <= durationSec; t += major) {
    markers.push({
      timeSec: t,
      timeMs: t * 1000,
      timeLabel: formatTimeSec(t),
      isMajor: true,
      position: (t / durationSec) * 100  // 百分比位置
    })
  }
  
  // 生成次要刻度（不带标签）
  for (let t = minor; t < durationSec; t += minor) {
    if (t % major !== 0) {
      markers.push({
        timeSec: t,
        timeMs: t * 1000,
        isMajor: false,
        position: (t / durationSec) * 100
      })
    }
  }
  
  return markers.sort((a, b) => a.timeSec - b.timeSec)
})
```

---

## ✅ 实现验证

### 测试用例覆盖

| 视频时长 | 主刻度间隔 | 次刻度间隔 | 预期主刻度数 | 示例刻度位置 |
|---------|-----------|-----------|------------|-------------|
| 1秒 | 1秒 | 0.2秒 | 2 | 0s, 1s |
| 2秒 | 1秒 | 0.2秒 | 3 | 0s, 1s, 2s |
| 3秒 | 1秒 | 0.2秒 | 4 | 0s, 1s, 2s, 3s |
| 5秒 | 2秒 | 0.5秒 | 3 | 0s, 2s, 4s |
| 10秒 | 2秒 | 0.5秒 | 6 | 0s, 2s, 4s, 6s, 8s, 10s |
| 30秒 | 5秒 | 1秒 | 7 | 0s, 5s, 10s, 15s, 20s, 25s, 30s |
| 1分钟 | 10秒 | 2秒 | 7 | 00:00, 00:10, 00:20, ..., 01:00 |
| 2分钟 | 10秒 | 2秒 | 13 | 00:00, 00:10, 00:20, ..., 02:00 |
| 5分钟 | 30秒 | 6秒 | 11 | 00:00, 00:30, 01:00, ..., 05:00 |
| 10分钟 | 60秒 | 12秒 | 11 | 00:00, 01:00, 02:00, ..., 10:00 |

### 算法特点

✅ **自适应密度**: 根据视频时长自动调整刻度密度  
✅ **平均分配**: 刻度按固定间隔均匀分布  
✅ **双层刻度**: 主刻度（带标签）+ 次刻度（仅线条）  
✅ **百分比定位**: 使用 `(t / durationSec) * 100` 确保精确分布  

---

## 🐛 问题诊断

### 可能的问题原因

#### 1. **数据未传递**
```typescript
// VideoPreviewComposite.svelte
<Timeline
  {timelineMaxMs}  // ← 这个值可能为 0 或未初始化
  currentTimeMs={currentTimeMs}
  ...
/>
```

**检查点**:
- `timelineMaxMs` 是否正确计算？
- `durationMs` 是否从 OPFS 正确读取？
- `totalFramesAll` 和 `frameRate` 是否有效？

#### 2. **计算优先级问题**
```typescript
// VideoPreviewComposite.svelte:122-173
const timelineMaxMs = $derived.by(() => {
  // Priority 1: 使用全局帧数
  if (totalFramesAll > 0 && frameRate > 0) {
    result = Math.floor((totalFramesAll / frameRate) * 1000)
  }
  // Priority 2: 使用传入的 durationMs
  else if (durationMs > 0) {
    result = Math.floor(durationMs)
  }
  // ...其他优先级
  else {
    result = 1000  // ← 回退值可能导致问题
  }
  return result
})
```

**可能问题**:
- 初始化时所有条件都不满足，返回 `1000ms` (1秒)
- 但 1秒视频应该显示 2 个主刻度（0s, 1s），而不是只有 00:00

#### 3. **CSS 样式问题**
```css
.marker-label {
  position: absolute;
  bottom: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  width: 3rem;
  color: #9ca3af;
  white-space: nowrap;
}
```

**可能问题**:
- 标签可能被遮挡
- 颜色与背景对比度不足
- `width: 3rem` 可能导致标签重叠

#### 4. **渲染条件问题**
```svelte
{#if marker.isMajor && marker.timeLabel}
  <span class="marker-label">{marker.timeLabel}</span>
{/if}
```

**可能问题**:
- `marker.timeLabel` 可能为空字符串或 undefined

---

## 🔧 修复建议

### 1. 添加调试日志（已完成）
```typescript
console.log('[Timeline] Generating markers:', {
  durationSec,
  major,
  minor,
  timelineMaxMs
})

console.log('[Timeline] Generated markers:', {
  total: markers.length,
  major: markers.filter(m => m.isMajor).length,
  minor: markers.filter(m => !m.isMajor).length,
  firstFew: markers.slice(0, 5)
})
```

### 2. 确保数据初始化
```typescript
// Studio 页面应该确保在数据加载后才显示 Timeline
{#if showTimeline && timelineMaxMs > 0 && totalFramesAll > 0}
  <Timeline ... />
{/if}
```

### 3. 优化短视频支持（已完成）
```typescript
// 新增对 < 5秒视频的支持
if (durationSec <= 3) return { major: 1, minor: 0.2 }
if (durationSec <= 10) return { major: 2, minor: 0.5 }
```

### 4. 优化时间格式化（已完成）
```typescript
// 短视频显示小数位
if (timelineMaxMs <= 10000) {
  return total.toFixed(1) + 's'  // "2.5s"
}
// 长视频显示 mm:ss
return `${mm}:${ss}`  // "01:30"
```

---

## 🧪 测试方法

### 1. 使用测试页面
访问: `http://localhost:5174/test-timeline`

**测试步骤**:
1. 选择不同时长的测试用例
2. 观察刻度是否正确显示
3. 检查浏览器控制台日志

### 2. 使用调试页面
访问: `http://localhost:5174/test-timeline-debug`

**功能**:
- 显示生成的刻度列表
- 显示预期刻度位置
- 实时调整视频时长

### 3. 使用实际 Studio 页面
访问: `http://localhost:5174/studio?id=rec_xxx`

**检查点**:
1. 打开浏览器开发者工具
2. 查看 `[Timeline]` 开头的日志
3. 检查 `timelineMaxMs` 的值
4. 检查生成的 markers 数量

---

## 📊 预期结果

### 正常情况
```
[Timeline] Generating markers: {
  durationSec: 60,
  major: 10,
  minor: 2,
  timelineMaxMs: 60000
}

[Timeline] Generated markers: {
  total: 37,
  major: 7,
  minor: 30,
  firstFew: [
    { time: 0, label: "00:00", pos: "0.0" },
    { time: 2, label: undefined, pos: "3.3" },
    { time: 4, label: undefined, pos: "6.7" },
    { time: 6, label: undefined, pos: "10.0" },
    { time: 8, label: undefined, pos: "13.3" }
  ]
}
```

### 异常情况
```
[Timeline] No markers: durationSec = 0
```
**原因**: `timelineMaxMs` 为 0 或未初始化

---

## ✨ 改进建议

### Phase 1: 基础修复
- [x] 添加调试日志
- [x] 支持短视频（< 5秒）
- [x] 优化时间格式化
- [ ] 验证实际 Studio 页面数据流

### Phase 2: 体验优化
- [ ] 动态计算刻度密度（考虑时间轴宽度）
- [ ] 防止标签重叠（智能隐藏）
- [ ] 添加刻度悬停提示
- [ ] 支持自定义刻度间隔

### Phase 3: 高级功能
- [ ] 关键帧标记
- [ ] 章节标记
- [ ] 缩略图预览
- [ ] 波形显示

---

## 📝 总结

### 当前实现评估
✅ **算法正确**: 刻度生成逻辑完整且合理  
✅ **自适应**: 根据视频时长动态调整  
✅ **平均分配**: 使用百分比确保均匀分布  
⚠️ **数据流**: 需要验证 `timelineMaxMs` 是否正确传递  
⚠️ **初始化**: 可能存在初始化时机问题  

### 下一步行动
1. **立即**: 在实际 Studio 页面测试，查看控制台日志
2. **短期**: 确保数据正确传递，修复初始化问题
3. **中期**: 优化短视频体验，防止标签重叠
4. **长期**: 添加高级功能（关键帧、缩略图等）

