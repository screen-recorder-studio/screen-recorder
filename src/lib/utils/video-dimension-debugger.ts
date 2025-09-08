// 视频尺寸调试工具
// 用于诊断和修复视频拉伸问题

export interface DimensionInfo {
  source: string
  width: number
  height: number
  aspectRatio: number
  isValid: boolean
}

export interface VideoFrameAnalysis {
  displayDimensions: DimensionInfo
  codedDimensions: DimensionInfo
  visibleRectDimensions: DimensionInfo | null
  recommendedDimensions: DimensionInfo
}

export interface LayoutAnalysis {
  outputCanvas: DimensionInfo
  availableArea: DimensionInfo
  videoLayout: DimensionInfo & { x: number, y: number }
  scaleFactor: number
  isProportional: boolean
  distortionRatio: number
}

export class VideoDimensionDebugger {
  
  /**
   * 分析 VideoFrame 的尺寸信息
   */
  static analyzeVideoFrame(frame: VideoFrame, chunkInfo?: any): VideoFrameAnalysis {
    const displayDimensions: DimensionInfo = {
      source: 'displayWidth/Height',
      width: frame.displayWidth || 0,
      height: frame.displayHeight || 0,
      aspectRatio: 0,
      isValid: false
    }
    
    if (displayDimensions.width > 0 && displayDimensions.height > 0) {
      displayDimensions.aspectRatio = displayDimensions.width / displayDimensions.height
      displayDimensions.isValid = true
    }
    
    const codedDimensions: DimensionInfo = {
      source: 'codedWidth/Height',
      width: frame.codedWidth || 0,
      height: frame.codedHeight || 0,
      aspectRatio: 0,
      isValid: false
    }
    
    if (codedDimensions.width > 0 && codedDimensions.height > 0) {
      codedDimensions.aspectRatio = codedDimensions.width / codedDimensions.height
      codedDimensions.isValid = true
    }
    
    let visibleRectDimensions: DimensionInfo | null = null
    if (frame.visibleRect) {
      const vr = frame.visibleRect
      visibleRectDimensions = {
        source: 'visibleRect',
        width: vr.width,
        height: vr.height,
        aspectRatio: vr.width / vr.height,
        isValid: vr.width > 0 && vr.height > 0
      }
    }
    
    // 推荐使用的尺寸（优先级：displayWidth > visibleRect > codedWidth）
    let recommendedDimensions: DimensionInfo
    if (displayDimensions.isValid) {
      recommendedDimensions = { ...displayDimensions, source: 'display (recommended)' }
    } else if (visibleRectDimensions?.isValid) {
      recommendedDimensions = { ...visibleRectDimensions, source: 'visibleRect (recommended)' }
    } else if (codedDimensions.isValid) {
      recommendedDimensions = { ...codedDimensions, source: 'coded (recommended)' }
    } else {
      // 从 chunk 信息获取
      const chunkWidth = chunkInfo?.codedWidth || 1920
      const chunkHeight = chunkInfo?.codedHeight || 1080
      recommendedDimensions = {
        source: 'chunk fallback (recommended)',
        width: chunkWidth,
        height: chunkHeight,
        aspectRatio: chunkWidth / chunkHeight,
        isValid: true
      }
    }
    
    return {
      displayDimensions,
      codedDimensions,
      visibleRectDimensions,
      recommendedDimensions
    }
  }
  
  /**
   * 分析布局计算结果
   */
  static analyzeLayout(
    outputWidth: number,
    outputHeight: number,
    videoWidth: number,
    videoHeight: number,
    layoutX: number,
    layoutY: number,
    layoutWidth: number,
    layoutHeight: number,
    padding: number = 0
  ): LayoutAnalysis {
    
    const outputCanvas: DimensionInfo = {
      source: 'output canvas',
      width: outputWidth,
      height: outputHeight,
      aspectRatio: outputWidth / outputHeight,
      isValid: outputWidth > 0 && outputHeight > 0
    }
    
    const availableArea: DimensionInfo = {
      source: 'available area',
      width: outputWidth - padding * 2,
      height: outputHeight - padding * 2,
      aspectRatio: (outputWidth - padding * 2) / (outputHeight - padding * 2),
      isValid: true
    }
    
    const videoLayout: DimensionInfo & { x: number, y: number } = {
      source: 'video layout',
      width: layoutWidth,
      height: layoutHeight,
      aspectRatio: layoutWidth / layoutHeight,
      isValid: layoutWidth > 0 && layoutHeight > 0,
      x: layoutX,
      y: layoutY
    }
    
    // 计算缩放因子
    const scaleX = layoutWidth / videoWidth
    const scaleY = layoutHeight / videoHeight
    const scaleFactor = Math.min(scaleX, scaleY)
    
    // 检查是否保持比例
    const originalAspectRatio = videoWidth / videoHeight
    const layoutAspectRatio = layoutWidth / layoutHeight
    const aspectRatioDiff = Math.abs(originalAspectRatio - layoutAspectRatio)
    const isProportional = aspectRatioDiff < 0.01 // 允许1%的误差
    
    // 计算失真比例
    const distortionRatio = Math.max(scaleX / scaleY, scaleY / scaleX)
    
    return {
      outputCanvas,
      availableArea,
      videoLayout,
      scaleFactor,
      isProportional,
      distortionRatio
    }
  }
  
