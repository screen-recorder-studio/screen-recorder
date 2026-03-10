// Video Composite Worker - 负责视频背景合成和处理
// 使用 OffscreenCanvas 进行高性能视频合成
// 支持预览显示和 MP4 导出

// 导入类型定义
import type { BackgroundConfig, GradientConfig, GradientStop, ImageBackgroundConfig } from '../../types/background'

interface CompositeMessage {
  type: 'init' | 'process' | 'play' | 'pause' | 'seek' | 'config' | 'appendWindow' | 'decodeSingleFrame' | 'preview-frame' | 'getCurrentFrameBitmap' | 'getSourceFrameBitmap';
  data: {
    chunks?: any[];
    backgroundConfig?: BackgroundConfig;
    timestamp?: number;
    frameIndex?: number;
    startGlobalFrame?: number; // 新增：窗口全局起点（用于C-2复用判断）
    frameRate?: number; // 🆕 视频帧率
    targetIndexInGOP?: number; // 🆕 单帧预览：目标帧在 GOP 中的索引
    globalFrameIndex?: number; // 🆕 单帧预览：全局帧索引
  };
}

interface VideoLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Worker 状态
let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let videoDecoder: VideoDecoder | null = null;
let videoDecoderCodec: string | null = null;
let decodedFrames: VideoFrame[] = [];
let currentConfig: BackgroundConfig | null = null;
// 下一窗口后台解码帧缓冲（C-2）
let nextDecoded: VideoFrame[] = []
let nextMeta: { start: number | null; codec: string | null } | null = null
// 解码输出目标：当前窗口 or 下一窗口
let outputTarget: 'current' | 'next' = 'current'

let isPlaying = false;
let isDecoding = false; // streaming decode in progress
let pendingSeekIndex: number | null = null; // seek request waiting for frames
let currentFrameIndex = 0;
let animationId: number | null = null;

// 当前窗口边界（以帧数计）：来自 process(chunks.length)，用于界定 windowComplete
let windowBoundaryFrames: number | null = null


// 缓冲区与水位配置（阶段2B：预取调度基础）
const BUFFER_CONFIG = {
  capacity: 120,       // 约4秒@30fps
  lowWatermark: 30,    // 1秒，建议开始预取
  highWatermark: 90,   // 3秒，暂停预取
  criticalLevel: 10    // 0.33秒，紧急预取
};
let lowWatermarkNotified = false;
let criticalWatermarkNotified = false;

// 🚀 P1 优化：帧缓冲限制，防止内存无限增长
// 注意：窗口大小需要平衡性能和内存占用，4K 视频每帧约 32MB
// 通过 performance.memory 动态调整上限，避免高分辨率场景 OOM
const FRAME_BUFFER_DEFAULTS = {
  maxDecodedFrames: 150,      // 默认上限（无 memory API 时使用）
  maxNextDecoded: 120,        // 默认预取上限
  warningThreshold: 0.9,      // 90% 时警告
  // 动态调整参数
  memoryUsageTarget: 0.5,     // 目标使用可用内存的 50%
  minFrames: 30,              // 最少保留 30 帧（~1秒@30fps）
  mainBudgetRatio: 0.6,       // 主窗口占内存预算的 60%
  nextBudgetRatio: 0.4,       // 预取窗口占内存预算的 40%
  defaultWidth: 1920,         // 分辨率未知时的默认宽度
  defaultHeight: 1080,        // 分辨率未知时的默认高度
};

/**
 * 根据 performance.memory 动态计算帧缓冲上限
 * 若 API 不可用则使用默认值
 */
function computeDynamicBufferLimits(frameWidth: number, frameHeight: number): {
  maxDecodedFrames: number;
  maxNextDecoded: number;
  warningThreshold: number;
} {
  const bytesPerFrame = (frameWidth || FRAME_BUFFER_DEFAULTS.defaultWidth) * (frameHeight || FRAME_BUFFER_DEFAULTS.defaultHeight) * 4; // RGBA

  try {
    const mem = (performance as any).memory;
    if (mem && typeof mem.jsHeapSizeLimit === 'number' && mem.jsHeapSizeLimit > 0) {
      const heapLimit = mem.jsHeapSizeLimit;
      const heapUsed = mem.usedJSHeapSize || 0;
      const available = Math.max(0, heapLimit - heapUsed);

      // 使用可用内存的目标比例来分配帧缓冲
      const budgetBytes = available * FRAME_BUFFER_DEFAULTS.memoryUsageTarget;
      const mainBudget = budgetBytes * FRAME_BUFFER_DEFAULTS.mainBudgetRatio;
      const nextBudget = budgetBytes * FRAME_BUFFER_DEFAULTS.nextBudgetRatio;

      const maxDecoded = Math.max(
        FRAME_BUFFER_DEFAULTS.minFrames,
        Math.min(FRAME_BUFFER_DEFAULTS.maxDecodedFrames, Math.floor(mainBudget / bytesPerFrame))
      );
      const maxNext = Math.max(
        FRAME_BUFFER_DEFAULTS.minFrames,
        Math.min(FRAME_BUFFER_DEFAULTS.maxNextDecoded, Math.floor(nextBudget / bytesPerFrame))
      );

      return {
        maxDecodedFrames: maxDecoded,
        maxNextDecoded: maxNext,
        warningThreshold: FRAME_BUFFER_DEFAULTS.warningThreshold
      };
    }
  } catch {
    // performance.memory not available (non-Chrome or worker context)
  }

  // 回退：使用默认值
  return {
    maxDecodedFrames: FRAME_BUFFER_DEFAULTS.maxDecodedFrames,
    maxNextDecoded: FRAME_BUFFER_DEFAULTS.maxNextDecoded,
    warningThreshold: FRAME_BUFFER_DEFAULTS.warningThreshold
  };
}

// 初始化时使用默认值，待视频分辨率确定后重新计算
let FRAME_BUFFER_LIMITS = computeDynamicBufferLimits(0, 0);
// Small tolerance to absorb codec rounding noise; 1px avoids churn without masking real resolution changes
const DISPLAY_SIZE_TOLERANCE = 1;

// 统计信息
let droppedFramesCount = 0;
let lastBufferWarningTime = 0;

// 固定的视频布局（避免每帧重新计算）
let fixedVideoLayout: VideoLayout | null = null;
let videoInfo: { width: number; height: number } | null = null;
let displaySizeLocked = false;
// 🆕 窗口信息（用于计算时间）
let windowStartFrameIndex: number = 0;  // 窗口起始帧索引（全局）
let videoFrameRate: number = 30;  // 视频帧率（默认 30fps）

// 🆕 Dedicated preview decoder (independent from main playback decoder)
let previewDecoder: VideoDecoder | null = null;
let previewDecoderCodec: string | null = null;
let previewDecodedFrames: VideoFrame[] = [];
let previewTargetIndex: number = 0;  // 目标帧在 previewDecodedFrames 中的索引
let previewGlobalFrameIndex: number = 0;  // 目标帧的全局索引
let previewDecodeComplete: boolean = false;
let isPreviewDecoding: boolean = false;

// 初始化 OffscreenCanvas
function initializeCanvas(width: number, height: number) {

  offscreenCanvas = new OffscreenCanvas(width, height);
  ctx = offscreenCanvas.getContext('2d', {
    alpha: false,           // 不需要透明度，提高性能
    desynchronized: true,   // 减少延迟
    colorSpace: 'srgb',     // 确保颜色空间一致
    willReadFrequently: false // 优化写入性能
  });

  if (!ctx) {
    throw new Error('Failed to get 2D context from OffscreenCanvas');
  }

  // 高质量渲染设置
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';

}

// 计算输出尺寸
function calculateOutputSize(config: BackgroundConfig, sourceWidth: number, sourceHeight: number) {
  let outputWidth: number, outputHeight: number;


  if (config.outputRatio === 'custom') {
    outputWidth = config.customWidth || 1920;
    outputHeight = config.customHeight || 1080;
  } else {
    // 平台标准输出分辨率（与 UI 显示一致），优先保证编码兼容性
    const standardSizes: Record<BackgroundConfig['outputRatio'], { width: number; height: number }> = {
      '16:9': { width: 1920, height: 1080 },
      '1:1': { width: 1080, height: 1080 },
      '9:16': { width: 1080, height: 1920 },
      '4:5': { width: 1080, height: 1350 },
      'custom': { width: 1920, height: 1080 }
    };

    const target = standardSizes[config.outputRatio] || standardSizes['16:9'];
    outputWidth = target.width;
    outputHeight = target.height;

    // 记录选择结果

    // 说明：padding/inset 仅影响视频布局（calculateVideoLayout），不再放大画布，
    // 以避免 16:9 因 padding 导致分辨率超过常见 H.264 Level 限制而报错。
  }

  return { outputWidth, outputHeight };
}

