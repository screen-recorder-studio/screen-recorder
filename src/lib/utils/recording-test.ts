// 录制功能测试工具
import { recordingService } from '../services/recording-service'
import { recordingStore } from '../stores/recording.svelte'
import type { RecordingOptions } from '../types/recording'

export class RecordingTest {
  private testResults: Array<{
    test: string
    passed: boolean
    error?: string
    duration?: number
  }> = []

  // 运行所有测试
  async runAllTests(): Promise<void> {
    console.log('🧪 Starting recording system tests...')
    
    await this.testEnvironmentCheck()
    await this.testStoreOperations()
    await this.testServiceInitialization()
    await this.testRecordingFlow()
    
    this.printResults()
  }

  // 测试环境检查
  async testEnvironmentCheck(): Promise<void> {
    const startTime = performance.now()
    
    try {
      const env = await recordingService.checkEnvironment()
      
      this.testResults.push({
        test: 'Environment Check',
        passed: env.isReady,
        error: env.issues.length > 0 ? env.issues.join(', ') : undefined,
        duration: performance.now() - startTime
      })
      
      console.log('📊 Environment check:', env)
      
    } catch (error) {
      this.testResults.push({
        test: 'Environment Check',
        passed: false,
        error: (error as Error).message,
        duration: performance.now() - startTime
      })
    }
  }

  // 测试状态管理
  async testStoreOperations(): Promise<void> {
    const startTime = performance.now()
    
    try {
      // 测试初始状态
      const initialState = recordingStore.state
      if (initialState.status !== 'idle') {
        throw new Error('Initial state should be idle')
      }

      // 测试状态更新
      recordingStore.updateStatus('requesting')
      if (recordingStore.state.status !== 'requesting') {
        throw new Error('Status update failed')
      }

      // 测试选项更新
      recordingStore.updateOptions({ videoQuality: 'high' })
      if (recordingStore.options.videoQuality !== 'high') {
        throw new Error('Options update failed')
      }

      // 测试重置
      recordingStore.reset()
      const resetState = recordingStore.state
      if (resetState.status !== 'idle') {
        throw new Error('Reset failed')
      }

      this.testResults.push({
        test: 'Store Operations',
        passed: true,
        duration: performance.now() - startTime
      })
      
    } catch (error) {
      this.testResults.push({
        test: 'Store Operations',
        passed: false,
        error: (error as Error).message,
        duration: performance.now() - startTime
      })
    }
  }

  // 测试服务初始化
  async testServiceInitialization(): Promise<void> {
    const startTime = performance.now()
    
    try {
      // 测试服务状态
      const state = recordingService.getState()
      if (!state) {
        throw new Error('Service state not available')
      }

      // 测试性能监控
      const metrics = recordingService.getPerformanceMetrics()
      if (!metrics) {
        throw new Error('Performance metrics not available')
      }

      // 测试性能建议
      const advice = recordingService.getPerformanceAdvice()
      if (!Array.isArray(advice)) {
        throw new Error('Performance advice not available')
      }

      this.testResults.push({
        test: 'Service Initialization',
        passed: true,
        duration: performance.now() - startTime
      })
      
    } catch (error) {
      this.testResults.push({
        test: 'Service Initialization',
        passed: false,
        error: (error as Error).message,
        duration: performance.now() - startTime
      })
    }
  }

  // 测试录制流程（模拟）
  async testRecordingFlow(): Promise<void> {
    const startTime = performance.now()
    
    try {
      // 注意：这是一个模拟测试，不会实际开始录制
      // 因为需要用户权限和真实的媒体流
      
      // 测试录制选项
      const options: RecordingOptions = {
        includeAudio: false,
        videoQuality: 'medium',
        maxDuration: 60,
        preferredEngine: 'mediarecorder',
        codec: 'vp9',
        framerate: 30,
        useWorkers: true
      }

      // 更新选项
      recordingStore.updateOptions(options)
      
      // 验证选项设置
      const currentOptions = recordingStore.options
      if (currentOptions.videoQuality !== 'medium') {
        throw new Error('Options not set correctly')
      }

      // 模拟状态变化
      recordingStore.updateStatus('requesting')
      recordingStore.updateStatus('recording')
      recordingStore.updateDuration(10)
      recordingStore.updateProgress({
        encodedChunks: 10,
        processedFrames: 300,
        encodedFrames: 300,
        fileSize: 1024 * 1024, // 1MB
        fps: 30,
        bitrate: 2000000, // 2Mbps
        cpuUsage: 45
      })
      recordingStore.updateStatus('completed')

      // 验证最终状态
      if (recordingStore.state.status !== 'completed') {
        throw new Error('Recording flow simulation failed')
      }

      this.testResults.push({
        test: 'Recording Flow (Simulated)',
        passed: true,
        duration: performance.now() - startTime
      })
      
    } catch (error) {
      this.testResults.push({
        test: 'Recording Flow (Simulated)',
        passed: false,
        error: (error as Error).message,
        duration: performance.now() - startTime
      })
    } finally {
      // 清理状态
      recordingStore.reset()
    }
  }

  // 打印测试结果
  private printResults(): void {
    console.log('\n🧪 Test Results:')
    console.log('================')
    
    let passed = 0
    let failed = 0
    
    this.testResults.forEach(result => {
      const status = result.passed ? '✅' : '❌'
      const duration = result.duration ? ` (${result.duration.toFixed(2)}ms)` : ''
      const error = result.error ? ` - ${result.error}` : ''
      
      console.log(`${status} ${result.test}${duration}${error}`)
      
      if (result.passed) {
        passed++
      } else {
        failed++
      }
    })
    
    console.log('================')
    console.log(`Total: ${this.testResults.length}, Passed: ${passed}, Failed: ${failed}`)
    
    if (failed === 0) {
      console.log('🎉 All tests passed!')
    } else {
      console.log(`⚠️ ${failed} test(s) failed`)
    }
  }

  // 获取测试结果
  getResults() {
    return {
      total: this.testResults.length,
      passed: this.testResults.filter(r => r.passed).length,
      failed: this.testResults.filter(r => !r.passed).length,
      results: this.testResults
    }
  }

  // 清理测试结果
  clear(): void {
    this.testResults = []
  }
}

// 创建测试实例
export const recordingTest = new RecordingTest()

// 便捷的测试运行函数
export async function runRecordingTests(): Promise<void> {
  await recordingTest.runAllTests()
}

// 快速环境检查
export async function quickEnvironmentCheck(): Promise<boolean> {
  try {
    const env = await recordingService.checkEnvironment()
    console.log('🔍 Quick environment check:', env.isReady ? '✅ Ready' : '❌ Not ready')
    if (!env.isReady) {
      console.log('Issues:', env.issues)
    }
    return env.isReady
  } catch (error) {
    console.error('❌ Environment check failed:', error)
    return false
  }
}
