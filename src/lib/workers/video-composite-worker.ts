// Video Composite Worker - 负责视频背景合成和处理
// 使用 OffscreenCanvas 进行高性能视频合成
// 支持预览显示和 MP4 导出

import { VideoDimensionDebugger } from '../utils/video-dimension-debugger'

// 类型定义
interface BackgroundConfig {
  type: 'solid-color' | 'gradient';
  color: string;
  padding: number;
  outputRatio: '16:9' | '1:1' | '9:16' | '4:5' | 'custom';
  customWidth?: number;
  customHeight?: number;
  videoPosition: 'center' | 'top' | 'bottom';
  borderRadius?: number; // 视频圆角半径，默认 0px
  inset?: number; // 视频内缩距离，默认 0px
  shadow?: {
    offsetX: number;
    offsetY: number;
    blur: number;
    color: string;
  }; // 阴影效果，可选
}

interface CompositeMessage {
  type: 'init' | 'process' | 'play' | 'pause' | 'seek' | 'config';
  data: {
    chunks?: any[];
    backgroundConfig?: BackgroundConfig;
    timestamp?: number;
    frameIndex?: number;
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
let decodedFrames: VideoFrame[] = [];
let currentConfig: BackgroundConfig | null = null;
let isPlaying = false;
let currentFrameIndex = 0;
let animationId: number | null = null;

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
    // 正确的逻辑：创建指定比例的画布，内容保持原始比例
    const sourceAspectRatio = sourceWidth / sourceHeight;

    // 定义目标画布比例
    const targetRatios = {
      '16:9': 16 / 9,   // 1.778
      '1:1': 1,         // 1.000
      '9:16': 9 / 16,   // 0.563
      '4:5': 4 / 5      // 0.800
    };

    const targetCanvasRatio = targetRatios[config.outputRatio] || targetRatios['16:9'];

    // 计算 padding
    const padding = (config.padding || 60) + (config.inset || 0);

    // 计算内容区域的最小尺寸（源视频 + padding）
    const minContentWidth = sourceWidth + padding * 2;
    const minContentHeight = sourceHeight + padding * 2;

    console.log('📐 [COMPOSITE-WORKER] Content requirements:', {
      sourceAspectRatio: sourceAspectRatio.toFixed(3),
      targetCanvasRatio: targetCanvasRatio.toFixed(3),
      padding,
      minContentWidth,
      minContentHeight
    });

    // 策略：基于内容需求和目标比例计算画布尺寸
    // 确保画布足够大以容纳内容，同时保持目标比例

    if (targetCanvasRatio >= 1) {
      // 横向或方形画布（如 16:9, 1:1）
      // 优先保证宽度，然后按比例计算高度

      // 方案1：基于内容宽度需求
      const widthBasedHeight = minContentWidth / targetCanvasRatio;

      // 方案2：基于内容高度需求
      const heightBasedWidth = minContentHeight * targetCanvasRatio;

      // 选择能容纳所有内容的方案
      if (widthBasedHeight >= minContentHeight) {
        // 基于宽度的方案足够
        outputWidth = Math.max(minContentWidth, 1280); // 保证最小质量
        outputHeight = Math.round(outputWidth / targetCanvasRatio);
      } else {
        // 需要基于高度的方案
        outputHeight = minContentHeight;
        outputWidth = Math.round(outputHeight * targetCanvasRatio);
      }

    } else {
      // 竖向画布（如 9:16, 4:5）
      // 优先保证高度，然后按比例计算宽度

      // 方案1：基于内容高度需求
      const heightBasedWidth = minContentHeight * targetCanvasRatio;

      // 方案2：基于内容宽度需求
      const widthBasedHeight = minContentWidth / targetCanvasRatio;

      // 选择能容纳所有内容的方案
      if (heightBasedWidth >= minContentWidth) {
        // 基于高度的方案足够
        outputHeight = Math.max(minContentHeight, 1280); // 保证最小质量
        outputWidth = Math.round(outputHeight * targetCanvasRatio);
      } else {
        // 需要基于宽度的方案
        outputWidth = minContentWidth;
        outputHeight = Math.round(outputWidth / targetCanvasRatio);
      }
    }

    console.log('✅ [COMPOSITE-WORKER] Calculated output size:', {
      outputWidth,
      outputHeight,
      outputAspectRatio: (outputWidth / outputHeight).toFixed(3),
      targetCanvasRatio: targetCanvasRatio.toFixed(3),
      canvasType: targetCanvasRatio >= 1 ? 'landscape/square' : 'portrait',
      contentFitsWell: (outputWidth >= minContentWidth && outputHeight >= minContentHeight)
    });
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

  if (config.type === 'gradient') {
    // 创建渐变背景
    const gradient = ctx.createLinearGradient(0, 0, offscreenCanvas.width, offscreenCanvas.height);

    // 蓝色到紫色的渐变
    gradient.addColorStop(0, '#3b82f6');    // 蓝色
    gradient.addColorStop(0.5, '#8b5cf6');  // 紫色
    gradient.addColorStop(1, '#ec4899');    // 粉色

    ctx.fillStyle = gradient;
  } else {
    // 纯色背景
    ctx.fillStyle = config.color;
  }

  ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
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

// 初始化视频解码器（以解码后帧的 displayWidth/displayHeight 为准，避免拉伸变形）
async function initializeDecoder(chunks: any[]) {
  if (!chunks || chunks.length === 0) {
    throw new Error('No video chunks provided');
  }

  const firstChunk = chunks[0];
  const codec = firstChunk.codec || 'vp8';

  console.log('🎬 [COMPOSITE-WORKER] Initializing VideoDecoder with codec:', codec);

  videoDecoder = new VideoDecoder({
    output: (frame: VideoFrame) => {
      decodedFrames.push(frame);
      // 仅调试：不要打印过多日志
      if (decodedFrames.length % 60 === 0) {
        console.log(`📽️ [COMPOSITE-WORKER] Frames decoded: ${decodedFrames.length}/${chunks.length}`);
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
  videoDecoder.configure(decoderConfig);
  console.log('✅ [COMPOSITE-WORKER] VideoDecoder configured:', decoderConfig);

  // 解码所有块
  for (const chunk of chunks) {
    const data = chunk.data instanceof ArrayBuffer ? new Uint8Array(chunk.data) : chunk.data;
    const encodedChunk = new EncodedVideoChunk({
      type: chunk.type === 'key' ? 'key' : 'delta',
      timestamp: chunk.timestamp,
      data
    });
    videoDecoder.decode(encodedChunk);
  }

  await videoDecoder.flush();
  console.log(`✅ [COMPOSITE-WORKER] All frames decoded: ${decodedFrames.length} frames`);

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

  // 使用调试工具分析首帧
  if (decodedFrames.length > 0) {
    const frameAnalysis = VideoDimensionDebugger.analyzeVideoFrame(decodedFrames[0], firstChunk);
    console.log('🔍 [COMPOSITE-WORKER] Frame analysis:', frameAnalysis);

    if (!frameAnalysis.recommendedDimensions.isValid) {
      console.error('❌ [COMPOSITE-WORKER] No valid dimensions found in frame analysis!');
    }
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
  if (!currentConfig || decodedFrames.length === 0) {
    console.error('❌ [COMPOSITE-WORKER] Cannot start playback: missing config or frames');
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

  isPlaying = true;
  const fps = 30;
  const frameInterval = 1000 / fps;
  let lastFrameTime = 0;

  function playFrame() {
    if (!isPlaying) return;

    const now = performance.now();
    if (now - lastFrameTime >= frameInterval) {
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
      } else {
        // 播放完成
        isPlaying = false;
        self.postMessage({
          type: 'complete',
          data: { totalFrames: decodedFrames.length }
        });
        return;
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

        currentConfig = data.backgroundConfig;

        console.log('🔧 [COMPOSITE-WORKER] Received config:', {
          type: currentConfig.type,
          padding: currentConfig.padding,
          inset: currentConfig.inset,
          borderRadius: currentConfig.borderRadius,
          shadow: currentConfig.shadow
        });

        // 计算输出尺寸
        const firstChunk = data.chunks[0];
        console.log('🔍 [COMPOSITE-WORKER] First chunk analysis:', {
          codedWidth: firstChunk.codedWidth,
          codedHeight: firstChunk.codedHeight,
          size: firstChunk.size,
          type: firstChunk.type,
          codec: firstChunk.codec,
          hasData: !!firstChunk.data
        });

        const sourceWidth = firstChunk.codedWidth || 1920;
        const sourceHeight = firstChunk.codedHeight || 1080;

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
        initializeCanvas(outputWidth, outputHeight);
        
        // 初始化解码器并解码
        await initializeDecoder(data.chunks);

        // 计算固定布局
        calculateAndCacheLayout();

        self.postMessage({
          type: 'ready',
          data: {
            totalFrames: decodedFrames.length,
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

      case 'seek':
        console.log('⏭️ [COMPOSITE-WORKER] Seeking to frame:', data.frameIndex);
        if (data.frameIndex !== undefined && data.frameIndex < decodedFrames.length) {
          currentFrameIndex = data.frameIndex;
          
          // 渲染指定帧
          if (currentConfig && decodedFrames[currentFrameIndex] && fixedVideoLayout) {
            const frame = decodedFrames[currentFrameIndex];

            // 使用固定布局
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
};

console.log('🎨 [COMPOSITE-WORKER] Video Composite Worker loaded');
