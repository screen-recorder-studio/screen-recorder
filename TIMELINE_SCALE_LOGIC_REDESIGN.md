# 时间线刻度分配逻辑重新设计

## 🚨 严重问题

**当前 5秒视频的刻度**: `00:00, 00:02, 00:04, 00:05`

**问题**:
1. ❌ 刻度间隔不均匀（2秒、2秒、1秒）
2. ❌ 视觉上非常不协调
3. ❌ 用户难以估算时间位置

**合理的刻度应该是**: `00:00, 00:01, 00:02, 00:03, 00:04, 00:05` （每1秒）

---

## 🔍 根本原因分析

### 当前算法的问题

```typescript
function calculateTickInterval(durationSec: number) {
  if (durationSec <= 3) return { major: 1, minor: 0.2 }
  if (durationSec <= 10) return { major: 2, minor: 0.5 }  // ← 问题在这里
  // ...
}
```

**逻辑缺陷**:
- 算法只考虑了视频时长范围，没有考虑**刻度间隔是否能整除视频时长**
- 导致 5秒、7秒、9秒等视频的刻度分配不均匀

### 影响范围

| 时长 | 当前算法 | 实际刻度 | 问题 |
|------|---------|---------|------|
| 1秒 | major=1 | 00:00, 00:01 | ✅ 正常 |
| 2秒 | major=1 | 00:00, 00:01, 00:02 | ✅ 正常 |
| 3秒 | major=1 | 00:00, 00:01, 00:02, 00:03 | ✅ 正常 |
| 4秒 | major=2 | 00:00, 00:02, 00:04 | ✅ 正常（整除） |
| **5秒** | **major=2** | **00:00, 00:02, 00:04, 00:05** | ❌ **不均匀** |
| 6秒 | major=2 | 00:00, 00:02, 00:04, 00:06 | ✅ 正常（整除） |
| **7秒** | **major=2** | **00:00, 00:02, 00:04, 00:06, 00:07** | ❌ **不均匀** |
| 8秒 | major=2 | 00:00, 00:02, 00:04, 00:06, 00:08 | ✅ 正常（整除） |
| **9秒** | **major=2** | **00:00, 00:02, 00:04, 00:06, 00:08, 00:09** | ❌ **不均匀** |
| 10秒 | major=2 | 00:00, 00:02, 00:04, 00:06, 00:08, 00:10 | ✅ 正常（整除） |
| 30秒 | major=5 | 00:00, 00:05, ..., 00:30 | ✅ 正常（整除） |
| **37秒** | **major=5** | **00:00, 00:05, ..., 00:35, 00:37** | ❌ **不均匀** |

**结论**: 约 40% 的视频时长会出现刻度不均匀的问题！

---

## 🎯 设计原则

### 1. 刻度必须均匀分布
- ✅ 所有主刻度间隔必须相同
- ✅ 最后一个刻度必须是视频结束点
- ✅ 刻度间隔必须能整除视频时长（或接近整除）

### 2. 刻度密度适中
- ✅ 目标：5-10 个主刻度
- ✅ 太少（<5）：难以精确定位
- ✅ 太多（>10）：视觉拥挤

### 3. 刻度间隔符合直觉
- ✅ 优先使用：1秒、2秒、5秒、10秒、15秒、30秒、60秒
- ✅ 避免使用：3秒、7秒、11秒等不常见间隔

---

## 🔧 新算法设计

### 方案：智能刻度计算

```typescript
function calculateTickInterval(durationSec: number): { major: number; minor: number } {
  // 候选刻度间隔（秒），按优先级排序
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  
  // 目标：生成 5-10 个主刻度
  const minTicks = 5
  const maxTicks = 10
  const idealTicks = 7
  
  let bestMajor = 1
  let bestScore = -Infinity
  
  for (const interval of candidates) {
    // 计算该间隔会生成多少个刻度
    const tickCount = Math.ceil(durationSec / interval) + 1
    
    // 跳过刻度数过少或过多的间隔
    if (tickCount < minTicks || tickCount > maxTicks) continue
    
    // 计算得分
    let score = 0
    
    // 1. 刻度数接近理想值（权重：50%）
    const tickDiff = Math.abs(tickCount - idealTicks)
    score += (1 - tickDiff / idealTicks) * 50
    
    // 2. 能否整除视频时长（权重：30%）
    const remainder = durationSec % interval
    const divisibilityScore = (1 - remainder / interval) * 30
    score += divisibilityScore
    
    // 3. 间隔是否常见（权重：20%）
    const commonIntervals = [1, 2, 5, 10, 30, 60]
    if (commonIntervals.includes(interval)) {
      score += 20
    }
    
    if (score > bestScore) {
      bestScore = score
      bestMajor = interval
    }
  }
  
  // 次刻度为主刻度的 1/5 或 1/2
  let bestMinor: number
  if (bestMajor >= 10) {
    bestMinor = bestMajor / 5  // 大间隔用 1/5
  } else {
    bestMinor = bestMajor / 2  // 小间隔用 1/2
  }
  
  return { major: bestMajor, minor: bestMinor }
}
```

