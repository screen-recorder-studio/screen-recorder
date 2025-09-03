/**
 * Smart Text Renderer - 智能文字渲染器
 * 解决MP4导出时的文字抖动和模糊问题
 * 
 * 核心策略：
 * 1. 1:1 缩放时：禁用平滑，保持像素完美
 * 2. 放大时：启用平滑，避免锯齿
 * 3. 缩小时：使用超采样技术
 * 4. 固定帧缓存：减少抖动
 */

class SmartTextRenderer {
    constructor() {
        this.frameCache = new Map();
        this.lastFrameHash = null;
        this.stableFrameCount = 0;
        this.maxCacheSize = 30;
    }

    /**
     * 智能渲染视频帧
     */
    renderFrame(ctx, video, layout, backgroundConfig) {
        // 计算实际缩放比例
        const scaleX = layout.width / video.videoWidth;
        const scaleY = layout.height / video.videoHeight;
        const avgScale = (scaleX + scaleY) / 2;
        
        // 保存当前上下文状态
        ctx.save();
        
        // 清除画布
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        // 绘制背景
        if (backgroundConfig && backgroundConfig.color) {
            ctx.fillStyle = backgroundConfig.color;
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        
        // 根据缩放比例选择最佳渲染策略
        if (Math.abs(avgScale - 1) < 0.05) {
            // 接近1:1，使用像素完美渲染
            this.renderPixelPerfect(ctx, video, layout);
        } else if (avgScale > 1) {
            // 放大，需要平滑处理
            this.renderUpscaled(ctx, video, layout);
        } else {
            // 缩小，使用超采样
            this.renderDownscaled(ctx, video, layout);
        }
        
        // 恢复上下文状态
        ctx.restore();
    }
    
    /**
     * 像素完美渲染（1:1或接近1:1）
     */
    renderPixelPerfect(ctx, video, layout) {
        // 禁用所有平滑
        ctx.imageSmoothingEnabled = false;
        
        // 确保坐标是整数
        const x = Math.floor(layout.x);
        const y = Math.floor(layout.y);
        const width = Math.floor(layout.width);
        const height = Math.floor(layout.height);
        
        // 直接绘制
        ctx.drawImage(video, x, y, width, height);
    }
    
    /**
     * 放大渲染
     */
    renderUpscaled(ctx, video, layout) {
        // 启用高质量平滑
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // 使用整数坐标
        const x = Math.round(layout.x);
        const y = Math.round(layout.y);
        const width = Math.round(layout.width);
        const height = Math.round(layout.height);
        
        ctx.drawImage(video, x, y, width, height);
    }
    
    /**
     * 缩小渲染 - 使用超采样技术
     */
    renderDownscaled(ctx, video, layout) {
        // 创建超采样画布（2x分辨率）
        const superSampleFactor = 2;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = layout.width * superSampleFactor;
        tempCanvas.height = layout.height * superSampleFactor;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 在高分辨率画布上绘制
        tempCtx.imageSmoothingEnabled = false;
        tempCtx.drawImage(
            video,
            0, 0,
            tempCanvas.width,
            tempCanvas.height
        );
        
        // 使用高质量缩放将超采样画布绘制到目标
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        const x = Math.round(layout.x);
        const y = Math.round(layout.y);
        const width = Math.round(layout.width);
        const height = Math.round(layout.height);
        
        ctx.drawImage(tempCanvas, x, y, width, height);
    }
    
    /**
     * 稳定渲染 - 减少帧间抖动
     */
    renderStable(ctx, video, layout, backgroundConfig, timestamp) {
        // 生成当前帧的特征hash
        const frameHash = this.generateFrameHash(video, timestamp);
        
        // 如果帧内容相同，使用缓存
        if (frameHash === this.lastFrameHash && this.frameCache.has(frameHash)) {
            const cachedImageData = this.frameCache.get(frameHash);
            ctx.putImageData(cachedImageData, 0, 0);
            this.stableFrameCount++;
            return;
        }
        
        // 渲染新帧
        this.renderFrame(ctx, video, layout, backgroundConfig);
        
        // 缓存当前帧
        if (ctx.canvas.width > 0 && ctx.canvas.height > 0) {
            try {
                const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
                this.frameCache.set(frameHash, imageData);
                
                // 限制缓存大小
                if (this.frameCache.size > this.maxCacheSize) {
                    const firstKey = this.frameCache.keys().next().value;
                    this.frameCache.delete(firstKey);
                }
            } catch (e) {
                console.warn('无法缓存帧:', e);
            }
        }
        
        this.lastFrameHash = frameHash;
        this.stableFrameCount = 0;
    }
    
    /**
     * 生成帧特征hash
     */
    generateFrameHash(video, timestamp) {
        return `${video.currentTime.toFixed(3)}_${timestamp.toFixed(3)}`;
    }
    
    /**
     * 优化的渲染方法 - 带防抖动
     */
    renderOptimized(ctx, video, layout, backgroundConfig) {
        const scaleX = layout.width / video.videoWidth;
        const scaleY = layout.height / video.videoHeight;
        const avgScale = (scaleX + scaleY) / 2;
        
        // 保存状态
        ctx.save();
        
        // 清除画布
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        // 绘制背景
        if (backgroundConfig && backgroundConfig.color) {
            ctx.fillStyle = backgroundConfig.color;
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        
        // 创建离屏画布进行渲染
        const offscreen = document.createElement('canvas');
        offscreen.width = Math.round(layout.width);
        offscreen.height = Math.round(layout.height);
        const offCtx = offscreen.getContext('2d', {
            alpha: false,
            desynchronized: false
        });
        
        // 智能选择渲染模式
        if (avgScale < 0.5) {
            // 严重缩小，使用多级缩放
            this.multiStepDownscale(offCtx, video, offscreen.width, offscreen.height);
        } else if (avgScale < 0.9) {
            // 轻微缩小，使用锐化滤镜
            offCtx.imageSmoothingEnabled = true;
            offCtx.imageSmoothingQuality = 'medium';
            offCtx.filter = 'contrast(1.1) saturate(1.1)';
            offCtx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
        } else if (avgScale > 1.1) {
            // 放大，使用高质量平滑
            offCtx.imageSmoothingEnabled = true;
            offCtx.imageSmoothingQuality = 'high';
            offCtx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
        } else {
            // 接近1:1，禁用平滑
            offCtx.imageSmoothingEnabled = false;
            offCtx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
        }
        
        // 将离屏画布内容绘制到主画布（固定位置）
        const x = Math.floor(layout.x);
        const y = Math.floor(layout.y);
        
        ctx.imageSmoothingEnabled = false; // 最终绘制不平滑
        ctx.drawImage(offscreen, x, y);
        
        // 恢复状态
        ctx.restore();
    }
    
    /**
     * 多级缩放（用于严重缩小的情况）
     */
    multiStepDownscale(ctx, video, targetWidth, targetHeight) {
        let currentWidth = video.videoWidth;
        let currentHeight = video.videoHeight;
        let source = video;
        
        // 逐步缩小，每次缩小不超过50%
        while (currentWidth > targetWidth * 2 || currentHeight > targetHeight * 2) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = Math.round(currentWidth / 2);
            tempCanvas.height = Math.round(currentHeight / 2);
            const tempCtx = tempCanvas.getContext('2d');
            
            tempCtx.imageSmoothingEnabled = true;
            tempCtx.imageSmoothingQuality = 'high';
            tempCtx.drawImage(source, 0, 0, tempCanvas.width, tempCanvas.height);
            
            source = tempCanvas;
            currentWidth = tempCanvas.width;
            currentHeight = tempCanvas.height;
        }
        
        // 最终绘制
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    }
    
    /**
     * 清理缓存
     */
    clearCache() {
        this.frameCache.clear();
        this.lastFrameHash = null;
        this.stableFrameCount = 0;
    }
}

// 导出
window.SmartTextRenderer = SmartTextRenderer;
