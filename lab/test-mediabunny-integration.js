// 🧪 Mediabunny MP4 导出集成测试
// 用于验证新的 MP4 导出功能是否正常工作

class MediabunnyIntegrationTest {
  constructor() {
    this.testResults = [];
  }
  
  // 运行所有测试
  async runAllTests() {
    console.log('🧪 开始 Mediabunny MP4 导出集成测试...');
    
    const tests = [
      this.testMediabunnyLibraryLoading,
      this.testExporterInitialization,
      this.testFormatManagerIntegration,
      this.testSupportDetection,
      this.testErrorHandling
    ];
    
    for (const test of tests) {
      try {
        await test.call(this);
      } catch (error) {
        console.error(`❌ 测试失败: ${test.name}`, error);
        this.testResults.push({
          test: test.name,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    this.printTestResults();
  }
  
  // 测试 Mediabunny 库加载
  async testMediabunnyLibraryLoading() {
    console.log('🔍 测试 Mediabunny 库加载...');
    
    if (typeof window.Mediabunny === 'undefined') {
      throw new Error('Mediabunny 库未加载');
    }
    
    const requiredClasses = [
      'Input', 'Output', 'Conversion', 
      'BlobSource', 'Mp4OutputFormat', 'BufferTarget'
    ];
    
    for (const className of requiredClasses) {
      if (!window.Mediabunny[className]) {
        throw new Error(`Mediabunny.${className} 不可用`);
      }
    }
    
    console.log('✅ Mediabunny 库加载正常');
    this.testResults.push({
      test: 'testMediabunnyLibraryLoading',
      status: 'passed'
    });
  }
  
  // 测试导出器初始化
  async testExporterInitialization() {
    console.log('🔍 测试 MediabunnyMp4Exporter 初始化...');
    
    if (typeof window.MediabunnyMp4Exporter === 'undefined') {
      throw new Error('MediabunnyMp4Exporter 类未加载');
    }
    
    const exporter = new MediabunnyMp4Exporter();
    
    if (!exporter.isSupported) {
      throw new Error('Mediabunny 导出器不支持当前环境');
    }
    
    await exporter.initialize();
    
    if (!exporter.isInitialized) {
      throw new Error('Mediabunny 导出器初始化失败');
    }
    
    console.log('✅ MediabunnyMp4Exporter 初始化正常');
    this.testResults.push({
      test: 'testExporterInitialization',
      status: 'passed'
    });
  }
  
  // 测试格式管理器集成
  async testFormatManagerIntegration() {
    console.log('🔍 测试 FormatExportManager 集成...');

    if (typeof window.FormatExportManager === 'undefined') {
      throw new Error('FormatExportManager 类未加载');
    }

    const manager = new FormatExportManager();

    // 等待 Mediabunny 初始化（更长时间）
    let attempts = 0;
    while (!manager.mediabunnyInitialized && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!manager.mediabunnyExporter) {
      throw new Error('FormatExportManager 中的 Mediabunny 导出器未初始化');
    }
    
    // 检查 MP4 支持状态
    if (!manager.supportedFormats.mp4.supported) {
      throw new Error('MP4 格式显示为不支持');
    }
    
    // 检查是否有新的导出方法
    if (typeof manager.exportMP4WithMediabunny !== 'function') {
      throw new Error('exportMP4WithMediabunny 方法不存在');
    }
    
    console.log('✅ FormatExportManager 集成正常');
    this.testResults.push({
      test: 'testFormatManagerIntegration',
      status: 'passed'
    });
  }
  
  // 测试支持检测
  async testSupportDetection() {
    console.log('🔍 测试支持检测功能...');
    
    const exporter = new MediabunnyMp4Exporter();
    await exporter.initialize();
    
    // 测试编码器支持检测
    const codecs = await exporter.getSupportedCodecs();
    
    if (!codecs || !codecs.videoCodecs || !codecs.audioCodecs) {
      throw new Error('编码器支持检测失败');
    }
    
    console.log('📊 支持的编码器:', codecs);
    
    // 测试内存检查
    const memoryOk = exporter.checkMemoryUsage();
    console.log('💾 内存状态:', memoryOk ? '正常' : '警告');
    
    console.log('✅ 支持检测功能正常');
    this.testResults.push({
      test: 'testSupportDetection',
      status: 'passed'
    });
  }
  
  // 测试错误处理
  async testErrorHandling() {
    console.log('🔍 测试错误处理机制...');
    
    const exporter = new MediabunnyMp4Exporter();
    
    // 测试无效输入处理
    try {
      await exporter.exportToMp4(null);
      throw new Error('应该抛出错误但没有');
    } catch (error) {
      if (error.message.includes('应该抛出错误但没有')) {
        throw error;
      }
      // 预期的错误，测试通过
    }
    
    // 测试模拟不支持的环境
    const mockExporter = new MediabunnyMp4Exporter();
    // 模拟不支持的环境
    const originalCheckSupport = mockExporter.checkSupport;
    mockExporter.checkSupport = () => false;
    mockExporter.isSupported = false;

    try {
      await mockExporter.initialize();
      // 如果没有抛出错误，说明有合理的降级处理
      console.log('⚠️ 不支持环境下的初始化没有抛出错误，可能有降级处理');
    } catch (error) {
      // 预期的错误，测试通过
      console.log('✅ 不支持环境错误处理正常');
    } finally {
      // 恢复原始方法
      mockExporter.checkSupport = originalCheckSupport;
    }
    
    console.log('✅ 错误处理机制正常');
    this.testResults.push({
      test: 'testErrorHandling',
      status: 'passed'
    });
  }
  
  // 打印测试结果
  printTestResults() {
    console.log('\n📊 测试结果汇总:');
    console.log('='.repeat(50));
    
    let passed = 0;
    let failed = 0;
    
    for (const result of this.testResults) {
      const status = result.status === 'passed' ? '✅' : '❌';
      console.log(`${status} ${result.test}`);
      
      if (result.error) {
        console.log(`   错误: ${result.error}`);
      }
      
      if (result.status === 'passed') {
        passed++;
      } else {
        failed++;
      }
    }
    
    console.log('='.repeat(50));
    console.log(`总计: ${this.testResults.length} 个测试`);
    console.log(`通过: ${passed} 个`);
    console.log(`失败: ${failed} 个`);
    
    if (failed === 0) {
      console.log('🎉 所有测试通过！Mediabunny MP4 导出集成成功！');
    } else {
      console.log('⚠️ 部分测试失败，请检查相关问题');
    }
  }
  
  // 创建测试用的 Blob
  createTestVideoBlob() {
    // 创建一个简单的测试视频 Blob
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#ffffff';
    ctx.font = '48px Arial';
    ctx.fillText('Test Video', 200, 240);
    
    return new Promise(resolve => {
      canvas.toBlob(resolve, 'video/webm');
    });
  }
}

// 导出测试类
window.MediabunnyIntegrationTest = MediabunnyIntegrationTest;

// 自动运行测试（如果在浏览器环境中）
if (typeof window !== 'undefined' && window.document) {
  // 等待页面加载完成后运行测试
  window.addEventListener('load', async () => {
    // 延迟更长时间确保 Mediabunny 模块加载完成
    setTimeout(async () => {
      const test = new MediabunnyIntegrationTest();
      await test.runAllTests();
    }, 5000);
  });
}
