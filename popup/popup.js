// SaaS Video Recorder - Popup Controller
// 管理扩展弹窗的用户界面和交互逻辑

class PopupController {
  constructor() {
    this.state = {
      isRecording: false,
      recordingStartTime: null,
      currentStep: 'idle', // 'idle' | 'recording' | 'processing' | 'complete'
      selectedBackground: null,
      recordedVideo: null,
      recordingDuration: 0,
      error: null
    };

    this.elements = {};
    this.recordingTimer = null;
    this.videoRecorder = new VideoRecorder();
    this.fileManager = new FileManager();
    this.backgroundProcessor = new BackgroundProcessor();
    this.init();
  }

  // 初始化界面和事件监听
  init() {
    this.initElements();
    this.bindEvents();
    this.updateUI();
    this.checkFirstTimeUser();
  }

  // 检查首次使用用户
  checkFirstTimeUser() {
    const isFirstTime = !localStorage.getItem('user-visited');
    if (isFirstTime) {
      localStorage.setItem('user-visited', 'true');
      // 延迟显示首次使用指导
      setTimeout(() => {
        this.showGuidance('first-time');
      }, 1000);
    }
  }

  // 获取DOM元素引用
  initElements() {
    console.log('Initializing elements...');
    this.elements = {
      // 录制控制
      startBtn: document.getElementById('start-btn'),
      stopBtn: document.getElementById('stop-btn'),
      statusText: document.getElementById('status-text'),
      recordingIndicator: document.getElementById('recording-indicator'),
      recordingTip: document.getElementById('recording-tip'),

      // 区域容器
      recordingSection: document.getElementById('recording-section'),
      backgroundSection: document.getElementById('background-section'),
      progressSection: document.getElementById('progress-section'),

      // 背景选择
      backgroundOptions: document.querySelectorAll('.bg-option'),
      applyBgBtn: document.getElementById('apply-bg-btn'),
      skipBgBtn: document.getElementById('skip-bg-btn'),
      selectedBgName: document.getElementById('selected-bg-name'),
      previewContainer: document.getElementById('preview-container'),

      // 进度显示
      progressFill: document.getElementById('progress-fill'),
      progressText: document.getElementById('progress-text')
    };
  }

