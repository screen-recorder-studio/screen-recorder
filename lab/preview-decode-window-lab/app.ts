import {
  classifyPreviewDecodedOutput,
  planBoundedPreviewDecodeWindow
} from '../../packages/extension/src/lib/studio/preview-decode-window'

const decodeStartInput = document.querySelector<HTMLInputElement>('#decode-start')!
const retainStartInput = document.querySelector<HTMLInputElement>('#retain-start')!
const chunkCountInput = document.querySelector<HTMLInputElement>('#chunk-count')!
const capacityInput = document.querySelector<HTMLInputElement>('#capacity')!
const runButton = document.querySelector<HTMLButtonElement>('#run')!
const acceptance = document.querySelector<HTMLElement>('#acceptance')!
const oldMetrics = document.querySelector<HTMLElement>('#old-metrics')!
const fixedMetrics = document.querySelector<HTMLElement>('#fixed-metrics')!
const oldFrames = document.querySelector<HTMLElement>('#old-frames')!
const fixedFrames = document.querySelector<HTMLElement>('#fixed-frames')!

runButton.addEventListener('click', run)
run()

function run() {
  const decodeStart = numericValue(decodeStartInput)
  const retainStart = numericValue(retainStartInput)
  const chunkCount = numericValue(chunkCountInput)
  const capacity = numericValue(capacityInput)
  const decodedGlobals = Array.from({ length: chunkCount }, (_, index) => decodeStart + index)
  const oldRetained = decodedGlobals.slice(-capacity)
  const requestedLocalIndex = retainStart - retainStart
  const oldResolvedGlobal = oldRetained[requestedLocalIndex]

  const plan = planBoundedPreviewDecodeWindow({
    decodeStartGlobalFrame: decodeStart,
    retainStartGlobalFrame: retainStart,
    decodedChunkCount: chunkCount,
    capacity
  })

  if (!plan) {
    acceptance.className = 'acceptance fail'
    acceptance.textContent = '失败：输入无法形成有效解码窗口'
    return
  }

  const fixedRetained = decodedGlobals.flatMap((_, decodedOutputIndex) => {
    const decision = classifyPreviewDecodedOutput(plan, decodedOutputIndex)
    return decision.action === 'retain' ? [decision.globalFrameIndex] : []
  })
  const fixedResolvedGlobal = fixedRetained[requestedLocalIndex]
  const passed = oldResolvedGlobal !== retainStart
    && fixedResolvedGlobal === retainStart
    && fixedRetained.length === plan.retainedFrameCount

  acceptance.className = `acceptance ${passed ? 'pass' : 'fail'}`
  acceptance.textContent = passed
    ? `通过：请求全局帧 ${retainStart}，旧策略误取 ${oldResolvedGlobal}，修复策略精确命中 ${fixedResolvedGlobal}`
    : '失败：边界模型没有复现或修复索引错位'

  oldMetrics.innerHTML = metricRows([
    ['宣称窗口', `${retainStart}–${retainStart + oldRetained.length - 1}`],
    ['实际保留', rangeLabel(oldRetained)],
    [`局部帧 ${requestedLocalIndex}`, `实际全局帧 ${oldResolvedGlobal}`]
  ])
  fixedMetrics.innerHTML = metricRows([
    ['解码预卷', `${plan.prerollFrameCount} 帧`],
    ['实际送入解码器', `${plan.decodeFrameCount}/${chunkCount} 块`],
    ['实际保留', rangeLabel(fixedRetained)],
    [`局部帧 ${requestedLocalIndex}`, `实际全局帧 ${fixedResolvedGlobal}`]
  ])
  renderFrames(oldFrames, oldRetained, retainStart)
  renderFrames(fixedFrames, fixedRetained, retainStart)
}

function numericValue(input: HTMLInputElement): number {
  return Math.max(0, Math.floor(Number(input.value) || 0))
}

function rangeLabel(values: number[]): string {
  return values.length ? `${values[0]}–${values.at(-1)}` : '空'
}

function metricRows(rows: Array<[string, string]>): string {
  return rows.map(([term, description]) => `<div><dt>${term}</dt><dd>${description}</dd></div>`).join('')
}

function renderFrames(container: HTMLElement, values: number[], target: number) {
  container.innerHTML = values.map(value =>
    `<span class="frame ${value === target ? 'target' : ''}">${value}</span>`
  ).join('')
}
