// Format Selector UI Component
// 格式选择器界面组件

class FormatSelector {
  constructor(container, options = {}) {
    this.container = container;
    this.selectedFormat = options.defaultFormat || 'webm';
    this.onFormatChange = options.onFormatChange || (() => {});
    this.onExport = options.onExport || (() => {});
    
    this.formats = {
      webm: {
        name: 'WebM',
        icon: '🎬',
        description: '原始格式，最佳质量',
        options: {
          quality: ['high', 'medium', 'low'],
          compress: true
        }
      },
      mp4: {
        name: 'MP4',
        icon: '📹',
        description: '通用格式，兼容性好',
        options: {
          codec: ['h264', 'h265'],
          preset: ['fast', 'medium', 'slow'],
          quality: ['high', 'medium', 'low']
        }
      },
      gif: {
        name: 'GIF',
        icon: '🎞️',
        description: '动图格式，易于分享',
        options: {
          size: [480, 360, 240],
          fps: [10, 15, 5],
          quality: { min: 1, max: 30, default: 10 }
        }
      }
    };
    
    this.currentOptions = this.getDefaultOptions();
    this.init();
  }

  // 初始化
  init() {
    this.render();
    this.attachEventListeners();
  }

  // 渲染界面
  render() {
    const html = `
      <div class="format-selector-wrapper">
        <!-- 格式选择标题 -->
        <div class="format-selector-header">
          <h3>选择导出格式</h3>
          <button class="close-btn" id="format-close-btn">✕</button>
        </div>
        
        <!-- 格式选项卡 -->
        <div class="format-tabs">
          ${Object.entries(this.formats).map(([key, format]) => `
            <div class="format-tab ${key === this.selectedFormat ? 'active' : ''}" 
                 data-format="${key}">
              <span class="format-icon">${format.icon}</span>
              <div class="format-info">
                <span class="format-name">${format.name}</span>
                <span class="format-desc">${format.description}</span>
              </div>
            </div>
          `).join('')}
        </div>
        
        <!-- 格式特定选项 -->
        <div class="format-options-panel">
          ${this.renderFormatOptions()}
        </div>
        
        <!-- 文件信息预览 -->
        <div class="export-preview">
          <div class="preview-item">
            <span class="preview-label">预估大小:</span>
            <span class="preview-value" id="estimated-size">计算中...</span>
          </div>
          <div class="preview-item">
            <span class="preview-label">导出时间:</span>
            <span class="preview-value" id="estimated-time">约 5-10 秒</span>
          </div>
        </div>
        
        <!-- 操作按钮 -->
        <div class="format-actions">
          <button class="btn btn-secondary" id="format-cancel-btn">取消</button>
          <button class="btn btn-primary" id="format-export-btn">
            <span class="btn-icon">⬇</span>
            <span>导出${this.formats[this.selectedFormat].name}</span>
          </button>
        </div>
        
        <!-- 进度条（初始隐藏） -->
        <div class="export-progress hidden" id="export-progress">
          <div class="progress-bar">
            <div class="progress-fill" id="export-progress-fill"></div>
          </div>
          <div class="progress-info">
            <span id="export-progress-text">准备导出...</span>
            <span id="export-progress-percent">0%</span>
          </div>
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
  }

  // 渲染格式选项
  renderFormatOptions() {
    const format = this.selectedFormat;
    const options = this.formats[format].options;
    
    let html = `<div class="format-options" data-format="${format}">`;
    
    switch (format) {
      case 'webm':
        html += `
          <div class="option-group">
            <label class="option-label">质量设置</label>
            <select class="option-select" id="webm-quality">
              <option value="high">高质量 (原始)</option>
              <option value="medium" selected>中等质量 (推荐)</option>
              <option value="low">低质量 (小文件)</option>
            </select>
          </div>
          <div class="option-group">
            <label class="option-checkbox">
              <input type="checkbox" id="webm-compress" checked>
              <span>启用智能压缩</span>
            </label>
          </div>
        `;
        break;
        
      case 'mp4':
        html += `
          <div class="option-group">
            <label class="option-label">编码器</label>
            <select class="option-select" id="mp4-codec">
              <option value="h264" selected>H.264 (兼容性最佳)</option>
              <option value="h265">H.265 (文件更小)</option>
            </select>
          </div>
          <div class="option-group">
            <label class="option-label">编码速度</label>
            <select class="option-select" id="mp4-preset">
              <option value="fast">快速 (质量较低)</option>
              <option value="medium" selected>平衡</option>
              <option value="slow">慢速 (质量最佳)</option>
            </select>
          </div>
          <div class="option-group">
            <label class="option-label">质量</label>
            <select class="option-select" id="mp4-quality">
              <option value="high">高质量</option>
              <option value="medium" selected>中等质量</option>
              <option value="low">低质量</option>
            </select>
          </div>
        `;
        break;
        
      case 'gif':
        html += `
          <div class="option-group">
            <label class="option-label">尺寸</label>
            <select class="option-select" id="gif-size">
              <option value="480" selected>480p (推荐)</option>
              <option value="360">360p (较小)</option>
              <option value="240">240p (最小)</option>
            </select>
          </div>
          <div class="option-group">
            <label class="option-label">帧率</label>
            <select class="option-select" id="gif-fps">
              <option value="10" selected>10 FPS (推荐)</option>
              <option value="15">15 FPS (流畅)</option>
              <option value="5">5 FPS (文件小)</option>
            </select>
          </div>
          <div class="option-group">
            <label class="option-label">质量</label>
            <div class="quality-slider">
              <input type="range" id="gif-quality" min="1" max="30" value="10">
              <span class="quality-value" id="gif-quality-value">10</span>
            </div>
          </div>
          <div class="option-group">
            <label class="option-label">最大时长</label>
            <select class="option-select" id="gif-max-duration">
              <option value="10">10秒</option>
              <option value="20">20秒</option>
              <option value="30" selected>30秒</option>
              <option value="60">60秒</option>
            </select>
          </div>
        `;
        break;
    }
    
    html += `</div>`;
    return html;
  }

  // 附加事件监听器
  attachEventListeners() {
    // 格式选项卡切换
    const tabs = this.container.querySelectorAll('.format-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const format = tab.dataset.format;
        this.selectFormat(format);
      });
    });
    
    // 导出按钮
    const exportBtn = this.container.querySelector('#format-export-btn');
    exportBtn?.addEventListener('click', () => {
      this.handleExport();
    });
    
    // 取消按钮
    const cancelBtn = this.container.querySelector('#format-cancel-btn');
    cancelBtn?.addEventListener('click', () => {
      this.close();
    });
    
    // 关闭按钮
    const closeBtn = this.container.querySelector('#format-close-btn');
    closeBtn?.addEventListener('click', () => {
      this.close();
    });
    
    // GIF 质量滑块
    if (this.selectedFormat === 'gif') {
      const qualitySlider = this.container.querySelector('#gif-quality');
      const qualityValue = this.container.querySelector('#gif-quality-value');
      
      qualitySlider?.addEventListener('input', (e) => {
        if (qualityValue) {
          qualityValue.textContent = e.target.value;
        }
      });
    }
    
    // 监听选项变化以更新预估
    this.container.querySelectorAll('select, input[type="checkbox"], input[type="range"]')
      .forEach(input => {
        input.addEventListener('change', () => {
          this.updateEstimates();
        });
      });
  }

  // 选择格式
  selectFormat(format) {
    this.selectedFormat = format;
    this.currentOptions = this.getDefaultOptions();
    
    // 更新 UI
    const tabs = this.container.querySelectorAll('.format-tab');
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.format === format);
    });
    
    // 更新选项面板
    const optionsPanel = this.container.querySelector('.format-options-panel');
    if (optionsPanel) {
      optionsPanel.innerHTML = this.renderFormatOptions();
      
      // 重新附加特定格式的事件监听器
      if (format === 'gif') {
        const qualitySlider = this.container.querySelector('#gif-quality');
        const qualityValue = this.container.querySelector('#gif-quality-value');
        
        qualitySlider?.addEventListener('input', (e) => {
          if (qualityValue) {
            qualityValue.textContent = e.target.value;
          }
        });
      }
    }
    
    // 更新导出按钮文本
    const exportBtn = this.container.querySelector('#format-export-btn span:last-child');
    if (exportBtn) {
      exportBtn.textContent = `导出${this.formats[format].name}`;
    }
    
    // 更新预估
    this.updateEstimates();
    
    // 触发回调
    this.onFormatChange(format);
  }

  // 获取默认选项
  getDefaultOptions() {
    const options = {};
    
    switch (this.selectedFormat) {
      case 'webm':
        options.quality = 'medium';
        options.compress = true;
        break;
      case 'mp4':
        options.codec = 'h264';
        options.preset = 'medium';
        options.quality = 'medium';
        break;
      case 'gif':
        options.size = 480;
        options.fps = 10;
        options.quality = 10;
        options.maxDuration = 30;
        break;
    }
    
    return options;
  }

  // 获取当前选项
  getCurrentOptions() {
    const options = {};
    
    switch (this.selectedFormat) {
      case 'webm':
        options.quality = this.container.querySelector('#webm-quality')?.value || 'medium';
        options.compress = this.container.querySelector('#webm-compress')?.checked || false;
        break;
      case 'mp4':
        options.codec = this.container.querySelector('#mp4-codec')?.value || 'h264';
        options.preset = this.container.querySelector('#mp4-preset')?.value || 'medium';
        options.quality = this.container.querySelector('#mp4-quality')?.value || 'medium';
        break;
      case 'gif':
        options.width = parseInt(this.container.querySelector('#gif-size')?.value || 480);
        options.height = Math.round(options.width * 9 / 16); // 假设 16:9 比例
        options.fps = parseInt(this.container.querySelector('#gif-fps')?.value || 10);
        options.quality = parseInt(this.container.querySelector('#gif-quality')?.value || 10);
        options.maxDuration = parseInt(this.container.querySelector('#gif-max-duration')?.value || 30);
        break;
    }
    
    return options;
  }

  // 更新预估
  updateEstimates() {
    const sizeElement = this.container.querySelector('#estimated-size');
    const timeElement = this.container.querySelector('#estimated-time');
    
    if (!sizeElement || !timeElement) return;
    
    // 这里应该根据实际视频大小和选项计算
    // 暂时使用模拟值
    const estimates = this.calculateEstimates();
    
    sizeElement.textContent = estimates.size;
    timeElement.textContent = estimates.time;
  }

  // 计算预估值
  calculateEstimates() {
    // TODO: 根据实际视频信息计算
    const format = this.selectedFormat;
    const options = this.getCurrentOptions();
    
    let sizeEstimate = '~10 MB';
    let timeEstimate = '约 5-10 秒';
    
    if (format === 'gif') {
      sizeEstimate = '~15-30 MB';
      timeEstimate = '约 10-20 秒';
    } else if (format === 'mp4') {
      sizeEstimate = '~8-12 MB';
      timeEstimate = '约 5-15 秒';
    }
    
    return {
      size: sizeEstimate,
      time: timeEstimate
    };
  }

  // 处理导出
  handleExport() {
    const format = this.selectedFormat;
    const options = this.getCurrentOptions();
    
    console.log('Exporting with format:', format, 'options:', options);
    
    // 显示进度条
    this.showProgress();
    
    // 触发导出回调
    this.onExport(format, options);
  }

  // 显示进度
  showProgress() {
    const progressSection = this.container.querySelector('#export-progress');
    if (progressSection) {
      progressSection.classList.remove('hidden');
    }
  }

  // 更新进度
  updateProgress(percent, message) {
    const progressFill = this.container.querySelector('#export-progress-fill');
    const progressText = this.container.querySelector('#export-progress-text');
    const progressPercent = this.container.querySelector('#export-progress-percent');
    
    if (progressFill) {
      progressFill.style.width = `${percent}%`;
    }
    if (progressText) {
      progressText.textContent = message || '处理中...';
    }
    if (progressPercent) {
      progressPercent.textContent = `${Math.round(percent)}%`;
    }
  }

  // 隐藏进度
  hideProgress() {
    const progressSection = this.container.querySelector('#export-progress');
    if (progressSection) {
      progressSection.classList.add('hidden');
    }
  }

  // 显示选择器
  show() {
    this.container.style.display = 'block';
  }

  // 关闭选择器
  close() {
    this.container.style.display = 'none';
    this.hideProgress();
  }

  // 设置视频信息（用于更准确的预估）
  setVideoInfo(info) {
    this.videoInfo = info;
    this.updateEstimates();
  }
}

// 导出为全局变量
window.FormatSelector = FormatSelector;
