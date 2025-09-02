// WebM 转 MP4 转换器
class WebmToMp4Converter {
    constructor() {
        this.mediabunny = null;
        this.isInitialized = false;
        this.isConverting = false;
        
        console.log('🎬 WebM 转 MP4 转换器初始化中...');
    }

    // 初始化转换器
    async initialize() {
        try {
            console.log('🔄 开始初始化 MediaBunny...');
            
            // 等待 MediaBunny 加载
            if (window.mediabunnyLoader) {
                this.mediabunny = await window.mediabunnyLoader.waitForLoad();
                console.log('✅ MediaBunny 已通过加载器加载');
            } else if (window.Mediabunny) {
                this.mediabunny = window.Mediabunny;
                console.log('✅ MediaBunny 已直接可用');
            } else {
                throw new Error('MediaBunny 库未找到');
            }

            this.isInitialized = true;
            console.log('✅ WebM 转 MP4 转换器初始化完成');

        } catch (error) {
            console.error('❌ 转换器初始化失败:', error);
            throw error;
        }
    }

    // 检查是否已初始化
    checkInitialized() {
        if (!this.isInitialized) {
            throw new Error('转换器未初始化，请先调用 initialize()');
        }
    }

    // 主要转换方法
    async convertWebmToMp4(webmBlob, options = {}) {
        this.checkInitialized();

        if (this.isConverting) {
            throw new Error('正在转换中，请等待当前转换完成');
        }

        const {
            quality = 'high',
            frameRate = 30,
            backgroundConfig = null,
            progressCallback = () => {}
        } = options;

        this.isConverting = true;

        try {
            console.log('🚀 开始 WebM 转 MP4，配置:', { quality, frameRate });

            progressCallback(0.05, '分析 WebM 文件...');

            // 步骤1：创建视频元素分析源文件
            const video = await this.createVideoElement(webmBlob);
            let duration = video.duration;
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;

            // 🔧 修复无限时长问题
            if (!isFinite(duration) || duration <= 0) {
                console.warn('检测到无效的视频时长:', duration, '使用默认时长 5 秒');
                duration = options.duration || 5; // 默认 5 秒
            }

            // 限制最大时长以避免过长的转换
            const maxDuration = options.maxDuration || 60; // 最大 60 秒
            if (duration > maxDuration) {
                console.warn(`视频时长 ${duration.toFixed(2)}s 超过限制，截取为 ${maxDuration}s`);
                duration = maxDuration;
            }

            console.log('源视频信息:', {
                originalDuration: video.duration,
                usedDuration: duration.toFixed(2) + 's',
                resolution: `${videoWidth}x${videoHeight}`,
                size: this.formatFileSize(webmBlob.size)
            });

            progressCallback(0.1, '创建转换画布...');

            // 步骤2：创建转换用的 Canvas
            const canvas = this.createConversionCanvas(video, backgroundConfig);

            progressCallback(0.15, '计算视频布局...');

            // 步骤3：计算视频在 Canvas 中的布局
            const layout = this.calculateVideoLayout(video, canvas, backgroundConfig);

            progressCallback(0.2, '设置实时渲染...');

            // 步骤4：设置 Canvas 实时渲染
            await this.setupVideoRendering(canvas, video, layout, backgroundConfig);

            progressCallback(0.3, '开始 MP4 编码...');

            // 步骤5：使用 MediaBunny 进行转换
            const result = await this.encodeToMp4(canvas, {
                quality,
                frameRate,
                duration,
                progressCallback: (progress, message) => {
                    // 映射进度到 30%-95%
                    const mappedProgress = 0.3 + (progress * 0.65);
                    progressCallback(mappedProgress, message);
                }
            });

            progressCallback(0.95, '完成处理...');

            // 计算转换统计
            const originalSize = webmBlob.size;
            const finalSize = result.size;
            const compression = ((originalSize - finalSize) / originalSize) * 100;

            progressCallback(1.0, 'WebM 转 MP4 完成！');

            console.log('✅ WebM 转 MP4 成功:', {
                originalSize: this.formatFileSize(originalSize),
                finalSize: this.formatFileSize(finalSize),
                compression: `${compression.toFixed(1)}%`,
                duration: `${duration.toFixed(2)}s`
            });

            return {
                blob: result,
                originalSize,
                finalSize,
                compression,
                duration,
                format: 'mp4'
            };

        } catch (error) {
            console.error('❌ WebM 转 MP4 失败:', error);
            throw error;
        } finally {
            this.cleanup();
            this.isConverting = false;
        }
    }

