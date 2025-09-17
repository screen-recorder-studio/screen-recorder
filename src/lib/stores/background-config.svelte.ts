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

// 预设纯色配置 - 每个分类16种颜色
export const PRESET_SOLID_COLORS: SolidColorPreset[] = [
  // 基础色系 (16种)
  { id: 'white', name: '纯白', color: '#ffffff', category: 'basic' },
  { id: 'snow', name: '雪白', color: '#fffafa', category: 'basic' },
  { id: 'ivory', name: '象牙白', color: '#fffff0', category: 'basic' },
  { id: 'beige', name: '米色', color: '#f5f5dc', category: 'basic' },
  { id: 'light-gray-1', name: '极浅灰', color: '#f8f9fa', category: 'basic' },
  { id: 'light-gray-2', name: '浅灰', color: '#e9ecef', category: 'basic' },
  { id: 'light-gray-3', name: '淡灰', color: '#dee2e6', category: 'basic' },
  { id: 'light-gray-4', name: '银灰', color: '#ced4da', category: 'basic' },
  { id: 'gray-1', name: '中浅灰', color: '#adb5bd', category: 'basic' },
  { id: 'gray-2', name: '中灰', color: '#6c757d', category: 'basic' },
  { id: 'gray-3', name: '中深灰', color: '#495057', category: 'basic' },
  { id: 'dark-gray-1', name: '深灰', color: '#343a40', category: 'basic' },
  { id: 'dark-gray-2', name: '炭灰', color: '#2d3436', category: 'basic' },
  { id: 'dark-gray-3', name: '石墨', color: '#212529', category: 'basic' },
  { id: 'charcoal', name: '木炭色', color: '#1a1a1a', category: 'basic' },
  { id: 'black', name: '纯黑', color: '#000000', category: 'basic' },

  // 浅色系 (16种)
  { id: 'light-blue-1', name: '天蓝', color: '#e3f2fd', category: 'light' },
  { id: 'light-blue-2', name: '浅蓝', color: '#bbdefb', category: 'light' },
  { id: 'light-green-1', name: '薄荷绿', color: '#e8f5e8', category: 'light' },
  { id: 'light-green-2', name: '浅绿', color: '#c8e6c9', category: 'light' },
  { id: 'light-yellow-1', name: '柠檬黄', color: '#fffde7', category: 'light' },
  { id: 'light-yellow-2', name: '浅黄', color: '#fff9c4', category: 'light' },
  { id: 'light-pink-1', name: '樱花粉', color: '#fce4ec', category: 'light' },
  { id: 'light-pink-2', name: '浅粉', color: '#f8bbd9', category: 'light' },
  { id: 'light-purple-1', name: '薰衣草', color: '#f3e5f5', category: 'light' },
  { id: 'light-purple-2', name: '浅紫', color: '#e1bee7', category: 'light' },
  { id: 'light-orange-1', name: '桃色', color: '#fff3e0', category: 'light' },
  { id: 'light-orange-2', name: '浅橙', color: '#ffcc80', category: 'light' },
  { id: 'light-cyan-1', name: '浅青', color: '#e0f2f1', category: 'light' },
  { id: 'light-cyan-2', name: '水青', color: '#b2dfdb', category: 'light' },
  { id: 'light-red-1', name: '浅红', color: '#ffebee', category: 'light' },
  { id: 'light-red-2', name: '玫瑰粉', color: '#ffcdd2', category: 'light' },

  // 深色系 (16种)
  { id: 'dark-blue-1', name: '深蓝', color: '#0d47a1', category: 'dark' },
  { id: 'dark-blue-2', name: '海军蓝', color: '#1a237e', category: 'dark' },
  { id: 'dark-blue-3', name: '午夜蓝', color: '#191970', category: 'dark' },
  { id: 'dark-blue-4', name: '钢蓝', color: '#1e3a8a', category: 'dark' },
  { id: 'dark-green-1', name: '深绿', color: '#1b5e20', category: 'dark' },
  { id: 'dark-green-2', name: '森林绿', color: '#2e7d32', category: 'dark' },
  { id: 'dark-green-3', name: '橄榄绿', color: '#33691e', category: 'dark' },
  { id: 'dark-green-4', name: '墨绿', color: '#1a4d3a', category: 'dark' },
  { id: 'dark-red-1', name: '深红', color: '#b71c1c', category: 'dark' },
  { id: 'dark-red-2', name: '酒红', color: '#880e4f', category: 'dark' },
  { id: 'dark-red-3', name: '栗色', color: '#4a148c', category: 'dark' },
  { id: 'dark-red-4', name: '暗红', color: '#8b0000', category: 'dark' },
  { id: 'dark-purple-1', name: '深紫', color: '#4a148c', category: 'dark' },
  { id: 'dark-purple-2', name: '茄紫', color: '#6a1b9a', category: 'dark' },
  { id: 'dark-brown-1', name: '深棕', color: '#3e2723', category: 'dark' },
  { id: 'dark-brown-2', name: '咖啡色', color: '#5d4037', category: 'dark' },

  // 商务色系 (16种)
  { id: 'business-blue-1', name: '商务蓝', color: '#0066cc', category: 'business' },
  { id: 'business-blue-2', name: '企业蓝', color: '#1976d2', category: 'business' },
  { id: 'business-blue-3', name: '专业蓝', color: '#1565c0', category: 'business' },
  { id: 'business-blue-4', name: '科技蓝', color: '#0277bd', category: 'business' },
  { id: 'business-gray-1', name: '商务灰', color: '#455a64', category: 'business' },
  { id: 'business-gray-2', name: '石板灰', color: '#475569', category: 'business' },
  { id: 'business-gray-3', name: '钢铁灰', color: '#546e7a', category: 'business' },
  { id: 'business-gray-4', name: '企业灰', color: '#37474f', category: 'business' },
  { id: 'business-green-1', name: '商务绿', color: '#2e7d32', category: 'business' },
  { id: 'business-green-2', name: '专业绿', color: '#388e3c', category: 'business' },
  { id: 'business-navy-1', name: '海军蓝', color: '#1e3a8a', category: 'business' },
  { id: 'business-navy-2', name: '深海蓝', color: '#1e40af', category: 'business' },
  { id: 'business-teal-1', name: '商务青', color: '#00695c', category: 'business' },
  { id: 'business-teal-2', name: '专业青', color: '#00796b', category: 'business' },
  { id: 'business-brown-1', name: '商务棕', color: '#5d4037', category: 'business' },
  { id: 'business-brown-2', name: '专业棕', color: '#6d4c41', category: 'business' },

  // 创意色系 (16种)
  { id: 'creative-red-1', name: '活力红', color: '#ef4444', category: 'creative' },
  { id: 'creative-red-2', name: '热情红', color: '#dc2626', category: 'creative' },
  { id: 'creative-orange-1', name: '创意橙', color: '#f97316', category: 'creative' },
  { id: 'creative-orange-2', name: '活力橙', color: '#ea580c', category: 'creative' },
  { id: 'creative-yellow-1', name: '阳光黄', color: '#eab308', category: 'creative' },
  { id: 'creative-yellow-2', name: '金黄', color: '#ca8a04', category: 'creative' },
  { id: 'creative-green-1', name: '翡翠绿', color: '#10b981', category: 'creative' },
  { id: 'creative-green-2', name: '生机绿', color: '#059669', category: 'creative' },
  { id: 'creative-blue-1', name: '天空蓝', color: '#3b82f6', category: 'creative' },
  { id: 'creative-blue-2', name: '海洋蓝', color: '#2563eb', category: 'creative' },
  { id: 'creative-purple-1', name: '紫罗兰', color: '#8b5cf6', category: 'creative' },
  { id: 'creative-purple-2', name: '梦幻紫', color: '#7c3aed', category: 'creative' },
  { id: 'creative-pink-1', name: '粉红色', color: '#ec4899', category: 'creative' },
  { id: 'creative-pink-2', name: '玫瑰红', color: '#db2777', category: 'creative' },
  { id: 'creative-cyan-1', name: '青色', color: '#06b6d4', category: 'creative' },
  { id: 'creative-cyan-2', name: '湖蓝', color: '#0891b2', category: 'creative' }
]

