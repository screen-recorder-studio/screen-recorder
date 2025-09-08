// 数据格式验证工具
// 用于验证和调试录制数据格式

export interface ChunkValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  format: 'uint8array' | 'arraybuffer' | 'typed-array' | 'unknown'
  size: number
}

export class DataFormatValidator {
  // 验证单个数据块
  static validateChunk(chunk: any): ChunkValidationResult {
    const result: ChunkValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      format: 'unknown',
      size: 0
    }

    // 检查基本属性
    if (!chunk) {
      result.errors.push('Chunk is null or undefined')
      result.isValid = false
      return result
    }

    if (!chunk.data) {
      result.errors.push('Chunk.data is missing')
      result.isValid = false
      return result
    }

    if (typeof chunk.timestamp !== 'number') {
      result.errors.push('Chunk.timestamp is not a number')
      result.isValid = false
    }

    if (!chunk.type || (chunk.type !== 'key' && chunk.type !== 'delta')) {
      result.errors.push('Chunk.type must be "key" or "delta"')
      result.isValid = false
    }

    // 检查数据格式
    if (chunk.data instanceof Uint8Array) {
      result.format = 'uint8array'
      result.size = chunk.data.length
    } else if (chunk.data instanceof ArrayBuffer) {
      result.format = 'arraybuffer'
      result.size = chunk.data.byteLength
    } else if (Array.isArray(chunk.data)) {
      result.format = 'array'
      result.size = chunk.data.length
      // 验证数组元素
      if (!chunk.data.every(v => typeof v === 'number' && v >= 0 && v <= 255)) {
        result.warnings.push('Array contains invalid byte values')
      }
    } else if (chunk.data && typeof chunk.data === 'object' && 'buffer' in chunk.data) {
      result.format = 'typed-array'
      result.size = chunk.data.byteLength || 0
    } else {
      result.errors.push(`Unknown data format: ${typeof chunk.data}`)
      result.isValid = false
    }

    // 检查尺寸信息
    if (typeof chunk.codedWidth !== 'number' || chunk.codedWidth <= 0) {
      result.warnings.push('Invalid or missing codedWidth')
    }

    if (typeof chunk.codedHeight !== 'number' || chunk.codedHeight <= 0) {
      result.warnings.push('Invalid or missing codedHeight')
    }

