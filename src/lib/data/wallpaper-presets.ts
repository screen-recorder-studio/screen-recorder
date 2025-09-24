// Built-in wallpaper preset configurations
import type { ImagePreset } from '$lib/types/background'

// Wallpaper preset data
export const WALLPAPER_PRESETS: ImagePreset[] = [
  {
    id: 'gradient-abstract-1',
    name: 'Abstract Gradient',
    description: 'Modern abstract gradient background, perfect for tech and creative content',
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
    tags: ['gradient', 'abstract', 'modern', 'tech']
  },
  {
    id: 'geometric-pattern-1',
    name: 'Geometric Pattern',
    description: 'Clean geometric pattern background, ideal for business and professional content',
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
    tags: ['geometric', 'pattern', 'minimal', 'business']
  },
  // Additional wallpapers (from static/wallpapers)
  {
    id: 'abstract-2425706',
    name: 'Abstract Colors',
    description: 'Vibrant abstract color texture with strong visual impact',
    imageUrl: '/wallpapers/abstract-2425706.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['abstract', 'colors', 'texture']
  },
  {
    id: 'abstract-2512412',
    name: 'Abstract Colors',
    description: 'Flowing abstract color background, perfect for creative content',
    imageUrl: '/wallpapers/abstract-2512412.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['abstract', 'gradient', 'artistic']
  },
  {
    id: 'abstract-6297317',
    name: 'Abstract Forms',
    description: 'Abstract geometric forms with color block composition',
    imageUrl: '/wallpapers/abstract-6297317.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['abstract', 'geometric', 'modern']
  },
  {
    id: 'ai-generated-9083808',
    name: 'AI Generated Art',
    description: 'AI-generated futuristic art background',
    imageUrl: '/wallpapers/ai-generated-9083808.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'tech',
    tags: ['AI', 'technology', 'futuristic', 'abstract']
  },
  {
    id: 'beach-4938036',
    name: 'Beach',
    description: 'Natural beach scenery with sand and waves, fresh and comfortable',
    imageUrl: '/wallpapers/beach-4938036.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['beach', 'waves', 'nature']
  },
  {
    id: 'bulb-5665770',
    name: 'Creative Bulb',
    description: 'Light bulb theme symbolizing creativity and inspiration',
    imageUrl: '/wallpapers/bulb-5665770.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'business',
    tags: ['inspiration', 'creativity', 'business']
  },
  {
    id: 'cpu-8892400',
    name: 'CPU Circuit',
    description: 'CPU chip and circuit board with high-tech appeal',
    imageUrl: '/wallpapers/cpu-8892400.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'tech',
    tags: ['chip', 'circuit', 'technology']
  },
  {
    id: 'feather-5488401',
    name: 'Feather Close-up',
    description: 'Soft feather texture with rich detail',
    imageUrl: '/wallpapers/feather-5488401.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['feather', 'texture', 'nature']
  },
  {
    id: 'fractal-8902060',
    name: 'Fractal Art',
    description: 'Brilliant fractal patterns in abstract art style',
    imageUrl: '/wallpapers/fractal-8902060.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['fractal', 'abstract', 'artistic']
  },
  {
    id: 'orange-3036097',
    name: 'Orange Slice',
    description: 'Vibrant orange slices with bright colors',
    imageUrl: '/wallpapers/orange-3036097.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['fruit', 'orange', 'fresh']
  },
  {
    id: 'orange-6508617',
    name: 'Orange Background',
    description: 'Bright orange themed background full of energy',
    imageUrl: '/wallpapers/orange-6508617.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['orange', 'bright', 'fruit']
  },
  {
    id: 'polar-lights-5858656',
    name: 'Aurora',
    description: 'Northern lights night sky, dreamy natural phenomenon',
    imageUrl: '/wallpapers/polar-lights-5858656.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['aurora', 'night sky', 'nature']
  },
  {
    id: 'spiral-3112405',
    name: 'Spiral Pattern',
    description: 'Abstract spiral texture with dynamic layers',
    imageUrl: '/wallpapers/spiral-3112405.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['spiral', 'abstract', 'texture']
  },
  {
    id: 'steelwool-458842',
    name: 'Steel Wool Light Painting',
    description: 'Long exposure light painting effect, abstract and dynamic',
    imageUrl: '/wallpapers/steelwool-458842.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['light painting', 'long exposure', 'abstract']
  },
  {
    id: 'swimming-pool-8306716',
    name: 'Pool Ripples',
    description: 'Swimming pool water ripples with cool summer atmosphere',
    imageUrl: '/wallpapers/swimming-pool-8306716.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['water', 'summer', 'fresh']
  },
  // Presets: pre directory
  {
    id: 'abstract-2426502',
    name: 'Abstract Colors',
    description: 'Modern design with abstract colors and shapes',
    imageUrl: '/wallpapers/abstract-2426502.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['abstract', 'colors', 'shapes']
  },
  {
    id: 'camera-1248682',
    name: 'Camera Close-up',
    description: 'Camera and lens close-up with textured tech style',
    imageUrl: '/wallpapers/camera-1248682.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'tech',
    tags: ['camera', 'photography', 'technology']
  },
  {
    id: 'circle-5090539',
    name: 'Circular Geometry',
    description: 'Clean circular geometric pattern, perfect for visually unified layouts',
    imageUrl: '/wallpapers/circle-5090539.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'minimal',
    tags: ['circular', 'geometric', 'minimal']
  },
  {
    id: 'feather-7009025',
    name: 'Feather Texture',
    description: 'Soft feather texture with delicate natural patterns',
    imageUrl: '/wallpapers/feather-7009025.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['feather', 'nature', 'texture']
  },
  {
    id: 'fiber-4814456',
    name: 'Fiber Lines',
    description: 'Abstract tech feel with fiber optics and lines',
    imageUrl: '/wallpapers/fiber-4814456.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'tech',
    tags: ['fiber optic', 'lines', 'technology']
  },
  {
    id: 'frost-6702335',
    name: 'Frost Texture',
    description: 'Cold textured frost pattern background',
    imageUrl: '/wallpapers/frost-6702335.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['frost', 'ice', 'cool tones']
  },
  {
    id: 'leaves-4291098',
    name: 'Green Leaves',
    description: 'Natural texture of green leaves, fresh and healing',
    imageUrl: '/wallpapers/leaves-4291098.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['leaves', 'green', 'nature']
  },
  {
    id: 'light-1834289',
    name: 'Light Bokeh',
    description: 'Light and shadow bokeh effect, atmospheric abstract background',
    imageUrl: '/wallpapers/light-1834289.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['light', 'bokeh', 'abstract']
  },
  {
    id: 'light-942231',
    name: 'Light Streaks',
    description: 'Flowing light streaks, dynamic abstract background',
    imageUrl: '/wallpapers/light-942231.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'abstract',
    tags: ['light', 'streaks', 'abstract']
  },
  {
    id: 'luck-4397584',
    name: 'Four-leaf Clover',
    description: 'Lucky four-leaf clover with fresh natural green tones',
    imageUrl: '/wallpapers/luck-4397584.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['clover', 'green', 'nature']
  },
  {
    id: 'waterdrop-2256201',
    name: 'Water Drop Close-up',
    description: 'Water drop and surface tension macro texture',
    imageUrl: '/wallpapers/waterdrop-2256201.webp',
    config: { fit: 'cover', position: 'center', opacity: 1, blur: 0, scale: 1, offsetX: 0, offsetY: 0 },
    category: 'nature',
    tags: ['water drop', 'macro', 'nature']
  }
]

