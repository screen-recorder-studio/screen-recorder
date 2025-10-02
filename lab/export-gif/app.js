// GIF Export Test Application
// Using gif.js library for encoding GIF from various sources

class GifExporter {
    constructor() {
        this.gif = null;
        this.recording = false;
        this.frames = [];
        this.stream = null;
        this.animationId = null;
        this.currentSource = 'canvas';
        this.gifBlob = null;
        
        this.initElements();
        this.bindEvents();
        this.startCanvasAnimation();
        this.updateSettings();
    }

    initElements() {
        // Canvas and video elements
        this.canvas = document.getElementById('canvas');
        // 设置 willReadFrequently 以优化频繁的 getImageData 操作
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.video = document.getElementById('video');
        
        // Controls
        this.sourceSelect = document.getElementById('source-select');
        this.videoFile = document.getElementById('video-file');
        this.startWebcam = document.getElementById('start-webcam');
        this.stopWebcam = document.getElementById('stop-webcam');
        this.webcamControls = document.querySelector('.webcam-controls');
        
        // Settings
        this.qualitySlider = document.getElementById('quality');
        this.workersSlider = document.getElementById('workers');
        this.frameRateSlider = document.getElementById('frame-rate');
        this.durationSlider = document.getElementById('duration');
        this.widthSlider = document.getElementById('width');
        this.heightSlider = document.getElementById('height');
        
        // Buttons
        this.startBtn = document.getElementById('start-recording');
        this.stopBtn = document.getElementById('stop-recording');
        this.downloadBtn = document.getElementById('download-gif');
        
        // Status elements
        this.status = document.getElementById('status');
        this.progressBar = document.getElementById('progress-bar');
        this.progressFill = document.getElementById('progress-fill');
        this.result = document.getElementById('result');
        this.placeholder = document.getElementById('placeholder');
        this.fileInfo = document.getElementById('file-info');
    }

