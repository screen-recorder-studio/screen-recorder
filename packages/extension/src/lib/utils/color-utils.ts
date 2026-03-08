// 颜色工具函数
import type { SolidColorPreset } from '../types/background'
import { PRESET_SOLID_COLORS } from '../stores/background-config.svelte'

/**
 * 颜色格式验证
 */
export function isValidColor(color: string): boolean {
  // 支持的颜色格式
  const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
  const rgbPattern = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/
  const rgbaPattern = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/
  const hslPattern = /^hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\)$/
  const hslaPattern = /^hsla\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*,\s*[\d.]+\s*\)$/
  
  return hexPattern.test(color) || 
         rgbPattern.test(color) || 
         rgbaPattern.test(color) ||
         hslPattern.test(color) ||
         hslaPattern.test(color)
}

/**
 * 将颜色转换为十六进制格式
 */
export function toHexColor(color: string): string {
  // 如果已经是十六进制格式，直接返回
  if (color.startsWith('#')) {
    return color
  }
  
  // 创建临时元素来获取计算后的颜色值
  const div = document.createElement('div')
  div.style.color = color
  document.body.appendChild(div)
  
  const computedColor = window.getComputedStyle(div).color
  document.body.removeChild(div)
  
  // 解析 rgb 值
  const rgbMatch = computedColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1])
    const g = parseInt(rgbMatch[2])
    const b = parseInt(rgbMatch[3])
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
  
  return color // 如果无法转换，返回原值
}

/**
 * 计算颜色亮度
 */
export function getColorLuminance(color: string): number {
  const hex = toHexColor(color).replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16) / 255
  const g = parseInt(hex.substr(2, 2), 16) / 255
  const b = parseInt(hex.substr(4, 2), 16) / 255
  
  // 使用相对亮度公式
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance
}

/**
 * 判断颜色是否为深色
 */
export function isDarkColor(color: string): boolean {
  return getColorLuminance(color) < 0.5
}

/**
 * 获取对比色（黑色或白色）
 */
export function getContrastColor(color: string): string {
  return isDarkColor(color) ? '#ffffff' : '#000000'
}

/**
 * 搜索颜色预设
 */
export function searchColors(query: string): SolidColorPreset[] {
  const lowerQuery = query.toLowerCase()
  return PRESET_SOLID_COLORS.filter(color => 
    color.name.toLowerCase().includes(lowerQuery) ||
    color.color.toLowerCase().includes(lowerQuery) ||
    color.id.toLowerCase().includes(lowerQuery) ||
    (color.category && color.category.toLowerCase().includes(lowerQuery))
  )
}

/**
 * 按分类获取颜色
 */
export function getColorsByCategory(category: string): SolidColorPreset[] {
  return PRESET_SOLID_COLORS.filter(color => color.category === category)
}

/**
 * 获取随机颜色
 */
export function getRandomColor(): SolidColorPreset {
  const randomIndex = Math.floor(Math.random() * PRESET_SOLID_COLORS.length)
  return PRESET_SOLID_COLORS[randomIndex]
}

/**
 * 获取颜色统计信息
 */
export function getColorStats() {
  const stats = {
    total: PRESET_SOLID_COLORS.length,
    byCategory: {} as Record<string, number>
  }
  
  PRESET_SOLID_COLORS.forEach(color => {
    const category = color.category || 'uncategorized'
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1
  })
  
  return stats
}

/**
 * 生成颜色调色板
 */
export function generateColorPalette(baseColor: string, count: number = 5): string[] {
  const hex = toHexColor(baseColor).replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  
  const palette: string[] = []
  
  for (let i = 0; i < count; i++) {
    const factor = (i + 1) / (count + 1)
    const newR = Math.round(r + (255 - r) * factor)
    const newG = Math.round(g + (255 - g) * factor)
    const newB = Math.round(b + (255 - b) * factor)
    
    const newHex = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
    palette.push(newHex)
  }
  
  return palette
}