    return result
  }

  // 验证数据块数组
  static validateChunks(chunks: any[]): {
    isValid: boolean
    totalErrors: number
    totalWarnings: number
    chunkResults: ChunkValidationResult[]
    summary: {
      totalChunks: number
      validChunks: number
      totalSize: number
      formats: Record<string, number>
    }
  } {
    if (!Array.isArray(chunks)) {
      return {
        isValid: false,
        totalErrors: 1,
        totalWarnings: 0,
        chunkResults: [],
        summary: {
          totalChunks: 0,
          validChunks: 0,
          totalSize: 0,
          formats: {}
        }
      }
    }

    const chunkResults = chunks.map(chunk => this.validateChunk(chunk))
    const validChunks = chunkResults.filter(r => r.isValid).length
    const totalErrors = chunkResults.reduce((sum, r) => sum + r.errors.length, 0)
    const totalWarnings = chunkResults.reduce((sum, r) => sum + r.warnings.length, 0)
    const totalSize = chunkResults.reduce((sum, r) => sum + r.size, 0)
    
    const formats: Record<string, number> = {}
    chunkResults.forEach(r => {
      formats[r.format] = (formats[r.format] || 0) + 1
    })

    return {
      isValid: totalErrors === 0,
      totalErrors,
      totalWarnings,
      chunkResults,
      summary: {
        totalChunks: chunks.length,
        validChunks,
        totalSize,
        formats
      }
    }
  }

  // 转换数据格式
  static convertToUint8Array(data: any): Uint8Array | null {
    try {
      if (data instanceof Uint8Array) {
        return data
      }

      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data)
      }

      if (data && typeof data === 'object' && 'buffer' in data) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      }

      if (Array.isArray(data)) {
        // 验证数组元素都是有效的字节值
        if (data.every(v => typeof v === 'number' && v >= 0 && v <= 255)) {
          return new Uint8Array(data);
        } else {
          console.warn('⚠️ [DataFormatValidator] Array contains invalid byte values');
          return null;
        }
      }

      // 处理序列化后的 ArrayBuffer 或 Uint8Array 对象
      if (data && typeof data === 'object') {
        // 方法1：尝试从 Object.values 获取数据（最常见的序列化形式）
        const values = Object.values(data);
        if (values.length > 0 && values.every(v => typeof v === 'number' && v >= 0 && v <= 255)) {
          return new Uint8Array(values);
        }

        // 方法2：尝试从索引属性重建（适用于类数组对象）
        if (data.length !== undefined && typeof data.length === 'number' && data.length > 0) {
          const values = [];
          for (let i = 0; i < data.length; i++) {
            if (data[i] !== undefined && typeof data[i] === 'number') {
              values.push(data[i]);
            }
          }
          if (values.length > 0) {
            return new Uint8Array(values);
          }
        }

        // 方法3：检查是否有嵌套的数据属性
        if (data.data) {
          return this.convertToUint8Array(data.data);
        }

        // 方法4：尝试从 buffer 属性重建
        if (data.buffer && data.byteOffset !== undefined && data.byteLength !== undefined) {
          const bufferData = this.convertToUint8Array(data.buffer);
          if (bufferData) {
            return bufferData.slice(data.byteOffset, data.byteOffset + data.byteLength);
          }
        }
      }

      console.warn('⚠️ [DataFormatValidator] Unknown data format:', typeof data);

      return null
    } catch (error) {
      console.error('❌ [DataFormatValidator] Conversion error:', error)
      return null
    }
  }

  // 生成调试报告
  static generateDebugReport(chunks: any[], source: string = 'unknown'): string {
    const validation = this.validateChunks(chunks)
    
    let report = `\n📊 Data Format Debug Report - Source: ${source}\n`
    report += `${'='.repeat(50)}\n`
    report += `Total Chunks: ${validation.summary.totalChunks}\n`
    report += `Valid Chunks: ${validation.summary.validChunks}\n`
    report += `Total Size: ${(validation.summary.totalSize / 1024 / 1024).toFixed(2)} MB\n`
    report += `Errors: ${validation.totalErrors}\n`
    report += `Warnings: ${validation.totalWarnings}\n`
    report += `Overall Valid: ${validation.isValid ? '✅' : '❌'}\n\n`
    
    report += `Format Distribution:\n`
    Object.entries(validation.summary.formats).forEach(([format, count]) => {
      report += `  ${format}: ${count} chunks\n`
    })
    
    if (validation.totalErrors > 0) {
      report += `\n❌ Errors:\n`
      validation.chunkResults.forEach((result, index) => {
        if (result.errors.length > 0) {
          report += `  Chunk ${index}: ${result.errors.join(', ')}\n`
        }
      })
    }
    
    if (validation.totalWarnings > 0) {
      report += `\n⚠️ Warnings:\n`
      validation.chunkResults.forEach((result, index) => {
        if (result.warnings.length > 0) {
          report += `  Chunk ${index}: ${result.warnings.join(', ')}\n`
        }
      })
    }
    
    return report
  }

  // 修复数据格式问题
  static fixChunkFormat(chunk: any): any {
    if (!chunk || !chunk.data) {
      return null
    }

    const convertedData = this.convertToUint8Array(chunk.data)
    if (!convertedData) {
      console.error('❌ [DataFormatValidator] Cannot convert chunk data')
      return null
    }

    return {
      data: convertedData,
      timestamp: chunk.timestamp || 0,
      type: chunk.type || 'delta',
      size: chunk.size || convertedData.length,
      codedWidth: chunk.codedWidth || 1920,
      codedHeight: chunk.codedHeight || 1080,
      codec: chunk.codec || 'vp8'
    }
  }

  // 批量修复数据格式
  static fixChunksFormat(chunks: any[]): any[] {
    if (!Array.isArray(chunks)) {
      return []
    }

    return chunks
      .map(chunk => this.fixChunkFormat(chunk))
      .filter(chunk => chunk !== null)
  }
}

// 导出便捷函数
export const validateChunks = DataFormatValidator.validateChunks.bind(DataFormatValidator)
export const generateDebugReport = DataFormatValidator.generateDebugReport.bind(DataFormatValidator)
export const fixChunksFormat = DataFormatValidator.fixChunksFormat.bind(DataFormatValidator)
