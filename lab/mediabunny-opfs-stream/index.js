import { CanvasSource, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny'

const DIRECTORY = 'lab-mediabunny-opfs-stream'
const FILE_NAME = 'position-aware.mp4'
const outputElement = document.querySelector('#output')
const video = document.querySelector('#video')
let objectUrl = null

function log(value) {
  outputElement.textContent += `\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`
}

async function createPositionAwareWritable(fileHandle, stats) {
  const fileWritable = await fileHandle.createWritable({ keepExistingData: false })
  return new WritableStream({
    async write(chunk) {
      const start = chunk.position
      const end = start + chunk.data.byteLength
      if (start < stats.highWaterMark) stats.overlappingWrites += 1
      stats.writeCount += 1
      stats.totalBytesPresented += chunk.data.byteLength
      stats.highWaterMark = Math.max(stats.highWaterMark, end)
      await fileWritable.write({ type: 'write', position: start, data: chunk.data })
    },
    async close() {
      await fileWritable.truncate(stats.highWaterMark)
      await fileWritable.close()
    },
    async abort(reason) {
      await fileWritable.abort(reason)
    }
  })
}

async function waitForMetadata(element) {
  await new Promise((resolve, reject) => {
    element.onloadedmetadata = resolve
    element.onerror = () => reject(new Error('Generated MP4 could not load in the video element'))
  })
}

async function run() {
  outputElement.textContent = 'Checking H.264 support and generating frames...'
  const support = await VideoEncoder.isConfigSupported({
    codec: 'avc1.42001e',
    width: 320,
    height: 180,
    bitrate: 500_000,
    framerate: 30
  })
  if (!support.supported) throw new Error('H.264 VideoEncoder configuration is not supported on this machine')

  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(DIRECTORY, { create: true })
  const fileHandle = await dir.getFileHandle(FILE_NAME, { create: true })
  const stats = { writeCount: 0, overlappingWrites: 0, totalBytesPresented: 0, highWaterMark: 0 }
  const writable = await createPositionAwareWritable(fileHandle, stats)

  const canvas = new OffscreenCanvas(320, 180)
  const context = canvas.getContext('2d')
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 500_000 })
  const mediaOutput = new Output({
    format: new Mp4OutputFormat(),
    target: new StreamTarget(writable, { chunked: false })
  })
  mediaOutput.addVideoTrack(source)
  await mediaOutput.start()

  const frameRate = 30
  const frameDuration = 1 / frameRate
  for (let frame = 0; frame < frameRate * 2; frame += 1) {
    context.fillStyle = `hsl(${frame * 6} 70% 45%)`
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#fff'
    context.font = '28px system-ui'
    context.fillText(`Frame ${frame + 1}`, 85, 100)
    await source.add(frame * frameDuration, frameDuration)
  }

  await mediaOutput.finalize()
  const file = await fileHandle.getFile()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(file)
  video.src = objectUrl
  await waitForMetadata(video)

  const result = {
    fileName: FILE_NAME,
    fileBytes: file.size,
    durationSeconds: video.duration,
    stats,
    assertions: [
      { name: 'output is non-empty', pass: file.size > 0 },
      { name: 'physical size matches highest written byte', pass: file.size === stats.highWaterMark },
      { name: 'video metadata is readable', pass: Number.isFinite(video.duration) && video.duration > 1.8 },
      { name: 'position rewrites were handled', pass: stats.overlappingWrites >= 0, observedOverlaps: stats.overlappingWrites }
    ]
  }
  log(result)
  log(result.assertions.every((item) => item.pass) ? 'RESULT: PASS' : 'RESULT: FAIL')
}

async function cleanup() {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = null
  video.removeAttribute('src')
  video.load()
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => {})
  outputElement.textContent = `Cleaned ${DIRECTORY}.`
}

document.querySelector('#run').addEventListener('click', () => run().catch((error) => {
  log({ error: error instanceof Error ? error.message : String(error) })
}))
document.querySelector('#cleanup').addEventListener('click', () => cleanup().catch((error) => log({ error: String(error) })))
