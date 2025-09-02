// gif.js - 简化的 GIF 编码器占位文件
// 这是一个临时的占位实现，实际使用时需要下载完整的 gif.js 库
// 下载地址: https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js

(function(global) {
  'use strict';

  // GIF 编码器类
  class GIF {
    constructor(options = {}) {
      this.options = {
        workers: options.workers || 2,
        quality: options.quality || 10,
        width: options.width || 256,
        height: options.height || 256,
        workerScript: options.workerScript || 'gif.worker.js',
        background: options.background || '#000',
        transparent: options.transparent || null
      };
      
      this.frames = [];
      this.listeners = {};
      this.running = false;
    }

    // 添加帧
    addFrame(ctx, options = {}) {
      if (!(ctx instanceof CanvasRenderingContext2D)) {
        throw new Error('First argument must be a CanvasRenderingContext2D');
      }
      
      const imageData = ctx.getImageData(0, 0, this.options.width, this.options.height);
      
      this.frames.push({
        data: imageData,
        delay: options.delay || 100,
        copy: options.copy || false,
        dispose: options.dispose || -1
      });
      
      console.log(`Added frame ${this.frames.length}, delay: ${options.delay}ms`);
    }

    // 渲染 GIF
    render() {
      if (this.running) {
        throw new Error('Already running');
      }
      
      this.running = true;
      console.log('Starting GIF render with', this.frames.length, 'frames');
      
      // 模拟异步渲染过程
      setTimeout(() => {
        try {
          // 创建一个模拟的 GIF blob
          const gifData = this.createMockGIF();
          const blob = new Blob([gifData], { type: 'image/gif' });
          
          // 触发进度事件
          this.emit('progress', 1.0);
          
          // 触发完成事件
          this.emit('finished', blob);
          
          this.running = false;
          console.log('GIF render complete, size:', blob.size);
        } catch (error) {
          console.error('GIF render error:', error);
          this.emit('error', error);
          this.running = false;
        }
      }, 1000); // 模拟1秒的处理时间
    }

    // 创建模拟的 GIF 数据
    createMockGIF() {
      // GIF89a 文件头
      const header = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
        this.options.width & 0xFF, (this.options.width >> 8) & 0xFF, // 宽度
        this.options.height & 0xFF, (this.options.height >> 8) & 0xFF, // 高度
        0xF7, // 全局颜色表标志
        0x00, // 背景色索引
        0x00  // 像素宽高比
      ]);
      
      // 简化的全局颜色表（256色）
      const colorTable = new Uint8Array(768); // 256 * 3
      for (let i = 0; i < 256; i++) {
        colorTable[i * 3] = i;     // R
        colorTable[i * 3 + 1] = i; // G
        colorTable[i * 3 + 2] = i; // B
      }
      
      // 图像数据（简化版，只包含一个帧）
      const imageData = new Uint8Array([
        0x21, 0xF9, 0x04, 0x00, 0x0A, 0x00, 0xFF, 0x00, // 图形控制扩展
        0x2C, // 图像分隔符
        0x00, 0x00, 0x00, 0x00, // 左、上位置
        this.options.width & 0xFF, (this.options.width >> 8) & 0xFF, // 宽度
        this.options.height & 0xFF, (this.options.height >> 8) & 0xFF, // 高度
        0x00, // 局部颜色表标志
        0x02, // LZW 最小码表大小
        0x02, 0x44, 0x01, 0x00 // 简化的图像数据
      ]);
      
      // 文件结束标记
      const trailer = new Uint8Array([0x3B]);
      
      // 合并所有数据
      const totalLength = header.length + colorTable.length + imageData.length + trailer.length;
      const gifData = new Uint8Array(totalLength);
      let offset = 0;
      
      gifData.set(header, offset);
      offset += header.length;
      
      gifData.set(colorTable, offset);
      offset += colorTable.length;
      
      gifData.set(imageData, offset);
      offset += imageData.length;
      
      gifData.set(trailer, offset);
      
      return gifData;
    }

    // 事件监听
    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
    }

    // 触发事件
    emit(event, ...args) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(callback => {
          callback(...args);
        });
      }
    }

    // 中止渲染
    abort() {
      this.running = false;
      this.frames = [];
    }
  }

  // 导出到全局
  global.GIF = GIF;
  
  // 如果是模块环境
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GIF;
  }
  
})(typeof window !== 'undefined' ? window : this);