// 计算视频布局
function calculateVideoLayout(
  config: BackgroundConfig,
  outputWidth: number,
  outputHeight: number,
  videoWidth: number,
  videoHeight: number
): VideoLayout {
  const padding = config.padding ?? 60;
  const inset = config.inset || 0; // 视频内缩距离
  const totalPadding = padding + inset;
  const availableWidth = outputWidth - totalPadding * 2;
  const availableHeight = outputHeight - totalPadding * 2;

  // 🆕 如果启用裁剪，使用裁剪后的尺寸计算布局
  let effectiveWidth = videoWidth;
  let effectiveHeight = videoHeight;

  if (config.videoCrop?.enabled) {
    const crop = config.videoCrop;
    if (crop.mode === 'percentage') {
      effectiveWidth = Math.floor(videoWidth * crop.widthPercent);
      effectiveHeight = Math.floor(videoHeight * crop.heightPercent);
    } else {
      effectiveWidth = crop.width;
      effectiveHeight = crop.height;
    }

  }


  // 保持视频纵横比的缩放计算（基于裁剪后的尺寸）
  const videoAspectRatio = effectiveWidth / effectiveHeight;
  const availableAspectRatio = availableWidth / availableHeight;


  let layoutWidth: number, layoutHeight: number, layoutX: number, layoutY: number;

  if (videoAspectRatio > availableAspectRatio) {
    // 视频更宽，以可用宽度为准
    layoutWidth = availableWidth;
    layoutHeight = availableWidth / videoAspectRatio;
    layoutX = totalPadding;
    layoutY = totalPadding + (availableHeight - layoutHeight) / 2; // 垂直居中

  } else {
    // 视频更高，以可用高度为准
    layoutHeight = availableHeight;
    layoutWidth = availableHeight * videoAspectRatio;
    layoutX = totalPadding + (availableWidth - layoutWidth) / 2; // 水平居中
    layoutY = totalPadding;

  }

  return {
    x: layoutX,
    y: layoutY,
    width: layoutWidth,
    height: layoutHeight
  };
}

// 渲染背景
function renderBackground(config: BackgroundConfig) {
  if (!ctx || !offscreenCanvas) return;

  if (config.type === 'gradient' && config.gradient) {
    // 使用新的渐变配置系统
    const gradientStyle = createGradient(config.gradient);
    if (gradientStyle) {
      ctx.fillStyle = gradientStyle;
    } else {
      // 回退到纯色
      ctx.fillStyle = config.color;
    }
    ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  } else if (config.type === 'image' && config.image) {
    // 用户上传的图片背景
    renderImageBackground(config.image);
  } else if (config.type === 'wallpaper' && config.wallpaper) {
    // 壁纸背景
    renderImageBackground(config.wallpaper);
  } else {
    // 纯色背景
    ctx.fillStyle = config.color;
    ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  }
}

// 创建渐变对象
function createGradient(gradientConfig: GradientConfig): CanvasGradient | null {
  if (!ctx || !offscreenCanvas) return null;

  const { width, height } = offscreenCanvas;

  try {
    let gradient: CanvasGradient;

    switch (gradientConfig.type) {
      case 'linear':
        gradient = createLinearGradient(gradientConfig, width, height);
        break;
      case 'radial':
        gradient = createRadialGradient(gradientConfig, width, height);
        break;
      case 'conic':
        gradient = createConicGradient(gradientConfig, width, height);
        break;
      default:
        console.warn('🎨 [COMPOSITE-WORKER] Unsupported gradient type:', (gradientConfig as any).type);
        return null;
    }

    // 添加颜色停止点
    gradientConfig.stops.forEach((stop: GradientStop) => {
      gradient.addColorStop(stop.position, stop.color);
    });

    return gradient;
  } catch (error) {
    console.error('🎨 [COMPOSITE-WORKER] Error creating gradient:', error);
    return null;
  }
}

// 创建线性渐变
function createLinearGradient(config: any, width: number, height: number): CanvasGradient {
  const angle = config.angle || 0;
  const radians = (angle * Math.PI) / 180;

  // 计算渐变的起点和终点
  const centerX = width / 2;
  const centerY = height / 2;
  const diagonal = Math.sqrt(width * width + height * height) / 2;

  const x1 = centerX - Math.cos(radians) * diagonal;
  const y1 = centerY - Math.sin(radians) * diagonal;
  const x2 = centerX + Math.cos(radians) * diagonal;
  const y2 = centerY + Math.sin(radians) * diagonal;

  return ctx!.createLinearGradient(x1, y1, x2, y2);
}

// 创建径向渐变
function createRadialGradient(config: any, width: number, height: number): CanvasGradient {
  const centerX = (config.centerX || 0.5) * width;
  const centerY = (config.centerY || 0.5) * height;
  const radius = (config.radius || 0.5) * Math.min(width, height);

  return ctx!.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
}

// 创建圆锥渐变
function createConicGradient(config: any, width: number, height: number): CanvasGradient {
  const centerX = (config.centerX || 0.5) * width;
  const centerY = (config.centerY || 0.5) * height;
  const angle = (config.angle || 0) * Math.PI / 180;

  return ctx!.createConicGradient(angle, centerX, centerY);
}

// 渲染图片背景
function renderImageBackground(config: ImageBackgroundConfig) {
  if (!ctx || !offscreenCanvas || !config.imageBitmap) return;

  const { imageBitmap, fit, position, opacity, blur, scale, offsetX, offsetY } = config;
  const canvasWidth = offscreenCanvas.width;
  const canvasHeight = offscreenCanvas.height;

  // 保存状态
  ctx.save();

  // 应用透明度
  if (opacity !== undefined && opacity < 1) {
    ctx.globalAlpha = opacity;
  }

  // 应用模糊
  if (blur && blur > 0) {
    ctx.filter = `blur(${blur}px)`;
  }

  // 计算绘制参数
  const drawParams = calculateImageDrawParams(
    imageBitmap.width,
    imageBitmap.height,
    canvasWidth,
    canvasHeight,
    fit,
    position,
    scale,
    offsetX,
    offsetY
  );

  // 绘制图片
  ctx.drawImage(
    imageBitmap,
    drawParams.x,
    drawParams.y,
    drawParams.width,
    drawParams.height
  );

  // 恢复状态
  ctx.restore();
}

// 计算图片绘制参数
function calculateImageDrawParams(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  fit: string,
  position: string,
  scale: number = 1,
  offsetX: number = 0,
  offsetY: number = 0
): { x: number; y: number; width: number; height: number } {
  const imageAspect = imageWidth / imageHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let drawWidth: number, drawHeight: number;

  // 根据适应模式计算尺寸
  switch (fit) {
    case 'cover':
      if (imageAspect > canvasAspect) {
        drawHeight = canvasHeight;
        drawWidth = drawHeight * imageAspect;
      } else {
        drawWidth = canvasWidth;
        drawHeight = drawWidth / imageAspect;
      }
      break;
    case 'contain':
      if (imageAspect > canvasAspect) {
        drawWidth = canvasWidth;
        drawHeight = drawWidth / imageAspect;
      } else {
        drawHeight = canvasHeight;
        drawWidth = drawHeight * imageAspect;
      }
      break;
    case 'fill':
      drawWidth = canvasWidth;
      drawHeight = canvasHeight;
      break;
    case 'stretch':
    default:
      drawWidth = canvasWidth;
      drawHeight = canvasHeight;
      break;
  }

  // 应用缩放
  drawWidth *= scale;
  drawHeight *= scale;

  // 计算位置
  let x: number, y: number;

  // 基础居中位置
  x = (canvasWidth - drawWidth) / 2;
  y = (canvasHeight - drawHeight) / 2;

  // 根据位置调整
  switch (position) {
    case 'top':
      y = 0;
      break;
    case 'bottom':
      y = canvasHeight - drawHeight;
      break;
    case 'left':
      x = 0;
      break;
    case 'right':
      x = canvasWidth - drawWidth;
      break;
    case 'top-left':
      x = 0;
      y = 0;
      break;
    case 'top-right':
      x = canvasWidth - drawWidth;
      y = 0;
      break;
    case 'bottom-left':
      x = 0;
      y = canvasHeight - drawHeight;
      break;
    case 'bottom-right':
      x = canvasWidth - drawWidth;
      y = canvasHeight - drawHeight;
      break;
    case 'center':
    default:
      // 已经是居中位置
      break;
  }

  // 应用偏移
  x += offsetX * canvasWidth;
  y += offsetY * canvasHeight;

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(drawWidth),
    height: Math.round(drawHeight)
  };
}

