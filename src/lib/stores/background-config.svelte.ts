// 背景配置全局状态管理 - 支持纯色、渐变色和图片背景
import type {
  BackgroundConfig,
  GradientConfig,
  GradientPreset,
  SolidColorPreset,
  ImageBackgroundConfig,
  ImagePreset
} from '../types/background'
import { imageBackgroundManager } from '../services/image-background-manager'

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

// 预设纯色配置
export const PRESET_SOLID_COLORS: SolidColorPreset[] = [
  // 基础色
  { id: 'white', name: '纯白', color: '#ffffff', category: 'basic' },
  { id: 'light-gray', name: '浅灰', color: '#f8f9fa', category: 'light' },
  { id: 'gray', name: '中灰', color: '#6c757d', category: 'basic' },
  { id: 'dark-gray', name: '深灰', color: '#343a40', category: 'dark' },
  { id: 'black', name: '深黑', color: '#212529', category: 'dark' },

  // 商务色
  { id: 'business-blue', name: '商务蓝', color: '#0066cc', category: 'business' },
  { id: 'navy', name: '海军蓝', color: '#1e3a8a', category: 'business' },
  { id: 'slate', name: '石板灰', color: '#475569', category: 'business' },

  // 创意色
  { id: 'emerald', name: '翡翠绿', color: '#10b981', category: 'creative' },
  { id: 'purple', name: '紫罗兰', color: '#8b5cf6', category: 'creative' },
  { id: 'pink', name: '粉红色', color: '#ec4899', category: 'creative' },
  { id: 'orange', name: '橙色', color: '#f97316', category: 'creative' },
  { id: 'red', name: '红色', color: '#ef4444', category: 'creative' },
  { id: 'yellow', name: '黄色', color: '#eab308', category: 'creative' }
]

// 预设渐变配置
export const PRESET_GRADIENTS: GradientPreset[] = [
  // 线性渐变
  {
    id: 'sunset',
    name: '日落',
    description: '温暖的橙红渐变',
    config: {
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#ff7e5f', position: 0 },
        { color: '#feb47b', position: 1 }
      ]
    },
    preview: 'linear-gradient(45deg, #ff7e5f 0%, #feb47b 100%)'
  },
  {
    id: 'ocean',
    name: '海洋',
    description: '深蓝到浅蓝的渐变',
    config: {
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#667eea', position: 0 },
        { color: '#764ba2', position: 1 }
      ]
    },
    preview: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  },
  {
    id: 'forest',
    name: '森林',
    description: '自然绿色渐变',
    config: {
      type: 'linear',
      angle: 90,
      stops: [
        { color: '#134e5e', position: 0 },
        { color: '#71b280', position: 1 }
      ]
    },
    preview: 'linear-gradient(90deg, #134e5e 0%, #71b280 100%)'
  },
  {
    id: 'purple-pink',
    name: '紫粉',
    description: '紫色到粉色的渐变',
    config: {
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#8b5cf6', position: 0 },
        { color: '#ec4899', position: 1 }
      ]
    },
    preview: 'linear-gradient(45deg, #8b5cf6 0%, #ec4899 100%)'
  },

  // 径向渐变
  {
    id: 'radial-blue',
    name: '蓝色光晕',
    description: '径向蓝色渐变',
    config: {
      type: 'radial',
      centerX: 0.5,
      centerY: 0.5,
      radius: 0.8,
      stops: [
        { color: '#3b82f6', position: 0 },
        { color: '#1e40af', position: 1 }
      ]
    },
    preview: 'radial-gradient(circle, #3b82f6 0%, #1e40af 100%)'
  },
  {
    id: 'radial-warm',
    name: '暖色光晕',
    description: '径向暖色渐变',
    config: {
      type: 'radial',
      centerX: 0.5,
      centerY: 0.5,
      radius: 0.7,
      stops: [
        { color: '#fbbf24', position: 0 },
        { color: '#f59e0b', position: 0.5 },
        { color: '#d97706', position: 1 }
      ]
    },
    preview: 'radial-gradient(circle, #fbbf24 0%, #f59e0b 50%, #d97706 100%)'
  }
]

