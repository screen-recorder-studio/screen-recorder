class ElementRecorder {
    constructor() {
        this.isSelectionMode = false;
        this.selectedElement = null;
        this.currentStream = null;
        this.currentTrack = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.hoveredElement = null;
        
        // 内存管理相关
        this.objectUrls = new Set(); // 跟踪所有创建的 Object URLs
        this.timers = new Set(); // 跟踪所有定时器
        this.eventListeners = new Map(); // 跟踪事件监听器
        this.memoryCleanupInterval = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.checkAPISupport();
        this.startAnimations();
        this.startMemoryMonitoring();
    }

    initializeElements() {
        this.toggleSelectionBtn = document.getElementById('toggleSelection');
        this.startRecordBtn = document.getElementById('startRecord');
        this.stopRecordBtn = document.getElementById('stopRecord');
        this.clearSelectionBtn = document.getElementById('clearSelection');
        this.statusMessage = document.getElementById('statusMessage');
        this.selectedElementDisplay = document.getElementById('selectedElement');
        this.recordedVideo = document.getElementById('recordedVideo');
        this.videoPlaceholder = document.getElementById('videoPlaceholder');
        this.selectionOverlay = document.getElementById('selectionOverlay');
        this.apiSupport = document.getElementById('apiSupport');
    }

    setupEventListeners() {
        // 使用箭头函数绑定 this，并跟踪事件监听器
        const toggleHandler = () => this.toggleSelectionMode();
        const startHandler = () => this.startRecording();
        const stopHandler = () => this.stopRecording();
        const clearHandler = () => this.clearSelection();
        const mouseOverHandler = (e) => this.handleMouseOver(e);
        const mouseOutHandler = (e) => this.handleMouseOut(e);
        const clickHandler = (e) => this.handleClick(e);
        const demoButtonHandler = (e) => {
            e.stopPropagation();
            this.showMessage('Demo button clicked!');
        };
        
        // 添加事件监听器并跟踪
        this.addTrackedEventListener(this.toggleSelectionBtn, 'click', toggleHandler);
        this.addTrackedEventListener(this.startRecordBtn, 'click', startHandler);
        this.addTrackedEventListener(this.stopRecordBtn, 'click', stopHandler);
        this.addTrackedEventListener(this.clearSelectionBtn, 'click', clearHandler);
        
        // Mouse events for element selection
        this.addTrackedEventListener(document, 'mouseover', mouseOverHandler);
        this.addTrackedEventListener(document, 'mouseout', mouseOutHandler);
        this.addTrackedEventListener(document, 'click', clickHandler);
        
        // Demo button event
        const demoButton = document.querySelector('.demo-button');
        if (demoButton) {
            this.addTrackedEventListener(demoButton, 'click', demoButtonHandler);
        }
        
        // 页面卸载时清理资源
        this.addTrackedEventListener(window, 'beforeunload', () => this.cleanup());
        this.addTrackedEventListener(window, 'unload', () => this.cleanup());
    }

    checkAPISupport() {
        const support = [];
        
        if (typeof navigator.mediaDevices !== 'undefined' && navigator.mediaDevices.getDisplayMedia) {
            support.push('✅ Screen Capture API');
        } else {
            support.push('❌ Screen Capture API');
        }
        
        if (typeof RestrictionTarget !== 'undefined') {
            support.push('✅ Element Capture API (RestrictionTarget)');
        } else {
            support.push('❌ Element Capture API (RestrictionTarget)');
        }
        
        if (typeof CropTarget !== 'undefined') {
            support.push('✅ Region Capture API (CropTarget)');
        } else {
            support.push('❌ Region Capture API (CropTarget)');
        }
        
        this.apiSupport.innerHTML = support.join('<br>');
    }

    toggleSelectionMode() {
        this.isSelectionMode = !this.isSelectionMode;
        
        if (this.isSelectionMode) {
            this.toggleSelectionBtn.textContent = 'Disable Selection Mode';
            this.toggleSelectionBtn.classList.add('active');
            this.selectionOverlay.classList.add('active');
            this.showMessage('Selection mode enabled. Hover over elements to highlight them.');
        } else {
            this.toggleSelectionBtn.textContent = 'Enable Selection Mode';
            this.toggleSelectionBtn.classList.remove('active');
            this.selectionOverlay.classList.remove('active');
            this.clearHighlight();
            this.showMessage('Selection mode disabled.');
        }
    }

    handleMouseOver(e) {
        if (!this.isSelectionMode) return;
        
        const target = e.target;
        if (this.isSelectableElement(target)) {
            this.highlightElement(target);
            this.hoveredElement = target;
        }
    }

    handleMouseOut(e) {
        if (!this.isSelectionMode) return;
        
        const target = e.target;
        if (target === this.hoveredElement && target !== this.selectedElement) {
            this.clearHighlight(target);
            this.hoveredElement = null;
        }
    }

    handleClick(e) {
        if (!this.isSelectionMode) return;
        
        const target = e.target;
        if (this.isSelectableElement(target)) {
            e.preventDefault();
            e.stopPropagation();
            this.selectElement(target);
        }
    }

    isSelectableElement(element) {
        // Exclude control elements and overlay
        const excludeSelectors = [
            '.controls', '.controls *',
            '.selection-overlay',
            'button:not(.demo-button)',
            '.status', '.status *',
            '.info-panel', '.info-panel *'
        ];
        
        return !excludeSelectors.some(selector => element.matches(selector));
    }

    highlightElement(element) {
        this.clearHighlight();
        element.classList.add('element-highlight');
    }

    clearHighlight(element = null) {
        if (element) {
            element.classList.remove('element-highlight');
        } else {
            document.querySelectorAll('.element-highlight').forEach(el => {
                el.classList.remove('element-highlight');
            });
        }
    }

    selectElement(element) {
        // Clear previous selection
        if (this.selectedElement) {
            this.selectedElement.classList.remove('element-selected');
        }
        
        // Set new selection
        this.selectedElement = element;
        element.classList.add('element-selected');
        element.classList.remove('element-highlight');
        
        // Update UI
        const elementInfo = this.getElementInfo(element);
        this.selectedElementDisplay.textContent = `Selected: ${elementInfo}`;
        this.startRecordBtn.disabled = false;
        this.showMessage(`Element selected: ${elementInfo}. Ready to record!`);
    }

    getElementInfo(element) {
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const className = element.className ? `.${element.className.split(' ').join('.')}` : '';
        return `${tagName}${id}${className}`;
    }

    clearSelection() {
        if (this.selectedElement) {
            this.selectedElement.classList.remove('element-selected');
            this.selectedElement = null;
        }
        
        this.selectedElementDisplay.textContent = 'No element selected';
        this.startRecordBtn.disabled = true;
        this.showMessage('Selection cleared.');
    }

    async startRecording() {
        if (!this.selectedElement) {
            this.showMessage('Please select an element first.');
            return;
        }

        try {
            this.showMessage('Starting screen capture...');
            
            // Get display media stream
            const displayMediaOptions = {
                video: {
                    displaySurface: "window",
                },
                audio: false,
                preferCurrentTab: true,
            };
            
            this.currentStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
            const [track] = this.currentStream.getVideoTracks();
            this.currentTrack = track;
            
            // Try to use Element Capture API if available
            if (typeof RestrictionTarget !== 'undefined') {
                try {
                    const restrictionTarget = await RestrictionTarget.fromElement(this.selectedElement);
                    await track.restrictTo(restrictionTarget);
                    this.showMessage('Recording with Element Capture API...');
                } catch (err) {
                    console.warn('Element Capture API failed, falling back to full capture:', err);
                    this.showMessage('Recording full screen (Element Capture API not available)...');
                }
            } else if (typeof CropTarget !== 'undefined') {
                try {
                    const cropTarget = await CropTarget.fromElement(this.selectedElement);
                    await track.cropTo(cropTarget);
                    this.showMessage('Recording with Region Capture API...');
                } catch (err) {
                    console.warn('Region Capture API failed, falling back to full capture:', err);
                    this.showMessage('Recording full screen (Region Capture API not available)...');
                }
            } else {
                this.showMessage('Recording full screen (Capture APIs not available)...');
            }
            
            // Set up video element
            this.recordedVideo.srcObject = this.currentStream;
            this.recordedVideo.style.display = 'block';
            this.videoPlaceholder.style.display = 'none';
            
            // Set up MediaRecorder for saving
            this.mediaRecorder = new MediaRecorder(this.currentStream, {
                mimeType: 'video/webm;codecs=vp9'
            });
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                this.saveRecording();
            };
            
            this.mediaRecorder.start();
            
            // Update UI
            this.startRecordBtn.disabled = true;
            this.stopRecordBtn.disabled = false;
            this.toggleSelectionBtn.disabled = true;
            
            // Handle track ending
            track.onended = () => {
                this.stopRecording();
            };
            
        } catch (err) {
            console.error('Error starting recording:', err);
            this.showMessage(`Error: ${err.message}`);
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        
        // 清理媒体流资源
        this.cleanupMediaResources();
        
        // Update UI
        this.startRecordBtn.disabled = false;
        this.stopRecordBtn.disabled = true;
        this.toggleSelectionBtn.disabled = false;
        this.showMessage('Recording stopped.');
    }

    saveRecording() {
        if (this.recordedChunks.length === 0) return;
        
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        
        // 跟踪创建的 Object URL
        this.objectUrls.add(url);
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `element-recording-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // 延迟清理 URL，确保下载完成
        const cleanupTimer = setTimeout(() => {
            this.revokeObjectUrl(url);
            this.timers.delete(cleanupTimer);
        }, 5000);
        this.timers.add(cleanupTimer);
        
        // 清理录制数据
        this.recordedChunks.length = 0; // 更高效的数组清空方式
        
        this.showMessage('Recording saved!');
    }

    showMessage(message) {
        this.statusMessage.textContent = message;
        console.log(message);
    }

    startAnimations() {
        // Counter animation
        let counter = 0;
        const counterElement = document.getElementById('counter');
        const counterTimer = setInterval(() => {
            counter++;
            if (counterElement) {
                counterElement.textContent = `Counter: ${counter}`;
            }
        }, 1000);
        
        // 跟踪定时器
        this.timers.add(counterTimer);
    }
    
    // 内存管理方法
    addTrackedEventListener(element, event, handler) {
        element.addEventListener(event, handler);
        
        // 跟踪事件监听器以便后续清理
        if (!this.eventListeners.has(element)) {
            this.eventListeners.set(element, []);
        }
        this.eventListeners.get(element).push({ event, handler });
    }
    
    revokeObjectUrl(url) {
        if (this.objectUrls.has(url)) {
            URL.revokeObjectURL(url);
            this.objectUrls.delete(url);
        }
    }
    
    cleanupMediaResources() {
        // 清理媒体流
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => {
                track.stop();
                // 移除所有事件监听器
                track.onended = null;
                track.onmute = null;
                track.onunmute = null;
            });
            this.currentStream = null;
            this.currentTrack = null;
        }
        
        // 清理 MediaRecorder
        if (this.mediaRecorder) {
            this.mediaRecorder.ondataavailable = null;
            this.mediaRecorder.onstop = null;
            this.mediaRecorder.onerror = null;
            this.mediaRecorder = null;
        }
        
        // 清理视频元素
        if (this.recordedVideo) {
            this.recordedVideo.srcObject = null;
            this.recordedVideo.src = '';
            this.recordedVideo.load(); // 强制释放资源
        }
    }
    
    startMemoryMonitoring() {
        // 定期清理内存
        this.memoryCleanupInterval = setInterval(() => {
            this.performMemoryCleanup();
        }, 30000); // 每30秒执行一次清理
        
        this.timers.add(this.memoryCleanupInterval);
    }
    
    performMemoryCleanup() {
        // 清理过期的 Object URLs
        if (this.objectUrls.size > 10) {
            console.log('Cleaning up excess object URLs');
            const urlsArray = Array.from(this.objectUrls);
            // 保留最新的5个，清理其余的
            urlsArray.slice(0, -5).forEach(url => {
                this.revokeObjectUrl(url);
            });
        }
        
        // 强制垃圾回收（如果可用）
        if (window.gc && typeof window.gc === 'function') {
            try {
                window.gc();
            } catch (e) {
                // 忽略错误，gc 可能不可用
            }
        }
        
        // 清理录制数据缓存
        if (this.recordedChunks.length > 0 && !this.mediaRecorder) {
            console.log('Cleaning up orphaned recorded chunks');
            this.recordedChunks.length = 0;
        }
        
        console.log(`Memory cleanup completed. Tracked URLs: ${this.objectUrls.size}, Timers: ${this.timers.size}`);
    }
    
    cleanup() {
        console.log('Starting comprehensive cleanup...');
        
        // 清理媒体资源
        this.cleanupMediaResources();
        
        // 清理所有定时器
        this.timers.forEach(timer => {
            clearInterval(timer);
            clearTimeout(timer);
        });
        this.timers.clear();
        
        // 清理所有 Object URLs
        this.objectUrls.forEach(url => {
            URL.revokeObjectURL(url);
        });
        this.objectUrls.clear();
        
        // 移除所有事件监听器
        this.eventListeners.forEach((listeners, element) => {
            listeners.forEach(({ event, handler }) => {
                try {
                    element.removeEventListener(event, handler);
                } catch (e) {
                    // 忽略移除失败的情况
                }
            });
        });
        this.eventListeners.clear();
        
        // 清理录制数据
        this.recordedChunks.length = 0;
        
        // 重置状态
        this.selectedElement = null;
        this.hoveredElement = null;
        this.isSelectionMode = false;
        
        console.log('Cleanup completed');
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ElementRecorder();
});
