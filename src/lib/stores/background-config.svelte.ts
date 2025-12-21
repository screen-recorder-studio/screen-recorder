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
  type: 'wallpaper',
  color: '#ffffff',
  padding: 60,
  outputRatio: '16:9',
  videoPosition: 'center',
  borderRadius: 0,
  customWidth: 1920,
  customHeight: 1080
}

// Preset solid colors - 16 colors per category
export const PRESET_SOLID_COLORS: SolidColorPreset[] = [
  // Basic colors (16)
  { id: 'white', name: 'White', color: '#ffffff', category: 'basic' },
  { id: 'snow', name: 'Snow', color: '#fffafa', category: 'basic' },
  { id: 'ivory', name: 'Ivory', color: '#fffff0', category: 'basic' },
  { id: 'beige', name: 'Beige', color: '#f5f5dc', category: 'basic' },
  { id: 'light-gray-1', name: 'Lightest Gray', color: '#f8f9fa', category: 'basic' },
  { id: 'light-gray-2', name: 'Lighter Gray', color: '#e9ecef', category: 'basic' },
  { id: 'light-gray-3', name: 'Light Gray', color: '#dee2e6', category: 'basic' },
  { id: 'light-gray-4', name: 'Silver', color: '#ced4da', category: 'basic' },
  { id: 'gray-1', name: 'Gray Light', color: '#adb5bd', category: 'basic' },
  { id: 'gray-2', name: 'Gray', color: '#6c757d', category: 'basic' },
  { id: 'gray-3', name: 'Gray Dark', color: '#495057', category: 'basic' },
  { id: 'dark-gray-1', name: 'Dark Gray', color: '#343a40', category: 'basic' },
  { id: 'dark-gray-2', name: 'Charcoal Gray', color: '#2d3436', category: 'basic' },
  { id: 'dark-gray-3', name: 'Graphite', color: '#212529', category: 'basic' },
  { id: 'charcoal', name: 'Charcoal', color: '#1a1a1a', category: 'basic' },
  { id: 'black', name: 'Black', color: '#000000', category: 'basic' },

  // Light colors (16)
  { id: 'light-blue-1', name: 'Sky Blue', color: '#e3f2fd', category: 'light' },
  { id: 'light-blue-2', name: 'Light Blue', color: '#bbdefb', category: 'light' },
  { id: 'light-green-1', name: 'Mint', color: '#e8f5e8', category: 'light' },
  { id: 'light-green-2', name: 'Light Green', color: '#c8e6c9', category: 'light' },
  { id: 'light-yellow-1', name: 'Lemon', color: '#fffde7', category: 'light' },
  { id: 'light-yellow-2', name: 'Light Yellow', color: '#fff9c4', category: 'light' },
  { id: 'light-pink-1', name: 'Cherry Blossom', color: '#fce4ec', category: 'light' },
  { id: 'light-pink-2', name: 'Light Pink', color: '#f8bbd9', category: 'light' },
  { id: 'light-purple-1', name: 'Lavender', color: '#f3e5f5', category: 'light' },
  { id: 'light-purple-2', name: 'Light Purple', color: '#e1bee7', category: 'light' },
  { id: 'light-orange-1', name: 'Peach', color: '#fff3e0', category: 'light' },
  { id: 'light-orange-2', name: 'Light Orange', color: '#ffcc80', category: 'light' },
  { id: 'light-cyan-1', name: 'Light Cyan', color: '#e0f2f1', category: 'light' },
  { id: 'light-cyan-2', name: 'Aqua', color: '#b2dfdb', category: 'light' },
  { id: 'light-red-1', name: 'Light Red', color: '#ffebee', category: 'light' },
  { id: 'light-red-2', name: 'Rose', color: '#ffcdd2', category: 'light' },

  // Dark colors (16)
  { id: 'dark-blue-1', name: 'Deep Blue', color: '#0d47a1', category: 'dark' },
  { id: 'dark-blue-2', name: 'Navy', color: '#1a237e', category: 'dark' },
  { id: 'dark-blue-3', name: 'Midnight Blue', color: '#191970', category: 'dark' },
  { id: 'dark-blue-4', name: 'Steel Blue', color: '#1e3a8a', category: 'dark' },
  { id: 'dark-green-1', name: 'Deep Green', color: '#1b5e20', category: 'dark' },
  { id: 'dark-green-2', name: 'Forest Green', color: '#2e7d32', category: 'dark' },
  { id: 'dark-green-3', name: 'Olive', color: '#33691e', category: 'dark' },
  { id: 'dark-green-4', name: 'Dark Green', color: '#1a4d3a', category: 'dark' },
  { id: 'dark-red-1', name: 'Deep Red', color: '#b71c1c', category: 'dark' },
  { id: 'dark-red-2', name: 'Wine', color: '#880e4f', category: 'dark' },
  { id: 'dark-red-3', name: 'Maroon', color: '#4a148c', category: 'dark' },
  { id: 'dark-red-4', name: 'Dark Red', color: '#8b0000', category: 'dark' },
  { id: 'dark-purple-1', name: 'Deep Purple', color: '#4a148c', category: 'dark' },
  { id: 'dark-purple-2', name: 'Eggplant', color: '#6a1b9a', category: 'dark' },
  { id: 'dark-brown-1', name: 'Dark Brown', color: '#3e2723', category: 'dark' },
  { id: 'dark-brown-2', name: 'Coffee', color: '#5d4037', category: 'dark' },

  // Business colors (16)
  { id: 'business-blue-1', name: 'Corporate Blue', color: '#0066cc', category: 'business' },
  { id: 'business-blue-2', name: 'Business Blue', color: '#1976d2', category: 'business' },
  { id: 'business-blue-3', name: 'Professional Blue', color: '#1565c0', category: 'business' },
  { id: 'business-blue-4', name: 'Tech Blue', color: '#0277bd', category: 'business' },
  { id: 'business-gray-1', name: 'Business Gray', color: '#455a64', category: 'business' },
  { id: 'business-gray-2', name: 'Slate', color: '#475569', category: 'business' },
  { id: 'business-gray-3', name: 'Steel Gray', color: '#546e7a', category: 'business' },
  { id: 'business-gray-4', name: 'Corporate Gray', color: '#37474f', category: 'business' },
  { id: 'business-green-1', name: 'Business Green', color: '#2e7d32', category: 'business' },
  { id: 'business-green-2', name: 'Professional Green', color: '#388e3c', category: 'business' },
  { id: 'business-navy-1', name: 'Navy Blue', color: '#1e3a8a', category: 'business' },
  { id: 'business-navy-2', name: 'Deep Navy', color: '#1e40af', category: 'business' },
  { id: 'business-teal-1', name: 'Business Teal', color: '#00695c', category: 'business' },
  { id: 'business-teal-2', name: 'Professional Teal', color: '#00796b', category: 'business' },
  { id: 'business-brown-1', name: 'Business Brown', color: '#5d4037', category: 'business' },
  { id: 'business-brown-2', name: 'Professional Brown', color: '#6d4c41', category: 'business' },

  // Creative colors (16)
  { id: 'creative-red-1', name: 'Vibrant Red', color: '#ef4444', category: 'creative' },
  { id: 'creative-red-2', name: 'Passion Red', color: '#dc2626', category: 'creative' },
  { id: 'creative-orange-1', name: 'Creative Orange', color: '#f97316', category: 'creative' },
  { id: 'creative-orange-2', name: 'Vibrant Orange', color: '#ea580c', category: 'creative' },
  { id: 'creative-yellow-1', name: 'Sunshine', color: '#eab308', category: 'creative' },
  { id: 'creative-yellow-2', name: 'Gold', color: '#ca8a04', category: 'creative' },
  { id: 'creative-green-1', name: 'Emerald', color: '#10b981', category: 'creative' },
  { id: 'creative-green-2', name: 'Fresh Green', color: '#059669', category: 'creative' },
  { id: 'creative-blue-1', name: 'Sky Blue', color: '#3b82f6', category: 'creative' },
  { id: 'creative-blue-2', name: 'Ocean Blue', color: '#2563eb', category: 'creative' },
  { id: 'creative-purple-1', name: 'Violet', color: '#8b5cf6', category: 'creative' },
  { id: 'creative-purple-2', name: 'Dream Purple', color: '#7c3aed', category: 'creative' },
  { id: 'creative-pink-1', name: 'Hot Pink', color: '#ec4899', category: 'creative' },
  { id: 'creative-pink-2', name: 'Rose Red', color: '#db2777', category: 'creative' },
  { id: 'creative-cyan-1', name: 'Cyan', color: '#06b6d4', category: 'creative' },
  { id: 'creative-cyan-2', name: 'Lake Blue', color: '#0891b2', category: 'creative' }
]

