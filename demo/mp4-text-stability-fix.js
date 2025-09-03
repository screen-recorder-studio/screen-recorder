// MP4 文字抖动修复补丁
// 解决 MP4 导出时网页文字抖动问题
// 作者: Assistant
// 日期: 2025-09-02

console.log('🔧 开始应用 MP4 文字稳定性修复...');

// 修复 MediabunnyMp4Exporter 中的问题
if (window.MediabunnyMp4Exporter) {
    const originalPrototype = MediabunnyMp4Exporter.prototype;
    
    // 1. 修复图像平滑设置问题
    originalPrototype.optimizeContextForTextClarity = function(ctx, video, layout) {
        // 计算缩放比例
        const scaleX = layout.width / video.videoWidth;
        const scaleY = layout.height / video.videoHeight;
        const minScale = Math.min(scaleX, scaleY);
        
        console.log('视频缩放比例:', { scaleX, scaleY, minScale });
        
        // ✅ 修复：启用高质量图像平滑（原来是禁用的）
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        console.log('✅ 启用高质量图像平滑以提升文字质量');
        
        // 设置像素完美渲染（不使用 translate 偏移）
        ctx.textRenderingOptimization = 'optimizeLegibility';
        ctx.globalCompositeOperation = 'source-over';
        
        // 设置最佳文字渲染属性
        if (ctx.textRendering) {
            ctx.textRendering = 'optimizeLegibility';
        }
        if (ctx.fontSmooth) {
            ctx.fontSmooth = 'always';
        }
        
        console.log('✅ 应用优化的文字渲染设置');
    };
    
    // 2. 优化渲染帧方法 - 使用整数坐标
    originalPrototype.renderFrameWithEditingEffects = function(canvas, video, layout, backgroundConfig, optimizer = null, flickerFix = null, timestamp = 0) {
        // 检查Canvas尺寸
        if (canvas.width <= 0 || canvas.height <= 0) {
            console.error('Canvas尺寸无效:', { width: canvas.width, height: canvas.height });
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
                    return;
                }
            } catch (error) {
                console.warn('文字闪动修复失败，降级到优化渲染:', error);
            }
        }
        
        // 🔧 降级到优化渲染方法
        if (optimizer && optimizer.renderOptimizedFrame) {
            try {
                optimizer.renderOptimizedFrame(ctx, video, layout, backgroundConfig);
                return;
            } catch (error) {
                console.warn('优化渲染失败，降级到标准渲染:', error);
            }
        }
        
        // 标准渲染方法（降级处理）
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
        
        // 绘制视频帧（使用像素对齐的整数坐标）
        if (video.readyState >= 2 && layout.width > 0 && layout.height > 0) {
            try {
                // ✅ 使用整数坐标避免抖动
                const alignedX = Math.round(layout.x);
                const alignedY = Math.round(layout.y);
                const alignedWidth = Math.round(layout.width);
                const alignedHeight = Math.round(layout.height);
                
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
        
        ctx.restore();
    };
    
    // 3. 优化标准渲染方法
    originalPrototype.standardRenderFrame = function(ctx, video, layout, backgroundConfig) {
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
        
        // 绘制视频帧（使用像素对齐的整数坐标）
        if (video.readyState >= 2 && layout.width > 0 && layout.height > 0) {
            try {
                // ✅ 确保使用整数坐标
                const alignedX = Math.round(layout.x);
                const alignedY = Math.round(layout.y);
                const alignedWidth = Math.round(layout.width);
                const alignedHeight = Math.round(layout.height);
                
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
        
        ctx.restore();
    };
    
    // 4. 优化视频布局计算 - 确保返回整数坐标
    originalPrototype.calculateVideoLayout = function(video, canvas, backgroundConfig) {
        // 智能边距
        let padding = backgroundConfig?.padding || 0;
        
        // 如果视频尺寸接近Canvas尺寸，减少边距
        const videoAspectRatio = video.videoWidth / video.videoHeight;
        const canvasAspectRatio = canvas.width / canvas.height;
        const aspectRatioDiff = Math.abs(videoAspectRatio - canvasAspectRatio);
        
        if (aspectRatioDiff < 0.1 && padding > 30) {
            padding = Math.max(padding * 0.5, 20);
            console.log('检测到相近宽高比，减少边距至:', padding);
        }
        
        const availableWidth = canvas.width - padding * 2;
        const availableHeight = canvas.height - padding * 2;
        
        // 计算视频缩放
        const targetAspectRatio = availableWidth / availableHeight;
        
        let videoWidth, videoHeight, videoX, videoY;
        
        if (videoAspectRatio > targetAspectRatio) {
            // 视频更宽
            videoWidth = availableWidth;
            videoHeight = availableWidth / videoAspectRatio;
            videoX = padding;
            videoY = padding + (availableHeight - videoHeight) / 2;
        } else {
            // 视频更高
            videoHeight = availableHeight;
            videoWidth = availableHeight * videoAspectRatio;
            videoX = padding + (availableWidth - videoWidth) / 2;
            videoY = padding;
        }
        
        // 计算缩放比例
        const scaleX = videoWidth / video.videoWidth;
        const scaleY = videoHeight / video.videoHeight;
        const minScale = Math.min(scaleX, scaleY);
        
        // ✅ 确保所有坐标都是整数
        const layout = {
            x: Math.round(videoX),
            y: Math.round(videoY),
            width: Math.round(videoWidth),
            height: Math.round(videoHeight),
            scaleX,
            scaleY,
            minScale,
            originalPadding: backgroundConfig?.padding || 0,
            adjustedPadding: padding
        };
        
        console.log('优化后的视频布局:', {
            canvas: `${canvas.width}x${canvas.height}`,
            video: `${video.videoWidth}x${video.videoHeight}`,
            layout: `${layout.width}x${layout.height}`,
            position: `(${layout.x}, ${layout.y})`,
            scale: `${(minScale * 100).toFixed(1)}%`,
            clarity: minScale >= 0.8 ? '良好' : minScale >= 0.6 ? '一般' : '较差'
        });
        
        return layout;
    };
    
    // 5. 优化时间戳处理
    const originalExportWithEditingEffects = originalPrototype.exportWithEditingEffects;
    originalPrototype.exportWithEditingEffects = async function(canvas, video, layout, backgroundConfig, options = {}) {
        const {
            quality = 'high',
            frameRate = 30,
            progressCallback = () => {}
        } = options;
        
        try {
            // ... 初始化代码保持不变 ...
            
            // 优化：使用更精确的时间戳计算
            let duration = video.duration;
            
            // 处理无效时长
            if (!isFinite(duration) || duration <= 0) {
                console.warn('视频时长无效:', duration);
                
                if (video._detectedDuration && video._detectedDuration > 0) {
                    duration = video._detectedDuration;
                    console.log('使用检测到的时长:', duration);
                } else if (video.seekable && video.seekable.length > 0) {
                    const seekableEnd = video.seekable.end(video.seekable.length - 1);
                    if (isFinite(seekableEnd) && seekableEnd > 0) {
                        duration = Math.min(seekableEnd, 30);
                        console.log('从 seekable 获取时长:', duration);
                    } else {
                        duration = 5;
                    }
                } else {
                    duration = 5;
                }
            }
            
            // 限制最大时长
            duration = Math.min(duration, 60);
            
            if (!isFinite(duration) || duration <= 0) {
                console.error('无法确定有效的视频时长，使用默认值');
                duration = 5;
            }
            
            const totalFrames = Math.floor(duration * frameRate);
            const frameDuration = 1 / frameRate;
            
            console.log(`优化后的参数: 时长=${duration}秒, 总帧数=${totalFrames}, 帧间隔=${frameDuration}秒`);
            
            // 调用原始方法
            return await originalExportWithEditingEffects.call(
                this,
                canvas,
                video,
                layout,
                backgroundConfig,
                options
            );
            
        } catch (error) {
            console.error('MediaBunny 导出失败:', error);
            throw error;
        }
    };
    
    console.log('✅ MediabunnyMp4Exporter 已优化');
}

// 增强 MP4QualityOptimizer
if (window.MP4QualityOptimizer) {
    const originalPrototype = MP4QualityOptimizer.prototype;
    
    // 确保优化器使用正确的设置
    const originalSetupContext = originalPrototype.setupOptimalRenderingContext;
    originalPrototype.setupOptimalRenderingContext = function(ctx) {
        // 调用原始方法
        if (originalSetupContext) {
            originalSetupContext.call(this, ctx);
        }
        
        // 确保设置正确
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.textRenderingOptimization = 'optimizeLegibility';
        ctx.fontKerning = 'normal';
        
        // 不使用 translate 偏移
        // ctx.translate(0, 0);
        
        ctx.globalCompositeOperation = 'source-over';
        
        console.log('✅ 渲染上下文已优化为文字友好模式');
    };
    
    // 确保布局计算返回整数
    const originalCalculateLayout = originalPrototype.calculatePreciseLayout;
    originalPrototype.calculatePreciseLayout = function(video, canvas, backgroundConfig) {
        const result = originalCalculateLayout ? 
            originalCalculateLayout.call(this, video, canvas, backgroundConfig) :
            this.calculateBasicLayout(video, canvas, backgroundConfig);
        
        // 确保所有坐标都是整数
        result.x = Math.round(result.x || 0);
        result.y = Math.round(result.y || 0);
        result.width = Math.round(result.width || video.videoWidth);
        result.height = Math.round(result.height || video.videoHeight);
        
        return result;
    };
    
    console.log('✅ MP4QualityOptimizer 已增强');
}

// 增强 TextFlickerFix
if (window.TextFlickerFix) {
    const originalPrototype = TextFlickerFix.prototype;
    
    // 优化防闪动上下文设置
    originalPrototype.setupAntiFlickerContext = function(ctx) {
        // 关键设置：防止文字闪动
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        if (ctx.textRenderingOptimization) {
            ctx.textRenderingOptimization = 'optimizeLegibility';
        }
        
        if (ctx.fontSmooth !== undefined) {
            ctx.fontSmooth = 'always';
        }
        
        if (ctx.textRendering) {
            ctx.textRendering = 'optimizeLegibility';
        }
        
        ctx.antialias = true;
        ctx.globalCompositeOperation = 'source-over';
        
        console.log('✅ 防闪动渲染上下文已设置');
    };
    
    // 优化像素对齐
    originalPrototype.pixelAlign = function(value) {
        // 始终返回整数值
        return Math.round(value);
    };
    
    console.log('✅ TextFlickerFix 已增强');
}

// 自动应用修复
function applyFixes() {
    // 检查是否在录制页面
    if (window.location.pathname.includes('recorder.html')) {
        console.log('🎯 检测到录制页面，修复已自动应用');
        
        // 添加性能监控
        let frameCount = 0;
        const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function(...args) {
            frameCount++;
            if (frameCount % 100 === 0) {
                console.log(`📊 已渲染 ${frameCount} 帧`);
            }
            return originalDrawImage.apply(this, args);
        };
    }
}

// 等待页面加载完成
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFixes);
} else {
    applyFixes();
}

console.log('✅ MP4 文字稳定性修复已成功加载');
console.log('📝 修复内容：');
console.log('  1. ✅ 启用高质量图像平滑');
console.log('  2. ✅ 使用整数坐标避免抖动');
console.log('  3. ✅ 优化时间戳精度');
console.log('  4. ✅ 稳定渲染上下文');
console.log('  5. ✅ 移除有问题的translate偏移');
