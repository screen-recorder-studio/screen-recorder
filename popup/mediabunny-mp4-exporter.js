// Professional MP4 Exporter using MediaBunny
// 基于验证成功的 lab/export-mp4/mp4-demo.html 重写的专业级 MP4 导出器
// 完全重写以确保 MP4 导出功能可用

class MediabunnyMp4Exporter {
  constructor() {
    this.mediabunny = null;
    this.isInitialized = false;
    this.isExporting = false;
    this.currentOutput = null;
    this.currentVideoSource = null;
    this.exportedBlob = null;
    this.smartRenderer = null; // 智能渲染器
    
    console.log('🎬 MediabunnyMp4Exporter 初始化中...');
    
    // 尝试初始化智能渲染器
    if (window.SmartTextRenderer) {
      this.smartRenderer = new window.SmartTextRenderer();
      console.log('✅ 智能文字渲染器已加载');
    }
  }

  // 初始化 Mediabunny
  async initialize() {
    try {
      console.log('🔄 开始初始化 Mediabunny...');
      
      // 等待 Mediabunny 加载
      if (window.mediabunnyLoader) {
        this.mediabunny = await window.mediabunnyLoader.waitForLoad();
        console.log('✅ Mediabunny 已通过加载器加载');
      } else if (window.Mediabunny) {
        this.mediabunny = window.Mediabunny;
        console.log('✅ Mediabunny 已直接可用');
      } else {
        throw new Error('Mediabunny 库未找到');
      }

      // 验证必要的 API
      if (!this.mediabunny.Output || !this.mediabunny.Mp4OutputFormat || !this.mediabunny.BufferTarget) {
        throw new Error('Mediabunny API 不完整');
      }

      // 验证 CanvasSource
      if (!this.mediabunny.CanvasSource) {
        throw new Error('Mediabunny CanvasSource 不可用');
      }

      this.isInitialized = true;
      console.log('✅ MediabunnyMp4Exporter 初始化完成');
      
      return true;
    } catch (error) {
      console.error('❌ MediabunnyMp4Exporter 初始化失败:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  // 检查是否已初始化
  checkInitialized() {
    if (!this.isInitialized) {
      throw new Error('MediabunnyMp4Exporter 未初始化，请先调用 initialize()');
    }
  }

  // 主要导出方法 - 直接在MediaBunny中应用编辑效果
  async exportToMp4(videoBlob, options = {}) {
    this.checkInitialized();

    if (this.isExporting) {
      throw new Error('正在导出中，请等待当前导出完成');
    }

    const {
      quality = 'high',
      backgroundConfig = null,
      frameRate = 30,
      progressCallback = () => {}
    } = options;

    this.isExporting = true;

    try {
      console.log('🚀 开始 MP4 导出，配置:', { quality, backgroundConfig, frameRate });

      progressCallback(0.05, '准备视频数据...');

      // 步骤1：创建视频元素
      const video = await this.createVideoElement(videoBlob);

      progressCallback(0.1, '创建编辑画布...');

      // 步骤2：创建包含编辑效果的Canvas
      const canvas = this.createEditingCanvas(video, backgroundConfig);

      progressCallback(0.15, '计算编辑布局...');

      // 步骤3：计算视频布局（包含编辑效果）
      const layout = this.calculateVideoLayout(video, canvas, backgroundConfig);

      progressCallback(0.2, '初始化 MediaBunny 导出...');

      // 步骤4：直接使用MediaBunny导出，在导出过程中应用编辑效果
      const result = await this.exportWithEditingEffects(canvas, video, layout, backgroundConfig, {
        quality,
        frameRate,
        progressCallback: (progress, message) => {
          // 映射进度到 20%-95%
          const mappedProgress = 0.2 + (progress * 0.75);
          progressCallback(mappedProgress, message);
        }
      });

      progressCallback(0.95, '完成处理...');

      // 计算压缩信息
      const originalSize = videoBlob.size;
      const finalSize = result.size;
      const compression = ((originalSize - finalSize) / originalSize) * 100;

      progressCallback(1.0, 'MP4 导出完成！');

      console.log('✅ MP4 导出成功:', {
        originalSize: `${(originalSize / 1024 / 1024).toFixed(2)} MB`,
        finalSize: `${(finalSize / 1024 / 1024).toFixed(2)} MB`,
        compression: `${compression.toFixed(1)}%`
      });

      return {
        blob: result,
        originalSize,
        finalSize,
        compression,
        format: 'mp4'
      };

    } catch (error) {
      console.error('❌ MP4 导出失败:', error);
      throw error;
    } finally {
      this.cleanup();
      this.isExporting = false;
    }
  }

  // 创建视频元素并检测有效时长
  async createVideoElement(videoBlob) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.preload = 'metadata';

      video.onloadedmetadata = async () => {
        console.log('视频元数据加载完成:', {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          seekable: video.seekable.length > 0 ? video.seekable.end(0) : 'none'
        });

        // 额外的时长验证
        await this.validateVideoDuration(video);
        resolve(video);
      };

      video.onerror = (error) => {
        console.error('视频加载失败:', error);
        reject(new Error('视频加载失败'));
      };

      video.src = URL.createObjectURL(videoBlob);
    });
  }

