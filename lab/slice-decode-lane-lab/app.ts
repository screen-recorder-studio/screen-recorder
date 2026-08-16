import {
  beginMainDecode,
  createPreviewDecodeLane,
  finishMainDecode,
  requestPrefetchDecode
} from '../../packages/extension/src/lib/studio/preview-decode-lane'

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function run() {
  const mainFrames = Math.max(1, Math.floor(Number(byId<HTMLInputElement>('mainFrames').value) || 30))
  const before = Math.max(0, Math.min(mainFrames, Math.floor(Number(byId<HTMLInputElement>('outputsBeforePrefetch').value) || 0)))
  const oldCurrent = before
  const oldMisrouted = mainFrames - before

  const main = beginMainDecode(createPreviewDecodeLane(7), 7)
  const requested = requestPrefetchDecode(main.state, { generation: 7, targetGlobalFrame: 660 })
  const settled = finishMainDecode(requested.state, 7)
  const passed = requested.effect === 'defer-prefetch'
    && requested.state.outputTarget === 'current'
    && settled.effect === 'start-prefetch'
    && settled.state.outputTarget === 'next'

  byId('oldCurrent').textContent = `${oldCurrent}/${mainFrames} 帧`
  byId('oldMisrouted').textContent = `${oldMisrouted} 帧`
  byId('oldPlayable').textContent = oldCurrent <= 1 ? '静止在首帧' : '不完整'
  byId('fixedCurrent').textContent = `${mainFrames}/${mainFrames} 帧`
  byId('fixedStart').textContent = '主窗口 flush 之后'
  byId('fixedOwner').textContent = 'current → next，严格串行'
  byId('result').textContent = passed
    ? `通过：预取被延迟，当前窗口完整保留 ${mainFrames} 帧`
    : '失败：解码 lane 未保持串行'
  byId('events').innerHTML = [
    '主窗口开始解码，outputTarget=current',
    `主窗口仅输出 ${before} 帧时收到下一窗口预取`,
    '预取进入 deferred，不改变 outputTarget',
    `主窗口剩余 ${mainFrames - before} 帧仍归属 current`,
    '主窗口 flush 完成后，预取才切换到 next'
  ].map(item => `<li>${item}</li>`).join('')
}

byId('run').addEventListener('click', run)
run()
