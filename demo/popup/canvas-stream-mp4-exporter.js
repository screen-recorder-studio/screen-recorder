// Canvas Stream MP4 导出器 - 使用 Canvas 流避免抖动问题
class CanvasStreamMp4Exporter {
    constructor() {
        this.mediabunny = null;
        this.isInitialized = false;
        this.isExporting = false;
        this.currentOutput = null;
        this.currentVideoSource = null;
        this.currentAudioSource = null;
        
        console.log('🎬 CanvasStreamMp4Exporter 初始化中...');
    }

    // 初始化 MediaBunny
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
            console.log('✅ CanvasStreamMp4Exporter 初始化完成');

        } catch (error) {
            console.error('❌ CanvasStreamMp4Exporter 初始化失败:', error);
            throw error;
        }
    }

    // 检查是否已初始化
    checkInitialized() {
        if (!this.isInitialized) {
            throw new Error('CanvasStreamMp4Exporter 未初始化，请先调用 initialize()');
        }
    }

    // 主要导出方法 - 使用 Canvas 流
    async exportVideoToMp4(videoBlob, options = {}) {
        this.checkInitialized();

        if (this.isExporting) {
            throw new Error('正在导出中，请等待当前导出完成');
        }

        const {
            quality = 'high',
            backgroundConfig = null,
            frameRate = 30,
            duration = null, // 如果不指定，使用原视频时长
            progressCallback = () => {}
        } = options;

        this.isExporting = true;

        try {
            console.log('🚀 开始 Canvas 流 MP4 导出，配置:', { quality, backgroundConfig, frameRate });

            progressCallback(0.05, '准备视频数据...');

            // 步骤1：创建视频元素
            const video = await this.createVideoElement(videoBlob);
            const videoDuration = duration || video.duration;

            progressCallback(0.1, '创建编辑画布...');

            // 步骤2：创建包含编辑效果的Canvas
            const canvas = this.createEditingCanvas(video, backgroundConfig);

            progressCallback(0.15, '计算编辑布局...');

            // 步骤3：计算视频布局
            const layout = this.calculateVideoLayout(video, canvas, backgroundConfig);

            progressCallback(0.2, '设置 Canvas 渲染...');

            // 步骤4：设置 Canvas 实时渲染
            await this.setupCanvasRendering(canvas, video, layout, backgroundConfig);

            progressCallback(0.25, '验证 Canvas 内容...');

            // 验证 Canvas 有内容
            await this.verifyCanvasContent(canvas);

            progressCallback(0.3, '创建 MediaBunny 输出...');

            // 步骤5：使用 Canvas 流导出
            const result = await this.exportWithCanvasStream(canvas, {
                quality,
                frameRate,
                duration: videoDuration,
                progressCallback: (progress, message) => {
                    // 映射进度到 30%-95%
                    const mappedProgress = 0.3 + (progress * 0.65);
                    progressCallback(mappedProgress, message);
                }
            });

            progressCallback(0.95, '完成处理...');

            // 计算压缩信息
            const originalSize = videoBlob.size;
            const finalSize = result.size;
            const compression = ((originalSize - finalSize) / originalSize) * 100;

            progressCallback(1.0, 'MP4 导出完成！');

            console.log('✅ Canvas 流 MP4 导出成功:', {
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
            console.error('❌ Canvas 流 MP4 导出失败:', error);
            throw error;
        } finally {
            this.cleanup();
            this.isExporting = false;
        }
    }

    // 创建视频元素
    async createVideoElement(videoBlob) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.src = URL.createObjectURL(videoBlob);
            video.muted = true;
            video.loop = true; // 循环播放以支持长时间录制

            video.onloadedmetadata = () => {
                console.log('视频元数据加载完成:', {
                    duration: video.duration,
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight
                });
                resolve(video);
            };

            video.onerror = (error) => {
                console.error('视频加载失败:', error);
                reject(new Error('视频加载失败'));
            };
        });
    }

    // 创建编辑画布
    createEditingCanvas(video, backgroundConfig) {
        const canvas = document.createElement('canvas');
        
        // 根据输出比例设置画布尺寸
        const outputRatio = backgroundConfig?.outputRatio || '16:9';
        const { width, height } = this.getCanvasSize(video, outputRatio);
        
        canvas.width = width;
        canvas.height = height;
        
        console.log('创建编辑画布:', { width, height, outputRatio });
        
        return canvas;
    }

    // 获取画布尺寸
    getCanvasSize(video, outputRatio) {
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

    // 设置 Canvas 实时渲染
    async setupCanvasRendering(canvas, video, layout, backgroundConfig) {
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
        video.loop = true; // 确保视频循环播放
        await video.play();

        // 设置高频率渲染以确保 Canvas 持续更新
        const frameInterval = 1000 / 60; // 60 FPS 渲染
        this.renderInterval = setInterval(renderFrame, frameInterval);

        // 立即渲染一帧
        renderFrame();

        console.log('Canvas 实时渲染已设置，渲染频率: 60 FPS');

        // 等待一小段时间确保渲染稳定
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 验证 Canvas 内容
    async verifyCanvasContent(canvas) {
        const ctx = canvas.getContext('2d');

        // 检查 Canvas 是否有内容
        const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100));
        const hasContent = imageData.data.some(pixel => pixel !== 0);

        console.log('Canvas 内容验证:', {
            hasContent: hasContent,
            canvasSize: `${canvas.width}x${canvas.height}`,
            samplePixels: Array.from(imageData.data.slice(0, 20))
        });

        if (!hasContent) {
            console.warn('Canvas 似乎没有内容，尝试强制渲染一帧...');

            // 如果没有内容，等待更长时间并重新检查
            await new Promise(resolve => setTimeout(resolve, 500));

            const imageData2 = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100));
            const hasContent2 = imageData2.data.some(pixel => pixel !== 0);

            if (!hasContent2) {
                console.error('Canvas 仍然没有内容，这可能导致空白视频');
            } else {
                console.log('Canvas 内容已准备就绪');
            }
        } else {
            console.log('Canvas 内容验证通过');
        }
    }

    // 使用 Canvas 直接导出（按照参考代码）
    async exportWithCanvasStream(canvas, options) {
        const { quality, frameRate, duration, progressCallback } = options;

        try {
            progressCallback(0.1, '设置 MediaBunny 输出...');

            // 创建 MediaBunny 输出
            const output = new this.mediabunny.Output({
                format: new this.mediabunny.Mp4OutputFormat(),
                target: new this.mediabunny.BufferTarget()
            });

            progressCallback(0.2, '创建 Canvas 视频源...');

            // 直接从 Canvas 元素创建视频源（按照参考代码）
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

            // 添加视频轨道（按照参考代码）
            output.addVideoTrack(videoSource, { frameRate: frameRate });

            this.currentOutput = output;
            this.currentVideoSource = videoSource;

            progressCallback(0.4, '启动录制...');

            // 验证 Canvas 内容
            const imageData = canvas.getContext('2d').getImageData(0, 0, Math.min(canvas.width, 10), Math.min(canvas.height, 10));
            const hasContent = imageData.data.some(pixel => pixel !== 0);
            console.log('Canvas 内容检查:', {
                hasContent: hasContent,
                canvasSize: `${canvas.width}x${canvas.height}`,
                samplePixels: Array.from(imageData.data.slice(0, 16))
            });

            // 开始输出
            await output.start();
            console.log('MediaBunny 输出已启动');

            progressCallback(0.5, '录制中...');

            // 手动添加帧到 CanvasSource（关键步骤）
            const frameRate = 30;
            const totalFrames = Math.ceil(frameRate * duration);
            const frameDuration = 1 / frameRate;

            for (let i = 0; i < totalFrames; i++) {
                const timestamp = i * frameDuration;

                // 添加当前帧到视频源
                await videoSource.add(timestamp, frameDuration);

                // 更新进度
                const progress = i / totalFrames;
                const mappedProgress = 0.5 + (progress * 0.4);
                progressCallback(mappedProgress, `录制中... ${Math.round(progress * 100)}%`);

                // 小延迟以避免过快处理
                if (i % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }

            progressCallback(0.9, '完成录制...');

            // 完成输出
            await output.finalize();
            console.log('MediaBunny 输出已完成');

            progressCallback(0.95, '获取结果...');

            // 获取结果
            const buffer = output.target.buffer;
            console.log('输出 buffer 信息:', {
                buffer: buffer,
                byteLength: buffer ? buffer.byteLength : 0,
                type: typeof buffer
            });

            if (!buffer || buffer.byteLength === 0) {
                throw new Error('生成的 MP4 buffer 为空');
            }

            const blob = new Blob([buffer], { type: 'video/mp4' });
            console.log('Canvas MP4 blob 大小:', blob.size, 'bytes');

            return blob;

        } catch (error) {
            console.error('Canvas 导出失败:', error);
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

    // 清理资源
    cleanup() {
        if (this.renderInterval) {
            clearInterval(this.renderInterval);
            this.renderInterval = null;
        }

        if (this.currentVideoSource) {
            try {
                // 清理视频源
                this.currentVideoSource = null;
            } catch (error) {
                console.warn('清理视频源时出错:', error);
            }
        }

        if (this.currentOutput) {
            try {
                // 清理输出
                this.currentOutput = null;
            } catch (error) {
                console.warn('清理输出时出错:', error);
            }
        }

        console.log('资源清理完成');
    }
}

// 导出类
window.CanvasStreamMp4Exporter = CanvasStreamMp4Exporter;