// 兼容性：保持旧的PRESET_COLORS导出
export const PRESET_COLORS = PRESET_SOLID_COLORS.map(preset => ({
  name: preset.name,
  color: preset.color
}))

// 创建背景配置状态管理
function createBackgroundConfigStore() {
  // 使用 $state 创建响应式状态
  let config = $state<BackgroundConfig>({ ...defaultBackgroundConfig })

  // 保持每种类型的最后配置状态
  let lastImageConfig = $state<ImageBackgroundConfig | undefined>(undefined)
  let lastWallpaperConfig = $state<ImageBackgroundConfig | undefined>(undefined)
  let lastGradientConfig = $state<GradientConfig | undefined>(undefined)

  return {
    // 状态访问器
    get config() {
      return config
    },

    // 获取保存的配置状态
    get lastImageConfig() {
      return lastImageConfig
    },

    get lastWallpaperConfig() {
      return lastWallpaperConfig
    },

    get lastGradientConfig() {
      return lastGradientConfig
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

    // 更新背景类型
    updateBackgroundType(type: BackgroundConfig['type']) {
      console.log('🎨 [BackgroundConfigStore] Updating background type from', config.type, 'to', type)
      config = { ...config, type }
    },

    // 恢复之前保存的图片配置
    restoreImageBackground() {
      if (lastImageConfig) {
        console.log('🎨 [BackgroundConfigStore] Restoring last image background:', lastImageConfig.imageId)
        config = { ...config, type: 'image', image: lastImageConfig, wallpaper: undefined, gradient: undefined }
        return true
      }
      return false
    },

    // 恢复之前保存的壁纸配置
    restoreWallpaperBackground() {
      if (lastWallpaperConfig) {
        console.log('🎨 [BackgroundConfigStore] Restoring last wallpaper background:', lastWallpaperConfig.imageId)
        config = { ...config, type: 'wallpaper', wallpaper: lastWallpaperConfig, image: undefined, gradient: undefined }
        return true
      }
      return false
    },

    // 恢复之前保存的渐变配置
    restoreGradientBackground() {
      if (lastGradientConfig) {
        console.log('🎨 [BackgroundConfigStore] Restoring last gradient background')
        config = { ...config, type: 'gradient', gradient: lastGradientConfig }
        return true
      }
      return false
    },

    // 更新渐变配置
    updateGradient(gradient: GradientConfig) {
      console.log('🎨 [BackgroundConfigStore] Updating gradient:', gradient)
      lastGradientConfig = gradient  // 保存最后的渐变配置
      config = { ...config, type: 'gradient', gradient }
    },

    // 应用预设颜色
    applyPresetColor(presetColor: typeof PRESET_COLORS[number]) {
      console.log('🎨 [BackgroundConfigStore] Applying preset:', presetColor.name, presetColor.color)
      // 确保背景类型为纯色
      config = { ...config, type: 'solid-color', color: presetColor.color, gradient: undefined }
    },

    // 应用预设纯色
    applyPresetSolidColor(preset: SolidColorPreset) {
      console.log('🎨 [BackgroundConfigStore] Applying solid color preset:', preset.name, preset.color)
      config = { ...config, type: 'solid-color', color: preset.color, gradient: undefined }
    },

    // 应用预设渐变
    applyPresetGradient(preset: GradientPreset) {
      console.log('🎨 [BackgroundConfigStore] Applying gradient preset:', preset.name)
      lastGradientConfig = preset.config  // 保存最后的渐变配置
      config = { ...config, type: 'gradient', gradient: preset.config }
    },

    // 应用用户上传的图片背景
    applyImageBackground(imageConfig: ImageBackgroundConfig) {
      console.log('🎨 [BackgroundConfigStore] Applying user uploaded image background:', imageConfig.imageId)
      lastImageConfig = imageConfig  // 保存最后的图片配置
      config = { ...config, type: 'image', image: imageConfig, wallpaper: undefined, gradient: undefined }
    },

    // 应用壁纸背景
    applyWallpaperBackground(imageConfig: ImageBackgroundConfig) {
      console.log('🎨 [BackgroundConfigStore] Applying wallpaper background:', imageConfig.imageId)
      lastWallpaperConfig = imageConfig  // 保存最后的壁纸配置
      config = { ...config, type: 'wallpaper', wallpaper: imageConfig, image: undefined, gradient: undefined }
    },

    // 应用预设图片
    async applyPresetImage(preset: ImagePreset) {
      console.log('🎨 [BackgroundConfigStore] Applying image preset:', preset.name)
      try {
        const result = await imageBackgroundManager.processPresetImage(preset)
        this.applyImageBackground(result.config)
        return result
      } catch (error) {
        console.error('🎨 [BackgroundConfigStore] Failed to apply image preset:', error)
        throw error
      }
    },

    // 处理壁纸选择
    async handleWallpaperSelection(preset: ImagePreset) {
      console.log('🎨 [BackgroundConfigStore] Processing wallpaper selection:', preset.name)
      try {
        const result = await imageBackgroundManager.processPresetImage(preset)
        this.applyWallpaperBackground(result.config)
        return result
      } catch (error) {
        console.error('🎨 [BackgroundConfigStore] Failed to process wallpaper selection:', error)
        throw error
      }
    },

    // 处理用户上传的图片
    async handleImageUpload(file: File) {
      console.log('🎨 [BackgroundConfigStore] Processing uploaded image:', file.name)
      try {
        const result = await imageBackgroundManager.processImage(file)
        this.applyImageBackground(result.config)
        return result
      } catch (error) {
        console.error('🎨 [BackgroundConfigStore] Failed to process uploaded image:', error)
        throw error
      }
    },

    // 更新图片配置
    updateImageConfig(updates: Partial<Omit<ImageBackgroundConfig, 'type' | 'imageId'>>) {
      if (config.type === 'image' && config.image) {
        console.log('🎨 [BackgroundConfigStore] Updating user image config:', updates)
        config = {
          ...config,
          image: { ...config.image, ...updates }
        }
      } else if (config.type === 'wallpaper' && config.wallpaper) {
        console.log('🎨 [BackgroundConfigStore] Updating wallpaper config:', updates)
        config = {
          ...config,
          wallpaper: { ...config.wallpaper, ...updates }
        }
      }
    },

    // 获取当前配置的CSS样式
    getCurrentBackgroundStyle(): string {
      if (config.type === 'solid-color') {
        return config.color
      } else if (config.type === 'gradient' && config.gradient) {
        return this.generateGradientCSS(config.gradient)
      } else if (config.type === 'image' && config.image) {
        // 对于用户上传的图片背景，返回预览URL或占位符
        const previewUrl = imageBackgroundManager.getPreviewUrl(config.image.imageId)
        return previewUrl ? `url(${previewUrl})` : '#f0f0f0'
      } else if (config.type === 'wallpaper' && config.wallpaper) {
        // 对于壁纸背景，返回预览URL或占位符
        const previewUrl = imageBackgroundManager.getPreviewUrl(config.wallpaper.imageId)
        return previewUrl ? `url(${previewUrl})` : '#f0f0f0'
      }
      return config.color // 回退到纯色
    },

    // 生成渐变CSS字符串
    generateGradientCSS(gradient: GradientConfig): string {
      const stops = gradient.stops
        .map(stop => `${stop.color} ${(stop.position * 100).toFixed(1)}%`)
        .join(', ')

      switch (gradient.type) {
        case 'linear':
          return `linear-gradient(${gradient.angle}deg, ${stops})`
        case 'radial':
          const centerX = (gradient.centerX * 100).toFixed(1)
          const centerY = (gradient.centerY * 100).toFixed(1)
          // 使用标准的径向渐变语法，不指定具体半径，让浏览器自动计算
          return `radial-gradient(circle at ${centerX}% ${centerY}%, ${stops})`
        case 'conic':
          const conicCenterX = (gradient.centerX * 100).toFixed(1)
          const conicCenterY = (gradient.centerY * 100).toFixed(1)
          return `conic-gradient(from ${gradient.angle}deg at ${conicCenterX}% ${conicCenterY}%, ${stops})`
        default:
          return config.color // 回退到纯色
      }
    }
  }
}

// 创建全局背景配置状态实例
export const backgroundConfigStore = createBackgroundConfigStore()

console.log('🎨 [BackgroundConfigStore] Simple background config store initialized')