// 创建圆角路径
function createRoundedRectPath(x: number, y: number, width: number, height: number, radius: number) {
  if (!ctx) return;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// 🆕 缓动函数集合
// smooth: easeInOutCubic（先加速后减速），平滑运镜
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// 🆕 P1: linear 缓动（匀速），机械/精准演示
function linearEasing(t: number): number {
  return t
}

// 🆕 P1: punch 缓动（阶跃/Hold），瞬间放大，卡点/强调
function stepEasing(t: number): number {
  return t < 1 ? 0 : 1  // 直到最后一刻才跳变
}

// 🆕 P1: 根据缓动类型获取对应函数
type ZoomEasing = 'smooth' | 'linear' | 'punch'
function getEasingFunction(easing: ZoomEasing): (t: number) => number {
  switch (easing) {
    case 'linear': return linearEasing
    case 'punch': return stepEasing
    case 'smooth':
    default: return easeInOutCubic
  }
}

// 🆕 计算当前时间的 Zoom 缩放比例（包含缓动）
// 返回值：1.0 = 无缩放，scale = 完全缩放
// 🆕 P1: 支持区间级 transitionDurationMs 和 easing
function calculateZoomScale(currentTimeMs: number, zoomConfig: any, debugLog: boolean = false): number {
  // 🔧 防御性检查：确保时间值有效
  if (typeof currentTimeMs !== 'number' || isNaN(currentTimeMs) || currentTimeMs < 0) {
    console.warn('⚠️ [calculateZoomScale] Invalid currentTimeMs:', currentTimeMs)
    return 1.0
  }

  if (!zoomConfig?.enabled || !zoomConfig.intervals || zoomConfig.intervals.length === 0) {
    if (debugLog) {
    }
    return 1.0
  }

  const baseScale = zoomConfig.scale ?? 1.5
  const globalTransitionMs = zoomConfig.transitionDurationMs ?? 300

  if (debugLog) {
  }

  // 查找当前时间所在或最近的区间
  for (const interval of zoomConfig.intervals) {
    const { startMs, endMs } = interval

    // 🔧 防御性检查：确保区间值有效
    if (typeof startMs !== 'number' || typeof endMs !== 'number' || startMs >= endMs) {
      console.warn('⚠️ [calculateZoomScale] Invalid interval:', interval)
      continue
    }

    // 🆕 P1: 读取区间级过渡时长和缓动类型
    const transitionMs = interval.transitionDurationMs ?? globalTransitionMs
    const easing: ZoomEasing = interval.easing ?? 'smooth'
    const easingFn = getEasingFunction(easing)

    const intervalScale = Math.max(1.0, interval.scale ?? baseScale)

    // 1. 进入过渡阶段（区间开始前 transitionMs 到区间开始）
    if (currentTimeMs >= startMs - transitionMs && currentTimeMs < startMs) {
      const progress = (currentTimeMs - (startMs - transitionMs)) / transitionMs
      const easedProgress = easingFn(progress)
      const scale = 1.0 + (intervalScale - 1.0) * easedProgress
      if (debugLog) {
      }
      return scale
    }

    // 2. 完全放大阶段（区间内）
    if (currentTimeMs >= startMs && currentTimeMs <= endMs) {
      if (debugLog) {
      }
      return intervalScale
    }

    // 3. 退出过渡阶段（区间结束到区间结束后 transitionMs）
    if (currentTimeMs > endMs && currentTimeMs <= endMs + transitionMs) {
      const progress = (currentTimeMs - endMs) / transitionMs
      const easedProgress = easingFn(progress)
      const scale = intervalScale - (intervalScale - 1.0) * easedProgress
      if (debugLog) {
      }
      return scale
    }
  }

  if (debugLog) {
  }
  return 1.0
}

// 渲染合成帧（严格保持原始显示比例，支持可见区域裁剪）
// frameIndex: 窗口内帧索引（用于计算 Zoom 时间）
function renderCompositeFrame(frame: VideoFrame, layout: VideoLayout, config: BackgroundConfig, frameIndex: number = currentFrameIndex) {
  if (!ctx || !offscreenCanvas) {
    console.error('❌ [COMPOSITE-WORKER] Canvas not initialized');
    return null;
  }

  try {
    // 1. 清除画布
    ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

    // 🆕 计算当前时间的 Zoom 缩放比例（包含缓动）- 移到背景渲染之前以支持 syncBackground
    // 使用帧索引计算时间（而不是 frame.timestamp，因为它可能是系统时间戳）
    const globalFrameIndex = windowStartFrameIndex + frameIndex  // 使用传入的 frameIndex
    const currentTimeMs = (globalFrameIndex / videoFrameRate) * 1000

    // 🔍 每 30 帧启用详细调试
    const shouldDebug = frameIndex % 30 === 0 && config.videoZoom?.enabled
    const zoomScale = calculateZoomScale(currentTimeMs, config.videoZoom, shouldDebug)

    // 🔍 调试：每 30 帧输出一次时间计算信息
    if (shouldDebug) {
    }

    // 🆕 P2: 检查当前区间是否启用了 syncBackground
    let syncBackground = false
    let activeInterval: any = null
    if (zoomScale > 1.0 && config.videoZoom?.enabled) {
      const vz: any = (config as any).videoZoom
      const intervals: any[] = Array.isArray(vz?.intervals) ? vz.intervals : []
      const globalTransitionMs = vz?.transitionDurationMs ?? 300

      for (const it of intervals) {
        const s = it.startMs, e = it.endMs
        const transitionMs = it.transitionDurationMs ?? globalTransitionMs
        if (typeof s !== 'number' || typeof e !== 'number' || s >= e) continue
        if ((currentTimeMs >= s - transitionMs && currentTimeMs < s) ||
            (currentTimeMs >= s && currentTimeMs <= e) ||
            (currentTimeMs > e && currentTimeMs <= e + transitionMs)) {
          activeInterval = it
          syncBackground = it.syncBackground ?? false
          break
        }
      }
    }

    // 🆕 计算实际布局（考虑 Zoom 缓动聚焦到画布中心）
    // 当前“放大点”取左上角（fx=0, fy=0），并在进入/退出过渡期将该点以缓动插值朝画布中心移动对齐
    // 🆕 P2: 将 actualLayout 计算移到背景绘制之前，以便背景同步使用相同变换
    let actualLayout = layout
    // 🆕 P2: 保存背景同步放大需要的变换参数
    // originX/Y: 原始焦点位置，targetX/Y: 目标焦点位置（Dolly 模式下会移动）
    let bgTransformParams: { originX: number; originY: number; targetX: number; targetY: number; scale: number } | null = null

    if (zoomScale > 1.0 && offscreenCanvas) {
      const vz: any = (config as any).videoZoom

      // 默认使用全局焦点
      const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
      let fx = clamp01(vz?.focusX ?? 0)
      let fy = clamp01(vz?.focusY ?? 0)

      // 🆕 P2: 复用已查找的 activeInterval（避免重复遍历）
      const active = activeInterval

      // 若区间内定义了焦点，则优先使用
      if (active && active.focusX != null && active.focusY != null) {
        const space = active.focusSpace ?? 'source'
        if (space === 'layout') {
          fx = clamp01(active.focusX)
          fy = clamp01(active.focusY)
        } else {
          // source 空间：需要考虑裁剪把源坐标映射到当前 layout 归一化
          const crop: any = (config as any).videoCrop
          const vw = frame.codedWidth
          const vh = frame.codedHeight
          let cropX = 0, cropY = 0, cropW = vw, cropH = vh
          if (crop?.enabled) {
            if (crop.mode === 'percentage') {
              cropX = Math.floor((crop.xPercent ?? 0) * vw)
              cropY = Math.floor((crop.yPercent ?? 0) * vh)
              cropW = Math.floor((crop.widthPercent ?? 1) * vw)
              cropH = Math.floor((crop.heightPercent ?? 1) * vh)
            } else {
              cropX = crop.x ?? 0
              cropY = crop.y ?? 0
              cropW = crop.width ?? vw
              cropH = crop.height ?? vh
            }
          }
          const srcPxX = clamp01(active.focusX) * vw
          const srcPxY = clamp01(active.focusY) * vh
          const denomW = Math.max(1, cropW)
          const denomH = Math.max(1, cropH)
          fx = clamp01((srcPxX - cropX) / denomW)
          fy = clamp01((srcPxY - cropY) / denomH)
        }
      }

      const targetScale = Math.max(1.0, (active?.scale ?? (vz?.scale ?? 1.5)))
      const denom = Math.max(1e-6, targetScale - 1.0)
      const t = Math.min(1, Math.max(0, (zoomScale - 1.0) / denom)) // 0→1：未放大→完全放大

      const w = layout.width
      const h = layout.height
      const wPrime = w * zoomScale
      const hPrime = h * zoomScale

      // 原始焦点（未放大时）在画布坐标下的位置（fx/fy 已是 layout 归一化坐标）
      const ax = layout.x + fx * w
      const ay = layout.y + fy * h
      const centerX = offscreenCanvas.width / 2
      const centerY = offscreenCanvas.height / 2

      // 🆕 P1: 读取区间级 mode，决定布局计算方式
      const zoomMode: 'dolly' | 'anchor' = active?.mode ?? 'dolly'

      if (zoomMode === 'anchor') {
        // 🆕 P1: Anchor 模式 - 焦点在屏幕上的绝对位置保持不变
        // 焦点位置 (ax, ay) 在放大前后保持一致
        // 公式：ax = layout.x + fx * w = actualLayout.x + fx * wPrime
        //       => actualLayout.x = ax - fx * wPrime
        actualLayout = {
          x: ax - fx * wPrime,
          y: ay - fy * hPrime,
          width: wPrime,
          height: hPrime
        }
        // 🆕 P2: Anchor 模式下，焦点位置保持不变，origin = target
        bgTransformParams = { originX: ax, originY: ay, targetX: ax, targetY: ay, scale: zoomScale }
      } else {
        // Dolly 模式（默认）- 焦点移动到画面中心
        // 将焦点位置从 ax/ay 缓动到画布中心（t=1 时完全对齐）
        const anchorTargetX = ax + (centerX - ax) * t
        const anchorTargetY = ay + (centerY - ay) * t

        // 求放大后布局左上角，使放大后的焦点位于 anchorTargetX/Y
        actualLayout = {
          x: anchorTargetX - fx * wPrime,
          y: anchorTargetY - fy * hPrime,
          width: wPrime,
          height: hPrime
        }
        // 🆕 P2: Dolly 模式下，焦点从原始位置移动到目标位置
        bgTransformParams = { originX: ax, originY: ay, targetX: anchorTargetX, targetY: anchorTargetY, scale: zoomScale }
      }
    }

    // 2. 绘制背景（支持渐变）- 🆕 P2: 支持背景同步放大
    if (syncBackground && bgTransformParams && bgTransformParams.scale > 1.0) {
      // 🆕 P2 修复：先绘制一层静态背景作为底层，防止变换后露出黑色空白区
      renderBackground(config)

      // 背景同步放大：使前景和背景保持相对位置不变
      // 变换逻辑：背景上原本在 (originX, originY) 的点移动到 (targetX, targetY)，同时放大 scale 倍
      ctx.save()
      const { originX, originY, targetX, targetY, scale } = bgTransformParams
      // 正确的变换顺序：先平移到目标位置，再以原始锚点为中心缩放
      ctx.translate(targetX, targetY)
      ctx.scale(scale, scale)
      ctx.translate(-originX, -originY)
      renderBackground(config)
      ctx.restore()
    } else {
      // 默认：背景不跟随放大
      renderBackground(config)
    }

    // 3. 绘制阴影（如果配置了阴影）
    const borderRadius = config.borderRadius || 0;

    if (config.shadow) {
      ctx.save();
      ctx.shadowOffsetX = config.shadow.offsetX;
      ctx.shadowOffsetY = config.shadow.offsetY;
      ctx.shadowBlur = config.shadow.blur;
      ctx.shadowColor = config.shadow.color;

      // 🆕 阴影形状基于实际布局（包含 Zoom）
      if (borderRadius > 0) {
        createRoundedRectPath(actualLayout.x, actualLayout.y, actualLayout.width, actualLayout.height, borderRadius);
        ctx.fill();
      } else {
        ctx.fillRect(actualLayout.x, actualLayout.y, actualLayout.width, actualLayout.height);
      }
      ctx.restore();
    }

    // 4. 保存状态并绘制视频
    ctx.save();

    // 5. 创建圆角遮罩（如果配置了圆角）
    if (borderRadius > 0) {
      // 🆕 遮罩基于实际布局（包含 Zoom）
      createRoundedRectPath(actualLayout.x, actualLayout.y, actualLayout.width, actualLayout.height, borderRadius);
      ctx.clip();
    }

    // 🔍 调试：输出 Zoom 状态（包含缓动）
    if (zoomScale > 1.0 && frameIndex % 30 === 0) {
    }

    // 7. 绘制视频帧（支持用户自定义裁剪 + Zoom）
    const vr = frame.visibleRect;

    // 验证帧尺寸信息
    const frameInfo = {
      displayWidth: frame.displayWidth,
      displayHeight: frame.displayHeight,
      codedWidth: frame.codedWidth,
      codedHeight: frame.codedHeight,
      visibleRect: vr ? { x: vr.x, y: vr.y, width: vr.width, height: vr.height } : null
    };

    // 🆕 计算源裁剪区域（用户自定义裁剪）
    let srcX = 0, srcY = 0, srcWidth = frame.codedWidth, srcHeight = frame.codedHeight;

    if (config.videoCrop?.enabled) {
      const crop = config.videoCrop;

      if (crop.mode === 'percentage') {
        // 百分比模式：基于原始帧尺寸计算
        srcX = Math.floor(crop.xPercent * frame.codedWidth);
        srcY = Math.floor(crop.yPercent * frame.codedHeight);
        srcWidth = Math.floor(crop.widthPercent * frame.codedWidth);
        srcHeight = Math.floor(crop.heightPercent * frame.codedHeight);
      } else {
        // 像素模式：直接使用配置值
        srcX = crop.x;
        srcY = crop.y;
        srcWidth = crop.width;
        srcHeight = crop.height;
      }

      // 边界检查
      srcX = Math.max(0, Math.min(srcX, frame.codedWidth));
      srcY = Math.max(0, Math.min(srcY, frame.codedHeight));
      srcWidth = Math.min(srcWidth, frame.codedWidth - srcX);
      srcHeight = Math.min(srcHeight, frame.codedHeight - srcY);

      // 检查裁剪区域是否有效
      if (srcWidth <= 0 || srcHeight <= 0) {
        console.error('❌ [COMPOSITE-WORKER] Invalid crop region after boundary check:', {
          srcX, srcY, srcWidth, srcHeight,
          frameSize: { width: frame.codedWidth, height: frame.codedHeight },
          originalCrop: crop
        });
        // 回退到全屏
        srcX = 0;
        srcY = 0;
        srcWidth = frame.codedWidth;
        srcHeight = frame.codedHeight;
      }

    }

    // 🆕 Zoom 现在通过放大 actualLayout 实现，不再修改源区域

    // 计算渲染的缩放比例（基于裁剪后或原始尺寸）
    const effectiveSourceWidth = srcWidth;
    const effectiveSourceHeight = srcHeight;

    const scaleX = layout.width / effectiveSourceWidth;
    const scaleY = layout.height / effectiveSourceHeight;
    const isProportional = Math.abs(scaleX - scaleY) < 0.01; // 允许1%误差

    // 每60帧输出一次调试信息
    if (currentFrameIndex % 60 === 0) {

      if (!isProportional) {
        console.warn('⚠️ [COMPOSITE-WORKER] Non-proportional scaling detected! Video may be distorted.');
      }
    }

    // 🆕 使用 9 参数模式绘制（带源裁剪 + Zoom 布局放大）
    ctx.drawImage(
      frame,
      srcX, srcY, srcWidth, srcHeight,           // 源区域（用户裁剪区域）
      actualLayout.x, actualLayout.y, actualLayout.width, actualLayout.height  // 🆕 目标区域（包含 Zoom 放大）
    );

    // 确认裁剪/Zoom 渲染成功
    if ((config.videoCrop?.enabled || zoomScale > 1.0) && frameIndex % 30 === 0) {
    }

    // 7. 恢复状态
    ctx.restore();

    // 8. 转换为 ImageBitmap（高效传输）
    const bitmap = offscreenCanvas.transferToImageBitmap();

    const inset = config.inset || 0;
    const shadowInfo = config.shadow ? `shadow: ${config.shadow.offsetX},${config.shadow.offsetY},${config.shadow.blur}` : 'no shadow';

    return bitmap;
  } catch (error) {
    console.error('❌ [COMPOSITE-WORKER] Render error:', error);
    return null;
  }
}

// 🆕 Render and send single-frame preview
function renderAndSendPreviewFrame() {
  if (previewDecodedFrames.length <= previewTargetIndex) {
    console.error('❌ [COMPOSITE-WORKER] Preview frame not available');
    self.postMessage({
      type: 'singleFramePreview',
      data: { success: false, error: 'Frame not available' }
    });
    return;
  }

  const frame = previewDecodedFrames[previewTargetIndex];
  
  try {
    // 使用当前配置和布局渲染预览帧
    if (currentConfig && fixedVideoLayout) {
      // 计算预览帧的时间相关参数（用于 Zoom 等效果）
      const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig, 0);
      
      if (bitmap) {
        self.postMessage({
          type: 'singleFramePreview',
          data: {
            success: true,
            bitmap,
            globalFrameIndex: previewGlobalFrameIndex
          }
        }, { transfer: [bitmap] });
      } else {
        self.postMessage({
          type: 'singleFramePreview',
          data: { success: false, error: 'Render returned null' }
        });
      }
    } else {
      // 没有配置/布局，返回源帧的简单位图
      const w = (frame as any).codedWidth ?? (frame as any).displayWidth ?? 1;
      const h = (frame as any).codedHeight ?? (frame as any).displayHeight ?? 1;
      const temp = new OffscreenCanvas(w, h);
      const tctx = temp.getContext('2d', { alpha: false })!;
      tctx.drawImage(frame as any, 0, 0, w, h);
      const bitmap = temp.transferToImageBitmap();
      
      self.postMessage({
        type: 'singleFramePreview',
        data: {
          success: true,
          bitmap,
          globalFrameIndex: previewGlobalFrameIndex
        }
      }, { transfer: [bitmap] });
    }
  } catch (error) {
    console.error('❌ [COMPOSITE-WORKER] Preview render error:', error);
    self.postMessage({
      type: 'singleFramePreview',
      data: { success: false, error: (error as Error).message }
    });
  }

  // 清理预览帧以释放内存
  for (const f of previewDecodedFrames) {
    try { f.close(); } catch {}
  }
  previewDecodedFrames = [];
}

