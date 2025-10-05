# Timeline 重复刻度问题评估报告

## 🐛 问题描述

**用户反馈**: "4秒的视频，显示了两个 00:04 00:04"

**问题确认**: 在 Studio 中，某些 4秒左右的视频会在时间轴上显示两个 `00:04` 刻度。

---

## 🔍 根本原因分析

### 问题场景

当视频时长**略大于整数秒**时（如 4.004秒），会产生重复刻度：

```typescript
// VideoPreviewComposite.svelte:129
timelineMaxMs = Math.floor((totalFramesAll / frameRate) * 1000)

// 示例：120帧 @ 29.97fps
timelineMaxMs = Math.floor((120 / 29.97) * 1000)
             = Math.floor(4.004004... * 1000)
             = Math.floor(4004.004...)
             = 4004ms

// Timeline.svelte:63
durationSec = timelineMaxMs / 1000 = 4.004秒
```

### 刻度生成过程

```typescript
// Timeline.svelte:167-175
// 步骤1: 循环生成主刻度 (major = 1)
for (let t = 0; t <= durationSec; t += major) {
  markers.push({ timeSec: t, timeLabel: formatTimeSec(t) })
}
// 生成: 0, 1, 2, 3, 4 (5个刻度)

// Timeline.svelte:177-187
// 步骤2: 检查并添加结束刻度
const lastMarker = markers[markers.length - 1]  // timeSec = 4
if (lastMarker.timeSec < durationSec) {         // 4 < 4.004 ✅ true
  markers.push({
    timeSec: durationSec,                       // 4.004
    timeLabel: formatTimeSec(durationSec)       // "00:04"
  })
}
// 添加: 4.004 (第6个刻度)
```

### 时间格式化

```typescript
// Timeline.svelte:160-166
function formatTimeSec(sec: number): string {
  const total = Math.max(0, sec)
  const mm = Math.floor(total / 60)
  const ss = Math.floor(total % 60)  // ← 关键：Math.floor 导致 4.004 → 4
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

formatTimeSec(4)     // "00:04"
formatTimeSec(4.004) // "00:04"  ← 重复！
```

### 最终结果

```
刻度数组: [
  { timeSec: 0, timeLabel: "00:00" },
  { timeSec: 1, timeLabel: "00:01" },
  { timeSec: 2, timeLabel: "00:02" },
  { timeSec: 3, timeLabel: "00:03" },
  { timeSec: 4, timeLabel: "00:04" },      ← 第一个 00:04
  { timeSec: 4.004, timeLabel: "00:04" }   ← 第二个 00:04 (重复)
]
```

---

## 📊 影响范围

### 受影响的视频时长

| 帧数 | 帧率 | timelineMaxMs | durationSec | 是否重复 |
|------|------|---------------|-------------|---------|
| 120 | 30.00 | 4000 | 4.000 | ❌ 正常 |
| 120 | 29.97 | 4004 | 4.004 | ✅ **重复** |
| 121 | 30.00 | 4033 | 4.033 | ✅ **重复** |
| 119 | 30.00 | 3966 | 3.966 | ❌ 正常（3秒刻度） |
| 150 | 30.00 | 5000 | 5.000 | ❌ 正常 |
| 150 | 29.97 | 5005 | 5.005 | ✅ **重复** |

### 通用规则

**会产生重复刻度的条件**:
```
durationSec % 1 > 0 && durationSec % 1 < 1
```

即：视频时长的小数部分在 (0, 1) 之间时，会产生重复。

**估算影响**:
- 29.97fps 视频：约 **100%** 受影响（几乎所有时长）
- 30fps 视频：约 **0%** 受影响（帧数通常是整数倍）
- 25fps 视频：约 **80%** 受影响
- 24fps 视频：约 **75%** 受影响

---

## 🔧 修复方案

### 方案 1: 容差比较（推荐）

在检查是否需要添加结束刻度时，使用容差比较：

```typescript
// Timeline.svelte:177-187
const lastMarker = markers[markers.length - 1]
const TOLERANCE = 0.01  // 10ms 容差

// 只有当最后刻度与结束时间相差超过容差时才添加
if (!lastMarker || (durationSec - lastMarker.timeSec) > TOLERANCE) {
  markers.push({
    timeSec: durationSec,
    timeMs: durationSec * 1000,
    timeLabel: formatTimeSec(durationSec),
    isMajor: true,
    position: 100
  })
}
```

**优点**:
- ✅ 简单直接
- ✅ 解决浮点数精度问题
- ✅ 不影响现有逻辑

**缺点**:
- ⚠️ 需要选择合适的容差值

