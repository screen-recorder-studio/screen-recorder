class CapturedMouseEventsTest {
    constructor() {
        this.mediaStream = null;
        this.captureController = null;
        this.isCapturing = false;
        this.eventCount = 0;
        this.startTime = null;
        this.frameCount = 0;
        this.lastFrameTime = 0;
        
        this.initializeElements();
        this.bindEvents();
        this.checkBrowserSupport();
    }
    
    initializeElements() {
        this.elements = {
            startCapture: document.getElementById('startCapture'),
            stopCapture: document.getElementById('stopCapture'),
            clearLog: document.getElementById('clearLog'),
            includeCursor: document.getElementById('includeCursor'),
            enableMouseEvents: document.getElementById('enableMouseEvents'),
            capturedVideo: document.getElementById('capturedVideo'),
            mouseCoords: document.getElementById('mouseCoords'),
            mouseStatus: document.getElementById('mouseStatus'),
            eventLog: document.getElementById('eventLog'),
            status: document.getElementById('status'),
            eventCount: document.getElementById('eventCount'),
            frameRate: document.getElementById('frameRate'),
            captureTime: document.getElementById('captureTime')
        };
    }
    
    bindEvents() {
        this.elements.startCapture.addEventListener('click', () => this.startCapture());
        this.elements.stopCapture.addEventListener('click', () => this.stopCapture());
        this.elements.clearLog.addEventListener('click', () => this.clearLog());
    }
    
    checkBrowserSupport() {
        const support = {
            getDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
            captureController: typeof CaptureController !== 'undefined',
            userAgent: navigator.userAgent,
            isChrome: /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent),
            isEdge: /Edg/.test(navigator.userAgent),
            isFirefox: /Firefox/.test(navigator.userAgent),
            isSafari: /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
        };

        this.log(`Browser Support Check:`, 'info');
        this.log(`- User Agent: ${support.userAgent}`, 'info');
        this.log(`- getDisplayMedia: ${support.getDisplayMedia}`, 'info');
        this.log(`- CaptureController: ${support.captureController}`, 'info');
        this.log(`- Chrome: ${support.isChrome}`, 'info');
        this.log(`- Edge: ${support.isEdge}`, 'info');
        this.log(`- Firefox: ${support.isFirefox}`, 'info');
        this.log(`- Safari: ${support.isSafari}`, 'info');

        // Test CaptureController constructor and mouse events support
        if (support.captureController) {
            try {
                const testController = new CaptureController();
                this.log(`- CaptureController constructor: working`, 'success');

                // Check if oncapturedmousechange property exists
                const hasMouseChangeProperty = 'oncapturedmousechange' in testController;
                this.log(`- oncapturedmousechange property: ${hasMouseChangeProperty ? 'exists' : 'missing'}`, hasMouseChangeProperty ? 'success' : 'warning');
                this.log(`- oncapturedmousechange type: ${typeof testController.oncapturedmousechange}`, 'info');

                // Check if CapturedMouseEvent constructor exists
                const hasCapturedMouseEvent = typeof CapturedMouseEvent !== 'undefined';
                this.log(`- CapturedMouseEvent constructor: ${hasCapturedMouseEvent ? 'exists' : 'missing'}`, hasCapturedMouseEvent ? 'success' : 'warning');

                // Test if we can create a CapturedMouseEvent
                if (hasCapturedMouseEvent) {
                    try {
                        const testEvent = new CapturedMouseEvent('capturedmousechange', {surfaceX: 10, surfaceY: 20});
                        this.log(`- CapturedMouseEvent creation: working`, 'success');
                        this.log(`- Event surfaceX: ${testEvent.surfaceX}, surfaceY: ${testEvent.surfaceY}`, 'info');
                    } catch (eventError) {
                        this.log(`- CapturedMouseEvent creation error: ${eventError.message}`, 'error');
                    }
                }

                support.mouseEventsSupported = hasMouseChangeProperty && hasCapturedMouseEvent;

            } catch (error) {
                this.log(`- CaptureController constructor error: ${error.message}`, 'error');
                support.captureController = false;
                support.mouseEventsSupported = false;
            }
        }

        if (!support.getDisplayMedia) {
            this.updateStatus('error', 'getDisplayMedia is not supported in this browser');
            this.elements.startCapture.disabled = true;
            return;
        }

        if (!support.captureController) {
            this.updateStatus('error', 'CaptureController is not supported in this browser. Try enabling experimental web platform features in chrome://flags');
            this.log('Note: Mouse events will not be available', 'warning');
            this.log('Tip: In Chrome/Edge, go to chrome://flags and enable "Experimental Web Platform features"', 'warning');
        } else if (!support.mouseEventsSupported) {
            this.updateStatus('warning', 'CaptureController exists but mouse events are not fully supported');
            this.log('Note: Screen capture will work but mouse coordinate tracking may not be available', 'warning');
            this.log('Tip: This feature is still experimental and may require specific browser flags', 'warning');
        } else {
            this.updateStatus('success', 'All required APIs are supported including mouse events');
        }
    }
    
    async startCapture() {
        try {
            this.updateStatus('info', 'Requesting screen capture permission...');
            
            // Create capture controller if supported
            if (typeof CaptureController !== 'undefined' && this.elements.enableMouseEvents.checked) {
                this.captureController = new CaptureController();
                this.setupMouseEventHandler();
            }
            
            // Configure capture options
            const captureOptions = {
                video: {
                    cursor: this.elements.includeCursor.checked ? 'always' : 'never'
                }
            };
            
            if (this.captureController) {
                captureOptions.controller = this.captureController;
            }
            
            // Start screen capture
            this.mediaStream = await navigator.mediaDevices.getDisplayMedia(captureOptions);
            
            // Set up video element
            this.elements.capturedVideo.srcObject = this.mediaStream;
            
            // Set up stream event handlers
            this.mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
                this.log('Screen capture ended by user', 'info');
                this.stopCapture();
            });
            
            // Update UI
            this.isCapturing = true;
            this.startTime = Date.now();
            this.elements.startCapture.disabled = true;
            this.elements.startCapture.classList.add('disabled');
            this.elements.stopCapture.disabled = false;
            this.elements.stopCapture.classList.remove('disabled');
            
            this.updateStatus('success', 'Screen capture started successfully');
            this.log('Screen capture started', 'success');
            this.log(`Cursor mode: ${captureOptions.video.cursor}`, 'info');
            this.log(`Mouse events: ${this.captureController ? 'enabled' : 'disabled'}`, 'info');
            
            // Start statistics update
            this.startStatsUpdate();
            
        } catch (error) {
            this.updateStatus('error', `Failed to start capture: ${error.message}`);
            this.log(`Error: ${error.message}`, 'error');
            console.error('Capture error:', error);
        }
    }
    
    setupMouseEventHandler() {
        if (!this.captureController) return;
        
        this.captureController.oncapturedmousechange = (event) => {
            this.eventCount++;
            
            // Update mouse coordinates display
            if (event.surfaceX === -1 && event.surfaceY === -1) {
                this.elements.mouseCoords.textContent = 'X: -, Y: -';
                this.elements.mouseStatus.textContent = 'Mouse status: Outside capture area';
            } else {
                this.elements.mouseCoords.textContent = `X: ${event.surfaceX}, Y: ${event.surfaceY}`;
                this.elements.mouseStatus.textContent = 'Mouse status: Inside capture area';
            }
            
            // Log event
            const timestamp = new Date().toLocaleTimeString();
            this.log(`[${timestamp}] Mouse: (${event.surfaceX}, ${event.surfaceY})`, 'mouse');
            
            // Update event count
            this.elements.eventCount.textContent = this.eventCount;
        };
        
        this.log('Mouse event handler set up', 'info');
    }
    
    stopCapture() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        if (this.captureController) {
            this.captureController.oncapturedmousechange = null;
            this.captureController = null;
        }
        
        this.elements.capturedVideo.srcObject = null;
        this.isCapturing = false;
        
        // Update UI
        this.elements.startCapture.disabled = false;
        this.elements.startCapture.classList.remove('disabled');
        this.elements.stopCapture.disabled = true;
        this.elements.stopCapture.classList.add('disabled');
        
        // Reset mouse display
        this.elements.mouseCoords.textContent = 'X: -, Y: -';
        this.elements.mouseStatus.textContent = 'Mouse status: Not tracking';
        
        this.updateStatus('info', 'Screen capture stopped');
        this.log('Screen capture stopped', 'info');
        
        // Stop statistics update
        this.stopStatsUpdate();
    }
    
    startStatsUpdate() {
        this.statsInterval = setInterval(() => {
            if (this.isCapturing && this.startTime) {
                const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
                this.elements.captureTime.textContent = `${elapsed}s`;
                
                // Calculate approximate frame rate
                const video = this.elements.capturedVideo;
                if (video.videoWidth && video.videoHeight) {
                    this.frameCount++;
                    const now = performance.now();
                    if (this.lastFrameTime) {
                        const fps = Math.round(1000 / (now - this.lastFrameTime));
                        this.elements.frameRate.textContent = fps;
                    }
                    this.lastFrameTime = now;
                }
            }
        }, 1000);
    }
    
    stopStatsUpdate() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }
    
    clearLog() {
        this.elements.eventLog.innerHTML = '';
        this.eventCount = 0;
        this.elements.eventCount.textContent = '0';
        this.log('Event log cleared', 'info');
    }
    
    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.style.marginBottom = '2px';
        
        switch (type) {
            case 'error':
                logEntry.style.color = '#dc3545';
                break;
            case 'success':
                logEntry.style.color = '#28a745';
                break;
            case 'warning':
                logEntry.style.color = '#ffc107';
                break;
            case 'mouse':
                logEntry.style.color = '#007bff';
                break;
            default:
                logEntry.style.color = '#6c757d';
        }
        
        logEntry.textContent = `[${timestamp}] ${message}`;
        this.elements.eventLog.appendChild(logEntry);
        this.elements.eventLog.scrollTop = this.elements.eventLog.scrollHeight;
    }
    
    updateStatus(type, message) {
        this.elements.status.className = `status ${type}`;
        this.elements.status.textContent = message;
    }
}

// Initialize the test when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new CapturedMouseEventsTest();
});
