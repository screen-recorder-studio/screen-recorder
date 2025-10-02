/**
 * gif.js 使用示例和最佳实践
 * 基于 Context7 文档和实际测试经验
 */

// ==========================================
// 1. 基础示例 - 最简单的 GIF 生成
// ==========================================
function basicExample() {
    const gif = new GIF({
        workers: 2,
        quality: 10
    });

    // 添加 Canvas 元素作为帧
    gif.addFrame(canvasElement, {
        delay: 200  // 200ms 延迟
    });

    // 监听完成事件
    gif.on('finished', function(blob) {
        // 创建下载链接
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = url;
        document.body.appendChild(img);
    });

    // 开始渲染
    gif.render();
}

// ==========================================
// 2. 视频转 GIF - 完整示例
// ==========================================
async function videoToGif(videoElement, options = {}) {
    const defaults = {
        quality: 10,
        workers: 4,
        frameRate: 10,
        duration: 3,
        startTime: 0,
        scale: 1
    };
    
    const settings = { ...defaults, ...options };
    
    // 创建临时 Canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    canvas.width = videoElement.videoWidth * settings.scale;
    canvas.height = videoElement.videoHeight * settings.scale;
    
    // 初始化 GIF 编码器
    const gif = new GIF({
        workers: settings.workers,
        quality: settings.quality,
        width: canvas.width,
        height: canvas.height
    });
    
    // 计算帧数
    const frameCount = settings.duration * settings.frameRate;
    const frameDelay = 1000 / settings.frameRate;
    
    // 逐帧捕获
    for (let i = 0; i < frameCount; i++) {
        // 设置视频时间
        videoElement.currentTime = settings.startTime + (i / settings.frameRate);
        
        // 等待 seek 完成
        await new Promise(resolve => {
            videoElement.addEventListener('seeked', resolve, { once: true });
        });
        
        // 绘制到 Canvas
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        
        // 添加帧
        gif.addFrame(ctx, {
            copy: true,
            delay: frameDelay
        });
    }
    
    // 返回 Promise
    return new Promise((resolve) => {
        gif.on('finished', resolve);
        gif.render();
    });
}

// ==========================================
// 3. 高质量 GIF - 使用抖动算法
// ==========================================
function highQualityGif() {
    const gif = new GIF({
        workers: 4,
        quality: 1,  // 最高质量
        width: 800,
        height: 600,
        dither: 'FloydSteinberg',  // 使用 Floyd-Steinberg 抖动
        repeat: 0,  // 永远循环
        background: '#ffffff'
    });
    
    // 添加帧...
    return gif;
}

// ==========================================
// 4. 透明 GIF - 设置透明色
// ==========================================
function transparentGif() {
    const gif = new GIF({
        workers: 2,
        quality: 10,
        transparent: 0x00FF00,  // 绿色将被设为透明
        background: '#ffffff'   // 背景填充白色
    });
    
    // 在添加帧前，确保绿色区域是纯绿色 (#00FF00)
    // 这些区域在最终 GIF 中将是透明的
    
    return gif;
}

// ==========================================
// 5. 优化文件大小 - 小文件策略
// ==========================================
function optimizedForSize() {
    const gif = new GIF({
        workers: 2,
        quality: 20,  // 降低质量
        width: 320,   // 缩小尺寸
        height: 240,
        dither: false  // 不使用抖动
    });
    
    // 使用较长的帧延迟，减少总帧数
    gif.addFrame(canvas, {
        delay: 500,  // 500ms，即 2 FPS
        copy: true
    });
    
    return gif;
}

// ==========================================
// 6. 流畅动画 - 高帧率设置
// ==========================================
function smoothAnimation() {
    const gif = new GIF({
        workers: 8,  // 更多工作线程
        quality: 5,  // 良好质量
        width: 640,
        height: 480,
        dither: 'Atkinson'  // Atkinson 抖动，平衡质量和性能
    });
    
    // 30 FPS 动画
    const fps = 30;
    const frameDelay = 1000 / fps;
    
    // 添加多帧
    for (let i = 0; i < 90; i++) {  // 3 秒，30 FPS = 90 帧
        gif.addFrame(canvas, {
            delay: frameDelay,
            copy: true,
            dispose: 2  // 恢复背景，适合动画
        });
    }
    
    return gif;
}

