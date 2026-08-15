const output = document.querySelector('#output')
const worker = new Worker('./worker.js', { type: 'module' })
let pendingResolve = null

function log(value) {
  output.textContent += `\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`
}

worker.onmessage = ({ data }) => {
  log(data)
  pendingResolve?.(data)
  pendingResolve = null
}

worker.onerror = (event) => {
  log({ ok: false, error: event.message })
  pendingResolve?.({ ok: false, error: event.message })
  pendingResolve = null
}

function send(message) {
  return new Promise((resolve) => {
    pendingResolve = resolve
    worker.postMessage(message)
  })
}

async function run(mode) {
  output.textContent = `Running ${mode} mode...`
  const result = await send({ type: 'run', mode, batches: 5, linesPerBatch: 1000 })
  if (!result.ok) return
  log(result.assertions.every((item) => item.pass) ? 'RESULT: PASS' : 'RESULT: FAIL')
}

document.querySelector('#run-sync').addEventListener('click', () => run('sync'))
document.querySelector('#run-writable').addEventListener('click', () => run('writable'))
document.querySelector('#cleanup').addEventListener('click', async () => {
  output.textContent = 'Cleaning up...'
  await send({ type: 'cleanup' })
})
