// File Manager Module
// 处理文件下载和存储管理

class FileManager {
  constructor() {
    this.downloadHistory = [];
    this.webCodecsOptimizer = null;
    this.useOptimizedExport = this.checkOptimizationSupport();
  }
  
  // 检查是否支持优化导出
  checkOptimizationSupport() {
    // 检查 WebCodecs 支持
    const webCodecsSupported = window.WebCodecsExportOptimizer && 
                              WebCodecsExportOptimizer.isSupported();
    
    // 允许用户通过设置禁用
    const userEnabled = localStorage.getItem('enableWebCodecsExport') !== 'false';
    
    if (webCodecsSupported && userEnabled) {
      console.log('✅ WebCodecs 优化导出已启用');
      return true;
    } else if (!webCodecsSupported) {
      console.log('⚠️ WebCodecs 不支持，使用标准导出');
      return false;
    } else {
      console.log('ℹ️ WebCodecs 优化已被用户禁用');
      return false;
    }
  }
  
  // 下载Blob文件（支持优化导出）
  async downloadBlob(blob, filename, options = {}) {
    try {
      if (!blob || !(blob instanceof Blob)) {
        throw new Error('无效的文件数据');
      }
      
      // 检查是否需要优化处理
      if (this.useOptimizedExport && options.optimize !== false) {
        blob = await this.optimizeBeforeDownload(blob, options);
      }
      
      if (!filename) {
        filename = this.generateFilename('recording', 'webm');
      }
      
      console.log('Starting download:', filename, 'Size:', blob.size, 'bytes');
      
      // 方法1: 尝试使用Chrome Downloads API (通过background script)
      const downloadSuccess = await this.downloadViaExtensionAPI(blob, filename);
      
      if (downloadSuccess) {
        console.log('Download completed via Extension API');
        this.addToHistory(filename, blob.size);
        return true;
      }
      
      // 方法2: 回退到浏览器下载
      console.log('Falling back to browser download');
      this.downloadViaBrowser(blob, filename);
      this.addToHistory(filename, blob.size);
      return true;
      
    } catch (error) {
      console.error('Download failed:', error);
      throw new Error('文件下载失败: ' + error.message);
    }
  }
  