// ==========================================
// 7. 进度监控 - 完整的用户反馈
// ==========================================
function gifWithProgress() {
    const gif = new GIF({
        workers: 4,
        quality: 10,
        debug: true  // 启用调试输出
    });
    
    // 进度事件
    gif.on('progress', function(progress) {
        // progress 是 0 到 1 之间的数值
        const percent = Math.round(progress * 100);
        console.log(`渲染进度: ${percent}%`);
        
        // 更新 UI
        updateProgressBar(percent);
    });
    
    // 完成事件
    gif.on('finished', function(blob, data) {
        console.log('GIF 生成完成！');
        console.log('文件大小:', blob.size, 'bytes');
        console.log('渲染数据:', data);
        
        // 显示结果
        displayResult(blob);
    });
    
    // 错误处理
    gif.on('error', function(error) {
        console.error('GIF 生成错误:', error);
    });
    
    return gif;
}

// ==========================================
// 8. 批量处理 - 多个 GIF 并行生成
// ==========================================
async function batchProcessGifs(sources) {
    const gifs = sources.map(source => {
        const gif = new GIF({
            workers: 2,  // 每个 GIF 使用较少的工作线程
            quality: 10,
            width: source.width,
            height: source.height
        });
        
        // 添加源的帧
        source.frames.forEach(frame => {
            gif.addFrame(frame, { delay: 100, copy: true });
        });
        
        return new Promise(resolve => {
            gif.on('finished', blob => {
                resolve({ name: source.name, blob });
            });
            gif.render();
        });
    });
    
    // 并行处理所有 GIF
    const results = await Promise.all(gifs);
    return results;
}

// ==========================================
// 9. 自适应质量 - 根据内容调整参数
// ==========================================
function adaptiveQualityGif(analysisData) {
    let quality, dither;
    
    // 根据内容复杂度选择参数
    if (analysisData.colorCount > 1000) {
        // 颜色丰富，使用抖动
        quality = 5;
        dither = 'FloydSteinberg';
    } else if (analysisData.hasGradients) {
        // 有渐变，使用中等质量
        quality = 10;
        dither = 'Atkinson';
    } else {
        // 简单图像，可以用较低质量
        quality = 15;
        dither = false;
    }
    
    return new GIF({
        workers: 4,
        quality: quality,
        dither: dither,
        width: analysisData.width,
        height: analysisData.height
    });
}

// ==========================================
// 10. 内存优化 - 处理大型 GIF
// ==========================================
async function memoryOptimizedGif(videoElement, settings) {
    const gif = new GIF({
        workers: 2,  // 限制工作线程数
        quality: 10,
        width: settings.width,
        height: settings.height
    });
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = settings.width;
    canvas.height = settings.height;
    
    // 分批处理帧，避免一次性占用太多内存
    const batchSize = 10;
    const totalFrames = settings.frameCount;
    
    for (let batch = 0; batch < totalFrames; batch += batchSize) {
        const batchEnd = Math.min(batch + batchSize, totalFrames);
        
        for (let i = batch; i < batchEnd; i++) {
            videoElement.currentTime = i * settings.frameInterval;
            await new Promise(r => videoElement.addEventListener('seeked', r, { once: true }));
            
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            gif.addFrame(ctx, {
                copy: true,
                delay: settings.frameDelay,
                dispose: 2  // 释放前一帧内存
            });
        }
        
        // 给浏览器时间进行垃圾回收
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return new Promise(resolve => {
        gif.on('finished', resolve);
        gif.render();
    });
}

// ==========================================
// 工具函数
// ==========================================

function updateProgressBar(percent) {
    const bar = document.getElementById('progress-bar');
    if (bar) {
        bar.style.width = percent + '%';
        bar.textContent = percent + '%';
    }
}

function displayResult(blob) {
    const url = URL.createObjectURL(blob);
    const img = document.getElementById('result-image');
    if (img) {
        img.src = url;
        img.style.display = 'block';
    }
}

// 分析图像内容，用于自适应质量
function analyzeContent(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    const colors = new Set();
    let hasGradients = false;
    
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // 简化颜色到 5 位精度
        const color = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
        colors.add(color);
        
        // 检测渐变（简化版）
        if (i > 4) {
            const diff = Math.abs(r - data[i - 4]) + 
                        Math.abs(g - data[i - 3]) + 
                        Math.abs(b - data[i - 2]);
            if (diff > 0 && diff < 30) {
                hasGradients = true;
            }
        }
    }
    
    return {
        colorCount: colors.size,
        hasGradients: hasGradients,
        width: canvas.width,
        height: canvas.height
    };
}

// 导出所有函数
export {
    basicExample,
    videoToGif,
    highQualityGif,
    transparentGif,
    optimizedForSize,
    smoothAnimation,
    gifWithProgress,
    batchProcessGifs,
    adaptiveQualityGif,
    memoryOptimizedGif,
    analyzeContent
};