// 基础流式解码：开始提交块并在后台flush，边解边播
function startStreamingDecode(chunks: any[]) {
  if (!chunks || chunks.length === 0) {
    throw new Error('No video chunks provided');
  }

  // 🔧 修复：在清理旧帧之前，先 reset 解码器以取消所有待处理的解码操作
  // 这可以防止旧窗口的帧被推送到新清空的 decodedFrames 数组中
  if (videoDecoder && videoDecoder.state !== 'closed') {
    try {
      videoDecoder.reset()
    } catch (e) {
      console.warn('[COMPOSITE-WORKER] Failed to reset decoder:', e)
    }
  }

  // 清理旧帧（保留解码器以复用）
  if (decodedFrames.length > 0) {
    for (const frame of decodedFrames) {
      try { frame.close(); } catch {}
    }
    decodedFrames = [];
  }

  const firstChunk = chunks[0];
  const codec = firstChunk.codec || 'vp8';

  // 🔧 修复：reset 后需要重新 configure，所以总是需要重新创建或配置
  const needRecreate = !videoDecoder || videoDecoderCodec !== codec || videoDecoder.state === 'unconfigured';
  if (needRecreate) {

    videoDecoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        const targetBuf = (outputTarget === 'next') ? nextDecoded : decodedFrames;
        const maxSize = (outputTarget === 'next') ? FRAME_BUFFER_LIMITS.maxNextDecoded : FRAME_BUFFER_LIMITS.maxDecodedFrames;

        // 🔧 Use decoded frame display size to correct aspect ratio (avoids non-square pixel stretching)
        const displayWidth = frame.displayWidth ?? frame.codedWidth ?? 0;
        const displayHeight = frame.displayHeight ?? frame.codedHeight ?? 0;
        if (!displaySizeLocked) {
          const widthDiffers = !videoInfo || Math.abs(videoInfo.width - displayWidth) > DISPLAY_SIZE_TOLERANCE;
          const heightDiffers = !videoInfo || Math.abs(videoInfo.height - displayHeight) > DISPLAY_SIZE_TOLERANCE;
          if (widthDiffers || heightDiffers) {
            videoInfo = { width: displayWidth, height: displayHeight };
            // Recompute layout to keep the correct aspect ratio
            calculateAndCacheLayout();
            displaySizeLocked = true;
            // 根据实际分辨率重新计算帧缓冲上限
            FRAME_BUFFER_LIMITS = computeDynamicBufferLimits(displayWidth, displayHeight);
          }
        }

        // 🚀 P1 优化：帧缓冲限制
        if (targetBuf.length >= maxSize) {
          const bufferName = (outputTarget === 'next') ? 'nextDecoded' : 'decodedFrames';
          console.warn(`⚠️ [COMPOSITE-WORKER] Buffer full (${bufferName}: ${targetBuf.length}/${maxSize}), dropping oldest frame`);

          const oldest = targetBuf.shift();
          try {
            oldest?.close();
          } catch (e) {
            console.warn('[COMPOSITE-WORKER] Failed to close dropped frame:', e);
          }

          droppedFramesCount++;

          // 每10个丢帧或每5秒报告一次
          const now = Date.now();
          if (droppedFramesCount % 10 === 0 || now - lastBufferWarningTime > 5000) {
            console.warn(`⚠️ [COMPOSITE-WORKER] Total frames dropped: ${droppedFramesCount}`);
            lastBufferWarningTime = now;
          }
        }

        // 缓冲区接近满时警告
        if (targetBuf.length >= maxSize * FRAME_BUFFER_LIMITS.warningThreshold) {
          const bufferName = (outputTarget === 'next') ? 'nextDecoded' : 'decodedFrames';
          const now = Date.now();
          if (now - lastBufferWarningTime > 5000) {
            console.warn(`⚠️ [COMPOSITE-WORKER] Buffer approaching limit (${bufferName}: ${targetBuf.length}/${maxSize})`);
            lastBufferWarningTime = now;
          }
        }

        targetBuf.push(frame);

        // 仅当输出到当前窗口时，才执行日志与 pending seek 渲染
        if (outputTarget !== 'next') {
          if (decodedFrames.length % 60 === 0) {
          }
          if (pendingSeekIndex !== null && decodedFrames.length > pendingSeekIndex) {
            try {
              if (currentConfig && fixedVideoLayout) {
                const f = decodedFrames[pendingSeekIndex];
                const bitmap = renderCompositeFrame(f, fixedVideoLayout, currentConfig, pendingSeekIndex);
                if (bitmap) {
                  self.postMessage({
                    type: 'frame',
                    data: {
                      bitmap,
                      frameIndex: pendingSeekIndex,
                      timestamp: f.timestamp,
                      windowStartFrameIndex
                    }
                  }, { transfer: [bitmap] });
                  currentFrameIndex = pendingSeekIndex;
                } else {
                  console.error('❌ [COMPOSITE-WORKER] renderCompositeFrame returned null for pending seek');
                }
              } else {
                console.warn('⚠️ [COMPOSITE-WORKER] Cannot render pending seek - missing config or layout:', {
                  hasConfig: !!currentConfig,
                  hasLayout: !!fixedVideoLayout
                });
              }
            } catch (e) {
              console.error('❌ [COMPOSITE-WORKER] pending seek render failed:', e);
            } finally {
              pendingSeekIndex = null;
            }
          }
        }
      },
      error: (error: Error) => {
        console.error('❌ [COMPOSITE-WORKER] Decoder error (stream):', error);
        self.postMessage({ type: 'error', data: error.message });
      }
    });

    const decoderConfig: VideoDecoderConfig = { codec } as VideoDecoderConfig;
    try {
      videoDecoder.configure(decoderConfig);
      videoDecoderCodec = codec;
    } catch (error) {
      console.error('[progress] VideoComposite - decoder configuration error (stream):', error);
      throw new Error(`Failed to configure decoder: ${error}`);
    }
  } else {
  }

  // 开始流式解码
  isDecoding = true;

  // 🔧 诊断：检查 chunks 中的关键帧分布
  const keyframeIndices: number[] = []
  const firstFewTimestamps: number[] = []
  let prevTimestamp = -1
  let timestampErrors = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    if (chunk.type === 'key') {
      keyframeIndices.push(i)
    }
    if (i < 5) {
      firstFewTimestamps.push(chunk.timestamp)
    }
    if (prevTimestamp >= 0 && chunk.timestamp < prevTimestamp) {
      timestampErrors++
    }
    prevTimestamp = chunk.timestamp
  }


  if (keyframeIndices.length === 0) {
    console.error('❌ [DIAGNOSTIC] NO KEYFRAMES in chunks! All frames are delta. This will cause decode failures.')
  } else if (keyframeIndices[0] !== 0) {
    console.error('❌ [DIAGNOSTIC] First chunk is NOT a keyframe! type:', chunks[0]?.type, 'First keyframe at index:', keyframeIndices[0])
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const data = chunk.data instanceof ArrayBuffer ? new Uint8Array(chunk.data) : chunk.data;
      const chunkType = chunk.type === 'key' ? 'key' : 'delta';

      // 🔧 诊断：记录第一个 chunk 的详细信息
      if (i === 0) {
      }

      const encodedChunk = new EncodedVideoChunk({
        type: chunkType,
        timestamp: chunk.timestamp,
        data
      });
      videoDecoder!.decode(encodedChunk);
      if ((i + 1) % 10 === 0) {
      }
    }
  } catch (error) {
    console.error('[progress] VideoComposite - error during streaming decode submit:', error);
    throw error;
  }

  // 后台flush，不阻塞ready/播放
  videoDecoder!.flush().then(() => {
    isDecoding = false;
  }).catch((error) => {
    console.error('[progress] VideoComposite - decoder flush error (stream):', error);
    isDecoding = false;
  });
}