  /**
   * 生成调试报告
   */
  static generateDebugReport(
    frameAnalysis: VideoFrameAnalysis,
    layoutAnalysis: LayoutAnalysis
  ): string {
    const lines = [
      '📊 Video Dimension Debug Report',
      '=' .repeat(50),
      '',
      '🎞️ VideoFrame Analysis:',
      `  Display: ${frameAnalysis.displayDimensions.width}x${frameAnalysis.displayDimensions.height} (${frameAnalysis.displayDimensions.aspectRatio.toFixed(3)}) - ${frameAnalysis.displayDimensions.isValid ? '✅' : '❌'}`,
      `  Coded: ${frameAnalysis.codedDimensions.width}x${frameAnalysis.codedDimensions.height} (${frameAnalysis.codedDimensions.aspectRatio.toFixed(3)}) - ${frameAnalysis.codedDimensions.isValid ? '✅' : '❌'}`,
      `  VisibleRect: ${frameAnalysis.visibleRectDimensions ? `${frameAnalysis.visibleRectDimensions.width}x${frameAnalysis.visibleRectDimensions.height} (${frameAnalysis.visibleRectDimensions.aspectRatio.toFixed(3)}) - ${frameAnalysis.visibleRectDimensions.isValid ? '✅' : '❌'}` : 'N/A'}`,
      `  Recommended: ${frameAnalysis.recommendedDimensions.width}x${frameAnalysis.recommendedDimensions.height} (${frameAnalysis.recommendedDimensions.aspectRatio.toFixed(3)}) from ${frameAnalysis.recommendedDimensions.source}`,
      '',
      '📐 Layout Analysis:',
      `  Output Canvas: ${layoutAnalysis.outputCanvas.width}x${layoutAnalysis.outputCanvas.height} (${layoutAnalysis.outputCanvas.aspectRatio.toFixed(3)})`,
      `  Available Area: ${layoutAnalysis.availableArea.width}x${layoutAnalysis.availableArea.height} (${layoutAnalysis.availableArea.aspectRatio.toFixed(3)})`,
      `  Video Layout: ${layoutAnalysis.videoLayout.width}x${layoutAnalysis.videoLayout.height} at (${layoutAnalysis.videoLayout.x}, ${layoutAnalysis.videoLayout.y})`,
      `  Scale Factor: ${layoutAnalysis.scaleFactor.toFixed(3)}`,
      `  Proportional: ${layoutAnalysis.isProportional ? '✅' : '❌'}`,
      `  Distortion Ratio: ${layoutAnalysis.distortionRatio.toFixed(3)} ${layoutAnalysis.distortionRatio > 1.01 ? '⚠️' : '✅'}`,
      '',
      '🔍 Issues Detected:',
    ]
    
    // 检测问题
    const issues = []
    
    if (!frameAnalysis.displayDimensions.isValid && !frameAnalysis.codedDimensions.isValid) {
      issues.push('❌ No valid frame dimensions found')
    }
    
    if (!layoutAnalysis.isProportional) {
      issues.push('❌ Video aspect ratio not preserved in layout')
    }
    
    if (layoutAnalysis.distortionRatio > 1.01) {
      issues.push(`⚠️ Video distortion detected (ratio: ${layoutAnalysis.distortionRatio.toFixed(3)})`)
    }
    
    if (layoutAnalysis.scaleFactor < 0.5) {
      issues.push('⚠️ Video scaled down significantly (may lose quality)')
    }
    
    if (layoutAnalysis.scaleFactor > 2.0) {
      issues.push('⚠️ Video scaled up significantly (may appear pixelated)')
    }
    
    if (issues.length === 0) {
      lines.push('  ✅ No issues detected')
    } else {
      lines.push(...issues.map(issue => `  ${issue}`))
    }
    
    return lines.join('\n')
  }
  
  /**
   * 在控制台输出调试信息
   */
  static logDebugInfo(
    frame: VideoFrame,
    layoutInfo: any,
    chunkInfo?: any
  ): void {
    const frameAnalysis = this.analyzeVideoFrame(frame, chunkInfo)
    const layoutAnalysis = this.analyzeLayout(
      layoutInfo.outputWidth,
      layoutInfo.outputHeight,
      frameAnalysis.recommendedDimensions.width,
      frameAnalysis.recommendedDimensions.height,
      layoutInfo.x,
      layoutInfo.y,
      layoutInfo.width,
      layoutInfo.height,
      layoutInfo.padding
    )
    
    const report = this.generateDebugReport(frameAnalysis, layoutAnalysis)
    console.log(report)
  }
}