  // 绑定事件监听器
  bindEvents() {
    console.log('Binding events, elements:', this.elements);
    console.log('Start button:', this.elements.startBtn);
    console.log('Stop button:', this.elements.stopBtn);
    
    // 录制控制按钮
    if (this.elements.startBtn) {
      this.elements.startBtn.addEventListener('click', () => this.startRecording());
      console.log('Start button event bound');
    } else {
      console.error('Start button not found!');
    }
    
    if (this.elements.stopBtn) {
      this.elements.stopBtn.addEventListener('click', () => this.stopRecording());
      console.log('Stop button event bound');
    } else {
      console.error('Stop button not found!');
    }
    
    // 在新页面打开录制器
    const openRecorderBtn = document.getElementById('open-recorder-btn');
    if (openRecorderBtn) {
      openRecorderBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('recorder.html') });
        window.close(); // 关闭popup
      });
    }

    // 背景选择
    this.elements.backgroundOptions.forEach(option => {
      option.addEventListener('click', (e) => this.selectBackground(e.target));
    });

    this.elements.applyBgBtn.addEventListener('click', () => this.applyBackground());
    this.elements.skipBgBtn.addEventListener('click', () => this.skipBackground());

    // 添加键盘导航支持
    document.addEventListener('keydown', (e) => this.handleKeyboardNavigation(e));
  }

  // 开始录制
  async startRecording() {
    try {
      // 清除之前的错误状态
      this.clearError();

      // 在录制初始化期间，保持在 idle 状态，这样按钮仍然可见
      // 只更新状态文本来显示进度
      if (this.elements.statusText) {
        this.elements.statusText.textContent = '正在请求录制权限...';
      }

      // 开始录制 - 这里只是启动录制流程，不代表录制已经开始
      await this.videoRecorder.startTabRecording();

      if (this.elements.statusText) {
        this.elements.statusText.textContent = '录制器初始化完成...';
      }
      
      // 立即检查录制状态
      const recordingState = this.videoRecorder.getRecordingState();
      console.log('Immediate recording state check:', recordingState);
      
      if (recordingState === 'recording') {
        console.log('Recording is active, updating UI immediately');
        this.onRecordingStarted();
      } else {
        console.log('Recording not yet active, setting up delayed check...');
        // 延迟检查
        setTimeout(() => {
          const delayedState = this.videoRecorder.getRecordingState();
          console.log('Delayed recording state check:', delayedState);
          if (delayedState === 'recording' && !this.state.isRecording) {
            console.log('Recording is now active but UI not updated, manually triggering update');
            this.onRecordingStarted();
          }
        }, 500);
      }

      console.log('Recording started successfully');

    } catch (error) {
      console.error('Failed to start recording:', error);
      this.handleError('录制启动失败: ' + error.message, error);
    }
  }

  // 停止录制
  async stopRecording() {
    try {
      // 停止计时器
      this.stopRecordingTimer();
      
      // 通知background script停止计时
      chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
        console.log('Background timer stopped:', response);
      });

      // 更新状态为处理中
      this.transitionToStep('processing', {
        isRecording: false
      });

      this.updateProgress(30, '正在停止录制...');

      // 停止录制并获取视频数据
      const videoBlob = await this.videoRecorder.stopRecording();

      this.updateProgress(70, '正在验证视频数据...');

      // 验证视频文件
      if (!this.validateRecordedVideo(videoBlob)) {
        throw new Error('录制的视频文件无效或损坏');
      }

      // 保存录制的视频
      this.setState({ recordedVideo: videoBlob });

      this.updateProgress(100, '录制完成');

      // 显示录制成功信息
      const duration = Math.floor(this.state.recordingDuration / 1000);
      const sizeInfo = this.fileManager.formatFileSize(videoBlob.size);
      this.showSuccessMessage(`录制完成！时长: ${duration}秒, 大小: ${sizeInfo}`);

      // 短暂延迟后显示背景选择界面
      setTimeout(() => {
        this.transitionToStep('complete');
        // 显示背景选择指导
        this.showGuidance('background-selection');
      }, 1000);

      console.log('Recording stopped successfully, video size:', videoBlob.size, 'bytes');

    } catch (error) {
      console.error('Failed to stop recording:', error);
      this.handleError('录制停止失败: ' + error.message, error);
    }
  }

  // 选择背景
  selectBackground(selectedOption) {
    // 移除其他选项的选中状态
    this.elements.backgroundOptions.forEach(option => {
      option.classList.remove('selected');
    });

    // 设置当前选项为选中状态
    selectedOption.classList.add('selected');

    // 更新状态
    this.state.selectedBackground = selectedOption.dataset.color;
    const backgroundName = selectedOption.dataset.name || '未知背景';

    // 更新预览
    this.updateBackgroundPreview(selectedOption.dataset.color);

    // 更新选中信息显示
    this.updateSelectedBackgroundInfo(backgroundName, selectedOption.dataset.color);

    // 启用应用背景按钮
    this.elements.applyBgBtn.disabled = false;

    console.log('Background selected:', backgroundName, selectedOption.dataset.color);
  }

  // 应用背景
  async applyBackground() {
    try {
      if (!this.state.recordedVideo) {
        throw new Error('没有可处理的视频文件');
      }

      if (!this.state.selectedBackground) {
        throw new Error('请先选择背景颜色');
      }

      // 显示处理状态
      this.transitionToStep('processing');
      this.updateProgress(10, '准备处理视频...');

      // 添加按钮加载状态
      this.elements.applyBgBtn.classList.add('loading');

      // 创建背景配置
      const backgroundConfig = {
        type: 'solid-color',
        color: this.state.selectedBackground,
        padding: 60, // 增大到60px内边距，让视频周围有更多空间
        videoPosition: 'center'
      };

      this.updateProgress(30, '正在应用背景...');

      // 处理视频背景，传递进度回调
      const processedVideoBlob = await this.backgroundProcessor.applyBackground(
        this.state.recordedVideo,
        backgroundConfig,
        (progress, message) => {
          this.updateProgress(progress, message);
        }
      );

      this.updateProgress(80, '正在准备下载...');

      // 生成文件名
      const backgroundName = this.getBackgroundName(this.state.selectedBackground);
      const filename = this.fileManager.generateDateFilename(
        `saas-recording-${backgroundName}`,
        'webm'
      );

      this.updateProgress(90, '正在下载文件...');

      // 下载处理后的视频
      await this.fileManager.downloadBlob(processedVideoBlob, filename);

      this.updateProgress(100, '处理完成');

      // 显示成功消息
      this.showSuccessMessage(`视频已处理并保存为: ${filename}`);

      // 显示下载完成指导和反馈请求
      this.showGuidance('download-ready');

      // 延迟显示反馈请求
      setTimeout(() => {
        this.showFeedbackRequest();
      }, 3000);

      // 重置状态
      setTimeout(() => {
        this.reset();
      }, 2000);

      console.log('Background applied and video downloaded:', filename);

    } catch (error) {
      console.error('Failed to apply background:', error);
      this.handleError('背景处理失败: ' + error.message, error);
    } finally {
      // 移除按钮加载状态
      this.elements.applyBgBtn.classList.remove('loading');
    }
  }

  // 跳过背景处理，直接下载原始视频
  async skipBackground() {
    try {
      if (!this.state.recordedVideo) {
        throw new Error('没有可下载的视频文件');
      }

      // 显示下载进度
      this.transitionToStep('processing');
      this.updateProgress(20, '准备下载...');

      // 生成文件名
      const filename = this.fileManager.generateDateFilename('saas-recording', 'webm');

      this.updateProgress(50, '正在下载文件...');

      // 下载文件
      await this.fileManager.downloadBlob(this.state.recordedVideo, filename);

      this.updateProgress(100, '下载完成');

      // 显示成功消息
      this.showSuccessMessage(`视频已保存为: ${filename}`);

      // 重置状态
      setTimeout(() => {
        this.reset();
      }, 2000);

      console.log('Video downloaded successfully:', filename);

    } catch (error) {
      console.error('Failed to download video:', error);
      this.handleError('下载失败: ' + error.message, error);
    }
  }

  // 更新界面状态
  updateUI() {
    const { currentStep, isRecording, error } = this.state;

    // 移除所有状态类
    document.body.classList.remove('recording', 'success', 'error');

    // 更新状态文本和指示器
    switch (currentStep) {
      case 'idle':
        this.elements.statusText.textContent = '准备录制';
        this.elements.recordingIndicator.classList.remove('recording');
        break;
      case 'recording':
        document.body.classList.add('recording');
        this.elements.recordingIndicator.classList.add('recording');
        // 录制时间会通过updateRecordingTime方法更新
        break;
      case 'processing':
        this.elements.statusText.textContent = '处理中...';
        this.elements.recordingIndicator.classList.remove('recording');
        break;
      case 'complete':
        document.body.classList.add('success');
        this.elements.statusText.textContent = '录制完成';
        this.elements.recordingIndicator.classList.remove('recording');
        break;
    }

    // 处理错误状态
    if (error) {
      document.body.classList.add('error');
    }

    // 更新按钮状态（增加安全检查）
    if (this.elements.startBtn) {
      this.elements.startBtn.disabled = isRecording;
    }
    if (this.elements.stopBtn) {
      this.elements.stopBtn.disabled = !isRecording;
    }

    // 添加加载状态
    if (currentStep === 'processing' && this.elements.stopBtn) {
      this.elements.stopBtn.classList.add('loading');
    } else if (this.elements.stopBtn) {
      this.elements.stopBtn.classList.remove('loading');
    }

    // 显示/隐藏相应区域
    this.showSection(currentStep);
  }

  // 显示指定区域
  showSection(step) {
    // 隐藏所有区域
    this.elements.recordingSection.classList.add('hidden');
    this.elements.backgroundSection.classList.add('hidden');
    this.elements.progressSection.classList.add('hidden');

    // 显示对应区域
    switch (step) {
      case 'idle':
      case 'recording':
        this.elements.recordingSection.classList.remove('hidden');
        break;
      case 'processing':
        this.elements.progressSection.classList.remove('hidden');
        break;
      case 'complete':
        this.elements.backgroundSection.classList.remove('hidden');
        // 自动聚焦到第一个背景选项，提升用户体验
        setTimeout(() => {
          const firstOption = this.elements.backgroundOptions[0];
          if (firstOption) {
            firstOption.focus();
          }
        }, 100);
        break;
    }
  }

  // 工作流程状态验证
  validateWorkflowState() {
    const { currentStep, recordedVideo, selectedBackground } = this.state;

    switch (currentStep) {
      case 'idle':
        return true;

      case 'recording':
        return this.state.isRecording;

      case 'processing':
        return true; // 处理状态总是有效的

      case 'complete':
        return recordedVideo && recordedVideo instanceof Blob && recordedVideo.size > 0;

      default:
        console.warn('Unknown workflow state:', currentStep);
        return false;
    }
  }

  // 工作流程状态转换
  transitionToStep(newStep, data = {}) {
    const currentStep = this.state.currentStep;

    // 验证状态转换的合法性
    const validTransitions = {
      'idle': ['recording', 'processing'],
      'recording': ['processing', 'idle'],
      'processing': ['complete', 'idle'],
      'complete': ['processing', 'idle']
    };

    if (!validTransitions[currentStep]?.includes(newStep)) {
      console.warn(`Invalid state transition: ${currentStep} -> ${newStep}`);
      return false;
    }

    // 执行状态转换
    this.setState({ currentStep: newStep, ...data });

    console.log(`Workflow transition: ${currentStep} -> ${newStep}`, data);
    return true;
  }

  // 更新进度条
  updateProgress(percentage, text) {
    if (this.elements.progressFill) {
      this.elements.progressFill.style.width = `${percentage}%`;
    }
    if (this.elements.progressText) {
      this.elements.progressText.textContent = text || '处理中...';
    }
  }

  // 状态管理方法
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.updateUI();
  }

  // 启动录制计时器
  startRecordingTimer() {
    this.recordingTimer = setInterval(() => {
      if (this.state.recordingStartTime) {
        const duration = Date.now() - this.state.recordingStartTime;
        this.state.recordingDuration = duration;
        this.updateRecordingTime(duration);
      }
    }, 1000);
  }

  // 停止录制计时器
  stopRecordingTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  // 更新录制时间显示
  updateRecordingTime(duration) {
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    const timeString = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    this.elements.statusText.textContent = `录制中... ${timeString}`;
  }

  // 增强的错误处理
  handleError(message, error, context = {}) {
    console.error(message, error);

    // 分析错误类型和提供解决方案
    const errorInfo = this.analyzeError(error, context);

    this.setState({
      error: {
        message,
        details: error,
        type: errorInfo.type,
        solution: errorInfo.solution,
        canRetry: errorInfo.canRetry
      },
      isRecording: false,
      currentStep: 'idle'
    });

    // 显示详细的错误消息
    this.showDetailedErrorMessage(message, errorInfo);

    // 记录错误统计
    this.logErrorEvent(errorInfo.type, message, context);
  }

  // 分析错误类型并提供解决方案
  analyzeError(error, context = {}) {
    const errorMessage = error?.message?.toLowerCase() || '';

    // Chrome扩展特定错误
    if (errorMessage.includes('target tab is required') ||
      errorMessage.includes('service worker context')) {
      return {
        type: 'extension',
        solution: '扩展权限配置问题。请重新加载扩展：1) 打开chrome://extensions/ 2) 找到本扩展 3) 点击刷新按钮 4) 重新尝试录制。',
        canRetry: true,
        userAction: '重新加载扩展'
      };
    }

    // 权限相关错误
    if (errorMessage.includes('permission') || errorMessage.includes('denied') ||
      errorMessage.includes('not allowed') || errorMessage.includes('用户取消')) {
      return {
        type: 'permission',
        solution: '请点击"允许"按钮授予屏幕录制权限，或检查浏览器设置中的权限配置。',
        canRetry: true,
        userAction: '重新授权'
      };
    }

    // 设备/硬件相关错误
    if (errorMessage.includes('device') || errorMessage.includes('hardware') ||
      errorMessage.includes('not found') || errorMessage.includes('unavailable')) {
      return {
        type: 'device',
        solution: '请确保您的设备支持屏幕录制功能，并且没有其他应用正在使用录制设备。',
        canRetry: true,
        userAction: '检查设备'
      };
    }

    // 网络/连接相关错误
    if (errorMessage.includes('network') || errorMessage.includes('connection') ||
      errorMessage.includes('timeout') || errorMessage.includes('超时')) {
      return {
        type: 'network',
        solution: '请检查网络连接，或稍后重试。',
        canRetry: true,
        userAction: '重试'
      };
    }

    // 文件/存储相关错误
    if (errorMessage.includes('file') || errorMessage.includes('storage') ||
      errorMessage.includes('disk') || errorMessage.includes('space')) {
      return {
        type: 'storage',
        solution: '请检查磁盘空间是否充足，或更改下载位置。',
        canRetry: false,
        userAction: '检查存储'
      };
    }

    // 视频处理相关错误
    if (errorMessage.includes('video') || errorMessage.includes('processing') ||
      errorMessage.includes('codec') || errorMessage.includes('format')) {
      return {
        type: 'processing',
        solution: '视频处理失败，您可以尝试直接下载原始录制文件。',
        canRetry: true,
        userAction: '跳过处理'
      };
    }

    // 浏览器兼容性错误
    if (errorMessage.includes('not supported') || errorMessage.includes('unsupported') ||
      errorMessage.includes('mediarecorder') || errorMessage.includes('api')) {
      return {
        type: 'compatibility',
        solution: '您的浏览器可能不支持此功能，请使用最新版本的Chrome或Edge浏览器。',
        canRetry: false,
        userAction: '更新浏览器'
      };
    }

    // 默认未知错误
    return {
      type: 'unknown',
      solution: '发生了未知错误，请尝试刷新页面或重启浏览器。',
      canRetry: true,
      userAction: '重试'
    };
  }

  // 显示详细错误消息
  showDetailedErrorMessage(message, errorInfo) {
    // 移除现有消息
    const existingMessages = document.querySelectorAll('.toast-message, .error-panel');
    existingMessages.forEach(msg => {
      if (msg.parentNode) {
        msg.parentNode.removeChild(msg);
      }
    });

    // 创建错误面板
    const errorPanel = document.createElement('div');
    errorPanel.className = 'error-panel';

    errorPanel.innerHTML = `
      <div class="error-header">
        <span class="error-icon">⚠️</span>
        <span class="error-title">操作失败</span>
        <button class="error-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="error-content">
        <div class="error-message">${message}</div>
        <div class="error-solution">
          <strong>解决方案：</strong>${errorInfo.solution}
        </div>
        ${errorInfo.canRetry ? `
          <div class="error-actions">
            <button class="retry-btn" onclick="window.popupController.retryLastAction()">
              ${errorInfo.userAction || '重试'}
            </button>
            <button class="help-btn" onclick="window.popupController.showHelp('${errorInfo.type}')">
              获取帮助
            </button>
          </div>
        ` : `
          <div class="error-actions">
            <button class="help-btn" onclick="window.popupController.showHelp('${errorInfo.type}')">
              获取帮助
            </button>
          </div>
        `}
      </div>
    `;

    // 设置样式
    errorPanel.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      border: 1px solid #dc3545;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(220, 53, 69, 0.15);
      z-index: 1000;
      max-width: 350px;
      font-size: 13px;
      animation: slideDown 0.3s ease-out;
    `;

    // 添加内部样式
    const style = document.createElement('style');
    style.textContent = `
      .error-panel .error-header {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        background: #dc3545;
        color: white;
        border-radius: 7px 7px 0 0;
        font-weight: 600;
      }
      .error-panel .error-icon {
        margin-right: 8px;
        font-size: 16px;
      }
      .error-panel .error-title {
        flex: 1;
      }
      .error-panel .error-close {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .error-panel .error-content {
        padding: 16px;
      }
      .error-panel .error-message {
        color: #721c24;
        margin-bottom: 12px;
        font-weight: 500;
      }
      .error-panel .error-solution {
        color: #495057;
        margin-bottom: 16px;
        line-height: 1.4;
      }
      .error-panel .error-actions {
        display: flex;
        gap: 8px;
      }
      .error-panel .retry-btn, .error-panel .help-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        font-weight: 500;
      }
      .error-panel .retry-btn {
        background: #007bff;
        color: white;
      }
      .error-panel .help-btn {
        background: #6c757d;
        color: white;
      }
      .error-panel .retry-btn:hover {
        background: #0056b3;
      }
      .error-panel .help-btn:hover {
        background: #545b62;
      }
      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(errorPanel);

    // 自动移除（如果用户没有手动关闭）
    setTimeout(() => {
      if (errorPanel.parentNode) {
        errorPanel.style.opacity = '0';
        errorPanel.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => {
          if (errorPanel.parentNode) {
            errorPanel.parentNode.removeChild(errorPanel);
          }
        }, 300);
      }
    }, 10000); // 10秒后自动关闭
  }

  // 记录错误事件（用于统计和改进）
  logErrorEvent(errorType, message, context) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      type: errorType,
      message: message,
      context: context,
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    console.log('Error logged:', errorLog);

    // 可以在这里添加错误上报逻辑
    // 例如发送到分析服务或错误监控系统
  }

  // 重试上次操作
  retryLastAction() {
    const { error } = this.state;
    if (!error || !error.canRetry) {
      return;
    }

    // 清除错误状态
    this.clearError();

    // 根据错误类型执行相应的重试操作
    switch (error.type) {
      case 'permission':
      case 'device':
        this.startRecording();
        break;
      case 'processing':
        if (this.state.recordedVideo) {
          this.skipBackground(); // 跳过背景处理，直接下载
        }
        break;
      case 'network':
        // 重试当前操作
        if (this.state.currentStep === 'processing') {
          this.applyBackground();
        } else {
          this.startRecording();
        }
        break;
      default:
        this.startRecording();
    }
  }

  // 显示帮助信息
  showHelp(errorType) {
    const helpContent = this.getHelpContent(errorType);
    this.showHelpModal(helpContent);
  }

  // 获取帮助内容
  getHelpContent(errorType) {
    const helpMap = {
      extension: {
        title: 'Chrome扩展问题帮助',
        content: `
          <h4>扩展权限配置问题解决步骤：</h4>
          <ol>
            <li>打开Chrome浏览器，在地址栏输入：<code>chrome://extensions/</code></li>
            <li>找到"SaaS Video Recorder"扩展</li>
            <li>点击扩展右下角的刷新按钮（🔄）</li>
            <li>确保扩展已启用（开关为蓝色）</li>
            <li>重新打开扩展并尝试录制</li>
          </ol>
          <h4>如果问题仍然存在：</h4>
          <ul>
            <li>完全卸载并重新安装扩展</li>
            <li>检查Chrome浏览器版本（需要88+）</li>
            <li>尝试在无痕模式下使用扩展</li>
            <li>重启Chrome浏览器</li>
          </ul>
          <h4>开发者模式安装说明：</h4>
          <ol>
            <li>确保已开启"开发者模式"</li>
            <li>点击"加载已解压的扩展程序"</li>
            <li>选择扩展的根目录</li>
            <li>确认扩展权限包含"标签页"和"桌面捕获"</li>
          </ol>
        `
      },
      permission: {
        title: '权限问题帮助',
        content: `
          <h4>如何授予录制权限：</h4>
          <ol>
            <li>点击地址栏左侧的锁图标</li>
            <li>确保"摄像头"和"麦克风"权限设置为"允许"</li>
            <li>刷新页面并重新尝试录制</li>
          </ol>
          <h4>如果问题仍然存在：</h4>
          <ul>
            <li>检查浏览器是否为最新版本</li>
            <li>尝试在无痕模式下使用扩展</li>
            <li>重启浏览器后再试</li>
          </ul>
        `
      },
      device: {
        title: '设备问题帮助',
        content: `
          <h4>设备检查步骤：</h4>
          <ol>
            <li>确保没有其他应用正在使用摄像头或录制功能</li>
            <li>检查设备管理器中的摄像头设备状态</li>
            <li>尝试重启浏览器</li>
          </ol>
          <h4>常见解决方案：</h4>
          <ul>
            <li>关闭其他视频会议软件（如Zoom、Teams等）</li>
            <li>检查杀毒软件是否阻止了摄像头访问</li>
            <li>更新摄像头驱动程序</li>
          </ul>
        `
      },
      compatibility: {
        title: '浏览器兼容性帮助',
        content: `
          <h4>支持的浏览器：</h4>
          <ul>
            <li>Chrome 88+ (推荐)</li>
            <li>Edge 88+</li>
            <li>其他基于Chromium的浏览器</li>
          </ul>
          <h4>解决方案：</h4>
          <ol>
            <li>更新浏览器到最新版本</li>
            <li>启用必要的实验性功能</li>
            <li>检查扩展是否正确安装</li>
          </ol>
        `
      },
      processing: {
        title: '视频处理问题帮助',
        content: `
          <h4>处理失败的可能原因：</h4>
          <ul>
            <li>视频文件过大或格式不支持</li>
            <li>内存不足</li>
            <li>浏览器性能限制</li>
          </ul>
          <h4>建议解决方案：</h4>
          <ol>
            <li>尝试录制较短的视频</li>
            <li>关闭其他浏览器标签页释放内存</li>
            <li>选择"直接下载"跳过背景处理</li>
          </ol>
        `
      },
      default: {
        title: '通用帮助',
        content: `
          <h4>常见问题解决步骤：</h4>
          <ol>
            <li>刷新页面重新尝试</li>
            <li>检查网络连接</li>
            <li>重启浏览器</li>
            <li>清除浏览器缓存</li>
          </ol>
          <h4>如果问题持续存在：</h4>
          <ul>
            <li>尝试在无痕模式下使用</li>
            <li>禁用其他扩展程序</li>
            <li>检查浏览器控制台的错误信息</li>
          </ul>
        `
      }
    };

    return helpMap[errorType] || helpMap.default;
  }

  // 显示帮助模态框
  showHelpModal(helpContent) {
    // 移除现有的帮助模态框
    const existingModal = document.querySelector('.help-modal');
    if (existingModal) {
      existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'help-modal';

    modal.innerHTML = `
      <div class="help-overlay" onclick="this.parentElement.remove()"></div>
      <div class="help-content">
        <div class="help-header">
          <h3>${helpContent.title}</h3>
          <button class="help-close" onclick="this.closest('.help-modal').remove()">×</button>
        </div>
        <div class="help-body">
          ${helpContent.content}
        </div>
        <div class="help-footer">
          <button class="help-ok" onclick="this.closest('.help-modal').remove()">知道了</button>
        </div>
      </div>
    `;

    // 添加模态框样式
    const modalStyle = document.createElement('style');
    modalStyle.textContent = `
      .help-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .help-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
      }
      .help-content {
        position: relative;
        background: white;
        border-radius: 8px;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      }
      .help-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px;
        border-bottom: 1px solid #e9ecef;
      }
      .help-header h3 {
        margin: 0;
        color: #495057;
      }
      .help-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #6c757d;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .help-body {
        padding: 20px;
        line-height: 1.6;
        color: #495057;
      }
      .help-body h4 {
        color: #343a40;
        margin-top: 20px;
        margin-bottom: 10px;
      }
      .help-body ol, .help-body ul {
        margin-bottom: 15px;
        padding-left: 20px;
      }
      .help-body li {
        margin-bottom: 5px;
      }
      .help-footer {
        padding: 20px;
        border-top: 1px solid #e9ecef;
        text-align: right;
      }
      .help-ok {
        background: #007bff;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 500;
      }
      .help-ok:hover {
        background: #0056b3;
      }
    `;

    document.head.appendChild(modalStyle);
    document.body.appendChild(modal);
  }

  // 显示错误消息
  showErrorMessage(message) {
    this.showMessage(message, 'error');
  }

  // 显示成功消息
  showSuccessMessage(message) {
    this.showMessage(message, 'success');

    // 记录成功事件
    this.logSuccessEvent(message);
  }

  // 记录成功事件
  logSuccessEvent(message) {
    const successLog = {
      timestamp: new Date().toISOString(),
      message: message,
      step: this.state.currentStep,
      duration: this.state.recordingDuration
    };

    console.log('Success logged:', successLog);
  }

  // 显示操作指导
  showGuidance(step) {
    const guidance = this.getGuidanceContent(step);
    if (!guidance) return;

    // 移除现有指导
    const existingGuidance = document.querySelector('.guidance-tooltip');
    if (existingGuidance) {
      existingGuidance.remove();
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'guidance-tooltip';
    tooltip.innerHTML = `
      <div class="guidance-content">
        <div class="guidance-icon">${guidance.icon}</div>
        <div class="guidance-text">${guidance.text}</div>
        <button class="guidance-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;

    // 设置样式
    tooltip.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #007bff;
      color: white;
      padding: 0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
      z-index: 1500;
      max-width: 280px;
      animation: slideInRight 0.3s ease-out;
    `;

    // 添加内部样式
    const guidanceStyle = document.createElement('style');
    guidanceStyle.textContent = `
      .guidance-tooltip .guidance-content {
        display: flex;
        align-items: flex-start;
        padding: 16px;
        gap: 12px;
      }
      .guidance-tooltip .guidance-icon {
        font-size: 20px;
        flex-shrink: 0;
      }
      .guidance-tooltip .guidance-text {
        flex: 1;
        font-size: 14px;
        line-height: 1.4;
      }
      .guidance-tooltip .guidance-close {
        background: none;
        border: none;
        color: white;
        font-size: 16px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      @keyframes slideInRight {
        from {
          opacity: 0;
          transform: translateX(100%);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `;

    document.head.appendChild(guidanceStyle);
    document.body.appendChild(tooltip);

    // 自动移除
    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (tooltip.parentNode) {
            tooltip.parentNode.removeChild(tooltip);
          }
        }, 300);
      }
    }, 5000);
  }

  // 获取操作指导内容
  getGuidanceContent(step) {
    const guidanceMap = {
      'first-time': {
        icon: '👋',
        text: '欢迎使用视频录制器！点击"开始录制"按钮开始录制您的屏幕。'
      },
      'recording-started': {
        icon: '🎥',
        text: '录制已开始！您可以随时点击"停止录制"按钮结束录制。'
      },
      'recording-stopped': {
        icon: '✅',
        text: '录制完成！现在您可以选择背景颜色来美化您的视频。'
      },
      'background-selection': {
        icon: '🎨',
        text: '选择一个背景颜色，或者点击"直接下载"跳过背景处理。'
      },
      'processing': {
        icon: '⚙️',
        text: '正在处理您的视频，请稍候...'
      },
      'download-ready': {
        icon: '📥',
        text: '视频处理完成！文件将自动下载到您的下载文件夹。'
      }
    };

    return guidanceMap[step];
  }

  // 显示用户反馈收集
  showFeedbackRequest() {
    // 检查是否已经显示过反馈请求
    if (localStorage.getItem('feedback-shown')) {
      return;
    }

    const feedbackPanel = document.createElement('div');
    feedbackPanel.className = 'feedback-panel';

    feedbackPanel.innerHTML = `
      <div class="feedback-content">
        <div class="feedback-header">
          <span class="feedback-icon">💭</span>
          <span class="feedback-title">您的体验如何？</span>
          <button class="feedback-close" onclick="this.closest('.feedback-panel').remove()">×</button>
        </div>
        <div class="feedback-body">
          <p>帮助我们改进产品，您的反馈很重要！</p>
          <div class="feedback-options">
            <button class="feedback-btn feedback-good" onclick="window.popupController.submitFeedback('good')">
              😊 很好用
            </button>
            <button class="feedback-btn feedback-ok" onclick="window.popupController.submitFeedback('ok')">
              😐 还可以
            </button>
            <button class="feedback-btn feedback-bad" onclick="window.popupController.submitFeedback('bad')">
              😞 有问题
            </button>
          </div>
        </div>
      </div>
    `;

    // 设置样式
    feedbackPanel.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: white;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 1500;
      max-width: 300px;
      animation: slideInLeft 0.3s ease-out;
    `;

    // 添加反馈样式
    const feedbackStyle = document.createElement('style');
    feedbackStyle.textContent = `
      .feedback-panel .feedback-content {
        padding: 0;
      }
      .feedback-panel .feedback-header {
        display: flex;
        align-items: center;
        padding: 16px;
        background: #f8f9fa;
        border-radius: 7px 7px 0 0;
        border-bottom: 1px solid #dee2e6;
      }
      .feedback-panel .feedback-icon {
        margin-right: 8px;
        font-size: 16px;
      }
      .feedback-panel .feedback-title {
        flex: 1;
        font-weight: 600;
        color: #495057;
      }
      .feedback-panel .feedback-close {
        background: none;
        border: none;
        color: #6c757d;
        font-size: 16px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .feedback-panel .feedback-body {
        padding: 16px;
      }
      .feedback-panel .feedback-body p {
        margin: 0 0 16px 0;
        color: #495057;
        font-size: 14px;
        line-height: 1.4;
      }
      .feedback-panel .feedback-options {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .feedback-panel .feedback-btn {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        background: white;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
        min-width: 80px;
      }
      .feedback-panel .feedback-btn:hover {
        background: #f8f9fa;
        border-color: #007bff;
      }
      .feedback-panel .feedback-good:hover {
        background: #d4edda;
        border-color: #28a745;
      }
      .feedback-panel .feedback-ok:hover {
        background: #fff3cd;
        border-color: #ffc107;
      }
      .feedback-panel .feedback-bad:hover {
        background: #f8d7da;
        border-color: #dc3545;
      }
      @keyframes slideInLeft {
        from {
          opacity: 0;
          transform: translateX(-100%);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `;

    document.head.appendChild(feedbackStyle);
    document.body.appendChild(feedbackPanel);

    // 标记已显示
    localStorage.setItem('feedback-shown', 'true');

    // 自动移除
    setTimeout(() => {
      if (feedbackPanel.parentNode) {
        feedbackPanel.style.opacity = '0';
        feedbackPanel.style.transform = 'translateX(-100%)';
        setTimeout(() => {
          if (feedbackPanel.parentNode) {
            feedbackPanel.parentNode.removeChild(feedbackPanel);
          }
        }, 300);
      }
    }, 15000); // 15秒后自动关闭
  }

  // 提交用户反馈
  submitFeedback(rating) {
    const feedback = {
      timestamp: new Date().toISOString(),
      rating: rating,
      userAgent: navigator.userAgent,
      version: '1.0.0'
    };

    console.log('Feedback submitted:', feedback);

    // 移除反馈面板
    const feedbackPanel = document.querySelector('.feedback-panel');
    if (feedbackPanel) {
      feedbackPanel.remove();
    }

    // 显示感谢消息
    this.showMessage('感谢您的反馈！', 'success');

    // 如果是负面反馈，显示帮助选项
    if (rating === 'bad') {
      setTimeout(() => {
        this.showHelp('default');
      }, 1000);
    }
  }

  // 显示消息（通用方法）
  showMessage(message, type = 'info') {
    // 移除现有消息
    const existingMessages = document.querySelectorAll('.toast-message');
    existingMessages.forEach(msg => {
      if (msg.parentNode) {
        msg.parentNode.removeChild(msg);
      }
    });

    // 创建消息元素
    const messageDiv = document.createElement('div');
    messageDiv.className = `toast-message toast-${type}`;
    messageDiv.textContent = message;

    // 设置样式
    const colors = {
      error: { bg: '#dc3545', color: 'white' },
      success: { bg: '#28a745', color: 'white' },
      info: { bg: '#17a2b8', color: 'white' }
    };

    const color = colors[type] || colors.info;

    messageDiv.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background-color: ${color.bg};
      color: ${color.color};
      padding: 12px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      max-width: 300px;
      text-align: center;
      line-height: 1.4;
    `;

    document.body.appendChild(messageDiv);

    // 添加进入动画
    messageDiv.style.opacity = '0';
    messageDiv.style.transform = 'translateX(-50%) translateY(-10px)';

    setTimeout(() => {
      messageDiv.style.transition = 'all 0.3s ease';
      messageDiv.style.opacity = '1';
      messageDiv.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);

    // 自动移除
    const duration = type === 'success' ? 4000 : 3000;
    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.style.opacity = '0';
        messageDiv.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => {
          if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
          }
        }, 300);
      }
    }, duration);
  }

  // 清除错误状态
  clearError() {
    this.state.error = null;

    // 移除现有的消息
    const existingMessages = document.querySelectorAll('.toast-message, .error-message');
    existingMessages.forEach(message => {
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    });
  }

  // 录制真正开始时的回调
  onRecordingStarted() {
    console.log('Recording actually started - updating UI');

    // 不要在这里更新进度条，因为录制时进度区域是隐藏的
    // this.updateProgress(100, '录制已开始');

    // 更新状态为录制中
    this.transitionToStep('recording', {
      isRecording: true,
      recordingStartTime: Date.now(),
      recordingDuration: 0
    });

    // 启动录制计时器
    this.startRecordingTimer();
    
    // 通知background script开始计时
    chrome.runtime.sendMessage({ action: 'startRecording' }, (response) => {
      console.log('Background timer started:', response);
    });

    // 显示录制开始指导
    this.showGuidance('recording-started');

    console.log('UI updated for recording started');
  }

  // 处理录制意外结束（用户手动停止屏幕共享）
  async handleRecordingEnded() {
    if (this.state.isRecording) {
      console.log('Recording ended by user action (Stop Share clicked)');
      
      // 停止计时器
      this.stopRecordingTimer();
      
      // 通知background script停止计时
      chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
        console.log('Background timer stopped:', response);
      });
      
      // 更新状态为处理中
      this.transitionToStep('processing', {
        isRecording: false
      });
      
      this.updateProgress(30, '正在处理录制数据...');
      
      try {
        // 尝试获取已录制的视频数据
        const videoBlob = await this.videoRecorder.stopRecording();
        
        this.updateProgress(70, '正在验证视频数据...');
        
        // 验证视频文件
        if (this.validateRecordedVideo(videoBlob)) {
          // 保存录制的视频
          this.setState({ recordedVideo: videoBlob });
          
          this.updateProgress(100, '录制完成');
          
          // 显示录制成功信息
          const duration = Math.floor(this.state.recordingDuration / 1000);
          const sizeInfo = this.fileManager.formatFileSize(videoBlob.size);
          this.showSuccessMessage(`录制完成！时长: ${duration}秒, 大小: ${sizeInfo}`);
          
          // 短暂延迟后显示背景选择界面
          setTimeout(() => {
            this.transitionToStep('complete');
            // 显示背景选择指导
            this.showGuidance('background-selection');
          }, 1000);
          
          console.log('Recording stopped by user, video saved successfully');
        } else {
          throw new Error('录制的视频文件无效或损坏');
        }
      } catch (error) {
        console.error('Failed to handle user-stopped recording:', error);
        // 如果是没有录制数据的错误，给出更友好的提示
        if (error.message.includes('没有可用的录制数据')) {
          this.handleError('录制时间太短，没有生成有效的视频文件', error);
        } else {
          this.handleError('录制停止失败: ' + error.message, error);
        }
      }
    }
  }

  // 重置到初始状态
  reset() {
    this.stopRecordingTimer();

    // 清理录制器资源
    if (this.videoRecorder) {
      this.videoRecorder.cleanup();
    }

    // 清理文件管理器
    if (this.fileManager) {
      this.fileManager.cleanup();
    }

    // 清理背景处理器
    if (this.backgroundProcessor) {
      this.backgroundProcessor.cleanup();
    }

    this.setState({
      isRecording: false,
      recordingStartTime: null,
      currentStep: 'idle',
      selectedBackground: null,
      recordedVideo: null,
      recordingDuration: 0,
      error: null
    });

    // 重置背景选择
    this.resetBackgroundSelection();
  }

  // 获取录制的视频数据
  getRecordedVideo() {
    return this.state.recordedVideo;
  }

  // 更新背景预览
  updateBackgroundPreview(backgroundColor) {
    const previewContainer = document.getElementById('preview-container');
    if (previewContainer) {
      previewContainer.style.backgroundColor = backgroundColor;

      // 添加预览动画
      previewContainer.style.transform = 'scale(0.98)';
      setTimeout(() => {
        previewContainer.style.transform = 'scale(1)';
      }, 150);
    }
  }

  // 更新选中背景信息
  updateSelectedBackgroundInfo(backgroundName, backgroundColor) {
    const selectedBgName = document.getElementById('selected-bg-name');
    if (selectedBgName) {
      selectedBgName.textContent = `已选择: ${backgroundName}`;
      selectedBgName.style.color = this.getContrastColor(backgroundColor);
    }
  }

  // 获取对比色（用于文字显示）
  getContrastColor(hexColor) {
    // 将hex颜色转换为RGB
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);

    // 计算亮度
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;

    // 返回对比色
    return brightness > 128 ? '#495057' : '#007bff';
  }

  // 重置背景选择
  resetBackgroundSelection() {
    // 清除所有选中状态
    this.elements.backgroundOptions.forEach(option => {
      option.classList.remove('selected');
    });

    // 重置预览
    const previewContainer = document.getElementById('preview-container');
    if (previewContainer) {
      previewContainer.style.backgroundColor = '';
    }

    // 重置信息显示
    const selectedBgName = document.getElementById('selected-bg-name');
    if (selectedBgName) {
      selectedBgName.textContent = '请选择背景颜色';
      selectedBgName.style.color = '#495057';
    }

    // 禁用应用按钮
    this.elements.applyBgBtn.disabled = true;
    this.state.selectedBackground = null;
  }

  // 验证录制的视频
  validateRecordedVideo(videoBlob) {
    if (!videoBlob || !(videoBlob instanceof Blob)) {
      console.error('Invalid video blob');
      return false;
    }

    if (videoBlob.size === 0) {
      console.error('Empty video file');
      return false;
    }

    if (videoBlob.size < 1000) { // 小于1KB可能是无效文件
      console.error('Video file too small:', videoBlob.size);
      return false;
    }

    // 检查MIME类型
    const validTypes = ['video/webm', 'video/mp4'];
    if (!validTypes.some(type => videoBlob.type.includes(type))) {
      console.warn('Unexpected video type:', videoBlob.type);
      // 不直接返回false，因为某些情况下type可能为空但文件仍然有效
    }

    console.log('Video validation passed:', {
      size: videoBlob.size,
      type: videoBlob.type
    });

    return true;
  }

  // 获取背景名称（用于文件命名）
  getBackgroundName(backgroundColor) {
    const backgroundMap = {
      '#ffffff': 'white',
      '#f8f9fa': 'light-gray',
      '#e9ecef': 'gray',
      '#1a1a1a': 'dark',
      '#0066cc': 'blue'
    };

    return backgroundMap[backgroundColor] || 'custom';
  }

  // 键盘导航处理
  handleKeyboardNavigation(event) {
    // 只在背景选择界面处理键盘事件
    if (this.state.currentStep !== 'complete') {
      return;
    }

    const backgroundOptions = Array.from(this.elements.backgroundOptions);
    const currentSelected = backgroundOptions.findIndex(option =>
      option.classList.contains('selected')
    );

    let newIndex = -1;

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        newIndex = currentSelected > 0 ? currentSelected - 1 : backgroundOptions.length - 1;
        break;

      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        newIndex = currentSelected < backgroundOptions.length - 1 ? currentSelected + 1 : 0;
        break;

      case 'Enter':
        event.preventDefault();
        if (currentSelected >= 0 && !this.elements.applyBgBtn.disabled) {
          this.applyBackground();
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.skipBackground();
        break;

      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        event.preventDefault();
        newIndex = parseInt(event.key) - 1;
        break;
    }

    // 选择新的背景选项
    if (newIndex >= 0 && newIndex < backgroundOptions.length) {
      this.selectBackground(backgroundOptions[newIndex]);
    }
  }
}

// 初始化popup控制器
document.addEventListener('DOMContentLoaded', () => {
  window.popupController = new PopupController();
});