    bindEvents() {
        // Source selection
        this.sourceSelect.addEventListener('change', (e) => this.handleSourceChange(e.target.value));
        
        // Video file input
        this.videoFile.addEventListener('change', (e) => this.loadVideoFile(e.target.files[0]));
        
        // Webcam controls
        this.startWebcam.addEventListener('click', () => this.startWebcamStream());
        this.stopWebcam.addEventListener('click', () => this.stopWebcamStream());
        
        // Settings sliders
        [
            { slider: this.qualitySlider, display: 'quality-value' },
            { slider: this.workersSlider, display: 'workers-value' },
            { slider: this.frameRateSlider, display: 'frame-rate-value' },
            { slider: this.durationSlider, display: 'duration-value' },
            { slider: this.widthSlider, display: 'width-value' },
            { slider: this.heightSlider, display: 'height-value' }
        ].forEach(({ slider, display }) => {
            slider.addEventListener('input', (e) => {
                document.getElementById(display).textContent = e.target.value;
                this.updateCanvasSize();
            });
        });
        
        // Recording controls
        this.startBtn.addEventListener('click', () => this.startRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        this.downloadBtn.addEventListener('click', () => this.downloadGif());
    }

    handleSourceChange(source) {
        this.currentSource = source;
        
        // Reset UI
        this.video.style.display = 'none';
        this.canvas.style.display = 'block';
        this.videoFile.style.display = 'none';
        this.webcamControls.style.display = 'none';
        
        // Stop any existing streams or animations
        this.stopWebcamStream();
        
        switch (source) {
            case 'canvas':
                this.startCanvasAnimation();
                break;
            case 'video':
                this.videoFile.style.display = 'block';
                this.videoFile.click();
                break;
            case 'webcam':
                this.webcamControls.style.display = 'block';
                break;
        }
    }

    startCanvasAnimation() {
        const animate = () => {
            if (this.currentSource !== 'canvas') return;
            
            this.ctx.fillStyle = '#f0f0f0';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Draw animated circles
            const time = Date.now() / 1000;
            const colors = ['#667eea', '#764ba2', '#f093fb', '#f5576c'];
            
            for (let i = 0; i < 4; i++) {
                const x = this.canvas.width / 2 + Math.cos(time + i * Math.PI / 2) * 100;
                const y = this.canvas.height / 2 + Math.sin(time + i * Math.PI / 2) * 100;
                
                this.ctx.beginPath();
                this.ctx.arc(x, y, 20 + i * 5, 0, Math.PI * 2);
                this.ctx.fillStyle = colors[i];
                this.ctx.fill();
            }
            
            // Draw center text
            this.ctx.fillStyle = '#333';
            this.ctx.font = 'bold 24px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('GIF 测试', this.canvas.width / 2, this.canvas.height / 2);
            
            this.animationId = requestAnimationFrame(animate);
        };
        
        animate();
    }

    async loadVideoFile(file) {
        if (!file) return;
        
        const url = URL.createObjectURL(file);
        this.video.src = url;
        this.video.style.display = 'block';
        this.canvas.style.display = 'none';
        
        this.video.addEventListener('loadedmetadata', () => {
            // 保持视频原始尺寸
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            // 更新滑块值以反映实际尺寸
            this.widthSlider.value = this.video.videoWidth;
            this.heightSlider.value = this.video.videoHeight;
            document.getElementById('width-value').textContent = this.video.videoWidth;
            document.getElementById('height-value').textContent = this.video.videoHeight;
            this.updateStatus(`视频已加载 (${this.video.videoWidth}x${this.video.videoHeight})`, 'info');
        });
    }

    async startWebcamStream() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    width: parseInt(this.widthSlider.value),
                    height: parseInt(this.heightSlider.value)
                } 
            });
            
            this.video.srcObject = this.stream;
            this.video.style.display = 'block';
            this.canvas.style.display = 'none';
            this.video.play();
            
            this.startWebcam.disabled = true;
            this.stopWebcam.disabled = false;
            this.updateStatus('摄像头已开启', 'info');
        } catch (error) {
            this.updateStatus('无法访问摄像头: ' + error.message, 'error');
        }
    }

    stopWebcamStream() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
            this.video.srcObject = null;
            
            this.startWebcam.disabled = false;
            this.stopWebcam.disabled = true;
            
            if (this.currentSource === 'webcam') {
                this.video.style.display = 'none';
                this.canvas.style.display = 'block';
            }
        }
    }

    updateCanvasSize() {
        this.canvas.width = parseInt(this.widthSlider.value);
        this.canvas.height = parseInt(this.heightSlider.value);
        
        if (this.currentSource === 'canvas') {
            this.startCanvasAnimation();
        }
    }

    startRecording() {
        if (this.recording) return;
        
        // 对于视频源，使用实际视频尺寸
        let gifWidth = parseInt(this.widthSlider.value);
        let gifHeight = parseInt(this.heightSlider.value);
        
        if ((this.currentSource === 'video' || this.currentSource === 'webcam') && this.video.videoWidth) {
            gifWidth = this.video.videoWidth;
            gifHeight = this.video.videoHeight;
        }
        
        // Initialize GIF encoder with settings
        this.gif = new GIF({
            workers: parseInt(this.workersSlider.value),
            quality: parseInt(this.qualitySlider.value),
            width: gifWidth,
            height: gifHeight,
            workerScript: 'gif.worker.js'
        });
        
        // 更新 canvas 尺寸以匹配
        this.canvas.width = gifWidth;
        this.canvas.height = gifHeight;
        
        // Set up event handlers
        this.gif.on('finished', (blob) => {
            this.onGifFinished(blob);
        });
        
        this.gif.on('progress', (progress) => {
            this.updateProgress(progress);
        });
        
        this.recording = true;
        this.frames = [];
        this.startBtn.disabled = true;
        this.stopBtn.disabled = false;
        this.downloadBtn.disabled = true;
        
        this.updateStatus('录制中...', 'processing');
        this.progressBar.classList.remove('active');
        
        const fps = parseInt(this.frameRateSlider.value);
        const duration = parseInt(this.durationSlider.value) * 1000;
        const interval = 1000 / fps;
        
        let frameCount = 0;
        const maxFrames = (duration / interval) | 0;
        
        const captureFrame = () => {
            if (!this.recording || frameCount >= maxFrames) {
                this.stopRecording();
                return;
            }
            
            // Capture frame based on source
            if (this.currentSource === 'video' || this.currentSource === 'webcam') {
                if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
                    // 清空画布
                    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    // 绘制当前视频帧
                    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
                    
                    // 如果是视频文件，推进播放位置以获取不同的帧
                    if (this.currentSource === 'video' && this.video.duration) {
                        const videoDuration = this.video.duration;
                        const captureInterval = videoDuration / maxFrames;
                        this.video.currentTime = Math.min(frameCount * captureInterval, videoDuration);
                    }
                }
            }
            
            // Add frame to GIF
            this.gif.addFrame(this.ctx, {
                copy: true,
                delay: interval
            });
            
            frameCount++;
            this.updateStatus(`录制中... (${frameCount}/${maxFrames} 帧)`, 'processing');
            
            // 对于视频文件，等待 seek 完成后再捕获下一帧
            if (this.currentSource === 'video' && this.video.duration) {
                this.video.addEventListener('seeked', function onSeeked() {
                    this.video.removeEventListener('seeked', onSeeked);
                    setTimeout(() => captureFrame(), 50); // 给一点时间让视频帧渲染
                }.bind(this), { once: true });
            } else {
                setTimeout(captureFrame, interval);
            }
        };
        
        captureFrame();
    }

    stopRecording() {
        if (!this.recording) return;
        
        this.recording = false;
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        
        this.updateStatus('正在生成 GIF...', 'processing');
        this.progressBar.classList.add('active');
        
        // Render the GIF
        this.gif.render();
    }

    onGifFinished(blob) {
        this.gifBlob = blob;
        const url = URL.createObjectURL(blob);
        
        this.result.src = url;
        this.result.style.display = 'block';
        this.placeholder.style.display = 'none';
        
        const size = (blob.size / 1024).toFixed(2);
        this.fileInfo.innerHTML = `
            <strong>文件信息:</strong><br>
            大小: ${size} KB<br>
            宽度: ${this.widthSlider.value}px<br>
            高度: ${this.heightSlider.value}px<br>
            质量: ${this.qualitySlider.value}<br>
            帧率: ${this.frameRateSlider.value} FPS
        `;
        this.fileInfo.style.display = 'block';
        
        this.downloadBtn.disabled = false;
        this.updateStatus('GIF 生成完成!', 'success');
        this.progressBar.classList.remove('active');
    }

    updateProgress(progress) {
        const percent = Math.round(progress * 100);
        this.progressFill.style.width = percent + '%';
        this.progressFill.textContent = percent + '%';
    }

    downloadGif() {
        if (!this.gifBlob) return;
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(this.gifBlob);
        link.download = `gif-export-${Date.now()}.gif`;
        link.click();
    }

    updateStatus(message, type = 'info') {
        this.status.textContent = message;
        this.status.className = `status ${type}`;
    }

    updateSettings() {
        // Update all display values
        document.getElementById('quality-value').textContent = this.qualitySlider.value;
        document.getElementById('workers-value').textContent = this.workersSlider.value;
        document.getElementById('frame-rate-value').textContent = this.frameRateSlider.value;
        document.getElementById('duration-value').textContent = this.durationSlider.value;
        document.getElementById('width-value').textContent = this.widthSlider.value;
        document.getElementById('height-value').textContent = this.heightSlider.value;
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new GifExporter();
});