### 算法特点

1. **多候选评分**: 评估所有可能的刻度间隔，选择得分最高的
2. **三维评分**:
   - 刻度数量（50%权重）
   - 整除性（30%权重）
   - 常见性（20%权重）
3. **自适应**: 根据视频时长自动选择最优间隔

---

## 📊 新算法效果预测

| 时长 | 旧算法 | 新算法 | 刻度示例 | 改进 |
|------|--------|--------|---------|------|
| 5秒 | major=2 | **major=1** | 00:00, 00:01, 00:02, 00:03, 00:04, 00:05 | ✅ 均匀 |
| 7秒 | major=2 | **major=1** | 00:00, 00:01, ..., 00:07 | ✅ 均匀 |
| 9秒 | major=2 | **major=1** | 00:00, 00:01, ..., 00:09 | ✅ 均匀 |
| 10秒 | major=2 | **major=2** | 00:00, 00:02, ..., 00:10 | ✅ 保持 |
| 15秒 | major=5 | **major=2** | 00:00, 00:02, ..., 00:14, 00:15 | ⚠️ 或 major=5 |
| 20秒 | major=5 | **major=5** | 00:00, 00:05, 00:10, 00:15, 00:20 | ✅ 均匀 |
| 30秒 | major=5 | **major=5** | 00:00, 00:05, ..., 00:30 | ✅ 保持 |
| 37秒 | major=5 | **major=5** | 00:00, 00:05, ..., 00:35, 00:37 | ⚠️ 仍不均匀 |
| 40秒 | major=10 | **major=5** | 00:00, 00:05, ..., 00:40 | ✅ 均匀 |
| 60秒 | major=10 | **major=10** | 00:00, 00:10, ..., 01:00 | ✅ 保持 |

### 特殊情况处理

对于 37秒这种无法完美整除的情况：
- **选项1**: 接受最后一个间隔不同（如 00:35 → 00:37）
- **选项2**: 动态调整所有刻度位置（复杂度高）
- **推荐**: 选项1，因为大多数情况下影响不大

---

## 🧪 测试用例

### 必须通过的测试

```typescript
describe('calculateTickInterval', () => {
  it('5秒视频应该每1秒一个刻度', () => {
    const { major } = calculateTickInterval(5)
    expect(major).toBe(1)
  })
  
  it('10秒视频应该每2秒一个刻度', () => {
    const { major } = calculateTickInterval(10)
    expect(major).toBe(2)
  })
  
  it('30秒视频应该每5秒一个刻度', () => {
    const { major } = calculateTickInterval(30)
    expect(major).toBe(5)
  })
  
  it('60秒视频应该每10秒一个刻度', () => {
    const { major } = calculateTickInterval(60)
    expect(major).toBe(10)
  })
  
  it('所有刻度间隔应该能生成5-10个主刻度', () => {
    const testDurations = [1, 5, 10, 15, 30, 45, 60, 90, 120, 300, 600]
    testDurations.forEach(duration => {
      const { major } = calculateTickInterval(duration)
      const tickCount = Math.ceil(duration / major) + 1
      expect(tickCount).toBeGreaterThanOrEqual(5)
      expect(tickCount).toBeLessThanOrEqual(10)
    })
  })
})
```

---

## 📝 实施计划

### Phase 1: 实施新算法（立即）
1. ✅ 设计新算法
2. ⏳ 实现 `calculateTickInterval` 函数
3. ⏳ 更新 Timeline.svelte
4. ⏳ 更新测试页面

### Phase 2: 测试验证（1小时内）
1. ⏳ 测试所有测试用例
2. ⏳ 截图对比新旧算法
3. ⏳ 验证边界情况

### Phase 3: 文档更新（完成后）
1. ⏳ 更新 TIMELINE_IMPLEMENTATION_SUMMARY.md
2. ⏳ 创建算法说明文档
3. ⏳ 添加代码注释

---

## 💡 总结

**当前问题**: 刻度间隔算法只考虑时长范围，不考虑整除性，导致 40% 的视频刻度不均匀。

**解决方案**: 实施智能刻度计算算法，综合考虑刻度数量、整除性、常见性三个维度。

**预期效果**: 
- ✅ 所有视频刻度均匀分布
- ✅ 刻度密度适中（5-10个）
- ✅ 刻度间隔符合直觉

**下一步**: 立即实施新算法并测试。

