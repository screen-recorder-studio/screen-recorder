// Canvas 动画系统
class CanvasAnimations {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.animationId = null;
        this.isRunning = false;
        this.startTime = 0;
        this.speed = 1.0;
        this.currentAnimation = 'bouncing-ball';
        
        // 动画状态
        this.animationState = {
            ball: { x: 50, y: 50, vx: 3, vy: 2, radius: 20 },
            square: { angle: 0, size: 60 },
            wave: { phase: 0, amplitude: 100 },
            particles: []
        };
        
        this.initParticles();
    }
    
    initParticles() {
        this.animationState.particles = [];
        for (let i = 0; i < 50; i++) {
            this.animationState.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                size: Math.random() * 5 + 2,
                color: `hsl(${Math.random() * 360}, 70%, 60%)`,
                life: 1.0
            });
        }
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.startTime = performance.now();
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
    
    setAnimationType(type) {
        this.currentAnimation = type;
        if (type === 'particle-system') {
            this.initParticles();
        }
    }
    
    setSpeed(speed) {
        this.speed = speed;
    }
    
    animate() {
        if (!this.isRunning) return;
        
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.startTime) * this.speed;
        
        this.clear();
        
        switch (this.currentAnimation) {
            case 'bouncing-ball':
                this.animateBouncingBall(deltaTime);
                break;
            case 'rotating-square':
                this.animateRotatingSquare(deltaTime);
                break;
            case 'wave-pattern':
                this.animateWavePattern(deltaTime);
                break;
            case 'particle-system':
                this.animateParticleSystem(deltaTime);
                break;
        }
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    clear() {
        // 创建渐变背景
        const gradient = this.ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(0.5, '#16213e');
        gradient.addColorStop(1, '#0f3460');
        
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    animateBouncingBall(time) {
        const ball = this.animationState.ball;
        
        // 更新位置
        ball.x += ball.vx;
        ball.y += ball.vy;
        
        // 边界碰撞检测
        if (ball.x + ball.radius > this.canvas.width || ball.x - ball.radius < 0) {
            ball.vx = -ball.vx;
        }
        if (ball.y + ball.radius > this.canvas.height || ball.y - ball.radius < 0) {
            ball.vy = -ball.vy;
        }
        
        // 确保球在边界内
        ball.x = Math.max(ball.radius, Math.min(this.canvas.width - ball.radius, ball.x));
        ball.y = Math.max(ball.radius, Math.min(this.canvas.height - ball.radius, ball.y));
        
        // 绘制球的轨迹
        this.ctx.globalAlpha = 0.1;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(ball.x, ball.y, ball.radius + 10, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 绘制球
        this.ctx.globalAlpha = 1.0;
        const ballGradient = this.ctx.createRadialGradient(
            ball.x - 5, ball.y - 5, 0,
            ball.x, ball.y, ball.radius
        );
        ballGradient.addColorStop(0, '#ff6b6b');
        ballGradient.addColorStop(1, '#ee5a24');
        
        this.ctx.fillStyle = ballGradient;
        this.ctx.beginPath();
        this.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 添加高光
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.beginPath();
        this.ctx.arc(ball.x - 5, ball.y - 5, ball.radius * 0.3, 0, Math.PI * 2);
        this.ctx.fill();
    }
    
    animateRotatingSquare(time) {
        const square = this.animationState.square;
        square.angle += 0.02;
        
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        
        this.ctx.save();
        this.ctx.translate(centerX, centerY);
        this.ctx.rotate(square.angle);
        
        // 绘制多个旋转的方块
        for (let i = 0; i < 5; i++) {
            const size = square.size + i * 20;
            const alpha = 1 - (i * 0.15);
            
            this.ctx.globalAlpha = alpha;
            this.ctx.fillStyle = `hsl(${(time * 0.1 + i * 60) % 360}, 70%, 60%)`;
            this.ctx.fillRect(-size / 2, -size / 2, size, size);
            
            this.ctx.rotate(0.1);
        }
        
        this.ctx.restore();
    }
    
    animateWavePattern(time) {
        const wave = this.animationState.wave;
        wave.phase += 0.05;
        
        this.ctx.strokeStyle = '#4ecdc4';
        this.ctx.lineWidth = 3;
        
        // 绘制多条波浪
        for (let waveIndex = 0; waveIndex < 5; waveIndex++) {
            this.ctx.beginPath();
            this.ctx.globalAlpha = 1 - (waveIndex * 0.15);
            
            const offsetY = this.canvas.height / 2 + waveIndex * 30;
            const frequency = 0.02 + waveIndex * 0.005;
            const phaseOffset = waveIndex * Math.PI / 3;
            
            for (let x = 0; x <= this.canvas.width; x += 2) {
                const y = offsetY + Math.sin(x * frequency + wave.phase + phaseOffset) * wave.amplitude;
                
                if (x === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }
            
            this.ctx.strokeStyle = `hsl(${(180 + waveIndex * 30) % 360}, 70%, 60%)`;
            this.ctx.stroke();
        }
    }
    
    animateParticleSystem(time) {
        const particles = this.animationState.particles;
        
        particles.forEach((particle, index) => {
            // 更新粒子位置
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= 0.005;
            
            // 边界处理 - 让粒子从另一边出现
            if (particle.x < 0) particle.x = this.canvas.width;
            if (particle.x > this.canvas.width) particle.x = 0;
            if (particle.y < 0) particle.y = this.canvas.height;
            if (particle.y > this.canvas.height) particle.y = 0;
            
            // 重生粒子
            if (particle.life <= 0) {
                particle.x = Math.random() * this.canvas.width;
                particle.y = Math.random() * this.canvas.height;
                particle.vx = (Math.random() - 0.5) * 4;
                particle.vy = (Math.random() - 0.5) * 4;
                particle.life = 1.0;
                particle.color = `hsl(${Math.random() * 360}, 70%, 60%)`;
            }
            
            // 绘制粒子
            this.ctx.globalAlpha = particle.life;
            this.ctx.fillStyle = particle.color;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.ctx.fill();
            
            // 绘制粒子连线
            particles.forEach((otherParticle, otherIndex) => {
                if (index !== otherIndex) {
                    const dx = particle.x - otherParticle.x;
                    const dy = particle.y - otherParticle.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    if (distance < 100) {
                        this.ctx.globalAlpha = (1 - distance / 100) * 0.3 * particle.life;
                        this.ctx.strokeStyle = particle.color;
                        this.ctx.lineWidth = 1;
                        this.ctx.beginPath();
                        this.ctx.moveTo(particle.x, particle.y);
                        this.ctx.lineTo(otherParticle.x, otherParticle.y);
                        this.ctx.stroke();
                    }
                }
            });
        });
        
        this.ctx.globalAlpha = 1.0;
    }
    
    // 获取当前帧作为 ImageData
    getCurrentFrame() {
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }
    
    // 手动渲染一帧（用于录制）
    renderFrame(timeInSeconds) {
        const time = timeInSeconds * 1000 * this.speed;
        this.clear();
        
        switch (this.currentAnimation) {
            case 'bouncing-ball':
                this.animateBouncingBall(time);
                break;
            case 'rotating-square':
                this.animateRotatingSquare(time);
                break;
            case 'wave-pattern':
                this.animateWavePattern(time);
                break;
            case 'particle-system':
                this.animateParticleSystem(time);
                break;
        }
    }
}

// 导出类
window.CanvasAnimations = CanvasAnimations;
