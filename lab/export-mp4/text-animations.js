// 文字动画系统
class TextAnimations {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.animationId = null;
        this.isRunning = false;
        this.startTime = 0;
        
        // 默认设置
        this.settings = {
            text: 'Hello World!\n欢迎使用文字动画\nCanvas to MP4\n专业视频导出',
            animationType: 'typewriter',
            fontSize: 48,
            fontFamily: 'Arial',
            textColor: '#ffffff',
            backgroundColor: '#000000',
            speed: 1.0,
            lineHeight: 1.5
        };
        
        // 动画状态
        this.animationState = {
            currentCharIndex: 0,
            currentLineIndex: 0,
            opacity: 0,
            scale: 0,
            offsetX: 0,
            offsetY: 0,
            colorHue: 0,
            bounceOffset: 0
        };
        
        this.textLines = [];
        this.updateTextLines();
    }
    
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.updateTextLines();
        this.resetAnimationState();
    }
    
    updateTextLines() {
        this.textLines = this.settings.text
            .split('\n')
            .filter(line => line.trim())
            .map(line => line.trim());
    }
    
    resetAnimationState() {
        this.animationState = {
            currentCharIndex: 0,
            currentLineIndex: 0,
            opacity: 0,
            scale: 0,
            offsetX: 0,
            offsetY: 0,
            colorHue: 0,
            bounceOffset: 0
        };
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.startTime = performance.now();
        this.resetAnimationState();
        this.animate();
    }
    
    stop() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    
    animate() {
        if (!this.isRunning) return;
        
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.startTime) * this.settings.speed;
        
        this.clear();
        this.renderTextAnimation(deltaTime);
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    clear() {
        // 设置背景色
        this.ctx.fillStyle = this.settings.backgroundColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    renderTextAnimation(time) {
        const { animationType } = this.settings;
        
        switch (animationType) {
            case 'typewriter':
                this.renderTypewriter(time);
                break;
            case 'fade-in':
                this.renderFadeIn(time);
                break;
            case 'slide-in':
                this.renderSlideIn(time);
                break;
            case 'scale-up':
                this.renderScaleUp(time);
                break;
            case 'rainbow':
                this.renderRainbow(time);
                break;
            case 'bounce':
                this.renderBounce(time);
                break;
            default:
                this.renderTypewriter(time);
        }
    }
    
    setupTextStyle(additionalStyle = {}) {
        this.ctx.font = `${this.settings.fontSize}px ${this.settings.fontFamily}`;
        this.ctx.fillStyle = additionalStyle.color || this.settings.textColor;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        if (additionalStyle.globalAlpha !== undefined) {
            this.ctx.globalAlpha = additionalStyle.globalAlpha;
        } else {
            this.ctx.globalAlpha = 1;
        }
    }
    
    getTextPosition(lineIndex, totalLines) {
        const centerX = this.canvas.width / 2;
        const totalHeight = totalLines * this.settings.fontSize * this.settings.lineHeight;
        const startY = (this.canvas.height - totalHeight) / 2 + this.settings.fontSize / 2;
        const y = startY + lineIndex * this.settings.fontSize * this.settings.lineHeight;
        
        return { x: centerX, y };
    }
    
    renderTypewriter(time) {
        this.setupTextStyle();
        
        // 计算应该显示的字符数
        const charsPerSecond = 8; // 每秒显示8个字符
        const totalChars = this.textLines.join('').length;
        const targetCharIndex = Math.min(
            Math.floor((time / 1000) * charsPerSecond),
            totalChars
        );
        
        let charCount = 0;
        
        this.textLines.forEach((line, lineIndex) => {
            const { x, y } = this.getTextPosition(lineIndex, this.textLines.length);
            
            if (charCount + line.length <= targetCharIndex) {
                // 完整显示这一行
                this.ctx.fillText(line, x, y);
                charCount += line.length;
            } else if (charCount < targetCharIndex) {
                // 部分显示这一行
                const visibleChars = targetCharIndex - charCount;
                const partialLine = line.substring(0, visibleChars);
                this.ctx.fillText(partialLine, x, y);
                
                // 添加闪烁的光标
                if (Math.floor(time / 500) % 2 === 0) {
                    const cursorX = x + this.ctx.measureText(partialLine).width / 2 + 5;
                    this.ctx.fillRect(cursorX, y - this.settings.fontSize / 2, 2, this.settings.fontSize);
                }
                
                charCount = targetCharIndex;
            }
        });
    }
    
    renderFadeIn(time) {
        const duration = 3000; // 3秒淡入
        const lineDelay = 500; // 每行延迟500ms
        
        this.textLines.forEach((line, lineIndex) => {
            const lineStartTime = lineIndex * lineDelay;
            const lineTime = time - lineStartTime;
            
            if (lineTime > 0) {
                const opacity = Math.min(lineTime / duration, 1);
                const { x, y } = this.getTextPosition(lineIndex, this.textLines.length);
                
                this.setupTextStyle({ globalAlpha: opacity });
                this.ctx.fillText(line, x, y);
            }
        });
    }
    
    renderSlideIn(time) {
        const duration = 2000; // 2秒滑入
        const lineDelay = 300; // 每行延迟300ms
        
        this.textLines.forEach((line, lineIndex) => {
            const lineStartTime = lineIndex * lineDelay;
            const lineTime = time - lineStartTime;
            
            if (lineTime > 0) {
                const progress = Math.min(lineTime / duration, 1);
                const easeProgress = 1 - Math.pow(1 - progress, 3); // 缓动函数
                
                const { x, y } = this.getTextPosition(lineIndex, this.textLines.length);
                const offsetX = (1 - easeProgress) * this.canvas.width;
                
                this.setupTextStyle();
                this.ctx.fillText(line, x + offsetX, y);
            }
        });
    }
    
    renderScaleUp(time) {
        const duration = 2000; // 2秒缩放
        const lineDelay = 200; // 每行延迟200ms
        
        this.textLines.forEach((line, lineIndex) => {
            const lineStartTime = lineIndex * lineDelay;
            const lineTime = time - lineStartTime;
            
            if (lineTime > 0) {
                const progress = Math.min(lineTime / duration, 1);
                const scale = progress * progress; // 二次缓动
                
                const { x, y } = this.getTextPosition(lineIndex, this.textLines.length);
                
                this.ctx.save();
                this.ctx.translate(x, y);
                this.ctx.scale(scale, scale);
                
                this.setupTextStyle();
                this.ctx.fillText(line, 0, 0);
                
                this.ctx.restore();
            }
        });
    }
    
    renderRainbow(time) {
        this.textLines.forEach((line, lineIndex) => {
            const { x, y } = this.getTextPosition(lineIndex, this.textLines.length);
            
            // 为每个字符设置不同的颜色
            let charX = x - this.ctx.measureText(line).width / 2;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const hue = (time / 20 + i * 30 + lineIndex * 60) % 360;
                const color = `hsl(${hue}, 80%, 60%)`;
                
                this.setupTextStyle({ color });
                this.ctx.fillText(char, charX, y);
                
                charX += this.ctx.measureText(char).width;
            }
        });
    }
    
    renderBounce(time) {
        this.textLines.forEach((line, lineIndex) => {
            const { x, y } = this.getTextPosition(lineIndex, this.textLines.length);
            
            // 为每个字符添加弹跳效果
            let charX = x - this.ctx.measureText(line).width / 2;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const bounceTime = time + i * 100 + lineIndex * 200;
                const bounceY = Math.sin(bounceTime / 300) * 20;
                
                this.setupTextStyle();
                this.ctx.fillText(char, charX, y + bounceY);
                
                charX += this.ctx.measureText(char).width;
            }
        });
    }
    
    // 手动渲染一帧（用于录制）
    renderFrame(timeInSeconds) {
        const time = timeInSeconds * 1000 * this.settings.speed;
        this.clear();
        this.renderTextAnimation(time);
    }
}

// 导出类
window.TextAnimations = TextAnimations;
