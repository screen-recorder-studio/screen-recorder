// Recorder page initialization script
// 等待DOM和PopupController加载完成
document.addEventListener('DOMContentLoaded', () => {
    console.log('[RecorderInit] DOM loaded, checking PopupController...');
    
    // 确保PopupController已定义
    if (typeof PopupController === 'undefined') {
        console.error('[RecorderInit] PopupController not defined');
        return;
    }

    console.log('[RecorderInit] PopupController found, extending methods...');

    // 在独立页面中显示大号计时器
    const originalStartTimer = PopupController.prototype.startRecordingTimer;
    PopupController.prototype.startRecordingTimer = function() {
        originalStartTimer.call(this);
        const timerEl = document.getElementById('recording-timer');
        const statusEl = document.getElementById('status-large');
        if (timerEl) timerEl.style.display = 'block';
        if (statusEl) statusEl.style.display = 'none';
    };
    
    const originalUpdateTime = PopupController.prototype.updateRecordingTime;
    PopupController.prototype.updateRecordingTime = function(duration) {
        originalUpdateTime.call(this, duration);
        const seconds = Math.floor(duration / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        const timeString = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        const timerEl = document.getElementById('recording-timer');
        if (timerEl) timerEl.textContent = timeString;
    };
    
    const originalReset = PopupController.prototype.reset;
    PopupController.prototype.reset = function() {
        originalReset.call(this);
        const timerEl = document.getElementById('recording-timer');
        const statusEl = document.getElementById('status-large');
        if (timerEl) timerEl.style.display = 'none';
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.textContent = '准备录制';
        }
    };
    
    console.log('[RecorderInit] Methods extended successfully');
});
