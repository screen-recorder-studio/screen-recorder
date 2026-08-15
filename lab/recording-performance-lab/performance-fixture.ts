export interface PerformanceScenario {
  id: 'low-end-proxy' | 'standard' | '4k-balanced' | '4k-stress'
  label: string
  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
  frameRate: number
  durationSeconds: number
  hardwareAcceleration: HardwareAcceleration
  runByDefault: boolean
  budgets: {
    captureRtf: number
    previewP95Ms: number
    exportRtf: number
    maxDropRate: number
  }
}

export const PERFORMANCE_SCENARIOS: readonly PerformanceScenario[] = [
  {
    id: 'low-end-proxy',
    label: '低配代理 · 1080p source → 720p/24 · software preference',
    sourceWidth: 1920,
    sourceHeight: 1080,
    outputWidth: 1280,
    outputHeight: 720,
    frameRate: 24,
    durationSeconds: 2,
    hardwareAcceleration: 'prefer-software',
    runByDefault: true,
    budgets: { captureRtf: 1, previewP95Ms: 1000 / 24, exportRtf: 2, maxDropRate: 0.02 }
  },
  {
    id: 'standard',
    label: '标准 · 1080p/30 · browser preference',
    sourceWidth: 1920,
    sourceHeight: 1080,
    outputWidth: 1920,
    outputHeight: 1080,
    frameRate: 30,
    durationSeconds: 2,
    hardwareAcceleration: 'no-preference',
    runByDefault: true,
    budgets: { captureRtf: 1, previewP95Ms: 1000 / 30, exportRtf: 2, maxDropRate: 0.02 }
  },
  {
    id: '4k-balanced',
    label: '4K source → Balanced 1080p/30 · production scaling contract',
    sourceWidth: 3840,
    sourceHeight: 2160,
    outputWidth: 1920,
    outputHeight: 1080,
    frameRate: 30,
    durationSeconds: 2,
    hardwareAcceleration: 'no-preference',
    runByDefault: true,
    budgets: { captureRtf: 0.9, previewP95Ms: 1000 / 30, exportRtf: 2, maxDropRate: 0.02 }
  },
  {
    id: '4k-stress',
    label: '4K 压力 · 2160p/30 · manual only',
    sourceWidth: 3840,
    sourceHeight: 2160,
    outputWidth: 3840,
    outputHeight: 2160,
    frameRate: 30,
    durationSeconds: 1,
    hardwareAcceleration: 'no-preference',
    runByDefault: false,
    budgets: { captureRtf: 1, previewP95Ms: 1000 / 30, exportRtf: 4, maxDropRate: 0.02 }
  }
]

export function estimateDecodedFrameBufferBytes(
  width: number,
  height: number,
  currentFrames: number,
  prefetchedFrames: number,
  hoverFrames = 0
) {
  return width * height * 4 * (currentFrames + prefetchedFrames + hoverFrames)
}

export function projectExportMinutes(sourceMinutes: number, exportRtf: number) {
  return sourceMinutes * exportRtf
}

export function evaluatePerformanceRun(
  scenario: PerformanceScenario,
  metrics: {
    captureRtf: number
    previewP95Ms: number
    exportRtf: number
    droppedFrames: number
    frameCount: number
  }
) {
  const failures: Array<'capture' | 'preview' | 'export' | 'drops'> = []
  if (metrics.captureRtf > scenario.budgets.captureRtf) failures.push('capture')
  if (metrics.previewP95Ms > scenario.budgets.previewP95Ms) failures.push('preview')
  if (metrics.exportRtf > scenario.budgets.exportRtf) failures.push('export')
  const dropRate = metrics.frameCount > 0 ? metrics.droppedFrames / metrics.frameCount : 1
  if (dropRate > scenario.budgets.maxDropRate) failures.push('drops')

  return { pass: failures.length === 0, failures, dropRate }
}
