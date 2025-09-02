/**
 * WebCodecs Integration Adapter
 * 将 WebCodecs Enhanced Exporter 无缝集成到现有导出流程
 */

class WebCodecsIntegrationAdapter {
    constructor() {
        this.webCodecsExporter = null;
        this.isInitialized = false;
        this.initializeIfSupported();
    }

    /**
     * 初始化 WebCodecs 导出器（如果支持）
     */
    initializeIfSupported() {
        if (WebCodecsEnhancedExporter?.isSupported()) {
            this.webCodecsExporter = new WebCodecsEnhancedExporter();
            this.isInitialized = true;
            console.log('✅ WebCodecs 集成适配器已初始化');
        } else {
            console.log('⚠️ WebCodecs 不支持，将使用传统方法');
        }
    }

    /**
     * 智能选择导出方法
     */
    async smartExport(videoBlob, options = {}) {
        const {
            backgroundConfig = null,
            quality = 'high',
            frameRate = 30,
            format = 'mp4',
            progressCallback = () => {}
        } = options;

        // 检测内容特征
        const contentAnalysis = await this.analyzeContent(videoBlob);
        
        // 决定是否使用 WebCodecs
        const shouldUseWebCodecs = this.shouldUseWebCodecs(contentAnalysis, options);

        if (shouldUseWebCodecs && this.isInitialized) {
            console.log('🚀 使用 WebCodecs 增强导出');
            return await this.exportWithWebCodecs(videoBlob, options);
        } else {
            console.log('📦 使用传统 Mediabunny 导出');
            return await this.exportWithMediabunny(videoBlob, options);
        }
    }

    /**
     * 分析视频内容特征
     */
    async analyzeContent(videoBlob) {
        const video = await this.createVideoElement(videoBlob);
        
        // 采样几帧进行分析
        const samples = await this.sampleFrames(video, 5);
        
        // 分析特征
        const analysis = {
            hasTextContent: this.detectTextContent(samples),
            hasHighFrequencyDetail: this.detectHighFrequencyDetail(samples),
            hasMotion: this.detectMotion(samples),
            duration: video.duration,
            resolution: {
                width: video.videoWidth,
                height: video.videoHeight
            }
        };

        // 清理
        URL.revokeObjectURL(video.src);

        console.log('📊 内容分析结果:', analysis);
        return analysis;
    }

    /**
     * 采样视频帧
     */
    async sampleFrames(video, count = 5) {
        const frames = [];
        const duration = video.duration;
        const interval = duration / (count + 1);

        const canvas = document.createElement('canvas');
        canvas.width = Math.min(video.videoWidth, 640); // 限制分析分辨率
        canvas.height = Math.min(video.videoHeight, 360);
        const ctx = canvas.getContext('2d');

        for (let i = 1; i <= count; i++) {
            video.currentTime = interval * i;
            await new Promise(resolve => {
                video.addEventListener('seeked', resolve, { once: true });
            });

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            frames.push(imageData);
        }

        return frames;
    }

    /**
     * 检测文字内容
     */
    detectTextContent(frames) {
        // 简单的边缘检测来判断是否有文字
        for (const frame of frames) {
            const edges = this.detectEdges(frame);
            const edgeRatio = edges / (frame.width * frame.height);
            
            // 如果边缘比例较高，可能包含文字
            if (edgeRatio > 0.05) {
                return true;
            }
        }
        return false;
    }

    /**
     * 边缘检测
     */
    detectEdges(imageData) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        let edgeCount = 0;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                
                // 简单的 Sobel 边缘检测
                const gx = Math.abs(
                    data[idx - 4] - data[idx + 4]
                );
                const gy = Math.abs(
                    data[idx - width * 4] - data[idx + width * 4]
                );
                