// 追加解码：在现有解码器与帧缓冲基础上追加下一窗口的编码块
function appendStreamingDecode(chunks: any[]) {
  if (!chunks || chunks.length === 0) {
    console.warn('[COMPOSITE-WORKER] appendStreamingDecode: no chunks');
    return;
  }
  const firstChunk = chunks[0];
  const codec = firstChunk.codec || 'vp8';

  if (!videoDecoder) {
    console.warn('[COMPOSITE-WORKER] appendStreamingDecode: decoder not initialized, ignoring');
    return;
  }
  if (videoDecoderCodec !== codec) {
    console.warn('[COMPOSITE-WORKER] appendStreamingDecode: codec mismatch, expected', videoDecoderCodec, 'got', codec);
    return;
  }

  isDecoding = true;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const data = chunk.data instanceof ArrayBuffer ? new Uint8Array(chunk.data) : chunk.data;
      const encodedChunk = new EncodedVideoChunk({
        type: chunk.type === 'key' ? 'key' : 'delta',
        timestamp: chunk.timestamp,
        data
      });
      videoDecoder!.decode(encodedChunk);
      if ((i + 1) % 10 === 0) {
      }
    }
  } catch (error) {
    console.error('[progress] VideoComposite - error during append decode submit:', error);
    return;
  }

  videoDecoder!.flush().then(() => {
    isDecoding = false;
    outputTarget = 'current';
  }).catch((error) => {
    console.error('[progress] VideoComposite - decoder flush error (append):', error);
    isDecoding = false;
    outputTarget = 'current';
  });
}


