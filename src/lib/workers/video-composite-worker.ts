// Video Composite Worker - 负责视频背景合成和处理
// 使用 OffscreenCanvas 进行高性能视频合成
// 支持预览显示和 MP4 导出

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

  if (config.outputRatio === 'custom') {
    outputWidth = config.customWidth || 1920;
    outputHeight = config.customHeight || 1080;
  } else {
    // 基于源视频尺寸的动态计算
    const baseWidth = Math.max(sourceWidth, 1920);
    const baseHeight = Math.max(sourceHeight, 1080);

    const ratios = {
      '16:9': {
        w: Math.max(baseWidth, 1920),
        h: Math.max(Math.round(baseWidth * 9 / 16), 1080)
      },
      '1:1': {
        w: Math.max(baseWidth, baseHeight),
        h: Math.max(baseWidth, baseHeight)
      },
      '9:16': {
        w: Math.max(Math.round(baseHeight * 9 / 16), 1080),
        h: Math.max(baseHeight, 1920)
      },
      '4:5': {
        w: Math.max(Math.round(baseHeight * 4 / 5), 1080),
        h: Math.max(baseHeight, 1350)
      }
    };

    const ratio = ratios[config.outputRatio] || ratios['16:9'];
    outputWidth = ratio.w;
    outputHeight = ratio.h;
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
  const targetAspectRatio = availableWidth / availableHeight;

  let layoutWidth: number, layoutHeight: number, layoutX: number, layoutY: number;

  if (videoAspectRatio > targetAspectRatio) {
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
    if (vr) {
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
  const displayWidth = (firstFrame as any).displayWidth || (firstFrame as any).codedWidth || firstChunk.codedWidth || 1920;
  const displayHeight = (firstFrame as any).displayHeight || (firstFrame as any).codedHeight || firstChunk.codedHeight || 1080;

  videoInfo = { width: displayWidth, height: displayHeight };
  console.log('📐 [COMPOSITE-WORKER] Video info (from decoded frame):', videoInfo);
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
        const sourceWidth = firstChunk.codedWidth || 1920;
        const sourceHeight = firstChunk.codedHeight || 1080;
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
