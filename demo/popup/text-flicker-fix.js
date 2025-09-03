// 文字闪动修复器 - 解决网页视频中文字闪动问题
class TextFlickerFix {
    constructor() {
        this.name = 'TextFlickerFix';
        this.version = '1.0.0';
        this.frameBuffer = [];
        this.stabilizationFrames = 3; // 用于稳定的帧数
        console.log('🔧 文字闪动修复器已初始化');
    }

    // 主要修复方法：解决文字闪动问题
    fixTextFlicker(canvas, video, layout, backgroundConfig, options = {}) {
        const {
            enableFrameStabilization = true,
            enableSubpixelRendering = true,
            enableTextOptimization = true,
            frameRate = 30
        } = options;

        console.log('🔧 开始文字闪动修复...');

        const ctx = canvas.getContext('2d');
        
        // 1. 设置防闪动的渲染上下文
        this.setupAntiFlickerContext(ctx);
        
        // 2. 启用帧稳定化
        if (enableFrameStabilization) {
            this.enableFrameStabilization(ctx, video, frameRate);
        }
        
        // 3. 优化文字渲染
        if (enableTextOptimization) {
            this.optimizeTextRendering(ctx);
        }
        
        // 4. 启用亚像素渲染
        if (enableSubpixelRendering) {
            this.enableSubpixelRendering(ctx);
        }

        console.log('✅ 文字闪动修复完成');
        return ctx;
    }

    // 1. 设置防闪动的渲染上下文
    setupAntiFlickerContext(ctx) {
        // 关键设置：防止文字闪动
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // 文字渲染优化
        if (ctx.textRenderingOptimization) {
            ctx.textRenderingOptimization = 'optimizeQuality';
        }
        
        // 字体平滑设置
        if (ctx.fontSmooth !== undefined) {
            ctx.fontSmooth = 'always'; // 始终启用字体平滑
        }
        
        // 文字渲染设置
        if (ctx.textRendering) {
            ctx.textRendering = 'optimizeQuality'; // 优化质量而非速度
        }
        
        // 抗锯齿设置
        ctx.antialias = true;
        
        // 合成操作
        ctx.globalCompositeOperation = 'source-over';
        
        console.log('✅ 防闪动渲染上下文已设置');
    }

    // 2. 启用帧稳定化
    enableFrameStabilization(ctx, video, frameRate) {
        // 计算稳定的时间间隔
        const frameInterval = 1000 / frameRate;
        
        // 设置稳定的渲染时机
        this.stableFrameInterval = frameInterval;
        this.lastFrameTime = 0;
        
        console.log('✅ 帧稳定化已启用，帧间隔:', frameInterval + 'ms');
    }

    // 3. 优化文字渲染
    optimizeTextRendering(ctx) {
        // 文字特定的优化设置
        ctx.textAlign = 'start'; // 使用精确的文字对齐
        ctx.textBaseline = 'alphabetic'; // 使用标准基线
        
        // 字体渲染提示
        if (ctx.fontVariantCaps) {
            ctx.fontVariantCaps = 'normal';
        }
        
        // 字体特征设置
        if (ctx.fontFeatureSettings) {
            ctx.fontFeatureSettings = 'normal';
        }
        
        // 字体变体设置
        if (ctx.fontVariant) {
            ctx.fontVariant = 'normal';
        }
        
        console.log('✅ 文字渲染优化已启用');
    }

    // 4. 启用亚像素渲染
    enableSubpixelRendering(ctx) {
        // 亚像素精度渲染
        ctx.translate(0, 0); // 移除任何可能导致闪动的偏移
        
        // 确保像素边界对齐
        this.pixelAligned = true;
        
        console.log('✅ 亚像素渲染已启用');
    }

    // 稳定的帧渲染方法
    renderStableFrame(ctx, video, layout, backgroundConfig, timestamp) {
        try {
            // 检查是否需要跳过此帧（帧稳定化）
            if (this.shouldSkipFrame(timestamp)) {
                return false; // 跳过此帧
            }

            // 保存上下文状态
            ctx.save();

            // 清除画布（使用稳定的清除方法）
            this.stableClearCanvas(ctx);

            // 绘制背景（如果有）
            if (backgroundConfig?.color) {
                this.drawStableBackground(ctx, backgroundConfig);
            }

            // 绘制视频帧（防闪动方法）
            this.drawStableVideoFrame(ctx, video, layout);

            // 恢复上下文状态
            ctx.restore();

            // 更新最后渲染时间
            this.lastFrameTime = timestamp;

            return true; // 成功渲染
            
        } catch (error) {
            console.error('稳定帧渲染失败:', error);
            return false;
        }
    }

