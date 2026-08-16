export type ProductionExportFormat = 'mp4' | 'webm' | 'gif'

export interface MemoryExportChunk {
  timestamp: number
  type: 'key' | 'delta'
  data: Uint8Array
  size: number
  codec: string
  codedWidth: number
  codedHeight: number
}

export function buildProductionExportMatrix(): Array<{
  format: ProductionExportFormat
  state: 'implemented' | 'unverified' | 'bridge-required'
  detail: string
}> {
  return [
    { format: 'mp4', state: 'implemented', detail: '真实 export-worker + H.264 BufferTarget' },
    { format: 'webm', state: 'implemented', detail: '真实 export-worker + VP9 BufferTarget，文件回读已验证' },
    { format: 'gif', state: 'bridge-required', detail: '需要主线程 GifEncoder 握手与静态 worker 资产' }
  ]
}

export function evaluateProductionExportAcceptance(input: {
  actualDurationSeconds: number
  expectedDurationSeconds: number
  actualWidth: number
  actualHeight: number
  expectedWidth: number
  expectedHeight: number
  targetFrameRate: number
  checkpointMae: readonly number[]
  durationToleranceSeconds?: number
  pixelMaeLimit?: number
}) {
  const durationToleranceSeconds = input.durationToleranceSeconds
    ?? 1 / (2 * input.targetFrameRate)
  const durationPass = Math.abs(input.actualDurationSeconds - input.expectedDurationSeconds)
    <= durationToleranceSeconds
  const dimensionsPass = input.actualWidth === input.expectedWidth
    && input.actualHeight === input.expectedHeight
  const maxCheckpointMae = input.checkpointMae.length > 0
    ? Math.max(...input.checkpointMae)
    : Infinity
  const pixelsPass = input.checkpointMae.length > 0
    && input.checkpointMae.every(value => Number.isFinite(value) && value <= (input.pixelMaeLimit ?? 18))

  return {
    durationPass,
    dimensionsPass,
    pixelsPass,
    pass: durationPass && dimensionsPass && pixelsPass,
    maxCheckpointMae
  }
}
