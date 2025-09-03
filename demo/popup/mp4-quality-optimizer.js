// MP4 质量优化器 - 解决文字模糊和画面抖动问题
class MP4QualityOptimizer {
    constructor() {
        this.name = 'MP4QualityOptimizer';
        this.version = '1.0.0';
    }

    // 主要优化方法：解决文字模糊和抖动问题
    optimizeForTextClarity(canvas, video, backgroundConfig = null) {
        console.log('🔧 开始 MP4 质量优化...');
        
        const ctx = canvas.getContext('2d');
        
        // 1. 优化 Canvas 分辨率 - 关键改进
        this.optimizeCanvasResolution(canvas, video, backgroundConfig);
        
        // 2. 设置最佳渲染参数
        this.setupOptimalRenderingContext(ctx);
        
        // 3. 计算精确的布局参数
        const layout = this.calculatePreciseLayout(video, canvas, backgroundConfig);
        
        console.log('✅ MP4 质量优化完成');
        return { canvas, layout };
    }

    // 1. 优化 Canvas 分辨率 - 解决文字模糊的核心
    optimizeCanvasResolution(canvas, video, backgroundConfig) {
        const videoWidth = video.videoWidth || 1920;
        const videoHeight = video.videoHeight || 1080;
        
        console.log('原始视频尺寸:', { videoWidth, videoHeight });
        
        // 计算目标输出尺寸
        const outputRatio = backgroundConfig?.outputRatio || '16:9';
        const targetSize = this.calculateOptimalCanvasSize(videoWidth, videoHeight, outputRatio);
        
        // 关键改进：使用更高的内部分辨率
        const scaleFactor = this.calculateOptimalScaleFactor(videoWidth, videoHeight, targetSize);
        
        // 设置高分辨率内部画布
        const internalWidth = Math.round(targetSize.width * scaleFactor);
        const internalHeight = Math.round(targetSize.height * scaleFactor);
        
        canvas.width = internalWidth;
        canvas.height = internalHeight;
        
        // 设置显示尺寸（如果需要）
        canvas.style.width = targetSize.width + 'px';
        canvas.style.height = targetSize.height + 'px';
        
        console.log('Canvas 分辨率优化:', {
            original: `${videoWidth}x${videoHeight}`,
            target: `${targetSize.width}x${targetSize.height}`,
            internal: `${internalWidth}x${internalHeight}`,
            scaleFactor: scaleFactor.toFixed(2),
            improvement: `${((scaleFactor - 1) * 100).toFixed(1)}% 分辨率提升`
        });
    }

    // 计算最佳缩放因子
    calculateOptimalScaleFactor(videoWidth, videoHeight, targetSize) {
        const videoPixels = videoWidth * videoHeight;
        const targetPixels = targetSize.width * targetSize.height;
        
        // 基于视频分辨率确定最佳缩放因子
        let scaleFactor;
        
        if (videoPixels >= 1920 * 1080) {
            // 高分辨率视频：保持或轻微提升
            scaleFactor = Math.max(1.0, Math.min(1.5, targetPixels / videoPixels));
        } else if (videoPixels >= 1280 * 720) {
            // 中等分辨率：适度提升
            scaleFactor = Math.max(1.2, Math.min(2.0, targetPixels / videoPixels));
        } else {
            // 低分辨率：显著提升
            scaleFactor = Math.max(1.5, Math.min(2.5, targetPixels / videoPixels));
        }
        
        // 确保缩放因子是合理的
        return Math.max(1.0, Math.min(3.0, scaleFactor));
    }

    // 2. 设置最佳渲染上下文 - 解决抖动问题
    setupOptimalRenderingContext(ctx) {
        // 关键改进：根据内容类型选择不同的平滑策略
        
        // 对于包含文字的内容，使用特殊设置
        ctx.imageSmoothingEnabled = true;  // 启用平滑，但使用高质量算法
        ctx.imageSmoothingQuality = 'high';  // 使用最高质量平滑
        
        // 文字渲染优化
        ctx.textRenderingOptimization = 'optimizeQuality';  // 优化质量而非速度
        ctx.fontKerning = 'normal';
        ctx.textRendering = 'optimizeQuality';
        
        // 像素对齐优化 - 减少抖动
        ctx.translate(0, 0);  // 移除之前的 0.5 偏移，可能导致模糊
        
        // 设置合成模式
        ctx.globalCompositeOperation = 'source-over';
        
        console.log('渲染上下文已优化为文字友好模式');
    }