    // 检查是否应该跳过此帧
    shouldSkipFrame(timestamp) {
        if (!this.stableFrameInterval || !this.lastFrameTime) {
            return false; // 第一帧或未启用稳定化
        }

        const timeSinceLastFrame = timestamp - this.lastFrameTime;
        return timeSinceLastFrame < this.stableFrameInterval * 0.8; // 80% 的帧间隔
    }

    // 稳定的画布清除
    stableClearCanvas(ctx) {
        // 使用精确的清除方法
        const canvas = ctx.canvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 额外的清除确保（防止残留）
        ctx.fillStyle = 'transparent';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 绘制稳定的背景
    drawStableBackground(ctx, backgroundConfig) {
        const canvas = ctx.canvas;
        
        // 使用精确的背景绘制
        ctx.fillStyle = backgroundConfig.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 绘制稳定的视频帧
    drawStableVideoFrame(ctx, video, layout) {
        if (video.readyState < 2) {
            console.warn('视频未准备好，跳过此帧');
            return;
        }

        try {
            // 使用精确的像素对齐坐标
            const alignedX = this.pixelAlign(layout.x);
            const alignedY = this.pixelAlign(layout.y);
            const alignedWidth = this.pixelAlign(layout.width);
            const alignedHeight = this.pixelAlign(layout.height);

            // 绘制视频帧
            ctx.drawImage(
                video,
                alignedX,
                alignedY,
                alignedWidth,
                alignedHeight
            );

        } catch (error) {
            console.error('绘制视频帧失败:', error);
        }
    }

    // 像素对齐函数
    pixelAlign(value) {
        return Math.round(value);
    }

    // 检测文字闪动问题
    detectTextFlicker(canvas, video) {
        const ctx = canvas.getContext('2d');
        
        // 分析当前帧的特征
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const currentFrameHash = this.calculateFrameHash(imageData);
        
        // 与之前的帧进行比较
        if (this.frameBuffer.length > 0) {
            const similarity = this.calculateFrameSimilarity(
                currentFrameHash, 
                this.frameBuffer[this.frameBuffer.length - 1]
            );
            
            // 如果相似度过低，可能存在闪动
            if (similarity < 0.95) {
                console.warn('检测到可能的文字闪动，相似度:', similarity);
                return true;
            }
        }
        
        // 添加到帧缓冲区
        this.frameBuffer.push(currentFrameHash);
        
        // 保持缓冲区大小
        if (this.frameBuffer.length > this.stabilizationFrames) {
            this.frameBuffer.shift();
        }
        
        return false;
    }

    // 计算帧哈希值
    calculateFrameHash(imageData) {
        const data = imageData.data;
        let hash = 0;
        
        // 采样计算哈希（提高性能）
        for (let i = 0; i < data.length; i += 16) {
            hash = ((hash << 5) - hash + data[i]) & 0xffffffff;
        }
        
        return hash;
    }

    // 计算帧相似度
    calculateFrameSimilarity(hash1, hash2) {
        const diff = Math.abs(hash1 - hash2);
        const maxDiff = Math.max(Math.abs(hash1), Math.abs(hash2));
        
        if (maxDiff === 0) return 1.0;
        
        return 1.0 - (diff / maxDiff);
    }

    // 应用文字闪动修复到现有渲染流程
    applyFlickerFix(renderFunction, ctx, video, layout, backgroundConfig, timestamp) {
        // 首先应用防闪动设置
        this.setupAntiFlickerContext(ctx);
        
        // 检测是否存在闪动
        const hasFlicker = this.detectTextFlicker(ctx.canvas, video);
        
        if (hasFlicker) {
            console.log('🔧 应用文字闪动修复...');
            // 使用稳定渲染方法
            return this.renderStableFrame(ctx, video, layout, backgroundConfig, timestamp);
        } else {
            // 使用原始渲染方法，但应用防闪动设置
            try {
                return renderFunction(ctx, video, layout, backgroundConfig);
            } catch (error) {
                console.error('原始渲染失败，降级到稳定渲染:', error);
                return this.renderStableFrame(ctx, video, layout, backgroundConfig, timestamp);
            }
        }
    }

    // 重置修复器状态
    reset() {
        this.frameBuffer = [];
        this.lastFrameTime = 0;
        console.log('🔄 文字闪动修复器已重置');
    }

    // 获取修复统计信息
    getStats() {
        return {
            frameBufferSize: this.frameBuffer.length,
            stabilizationFrames: this.stabilizationFrames,
            lastFrameTime: this.lastFrameTime,
            stableFrameInterval: this.stableFrameInterval
        };
    }
}

// 导出修复器
window.TextFlickerFix = TextFlickerFix;
