// Video Processor Web Worker
// 处理视频背景合成的后台线程

// Worker 全局作用域中的消息处理
self.addEventListener('message', async (e) => {
  const { action, data } = e.data;
  
  console.log('[Worker] Received action:', action);
  
  switch (action) {
    case 'processVideo':
      await processVideoWithBackground(data);
      break;
      
    case 'generatePreview':
      await generatePreviewFrame(data);
      break;
      
    default:
      self.postMessage({
        error: 'Unknown action: ' + action
      });
  }
});

// 处理视频背景合成
async function processVideoWithBackground(data) {
  try {
    const { videoBlob, config } = data;
    
    // 发送进度更新
    self.postMessage({
      type: 'progress',
      progress: 10,
      message: '初始化处理器...'
    });
    
    // 创建离屏画布进行处理
    const canvas = new OffscreenCanvas(1920, 1080);
    const ctx = canvas.getContext('2d');
    
    // 加载视频
    self.postMessage({
      type: 'progress',
      progress: 20,
      message: '加载视频数据...'
    });
    
    // 使用 VideoDecoder API 处理视频帧
    const processedFrames = await processVideoFrames(videoBlob, config, canvas, ctx);
    
    self.postMessage({
      type: 'progress',
      progress: 80,
      message: '编码新视频...'
    });
    
    // 编码处理后的帧为新视频
    const processedBlob = await encodeFramesToVideo(processedFrames, config);
    
    self.postMessage({
      type: 'progress',
      progress: 100,
      message: '处理完成'
    });
    
    // 返回处理后的视频
    self.postMessage({
      type: 'complete',
      blob: processedBlob,
      config: config
    });
    
  } catch (error) {
    console.error('[Worker] Processing error:', error);
    self.postMessage({
      type: 'error',
      error: error.message || '视频处理失败'
    });
  }
}

// 处理视频帧
async function processVideoFrames(videoBlob, config, canvas, ctx) {
  return new Promise((resolve, reject) => {
    const frames = [];
    
    // 模拟帧处理（实际实现需要使用 VideoDecoder API）
    // 这里提供基础框架
    
    try {
      // 设置画布尺寸
      const padding = config.padding || 60;
      const backgroundColor = config.backgroundColor || '#ffffff';
      
      // 获取视频信息
      const videoInfo = {
        width: config.videoWidth || 1280,
        height: config.videoHeight || 720
      };
      
      // 计算输出尺寸
      canvas.width = videoInfo.width + padding * 2;
      canvas.height = videoInfo.height + padding * 2;
      
      // 处理每一帧
      // 注意：这里简化了处理，实际需要解码视频帧
      for (let i = 0; i < 30; i++) { // 模拟30帧
        // 清空画布
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 绘制视频帧（简化版）
        // 实际需要从视频解码器获取帧数据
        
        // 添加处理后的帧
        frames.push({
          timestamp: i * 33.33, // 30fps
          data: ctx.getImageData(0, 0, canvas.width, canvas.height)
        });
        
        // 更新进度
        const progress = 20 + (i / 30) * 60;
        self.postMessage({
          type: 'progress',
          progress: progress,
          message: `处理帧 ${i + 1}/30...`
        });
      }
      
      resolve(frames);
    } catch (error) {
      reject(error);
    }
  });
}

// 编码帧为视频
async function encodeFramesToVideo(frames, config) {
  // 这里需要使用 VideoEncoder API 或其他编码方案
  // 返回一个 Blob
  
  // 模拟返回
  return new Blob(['processed video data'], { type: 'video/webm' });
}

// 生成预览帧
async function generatePreviewFrame(data) {
  try {
    const { videoFrame, config } = data;
    
    // 创建离屏画布
    const padding = config.padding || 60;
    const backgroundColor = config.backgroundColor || '#ffffff';
    
    const canvas = new OffscreenCanvas(
      config.canvasWidth || 1920,
      config.canvasHeight || 1080
    );
    const ctx = canvas.getContext('2d');
    
    // 填充背景
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 计算视频位置（居中）
    const videoX = padding;
    const videoY = padding;
    const videoWidth = canvas.width - padding * 2;
    const videoHeight = canvas.height - padding * 2;
    
    // 绘制视频帧（如果有）
    if (videoFrame && videoFrame.imageData) {
      // 创建临时画布来绘制视频帧
      const tempCanvas = new OffscreenCanvas(videoWidth, videoHeight);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(videoFrame.imageData, 0, 0);
      
      // 绘制到主画布
      ctx.drawImage(tempCanvas, videoX, videoY, videoWidth, videoHeight);
    } else {
      // 绘制占位符
      ctx.fillStyle = '#333333';
      ctx.fillRect(videoX, videoY, videoWidth, videoHeight);
      
      // 添加文字
      ctx.fillStyle = '#ffffff';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('视频预览', canvas.width / 2, canvas.height / 2);
    }
    
    // 获取图像数据
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // 转换为 Blob
    const blob = await canvas.convertToBlob({
      type: 'image/png',
      quality: 0.9
    });
    
    self.postMessage({
      type: 'preview',
      imageData: imageData,
      blob: blob,
      dimensions: {
        width: canvas.width,
        height: canvas.height
      }
    });
    
  } catch (error) {
    console.error('[Worker] Preview generation error:', error);
    self.postMessage({
      type: 'error',
      error: error.message || '预览生成失败'
    });
  }
}

console.log('[Worker] Video processor worker initialized');