    // 3. 计算精确布局 - 减少抖动
    calculatePreciseLayout(video, canvas, backgroundConfig) {
        const videoWidth = video.videoWidth || 1920;
        const videoHeight = video.videoHeight || 1080;
        const padding = backgroundConfig?.padding || 60;
        
        // 计算可用空间
        const availableWidth = canvas.width - (padding * 2);
        const availableHeight = canvas.height - (padding * 2);
        
        // 计算缩放比例，保持宽高比
        const scaleX = availableWidth / videoWidth;
        const scaleY = availableHeight / videoHeight;
        const scale = Math.min(scaleX, scaleY);
        
        // 计算实际绘制尺寸
        const drawWidth = videoWidth * scale;
        const drawHeight = videoHeight * scale;
        
        // 居中定位 - 使用精确计算避免抖动
        const drawX = (canvas.width - drawWidth) / 2;
        const drawY = (canvas.height - drawHeight) / 2;
        
        // 关键改进：确保像素对齐
        const layout = {
            x: Math.round(drawX),
            y: Math.round(drawY),
            width: Math.round(drawWidth),
            height: Math.round(drawHeight),
            scale: scale,
            // 保留原始浮点值用于高精度计算
            preciseX: drawX,
            preciseY: drawY,
            preciseWidth: drawWidth,
            preciseHeight: drawHeight
        };
        
        console.log('精确布局计算:', {
            canvas: `${canvas.width}x${canvas.height}`,
            video: `${videoWidth}x${videoHeight}`,
            available: `${availableWidth}x${availableHeight}`,
            scale: scale.toFixed(3),
            draw: `${layout.width}x${layout.height}`,
            position: `(${layout.x}, ${layout.y})`,
            quality: scale >= 0.9 ? '优秀' : scale >= 0.7 ? '良好' : '一般'
        });
        
        return layout;
    }

    // 计算最佳 Canvas 尺寸
    calculateOptimalCanvasSize(videoWidth, videoHeight, outputRatio) {
        const ratioMap = {
            '16:9': { width: 1920, height: 1080 },
            '1:1': { width: 1080, height: 1080 },
            '9:16': { width: 1080, height: 1920 },
            '4:5': { width: 1080, height: 1350 }
        };
        
        const baseSize = ratioMap[outputRatio] || ratioMap['16:9'];
        
        // 根据原始视频尺寸调整
        const videoAspect = videoWidth / videoHeight;
        const targetAspect = baseSize.width / baseSize.height;
        
        let targetWidth = baseSize.width;
        let targetHeight = baseSize.height;
        
        // 如果原始视频分辨率更高，适当提升目标分辨率
        if (videoWidth > baseSize.width || videoHeight > baseSize.height) {
            const scale = Math.min(
                Math.max(videoWidth / baseSize.width, 1.0),
                Math.max(videoHeight / baseSize.height, 1.0)
            );
            
            if (scale > 1.2) {
                targetWidth = Math.round(baseSize.width * Math.min(scale, 1.5));
                targetHeight = Math.round(baseSize.height * Math.min(scale, 1.5));
            }
        }
        
        return { width: targetWidth, height: targetHeight };
    }

    // 优化的帧渲染方法
    renderOptimizedFrame(ctx, video, layout, backgroundConfig) {
        // 清除画布
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        // 绘制背景
        if (backgroundConfig?.color) {
            ctx.fillStyle = backgroundConfig.color;
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        
        // 使用高精度坐标绘制视频
        try {
            // 使用 preciseX/Y 进行亚像素精度绘制
            ctx.drawImage(
                video,
                layout.preciseX,
                layout.preciseY,
                layout.preciseWidth,
                layout.preciseHeight
            );
        } catch (error) {
            console.warn('高精度绘制失败，使用像素对齐绘制:', error);
            // 降级到像素对齐绘制
            ctx.drawImage(
                video,
                layout.x,
                layout.y,
                layout.width,
                layout.height
            );
        }
    }

    // 获取优化的编码参数
    getOptimizedEncodingParams(canvas, quality = 'high') {
        const pixels = canvas.width * canvas.height;
        
        // 为文字内容优化的比特率计算
        let baseBitrate;
        if (pixels >= 2560 * 1440) {
            baseBitrate = 15000000;  // 4K: 15 Mbps
        } else if (pixels >= 1920 * 1080) {
            baseBitrate = 10000000;  // FHD: 10 Mbps
        } else if (pixels >= 1280 * 720) {
            baseBitrate = 6000000;   // HD: 6 Mbps
        } else {
            baseBitrate = 4000000;   // SD: 4 Mbps
        }
        
        // 质量调整
        const qualityMultipliers = {
            'low': 0.8,
            'medium': 1.0,
            'high': 1.3,
            'ultra': 1.6
        };
        
        const multiplier = qualityMultipliers[quality] || 1.3;
        const bitrate = Math.round(baseBitrate * multiplier);
        
        return {
            codec: 'avc',  // H.264
            bitrate: Math.min(bitrate, 25000000),  // 最大 25 Mbps
            keyFrameInterval: 30,  // 每秒一个关键帧
            profile: 'high',  // 使用 High Profile
            level: '4.1',  // 支持高质量编码
            bFrames: 2,  // 使用 B 帧提高压缩效率
            // 文字优化参数
            tune: 'stillimage',  // 针对静态内容优化
            preset: 'slow',  // 使用慢速预设获得更好质量
            crf: quality === 'ultra' ? 18 : quality === 'high' ? 20 : 23  // 恒定质量因子
        };
    }
}

// 导出优化器
window.MP4QualityOptimizer = MP4QualityOptimizer;