// Wallpapers organized by category
export const WALLPAPER_CATEGORIES = {
  abstract: {
    name: 'Abstract Art',
    icon: '🎨',
    description: 'Abstract patterns, artistic creations and modern designs',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'abstract')
  },
  minimal: {
    name: 'Minimal Style',
    icon: '⚪',
    description: 'Clean geometry, minimalist design and pure aesthetics',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'minimal')
  },
  nature: {
    name: 'Nature Scenery',
    icon: '🌿',
    description: 'Natural landscapes, plant textures and organic forms',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'nature')
  },
  business: {
    name: 'Business Professional',
    icon: '💼',
    description: 'Business scenes, professional atmosphere and corporate style',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'business')
  },
  tech: {
    name: 'Tech Future',
    icon: '🔬',
    description: 'Technology elements, futuristic feel and digital art',
    wallpapers: WALLPAPER_PRESETS.filter(w => w.category === 'tech')
  }
}

// Get all wallpapers
export function getAllWallpapers(): ImagePreset[] {
  return WALLPAPER_PRESETS
}

// Get wallpapers by category
export function getWallpapersByCategory(category: string): ImagePreset[] {
  return WALLPAPER_PRESETS.filter(w => w.category === category)
}

// Get wallpaper by ID
export function getWallpaperById(id: string): ImagePreset | undefined {
  return WALLPAPER_PRESETS.find(w => w.id === id)
}

// Search wallpapers
export function searchWallpapers(query: string): ImagePreset[] {
  const lowerQuery = query.toLowerCase()
  return WALLPAPER_PRESETS.filter(w =>
    w.name.toLowerCase().includes(lowerQuery) ||
    w.description?.toLowerCase().includes(lowerQuery) ||
    w.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
  )
}

// Get random wallpaper
export function getRandomWallpaper(): ImagePreset {
  const randomIndex = Math.floor(Math.random() * WALLPAPER_PRESETS.length)
  return WALLPAPER_PRESETS[randomIndex]
}

// Get random wallpaper by category
export function getRandomWallpaperByCategory(category: string): ImagePreset | undefined {
  const categoryWallpapers = getWallpapersByCategory(category)
  if (categoryWallpapers.length === 0) return undefined
  const randomIndex = Math.floor(Math.random() * categoryWallpapers.length)
  return categoryWallpapers[randomIndex]
}

// Get wallpaper statistics
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

// Validate wallpaper configuration
export function validateWallpaperPreset(preset: ImagePreset): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!preset.id || preset.id.trim() === '') {
    errors.push('Wallpaper ID cannot be empty')
  }

  if (!preset.name || preset.name.trim() === '') {
    errors.push('Wallpaper name cannot be empty')
  }

  if (!preset.imageUrl || preset.imageUrl.trim() === '') {
    errors.push('Wallpaper image URL cannot be empty')
  }

  if (!preset.config) {
    errors.push('Wallpaper configuration cannot be empty')
  } else {
    if (!['cover', 'contain', 'fill', 'stretch'].includes(preset.config.fit)) {
      errors.push('Invalid fit mode')
    }

    if (!['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(preset.config.position)) {
      errors.push('Invalid position setting')
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}
