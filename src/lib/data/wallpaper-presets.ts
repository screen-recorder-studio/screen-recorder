// 内置壁纸预设配置
import type { ImagePreset } from '$lib/types/background'

// 壁纸预设数据
export const WALLPAPER_PRESETS: ImagePreset[] = [
  {
    id: 'gradient-abstract-1',
    name: '抽象渐变',
    description: '现代抽象渐变背景，适合科技和创意内容',
    imageUrl: '/wallpapers/gradient-7206609_1920.webp',
    config: {
      fit: 'cover',
      position: 'center',
      opacity: 1,
      blur: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0
    },
    category: 'abstract',
    tags: ['渐变', '抽象', '现代', '科技']
  },
  {
    id: 'geometric-pattern-1',
    name: '几何图案',
    description: '简约几何图案背景，适合商务和专业内容',
    imageUrl: '/wallpapers/the-background-302467_1920.webp',
    config: {
      fit: 'cover',
      position: 'center',
      opacity: 1,
      blur: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0
    },
    category: 'minimal',
    tags: ['几何', '图案', '简约', '商务']
  },
  // 新增壁纸（来自 static/wallpapers）
  {
    id: 'abstract-2425706',
    name: '抽象色彩 2425706',
    description: '鲜艳抽象色彩纹理，视觉冲击力强',
    imageUrl: '/wallpapers/abstract-2425706.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['抽象', '色彩', '纹理']
  },
  {
    id: 'abstract-2512412',
    name: '抽象色彩 2512412',
    description: '流动的抽象色彩背景，适合创意内容',
    imageUrl: '/wallpapers/abstract-2512412.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['抽象', '渐变', '艺术']
  },
  {
    id: 'abstract-6297317',
    name: '抽象形态 6297317',
    description: '抽象几何形态与色块组合',
    imageUrl: '/wallpapers/abstract-6297317.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['抽象', '几何', '现代']
  },
  {
    id: 'ai-generated-9083808',
    name: 'AI 生成艺术 9083808',
    description: 'AI 生成的未来风格艺术背景',
    imageUrl: '/wallpapers/ai-generated-9083808.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'tech',
    tags: ['AI', '科技', '未来', '抽象']
  },
  {
    id: 'beach-4938036',
    name: '海滩 4938036',
    description: '沙滩与海浪的自然风景，清新舒适',
    imageUrl: '/wallpapers/beach-4938036.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['海滩', '海浪', '自然']
  },
  {
    id: 'bulb-5665770',
    name: '灯泡创意 5665770',
    description: '象征创意与灵感的灯泡主题',
    imageUrl: '/wallpapers/bulb-5665770.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'business',
    tags: ['灵感', '创意', '商务']
  },
  {
    id: 'cpu-8892400',
    name: '芯片电路 8892400',
    description: 'CPU 芯片与电路板，科技感十足',
    imageUrl: '/wallpapers/cpu-8892400.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'tech',
    tags: ['芯片', '电路', '科技']
  },
  {
    id: 'feather-5488401',
    name: '羽毛特写 5488401',
    description: '柔和的羽毛质感，细节丰富',
    imageUrl: '/wallpapers/feather-5488401.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['羽毛', '纹理', '自然']
  },
  {
    id: 'fractal-8902060',
    name: '分形艺术 8902060',
    description: '绚丽分形图案，抽象艺术风格',
    imageUrl: '/wallpapers/fractal-8902060.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['分形', '抽象', '艺术']
  },
  {
    id: 'orange-3036097',
    name: '橙子切片 3036097',
    description: '鲜艳的橙子切片，色彩明快',
    imageUrl: '/wallpapers/orange-3036097.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['水果', '橙色', '清新']
  },
  {
    id: 'orange-6508617',
    name: '橙色背景 6508617',
    description: '明亮的橙色主题背景，活力十足',
    imageUrl: '/wallpapers/orange-6508617.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['橙色', '明亮', '水果']
  },
  {
    id: 'polar-lights-5858656',
    name: '极光 5858656',
    description: '北极光夜空，梦幻自然景象',
    imageUrl: '/wallpapers/polar-lights-5858656.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['极光', '夜空', '自然']
  },
  {
    id: 'spiral-3112405',
    name: '螺旋图案 3112405',
    description: '抽象螺旋纹理，具有动感与层次',
    imageUrl: '/wallpapers/spiral-3112405.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['螺旋', '抽象', '纹理']
  },
  {
    id: 'steelwool-458842',
    name: '钢丝棉光绘 458842',
    description: '长曝光光绘效果，抽象且富有动感',
    imageUrl: '/wallpapers/steelwool-458842.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['光绘', '长曝光', '抽象']
  },
  {
    id: 'swimming-pool-8306716',
    name: '泳池水纹 8306716',
    description: '泳池水面波纹，清凉舒适的夏日氛围',
    imageUrl: '/wallpapers/swimming-pool-8306716.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['水', '夏日', '清新']
  },
  // 预设：pre 目录
  {
    id: 'abstract-2426502',
    name: '抽象色彩 2426502',
    description: '抽象色彩与形状的现代设计',
    imageUrl: '/wallpapers/abstract-2426502.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['抽象', '色彩', '形状']
  },
  {
    id: 'camera-1248682',
    name: '相机特写 1248682',
    description: '相机与镜头特写，具有质感的科技风',
    imageUrl: '/wallpapers/camera-1248682.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'tech',
    tags: ['相机', '摄影', '科技']
  },
  {
    id: 'circle-5090539',
    name: '圆形几何 5090539',
    description: '简约的圆形几何图案，适合视觉统一的版面',
    imageUrl: '/wallpapers/circle-5090539.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'minimal',
    tags: ['圆形', '几何', '简约']
  },
  {
    id: 'feather-7009025',
    name: '羽毛纹理 7009025',
    description: '轻柔的羽毛质感，细腻的自然纹理',
    imageUrl: '/wallpapers/feather-7009025.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['羽毛', '自然', '纹理']
  },
  {
    id: 'fiber-4814456',
    name: '光纤线条 4814456',
    description: '光纤与线条的抽象科技感',
    imageUrl: '/wallpapers/fiber-4814456.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'tech',
    tags: ['光纤', '线条', '科技']
  },
  {
    id: 'frost-6702335',
    name: '霜冻纹理 6702335',
    description: '寒冷质感的冰霜纹理背景',
    imageUrl: '/wallpapers/frost-6702335.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['霜', '冰', '冷色']
  },
  {
    id: 'leaves-4291098',
    name: '绿叶 4291098',
    description: '绿色叶片的自然纹理，清新治愈',
    imageUrl: '/wallpapers/leaves-4291098.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['叶子', '绿色', '自然']
  },
  {
    id: 'light-1834289',
    name: '光影散景 1834289',
    description: '光影散景效果，氛围感十足的抽象背景',
    imageUrl: '/wallpapers/light-1834289.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['光影', '散景', '抽象']
  },
  {
    id: 'light-942231',
    name: '灯光线条 942231',
    description: '流动的灯光线条，充满动感的抽象背景',
    imageUrl: '/wallpapers/light-942231.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['光', '线条', '抽象']
  },
  {
    id: 'luck-4397584',
    name: '四叶草 4397584',
    description: '幸运的四叶草，清新自然的绿色调',
    imageUrl: '/wallpapers/luck-4397584.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['四叶草', '绿色', '自然']
  },
  {
    id: 'waterdrop-2256201',
    name: '水滴特写 2256201',
    description: '水滴与表面张力的微距质感',
    imageUrl: '/wallpapers/waterdrop-2256201.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['水滴', '宏观', '自然']
  }
]

