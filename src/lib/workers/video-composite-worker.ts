// Video Composite Worker - 负责视频背景合成和处理
// 使用 OffscreenCanvas 进行高性能视频合成
// 支持预览显示和 MP4 导出

// 导入类型定义
import type { BackgroundConfig, GradientConfig, GradientStop, ImageBackgroundConfig } from '../types/background'

interface CompositeMessage {
  type: 'init' | 'process' | 'play' | 'pause' | 'seek' | 'config' | 'appendWindow';
  data: {
    chunks?: any[];
    backgroundConfig?: BackgroundConfig;
    timestamp?: number;
    frameIndex?: number;
    startGlobalFrame?: number; // 新增：窗口全局起点（用于C-2复用判断）
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

// 固定的视频布局（避免每帧重新计算）
let fixedVideoLayout: VideoLayout | null = null;
let videoInfo: { width: number; height: number } | null = null;
// 🔧 新增：存储修正后的视频尺寸信息
let correctedVideoSize: { width: number; height: number } | null = null;

// 初始化 OffscreenCanvas
function initializeCanvas(width: number, height: number) {
  console.log('🎨 [COMPOSITE-WORKER] Initializing OffscreenCanvas:', { width, height });

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

  console.log('✅ [COMPOSITE-WORKER] OffscreenCanvas initialized successfully');
}

// 计算输出尺寸
function calculateOutputSize(config: BackgroundConfig, sourceWidth: number, sourceHeight: number) {
  let outputWidth: number, outputHeight: number;

  console.log('🔍 [COMPOSITE-WORKER] Calculating output size:', {
    sourceWidth,
    sourceHeight,
    sourceAspectRatio: (sourceWidth / sourceHeight).toFixed(3),
    outputRatio: config.outputRatio
  });

  if (config.outputRatio === 'custom') {
    outputWidth = config.customWidth || 1920;
    outputHeight = config.customHeight || 1080;
    console.log('✅ [COMPOSITE-WORKER] Using custom output size:', { outputWidth, outputHeight });
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
    console.log('✅ [COMPOSITE-WORKER] Using standard canvas size for ratio:', {
      ratio: config.outputRatio,
      outputWidth,
      outputHeight
    });

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
  const padding = config.padding || 60;
  const inset = config.inset || 0; // 视频内缩距离
  const totalPadding = padding + inset;
  const availableWidth = outputWidth - totalPadding * 2;
  const availableHeight = outputHeight - totalPadding * 2;

  console.log('🔍 [COMPOSITE-WORKER] Layout calculation:', {
    padding,
    inset,
    totalPadding,
    outputSize: { width: outputWidth, height: outputHeight },
    availableSize: { width: availableWidth, height: availableHeight },
    videoSize: { width: videoWidth, height: videoHeight }
  });

  // 保持视频纵横比的缩放计算
  const videoAspectRatio = videoWidth / videoHeight;
  const availableAspectRatio = availableWidth / availableHeight;

  console.log('📐 [COMPOSITE-WORKER] Aspect ratio comparison:', {
    videoAspectRatio: videoAspectRatio.toFixed(3),
    availableAspectRatio: availableAspectRatio.toFixed(3),
    videoIsWider: videoAspectRatio > availableAspectRatio
  });

  let layoutWidth: number, layoutHeight: number, layoutX: number, layoutY: number;

  if (videoAspectRatio > availableAspectRatio) {
    // 视频更宽，以可用宽度为准
    layoutWidth = availableWidth;
    layoutHeight = availableWidth / videoAspectRatio;
    layoutX = totalPadding;
    layoutY = totalPadding + (availableHeight - layoutHeight) / 2; // 垂直居中

    console.log('📏 [COMPOSITE-WORKER] Video is wider - fit to width:', {
      layoutWidth,
      layoutHeight,
      layoutX,
      layoutY,
      verticalMargin: (availableHeight - layoutHeight) / 2
    });
  } else {
    // 视频更高，以可用高度为准
    layoutHeight = availableHeight;
    layoutWidth = availableHeight * videoAspectRatio;
    layoutX = totalPadding + (availableWidth - layoutWidth) / 2; // 水平居中
    layoutY = totalPadding;

    console.log('📏 [COMPOSITE-WORKER] Video is taller - fit to height:', {
      layoutWidth,
      layoutHeight,
      layoutX,
      layoutY,
      horizontalMargin: (availableWidth - layoutWidth) / 2
    });
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

// 渲染合成帧（严格保持原始显示比例，支持可见区域裁剪）
function renderCompositeFrame(frame: VideoFrame, layout: VideoLayout, config: BackgroundConfig) {
  if (!ctx || !offscreenCanvas) {
    console.error('❌ [COMPOSITE-WORKER] Canvas not initialized');
    return null;
  }

  try {
    // 1. 清除画布
    ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

    // 2. 绘制背景（支持渐变）
    renderBackground(config);

    // 3. 绘制阴影（如果配置了阴影）
    const borderRadius = config.borderRadius || 0;

    if (config.shadow) {
      ctx.save();
      ctx.shadowOffsetX = config.shadow.offsetX;
      ctx.shadowOffsetY = config.shadow.offsetY;
      ctx.shadowBlur = config.shadow.blur;
      ctx.shadowColor = config.shadow.color;

      // 阴影形状基于目标布局矩形
      if (borderRadius > 0) {
        createRoundedRectPath(layout.x, layout.y, layout.width, layout.height, borderRadius);
        ctx.fill();
      } else {
        ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
      }
      ctx.restore();
    }

    // 4. 保存状态并绘制视频
    ctx.save();

    // 5. 创建圆角遮罩（如果配置了圆角）
    if (borderRadius > 0) {
      createRoundedRectPath(layout.x, layout.y, layout.width, layout.height, borderRadius);
      ctx.clip();
    }

    // 6. 绘制视频帧（优先使用可见区域，避免非方像素/裁剪导致的形变）
    const vr = frame.visibleRect;

    // 验证帧尺寸信息
    const frameInfo = {
      displayWidth: frame.displayWidth,
      displayHeight: frame.displayHeight,
      codedWidth: frame.codedWidth,
      codedHeight: frame.codedHeight,
      visibleRect: vr ? { x: vr.x, y: vr.y, width: vr.width, height: vr.height } : null
    };

    // 计算渲染的缩放比例
    let sourceWidth, sourceHeight;
    if (vr && vr.width > 0 && vr.height > 0) {
      sourceWidth = vr.width;
      sourceHeight = vr.height;
    } else {
      // 🔧 关键修复：使用修正后的尺寸，而不是 VideoFrame 的原始尺寸
      if (correctedVideoSize) {
        sourceWidth = correctedVideoSize.width;
        sourceHeight = correctedVideoSize.height;
        console.log('✅ [COMPOSITE-WORKER] Using corrected video size for rendering:', {
          correctedWidth: sourceWidth,
          correctedHeight: sourceHeight,
          frameDisplayWidth: frame.displayWidth,
          frameDisplayHeight: frame.displayHeight,
          frameCodedWidth: frame.codedWidth,
          frameCodedHeight: frame.codedHeight
        });
      } else {
        sourceWidth = frame.displayWidth || frame.codedWidth || 1920;
        sourceHeight = frame.displayHeight || frame.codedHeight || 1080;
        console.warn('⚠️ [COMPOSITE-WORKER] No corrected size available, using frame dimensions');
      }
    }

    const scaleX = layout.width / sourceWidth;
    const scaleY = layout.height / sourceHeight;
    const isProportional = Math.abs(scaleX - scaleY) < 0.01; // 允许1%误差

    // 每60帧输出一次调试信息
    if (currentFrameIndex % 60 === 0) {
      console.log('🎞️ [COMPOSITE-WORKER] Frame rendering analysis:', {
        frameInfo,
        layout,
        sourceSize: { width: sourceWidth, height: sourceHeight },
        targetSize: { width: layout.width, height: layout.height },
        scale: { x: scaleX.toFixed(3), y: scaleY.toFixed(3) },
        isProportional,
        distortionRatio: (Math.max(scaleX, scaleY) / Math.min(scaleX, scaleY)).toFixed(3)
      });

      if (!isProportional) {
        console.warn('⚠️ [COMPOSITE-WORKER] Non-proportional scaling detected! Video may be distorted.');
      }
    }

    if (vr && vr.width > 0 && vr.height > 0) {
      // 使用 9 参数重载：源裁剪区域 + 目标区域
      ctx.drawImage(
        frame,
        vr.x, vr.y, vr.width, vr.height,
        layout.x, layout.y, layout.width, layout.height
      );
    } else {
      // 无可见区域信息时，直接按目标矩形绘制（布局已按显示尺寸等比计算）
      ctx.drawImage(frame, layout.x, layout.y, layout.width, layout.height);
    }

    // 7. 恢复状态
    ctx.restore();

    // 8. 转换为 ImageBitmap（高效传输）
    const bitmap = offscreenCanvas.transferToImageBitmap();

    const inset = config.inset || 0;
    const shadowInfo = config.shadow ? `shadow: ${config.shadow.offsetX},${config.shadow.offsetY},${config.shadow.blur}` : 'no shadow';
    console.log(`🎨 [COMPOSITE-WORKER] Frame rendered: ${layout.width}x${layout.height} at (${layout.x}, ${layout.y}), background: ${config.type}, border radius: ${borderRadius}px, inset: ${inset}px, ${shadowInfo}`);

    return bitmap;
  } catch (error) {
    console.error('❌ [COMPOSITE-WORKER] Render error:', error);
    return null;
  }
}
// 基础流式解码：开始提交块并在后台flush，边解边播
function startStreamingDecode(chunks: any[]) {
  if (!chunks || chunks.length === 0) {
    throw new Error('No video chunks provided');
  }

  // 清理旧帧（保留解码器以复用）
  if (decodedFrames.length > 0) {
    console.log('[progress] VideoComposite - cleaning old decoded frames (streaming):', decodedFrames.length)
    for (const frame of decodedFrames) {
      try { frame.close(); } catch {}
    }
    decodedFrames = [];
  }

  const firstChunk = chunks[0];
  const codec = firstChunk.codec || 'vp8';

  const needRecreate = !videoDecoder || videoDecoderCodec !== codec;
  if (needRecreate) {
    console.log('🎬 [COMPOSITE-WORKER] (Re)initializing VideoDecoder for streaming, codec:', codec);

    videoDecoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        const targetBuf = (outputTarget === 'next') ? nextDecoded : decodedFrames;
        targetBuf.push(frame);
        // 仅当输出到当前窗口时，才执行日志与 pending seek 渲染
        if (outputTarget !== 'next') {
          if (decodedFrames.length % 60 === 0) {
            console.log(`📽️ [COMPOSITE-WORKER] [stream] Frames decoded: ${decodedFrames.length}/${chunks.length}`);
          }
          if (pendingSeekIndex !== null && decodedFrames.length > pendingSeekIndex) {
            try {
              if (currentConfig && fixedVideoLayout) {
                const f = decodedFrames[pendingSeekIndex];
                const bitmap = renderCompositeFrame(f, fixedVideoLayout, currentConfig);
                if (bitmap) {
                  self.postMessage({
                    type: 'frame',
                    data: { bitmap, frameIndex: pendingSeekIndex, timestamp: f.timestamp }
                  }, { transfer: [bitmap] });
                  currentFrameIndex = pendingSeekIndex;
                }
              }
            } catch (e) {
              console.warn('[progress] VideoComposite - pending seek render failed:', e);
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
    console.log('[progress] VideoComposite - configuring decoder (stream) with:', decoderConfig)
    try {
      videoDecoder.configure(decoderConfig);
      videoDecoderCodec = codec;
      console.log('✅ [COMPOSITE-WORKER] VideoDecoder configured for streaming');
    } catch (error) {
      console.error('[progress] VideoComposite - decoder configuration error (stream):', error);
      throw new Error(`Failed to configure decoder: ${error}`);
    }
  } else {
    console.log('[progress] VideoComposite - reusing existing VideoDecoder (stream), codec:', codec)
  }

  // 开始流式解码
  isDecoding = true;
  console.log('[progress] VideoComposite - starting streaming decode, chunks:', chunks.length)
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
        console.log(`[progress] VideoComposite - submitted ${i + 1}/${chunks.length} chunks (stream)`)
      }
    }
  } catch (error) {
    console.error('[progress] VideoComposite - error during streaming decode submit:', error);
    throw error;
  }

  // 后台flush，不阻塞ready/播放
  videoDecoder!.flush().then(() => {
    console.log('✅ [COMPOSITE-WORKER] Streaming decode flush complete, frames:', decodedFrames.length);
    isDecoding = false;
  }).catch((error) => {
    console.error('[progress] VideoComposite - decoder flush error (stream):', error);
    isDecoding = false;
  });
}

// 追加解码：在现有解码器与帧缓冲基础上追加下一窗口的编码块（小步C）
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
  console.log('[progress] VideoComposite - appending streaming decode, chunks:', chunks.length)
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
        console.log(`[progress] VideoComposite - appended ${i + 1}/${chunks.length} chunks`)
      }
    }
  } catch (error) {
    console.error('[progress] VideoComposite - error during append decode submit:', error);
    return;
  }

  videoDecoder!.flush().then(() => {
    console.log('✅ [COMPOSITE-WORKER] Append decode flush complete, next frames:', nextDecoded.length);
    isDecoding = false;
    outputTarget = 'current';
  }).catch((error) => {
    console.error('[progress] VideoComposite - decoder flush error (append):', error);
    isDecoding = false;
    outputTarget = 'current';
  });
}



// 初始化视频解码器（以解码后帧的 displayWidth/displayHeight 为准，避免拉伸变形）
async function initializeDecoder(chunks: any[]) {
  if (!chunks || chunks.length === 0) {
    throw new Error('No video chunks provided');
  }

  // 🔧 清理旧的解码帧（但尽量复用解码器）
  console.log('[progress] VideoComposite - cleaning old decoded frames:', decodedFrames.length)
  for (const frame of decodedFrames) {
    frame.close();
  }
  decodedFrames = [];

  const firstChunk = chunks[0];
  const codec = firstChunk.codec || 'vp8';

  // 仅当解码器不存在或编解码器变化时才重建
  const needRecreate = !videoDecoder || videoDecoderCodec !== codec;
  if (needRecreate) {
    console.log('🎬 [COMPOSITE-WORKER] (Re)initializing VideoDecoder with codec:', codec);

    videoDecoder = new VideoDecoder({
    output: (frame: VideoFrame) => {
      const targetBuf = (outputTarget === 'next') ? nextDecoded : decodedFrames;
      targetBuf.push(frame);
      if (outputTarget !== 'next') {
        if (decodedFrames.length % 60 === 0) {
          console.log(`📽️ [COMPOSITE-WORKER] Frames decoded: ${decodedFrames.length}/${chunks.length}`);
        }
      }
    },
    error: (error: Error) => {
      console.error('❌ [COMPOSITE-WORKER] Decoder error:', error);
      self.postMessage({
        type: 'error',
        data: error.message
      });
    }
  });

  // 仅使用 codec 配置，让解码器自行确定帧尺寸/显示比例
  const decoderConfig: VideoDecoderConfig = { codec } as VideoDecoderConfig;
  console.log('[progress] VideoComposite - configuring decoder with:', decoderConfig)

  try {
    videoDecoder.configure(decoderConfig);
    videoDecoderCodec = codec;
    console.log('✅ [COMPOSITE-WORKER] VideoDecoder configured:', decoderConfig);

    // 🔧 给解码器一点时间来完全初始化
    await new Promise(resolve => setTimeout(resolve, 10));
    console.log('[progress] VideoComposite - decoder ready for decoding');
  } catch (error) {
    console.error('[progress] VideoComposite - decoder configuration error:', error);
    throw new Error(`Failed to configure decoder: ${error}`);
  }
} else {
  console.log('[progress] VideoComposite - reusing existing VideoDecoder with codec:', codec)
}

  // 解码所有块
  console.log('[progress] VideoComposite - starting to decode chunks:', chunks.length)
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

      // 每10帧输出一次进度
      if ((i + 1) % 10 === 0) {
        console.log(`[progress] VideoComposite - decoded ${i + 1}/${chunks.length} chunks`)
      }
    }
    console.log('[progress] VideoComposite - all chunks submitted for decoding')
  } catch (error) {
    console.error('[progress] VideoComposite - error during chunk decoding:', error);
    throw error;
  }

  console.log('[progress] VideoComposite - flushing decoder')
  try {
    await videoDecoder!.flush();
    console.log(`✅ [COMPOSITE-WORKER] All frames decoded: ${decodedFrames.length} frames`);
  } catch (error) {
    console.error('[progress] VideoComposite - decoder flush error:', error)
    throw error;
  }

  if (decodedFrames.length === 0) {
    throw new Error('No frames decoded');
  }

  // 使用首帧的显示尺寸作为视频自然尺寸（考虑非方像素/可见区域）
  const firstFrame = decodedFrames[0];

  // 更可靠的尺寸获取策略
  let displayWidth = 1920;
  let displayHeight = 1080;

  console.log('🔍 [COMPOSITE-WORKER] Analyzing first frame properties:', {
    displayWidth: firstFrame.displayWidth,
    displayHeight: firstFrame.displayHeight,
    codedWidth: firstFrame.codedWidth,
    codedHeight: firstFrame.codedHeight,
    visibleRect: firstFrame.visibleRect
  });

  // 🔧 策略1: 优先使用修正后的 chunk 尺寸（对于元素/区域录制最准确）
  if (firstChunk.codedWidth && firstChunk.codedHeight) {
    displayWidth = firstChunk.codedWidth;
    displayHeight = firstChunk.codedHeight;
    console.log('✅ [COMPOSITE-WORKER] Using corrected chunk dimensions (highest priority):', {
      displayWidth,
      displayHeight,
      aspectRatio: (displayWidth / displayHeight).toFixed(3)
    });
  }
  // 策略2: 使用 displayWidth/Height (考虑像素纵横比)
  else if (firstFrame.displayWidth && firstFrame.displayHeight) {
    displayWidth = firstFrame.displayWidth;
    displayHeight = firstFrame.displayHeight;
    console.log('✅ [COMPOSITE-WORKER] Using displayWidth/Height:', { displayWidth, displayHeight });
  }
  // 策略3: 使用 visibleRect (考虑裁剪区域)
  else if (firstFrame.visibleRect && firstFrame.visibleRect.width && firstFrame.visibleRect.height) {
    displayWidth = firstFrame.visibleRect.width;
    displayHeight = firstFrame.visibleRect.height;
    console.log('✅ [COMPOSITE-WORKER] Using visibleRect dimensions:', { displayWidth, displayHeight });
  }
  // 策略4: 使用 codedWidth/Height
  else if (firstFrame.codedWidth && firstFrame.codedHeight) {
    displayWidth = firstFrame.codedWidth;
    displayHeight = firstFrame.codedHeight;
    console.log('✅ [COMPOSITE-WORKER] Using codedWidth/Height:', { displayWidth, displayHeight });
  }
  else {
    console.warn('⚠️ [COMPOSITE-WORKER] No reliable dimensions found, using defaults:', { displayWidth, displayHeight });
  }

  // 验证尺寸合理性
  if (displayWidth < 100 || displayHeight < 100 || displayWidth > 7680 || displayHeight > 4320) {
    console.warn('⚠️ [COMPOSITE-WORKER] Invalid dimensions detected, using safe defaults');
    displayWidth = 1920;
    displayHeight = 1080;
  }

  videoInfo = { width: displayWidth, height: displayHeight };
  console.log('📐 [COMPOSITE-WORKER] Final video info:', videoInfo);

  // 🔧 确保 correctedVideoSize 与 videoInfo 一致
  correctedVideoSize = { width: displayWidth, height: displayHeight };
  console.log('✅ [COMPOSITE-WORKER] Corrected video size synchronized:', correctedVideoSize);

  // 可选：内联首帧维度日志（避免外部依赖导致构建失败）
  if (decodedFrames.length > 0) {
    try {
      const f = decodedFrames[0];
      console.log('🔍 [COMPOSITE-WORKER] Inline frame dimension log:', {
        displayWidth: f.displayWidth,
        displayHeight: f.displayHeight,
        codedWidth: f.codedWidth,
        codedHeight: f.codedHeight,
        visibleRect: f.visibleRect
      });
    } catch {}
  }
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

  console.log('📐 [COMPOSITE-WORKER] Fixed layout calculated:', {
    videoInfo,
    canvasSize: { width: offscreenCanvas.width, height: offscreenCanvas.height },
    layout: fixedVideoLayout,
    config: currentConfig
  });
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

  // 流式播放：即使没有帧也可以开始播放循环，等待帧到来
  isPlaying = true;
  console.log('[progress] VideoComposite - starting playback loop, current frames:', decodedFrames.length);
  const fps = 30;
  const frameInterval = 1000 / fps;
  let lastFrameTime = 0;

  function playFrame() {
    if (!isPlaying) return;

    const now = performance.now();
    if (now - lastFrameTime >= frameInterval) {
      const boundary = windowBoundaryFrames ?? decodedFrames.length;
      // 若已到达窗口边界，则立即宣告窗口完成（不受追加解码影响）
      if (currentFrameIndex >= boundary) {
        console.log('[progress] VideoComposite - reached window boundary, requesting next window');
        self.postMessage({
          type: 'windowComplete',
          data: { totalFrames: boundary, lastFrameIndex: Math.max(0, currentFrameIndex - 1) }
        });
        isPlaying = false;
        return;
      }

      if (currentFrameIndex < decodedFrames.length) {
        const frame = decodedFrames[currentFrameIndex];

        // 使用固定布局，避免每帧重新计算
        const bitmap = renderCompositeFrame(frame, fixedVideoLayout!, currentConfig!);
        if (bitmap) {
          // 发送渲染结果给主线程
          self.postMessage({
            type: 'frame',
            data: {
              bitmap,
              frameIndex: currentFrameIndex,
              timestamp: frame.timestamp
            }
          }, { transfer: [bitmap] }); // 转移 ImageBitmap 所有权
        }

        currentFrameIndex++;
        lastFrameTime = now;

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
          console.log('[progress] VideoComposite - window playback complete, requesting next window')
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

  console.log('[progress] VideoComposite - received message:', type)

  try {
    switch (type) {
      case 'init':
        console.log('🚀 [COMPOSITE-WORKER] Initializing...');
        self.postMessage({
          type: 'initialized',
          data: { success: true }
        });
        break;

      case 'process':
        console.log('🎬 [COMPOSITE-WORKER] Processing video chunks...');

        if (!data.chunks || !data.backgroundConfig) {
          throw new Error('Missing chunks or background config');
        }

        // 🔧 重置播放状态 - 处理新窗口数据
        console.log('[progress] VideoComposite - resetting state for new window data')
        isPlaying = false;
        currentFrameIndex = 0;
        if (animationId) {
          self.cancelAnimationFrame(animationId);
          animationId = null;
        }
        // 重置水位提示状态，确保每个窗口都会重新发出 low/critical 事件

        // 记录本窗口边界帧数（用于按窗口触发 windowComplete）
        windowBoundaryFrames = data.chunks.length;
        console.log('[COMPOSITE-WORKER] Window boundary set to', windowBoundaryFrames, 'frames')

        lowWatermarkNotified = false;
        criticalWatermarkNotified = false;

        currentConfig = data.backgroundConfig;

        console.log('🔧 [COMPOSITE-WORKER] Received config:', {
          type: currentConfig.type,
          padding: currentConfig.padding,
          inset: currentConfig.inset,
          borderRadius: currentConfig.borderRadius,
          shadow: currentConfig.shadow
        });


        // 前置：首块与源尺寸（供复用与后续流程共享）
        const firstChunk = data.chunks[0];
        const sourceWidth = firstChunk.codedWidth || 1920;
        const sourceHeight = firstChunk.codedHeight || 1080;

        const requestedStart = (data.startGlobalFrame ?? null) as number | null
        const incomingCodec = (firstChunk.codec || 'vp8') as string
        const canReuse = !!(nextMeta && requestedStart !== null && nextMeta.start === requestedStart && videoDecoder && videoDecoderCodec === incomingCodec && nextDecoded.length > 0)
        if (canReuse) {
          console.log('🔁 [COMPOSITE-WORKER] Reusing predecoded next window frames:', nextDecoded.length, 'start:', requestedStart)
          // 关闭旧的当前窗口帧
          if (decodedFrames.length > 0) {
            for (const f of decodedFrames) { try { f.close() } catch {} }
          }
          decodedFrames = nextDecoded
          nextDecoded = []

          correctedVideoSize = { width: sourceWidth, height: sourceHeight };
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
              videoLayout: fixedVideoLayout
            }
          });
          break;
        }



        // 计算输出尺寸（firstChunk 已在前方定义）
        console.log('🔍 [COMPOSITE-WORKER] First chunk analysis:', {
          codedWidth: firstChunk.codedWidth,
          codedHeight: firstChunk.codedHeight,
          size: firstChunk.size,
          type: firstChunk.type,
          codec: firstChunk.codec,
          hasData: !!firstChunk.data
        });

        // sourceWidth/sourceHeight 已在前方定义

        // 🔧 保存修正后的视频尺寸，用于后续渲染
        correctedVideoSize = { width: sourceWidth, height: sourceHeight };

        console.log('📐 [COMPOSITE-WORKER] Source dimensions determined:', {
          sourceWidth,
          sourceHeight,
          aspectRatio: (sourceWidth / sourceHeight).toFixed(3),
          isFromChunk: !!firstChunk.codedWidth && !!firstChunk.codedHeight,
          firstChunkDetails: {
            codedWidth: firstChunk.codedWidth,
            codedHeight: firstChunk.codedHeight,
            size: firstChunk.size,
            type: firstChunk.type,
            codec: firstChunk.codec
          }
        });

        // 🚨 特别检查：如果是竖向视频，确认尺寸正确
        if (sourceHeight > sourceWidth) {
          console.log('📱 [COMPOSITE-WORKER] PORTRAIT VIDEO DETECTED:', {
            width: sourceWidth,
            height: sourceHeight,
            aspectRatio: (sourceWidth / sourceHeight).toFixed(3),
            isPortrait: true
          });
        }

        const { outputWidth, outputHeight } = calculateOutputSize(currentConfig, sourceWidth, sourceHeight);

        // 初始化 Canvas

        // 缓存视频自然尺寸，供布局与渲染使用（流式播放提前就绪）
        videoInfo = { width: sourceWidth, height: sourceHeight };

        initializeCanvas(outputWidth, outputHeight);

        // 启动流式解码（不阻塞ready）
        console.log('[progress] VideoComposite - starting streaming decode')
        startStreamingDecode(data.chunks);
        console.log('[progress] VideoComposite - streaming decode started')

        // 计算固定布局
        calculateAndCacheLayout();

        console.log('[progress] VideoComposite - sending ready message')
        self.postMessage({
          type: 'ready',
          data: {
            totalFrames: data.chunks.length,
            outputSize: { width: outputWidth, height: outputHeight },
            videoLayout: fixedVideoLayout
          }
        });
        break;

      case 'play':
        console.log('▶️ [COMPOSITE-WORKER] Starting playback...');
        startPlayback();
        break;

      case 'pause':
        console.log('⏸️ [COMPOSITE-WORKER] Pausing playback...');
        isPlaying = false;
        if (animationId) {
          self.cancelAnimationFrame(animationId);
          animationId = null;
        }
        break;

      case 'appendWindow':
        console.log('➕ [COMPOSITE-WORKER] Appending next window chunks...')
        if (data.chunks && data.chunks.length > 0) {
          // 记录下一窗口元数据，清理不匹配的遗留
          const start = (data.startGlobalFrame ?? null) as number | null
          if (start !== null && nextMeta && nextMeta.start !== start && nextDecoded.length > 0) {
            console.log('[COMPOSITE-WORKER] Discarding stale nextDecoded frames:', nextDecoded.length)
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
        console.log('⏭️ [COMPOSITE-WORKER] Seeking to frame:', data.frameIndex);
        if (data.frameIndex !== undefined) {
          const target = Math.max(0, data.frameIndex);
          if (target < decodedFrames.length) {
            currentFrameIndex = target;
            if (currentConfig && decodedFrames[currentFrameIndex] && fixedVideoLayout) {
              const frame = decodedFrames[currentFrameIndex];
              const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig);
              if (bitmap) {
                self.postMessage({
                  type: 'frame',
                  data: { bitmap, frameIndex: currentFrameIndex, timestamp: frame.timestamp }
                }, { transfer: [bitmap] });
              }
            }
          } else if (isDecoding) {
            // 目标帧尚未解码，挂起本次seek，待足够帧可用时立即渲染
            pendingSeekIndex = target;
            console.log('[progress] VideoComposite - pending seek set to', target);
          } else {
            // 不在解码且目标越界，回退到最后一帧
            const last = Math.max(0, decodedFrames.length - 1);
            currentFrameIndex = last;
            if (currentConfig && decodedFrames[last] && fixedVideoLayout) {
              const frame = decodedFrames[last];
              const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig);
              if (bitmap) {
                self.postMessage({
                  type: 'frame',
                  data: { bitmap, frameIndex: last, timestamp: frame.timestamp }
                }, { transfer: [bitmap] });
              }
            }
          }
        }
        break;

      case 'config':
        console.log('⚙️ [COMPOSITE-WORKER] Updating config...');
        if (data.backgroundConfig) {
          const oldConfig = currentConfig;
          currentConfig = data.backgroundConfig;

          // 检查是否需要重新计算输出尺寸
          const needsCanvasResize = !oldConfig ||
            oldConfig.outputRatio !== currentConfig.outputRatio ||
            oldConfig.customWidth !== currentConfig.customWidth ||
            oldConfig.customHeight !== currentConfig.customHeight;

          if (needsCanvasResize && videoInfo) {
            console.log('🔄 [COMPOSITE-WORKER] Output ratio changed, recalculating canvas size...');

            // 重新计算输出尺寸
            const { outputWidth, outputHeight } = calculateOutputSize(
              currentConfig,
              videoInfo.width,
              videoInfo.height
            );

            console.log('📐 [COMPOSITE-WORKER] New output size:', { outputWidth, outputHeight });

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

            const bitmap = renderCompositeFrame(frame, fixedVideoLayout, currentConfig);
            if (bitmap) {
              self.postMessage({
                type: 'frame',
                data: {
                  bitmap,
                  frameIndex: currentFrameIndex,
                  timestamp: frame.timestamp
                }
              }, { transfer: [bitmap] });
            }
          }
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

  console.log('[progress] VideoComposite - message processing complete:', type)
};

console.log('🎨 [COMPOSITE-WORKER] Video Composite Worker loaded');