// Preset gradients - 4 categories, 8 gradients each
export const PRESET_GRADIENTS: GradientPreset[] = [
  // Linear gradients (8)
  {
    id: 'linear-sunset',
    name: 'Sunset',
    description: 'Warm orange-red gradient',
    config: {
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#ff7e5f', position: 0 },
        { color: '#feb47b', position: 1 }
      ]
    },
    preview: 'linear-gradient(45deg, #ff7e5f 0%, #feb47b 100%)',
    category: 'linear'
  },
  {
    id: 'linear-ocean',
    name: 'Ocean',
    description: 'Deep blue to light blue gradient',
    config: {
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#667eea', position: 0 },
        { color: '#764ba2', position: 1 }
      ]
    },
    preview: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    category: 'linear'
  },
  {
    id: 'linear-forest',
    name: 'Forest',
    description: 'Natural green gradient',
    config: {
      type: 'linear',
      angle: 90,
      stops: [
        { color: '#134e5e', position: 0 },
        { color: '#71b280', position: 1 }
      ]
    },
    preview: 'linear-gradient(90deg, #134e5e 0%, #71b280 100%)',
    category: 'linear'
  },
  {
    id: 'linear-purple-pink',
    name: 'Purple Pink',
    description: 'Purple to pink gradient',
    config: {
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#8b5cf6', position: 0 },
        { color: '#ec4899', position: 1 }
      ]
    },
    preview: 'linear-gradient(45deg, #8b5cf6 0%, #ec4899 100%)',
    category: 'linear'
  },
  {
    id: 'linear-fire',
    name: 'Fire',
    description: 'Flame-like red-orange gradient',
    config: {
      type: 'linear',
      angle: 180,
      stops: [
        { color: '#ff416c', position: 0 },
        { color: '#ff4b2b', position: 1 }
      ]
    },
    preview: 'linear-gradient(180deg, #ff416c 0%, #ff4b2b 100%)',
    category: 'linear'
  },
  {
    id: 'linear-sky',
    name: 'Sky',
    description: 'Morning sky blue-white gradient',
    config: {
      type: 'linear',
      angle: 0,
      stops: [
        { color: '#74b9ff', position: 0 },
        { color: '#0984e3', position: 1 }
      ]
    },
    preview: 'linear-gradient(0deg, #74b9ff 0%, #0984e3 100%)',
    category: 'linear'
  },
  {
    id: 'linear-mint',
    name: 'Mint',
    description: 'Fresh mint green gradient',
    config: {
      type: 'linear',
      angle: 315,
      stops: [
        { color: '#00b894', position: 0 },
        { color: '#00cec9', position: 1 }
      ]
    },
    preview: 'linear-gradient(315deg, #00b894 0%, #00cec9 100%)',
    category: 'linear'
  },
  {
    id: 'linear-gold',
    name: 'Gold',
    description: 'Luxurious gold gradient',
    config: {
      type: 'linear',
      angle: 225,
      stops: [
        { color: '#fdcb6e', position: 0 },
        { color: '#e17055', position: 1 }
      ]
    },
    preview: 'linear-gradient(225deg, #fdcb6e 0%, #e17055 100%)',
    category: 'linear'
  },

  // Radial gradients (8)
  {
    id: 'radial-blue',
    name: 'Blue Glow',
    description: 'Radial blue gradient',
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
    preview: 'radial-gradient(circle, #3b82f6 0%, #1e40af 100%)',
    category: 'radial'
  },
  {
    id: 'radial-warm',
    name: 'Warm Glow',
    description: 'Radial warm color gradient',
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
    preview: 'radial-gradient(circle, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
    category: 'radial'
  },
  {
    id: 'radial-purple',
    name: 'Purple Halo',
    description: 'Mysterious purple radial gradient',
    config: {
      type: 'radial',
      centerX: 0.3,
      centerY: 0.3,
      radius: 0.9,
      stops: [
        { color: '#a855f7', position: 0 },
        { color: '#6b21a8', position: 1 }
      ]
    },
    preview: 'radial-gradient(circle at 30% 30%, #a855f7 0%, #6b21a8 100%)',
    category: 'radial'
  },
  {
    id: 'radial-green',
    name: 'Green Spot',
    description: 'Natural green radial gradient',
    config: {
      type: 'radial',
      centerX: 0.7,
      centerY: 0.2,
      radius: 0.6,
      stops: [
        { color: '#22c55e', position: 0 },
        { color: '#15803d', position: 1 }
      ]
    },
    preview: 'radial-gradient(circle at 70% 20%, #22c55e 0%, #15803d 100%)',
    category: 'radial'
  },
  {
    id: 'radial-sunset',
    name: 'Sunset Halo',
    description: 'Warm sunset radial gradient',
    config: {
      type: 'radial',
      centerX: 0.5,
      centerY: 0.8,
      radius: 1.0,
      stops: [
        { color: '#fb923c', position: 0 },
        { color: '#f97316', position: 0.4 },
        { color: '#dc2626', position: 1 }
      ]
    },
    preview: 'radial-gradient(circle at 50% 80%, #fb923c 0%, #f97316 40%, #dc2626 100%)',
    category: 'radial'
  },
  {
    id: 'radial-cyan',
    name: 'Cyan Ripple',
    description: 'Cool cyan radial gradient',
    config: {
      type: 'radial',
      centerX: 0.2,
      centerY: 0.7,
      radius: 0.8,
      stops: [
        { color: '#06b6d4', position: 0 },
        { color: '#0891b2', position: 1 }
      ]
    },
    preview: 'radial-gradient(circle at 20% 70%, #06b6d4 0%, #0891b2 100%)',
    category: 'radial'
  },
  {
    id: 'radial-pink',
    name: 'Pink Glow',
    description: 'Romantic pink radial gradient',
    config: {
      type: 'radial',
      centerX: 0.6,
      centerY: 0.4,
      radius: 0.7,
      stops: [
        { color: '#f472b6', position: 0 },
        { color: '#ec4899', position: 0.6 },
        { color: '#be185d', position: 1 }
      ]
    },
    preview: 'radial-gradient(circle at 60% 40%, #f472b6 0%, #ec4899 60%, #be185d 100%)',
    category: 'radial'
  },
  {
    id: 'radial-dark',
    name: 'Dark Halo',
    description: 'Deep dark radial gradient',
    config: {
      type: 'radial',
      centerX: 0.5,
      centerY: 0.5,
      radius: 0.5,
      stops: [
        { color: '#4b5563', position: 0 },
        { color: '#1f2937', position: 1 }
      ]
    },
    preview: 'radial-gradient(circle, #4b5563 0%, #1f2937 100%)',
    category: 'radial'
  },

  // Conic gradients (8)
  {
    id: 'conic-rainbow',
    name: 'Rainbow',
    description: 'Full rainbow conic gradient',
    config: {
      type: 'conic',
      centerX: 0.5,
      centerY: 0.5,
      angle: 0,
      stops: [
        { color: '#ff0000', position: 0 },
        { color: '#ff8000', position: 0.17 },
        { color: '#ffff00', position: 0.33 },
        { color: '#00ff00', position: 0.5 },
        { color: '#0080ff', position: 0.67 },
        { color: '#8000ff', position: 0.83 },
        { color: '#ff0000', position: 1 }
      ]
    },
    preview: 'conic-gradient(from 0deg, #ff0000 0%, #ff8000 17%, #ffff00 33%, #00ff00 50%, #0080ff 67%, #8000ff 83%, #ff0000 100%)',
    category: 'conic'
  },
  {
    id: 'conic-sunset',
    name: 'Sunset Spin',
    description: 'Warm sunset conic gradient',
    config: {
      type: 'conic',
      centerX: 0.5,
      centerY: 0.5,
      angle: 45,
      stops: [
        { color: '#ff6b6b', position: 0 },
        { color: '#feca57', position: 0.5 },
        { color: '#ff6b6b', position: 1 }
      ]
    },
    preview: 'conic-gradient(from 45deg, #ff6b6b 0%, #feca57 50%, #ff6b6b 100%)',
    category: 'conic'
  },
  {
    id: 'conic-ocean',
    name: 'Ocean Swirl',
    description: 'Blue conic gradient',
    config: {
      type: 'conic',
      centerX: 0.3,
      centerY: 0.7,
      angle: 90,
      stops: [
        { color: '#74b9ff', position: 0 },
        { color: '#0984e3', position: 0.33 },
        { color: '#00b894', position: 0.67 },
        { color: '#74b9ff', position: 1 }
      ]
    },
    preview: 'conic-gradient(from 90deg at 30% 70%, #74b9ff 0%, #0984e3 33%, #00b894 67%, #74b9ff 100%)',
    category: 'conic'
  },
  {
    id: 'conic-purple',
    name: 'Purple Swirl',
    description: 'Mysterious purple conic gradient',
    config: {
      type: 'conic',
      centerX: 0.7,
      centerY: 0.3,
      angle: 180,
      stops: [
        { color: '#a855f7', position: 0 },
        { color: '#ec4899', position: 0.5 },
        { color: '#a855f7', position: 1 }
      ]
    },
    preview: 'conic-gradient(from 180deg at 70% 30%, #a855f7 0%, #ec4899 50%, #a855f7 100%)',
    category: 'conic'
  },
  {
    id: 'conic-fire',
    name: 'Fire Spin',
    description: 'Flame conic gradient',
    config: {
      type: 'conic',
      centerX: 0.5,
      centerY: 0.8,
      angle: 270,
      stops: [
        { color: '#ff4757', position: 0 },
        { color: '#ff6348', position: 0.25 },
        { color: '#ffa502', position: 0.5 },
        { color: '#ff4757', position: 1 }
      ]
    },
    preview: 'conic-gradient(from 270deg at 50% 80%, #ff4757 0%, #ff6348 25%, #ffa502 50%, #ff4757 100%)',
    category: 'conic'
  },
  {
    id: 'conic-green',
    name: 'Green Spin',
    description: 'Natural green conic gradient',
    config: {
      type: 'conic',
      centerX: 0.2,
      centerY: 0.2,
      angle: 315,
      stops: [
        { color: '#2ed573', position: 0 },
        { color: '#7bed9f', position: 0.33 },
        { color: '#70a1ff', position: 0.67 },
        { color: '#2ed573', position: 1 }
      ]
    },
    preview: 'conic-gradient(from 315deg at 20% 20%, #2ed573 0%, #7bed9f 33%, #70a1ff 67%, #2ed573 100%)',
    category: 'conic'
  },
  {
    id: 'conic-gold',
    name: 'Gold Spin',
    description: 'Luxurious gold conic gradient',
    config: {
      type: 'conic',
      centerX: 0.6,
      centerY: 0.6,
      angle: 135,
      stops: [
        { color: '#f39c12', position: 0 },
        { color: '#f1c40f', position: 0.5 },
        { color: '#f39c12', position: 1 }
      ]
    },
    preview: 'conic-gradient(from 135deg at 60% 60%, #f39c12 0%, #f1c40f 50%, #f39c12 100%)',
    category: 'conic'
  },
  {
    id: 'conic-cool',
    name: 'Cool Spin',
    description: 'Cool tones conic gradient',
    config: {
      type: 'conic',
      centerX: 0.4,
      centerY: 0.4,
      angle: 225,
      stops: [
        { color: '#3742fa', position: 0 },
        { color: '#2f3542', position: 0.25 },
        { color: '#40407a', position: 0.5 },
        { color: '#706fd3', position: 0.75 },
        { color: '#3742fa', position: 1 }
      ]
    },
    preview: 'conic-gradient(from 225deg at 40% 40%, #3742fa 0%, #2f3542 25%, #40407a 50%, #706fd3 75%, #3742fa 100%)',
    category: 'conic'
  },

  // Multicolor gradients (8) - Complex multi-color linear gradients
  {
    id: 'multicolor-aurora',
    name: 'Aurora',
    description: 'Brilliant aurora multicolor gradient',
    config: {
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#00ff87', position: 0 },
        { color: '#60efff', position: 0.25 },
        { color: '#ff006e', position: 0.5 },
        { color: '#8338ec', position: 0.75 },
        { color: '#3a86ff', position: 1 }
      ]
    },
    preview: 'linear-gradient(45deg, #00ff87 0%, #60efff 25%, #ff006e 50%, #8338ec 75%, #3a86ff 100%)',
    category: 'multicolor'
  },
  {
    id: 'multicolor-tropical',
    name: 'Tropical',
    description: 'Tropical vibes multicolor gradient',
    config: {
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#ff9a9e', position: 0 },
        { color: '#fecfef', position: 0.2 },
        { color: '#fecfef', position: 0.4 },
        { color: '#a8edea', position: 0.6 },
        { color: '#fed6e3', position: 0.8 },
        { color: '#d299c2', position: 1 }
      ]
    },
    preview: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 20%, #fecfef 40%, #a8edea 60%, #fed6e3 80%, #d299c2 100%)',
    category: 'multicolor'
  },
  {
    id: 'multicolor-cosmic',
    name: 'Cosmic',
    description: 'Mysterious cosmic multicolor gradient',
    config: {
      type: 'linear',
      angle: 90,
      stops: [
        { color: '#667eea', position: 0 },
        { color: '#764ba2', position: 0.2 },
        { color: '#f093fb', position: 0.4 },
        { color: '#f5576c', position: 0.6 },
        { color: '#4facfe', position: 0.8 },
        { color: '#00f2fe', position: 1 }
      ]
    },
    preview: 'linear-gradient(90deg, #667eea 0%, #764ba2 20%, #f093fb 40%, #f5576c 60%, #4facfe 80%, #00f2fe 100%)',
    category: 'multicolor'
  },
  {
    id: 'multicolor-candy',
    name: 'Candy',
    description: 'Sweet candy multicolor gradient',
    config: {
      type: 'linear',
      angle: 180,
      stops: [
        { color: '#ffecd2', position: 0 },
        { color: '#fcb69f', position: 0.16 },
        { color: '#ff9a9e', position: 0.33 },
        { color: '#fad0c4', position: 0.5 },
        { color: '#a8edea', position: 0.66 },
        { color: '#fed6e3', position: 0.83 },
        { color: '#d299c2', position: 1 }
      ]
    },
    preview: 'linear-gradient(180deg, #ffecd2 0%, #fcb69f 16%, #ff9a9e 33%, #fad0c4 50%, #a8edea 66%, #fed6e3 83%, #d299c2 100%)',
    category: 'multicolor'
  },
  {
    id: 'multicolor-neon',
    name: 'Neon',
    description: 'Cool neon multicolor gradient',
    config: {
      type: 'linear',
      angle: 270,
      stops: [
        { color: '#ff0080', position: 0 },
        { color: '#ff8c00', position: 0.2 },
        { color: '#40e0d0', position: 0.4 },
        { color: '#ff1493', position: 0.6 },
        { color: '#00ff00', position: 0.8 },
        { color: '#8a2be2', position: 1 }
      ]
    },
    preview: 'linear-gradient(270deg, #ff0080 0%, #ff8c00 20%, #40e0d0 40%, #ff1493 60%, #00ff00 80%, #8a2be2 100%)',
    category: 'multicolor'
  },
  {
    id: 'multicolor-spring',
    name: 'Spring',
    description: 'Fresh spring multicolor gradient',
    config: {
      type: 'linear',
      angle: 315,
      stops: [
        { color: '#a8e6cf', position: 0 },
        { color: '#dcedc1', position: 0.25 },
        { color: '#ffd3a5', position: 0.5 },
        { color: '#fd9853', position: 0.75 },
        { color: '#ff8a80', position: 1 }
      ]
    },
    preview: 'linear-gradient(315deg, #a8e6cf 0%, #dcedc1 25%, #ffd3a5 50%, #fd9853 75%, #ff8a80 100%)',
    category: 'multicolor'
  },
  {
    id: 'multicolor-galaxy',
    name: 'Galaxy',
    description: 'Deep galaxy multicolor gradient',
    config: {
      type: 'linear',
      angle: 225,
      stops: [
        { color: '#2c3e50', position: 0 },
        { color: '#3498db', position: 0.2 },
        { color: '#9b59b6', position: 0.4 },
        { color: '#e74c3c', position: 0.6 },
        { color: '#f39c12', position: 0.8 },
        { color: '#1abc9c', position: 1 }
      ]
    },
    preview: 'linear-gradient(225deg, #2c3e50 0%, #3498db 20%, #9b59b6 40%, #e74c3c 60%, #f39c12 80%, #1abc9c 100%)',
    category: 'multicolor'
  },
  {
    id: 'multicolor-sunset',
    name: 'Sunset Glow',
    description: 'Brilliant sunset multicolor gradient',
    config: {
      type: 'linear',
      angle: 0,
      stops: [
        { color: '#ff9a56', position: 0 },
        { color: '#ff6b6b', position: 0.2 },
        { color: '#ee5a6f', position: 0.4 },
        { color: '#ce4993', position: 0.6 },
        { color: '#a044ff', position: 0.8 },
        { color: '#6c5ce7', position: 1 }
      ]
    },
    preview: 'linear-gradient(0deg, #ff9a56 0%, #ff6b6b 20%, #ee5a6f 40%, #ce4993 60%, #a044ff 80%, #6c5ce7 100%)',
    category: 'multicolor'
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
