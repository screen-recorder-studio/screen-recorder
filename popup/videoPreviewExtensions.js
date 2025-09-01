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
      
      // 获取视频尺寸
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      
      if (!videoWidth || !videoHeight) {
        console.error('[updateRealtimePreview] Invalid video dimensions');
        return;
      }
      
      console.log('[updateRealtimePreview] Video dimensions:', videoWidth, 'x', videoHeight);
      console.log('[updateRealtimePreview] Padding:', padding);
      console.log('[updateRealtimePreview] Background color:', backgroundColor);
      
      // 计算canvas尺寸（视频尺寸 + padding）
      const canvasWidth = videoWidth + padding * 2;
      const canvasHeight = videoHeight + padding * 2;
      
      // 设置canvas尺寸
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      
      // 调整canvas显示大小以适应容器
      const containerWidth = canvas.parentElement.offsetWidth;
      const scale = containerWidth / canvasWidth;
      canvas.style.width = containerWidth + 'px';
      canvas.style.height = (canvasHeight * scale) + 'px';
      
      // 绘制背景
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      
      // 绘制视频帧（居中）
      try {
        ctx.drawImage(video, padding, padding, videoWidth, videoHeight);
        console.log('[updateRealtimePreview] Preview updated successfully');
      } catch (error) {
        console.error('[updateRealtimePreview] Error drawing video:', error);
        // 如果绘制失败，显示占位符
        ctx.fillStyle = '#333333';
        ctx.fillRect(padding, padding, videoWidth, videoHeight);
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
