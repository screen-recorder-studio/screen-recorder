(function () {
  'use strict'

  const CODEC = 'avc1.640028'
  const TEST_DIMENSIONS = [
    { width: 1920, height: 1080 },
    { width: 1919, height: 1079 },
    { width: 1920, height: 1088 }
  ]

  const runButton = document.querySelector('#run')
  const copyButton = document.querySelector('#copy')
  const environmentElement = document.querySelector('#environment')
  const supportResults = document.querySelector('#support-results')
  const encodeResult = document.querySelector('#encode-result')
  const encodeStages = document.querySelector('#encode-stages')
  const rawReport = document.querySelector('#raw-report')

  let lastReport = null

  function createConfig(width, height) {
    return {
      codec: CODEC,
      width,
      height,
      bitrate: 8_000_000,
      framerate: 30,
      hardwareAcceleration: 'no-preference',
      latencyMode: 'realtime',
      avc: { format: 'annexb' }
    }
  }

  function describeError(error) {
    if (error instanceof DOMException || error instanceof Error) {
      return { name: error.name, message: error.message }
    }
    return { name: typeof error, message: String(error) }
  }

  function appendCell(row, text, className) {
    const cell = document.createElement('td')
    cell.textContent = text
    if (className) cell.className = className
    row.appendChild(cell)
  }

  function renderEnvironment(environment) {
    environmentElement.replaceChildren()
    const values = [
      ['Chrome / UA', environment.userAgent],
      ['Secure context', String(environment.secureContext)],
      ['VideoEncoder', String(environment.videoEncoder)],
      ['VideoFrame', String(environment.videoFrame)],
      ['Platform', environment.platform],
      ['Logical CPUs', String(environment.hardwareConcurrency)],
      ['Probe time', environment.timestamp]
    ]

    for (const [label, value] of values) {
      const wrapper = document.createElement('div')
      const term = document.createElement('dt')
      const description = document.createElement('dd')
      term.textContent = label
      description.textContent = value
      wrapper.append(term, description)
      environmentElement.appendChild(wrapper)
    }
  }

  function renderSupportResults(results) {
    supportResults.replaceChildren()
    for (const result of results) {
      const row = document.createElement('tr')
      appendCell(row, `${result.input.width} × ${result.input.height}`)
      appendCell(
        row,
        result.error ? `ERROR · ${result.error.name}` : result.supported ? 'SUPPORTED' : 'UNSUPPORTED',
        !result.error && result.supported ? 'pass' : 'fail'
      )
      appendCell(
        row,
        result.error
          ? result.error.message
          : `${result.returnedConfig?.width ?? '?'} × ${result.returnedConfig?.height ?? '?'} · ${result.returnedConfig?.codec ?? '?'}`
      )
      supportResults.appendChild(row)
    }
  }

  function renderEncodeResult(result) {
    encodeResult.className = `encode-result ${result.success ? 'pass' : 'fail'}`
    encodeResult.textContent = result.success
      ? `PASS · ${result.chunkCount} chunks · ${result.totalBytes.toLocaleString('en-US')} bytes`
      : `FAIL · ${result.error?.name ?? 'NO_OUTPUT'} · ${result.error?.message ?? 'Encoder emitted no chunks'}`

    encodeStages.replaceChildren()
    for (const stage of result.stages) {
      const item = document.createElement('li')
      item.textContent = stage
      encodeStages.appendChild(item)
    }
  }

  async function checkSupport(width, height) {
    const config = createConfig(width, height)
    try {
      const support = await VideoEncoder.isConfigSupported(config)
      return {
        input: { width, height },
        supported: support.supported,
        returnedConfig: support.config
      }
    } catch (error) {
      return {
        input: { width, height },
        supported: false,
        error: describeError(error)
      }
    }
  }

  function drawProbeFrame(context, width, height, frameIndex) {
    const gradient = context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#ff3158')
    gradient.addColorStop(0.5, '#22d3ee')
    gradient.addColorStop(1, '#3b28a8')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)

    context.fillStyle = '#081019'
    context.fillRect(80 + frameIndex * 24, 80, 500, 220)
    context.fillStyle = '#ffffff'
    context.font = '700 74px sans-serif'
    context.fillText(`H.264 1920×1080 · F${frameIndex}`, 112, 220)
    context.lineWidth = 8
    context.strokeStyle = '#ffffff'
    context.strokeRect(8, 8, width - 16, height - 16)
  }

  async function runRealEncode() {
    const stages = []
    const chunks = []
    let callbackError = null
    let encoder = null
    let framesSubmitted = 0

    try {
      stages.push('create canvas 1920 × 1080')
      const canvas = document.createElement('canvas')
      canvas.width = 1920
      canvas.height = 1080
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('2D canvas context is unavailable')

      stages.push('construct VideoEncoder')
      encoder = new VideoEncoder({
        output(chunk, metadata) {
          chunks.push({
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration ?? null,
            byteLength: chunk.byteLength,
            decoderConfig: metadata.decoderConfig
              ? {
                  codec: metadata.decoderConfig.codec,
                  codedWidth: metadata.decoderConfig.codedWidth,
                  codedHeight: metadata.decoderConfig.codedHeight,
                  descriptionBytes: metadata.decoderConfig.description?.byteLength ?? 0
                }
              : null
          })
        },
        error(error) {
          callbackError = describeError(error)
        }
      })

      stages.push(`configure ${CODEC} / 8 Mbps / 30 fps / Annex B`)
      encoder.configure(createConfig(1920, 1080))

      for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
        drawProbeFrame(context, 1920, 1080, frameIndex)
        const frame = new VideoFrame(canvas, {
          timestamp: frameIndex * 33_333,
          duration: 33_333
        })
        try {
          encoder.encode(frame, { keyFrame: frameIndex === 0 })
          framesSubmitted += 1
        } finally {
          frame.close()
        }
      }
      stages.push('encode 3 canvas frames (first is key frame)')

      await encoder.flush()
      stages.push('flush resolved')
      if (callbackError) throw Object.assign(new Error(callbackError.message), { name: callbackError.name })
      const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      if (chunks.length === 0 || totalBytes === 0) {
        throw new Error('flush completed but no non-empty EncodedVideoChunk was emitted')
      }

      return {
        success: true,
        config: createConfig(1920, 1080),
        frameCount: framesSubmitted,
        chunkCount: chunks.length,
        totalBytes,
        chunks,
        stages
      }
    } catch (error) {
      stages.push(`failed: ${error.name ?? typeof error} · ${error.message ?? String(error)}`)
      return {
        success: false,
        config: createConfig(1920, 1080),
        frameCount: framesSubmitted,
        chunkCount: chunks.length,
        totalBytes: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
        chunks,
        stages,
        error: describeError(error)
      }
    } finally {
      if (encoder && encoder.state !== 'closed') encoder.close()
    }
  }

  async function runProbe() {
    runButton.disabled = true
    copyButton.disabled = true
    runButton.textContent = '测试中…'
    encodeResult.className = 'encode-result idle'
    encodeResult.textContent = '测试中…'
    encodeStages.replaceChildren()

    const environment = {
      userAgent: navigator.userAgent,
      platform: navigator.userAgentData?.platform ?? navigator.platform ?? 'unknown',
      hardwareConcurrency: navigator.hardwareConcurrency ?? 'unknown',
      secureContext: window.isSecureContext,
      videoEncoder: typeof VideoEncoder !== 'undefined',
      videoFrame: typeof VideoFrame !== 'undefined',
      timestamp: new Date().toISOString()
    }
    renderEnvironment(environment)

    if (!environment.videoEncoder || !environment.videoFrame) {
      const unavailable = {
        success: false,
        chunkCount: 0,
        totalBytes: 0,
        stages: ['WebCodecs API unavailable'],
        error: { name: 'NotSupportedError', message: 'VideoEncoder or VideoFrame is unavailable' }
      }
      renderEncodeResult(unavailable)
      lastReport = { environment, supportChecks: [], actualEncode: unavailable }
    } else {
      const supportChecks = []
      for (const dimensions of TEST_DIMENSIONS) {
        supportChecks.push(await checkSupport(dimensions.width, dimensions.height))
      }
      renderSupportResults(supportChecks)
      const actualEncode = await runRealEncode()
      renderEncodeResult(actualEncode)
      lastReport = { environment, codec: CODEC, supportChecks, actualEncode }
    }

    rawReport.textContent = JSON.stringify(lastReport, null, 2)
    runButton.disabled = false
    copyButton.disabled = false
    runButton.textContent = '重新运行'
  }

  runButton.addEventListener('click', runProbe)
  copyButton.addEventListener('click', async function () {
    if (!lastReport) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2))
      copyButton.textContent = '已复制'
      window.setTimeout(() => { copyButton.textContent = '复制报告' }, 1200)
    } catch (error) {
      copyButton.textContent = '复制失败，请手动复制 JSON'
    }
  })
})()
