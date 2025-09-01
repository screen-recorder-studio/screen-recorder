// Video Preview Extensions
// 扩展视频预览和实时更新功能

(function() {
  'use strict';
  
  console.log('[VideoPreviewExtensions] Initializing...');
  
  // 添加实时预览更新方法
  if (typeof PopupController !== 'undefined') {
    
    // 实时更新预览方法
    PopupController.prototype.updateRealtimePreview = function() {
      console.log('[updateRealtimePreview] Called with settings:', this.settings);
      
      if (!this.elements.previewCanvas || !this.elements.videoPreview) {
        console.warn('[updateRealtimePreview] Preview elements not found');
        return;
      }
      
      // 如果视频没有加载，不执行预览
      const video = this.elements.videoPreview;
      if (!video.src || video.readyState < 2) {
        console.warn('[updateRealtimePreview] Video not ready:', video.readyState);
        return;
      }
      
      // 显示canvas，隐藏video
      this.elements.previewCanvas.style.display = 'block';
      this.elements.videoPreview.style.display = 'none';
      
      const canvas = this.elements.previewCanvas;
      const ctx = canvas.getContext('2d');
      
      // 获取当前设置
      const padding = this.settings.padding || 60;
      const backgroundColor = this.settings.backgroundColor || '#ffffff';
      const outputRatio = this.settings.outputRatio || '16:9';
      
      // 获取原始视频尺寸
      const originalVideoWidth = video.videoWidth;
      const originalVideoHeight = video.videoHeight;
      
      if (!originalVideoWidth || !originalVideoHeight) {
        console.error('[updateRealtimePreview] Invalid video dimensions');
        return;
      }
      
      console.log('[updateRealtimePreview] Original video:', originalVideoWidth, 'x', originalVideoHeight);
      console.log('[updateRealtimePreview] Output ratio:', outputRatio);
      console.log('[updateRealtimePreview] Padding:', padding);
      console.log('[updateRealtimePreview] Background color:', backgroundColor);
      
      // 根据输出比例计算画布尺寸
      let canvasWidth, canvasHeight;
      let displayWidth, displayHeight;
      
      // 获取容器尺寸作为限制
      // 确保容器已经正确渲染，多次尝试获取宽度
      let containerWidth = canvas.parentElement ? canvas.parentElement.offsetWidth : 0;
      if (!containerWidth || containerWidth < 100) {
        // 如果容器宽度太小，尝试获取视频预览区域的宽度
        const previewSection = canvas.closest('.video-preview-section');
        if (previewSection) {
          containerWidth = previewSection.offsetWidth - 20; // 减去边框和内边距
        }
      }
      // 使用合理的默认值
      const maxWidth = containerWidth || 468;
      const maxHeight = 600; // 设置最大高度限制，避免9:16时过高
      
      if (outputRatio === 'custom') {
        // 使用自定义尺寸
        const customW = this.settings.customWidth || 1920;
        const customH = this.settings.customHeight || 1080;
        const customAspectRatio = customH / customW;
        
        // 根据容器限制计算显示尺寸
        if (customAspectRatio > maxHeight / maxWidth) {
          // 高度受限
          displayHeight = maxHeight;
          displayWidth = maxHeight / customAspectRatio;
        } else {
          // 宽度受限
          displayWidth = maxWidth;
          displayHeight = maxWidth * customAspectRatio;
        }
        
        // Canvas内部尺寸（2倍用于高清显示）
        canvasWidth = displayWidth * 2;
        canvasHeight = displayHeight * 2;
      } else {
        // 使用预定义比例
        const ratios = {
          '16:9': { w: 16, h: 9 },   // 使用比例而不是具体像素
          '1:1': { w: 1, h: 1 },
          '9:16': { w: 9, h: 16 },
          '4:5': { w: 4, h: 5 }
        };
        
        const targetRatio = ratios[outputRatio] || ratios['16:9'];
        const aspectRatio = targetRatio.h / targetRatio.w;
        
        // 计算在容器限制内的最大显示尺寸
        if (aspectRatio > maxHeight / maxWidth) {
          // 高度受限（如9:16竖屏）
          displayHeight = Math.min(maxHeight, maxWidth * aspectRatio);
          displayWidth = displayHeight / aspectRatio;
        } else {
          // 宽度受限（如16:9横屏）
          displayWidth = maxWidth;
          displayHeight = maxWidth * aspectRatio;
        }
        
        // Canvas内部尺寸（2倍用于高清显示）
        canvasWidth = Math.floor(displayWidth * 2);
        canvasHeight = Math.floor(displayHeight * 2);
      }
      
      // 设置canvas实际尺寸（内部分辨率）
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      
      // 设置canvas显示尺寸（CSS尺寸）
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      
      console.log('[updateRealtimePreview] Canvas internal size:', canvasWidth, 'x', canvasHeight);
      console.log('[updateRealtimePreview] Canvas display size:', displayWidth, 'x', displayHeight);
      
      // 清空画布并填充背景
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      
      // 计算视频在画布中的位置和大小
      // 考虑padding后的可用空间
      const availableWidth = canvasWidth - padding * 2;
      const availableHeight = canvasHeight - padding * 2;
      
      // 计算视频缩放以适应可用空间
      const videoAspectRatio = originalVideoWidth / originalVideoHeight;
      const targetAspectRatio = availableWidth / availableHeight;
      
      let videoWidth, videoHeight, videoX, videoY;
      
      if (videoAspectRatio > targetAspectRatio) {
        // 视频更宽，以宽度为准
        videoWidth = availableWidth;
        videoHeight = availableWidth / videoAspectRatio;
        videoX = padding;
        videoY = padding + (availableHeight - videoHeight) / 2;
      } else {
        // 视频更高，以高度为准
        videoHeight = availableHeight;
        videoWidth = availableHeight * videoAspectRatio;
        videoX = padding + (availableWidth - videoWidth) / 2;
        videoY = padding;
      }
      
      // 绘制视频帧
      try {
        ctx.drawImage(video, videoX, videoY, videoWidth, videoHeight);
        console.log('[updateRealtimePreview] Video drawn at:', videoX, videoY, videoWidth, 'x', videoHeight);
        console.log('[updateRealtimePreview] Canvas size:', canvasWidth, 'x', canvasHeight);
        console.log('[updateRealtimePreview] Preview updated successfully');
      } catch (error) {
        console.error('[updateRealtimePreview] Error drawing video:', error);
        // 如果绘制失败，显示占位符
        ctx.fillStyle = '#333333';
        ctx.fillRect(videoX, videoY, videoWidth, videoHeight);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('预览加载中...', canvasWidth / 2, canvasHeight / 2);
      }
      
      // 更新设置信息显示
      if (this.updateSettingsInfo) {
        this.updateSettingsInfo();
      }
    };
    
    // 加载视频预览
    PopupController.prototype.loadVideoPreview = function() {
      console.log('[loadVideoPreview] Loading video for preview...');
      
      if (!this.state.recordedVideo) {
        console.warn('[loadVideoPreview] No recorded video available');
        return;
      }
      
      const video = this.elements.videoPreview;
      const canvas = this.elements.previewCanvas;
      
      if (!video) {
        console.error('[loadVideoPreview] Video element not found');
        return;
      }
      
      // 创建视频URL
      const videoUrl = URL.createObjectURL(this.state.recordedVideo);
      
      // 设置视频源
      video.src = videoUrl;
      video.muted = true;
      video.loop = true;
      
      // 监听视频加载完成
      video.onloadedmetadata = () => {
        console.log('[loadVideoPreview] Video metadata loaded');
        console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
        
        // 视频加载完成后，立即更新预览
        this.updateRealtimePreview();
        
        // 尝试播放视频
        video.play().catch(err => {
          console.log('[loadVideoPreview] Auto-play prevented:', err);
          // 如果自动播放失败，至少显示第一帧
          video.currentTime = 0.1;
        });
      };
      
      video.oncanplay = () => {
        console.log('[loadVideoPreview] Video can play');
        // 确保预览更新
        if (!canvas.width) {
          this.updateRealtimePreview();
        }
      };
      
      video.onerror = (err) => {
        console.error('[loadVideoPreview] Video load error:', err);
      };
      
      // 清理URL（延迟以确保视频加载完成）
      setTimeout(() => {
        URL.revokeObjectURL(videoUrl);
      }, 30000);
    };
    
    // 切换预览显示模式
    PopupController.prototype.togglePreviewMode = function(mode = 'canvas') {
      if (mode === 'canvas') {
        if (this.elements.previewCanvas) {
          this.elements.previewCanvas.style.display = 'block';
        }
        if (this.elements.videoPreview) {
          this.elements.videoPreview.style.display = 'none';
        }
      } else {
        if (this.elements.previewCanvas) {
          this.elements.previewCanvas.style.display = 'none';
        }
        if (this.elements.videoPreview) {
          this.elements.videoPreview.style.display = 'block';
        }
      }
    };
    
    // 监听视频时间更新，定期刷新预览
    PopupController.prototype.startPreviewAnimation = function() {
      if (!this.elements.videoPreview) return;
      
      const video = this.elements.videoPreview;
      let lastUpdateTime = 0;
      
      video.ontimeupdate = () => {
        const currentTime = Date.now();
        // 每100ms更新一次预览
        if (currentTime - lastUpdateTime > 100) {
          this.updateRealtimePreview();
          lastUpdateTime = currentTime;
        }
      };
    };
    
    // 停止预览动画
    PopupController.prototype.stopPreviewAnimation = function() {
      if (this.elements.videoPreview) {
        this.elements.videoPreview.ontimeupdate = null;
      }
    };
    
    console.log('[VideoPreviewExtensions] Methods added successfully');
    console.log('[VideoPreviewExtensions] Available methods:', [
      'updateRealtimePreview',
      'loadVideoPreview', 
      'togglePreviewMode',
      'startPreviewAnimation',
      'stopPreviewAnimation'
    ]);
    
  } else {
    console.error('[VideoPreviewExtensions] PopupController not defined');
  }
  
  // 标记扩展已加载
  window.videoPreviewExtensionsLoaded = true;
  
})();