// 按分类组织的壁纸
export const WALLPAPER_CATEGORIES = {
  abstract: {
    name: '抽象艺术',
    icon: '🎨',
    description: '抽象图案、艺术创作和现代设计',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'abstract')
  },
  minimal: {
    name: '简约风格',
    icon: '⚪',
    description: '简洁几何、极简设计和纯净美学',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'minimal')
  },
  nature: {
    name: '自然风光',
    icon: '🌿',
    description: '自然景观、植物纹理和有机形态',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'nature')
  },
  business: {
    name: '商务专业',
    icon: '💼',
    description: '商务场景、专业氛围和企业风格',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'business')
  },
  tech: {
    name: '科技未来',
    icon: '🔬',
    description: '科技元素、未来感和数字艺术',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'tech')
  }
}

// 获取所有壁纸
export function getAllWallpapers(): ImagePreset[] {
  return WALLPAPER_PRESETS
}

// 根据分类获取壁纸
export function getWallpapersByCategory(category: string): ImagePreset[] {
  return WALLPAPER_PRESETS.filter(w => w.category === category)
}

// 根据ID获取壁纸
export function getWallpaperById(id: string): ImagePreset | undefined {
  return WALLPAPER_PRESETS.find(w => w.id === id)
}

// 搜索壁纸
export function searchWallpapers(query: string): ImagePreset[] {
  const lowerQuery = query.toLowerCase()
  return WALLPAPER_PRESETS.filter(w =>
    w.name.toLowerCase().includes(lowerQuery) ||
    w.description?.toLowerCase().includes(lowerQuery) ||
    w.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
  )
}

// 获取随机壁纸
export function getRandomWallpaper(): ImagePreset {
  const randomIndex = Math.floor(Math.random() * WALLPAPER_PRESETS.length)
  return WALLPAPER_PRESETS[randomIndex]
}

// 根据分类获取随机壁纸
export function getRandomWallpaperByCategory(category: string): ImagePreset | undefined {
  const categoryWallpapers = getWallpapersByCategory(category)
  if (categoryWallpapers.length === 0) return undefined
  const randomIndex = Math.floor(Math.random() * categoryWallpapers.length)
  return categoryWallpapers[randomIndex]
}

// 获取壁纸统计信息
export function getWallpaperStats() {
  const stats = {
    total: WALLPAPER_PRESETS.length,
    byCategory: {} as Record<string, number>,
    categories: Object.keys(WALLPAPER_CATEGORIES).length
  }

  Object.entries(WALLPAPER_CATEGORIES).forEach(([key, category]) => {
    stats.byCategory[key] = category.wallpapers.length
  })

  return stats
}

// 验证壁纸配置
export function validateWallpaperPreset(preset: ImagePreset): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!preset.id || preset.id.trim() === '') {
    errors.push('壁纸ID不能为空')
  }

  if (!preset.name || preset.name.trim() === '') {
    errors.push('壁纸名称不能为空')
  }

  if (!preset.imageUrl || preset.imageUrl.trim() === '') {
    errors.push('壁纸图片URL不能为空')
  }

  if (!preset.config) {
    errors.push('壁纸配置不能为空')
  } else {
    if (!['cover', 'contain', 'fill', 'stretch'].includes(preset.config.fit)) {
      errors.push('无效的适应模式')
    }

    if (!['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(preset.config.position)) {
      errors.push('无效的位置设置')
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}
