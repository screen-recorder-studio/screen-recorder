// 元素录制集成工具
// 用于处理元素录制数据与主系统的集成

export interface ElementRecordingData {
  encodedChunks: Array<{
    data: Uint8Array
    timestamp: number
    type: 'key' | 'delta'
    size: number
    codedWidth: number
    codedHeight: number
    codec: string
  }>
  metadata: {
    mode: 'element' | 'region'
    selectedElement?: string
    selectedRegion?: {
      width: number
      height: number
      x: number
      y: number
    }
    startTime: number
    codec: string
    width: number
    height: number
    framerate: number
    transferTime?: number
    source: string
  }
}

export class ElementRecordingIntegration {
  private static instance: ElementRecordingIntegration
  private listeners: Array<(data: ElementRecordingData) => void> = []

  static getInstance(): ElementRecordingIntegration {
    if (!ElementRecordingIntegration.instance) {
      ElementRecordingIntegration.instance = new ElementRecordingIntegration()
    }
    return ElementRecordingIntegration.instance
  }

  // 注册数据接收监听器
  onDataReceived(callback: (data: ElementRecordingData) => void): void {
    this.listeners.push(callback)
  }

  // 移除监听器
  removeListener(callback: (data: ElementRecordingData) => void): void {
    const index = this.listeners.indexOf(callback)
    if (index > -1) {
      this.listeners.splice(index, 1)
    }
  }

  // 处理接收到的元素录制数据
  handleRecordingData(data: ElementRecordingData): void {
    console.log('🎬 [ElementRecordingIntegration] Processing recording data:', {
      chunks: data.encodedChunks.length,
      mode: data.metadata.mode,
      source: data.metadata.source
    })

    // 验证数据完整性
    if (!this.validateData(data)) {
      console.error('❌ [ElementRecordingIntegration] Invalid recording data')
      return
    }

    // 通知所有监听器
    this.listeners.forEach(listener => {
      try {
        listener(data)
      } catch (error) {
        console.error('❌ [ElementRecordingIntegration] Listener error:', error)
      }
    })
  }

  // 验证录制数据
  private validateData(data: ElementRecordingData): boolean {
    if (!data.encodedChunks || data.encodedChunks.length === 0) {
      console.error('❌ [ElementRecordingIntegration] No encoded chunks')
      return false
    }

    if (!data.metadata) {
      console.error('❌ [ElementRecordingIntegration] No metadata')
      return false
    }

    // 验证每个数据块
    for (const chunk of data.encodedChunks) {
      if (!chunk.data || chunk.data.length === 0) {
        console.error('❌ [ElementRecordingIntegration] Invalid chunk data')
        return false
      }
      
      if (typeof chunk.timestamp !== 'number') {
        console.error('❌ [ElementRecordingIntegration] Invalid chunk timestamp')
        return false
      }
    }

    return true
  }

  // 转换为主系统兼容格式
  // convertToMainSystemFormat(data: ElementRecordingData): any[] {
  //   // console.log('🔄 [ElementRecordingIntegration] Converting to main system format:', {
  //   //   totalChunks: data.encodedChunks.length,
  //   //   mode: data.metadata.mode,
  //   //   metadataWidth: data.metadata.width,
  //   //   metadataHeight: data.metadata.height,
  //   //   selectedRegion: data.metadata.selectedRegion
  //   // });

  //   // 🚨 重要：检查是否为区域录制
  //   // const sr = data.metadata.selectedRegion;
  //   // const isRegionRecording = data.metadata.mode === 'region' && !!sr;
  //   // if (isRegionRecording && sr) {
  //   //   console.log('🎯 [ElementRecordingIntegration] REGION RECORDING DETECTED! Will use selectedRegion dimensions:', {
  //   //     selectedWidth: sr.width,
  //   //     selectedHeight: sr.height,
  //   //     selectedAspectRatio: (sr.width / sr.height).toFixed(3),
  //   //     metadataWidth: data.metadata.width,
  //   //     metadataHeight: data.metadata.height,
  //   //     metadataAspectRatio: (data.metadata.width / data.metadata.height).toFixed(3)
  //   //   });
  //   // }

  //   return data.encodedChunks.map((chunk) => {
  //     // 确保数据格式兼容
  //     let processedData = chunk.data;

  //     // 如果数据是 Uint8Array，保持原样
  //     // 主系统的 VideoPreviewComposite 会处理格式转换
  //     if (!(chunk.data instanceof Uint8Array)) {
  //       console.warn('⚠️ [ElementRecordingIntegration] Unexpected data format:', typeof chunk.data);
  //       // 尝试转换为 Uint8Array
  //       const anyData: any = chunk.data;
  //       if (anyData instanceof ArrayBuffer) {
  //         processedData = new Uint8Array(anyData);
  //       } else if (Array.isArray(anyData)) {
  //         processedData = new Uint8Array(anyData);
  //       }
  //     }

  //     const codedWidth = data.metadata.selectedRegion?.width;
  //     const codedHeight = data.metadata.selectedRegion?.height;

  //     return {
  //       data: processedData,
  //       timestamp: chunk.timestamp,
  //       type: chunk.type,
  //       size: chunk.size,
  //       codedWidth: codedWidth,
  //       codedHeight: codedHeight,
  //       codec: chunk.codec
  //     };
  //   });
  // }

  // 获取录制摘要信息
  getRecordingSummary(data: ElementRecordingData): {
    totalChunks: number
    totalSize: number
    duration: number
    resolution: string
    mode: string
  } {
    const totalSize = data.encodedChunks.reduce((sum, chunk) => sum + chunk.size, 0)
    const firstTimestamp = data.encodedChunks[0]?.timestamp || 0
    const lastTimestamp = data.encodedChunks[data.encodedChunks.length - 1]?.timestamp || 0
    const duration = (lastTimestamp - firstTimestamp) / 1000000 // 微秒转秒

    return {
      totalChunks: data.encodedChunks.length,
      totalSize,
      duration,
      resolution: `${data.metadata.width}x${data.metadata.height}`,
      mode: data.metadata.mode
    }
  }
}

// 导出单例实例
export const elementRecordingIntegration = ElementRecordingIntegration.getInstance()
