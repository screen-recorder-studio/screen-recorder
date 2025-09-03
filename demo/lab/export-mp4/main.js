// 主应用逻辑
class CanvasExportApp {
    constructor() {
        this.canvas = null;
        this.animations = null;
        this.exporter = null;
        this.isRecording = false;
        
        this.initializeApp();
    }
    
    async initializeApp() {
        try {
            // 等待 MediaBunny 加载
            this.showStatus('正在加载 MediaBunny 库...', 'info');

            if (window.mediabunnyLoader) {
                await window.mediabunnyLoader.waitForLoad();
                this.showStatus('MediaBunny 库加载成功', 'success');
            } else {
                throw new Error('MediaBunny 加载器不可用');
            }

            // 获取 DOM 元素
            this.canvas = document.getElementById('animationCanvas');
            this.animations = new CanvasAnimations(this.canvas);
            this.exporter = new CanvasToMP4Exporter();

            // 绑定事件
            this.bindEvents();

            // 检查编码器支持
            await this.checkCodecSupport();

            // 开始默认动画
            this.animations.start();

            console.log('Canvas Export App 初始化完成');

        } catch (error) {
            console.error('应用初始化失败:', error);
            this.showStatus(`初始化失败: ${error.message}`, 'error');
        }
    }
    
    bindEvents() {
        // 动画控制
        document.getElementById('startAnimation').addEventListener('click', () => {
            this.animations.start();
        });
        
        document.getElementById('stopAnimation').addEventListener('click', () => {
            this.animations.stop();
        });
        
        // 动画设置
        document.getElementById('animationType').addEventListener('change', (e) => {
            this.animations.setAnimationType(e.target.value);
        });
        
        document.getElementById('animationSpeed').addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            this.animations.setSpeed(speed);
            document.getElementById('speedValue').textContent = speed.toFixed(1) + 'x';
        });
        
        // 编码器选择
        document.getElementById('codecSelect').addEventListener('change', () => {
            this.checkCodecSupport();
        });
        
        // 导出按钮
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.startExport();
        });
        
        // 下载按钮
        document.getElementById('downloadBtn').addEventListener('click', () => {
            this.downloadVideo();
        });
    }
    
    async checkCodecSupport() {
        const codecSelect = document.getElementById('codecSelect');
        const codecSupport = document.getElementById('codecSupport');
        const selectedCodec = codecSelect.value;
        
        try {
            const support = await this.exporter.checkCodecSupport(selectedCodec);
            
            if (support.supported) {
                codecSupport.innerHTML = `<span class="supported">✅ ${support.reason}</span>`;
            } else {
                codecSupport.innerHTML = `<span class="not-supported">❌ ${support.reason}</span>`;
            }
        } catch (error) {
            codecSupport.innerHTML = `<span class="not-supported">❌ 检查失败: ${error.message}</span>`;
        }
    }
    
    async startExport() {
        if (this.isRecording) {
            this.showStatus('正在录制中...', 'info');
            return;
        }
        
        try {
            this.isRecording = true;
            
            // 获取设置
            const codec = document.getElementById('codecSelect').value;
            const bitrate = parseInt(document.getElementById('bitrateSelect').value);
            const fps = parseInt(document.getElementById('fpsSelect').value);
            const duration = parseInt(document.getElementById('durationInput').value);
            
            // 验证设置
            if (duration < 1 || duration > 30) {
                throw new Error('录制时长必须在 1-30 秒之间');
            }
            
            // 检查编码器支持
            const support = await this.exporter.checkCodecSupport(codec);
            if (!support.supported) {
                throw new Error(`编码器不支持: ${support.reason}`);
            }
            
            // 显示进度
            this.showProgress(true);
            this.updateProgress(0, '准备录制...');
            
            // 禁用控件
            this.setControlsEnabled(false);
            
            // 停止当前动画
            this.animations.stop();
            
            console.log('开始导出，设置:', { codec, bitrate, fps, duration });
            
            // 开始导出
            const blob = await this.exporter.exportCanvasToMP4(this.canvas, {
                codec,
                bitrate,
                fps,
                duration,
                onProgress: (progress, message) => {
                    this.updateProgress(progress, message);
                },
                onFrame: (timestamp) => {
                    // 渲染动画帧
                    this.animations.renderFrame(timestamp);
                }
            });
            
            // 显示预览
            this.showVideoPreview(blob);
            this.showStatus('导出成功！', 'success');
            
        } catch (error) {
            console.error('导出失败:', error);
            this.showStatus(`导出失败: ${error.message}`, 'error');
        } finally {
            this.isRecording = false;
            this.showProgress(false);
            this.setControlsEnabled(true);
            
            // 重新开始动画
            this.animations.start();
        }
    }
    
    showVideoPreview(blob) {
        const previewContainer = document.getElementById('videoPreview');
        const previewVideo = document.getElementById('previewVideo');
        
        // 清理之前的 URL
        if (previewVideo.src) {
            URL.revokeObjectURL(previewVideo.src);
        }
        
        // 设置新的视频源
        previewVideo.src = URL.createObjectURL(blob);
        previewContainer.style.display = 'block';
        
        // 滚动到预览区域
        previewContainer.scrollIntoView({ behavior: 'smooth' });
    }
    
    downloadVideo() {
        try {
            const animationType = document.getElementById('animationType').value;
            const codec = document.getElementById('codecSelect').value;
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `canvas-${animationType}-${codec}-${timestamp}.mp4`;
            
            this.exporter.downloadExportedFile(filename);
            this.showStatus('下载已开始', 'success');
        } catch (error) {
            this.showStatus(`下载失败: ${error.message}`, 'error');
        }
    }
    
    showProgress(show) {
        const progressContainer = document.getElementById('progressContainer');
        progressContainer.style.display = show ? 'block' : 'none';
    }
    
    updateProgress(progress, message) {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        
        progressFill.style.width = `${progress * 100}%`;
        progressText.textContent = message;
    }
    
    showStatus(message, type = 'info') {
        const statusContainer = document.getElementById('statusContainer');
        
        // 清除之前的状态
        statusContainer.innerHTML = '';
        
        // 创建状态元素
        const statusDiv = document.createElement('div');
        statusDiv.className = `status ${type}`;
        statusDiv.textContent = message;
        
        statusContainer.appendChild(statusDiv);
        
        // 自动清除成功和信息状态
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                if (statusDiv.parentNode) {
                    statusDiv.parentNode.removeChild(statusDiv);
                }
            }, 5000);
        }
    }
    
    setControlsEnabled(enabled) {
        const controls = [
            'codecSelect',
            'bitrateSelect', 
            'fpsSelect',
            'durationInput',
            'animationType',
            'animationSpeed',
            'exportBtn'
        ];
        
        controls.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.disabled = !enabled;
            }
        });
    }
}

// 当页面加载完成时初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.app = new CanvasExportApp();
});