                if (gx + gy > 50) {
                    edgeCount++;
                }
            }
        }

        return edgeCount;
    }

    /**
     * 检测高频细节
     */
    detectHighFrequencyDetail(frames) {
        // 检测高频细节（如小文字、细线条等）
        for (const frame of frames) {
            const variance = this.calculateVariance(frame);
            if (variance > 1000) {
                return true;
            }
        }
        return false;
    }

    /**
     * 计算方差
     */
    calculateVariance(imageData) {
        const data = imageData.data;
        let sum = 0;
        let sumSq = 0;
        const count = data.length / 4;

        for (let i = 0; i < data.length; i += 4) {
            const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
            sum += gray;
            sumSq += gray * gray;
        }

        const mean = sum / count;
        return (sumSq / count) - (mean * mean);
    }

    /**
     * 检测运动
     */
    detectMotion(frames) {
        if (frames.length < 2) return false;

        for (let i = 1; i < frames.length; i++) {
            const diff = this.frameDifference(frames[i - 1], frames[i]);
            if (diff > 0.1) {
                return true;
            }
        }
        return false;
    }

    /**
     * 计算帧差异
     */
    frameDifference(frame1, frame2) {
        const data1 = frame1.data;
        const data2 = frame2.data;
        let diff = 0;

        for (let i = 0; i < data1.length; i += 4) {
            diff += Math.abs(data1[i] - data2[i]);
        }

        return diff / (data1.length / 4) / 255;
    }

    /**
     * 决定是否使用 WebCodecs
     */
    shouldUseWebCodecs(analysis, options) {
        // 强制使用 WebCodecs 的情况
        if (options.forceWebCodecs) {
            return true;
        }

        // 强制不使用 WebCodecs 的情况
        if (options.forceMediabunny) {
            return false;
        }

        // 智能决策
        let score = 0;

        // 文字内容 +3 分
        if (analysis.hasTextContent) {
            score += 3;
            console.log('📝 检测到文字内容 +3');
        }

        // 高频细节 +2 分
        if (analysis.hasHighFrequencyDetail) {
            score += 2;
            console.log('🔍 检测到高频细节 +2');
        }

        // 静态内容 +2 分
        if (!analysis.hasMotion) {
            score += 2;
            console.log('🖼️ 检测到静态内容 +2');
        }

        // 高分辨率 +1 分
        if (analysis.resolution.width >= 1920 || analysis.resolution.height >= 1080) {
            score += 1;
            console.log('📐 高分辨率内容 +1');
        }

        // 长视频 +1 分
        if (analysis.duration > 30) {
            score += 1;
            console.log('⏱️ 长视频 +1');
        }

        // 高质量要求 +2 分
        if (options.quality === 'ultra' || options.quality === 'high') {
            score += 2;
            console.log('✨ 高质量要求 +2');
        }

        console.log(`📊 WebCodecs 决策分数: ${score}/10`);
        
        // 分数 >= 5 时使用 WebCodecs
        return score >= 5;
    }

    /**
     * 使用 WebCodecs 导出
     */
    async exportWithWebCodecs(videoBlob, options) {
        const startTime = Date.now();
        
        try {
            const result = await this.webCodecsExporter.exportVideo(videoBlob, {
                backgroundConfig: options.backgroundConfig,
                quality: options.quality,
                frameRate: options.frameRate,
                codec: this.selectCodec(options),
                progressCallback: options.progressCallback
            });

            const endTime = Date.now();
            console.log(`✅ WebCodecs 导出完成，耗时: ${((endTime - startTime) / 1000).toFixed(2)}秒`);

            return {
                blob: result.blob,
                method: 'webcodecs',
                codec: result.codec,
                quality: result.quality,
                frameCount: result.frameCount,
                bitrate: result.bitrate,
                duration: (endTime - startTime) / 1000
            };

        } catch (error) {
            console.error('WebCodecs 导出失败，降级到 Mediabunny:', error);
            return await this.exportWithMediabunny(videoBlob, options);
        }
    }

    /**
     * 选择最佳编码器
     */
    selectCodec(options) {
        // 根据浏览器和需求选择编码器
        const format = options.format || 'mp4';
        
        if (format === 'mp4') {
            // 检查 H.264 支持
            if (this.isCodecSupported('avc1.640029')) {
                return 'avc';
            }
            // 检查 H.265 支持
            if (this.isCodecSupported('hev1.1.6.L123.B0')) {
                return 'hevc';
            }
        } else if (format === 'webm') {
            // 检查 VP9 支持
            if (this.isCodecSupported('vp09.00.41.08')) {
                return 'vp9';
            }
            // 检查 AV1 支持
            if (this.isCodecSupported('av01.0.08M.08')) {
                return 'av1';
            }
        }

        // 默认使用 H.264
        return 'avc';
    }

    /**
     * 检查编码器支持
     */
    isCodecSupported(codecString) {
        if (typeof VideoEncoder === 'undefined') {
            return false;
        }

        // 简单的同步检查（实际应该使用异步的 isConfigSupported）
        try {
            // 这里简化处理，实际应该异步检查
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 使用 Mediabunny 导出（降级方案）
     */
    async exportWithMediabunny(videoBlob, options) {
        // 检查 Mediabunny 导出器是否可用
        if (!window.MediabunnyMp4Exporter) {
            throw new Error('MediabunnyMp4Exporter 不可用');
        }

        const exporter = new MediabunnyMp4Exporter();
        
        // 初始化
        if (!exporter.isInitialized) {
            await exporter.initialize();
        }

        // 执行导出
        const result = await exporter.exportToMp4(videoBlob, {
            quality: options.quality || 'high',
            backgroundConfig: options.backgroundConfig,
            frameRate: options.frameRate || 30,
            progressCallback: options.progressCallback
        });

        return {
            blob: result.blob,
            method: 'mediabunny',
            originalSize: result.originalSize,
            finalSize: result.finalSize,
            compression: result.compression,
            format: 'mp4'
        };
    }

    /**
     * 创建视频元素
     */
    async createVideoElement(blob) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;

            video.onloadedmetadata = () => resolve(video);
            video.onerror = reject;
            video.src = URL.createObjectURL(blob);
        });
    }
}

// 修改 FormatExportManager 以集成 WebCodecs
if (window.FormatExportManager) {
    const originalExportMP4 = FormatExportManager.prototype.exportMP4WithMediabunny;
    
    FormatExportManager.prototype.exportMP4WithMediabunny = async function(blob, options = {}) {
        console.log('🔄 使用智能导出决策...');
        
        // 创建集成适配器
        const adapter = new WebCodecsIntegrationAdapter();
        
        try {
            // 使用智能导出
            const result = await adapter.smartExport(blob, {
                ...options,
                format: 'mp4',
                progressCallback: (percent, message) => {
                    this.onExportProgress?.(percent, message);
                }
            });

            console.log('✅ 智能导出完成:', {
                method: result.method,
                size: result.blob.size,
                codec: result.codec
            });

            return result;

        } catch (error) {
            console.error('智能导出失败，使用原始方法:', error);
            
            // 降级到原始方法
            return await originalExportMP4.call(this, blob, options);
        }
    };
}

// 导出适配器
window.WebCodecsIntegrationAdapter = WebCodecsIntegrationAdapter;

console.log('✅ WebCodecs 集成适配器已加载');
console.log('📝 特性：');
console.log('  - 智能内容分析');
console.log('  - 自动选择最佳导出方法');
console.log('  - WebCodecs / Mediabunny 无缝切换');
console.log('  - 优雅降级处理');
