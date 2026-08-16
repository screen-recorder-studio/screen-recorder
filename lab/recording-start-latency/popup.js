const RESULT_KEY = 'recordingStartLatencyResultV1'
const PROGRESS_KEY = 'recordingStartLatencyProgressV1'
const status = document.querySelector('#status')
const result = document.querySelector('#result')
const countdown = document.querySelector('#countdown')
const settle = document.querySelector('#settle')

async function refresh() {
  const stored = await chrome.storage.session.get([RESULT_KEY, PROGRESS_KEY])
  const progress = stored[PROGRESS_KEY]
  const latest = stored[RESULT_KEY]
  status.textContent = progress ? `${progress.stage} · ${new Date(progress.at).toLocaleTimeString()}` : 'Idle'
  result.textContent = latest ? JSON.stringify(latest, null, 2) : 'No result yet.'
}

async function start(mode) {
  status.textContent = mode === 'tab' ? 'Starting current-tab probe…' : 'Open the picker and choose the test surface/display…'
  const response = await chrome.runtime.sendMessage({
    type: 'START_LATENCY_PROBE',
    mode,
    countdownSeconds: Number(countdown.value),
    settleMs: Number(settle.value)
  })
  if (!response?.ok) status.textContent = response?.error || 'Probe failed'
  await refresh()
}

document.querySelector('#open-surface').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_SURFACE' }))
document.querySelector('#start-tab').addEventListener('click', () => start('tab'))
document.querySelector('#start-display').addEventListener('click', () => start('display'))
document.querySelector('#stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_LATENCY_PROBE' })
  await refresh()
})
chrome.storage.onChanged.addListener(() => refresh())
refresh()