  // 通过Chrome Extension API下载
  async downloadViaExtensionAPI(blob, filename) {
    let blobUrl = null;
    let response = null;
    
    try {
      // 创建blob URL
      blobUrl = URL.createObjectURL(blob);
      
      // 发送消息给background script
      response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'downloadVideo',
          data: { blobUrl, filename }
        }, (response) => {
          resolve(response || { success: false, error: '无响应' });
        });
      });
      
      if (response.success) {
        console.log('Extension API download successful, ID:', response.downloadId);
        
        // 延迟清理URL，确保下载完成
        setTimeout(() => {
          if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
          }
        }, 5000);
        
        return true;
      } else {
        console.warn('Extension API download failed:', response.error);
        return false;
      }
      
    } catch (error) {
      console.error('Extension API download error:', error);
      return false;
    } finally {
      // 如果下载失败，立即清理URL
      if (blobUrl && (!response || !response.success)) {
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
        }, 1000);
      }
    }
  }
  
  // 通过浏览器下载（回退方案）
  downloadViaBrowser(blob, filename) {
    try {
      // 创建下载链接
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      // 添加到DOM并触发点击
      document.body.appendChild(link);
      link.click();
      
      // 清理
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
      
      console.log('Browser download triggered');
      
    } catch (error) {
      console.error('Browser download failed:', error);
      throw error;
    }
  }
  
  // 生成文件名
  generateFilename(prefix = 'video', extension = 'webm') {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, -5); // 移除毫秒和时区
    
    return `${prefix}_${timestamp}.${extension}`;
  }
  
  // 生成带日期的文件名
  generateDateFilename(prefix = 'saas-recording', extension = 'webm') {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    
    return `${prefix}_${year}${month}${day}_${hour}${minute}${second}.${extension}`;
  }
  
  // 添加到下载历史
  addToHistory(filename, fileSize) {
    const record = {
      filename,
      fileSize,
      timestamp: Date.now(),
      date: new Date().toISOString()
    };
    
    this.downloadHistory.push(record);
    
    // 只保留最近10个记录
    if (this.downloadHistory.length > 10) {
      this.downloadHistory = this.downloadHistory.slice(-10);
    }
    
    console.log('Added to download history:', record);
  }
  
  // 获取下载历史
  getDownloadHistory() {
    return [...this.downloadHistory];
  }
  
  // 格式化文件大小
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  // 验证文件类型
  validateFileType(blob, expectedTypes = ['video/webm', 'video/mp4']) {
    if (!blob || !blob.type) {
      return false;
    }
    
    return expectedTypes.includes(blob.type);
  }
  
  // 检查文件大小限制
  checkFileSizeLimit(blob, maxSizeMB = 100) {
    if (!blob) {
      return false;
    }
    
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    return blob.size <= maxSizeBytes;
  }
  
  // 获取文件信息
  getFileInfo(blob, filename) {
    return {
      filename: filename || 'unknown',
      size: blob ? blob.size : 0,
      sizeFormatted: blob ? this.formatFileSize(blob.size) : '0 Bytes',
      type: blob ? blob.type : 'unknown',
      isValid: this.validateFileType(blob),
      withinSizeLimit: this.checkFileSizeLimit(blob)
    };
  }
  
  // 优化视频后再下载
  async optimizeBeforeDownload(blob, options = {}) {
    try {
      console.log('🚀 开始优化视频导出...');
      const startTime = performance.now();
      
      // 初始化优化器
      if (!this.webCodecsOptimizer) {
        this.webCodecsOptimizer = new WebCodecsExportOptimizer();
      }
      
      // 配置优化选项
      const optimizeOptions = {
        quality: options.quality || 'high',
        format: options.format || 'webm',
        resolution: options.resolution || null,
        bitrate: options.bitrate || 'auto',
        progressCallback: options.progressCallback
      };
      
      // 执行优化
      const result = await this.webCodecsOptimizer.optimizedExport(
        blob, 
        optimizeOptions
      );
      
      const processingTime = performance.now() - startTime;
      
      // 记录优化结果
      console.log('✅ 视频优化完成:', {
        originalSize: this.formatFileSize(blob.size),
        optimizedSize: this.formatFileSize(result.blob.size),
        compression: `${result.compression.toFixed(1)}%`,
        time: `${processingTime.toFixed(0)}ms`
      });
      
      // 如果启用了智能导出管理器，使用它进行二次优化
      if (window.SmartExportManager && options.useSmartExport) {
        const smartManager = new SmartExportManager();
        const smartResult = await smartManager.smartExport(result.blob, {
          quality: options.quality || 'high',
          maxFileSize: options.maxFileSize,
          progressCallback: options.progressCallback
        });
        return smartResult.blob;
      }
      
      return result.blob;
      
    } catch (error) {
      console.error('优化失败，使用原始文件:', error);
      // 优化失败时返回原始文件
      return blob;
    }
  }
  
  // 批量优化导出
  async batchOptimizedDownload(blobs, options = {}) {
    const results = [];
    
    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const filename = options.filenames?.[i] || this.generateFilename(`video_${i + 1}`, 'webm');
      
      console.log(`处理视频 ${i + 1}/${blobs.length}`);
      
      // 优化并下载
      const optimizedBlob = await this.optimizeBeforeDownload(blob, {
        ...options,
        progressCallback: (progress, message) => {
          const overallProgress = (i / blobs.length + progress / 100 / blobs.length) * 100;
          options.progressCallback?.(overallProgress, `视频 ${i + 1}: ${message}`);
        }
      });
      
      await this.downloadBlob(optimizedBlob, filename, { optimize: false });
      results.push({ filename, size: optimizedBlob.size });
    }
    
    return results;
  }
  
  // 获取优化器状态
  getOptimizerStatus() {
    return {
      supported: WebCodecsExportOptimizer?.isSupported() || false,
      enabled: this.useOptimizedExport,
      metrics: this.webCodecsOptimizer?.getMetrics() || null
    };
  }
  
  // 切换优化导出开关
  toggleOptimizedExport(enabled) {
    this.useOptimizedExport = enabled;
    localStorage.setItem('enableWebCodecsExport', enabled ? 'true' : 'false');
    console.log(`WebCodecs 优化导出已${enabled ? '启用' : '禁用'}`);
  }
  
  // 清理临时文件和资源
  cleanup() {
    try {
      // 清理下载历史（可选）
      // this.downloadHistory = [];
      
      console.log('FileManager cleanup completed');
      
    } catch (error) {
      console.error('FileManager cleanup error:', error);
    }
  }
}

// 导出FileManager类
window.FileManager = FileManager;