// 计算并缓存固定的视频布局
function calculateAndCacheLayout() {
  if (!currentConfig || !videoInfo || !offscreenCanvas) {
    console.error('❌ [COMPOSITE-WORKER] Cannot calculate layout: missing config, videoInfo, or canvas');
    return;
  }

  // 使用固定的视频尺寸计算布局
  fixedVideoLayout = calculateVideoLayout(
    currentConfig,
    offscreenCanvas.width,
    offscreenCanvas.height,
    videoInfo.width,
    videoInfo.height
  );

}

// 播放控制
function startPlayback() {
  if (!currentConfig) {
    console.error('❌ [COMPOSITE-WORKER] Cannot start playback: missing config');
    return;
  }

  // 确保布局已计算
  if (!fixedVideoLayout) {
    calculateAndCacheLayout();
  }

  if (!fixedVideoLayout) {
    console.error('❌ [COMPOSITE-WORKER] Cannot start playback: layout calculation failed');
    return;
  }

  // 🔧 修复：检查是否已到达边界，如果是则重置到开始
  // 这样第二次播放时可以从头开始，而暂停后继续播放则保持当前位置
  const boundary = windowBoundaryFrames ?? decodedFrames.length;
  if (currentFrameIndex >= boundary) {
    currentFrameIndex = 0;
  }

  // 流式播放：即使没有帧也可以开始播放循环，等待帧到来
  isPlaying = true;
  // Use the actual videoFrameRate for scheduling to avoid time drift/jumps in zoom intervals
  const fps = Math.max(1, Math.floor(videoFrameRate || 30));
  const frameInterval = 1000 / fps;
  let lastFrameTime = 0; // 0 signals "not yet initialized"

  function playFrame() {
    if (!isPlaying) return;

    const now = performance.now();

    // 首帧初始化：以当前时间为基准，避免首帧因 lastFrameTime=0 导致立即渲染
    if (lastFrameTime === 0) {
      lastFrameTime = now;
    }

    if (now - lastFrameTime >= frameInterval) {
      const boundary = windowBoundaryFrames ?? decodedFrames.length;
      // 若已到达窗口边界，则立即宣告窗口完成（不受追加解码影响）
      if (currentFrameIndex >= boundary) {
        self.postMessage({
          type: 'windowComplete',
          data: { totalFrames: boundary, lastFrameIndex: Math.max(0, currentFrameIndex - 1) }
        });
        isPlaying = false;
        // 🔧 修复：重置 currentFrameIndex，确保下次播放从头开始
        currentFrameIndex = 0;
        return;
      }

      if (currentFrameIndex < decodedFrames.length) {
        const frame = decodedFrames[currentFrameIndex];

        // 使用固定布局，避免每帧重新计算
        // 🔧 修复：传递 currentFrameIndex 以支持 Zoom 时间计算
        const bitmap = renderCompositeFrame(frame, fixedVideoLayout!, currentConfig!, currentFrameIndex);
        if (bitmap) {
          // 发送渲染结果给主线程
          self.postMessage({
            type: 'frame',
            data: {
              bitmap,
              frameIndex: currentFrameIndex,
              timestamp: frame.timestamp,
              windowStartFrameIndex
            }
          }, { transfer: [bitmap] }); // 转移 ImageBitmap 所有权
        }

        currentFrameIndex++;
        // 🔧 修复：使用累积递增而非 now，避免帧时间漂移导致跳帧
        lastFrameTime += frameInterval;
        // 安全阀：如果累积偏差过大（>2帧间隔），重新同步
        // 防止因标签页后台挂起或长时间暂停后恢复导致一次性快进大量帧
        if (now - lastFrameTime > frameInterval * 2) {
          lastFrameTime = now;
        }

        // 水位检测与提示（相对当前窗口边界）
        const boundaryForWatermark = windowBoundaryFrames ?? decodedFrames.length;
        const remaining = Math.max(0, boundaryForWatermark - currentFrameIndex);
        if (remaining <= BUFFER_CONFIG.criticalLevel && !criticalWatermarkNotified) {
          self.postMessage({
            type: 'bufferStatus',
            data: {
              level: 'critical',
              remaining,
              decoded: decodedFrames.length,
              currentIndex: currentFrameIndex,
              config: BUFFER_CONFIG,
              isDecoding
            }
          });
          criticalWatermarkNotified = true;
          lowWatermarkNotified = true;
        } else if (remaining <= BUFFER_CONFIG.lowWatermark && !lowWatermarkNotified) {
          self.postMessage({
            type: 'bufferStatus',
            data: {
              level: 'low',
              remaining,
              decoded: decodedFrames.length,
              currentIndex: currentFrameIndex,
              config: BUFFER_CONFIG,
              isDecoding
            }
          });
          lowWatermarkNotified = true;
        } else if (
          remaining >= BUFFER_CONFIG.highWatermark &&
          (lowWatermarkNotified || criticalWatermarkNotified)
        ) {
          self.postMessage({
            type: 'bufferStatus',
            data: {
              level: 'healthy',
              remaining,
              decoded: decodedFrames.length,
              currentIndex: currentFrameIndex,
              config: BUFFER_CONFIG,
              isDecoding
            }
          });
          lowWatermarkNotified = false;
          criticalWatermarkNotified = false;
        }
      } else {
        // 如果还在解码，等待更多帧；否则宣布窗口完成
        if (isDecoding) {
          // 缓冲为空且仍在解码：触发一次紧急水位提示
          if (!criticalWatermarkNotified) {
            const remaining = 0;
            self.postMessage({
              type: 'bufferStatus',
              data: {
                level: 'critical',
                remaining,
                decoded: decodedFrames.length,
                currentIndex: currentFrameIndex,
                config: BUFFER_CONFIG,
                isDecoding
              }
            });
            criticalWatermarkNotified = true;
            lowWatermarkNotified = true;
          }
          // 等待下一帧到来，不要停止播放循环
        } else {
          self.postMessage({
            type: 'windowComplete',
            data: {
              totalFrames: decodedFrames.length,
              lastFrameIndex: currentFrameIndex - 1
            }
          });
          // 暂停播放，等待新窗口数据
          isPlaying = false;
          return;
        }
      }
    }

    animationId = self.requestAnimationFrame(playFrame);
  }

  playFrame();
}

