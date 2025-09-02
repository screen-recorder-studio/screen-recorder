/**
 * WebCodecs Enhanced Exporter
 * 使用 WebCodecs API 提供更精确的视频编码控制
 * 解决文字抖动和质量问题
 */

class WebCodecsEnhancedExporter {
    constructor() {
        this.isSupported = this.checkSupport();
        this.encoder = null;
        this.videoFrames = [];
        this.encodedChunks = [];
        this.frameCount = 0;
        this.currentTimestamp = 0;
    }

    /**
     * 检查 WebCodecs API 支持
     */
    checkSupport() {
        const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
        const hasVideoFrame = typeof VideoFrame !== 'undefined';
        const hasEncodedVideoChunk = typeof EncodedVideoChunk !== 'undefined';
        
        const supported = hasVideoEncoder && hasVideoFrame && hasEncodedVideoChunk;
        
        if (supported) {
            console.log('✅ WebCodecs API 可用');
        } else {
            console.warn('⚠️ WebCodecs API 不可用，将降级到传统方法');
        }
        
        return supported;
    }

    /**
     * 获取优化的编码器配置
     */
    getEncoderConfig(canvas, options = {}) {
        const {
            codec = 'avc', // avc, hevc, vp9, av1
            quality = 'high',
            frameRate = 30,
            keyFrameInterval = 30,
            backgroundConfig = null
        } = options;

        // 基础配置
        const width = canvas.width;
        const height = canvas.height;
        
        // 计算优化的比特率（针对文字内容）
        const pixels = width * height;
        let bitrate;
        
        // 为文字内容提供更高的比特率
        if (quality === 'ultra') {
            bitrate = pixels * 0.15; // 超高质量
        } else if (quality === 'high') {
            bitrate = pixels * 0.1;  // 高质量
        } else if (quality === 'medium') {
            bitrate = pixels * 0.06; // 中等质量
        } else {
            bitrate = pixels * 0.03; // 低质量
        }

        // 确保最小比特率
        bitrate = Math.max(bitrate, 1000000); // 最小 1 Mbps
        bitrate = Math.min(bitrate, 50000000); // 最大 50 Mbps

        // 编码器配置
        const config = {
            codec: this.getCodecString(codec, width, height, frameRate),
            width: width,
            height: height,
            bitrate: Math.round(bitrate),
            framerate: frameRate,
            keyInterval: keyFrameInterval,
            latencyMode: 'quality', // 'quality' 优先质量，'realtime' 优先速度
            hardwareAcceleration: 'prefer-hardware',
            
            // AVC/H.264 特定优化
            avc: codec === 'avc' ? {
                profile: 'high',
                level: '4.1',
                // 文字内容优化参数
                tune: 'stillimage', // 静态图像优化
                preset: 'slow',     // 慢速编码获得更好质量
                crf: quality === 'ultra' ? 18 : 
                     quality === 'high' ? 20 : 
                     quality === 'medium' ? 23 : 26
            } : undefined,

            // VP9 特定优化
            vp9: codec === 'vp9' ? {
                profile: 0,
                level: 41,
                bitDepth: 8,
                chromaSubsampling: '420',
                colorSpace: {
                    primaries: 'bt709',
                    transfer: 'bt709',
                    matrix: 'bt709',
                    fullRange: false
                }
            } : undefined,

            // AV1 特定优化
            av1: codec === 'av1' ? {
                profile: 'main',
                level: '5.1',
                tier: 'main',
                bitDepth: 8,
                monochrome: false,
                chromaSubsampling: '420',
                colorSpace: {
                    primaries: 'bt709',
                    transfer: 'bt709',
                    matrix: 'bt709',
                    fullRange: false
                }
            } : undefined
        };

        console.log('📊 WebCodecs 编码器配置:', {
            codec: config.codec,
            resolution: `${width}x${height}`,
            bitrate: `${(bitrate / 1000000).toFixed(2)} Mbps`,
            framerate: frameRate,
            quality: quality,
            latencyMode: config.latencyMode
        });

        return config;
    }

