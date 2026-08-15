const DIRECTORY = 'lab-opfs-incremental-index'
const encoder = new TextEncoder()

function makeBatch(batch, linesPerBatch) {
  let text = ''
  for (let index = 0; index < linesPerBatch; index += 1) {
    const sequence = batch * linesPerBatch + index
    text += `${JSON.stringify({ sequence, offset: sequence * 8, size: 8, timestamp: sequence * 33333 })}\n`
  }
  return text
}

async function runSync(fileHandle, batches, linesPerBatch) {
  if (typeof fileHandle.createSyncAccessHandle !== 'function') {
    throw new Error('createSyncAccessHandle is not available in this Dedicated Worker')
  }
  const handle = await fileHandle.createSyncAccessHandle()
  const writes = []
  let offset = 0
  try {
    handle.truncate(0)
    for (let batch = 0; batch < batches; batch += 1) {
      const bytes = encoder.encode(makeBatch(batch, linesPerBatch))
      const written = handle.write(bytes, { at: offset })
      if (written !== bytes.byteLength) throw new Error(`partial write: ${written}/${bytes.byteLength}`)
      offset += written
      handle.flush()
      writes.push({ batch, bytes: written, fileSizeAfterFlush: handle.getSize() })
    }
    handle.truncate(offset)
    handle.flush()
  } finally {
    handle.close()
  }
  return writes
}

async function runWritable(fileHandle, batches, linesPerBatch) {
  const writable = await fileHandle.createWritable({ keepExistingData: false })
  const writes = []
  let offset = 0
  try {
    for (let batch = 0; batch < batches; batch += 1) {
      const bytes = encoder.encode(makeBatch(batch, linesPerBatch))
      await writable.write(bytes)
      offset += bytes.byteLength
      writes.push({ batch, bytes: bytes.byteLength, expectedOffsetAfterWrite: offset })
    }
  } finally {
    await writable.close()
  }
  return writes
}

async function run({ mode, batches, linesPerBatch }) {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(DIRECTORY, { create: true })
  const fileHandle = await dir.getFileHandle(`index-${mode}.jsonl`, { create: true })
  const writes = mode === 'sync'
    ? await runSync(fileHandle, batches, linesPerBatch)
    : await runWritable(fileHandle, batches, linesPerBatch)

  const file = await fileHandle.getFile()
  const text = await file.text()
  const lines = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const expectedLines = batches * linesPerBatch
  const ordered = lines.every((entry, index) => entry.sequence === index)
  const batchBytes = writes.reduce((sum, item) => sum + item.bytes, 0)

  return {
    ok: true,
    mode,
    writes,
    fileSize: file.size,
    lineCount: lines.length,
    assertions: [
      { name: 'all lines persisted', pass: lines.length === expectedLines, expected: expectedLines, actual: lines.length },
      { name: 'lines remained ordered', pass: ordered },
      { name: 'file size equals newly written bytes', pass: file.size === batchBytes, expected: batchBytes, actual: file.size },
      { name: 'each call wrote only one batch', pass: writes.length === batches, expected: batches, actual: writes.length }
    ]
  }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'cleanup') {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => {})
      self.postMessage({ ok: true, cleaned: DIRECTORY })
      return
    }
    if (data.type === 'run') {
      self.postMessage(await run(data))
    }
  } catch (error) {
    self.postMessage({ ok: false, mode: data.mode, error: error instanceof Error ? error.message : String(error) })
  }
}