// 消息处理
self.onmessage = async (event: MessageEvent<CompositeMessage>) => {
  const { type, data } = event.data;


  try {
    switch (type) {
      case 'init':
        self.postMessage({
          type: 'initialized',
          data: { success: true }
        });
        break;

      case 'process':

        if (!data.chunks || !data.backgroundConfig) {
          throw new Error('Missing chunks or background config');
        }

        // 🔧 重置播放状态 - 处理新窗口数据
        isPlaying = false;
        currentFrameIndex = 0;
        displaySizeLocked = false;
        videoInfo = null;
        if (animationId) {
          self.cancelAnimationFrame(animationId);
          animationId = null;
        }

        // 🔧 优化：清理旧帧缓冲，防止内存溢出
        if (decodedFrames.length > FRAME_BUFFER_LIMITS.maxDecodedFrames * 0.5) {
          console.warn('⚠️ [COMPOSITE-WORKER] Clearing old frames before new window:', {
            oldFrames: decodedFrames.length,
            maxLimit: FRAME_BUFFER_LIMITS.maxDecodedFrames
          })
          for (const frame of decodedFrames) {
            try { frame.close() } catch (e) {
              console.warn('[COMPOSITE-WORKER] Failed to close old frame:', e)
            }
          }
          decodedFrames = []
        }

        // 重置水位提示状态，确保每个窗口都会重新发出 low/critical 事件

        // 记录本窗口边界帧数（用于按窗口触发 windowComplete）
        windowBoundaryFrames = data.chunks.length;

        // 🆕 存储窗口起始帧索引和帧率（用于计算时间）
        windowStartFrameIndex = data.startGlobalFrame ?? 0;
        if (data.frameRate) {
          videoFrameRate = data.frameRate;
        }

        lowWatermarkNotified = false;
        criticalWatermarkNotified = false;

        currentConfig = data.backgroundConfig;

        // 🚀 P1 优化：报告缓冲区状态



        // 前置：首块与源尺寸（供复用与后续流程共享）
        const firstChunk = data.chunks[0];
        const sourceWidth = firstChunk.codedWidth || 1920;
        const sourceHeight = firstChunk.codedHeight || 1080;

        const requestedStart = (data.startGlobalFrame ?? null) as number | null
        const incomingCodec = (firstChunk.codec || 'vp8') as string
        const canReuse = !!(nextMeta && requestedStart !== null && nextMeta.start === requestedStart && videoDecoder && videoDecoderCodec === incomingCodec && nextDecoded.length > 0)
        if (canReuse) {
          // 关闭旧的当前窗口帧
          if (decodedFrames.length > 0) {
            for (const f of decodedFrames) { try { f.close() } catch {} }
          }
          decodedFrames = nextDecoded
          nextDecoded = []

          videoInfo = { width: sourceWidth, height: sourceHeight };

          nextMeta = null

          // 确认边界并进入就绪态
          windowBoundaryFrames = decodedFrames.length

          // 初始化 Canvas 与布局（沿用现有尺寸推导）
          const { outputWidth, outputHeight } = calculateOutputSize(currentConfig!, sourceWidth, sourceHeight);
          initializeCanvas(outputWidth, outputHeight);
          calculateAndCacheLayout();

          self.postMessage({
            type: 'ready',
            data: {
              totalFrames: windowBoundaryFrames,
              outputSize: { width: outputWidth, height: outputHeight },
              videoLayout: fixedVideoLayout,
              windowStartFrameIndex
            }
          });
          break;
        }



        // 计算输出尺寸（firstChunk 已在前方定义）

        // sourceWidth/sourceHeight 已在前方定义


        // 🚨 特别检查：如果是竖向视频，确认尺寸正确
        if (sourceHeight > sourceWidth) {
        }

        const { outputWidth, outputHeight } = calculateOutputSize(currentConfig, sourceWidth, sourceHeight);

        // 初始化 Canvas

        // 缓存视频自然尺寸，供布局与渲染使用（流式播放提前就绪）
        videoInfo = { width: sourceWidth, height: sourceHeight };

        initializeCanvas(outputWidth, outputHeight);

        // 启动流式解码（不阻塞ready）
        startStreamingDecode(data.chunks);

        // 计算固定布局
        calculateAndCacheLayout();

        self.postMessage({
          type: 'ready',
          data: {
            totalFrames: data.chunks.length,
            outputSize: { width: outputWidth, height: outputHeight },
            videoLayout: fixedVideoLayout,
            windowStartFrameIndex
          }
        });
        break;

      case 'play':
        startPlayback();
        break;

      case 'pause':
        isPlaying = false;
        if (animationId) {
          self.cancelAnimationFrame(animationId);
          animationId = null;
        }
        break;

      case 'appendWindow':
        if (data.chunks && data.chunks.length > 0) {
          // 记录下一窗口元数据，清理不匹配的遗留
          const start = (data.startGlobalFrame ?? null) as number | null
          if (start !== null && nextMeta && nextMeta.start !== start && nextDecoded.length > 0) {
            for (const f of nextDecoded) { try { f.close() } catch {} }
            nextDecoded = []
          }
          nextMeta = { start, codec: videoDecoderCodec }

          // 将解码输出切换到 nextDecoded
          outputTarget = 'next'
          appendStreamingDecode(data.chunks)
          // flush 完成后会在 appendStreamingDecode 内部复位 outputTarget
        } else {
          console.warn('[COMPOSITE-WORKER] appendWindow: missing chunks')
        }
        break;

      case 'seek':
        if (data.frameIndex !== undefined) {
          const target = Math.max(0, data.frameIndex);
          if (target < decodedFrames.length) {
            currentFrameIndex = target;
            if (currentConfig && decodedFrames[currentFrameIndex] && fixedVideoLayout) {
              const frame = decodedFrames[currentFrameIndex];
              // 🔧 修复：传递 currentFrameIndex 以支持 Zoom 时间计算
              const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig, currentFrameIndex);
              if (bitmap) {
                self.postMessage({
                  type: 'frame',
                  data: {
                    bitmap,
                    frameIndex: currentFrameIndex,
                    timestamp: frame.timestamp,
                    windowStartFrameIndex
                  }
                }, { transfer: [bitmap] });
              } else {
                console.error('❌ [COMPOSITE-WORKER] renderCompositeFrame returned null');
              }
            } else {
              console.warn('⚠️ [COMPOSITE-WORKER] Cannot render frame - missing requirements:', {
                hasConfig: !!currentConfig,
                hasFrame: !!decodedFrames[currentFrameIndex],
                hasLayout: !!fixedVideoLayout
              });
            }
          } else if (isDecoding) {
            // 目标帧尚未解码，挂起本次seek，待足够帧可用时立即渲染
            pendingSeekIndex = target;
          } else {
            // 不在解码且目标越界，回退到最后一帧
            const last = Math.max(0, decodedFrames.length - 1);
            currentFrameIndex = last;
            if (currentConfig && decodedFrames[last] && fixedVideoLayout) {
              const frame = decodedFrames[last];
              const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig, last);
              if (bitmap) {
                self.postMessage({
                  type: 'frame',
                  data: {
                    bitmap,
                    frameIndex: last,
                    timestamp: frame.timestamp,
                    windowStartFrameIndex
                  }
                }, { transfer: [bitmap] });
              }
            }
          }
        }
        break;

      case 'preview-frame':
        // 🆕 预览帧请求（不改变播放状态）

        if (data.frameIndex !== undefined) {
          const previewFrameIndex = Math.max(0, Math.min(data.frameIndex, decodedFrames.length - 1));

          if (previewFrameIndex < decodedFrames.length && currentConfig && fixedVideoLayout) {
            const frame = decodedFrames[previewFrameIndex];
            // 🆕 传递帧索引以支持 Zoom 计算
            const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig, previewFrameIndex);

            if (bitmap) {
              self.postMessage({
                type: 'preview-frame',
                data: { bitmap, frameIndex: previewFrameIndex }
              }, { transfer: [bitmap] });

            }
          } else {
            console.warn('⚠️ [COMPOSITE-WORKER] Preview frame unavailable:', {
              requestedIndex: data.frameIndex,
              clampedIndex: previewFrameIndex,
              decodedFramesLength: decodedFrames.length,
              hasConfig: !!currentConfig,
              hasLayout: !!fixedVideoLayout
            });
          }
        }
        break;

      case 'getCurrentFrameBitmap':

        if (data.frameIndex !== undefined && currentConfig && fixedVideoLayout) {
          const frameIndex = data.frameIndex;

          if (frameIndex >= 0 && frameIndex < decodedFrames.length) {
            const frame = decodedFrames[frameIndex];

            // 渲染合成帧
            const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig, frameIndex);

            if (bitmap) {
              self.postMessage({
                type: 'frameBitmap',
                data: {
                  bitmap,
                  frameIndex
                }
              }, { transfer: [bitmap] });

            }
          } else {
            console.error('❌ [COMPOSITE-WORKER] Frame index out of range:', frameIndex, '/ total:', decodedFrames.length);
          }
        }
        break;

      case 'getSourceFrameBitmap':
        // 🆕 返回源视频帧位图（不应用任何缩放/平移/裁剪/背景等合成逻辑）
        try {
          if (data.frameIndex !== undefined) {
            const frameIndex = data.frameIndex as number
            if (frameIndex >= 0 && frameIndex < decodedFrames.length) {
              const frame = decodedFrames[frameIndex]
              const w = (frame as any).codedWidth ?? (frame as any).displayWidth ?? 1
              const h = (frame as any).codedHeight ?? (frame as any).displayHeight ?? 1
              const temp = new OffscreenCanvas(w, h)
              const tctx = temp.getContext('2d', { alpha: false })!
              // 直接绘制原始 VideoFrame 到临时画布
              tctx.drawImage(frame as any, 0, 0, w, h)
              const bitmap = temp.transferToImageBitmap()
              self.postMessage({
                type: 'frameBitmapRaw',
                data: { bitmap, frameIndex, width: w, height: h }
              }, { transfer: [bitmap] })
              // 让临时画布可被 GC
            } else {
              console.warn('⚠️ [COMPOSITE-WORKER] getSourceFrameBitmap: index out of range', { frameIndex, total: decodedFrames.length })
            }
          }
        } catch (e) {
          console.error('❌ [COMPOSITE-WORKER] getSourceFrameBitmap error:', e)
          self.postMessage({ type: 'error', data: (e as Error).message })
        }
        break;

      case 'config':
        if (data.backgroundConfig) {
          const oldConfig = currentConfig;
          currentConfig = data.backgroundConfig;

          // 🔧 修复：更新窗口信息，确保 Zoom 时间计算正确
          if (typeof data.startGlobalFrame === 'number') {
            windowStartFrameIndex = data.startGlobalFrame;
          }
          if (data.frameRate) {
            videoFrameRate = data.frameRate;
          }

          // 🔍 调试：输出 Zoom 配置（详细）

          // 检查是否需要重新计算输出尺寸
          const needsCanvasResize = !oldConfig ||
            oldConfig.outputRatio !== currentConfig.outputRatio ||
            oldConfig.customWidth !== currentConfig.customWidth ||
            oldConfig.customHeight !== currentConfig.customHeight;

          if (needsCanvasResize && videoInfo) {

            // 重新计算输出尺寸
            const { outputWidth, outputHeight } = calculateOutputSize(
              currentConfig,
              videoInfo.width,
              videoInfo.height
            );


            // 重新初始化 Canvas
            initializeCanvas(outputWidth, outputHeight);

            // 通知主线程输出尺寸已变化
            self.postMessage({
              type: 'sizeChanged',
              data: {
                outputSize: { width: outputWidth, height: outputHeight },
                outputRatio: currentConfig.outputRatio
              }
            });
          }

          // 重新计算固定布局
          calculateAndCacheLayout();

          // 重新渲染当前帧

          if (decodedFrames[currentFrameIndex] && fixedVideoLayout) {
            const frame = decodedFrames[currentFrameIndex];

            // 🔧 修复：传递 currentFrameIndex 以支持 Zoom 时间计算
            const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig, currentFrameIndex);

            if (bitmap) {
              self.postMessage({
                type: 'frame',
                data: {
                  bitmap,
                  frameIndex: currentFrameIndex,
                  timestamp: frame.timestamp,
                  windowStartFrameIndex
                }
              }, { transfer: [bitmap] });
            } else {
              console.error('❌ [COMPOSITE-WORKER] renderCompositeFrame returned null in config handler!');
            }
          } else {
            console.warn('⚠️ [COMPOSITE-WORKER] Cannot render frame in config handler - conditions not met');
          }
        }
        break;

      // 🆕 Single-frame preview: decode minimal GOP and return target frame bitmap
      // Uses independent decoder, does not interfere with main player
      case 'decodeSingleFrame':

        if (!data.chunks || data.chunks.length === 0) {
          console.warn('⚠️ [COMPOSITE-WORKER] decodeSingleFrame: no chunks provided');
          self.postMessage({
            type: 'singleFramePreview',
            data: { success: false, error: 'No chunks provided' }
          });
          break;
        }

        // 清理之前的预览解码帧
        for (const frame of previewDecodedFrames) {
          try { frame.close(); } catch {}
        }
        previewDecodedFrames = [];
        previewDecodeComplete = false;

        previewTargetIndex = data.targetIndexInGOP ?? 0;
        previewGlobalFrameIndex = data.globalFrameIndex ?? 0;

        const previewFirstChunk = data.chunks[0];
        const previewCodec = previewFirstChunk.codec || 'vp8';
        const previewSourceWidth = previewFirstChunk.codedWidth || 1920;
        const previewSourceHeight = previewFirstChunk.codedHeight || 1080;

        // 确保有配置和画布
        if (!currentConfig) {
          console.warn('⚠️ [COMPOSITE-WORKER] decodeSingleFrame: no config available, using defaults');
        }

        // 如果预览解码器不存在或 codec 不匹配，创建新的
        const needNewPreviewDecoder = !previewDecoder || previewDecoderCodec !== previewCodec || previewDecoder.state === 'closed';
        if (needNewPreviewDecoder) {
          // 关闭旧解码器
          if (previewDecoder && previewDecoder.state !== 'closed') {
            try { previewDecoder.close(); } catch {}
          }


          previewDecoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
              previewDecodedFrames.push(frame);

              // 检查是否达到目标帧
              if (previewDecodeComplete && previewDecodedFrames.length > previewTargetIndex) {
                renderAndSendPreviewFrame();
              }
            },
            error: (error: Error) => {
              console.error('❌ [COMPOSITE-WORKER] Preview decoder error:', error);
              isPreviewDecoding = false;
              self.postMessage({
                type: 'singleFramePreview',
                data: { success: false, error: error.message }
              });
            }
          });

          try {
            previewDecoder.configure({ codec: previewCodec } as VideoDecoderConfig);
            previewDecoderCodec = previewCodec;
          } catch (error) {
            console.error('❌ [COMPOSITE-WORKER] Preview decoder configure failed:', error);
            self.postMessage({
              type: 'singleFramePreview',
              data: { success: false, error: (error as Error).message }
            });
            break;
          }
        } else {
          // 重置现有解码器
          try {
            previewDecoder!.reset();
            previewDecoder!.configure({ codec: previewCodec } as VideoDecoderConfig);
          } catch (error) {
            console.error('❌ [COMPOSITE-WORKER] Preview decoder reset failed:', error);
          }
        }

        isPreviewDecoding = true;

        // 提交所有 GOP 帧进行解码
        try {
          for (let i = 0; i < data.chunks.length; i++) {
            const chunk = data.chunks[i];
            const chunkData = chunk.data instanceof ArrayBuffer ? new Uint8Array(chunk.data) : chunk.data;
            const encodedChunk = new EncodedVideoChunk({
              type: chunk.type === 'key' ? 'key' : 'delta',
              timestamp: chunk.timestamp,
              data: chunkData
            });
            previewDecoder!.decode(encodedChunk);
          }

          // Flush 并等待完成
          previewDecoder!.flush().then(() => {
            previewDecodeComplete = true;
            isPreviewDecoding = false;

            // 渲染并发送预览帧
            if (previewDecodedFrames.length > previewTargetIndex) {
              renderAndSendPreviewFrame();
            } else {
              console.error('❌ [COMPOSITE-WORKER] Preview target frame not available:', {
                targetIndex: previewTargetIndex,
                decodedCount: previewDecodedFrames.length
              });
              self.postMessage({
                type: 'singleFramePreview',
                data: { success: false, error: 'Target frame not decoded' }
              });
            }
          }).catch((error) => {
            console.error('❌ [COMPOSITE-WORKER] Preview decode flush error:', error);
            isPreviewDecoding = false;
            self.postMessage({
              type: 'singleFramePreview',
              data: { success: false, error: (error as Error).message }
            });
          });
        } catch (error) {
          console.error('❌ [COMPOSITE-WORKER] Preview decode submit error:', error);
          isPreviewDecoding = false;
          self.postMessage({
            type: 'singleFramePreview',
            data: { success: false, error: (error as Error).message }
          });
        }
        break;

      default:
        console.warn('⚠️ [COMPOSITE-WORKER] Unknown message type:', type);
    }
  } catch (error) {
    console.error('❌ [COMPOSITE-WORKER] Error processing message:', error);
    self.postMessage({
      type: 'error',
      data: (error as Error).message
    });
  }

};