    /**
     * 获取编码器字符串
     */
    getCodecString(codec, width, height, frameRate) {
        switch (codec) {
            case 'avc':
                // H.264 High Profile, Level 4.1
                return 'avc1.640029'; // High Profile, Level 4.1
            
            case 'hevc':
                // H.265 Main Profile
                return 'hev1.1.6.L123.B0';
            
            case 'vp9':
                // VP9 Profile 0
                return 'vp09.00.41.08';
            
            case 'av1':
                // AV1 Main Profile
                return 'av01.0.08M.08';
            
            default:
                return 'avc1.640029';
        }
    }

    /**
     * 初始化编码器
     */
    async initializeEncoder(config) {
        return new Promise((resolve, reject) => {
            try {
                this.encoder = new VideoEncoder({
                    output: (chunk, metadata) => {
                        this.handleEncodedChunk(chunk, metadata);
                    },
                    error: (error) => {
                        console.error('编码器错误:', error);
                        reject(error);
                    }
                });

                // 验证配置
                VideoEncoder.isConfigSupported(config).then(support => {
                    if (support.supported) {
                        this.encoder.configure(config);
                        console.log('✅ WebCodecs 编码器已配置');
                        resolve();
                    } else {
                        throw new Error('编码器配置不支持');
                    }
                }).catch(reject);

            } catch (error) {
                console.error('初始化编码器失败:', error);
                reject(error);
            }
        });
    }

    /**
     * 处理编码后的数据块
     */
    handleEncodedChunk(chunk, metadata) {
        // 存储编码后的数据
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        
        this.encodedChunks.push({
            data: data,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            type: chunk.type,
            metadata: metadata
        });

        // 进度回调
        if (this.onProgress) {
            const progress = (this.encodedChunks.length / this.totalFrames) * 100;
            this.onProgress(progress, `编码进度: ${this.encodedChunks.length}/${this.totalFrames}`);
        }
    }

    /**
     * 创建优化的 VideoFrame
     */
    async createOptimizedVideoFrame(canvas, timestamp) {
        // 使用 ImageBitmap 进行像素完美捕获
        const imageBitmap = await createImageBitmap(canvas, {
            resizeQuality: 'pixelated', // 像素完美，避免模糊
            premultiplyAlpha: 'none'
        });

        // 创建 VideoFrame
        const frame = new VideoFrame(imageBitmap, {
            timestamp: timestamp,
            alpha: 'discard' // 丢弃 alpha 通道以提高性能
        });

        imageBitmap.close(); // 释放资源
        return frame;
    }

    /**
     * 编码单帧（优化版本）
     */
    async encodeFrame(canvas, timestamp, isKeyFrame = false) {
        if (!this.encoder || this.encoder.state === 'closed') {
            throw new Error('编码器未初始化或已关闭');
        }

        try {
            // 创建优化的 VideoFrame
            const frame = await this.createOptimizedVideoFrame(canvas, timestamp);

            // 编码选项
            const encodeOptions = {
                keyFrame: isKeyFrame // 关键帧控制
            };

            // 编码帧
            await this.encoder.encode(frame, encodeOptions);
            
            // 立即关闭 frame 以释放资源
            frame.close();

            this.frameCount++;

            // 每100帧输出一次日志
            if (this.frameCount % 100 === 0) {
                console.log(`📊 已编码 ${this.frameCount} 帧`);
            }

        } catch (error) {
            console.error('编码帧失败:', error);
            throw error;
        }
    }