// 预设渐变配置 - 4种类别，每种8个渐变
export const PRESET_GRADIENTS: GradientPreset[] = [
  // 线性渐变 (8个)
  {
    id: 'linear-sunset',
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
    preview: 'linear-gradient(45deg, #ff7e5f 0%, #feb47b 100%)',
    category: 'linear'
  },
  {
    id: 'linear-ocean',
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
    preview: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    category: 'linear'
  },
  {
    id: 'linear-forest',
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
    preview: 'linear-gradient(90deg, #134e5e 0%, #71b280 100%)',
    category: 'linear'
  },
  {
    id: 'linear-purple-pink',
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
    preview: 'linear-gradient(45deg, #8b5cf6 0%, #ec4899 100%)',
    category: 'linear'
  },
  {
    id: 'linear-fire',
    name: '烈火',
    description: '火焰般的红橙渐变',
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
    name: '天空',
    description: '清晨天空的蓝白渐变',
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
    name: '薄荷',
    description: '清新的薄荷绿渐变',
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
    name: '黄金',
    description: '奢华的金色渐变',
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

  // 径向渐变 (8个)
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
    preview: 'radial-gradient(circle, #3b82f6 0%, #1e40af 100%)',
    category: 'radial'
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
    preview: 'radial-gradient(circle, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
    category: 'radial'
  },
  {
    id: 'radial-purple',
    name: '紫色光环',
    description: '神秘的紫色径向渐变',
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
    name: '绿色光点',
    description: '自然的绿色径向渐变',
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
    name: '日落光环',
    description: '温暖的日落径向渐变',
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
    name: '青色波纹',
    description: '清凉的青色径向渐变',
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
    name: '粉色光晕',
    description: '浪漫的粉色径向渐变',
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
    name: '暗夜光环',
    description: '深邃的暗色径向渐变',
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

  // 圆锥渐变 (8个)
  {
    id: 'conic-rainbow',
    name: '彩虹',
    description: '完整的彩虹色圆锥渐变',
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
    name: '日落旋转',
    description: '温暖的日落色圆锥渐变',
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
    name: '海洋漩涡',
    description: '蓝色系圆锥渐变',
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
    name: '紫色漩涡',
    description: '神秘的紫色圆锥渐变',
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
    name: '火焰旋转',
    description: '火焰色圆锥渐变',
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
    name: '绿色旋转',
    description: '自然绿色圆锥渐变',
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
    name: '黄金旋转',
    description: '奢华的金色圆锥渐变',
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
    name: '冷色旋转',
    description: '清凉的冷色圆锥渐变',
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

  // 多色渐变 (8个) - 复杂的多色线性渐变
  {
    id: 'multicolor-aurora',
    name: '极光',
    description: '绚烂的极光多色渐变',
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
    name: '热带',
    description: '热带风情多色渐变',
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
    name: '宇宙',
    description: '神秘的宇宙多色渐变',
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
    name: '糖果',
    description: '甜美的糖果多色渐变',
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
    name: '霓虹',
    description: '炫酷的霓虹多色渐变',
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
    name: '春天',
    description: '清新的春天多色渐变',
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
    name: '银河',
    description: '深邃的银河多色渐变',
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
    name: '彩霞',
    description: '绚烂的彩霞多色渐变',
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