  // 验证视频时长
  async validateVideoDuration(video) {
    // 如果时长无效，尝试通过 seek 操作来检测
    if (!isFinite(video.duration) || video.duration <= 0) {
      console.log('尝试通过 seek 操作检测视频时长...');

      try {
        // 尝试 seek 到不同位置来检测实际时长
        const testPositions = [10, 30, 60, 120]; // 测试位置（秒）
        let detectedDuration = 0;

        for (const pos of testPositions) {
          video.currentTime = pos;
          await new Promise(resolve => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              resolve();
            };
            video.addEventListener('seeked', onSeeked);

            // 超时保护
            setTimeout(() => {
              video.removeEventListener('seeked', onSeeked);
              resolve();
            }, 1000);
          });

          if (video.currentTime < pos) {
            detectedDuration = video.currentTime;
            break;
          }
        }

        if (detectedDuration > 0) {
          console.log('检测到的视频时长:', detectedDuration);
          // 将检测到的时长存储为自定义属性
          video._detectedDuration = detectedDuration;
        }

        // 重置到开始位置
        video.currentTime = 0;

      } catch (error) {
        console.warn('时长检测失败:', error);
      }
    }
  }

  // 创建处理画布
  async createProcessingCanvas(video, backgroundConfig, width, height, fit) {
    const canvas = document.createElement('canvas');
    
    // 设置画布尺寸
    if (width && height) {
      canvas.width = width;
      canvas.height = height;
    } else {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    
    console.log('创建处理画布:', {
      width: canvas.width,
      height: canvas.height,
      videoSize: `${video.videoWidth}x${video.videoHeight}`
    });
    
    return canvas;
  }

  // 启动视频渲染
  async startVideoRendering(video, canvas, backgroundConfig) {
    const ctx = canvas.getContext('2d');
    
    // 设置高质量渲染
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // 如果有背景配置，绘制一帧测试
    if (backgroundConfig) {
      this.renderFrameWithBackground(ctx, video, canvas, backgroundConfig);
    } else {
      // 绘制原始视频帧
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    
    console.log('视频渲染已启动');
  }

  // 渲染带背景的帧
  renderFrameWithBackground(ctx, video, canvas, backgroundConfig) {
    // 清除画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制背景
    if (backgroundConfig && backgroundConfig.color) {
      ctx.fillStyle = backgroundConfig.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    // 计算视频位置（考虑padding）
    const padding = backgroundConfig?.padding || 0;
    const availableWidth = canvas.width - padding * 2;
    const availableHeight = canvas.height - padding * 2;
    
    // 保持宽高比居中绘制视频
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const targetAspectRatio = availableWidth / availableHeight;
    
    let drawWidth, drawHeight, drawX, drawY;
    
    if (videoAspectRatio > targetAspectRatio) {
      // 视频更宽，以宽度为准
      drawWidth = availableWidth;
      drawHeight = availableWidth / videoAspectRatio;
      drawX = padding;
      drawY = padding + (availableHeight - drawHeight) / 2;
    } else {
      // 视频更高，以高度为准
      drawHeight = availableHeight;
      drawWidth = availableHeight * videoAspectRatio;
      drawX = padding + (availableWidth - drawWidth) / 2;
      drawY = padding;
    }
    
    // ✅ 确保所有坐标都是整数，避免亚像素渲染
    const alignedX = Math.round(drawX);
    const alignedY = Math.round(drawY);
    const alignedWidth = Math.round(drawWidth);
    const alignedHeight = Math.round(drawHeight);
    
    // 绘制视频
    ctx.drawImage(video, alignedX, alignedY, alignedWidth, alignedHeight);
  }

  // 直接在MediaBunny导出中应用编辑效果
  async exportWithEditingEffects(canvas, video, layout, backgroundConfig, options = {}) {
    const {
      quality = 'high',
      frameRate = 30,
      progressCallback = () => {}
    } = options;

    try {
      progressCallback(0.02, '初始化质量优化器...');

      // 🔧 集成质量优化器和文字闪动修复器
      let optimizer = null;
      let flickerFix = null;

      try {
        // 初始化质量优化器
        if (window.MP4QualityOptimizer) {
          optimizer = new window.MP4QualityOptimizer();
          console.log('✅ 质量优化器已加载');

          // 检查是否需要优化
          if (optimizer.shouldOptimize(video, canvas)) {
            console.log('⚠️ 检测到质量问题，启用优化模式');
            const optimized = optimizer.optimizeForTextClarity(canvas, video, backgroundConfig);
            canvas = optimized.canvas;
            layout = optimized.layout;
            console.log('✅ 质量优化完成');
          } else {
            console.log('✅ 质量检查通过，使用标准模式');
          }
        } else {
          console.log('⚠️ 质量优化器未找到，使用标准模式');
        }

        // 初始化文字闪动修复器
        if (window.TextFlickerFix) {
          flickerFix = new window.TextFlickerFix();
          console.log('✅ 文字闪动修复器已加载');
        } else {
          console.log('⚠️ 文字闪动修复器未找到');
        }

      } catch (error) {
        console.warn('优化器初始化失败，使用标准模式:', error);
        optimizer = null;
        flickerFix = null;
      }

      progressCallback(0.05, '验证Canvas尺寸...');

      // 验证Canvas尺寸
      if (canvas.width <= 0 || canvas.height <= 0) {
        throw new Error(`Canvas尺寸无效: ${canvas.width}x${canvas.height}`);
      }

      console.log('Canvas尺寸验证通过:', { width: canvas.width, height: canvas.height });

      progressCallback(0.1, '创建 MediaBunny 输出...');

      // 按照官方示例创建 Output
      const output = new this.mediabunny.Output({
        format: new this.mediabunny.Mp4OutputFormat(),
        target: new this.mediabunny.BufferTarget() // Writing to memory
      });

      progressCallback(0.2, '创建 Canvas 视频源...');

      // 🔧 使用优化的编码参数
      let encodingParams;
      if (optimizer) {
        encodingParams = optimizer.getOptimizedEncodingParams(canvas, quality);
        console.log('使用优化编码参数:', encodingParams);
      } else {
        // 降级到原有方法
        const qualityValue = this.getCompatibleQualityValue(quality, canvas);
        encodingParams = {
          codec: 'avc',
          bitrate: qualityValue
        };
        console.log('使用标准编码参数:', encodingParams);
      }

      // Add a video track backed by a canvas element - 使用优化配置
      const videoSource = new this.mediabunny.CanvasSource(canvas, {
        codec: encodingParams.codec,
        bitrate: encodingParams.bitrate
      });

      progressCallback(0.3, '添加视频轨道...');

      // 添加视频轨道
      output.addVideoTrack(videoSource);

      progressCallback(0.4, '启动输出...');

      // 开始输出
      await output.start();
      console.log('MediaBunny 输出已启动');

      progressCallback(0.5, '添加Canvas帧数据...');

      // 注意：此时Canvas已经包含了编辑效果，直接使用Canvas内容
      console.log('开始将编辑后的Canvas添加到 CanvasSource...');

      // 计算总帧数和持续时间 - 修复 Infinity 问题
      let duration = video.duration;

      // 处理 duration 为 Infinity 或无效值的情况
      if (!isFinite(duration) || duration <= 0) {
        console.warn('视频时长无效:', duration);

        // 优先使用检测到的时长
        if (video._detectedDuration && video._detectedDuration > 0) {
          duration = video._detectedDuration;
          console.log('使用检测到的时长:', duration);
        }
        // 尝试通过 seekable 范围获取时长
        else if (video.seekable && video.seekable.length > 0) {
          const seekableEnd = video.seekable.end(video.seekable.length - 1);
          if (isFinite(seekableEnd) && seekableEnd > 0) {
            duration = Math.min(seekableEnd, 30); // 最大30秒
            console.log('从 seekable 获取时长:', duration);
          } else {
            duration = 5; // 默认5秒
          }
        } else {
          duration = 5; // 默认5秒
        }
      }

      // 限制最大时长以避免过长的处理时间
      duration = Math.min(duration, 60); // 最大60秒

      // 确保时长是有效的正数
      if (!isFinite(duration) || duration <= 0) {
        console.error('无法确定有效的视频时长，使用默认值');
        duration = 5;
      }

      const totalFrames = Math.floor(duration * frameRate);
      const frameDuration = 1 / frameRate; // 每帧持续时间（秒）

      // 安全检查：防止无限循环
      if (!isFinite(totalFrames) || totalFrames <= 0) {
        throw new Error(`无效的总帧数: ${totalFrames}`);
      }

      if (totalFrames > 10000) { // 限制最大帧数
        throw new Error(`帧数过多 (${totalFrames})，可能导致内存问题`);
      }

      console.log(`修正后的参数: 时长=${duration}秒, 总帧数=${totalFrames}, 帧间隔=${frameDuration}秒`);

      // 手动添加每一帧 - Canvas已包含编辑效果
      const startTime = Date.now();
      const maxProcessingTime = 5 * 60 * 1000; // 最大处理时间 5 分钟

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        // 检查处理时间是否超时
        if (Date.now() - startTime > maxProcessingTime) {
          console.warn(`处理超时，已处理 ${frameIndex}/${totalFrames} 帧`);
          break;
        }

        const timestamp = frameIndex * frameDuration; // 时间戳（秒）

        // 确保时间戳不超过视频时长
        if (timestamp >= duration) {
          console.log(`时间戳 ${timestamp} 超过视频时长 ${duration}，停止处理`);
          break;
        }

        // 精确的时间戳设置，避免浮点误差
        const preciseTimestamp = Math.min(Math.round(timestamp * 1000) / 1000, duration - 0.1);
        video.currentTime = preciseTimestamp;

        // 等待视频帧更新 - 带超时保护和稳定性检查
        await new Promise(resolve => {
          const timeout = setTimeout(() => {
            video.onseeked = null;
            resolve();
          }, 500); // 减少超时时间

          video.onseeked = () => {
            clearTimeout(timeout);
            video.onseeked = null;
            resolve();
          };

          if (video.readyState >= 2) {
            clearTimeout(timeout);
            resolve();
          }
        });

        // 额外的帧稳定等待
        await new Promise(resolve => setTimeout(resolve, 16)); // 等待一帧时间

        // 🔧 在Canvas上应用编辑效果并渲染当前帧（使用优化器和闪动修复）
        this.renderFrameWithEditingEffects(canvas, video, layout, backgroundConfig, optimizer, flickerFix, timestamp);

        // 双重帧等待确保稳定性
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));

        try {
          // 按照官方文档：await videoSource.add(timestamp, duration)
          await videoSource.add(timestamp, frameDuration);
        } catch (error) {
          console.error(`添加帧 ${frameIndex} 失败:`, error);
          // 继续处理下一帧，不中断整个过程
        }

        // 更新进度
        const progress = 0.5 + (frameIndex / totalFrames) * 0.4; // 50%-90% 用于添加帧
        progressCallback(progress, `添加Canvas帧 ${frameIndex + 1}/${totalFrames}`);

        // 每10帧输出一次日志
        if (frameIndex % 10 === 0) {
          console.log(`已添加Canvas帧 ${frameIndex + 1}/${totalFrames}, 时间戳: ${timestamp.toFixed(3)}s`);
        }
      }

      console.log('所有帧添加完成');

      progressCallback(0.9, '完成录制，生成 MP4...');

      // 完成输出
      await output.finalize();
      console.log('MediaBunny 输出已完成');

      progressCallback(0.95, '获取结果...');

      // 获取结果 - Final MP4 file
      const buffer = output.target.buffer;
      console.log('输出 buffer 大小:', buffer ? buffer.byteLength : 0, 'bytes');

      if (!buffer || buffer.byteLength === 0) {
        throw new Error('生成的 MP4 buffer 为空');
      }

      const blob = new Blob([buffer], { type: 'video/mp4' });
      console.log('最终 MP4 blob 大小:', blob.size, 'bytes');

      // 保存引用
      this.currentOutput = output;
      this.currentVideoSource = videoSource;
      this.exportedBlob = blob;

      progressCallback(1.0, 'MP4 导出完成！');
      return blob;

    } catch (error) {
      console.error('MediaBunny 导出失败:', error);
      throw error;
    }
  }



  // 渲染带编辑效果的帧 - 集成质量优化和文字闪动修复
  renderFrameWithEditingEffects(canvas, video, layout, backgroundConfig, optimizer = null, flickerFix = null, timestamp = 0) {
    // 检查Canvas尺寸
    if (canvas.width <= 0 || canvas.height <= 0) {
      console.error('Canvas尺寸无效:', { width: canvas.width, height: canvas.height });
      // 修复Canvas尺寸
      canvas.width = Math.max(canvas.width, 1920);
      canvas.height = Math.max(canvas.height, 1080);
      console.log('已修复Canvas尺寸为:', { width: canvas.width, height: canvas.height });
    }

    const ctx = canvas.getContext('2d');

    // 🔧 优先使用文字闪动修复器
    if (flickerFix && flickerFix.applyFlickerFix) {
      try {
        const originalRenderFunction = (ctx, video, layout, backgroundConfig) => {
          if (optimizer && optimizer.renderOptimizedFrame) {
            optimizer.renderOptimizedFrame(ctx, video, layout, backgroundConfig);
          } else {
            this.standardRenderFrame(ctx, video, layout, backgroundConfig);
          }
          return true;
        };

        const success = flickerFix.applyFlickerFix(
          originalRenderFunction,
          ctx,
          video,
          layout,
          backgroundConfig,
          timestamp
        );

        if (success) {
          return; // 闪动修复渲染完成
        }
      } catch (error) {
        console.warn('文字闪动修复失败，降级到优化渲染:', error);
      }
    }

    // 🔧 降级到优化渲染方法
    if (optimizer && optimizer.renderOptimizedFrame) {
      try {
        optimizer.renderOptimizedFrame(ctx, video, layout, backgroundConfig);
        return; // 优化渲染完成，直接返回
      } catch (error) {
        console.warn('优化渲染失败，降级到标准渲染:', error);
        // 继续使用标准渲染方法
      }
    }

    // 🔧 优先使用智能渲染器
    if (this.smartRenderer) {
      try {
        this.smartRenderer.renderOptimized(ctx, video, layout, backgroundConfig);
        return;
      } catch (error) {
        console.warn('智能渲染失败，降级到标准渲染:', error);
      }
    }
    
    // 标准渲染方法（降级处理）
    // 保存当前状态
    ctx.save();

    // 优化文字清晰度的渲染设置
    this.optimizeContextForTextClarity(ctx, video, layout);

    // 清除画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制背景
    if (backgroundConfig && backgroundConfig.color) {
      ctx.fillStyle = backgroundConfig.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 绘制视频帧（应用像素对齐的布局）
    if (video.readyState >= 2 && layout.width > 0 && layout.height > 0) {
      try {
        // 确保坐标是整数
        const alignedX = Math.floor(layout.x); // 使用floor避免四舍五入导致的抖动
        const alignedY = Math.floor(layout.y);
        const alignedWidth = Math.ceil(layout.width); // 使用ceil确保覆盖完整
        const alignedHeight = Math.ceil(layout.height);

        // 根据缩放比例决定是否使用双缓冲
        const scaleX = layout.width / video.videoWidth;
        const scaleY = layout.height / video.videoHeight;
        const avgScale = (scaleX + scaleY) / 2;
        
        if (avgScale < 0.9 || avgScale > 1.1) {
          // 非1:1时使用双缓冲
          const offscreenCanvas = document.createElement('canvas');
          offscreenCanvas.width = alignedWidth;
          offscreenCanvas.height = alignedHeight;
          const offscreenCtx = offscreenCanvas.getContext('2d');
          
          // 根据缩放调整平滑设置
          if (Math.abs(avgScale - 1) < 0.1) {
            offscreenCtx.imageSmoothingEnabled = false;
          } else {
            offscreenCtx.imageSmoothingEnabled = true;
            offscreenCtx.imageSmoothingQuality = avgScale < 0.8 ? 'medium' : 'high';
          }
          
          // 绘制到离屏canvas
          offscreenCtx.drawImage(
            video,
            0, 0,
            offscreenCanvas.width,
            offscreenCanvas.height
          );
          
          // 将离屏canvas内容绘制到主canvas（不平滑）
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            offscreenCanvas,
            alignedX,
            alignedY,
            alignedWidth,
            alignedHeight
          );
        } else {
          // 接近1:1时直接绘制
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            video,
            alignedX,
            alignedY,
            alignedWidth,
            alignedHeight
          );
        }
      } catch (error) {
        console.error('绘制视频帧失败:', error);
      }
    }

    // 恢复状态
    ctx.restore();
  }

  // 标准渲染方法（用于降级处理）
  standardRenderFrame(ctx, video, layout, backgroundConfig) {
    // 保存当前状态
    ctx.save();

    // 优化文字清晰度的渲染设置
    this.optimizeContextForTextClarity(ctx, video, layout);

    // 清除画布
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 绘制背景
    if (backgroundConfig && backgroundConfig.color) {
      ctx.fillStyle = backgroundConfig.color;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    // 绘制视频帧（应用像素对齐的布局）
    if (video.readyState >= 2 && layout.width > 0 && layout.height > 0) {
      try {
        // ✅ 确保坐标是整数
        const alignedX = Math.round(layout.x);
        const alignedY = Math.round(layout.y);
        const alignedWidth = Math.round(layout.width);
        const alignedHeight = Math.round(layout.height);

        // ✅ 使用双缓冲技术减少闪烁
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = alignedWidth;
        offscreenCanvas.height = alignedHeight;
        const offscreenCtx = offscreenCanvas.getContext('2d');
        
        // 在离屏canvas上应用相同的优化设置
        offscreenCtx.imageSmoothingEnabled = true;
        offscreenCtx.imageSmoothingQuality = 'high';
        
        // 绘制到离屏canvas
        offscreenCtx.drawImage(
          video,
          0, 0,
          offscreenCanvas.width,
          offscreenCanvas.height
        );
        
        // 将离屏canvas内容绘制到主canvas
        ctx.drawImage(
          offscreenCanvas,
          alignedX,
          alignedY,
          alignedWidth,
          alignedHeight
        );
      } catch (error) {
        console.error('绘制视频帧失败:', error);
      }
    }

    // 恢复状态
    ctx.restore();
  }

  // 优化Context设置以消除文字锯齿和抖动
  optimizeContextForTextClarity(ctx, video, layout) {
    // 计算缩放比例
    const scaleX = layout.width / video.videoWidth;
    const scaleY = layout.height / video.videoHeight;
    const avgScale = (scaleX + scaleY) / 2;

    console.log('视频缩放比例:', { scaleX, scaleY, avgScale });

    // 🔧 智能渲染策略：根据缩放比例动态调整
    if (Math.abs(avgScale - 1) < 0.1) {
      // 接近1:1，使用像素完美渲染避免模糊
      ctx.imageSmoothingEnabled = false;
      console.log('📐 使用像素完美渲染（接近1:1）');
    } else if (avgScale < 0.8) {
      // 明显缩小，需要特殊处理保持清晰度
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium'; // 使用中等质量避免过度模糊
      console.log('🔽 缩小渲染，使用中等平滑');
    } else if (avgScale > 1.2) {
      // 明显放大，需要高质量平滑
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      console.log('🔼 放大渲染，使用高质量平滑');
    } else {
      // 轻微缩放，使用低平滑保持锐度
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      console.log('〰️ 轻微缩放，使用低平滑');
    }

    // 设置最佳渲染模式
    ctx.globalCompositeOperation = 'source-over';
    
    // 不使用任何偏移，避免模糊
    // NO ctx.translate() !

    // 设置文字渲染属性
    if (ctx.textRendering) {
      // 根据缩放选择渲染模式
      ctx.textRendering = avgScale < 0.8 ? 'optimizeSpeed' : 'optimizeLegibility';
    }
    if (ctx.fontSmooth) {
      // 小字体时减少平滑
      ctx.fontSmooth = avgScale < 0.8 ? 'auto' : 'always';
    }
    
    // 针对小字体的锐化处理
    if (ctx.filter !== undefined) {
      if (avgScale < 0.7) {
        // 严重缩小时使用锐化滤镜
        ctx.filter = 'contrast(1.1) brightness(1.02)';
      } else if (avgScale < 0.9) {
        // 轻微缩小时使用轻微锐化
        ctx.filter = 'contrast(1.05)';
      } else {
        ctx.filter = 'none';
      }
    }

    console.log('✅ 应用智能文字渲染设置');
  }

  // 获取兼容的质量值 - 优化文字内容的比特率
  getCompatibleQualityValue(quality, canvas) {
    const pixels = canvas.width * canvas.height;

    // 为文字内容提供更高的基础比特率
    let baseBitrate;
    if (pixels >= 2560 * 1440) {
      baseBitrate = 12000000;  // 2K: 12 Mbps (提高)
    } else if (pixels >= 1920 * 1080) {
      baseBitrate = 8000000;   // FHD: 8 Mbps (提高)
    } else if (pixels >= 1280 * 720) {
      baseBitrate = 5000000;   // HD: 5 Mbps (提高)
    } else {
      baseBitrate = 3000000;   // SD: 3 Mbps (提高)
    }

    // 根据质量设置调整，为文字内容优化
    const qualityMultipliers = {
      'low': 0.7,      // 稍微提高低质量设置
      'medium': 0.9,   // 稍微提高中等质量设置
      'high': 1.2,     // 提高高质量设置
      'ultra': 1.6     // 提高超高质量设置
    };

    const multiplier = qualityMultipliers[quality] || 1.2;
    const finalBitrate = Math.round(baseBitrate * multiplier);

    // 限制最大比特率以避免编码器问题
    const maxBitrate = 20000000; // 提高到 20 Mbps
    const result = Math.min(finalBitrate, maxBitrate);

    console.log('比特率计算:', {
      pixels,
      quality,
      baseBitrate,
      multiplier,
      finalBitrate: result,
      note: '已优化文字内容的比特率'
    });

    return result;
  }

  // 获取质量值（备用方法）
  getQualityValue(quality) {
    const qualityMap = {
      'low': this.mediabunny.QUALITY_LOW || 1000000,
      'medium': this.mediabunny.QUALITY_MEDIUM || 2500000,
      'high': this.mediabunny.QUALITY_HIGH || 5000000,
      'ultra': this.mediabunny.QUALITY_ULTRA || 10000000
    };

    return qualityMap[quality] || qualityMap['high'];
  }



  // 创建编辑画布 - 优化文字渲染
  createEditingCanvas(video, backgroundConfig) {
    const canvas = document.createElement('canvas');

    // 确保视频尺寸有效
    const videoWidth = video.videoWidth || 1920;
    const videoHeight = video.videoHeight || 1080;

    console.log('视频原始尺寸:', { videoWidth, videoHeight });

    // 根据背景配置确定画布尺寸
    if (backgroundConfig) {
      const { outputRatio, customWidth, customHeight } = backgroundConfig;

      if (outputRatio === 'custom' && customWidth && customHeight && customWidth > 0 && customHeight > 0) {
        canvas.width = customWidth;
        canvas.height = customHeight;
      } else {
        // 根据输出比例计算尺寸
        const dimensions = this.calculateCanvasDimensions(video, outputRatio);
        canvas.width = dimensions.w;
        canvas.height = dimensions.h;
      }
    } else {
      // 默认使用视频原始尺寸，确保不为0
      canvas.width = Math.max(videoWidth, 640);
      canvas.height = Math.max(videoHeight, 480);
    }

    // 最终安全检查：确保Canvas尺寸合理
    if (canvas.width <= 0 || canvas.height <= 0) {
      console.warn('Canvas尺寸无效，使用默认尺寸');
      canvas.width = 1920;
      canvas.height = 1080;
    }

    // 限制最大尺寸以避免编码器问题
    const maxDimension = 2560;
    if (canvas.width > maxDimension || canvas.height > maxDimension) {
      console.warn('Canvas尺寸过大，进行缩放:', {
        original: `${canvas.width}x${canvas.height}`,
        max: maxDimension
      });

      const aspectRatio = canvas.width / canvas.height;
      if (canvas.width > canvas.height) {
        canvas.width = maxDimension;
        canvas.height = Math.round(maxDimension / aspectRatio);
      } else {
        canvas.height = maxDimension;
        canvas.width = Math.round(maxDimension * aspectRatio);
      }

      console.log('Canvas尺寸已缩放为:', `${canvas.width}x${canvas.height}`);
    }

    // 配置Canvas以获得最佳文字渲染效果
    this.configureCanvasForTextRendering(canvas);

    console.log('创建编辑画布:', {
      width: canvas.width,
      height: canvas.height,
      videoSize: `${videoWidth}x${videoHeight}`,
      backgroundConfig: backgroundConfig?.outputRatio
    });

    return canvas;
  }

  // 配置Canvas以获得最佳文字渲染效果
  configureCanvasForTextRendering(canvas) {
    // 设置Canvas样式以优化文字渲染
    canvas.style.imageRendering = 'pixelated'; // 像素完美渲染
    canvas.style.imageRendering = '-moz-crisp-edges'; // Firefox
    canvas.style.imageRendering = '-webkit-optimize-contrast'; // WebKit
    canvas.style.imageRendering = 'crisp-edges'; // 标准

    // 获取Context并设置基础属性
    const ctx = canvas.getContext('2d', {
      alpha: false, // 不需要透明度
      desynchronized: true, // 减少延迟
      colorSpace: 'srgb', // 确保颜色空间一致
      willReadFrequently: false // 优化性能
    });

    if (ctx) {
      // 完全禁用图像平滑
      ctx.imageSmoothingEnabled = false;

      // 设置文字渲染优化
      ctx.textRenderingOptimization = 'optimizeSpeed';
      ctx.globalCompositeOperation = 'source-over';

      console.log('Canvas已配置为像素完美文字渲染模式');
    }
  }

  // 计算画布尺寸 - 优化文字清晰度
  calculateCanvasDimensions(video, outputRatio) {
    const sourceWidth = video.videoWidth || 1920;
    const sourceHeight = video.videoHeight || 1080;

    console.log('计算画布尺寸，输入:', { sourceWidth, sourceHeight, outputRatio });

    // 限制最大尺寸以避免编码器问题
    const maxWidth = 2560;  // 最大宽度
    const maxHeight = 1440; // 最大高度

    // 优化策略：尽量保持接近原始分辨率以减少缩放
    const baseWidth = Math.min(Math.max(sourceWidth, 1280), maxWidth); // 降低最小值
    const baseHeight = Math.min(Math.max(sourceHeight, 720), maxHeight); // 降低最小值

    const ratios = {
      '16:9': {
        // 优先使用原始尺寸，如果比例合适
        w: sourceWidth >= sourceHeight ? Math.min(sourceWidth, maxWidth) : Math.min(baseWidth, maxWidth),
        h: sourceWidth >= sourceHeight ? Math.min(Math.round(sourceWidth * 9 / 16), maxHeight) : Math.min(Math.round(baseWidth * 9 / 16), maxHeight)
      },
      '1:1': {
        // 正方形：使用较小的边作为基准，减少缩放
        w: Math.min(Math.min(sourceWidth, sourceHeight), 1920),
        h: Math.min(Math.min(sourceWidth, sourceHeight), 1920)
      },
      '9:16': {
        w: Math.min(Math.round(baseHeight * 9 / 16), maxWidth),
        h: Math.min(baseHeight, maxHeight)
      },
      '4:5': {
        w: Math.min(Math.round(baseHeight * 4 / 5), maxWidth),
        h: Math.min(baseHeight, maxHeight)
      }
    };

    let result = ratios[outputRatio] || { w: sourceWidth, h: sourceHeight };

    // 确保尺寸在合理范围内，但优先保持原始比例
    result.w = Math.max(640, Math.min(result.w, maxWidth));
    result.h = Math.max(480, Math.min(result.h, maxHeight));

    // 最终安全检查
    if (result.w <= 0 || result.h <= 0) {
      console.warn('计算的画布尺寸无效，使用默认值');
      result.w = 1920;
      result.h = 1080;
    }

    // 计算与原始尺寸的比例，用于优化建议
    const scaleFactorX = result.w / sourceWidth;
    const scaleFactorY = result.h / sourceHeight;
    const minScaleFactor = Math.min(scaleFactorX, scaleFactorY);

    console.log('计算画布尺寸，输出:', {
      result,
      scaleFactor: minScaleFactor.toFixed(3),
      recommendation: minScaleFactor < 0.8 ? '建议减少边距或使用更大的输出尺寸' : '尺寸合理'
    });

    return result;
  }

  // 计算视频布局 - 优化文字清晰度
  calculateVideoLayout(video, canvas, backgroundConfig) {
    // 智能边距：根据Canvas和视频尺寸动态调整
    let padding = backgroundConfig?.padding || 0;

    // 如果视频尺寸接近Canvas尺寸，减少边距以避免过度缩放
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const canvasAspectRatio = canvas.width / canvas.height;
    const aspectRatioDiff = Math.abs(videoAspectRatio - canvasAspectRatio);

    // 如果宽高比相近，可以减少边距
    if (aspectRatioDiff < 0.1 && padding > 30) {
      padding = Math.max(padding * 0.5, 20); // 减少边距但保持最小值
      console.log('检测到相近宽高比，减少边距至:', padding);
    }

    const availableWidth = canvas.width - padding * 2;
    const availableHeight = canvas.height - padding * 2;

    // 计算视频缩放以适应可用空间（保持纵横比）
    const targetAspectRatio = availableWidth / availableHeight;

    let videoWidth, videoHeight, videoX, videoY;

    if (videoAspectRatio > targetAspectRatio) {
      // 视频更宽，以宽度为准
      videoWidth = availableWidth;
      videoHeight = availableWidth / videoAspectRatio;
      videoX = padding;
      videoY = padding + (availableHeight - videoHeight) / 2;
    } else {
      // 视频更高，以高度为准
      videoHeight = availableHeight;
      videoWidth = availableHeight * videoAspectRatio;
      videoX = padding + (availableWidth - videoWidth) / 2;
      videoY = padding;
    }

    // 计算缩放比例用于渲染优化
    const scaleX = videoWidth / video.videoWidth;
    const scaleY = videoHeight / video.videoHeight;
    const minScale = Math.min(scaleX, scaleY);

    // 像素对齐以消除抖动
    const alignedVideoX = Math.round(videoX);
    const alignedVideoY = Math.round(videoY);
    const alignedVideoWidth = Math.round(videoWidth);
    const alignedVideoHeight = Math.round(videoHeight);

    const layout = {
      x: alignedVideoX,
      y: alignedVideoY,
      width: alignedVideoWidth,
      height: alignedVideoHeight,
      scaleX,
      scaleY,
      minScale,
      originalPadding: backgroundConfig?.padding || 0,
      adjustedPadding: padding,
      // 添加原始浮点值用于调试
      originalX: videoX,
      originalY: videoY,
      originalWidth: videoWidth,
      originalHeight: videoHeight
    };

    console.log('视频布局计算:', {
      canvas: `${canvas.width}x${canvas.height}`,
      video: `${video.videoWidth}x${video.videoHeight}`,
      layout: `${Math.round(videoWidth)}x${Math.round(videoHeight)}`,
      scale: `${(minScale * 100).toFixed(1)}%`,
      padding: `${backgroundConfig?.padding || 0} → ${padding}`,
      clarity: minScale >= 0.8 ? '良好' : minScale >= 0.6 ? '一般' : '较差'
    });

    return layout;
  }





  // 清理资源
  cleanup() {
    if (this.currentOutput) {
      this.currentOutput = null;
    }

    if (this.currentVideoSource) {
      this.currentVideoSource = null;
    }

    console.log('MediabunnyMp4Exporter 资源已清理');
  }
}

// 导出类
window.MediabunnyMp4Exporter = MediabunnyMp4Exporter;