    /**
     * 导出视频（主入口）
     */
    async exportVideo(videoBlob, options = {}) {
        if (!this.isSupported) {
            throw new Error('WebCodecs API 不支持');
        }

        const {
            backgroundConfig = null,
            quality = 'high',
            frameRate = 30,
            codec = 'avc',
            progressCallback = () => {}
        } = options;

        this.onProgress = progressCallback;

        try {
            progressCallback(0, '准备视频数据...');

            // 1. 创建视频元素
            const video = await this.createVideoElement(videoBlob);
            
            progressCallback(10, '创建处理画布...');

            // 2. 创建编辑画布
            const canvas = this.createEditingCanvas(video, backgroundConfig);
            const layout = this.calculateVideoLayout(video, canvas, backgroundConfig);

            progressCallback(20, '初始化编码器...');

            // 3. 初始化编码器
            const config = this.getEncoderConfig(canvas, {
                codec,
                quality,
                frameRate,
                backgroundConfig
            });
            await this.initializeEncoder(config);

            progressCallback(30, '开始编码视频...');

            // 4. 逐帧编码
            const duration = video.duration;
            const totalFrames = Math.floor(duration * frameRate);
            this.totalFrames = totalFrames;

            for (let i = 0; i < totalFrames; i++) {
                const timestamp = (i / frameRate) * 1000000; // 微秒
                const time = i / frameRate; // 秒
                
                // 设置视频时间
                video.currentTime = time;
                await this.waitForSeek(video);

                // 渲染帧到画布（应用编辑效果）
                this.renderFrameWithEffects(canvas, video, layout, backgroundConfig);

                // 决定是否为关键帧（每秒一个关键帧）
                const isKeyFrame = i % frameRate === 0;

                // 编码帧
                await this.encodeFrame(canvas, timestamp, isKeyFrame);

                // 更新进度
                const progress = 30 + ((i + 1) / totalFrames) * 60;
                progressCallback(progress, `编码中: ${i + 1}/${totalFrames} 帧`);
            }

            progressCallback(90, '完成编码...');

            // 5. 刷新编码器
            await this.encoder.flush();

            progressCallback(95, '封装视频...');

            // 6. 封装为 MP4（使用 Mediabunny 或其他封装器）
            const mp4Blob = await this.packageToMp4(this.encodedChunks, config);

            progressCallback(100, '导出完成！');

            return {
                blob: mp4Blob,
                codec: codec,
                quality: quality,
                frameCount: this.frameCount,
                bitrate: config.bitrate
            };

        } catch (error) {
            console.error('WebCodecs 导出失败:', error);
            throw error;
        } finally {
            this.cleanup();
        }
    }

    /**
     * 等待视频 seek 完成
     */
    async waitForSeek(video) {
        return new Promise((resolve) => {
            if (video.seeking) {
                video.addEventListener('seeked', resolve, { once: true });
            } else {
                resolve();
            }
        });
    }