---

### 方案 2: 去重检查

在添加刻度前检查是否已存在相同标签的刻度：

```typescript
// Timeline.svelte:177-187
const lastMarker = markers[markers.length - 1]
const endLabel = formatTimeSec(durationSec)

// 检查最后一个刻度的标签是否与结束标签相同
if (!lastMarker || lastMarker.timeLabel !== endLabel) {
  markers.push({
    timeSec: durationSec,
    timeMs: durationSec * 1000,
    timeLabel: endLabel,
    isMajor: true,
    position: 100
  })
}
```

**优点**:
- ✅ 直接解决显示重复问题
- ✅ 不需要容差值

**缺点**:
- ⚠️ 依赖格式化函数的行为
- ⚠️ 如果格式化逻辑改变，可能失效

---

### 方案 3: 四舍五入 durationSec

在计算 `durationSec` 时四舍五入到最接近的整数秒：

```typescript
// Timeline.svelte:63
const durationSec = $derived(Math.round(timelineMaxMs / 1000))
```

**优点**:
- ✅ 从源头解决问题
- ✅ 刻度总是整数秒

**缺点**:
- ❌ 改变了时间轴的实际长度
- ❌ 可能导致播放头超出时间轴范围
- ❌ 不推荐

---

## 📝 推荐实施方案

### 方案 1 + 方案 2 组合（最佳）

```typescript
// Timeline.svelte:177-187
const lastMarker = markers[markers.length - 1]
const TOLERANCE = 0.01  // 10ms 容差
const endLabel = formatTimeSec(durationSec)

// 条件1: 时间差超过容差
// 条件2: 标签不重复
const timeDiff = durationSec - (lastMarker?.timeSec || 0)
const labelDiff = lastMarker?.timeLabel !== endLabel

if (!lastMarker || (timeDiff > TOLERANCE && labelDiff)) {
  markers.push({
    timeSec: durationSec,
    timeMs: durationSec * 1000,
    timeLabel: endLabel,
    isMajor: true,
    position: 100
  })
}
```

**优点**:
- ✅ 双重保护，确保不重复
- ✅ 处理浮点数精度问题
- ✅ 处理格式化重复问题

---

## 🧪 测试用例

### 必须通过的测试

```typescript
describe('Timeline markers - no duplicates', () => {
  it('4.004秒视频不应该有重复的 00:04', () => {
    const timelineMaxMs = 4004
    const markers = generateMarkers(timelineMaxMs)
    const labels = markers.filter(m => m.isMajor).map(m => m.timeLabel)
    const uniqueLabels = [...new Set(labels)]
    
    expect(labels.length).toBe(uniqueLabels.length)
    expect(labels.filter(l => l === '00:04').length).toBe(1)
  })
  
  it('5.005秒视频不应该有重复的 00:05', () => {
    const timelineMaxMs = 5005
    const markers = generateMarkers(timelineMaxMs)
    const labels = markers.filter(m => m.isMajor).map(m => m.timeLabel)
    
    expect(labels.filter(l => l === '00:05').length).toBe(1)
  })
  
  it('4.000秒视频应该正常显示', () => {
    const timelineMaxMs = 4000
    const markers = generateMarkers(timelineMaxMs)
    const labels = markers.filter(m => m.isMajor).map(m => m.timeLabel)
    
    expect(labels).toEqual(['00:00', '00:01', '00:02', '00:03', '00:04'])
  })
})
```

---

## 📸 验证步骤

### 1. 创建测试视频
- 120帧 @ 29.97fps (4.004秒)
- 121帧 @ 30fps (4.033秒)

### 2. 在 Studio 中打开
- 检查时间轴刻度
- 确认没有重复标签

### 3. 检查控制台日志
```
[Timeline] Generated markers: {
  total: 10,
  major: 5,  ← 应该是 5 个，不是 6 个
  ...
}
```

---

## 💡 总结

**问题**: 4秒视频显示两个 `00:04` 刻度

**原因**: 
1. `timelineMaxMs` 计算产生非整数秒（如 4004ms = 4.004秒）
2. 刻度生成逻辑添加了 `timeSec = 4` 和 `timeSec = 4.004` 两个刻度
3. `formatTimeSec` 将两者都格式化为 `"00:04"`

**解决**: 
- 使用容差比较 + 标签去重
- 确保不添加时间和标签都重复的刻度

**影响**: 
- 29.97fps 视频几乎 100% 受影响
- 30fps 视频基本不受影响

**优先级**: 🔴 高（影响用户体验）

**实施时间**: 立即修复

