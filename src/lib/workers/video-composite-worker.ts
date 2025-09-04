// Video Composite Worker - 负责视频背景合成和处理
// 使用 OffscreenCanvas 进行高性能视频合成

// 类型定义
interface BackgroundConfig {
  type: 'solid-color' | 'gradient';
  color: string;
  padding: number;
  outputRatio: '16:9' | '1:1' | '9:16' | '4:5' | 'custom';
  customWidth?: number;
  customHeight?: number;
  videoPosition: 'center' | 'top' | 'bottom';
  borderRadius?: number; // 视频圆角半径，默认 20px
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
  const availableWidth = outputWidth - padding * 2;
  const availableHeight = outputHeight - padding * 2;

  // 保持视频纵横比的缩放计算
  const videoAspectRatio = videoWidth / videoHeight;
  const targetAspectRatio = availableWidth / availableHeight;

  let layoutWidth: number, layoutHeight: number, layoutX: number, layoutY: number;

  if (videoAspectRatio > targetAspectRatio) {
    // 视频更宽，以可用宽度为准
    layoutWidth = availableWidth;
    layoutHeight = availableWidth / videoAspectRatio;
    layoutX = padding;
    layoutY = padding + (availableHeight - layoutHeight) / 2; // 垂直居中
  } else {
    // 视频更高，以可用高度为准
    layoutHeight = availableHeight;
    layoutWidth = availableHeight * videoAspectRatio;
    layoutX = padding + (availableWidth - layoutWidth) / 2; // 水平居中
    layoutY = padding;
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

// 渲染合成帧
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

    // 3. 保存当前状态
    ctx.save();

    // 4. 创建圆角遮罩（如果配置了圆角）
    const borderRadius = config.borderRadius || 0; // 默认无圆角

    if (borderRadius > 0) {
      createRoundedRectPath(layout.x, layout.y, layout.width, layout.height, borderRadius);
      ctx.clip();
    }

    // 5. 绘制视频帧（如果有圆角会被遮罩裁剪）
    ctx.drawImage(frame, layout.x, layout.y, layout.width, layout.height);

    // 6. 恢复状态
    ctx.restore();

    // 7. 转换为 ImageBitmap（高效传输）
    const bitmap = offscreenCanvas.transferToImageBitmap();

    console.log(`🎨 [COMPOSITE-WORKER] Frame rendered: ${layout.width}x${layout.height} at (${layout.x}, ${layout.y}), background: ${config.type}, border radius: ${borderRadius}px`);

    return bitmap;
  } catch (error) {
    console.error('❌ [COMPOSITE-WORKER] Render error:', error);
    return null;
  }
}

// 初始化视频解码器
async function initializeDecoder(chunks: any[]) {
  if (!chunks || chunks.length === 0) {
    throw new Error('No video chunks provided');
  }

  const firstChunk = chunks[0];
  const codec = firstChunk.codec || 'vp8';

  console.log('🎬 [COMPOSITE-WORKER] Initializing VideoDecoder with codec:', codec);

  // 保存视频信息（固定尺寸，避免每帧变化）
  videoInfo = {
    width: firstChunk.codedWidth || 1920,
    height: firstChunk.codedHeight || 1080
  };

  console.log('📐 [COMPOSITE-WORKER] Video info saved:', videoInfo);

  videoDecoder = new VideoDecoder({
    output: (frame: VideoFrame) => {
      decodedFrames.push(frame);
      console.log(`📽️ [COMPOSITE-WORKER] Frame decoded: ${decodedFrames.length}/${chunks.length}`);
    },
    error: (error: Error) => {
      console.error('❌ [COMPOSITE-WORKER] Decoder error:', error);
      self.postMessage({
        type: 'error',
        data: error.message
      });
    }
  });

  // 配置解码器
  const decoderConfig = {
    codec: codec,
    codedWidth: videoInfo.width,
    codedHeight: videoInfo.height
  };

  videoDecoder.configure(decoderConfig);
  console.log('✅ [COMPOSITE-WORKER] VideoDecoder configured:', decoderConfig);

  // 解码所有块
  for (const chunk of chunks) {
    // 将 ArrayBuffer 转换为 Uint8Array
    const data = chunk.data instanceof ArrayBuffer ? new Uint8Array(chunk.data) : chunk.data;

    const encodedChunk = new EncodedVideoChunk({
      type: chunk.type === 'key' ? 'key' : 'delta',
      timestamp: chunk.timestamp,
      data: data
    });

    videoDecoder.decode(encodedChunk);
  }

  await videoDecoder.flush();
  console.log(`✅ [COMPOSITE-WORKER] All frames decoded: ${decodedFrames.length} frames`);
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
          currentConfig = data.backgroundConfig;

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
