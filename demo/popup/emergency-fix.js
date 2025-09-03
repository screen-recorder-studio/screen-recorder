// 紧急修复脚本 - 禁用有问题的 WebCodecs 优化
// 这个脚本应该在所有其他脚本之后加载

console.log('🚨 应用紧急修复...');

// 方案1：完全禁用 WebCodecs 优化
if (window.FileManager) {
  // 覆盖 FileManager 的优化检查，强制返回 false
  FileManager.prototype.checkOptimizationSupport = function() {
    console.log('⚠️ WebCodecs 优化已被紧急修复禁用');
    return false;
  };
  
  // 如果已经有实例，更新它们
  if (window.fileManager) {
    window.fileManager.useOptimizedExport = false;
  }
}

// 方案2：替换有问题的 WebCodecsExportOptimizer
if (window.WebCodecsExportOptimizer) {
  // 用一个简单的直通实现替换
  window.WebCodecsExportOptimizer = class WebCodecsExportOptimizerDisabled {
    static isSupported() {
      return false; // 报告不支持
    }
    
    async optimizedExport(blob, options) {
      console.log('WebCodecs 优化已禁用，返回原始文件');
      return {
        blob: blob,
        metrics: {},
        compression: 0
      };
    }
    
    getMetrics() {
      return {};
    }
  };
}

// 方案3：通过 localStorage 禁用
localStorage.setItem('enableWebCodecsExport', 'false');

console.log('✅ 紧急修复已应用：');
console.log('- WebCodecs 优化已禁用');
console.log('- 视频将使用标准方式下载');
console.log('- 所有导出的视频应该可以正常播放');

// 显示用户提示
if (typeof alert !== 'undefined' && window.location.href.includes('recorder.html')) {
  setTimeout(() => {
    console.log('提示：WebCodecs 优化功能暂时禁用，视频导出功能正常');
  }, 1000);
}
