// Export utilities for video export functionality

import type { BackgroundConfig } from '$lib/types/background'
import type { VideoCropStore } from '$lib/stores/video-crop.svelte'
import { videoZoomStore } from '$lib/stores/video-zoom.svelte'

/**
 * Extract source video information from encoded chunks
 */
export function extractSourceInfo(encodedChunks: any[], totalFramesAll?: number): {
  width: number
  height: number
  frameCount: number
  codec: string
  duration: number
  estimatedSize: number
} {
  if (!encodedChunks || encodedChunks.length === 0) {
    return {
      width: 1920,
      height: 1080,
      frameCount: 0,
      codec: 'unknown',
      duration: 0,
      estimatedSize: 0
    }
  }

  // Get dimensions from first chunk
  const firstChunk = encodedChunks[0]
  const width = firstChunk.codedWidth || 1920
  const height = firstChunk.codedHeight || 1080
  const codec = firstChunk.codec || 'vp9'

  // Frame count: use totalFramesAll if available, otherwise use chunks length
  const frameCount = totalFramesAll && totalFramesAll > 0 ? totalFramesAll : encodedChunks.length

  // Calculate duration (assume 30fps)
  const duration = frameCount / 30

  // Estimate file size (very rough estimate)
  const estimatedSize = encodedChunks.reduce((sum, chunk) => sum + (chunk.size || 0), 0)

  return {
    width,
    height,
    frameCount,
    codec,
    duration,
    estimatedSize
  }
}

/**
 * Convert Svelte 5 Proxy background config to plain object for worker transfer
 * This eliminates code duplication across MP4, WebM, and GIF exports
 */
export function convertBackgroundConfigForExport(
  backgroundConfig: any,
  videoCropStore: VideoCropStore
): any {
  if (!backgroundConfig) return undefined

  return {
    type: backgroundConfig.type,
    color: backgroundConfig.color,
    padding: backgroundConfig.padding,
    outputRatio: backgroundConfig.outputRatio,
    videoPosition: backgroundConfig.videoPosition,
    borderRadius: backgroundConfig.borderRadius,
    // 🆕 include current video zoom configuration for export
    videoZoom: videoZoomStore.getZoomConfig(),
    inset: backgroundConfig.inset,
    
    // Deep convert gradient object
    gradient: backgroundConfig.gradient ? {
      type: backgroundConfig.gradient.type,
      ...(backgroundConfig.gradient.type === 'linear' && 'angle' in backgroundConfig.gradient 
        ? { angle: backgroundConfig.gradient.angle } 
        : {}),
      ...(backgroundConfig.gradient.type === 'radial' && 'centerX' in backgroundConfig.gradient 
        ? {
            centerX: backgroundConfig.gradient.centerX,
            centerY: backgroundConfig.gradient.centerY,
            radius: backgroundConfig.gradient.radius
          } 
        : {}),
      ...(backgroundConfig.gradient.type === 'conic' && 'centerX' in backgroundConfig.gradient 
        ? {
            centerX: backgroundConfig.gradient.centerX,
            centerY: backgroundConfig.gradient.centerY,
            angle: 'angle' in backgroundConfig.gradient ? backgroundConfig.gradient.angle : 0
          } 
        : {}),
      stops: backgroundConfig.gradient.stops.map((stop: any) => ({
        color: stop.color,
        position: stop.position
      }))
    } : undefined,
    
    // Deep convert shadow object
    shadow: backgroundConfig.shadow ? {
      offsetX: backgroundConfig.shadow.offsetX,
      offsetY: backgroundConfig.shadow.offsetY,
      blur: backgroundConfig.shadow.blur,
      color: backgroundConfig.shadow.color
    } : undefined,
    
    // Deep convert image object
    image: backgroundConfig.image ? {
      imageId: backgroundConfig.image.imageId,
      imageBitmap: backgroundConfig.image.imageBitmap,
      fit: backgroundConfig.image.fit,
      position: backgroundConfig.image.position,
      opacity: backgroundConfig.image.opacity,
      blur: backgroundConfig.image.blur,
      scale: backgroundConfig.image.scale,
      offsetX: backgroundConfig.image.offsetX,
      offsetY: backgroundConfig.image.offsetY
    } : undefined,
    
    // Deep convert wallpaper object
    wallpaper: backgroundConfig.wallpaper ? {
      imageId: backgroundConfig.wallpaper.imageId,
      imageBitmap: backgroundConfig.wallpaper.imageBitmap,
      fit: backgroundConfig.wallpaper.fit,
      position: backgroundConfig.wallpaper.position,
      opacity: backgroundConfig.wallpaper.opacity,
      blur: backgroundConfig.wallpaper.blur,
      scale: backgroundConfig.wallpaper.scale,
      offsetX: backgroundConfig.wallpaper.offsetX,
      offsetY: backgroundConfig.wallpaper.offsetY
    } : undefined,
    
    // Get videoCrop from store
    videoCrop: videoCropStore.getCropConfig()
  }
}

/**
 * Calculate auto bitrate based on resolution and quality
 */
export function calculateAutoBitrate(
  width: number,
  height: number,
  quality: string,
  framerate: number = 30
): number {
  const pixels = width * height
  
  const qualityFactors: Record<string, number> = {
    'draft': 0.05,
    'balanced': 0.1,
    'high': 0.15,
    'best': 0.2
  }
  
  const factor = qualityFactors[quality] || 0.1
  return Math.round(pixels * framerate * factor)
}

/**
 * Format bytes to human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Format seconds to MM:SS
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Format seconds to human-readable time (for export time estimates)
 */
export function formatEstimatedTime(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `~${minutes}m ${remainingSeconds}s`
}