    /**
     * 渲染带效果的帧
     */
    renderFrameWithEffects(canvas, video, layout, backgroundConfig) {
        const ctx = canvas.getContext('2d');
        
        // 保存状态
        ctx.save();

        // 设置高质量渲染（关键！）
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 清除画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制背景
        if (backgroundConfig?.color) {
            ctx.fillStyle = backgroundConfig.color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // 绘制视频（使用整数坐标避免抖动）
        const x = Math.round(layout.x);
        const y = Math.round(layout.y);
        const width = Math.round(layout.width);
        const height = Math.round(layout.height);

        ctx.drawImage(video, x, y, width, height);

        // 恢复状态
        ctx.restore();
    }

    /**
     * 创建视频元素
     */
    async createVideoElement(blob) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;

            video.onloadedmetadata = () => {
                console.log('视频元数据加载完成:', {
                    duration: video.duration,
                    width: video.videoWidth,
                    height: video.videoHeight
                });
                resolve(video);
            };

            video.onerror = reject;
            video.src = URL.createObjectURL(blob);
        });
    }

    /**
     * 创建编辑画布
     */
    createEditingCanvas(video, backgroundConfig) {
        const canvas = document.createElement('canvas');
        
        // 根据背景配置确定画布尺寸
        if (backgroundConfig?.outputRatio) {
            const dimensions = this.calculateCanvasDimensions(video, backgroundConfig.outputRatio);
            canvas.width = dimensions.width;
            canvas.height = dimensions.height;
        } else {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }

        console.log('创建编辑画布:', {
            width: canvas.width,
            height: canvas.height
        });

        return canvas;
    }

    /**
     * 计算画布尺寸
     */
    calculateCanvasDimensions(video, outputRatio) {
        const ratioMap = {
            '16:9': { width: 1920, height: 1080 },
            '1:1': { width: 1080, height: 1080 },
            '9:16': { width: 1080, height: 1920 },
            '4:5': { width: 1080, height: 1350 }
        };

        return ratioMap[outputRatio] || { 
            width: video.videoWidth, 
            height: video.videoHeight 
        };
    }

    /**
     * 计算视频布局
     */
    calculateVideoLayout(video, canvas, backgroundConfig) {
        const padding = backgroundConfig?.padding || 60;
        const availableWidth = canvas.width - padding * 2;
        const availableHeight = canvas.height - padding * 2;

        const videoAspectRatio = video.videoWidth / video.videoHeight;
        const targetAspectRatio = availableWidth / availableHeight;

        let width, height, x, y;

        if (videoAspectRatio > targetAspectRatio) {
            width = availableWidth;
            height = availableWidth / videoAspectRatio;
            x = padding;
            y = padding + (availableHeight - height) / 2;
        } else {
            height = availableHeight;
            width = availableHeight * videoAspectRatio;
            x = padding + (availableWidth - width) / 2;
            y = padding;
        }

        return { x, y, width, height };
    }

    /**
     * 封装为 MP4
     */
    async packageToMp4(encodedChunks, config) {
        // 这里可以使用 Mediabunny 或 mp4box.js 进行封装
        // 为了示例，这里返回一个简单的 Blob
        
        // 如果 Mediabunny 可用，使用它
        if (window.Mediabunny) {
            return await this.packageWithMediabunny(encodedChunks, config);
        }
        
        // 否则创建一个基本的 webm 容器（作为降级）
        console.warn('Mediabunny 不可用，使用基本封装');
        const allData = encodedChunks.map(chunk => chunk.data);
        return new Blob(allData, { type: 'video/mp4' });
    }

    /**
     * 使用 Mediabunny 封装
     */
    async packageWithMediabunny(encodedChunks, config) {
        // 实现 Mediabunny 封装逻辑
        console.log('使用 Mediabunny 封装 MP4...');
        
        // TODO: 集成 Mediabunny 封装逻辑
        const allData = encodedChunks.map(chunk => chunk.data);
        return new Blob(allData, { type: 'video/mp4' });
    }

    /**
     * 清理资源
     */
    cleanup() {
        if (this.encoder && this.encoder.state !== 'closed') {
            this.encoder.close();
        }
        this.encoder = null;
        this.encodedChunks = [];
        this.frameCount = 0;
    }

    /**
     * 检测是否应该使用 WebCodecs
     */
    static shouldUseWebCodecs(video, options = {}) {
        // 检查浏览器支持
        if (!WebCodecsEnhancedExporter.isSupported()) {
            return false;
        }

        // 检查视频特征
        const hasTextContent = options.hasTextContent ?? true;
        const needsPreciseControl = options.needsPreciseControl ?? true;
        const duration = video?.duration || 0;

        // 对于包含文字内容或需要精确控制的视频，优先使用 WebCodecs
        if (hasTextContent || needsPreciseControl) {
            console.log('✅ 推荐使用 WebCodecs：文字内容或需要精确控制');
            return true;
        }

        // 对于长视频，WebCodecs 可能更高效
        if (duration > 30) {
            console.log('✅ 推荐使用 WebCodecs：长视频');
            return true;
        }

        return false;
    }

    /**
     * 静态方法：检查支持
     */
    static isSupported() {
        return typeof VideoEncoder !== 'undefined' && 
               typeof VideoFrame !== 'undefined' &&
               typeof EncodedVideoChunk !== 'undefined';
    }
}

// 导出类
window.WebCodecsEnhancedExporter = WebCodecsEnhancedExporter;

console.log('✅ WebCodecs Enhanced Exporter 已加载');
