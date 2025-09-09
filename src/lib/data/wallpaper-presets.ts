// 内置壁纸预设配置
import type { ImagePreset } from '$lib/types/background'

// 壁纸预设数据
export const WALLPAPER_PRESETS: ImagePreset[] = [
  {
    id: 'gradient-abstract-1',
    name: '抽象渐变',
    description: '现代抽象渐变背景，适合科技和创意内容',
    imageUrl: '/wallpapers/gradient-7206609_1920.png',
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
    imageUrl: '/wallpapers/the-background-302467_1920.png',
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
  }
]

// 按分类组织的壁纸
export const WALLPAPER_CATEGORIES = {
  abstract: {
    name: '抽象',
    icon: '🎨',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'abstract')
  },
  minimal: {
    name: '简约',
    icon: '⚪',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'minimal')
  },
  nature: {
    name: '自然',
    icon: '🌿',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'nature')
  },
  business: {
    name: '商务',
    icon: '💼',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'business')
  },
  tech: {
    name: '科技',
    icon: '🔬',
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
