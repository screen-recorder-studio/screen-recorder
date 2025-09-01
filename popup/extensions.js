// Video Preview Extensions for PopupController
// This file adds video preview and editing capabilities to the popup

(function() {
  'use strict';
  
  console.log('[Extensions] Loading video preview extensions...');
  
  let retryCount = 0;
  const maxRetries = 50;
  
  function initializeExtensions() {
    retryCount++;
    
    // Check if PopupController is available
    if (typeof window.PopupController === 'undefined') {
      console.log(`[Extensions] Waiting for PopupController... (attempt ${retryCount}/${maxRetries})`);
      if (retryCount < maxRetries) {
        setTimeout(initializeExtensions, 100);
      } else {
        console.error('[Extensions] Failed to find PopupController after maximum retries');
      }
      return;
    }
    
    console.log('[Extensions] PopupController found, adding extension methods...');
    
    // Add loadVideoPreview method
    PopupController.prototype.loadVideoPreview = function() {
      console.log('[Extensions] loadVideoPreview called');
      
      if (!this.state.recordedVideo) {
        console.warn('[Extensions] No recorded video to preview');
        return;
      }
      
      if (!this.elements.videoPreview) {
        console.warn('[Extensions] Video preview element not found');
        return;
      }
      
      try {
        // Create object URL for the video blob
        const videoUrl = URL.createObjectURL(this.state.recordedVideo);
        console.log('[Extensions] Created video URL:', videoUrl);
        
        // Show video preview section
        const previewSection = document.querySelector('.video-preview-section');
        if (previewSection) {
          previewSection.style.display = 'block';
        }
        
        // Setup video element
        const video = this.elements.videoPreview;
        video.style.display = 'block';
        
        // Hide canvas if present
        if (this.elements.previewCanvas) {
          this.elements.previewCanvas.style.display = 'none';
        }
        
        // Set up event handlers
        video.onloadedmetadata = function() {
          console.log('[Extensions] Video metadata loaded:', {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight
          });
          
          // Try to play
          video.play().catch(function(err) {
            console.log('[Extensions] Auto-play prevented:', err);
            // Show first frame
            video.currentTime = 0.1;
          });
        };
        
        video.onerror = function(err) {
          console.error('[Extensions] Video load error:', err);
        };
        
        // Set source and load
        video.src = videoUrl;
        video.load();
        
        console.log('[Extensions] Video loading initiated');
        
        // Clean up URL after 30 seconds
        setTimeout(function() {
          URL.revokeObjectURL(videoUrl);
          console.log('[Extensions] Video URL cleaned up');
        }, 30000);
        
      } catch (error) {
        console.error('[Extensions] Error loading video preview:', error);
      }
    };
    
    // Add selectPadding method
    PopupController.prototype.selectPadding = function(selectedOption) {
      if (!this.elements.paddingOptions) return;
      
      this.elements.paddingOptions.forEach(function(option) {
        option.classList.remove('active');
      });
      
      selectedOption.classList.add('active');
      this.settings.padding = parseInt(selectedOption.dataset.padding);
      
      if (this.updateSettingsInfo) {
        this.updateSettingsInfo();
      }
      
      console.log('[Extensions] Padding selected:', this.settings.padding);
    };
    
    // Add selectSize method
    PopupController.prototype.selectSize = function(selectedOption) {
      if (!this.elements.sizeOptions) return;
      
      this.elements.sizeOptions.forEach(function(option) {
        option.classList.remove('active');
      });
      
      selectedOption.classList.add('active');
      this.settings.outputRatio = selectedOption.dataset.ratio;
      
      // Show/hide custom size input
      if (this.elements.customSizeInput) {
        if (this.settings.outputRatio === 'custom') {
          this.elements.customSizeInput.classList.remove('hidden');
        } else {
          this.elements.customSizeInput.classList.add('hidden');
        }
      }
      
      if (this.updateSettingsInfo) {
        this.updateSettingsInfo();
      }
      
      console.log('[Extensions] Size ratio selected:', this.settings.outputRatio);
    };
    
    // Add updateSettingsInfo method
    PopupController.prototype.updateSettingsInfo = function() {
      if (!this.elements.selectedSettings) return;
      
      const paddingText = 'Padding: ' + this.settings.padding + 'px';
      let sizeText;
      
      if (this.settings.outputRatio === 'custom') {
        sizeText = 'Size: ' + this.settings.customWidth + '×' + this.settings.customHeight;
      } else {
        sizeText = 'Ratio: ' + this.settings.outputRatio;
      }
      
      this.elements.selectedSettings.textContent = paddingText + ' | ' + sizeText;
    };
    
    // Add calculateOutputSize method
    PopupController.prototype.calculateOutputSize = function() {
      let width, height;
      
      if (this.settings.outputRatio === 'custom') {
        width = this.settings.customWidth || 1920;
        height = this.settings.customHeight || 1080;
      } else {
        const ratios = {
          '16:9': { w: 1920, h: 1080 },
          '1:1': { w: 1080, h: 1080 },
          '9:16': { w: 1080, h: 1920 },
          '4:5': { w: 1080, h: 1350 }
        };
        
        const ratio = ratios[this.settings.outputRatio] || ratios['16:9'];
        width = ratio.w;
        height = ratio.h;
      }
      
      return {
        originalWidth: width,
        originalHeight: height,
        width: Math.floor(width * 0.2),
        height: Math.floor(height * 0.2)
      };
    };
    
    // Mark extensions as loaded
    window.videoPreviewExtensionsLoaded = true;
    
    console.log('[Extensions] All extension methods added successfully');
    console.log('[Extensions] Available methods:', Object.getOwnPropertyNames(PopupController.prototype).filter(function(m) {
      return ['loadVideoPreview', 'selectPadding', 'selectSize', 'updateSettingsInfo', 'calculateOutputSize'].includes(m);
    }));
    
    // If popupController instance exists and has video, load preview
    if (window.popupController && window.popupController.state && window.popupController.state.recordedVideo) {
      console.log('[Extensions] Found existing video, loading preview...');
      setTimeout(function() {
        if (window.popupController.loadVideoPreview) {
          window.popupController.loadVideoPreview();
        }
      }, 500);
    }
  }
  
  // Start initialization
  initializeExtensions();
  
})();