    // 创建视频元素
    async createVideoElement(webmBlob) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.src = URL.createObjectURL(webmBlob);
            video.muted = true;
            video.preload = 'metadata';

            video.onloadedmetadata = () => {
                console.log('WebM 视频元数据加载完成:', {
                    duration: video.duration,
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight
                });
                resolve(video);
            };

            video.onerror = (error) => {
                console.error('WebM 视频加载失败:', error);
                reject(new Error('WebM 视频加载失败'));
            };
        });
    }

    // 创建转换画布
    createConversionCanvas(video, backgroundConfig) {
        const canvas = document.createElement('canvas');
        
        // 根据背景配置确定输出尺寸
        const outputRatio = backgroundConfig?.outputRatio || '16:9';
        const { width, height } = this.getOptimalCanvasSize(video, outputRatio);
        
        canvas.width = width;
        canvas.height = height;
        
        console.log('创建转换画布:', { width, height, outputRatio });
        
        return canvas;
    }

    // 获取最佳画布尺寸
    getOptimalCanvasSize(video, outputRatio) {
        const ratioMap = {
            '16:9': { width: 1920, height: 1080 },
            '1:1': { width: 1080, height: 1080 },
            '9:16': { width: 1080, height: 1920 },
            '4:5': { width: 1080, height: 1350 }
        };

        const baseSize = ratioMap[outputRatio] || ratioMap['16:9'];
        
        // 根据原始视频尺寸调整
        const videoWidth = video.videoWidth || 1920;
        const videoHeight = video.videoHeight || 1080;
        
        // 如果原始视频分辨率更高，适当提升目标分辨率
        if (videoWidth > baseSize.width || videoHeight > baseSize.height) {
            const scale = Math.min(
                Math.max(videoWidth / baseSize.width, 1.0),
                Math.max(videoHeight / baseSize.height, 1.0)
            );
            
            if (scale > 1.2) {
                return {
                    width: Math.round(baseSize.width * Math.min(scale, 1.5)),
                    height: Math.round(baseSize.height * Math.min(scale, 1.5))
                };
            }
        }
        
        return baseSize;
    }

    // 计算视频布局
    calculateVideoLayout(video, canvas, backgroundConfig) {
        const videoWidth = video.videoWidth || 1920;
        const videoHeight = video.videoHeight || 1080;
        const padding = backgroundConfig?.padding || 0;

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

        // 居中定位
        const drawX = (canvas.width - drawWidth) / 2;
        const drawY = (canvas.height - drawHeight) / 2;

        return {
            x: Math.round(drawX),
            y: Math.round(drawY),
            width: Math.round(drawWidth),
            height: Math.round(drawHeight),
            scale: scale
        };
    }

    // 设置视频渲染
    async setupVideoRendering(canvas, video, layout, backgroundConfig) {
        const ctx = canvas.getContext('2d');
        
        // 优化渲染设置
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // 渲染函数
        const renderFrame = () => {
            try {
                // 清除画布
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // 绘制背景
                if (backgroundConfig?.color) {
                    ctx.fillStyle = backgroundConfig.color;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }

                // 绘制视频帧
                if (video.readyState >= 2) {
                    ctx.drawImage(
                        video,
                        layout.x,
                        layout.y,
                        layout.width,
                        layout.height
                    );
                }
            } catch (error) {
                console.warn('渲染帧时出错:', error);
            }
        };

        // 开始播放视频
        video.currentTime = 0;
        video.loop = true;
        await video.play();

        // 设置高频率渲染
        const frameInterval = 1000 / 60; // 60 FPS 渲染
        this.renderInterval = setInterval(renderFrame, frameInterval);

        // 立即渲染一帧
        renderFrame();

        console.log('视频渲染已设置');
        
        // 等待渲染稳定
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 编码为 MP4
    async encodeToMp4(canvas, options) {
        const { quality, frameRate, duration, progressCallback } = options;

        try {
            progressCallback(0.1, '创建 MP4 输出...');

            // 创建 MediaBunny 输出
            const output = new this.mediabunny.Output({
                format: new this.mediabunny.Mp4OutputFormat(),
                target: new this.mediabunny.BufferTarget()
            });

            progressCallback(0.2, '创建视频源...');

            // 创建 Canvas 视频源
            const bitrate = this.getQualityBitrate(quality, canvas);
            const videoSource = new this.mediabunny.CanvasSource(canvas, {
                codec: 'avc', // H.264
                bitrate: bitrate
            });

            console.log('Canvas 视频源已创建:', {
                canvasSize: `${canvas.width}x${canvas.height}`,
                bitrate: bitrate,
                frameRate: frameRate
            });

            progressCallback(0.3, '添加视频轨道...');

            // 添加视频轨道
            output.addVideoTrack(videoSource, { frameRate: frameRate });

            progressCallback(0.4, '启动编码...');

            // 开始输出
            await output.start();
            console.log('MediaBunny 输出已启动');

            progressCallback(0.5, '编码中...');

            // 手动添加帧
            const totalFrames = Math.ceil(frameRate * duration);
            const frameDuration = 1 / frameRate;

            console.log(`开始添加 ${totalFrames} 帧，时长 ${duration.toFixed(2)} 秒`);

            for (let i = 0; i < totalFrames; i++) {
                // 🔧 检查是否需要中止转换
                if (window.webmToMp4Test && window.webmToMp4Test.conversionAborted) {
                    console.log('转换被用户取消');
                    throw new Error('转换被用户取消');
                }

                const timestamp = i * frameDuration;

                // 添加当前帧到视频源
                await videoSource.add(timestamp, frameDuration);

                // 更新进度
                const progress = i / totalFrames;
                const mappedProgress = 0.5 + (progress * 0.4);
                progressCallback(mappedProgress, `编码中... ${Math.round(progress * 100)}% (${i + 1}/${totalFrames})`);

                // 小延迟以避免过快处理
                if (i % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }

            progressCallback(0.9, '完成编码...');

            // 完成输出
            await output.finalize();
            console.log('MediaBunny 输出已完成');

            progressCallback(0.95, '获取结果...');

            // 获取结果
            const buffer = output.target.buffer;
            if (!buffer || buffer.byteLength === 0) {
                throw new Error('生成的 MP4 buffer 为空');
            }

            const blob = new Blob([buffer], { type: 'video/mp4' });
            console.log('MP4 blob 大小:', blob.size, 'bytes');

            return blob;

        } catch (error) {
            console.error('MP4 编码失败:', error);
            throw error;
        }
    }

    // 获取质量对应的比特率
    getQualityBitrate(quality, canvas) {
        const pixels = canvas.width * canvas.height;
        
        let baseBitrate;
        if (pixels >= 1920 * 1080) {
            baseBitrate = 8000000;  // FHD: 8 Mbps
        } else if (pixels >= 1280 * 720) {
            baseBitrate = 5000000;  // HD: 5 Mbps
        } else {
            baseBitrate = 3000000;  // SD: 3 Mbps
        }

        const qualityMultipliers = {
            'low': 0.6,
            'medium': 1.0,
            'high': 1.5,
            'ultra': 2.0
        };

        const multiplier = qualityMultipliers[quality] || 1.0;
        return Math.round(baseBitrate * multiplier);
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 清理资源
    cleanup() {
        if (this.renderInterval) {
            clearInterval(this.renderInterval);
            this.renderInterval = null;
        }

        console.log('转换器资源清理完成');
    }
}

// 导出类
window.WebmToMp4Converter = WebmToMp4Converter;
