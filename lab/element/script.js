class ElementRecorder {
    constructor() {
        this.isSelectionMode = false;
        this.selectedElement = null;
        this.currentStream = null;
        this.currentTrack = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.hoveredElement = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.checkAPISupport();
        this.startAnimations();
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
        this.toggleSelectionBtn.addEventListener('click', () => this.toggleSelectionMode());
        this.startRecordBtn.addEventListener('click', () => this.startRecording());
        this.stopRecordBtn.addEventListener('click', () => this.stopRecording());
        this.clearSelectionBtn.addEventListener('click', () => this.clearSelection());
        
        // Mouse events for element selection
        document.addEventListener('mouseover', (e) => this.handleMouseOver(e));
        document.addEventListener('mouseout', (e) => this.handleMouseOut(e));
        document.addEventListener('click', (e) => this.handleClick(e));
        
        // Prevent default behavior on demo buttons
        document.querySelector('.demo-button').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showMessage('Demo button clicked!');
        });
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
        
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => track.stop());
            this.currentStream = null;
            this.currentTrack = null;
        }
        
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
        
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `element-recording-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        this.recordedChunks = [];
        
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
        setInterval(() => {
            counter++;
            counterElement.textContent = `Counter: ${counter}`;
        }, 1000);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ElementRecorder();
});
