// 简化的背景配置全局状态管理 - 仅用于验证背景色切换同步
import type { BackgroundConfig } from '../types/background'

// 默认背景配置
const defaultBackgroundConfig: BackgroundConfig = {
  type: 'solid-color',
  color: '#ffffff',
  padding: 60,
  outputRatio: '16:9',
  videoPosition: 'center',
  borderRadius: 0,
  customWidth: 1920,
  customHeight: 1080
}

// 预设背景颜色
export const PRESET_COLORS = [
  { name: '纯白', color: '#ffffff' },
  { name: '浅灰', color: '#f8f9fa' },
  { name: '深灰', color: '#6c757d' },
  { name: '深黑', color: '#212529' },
  { name: '商务蓝', color: '#0066cc' },
  { name: '青绿', color: '#10b981' }
] as const

// 创建背景配置状态管理
function createBackgroundConfigStore() {
  // 使用 $state 创建响应式状态
  let config = $state<BackgroundConfig>({ ...defaultBackgroundConfig })

  return {
    // 状态访问器
    get config() {
      return config
    },

    // 更新背景颜色
    updateColor(color: string) {
      console.log('🎨 [BackgroundConfigStore] Updating color from', config.color, 'to', color)
      config = { ...config, color }
    },

    // 更新圆角半径
    updateBorderRadius(borderRadius: number) {
      console.log('🎨 [BackgroundConfigStore] Updating border radius from', config.borderRadius, 'to', borderRadius)
      config = { ...config, borderRadius }
    },

    // 更新边距
    updatePadding(padding: number) {
      console.log('🎨 [BackgroundConfigStore] Updating padding from', config.padding, 'to', padding)
      config = { ...config, padding }
    },

    // 更新输出比例
    updateOutputRatio(outputRatio: BackgroundConfig['outputRatio'], customWidth?: number, customHeight?: number) {
      console.log('🎨 [BackgroundConfigStore] Updating output ratio from', config.outputRatio, 'to', outputRatio)
      const newConfig: Partial<BackgroundConfig> = { outputRatio }
      if (outputRatio === 'custom' && customWidth && customHeight) {
        newConfig.customWidth = customWidth
        newConfig.customHeight = customHeight
      }
      config = { ...config, ...newConfig }
    },

    // 更新阴影配置
    updateShadow(shadow?: BackgroundConfig['shadow']) {
      console.log('🎨 [BackgroundConfigStore] Updating shadow from', config.shadow, 'to', shadow)
      config = { ...config, shadow }
    },

    // 应用预设颜色
    applyPresetColor(presetColor: typeof PRESET_COLORS[number]) {
      console.log('🎨 [BackgroundConfigStore] Applying preset:', presetColor.name, presetColor.color)
      this.updateColor(presetColor.color)
    }
  }
}

// 创建全局背景配置状态实例
export const backgroundConfigStore = createBackgroundConfigStore()

console.log('🎨 [BackgroundConfigStore] Simple background config store initialized')
