<script lang="ts">
  import { onMount } from 'svelte'

  type ChunkIndex = {
    offset: number
    size: number
    timestamp: number // microseconds
    type: 'key' | 'delta'
    isKeyframe?: boolean
    codedWidth?: number
    codedHeight?: number
    codec?: string
  }

  const defaultId = 'rec_1757651534329'
  let recordingId = defaultId

  let running = false
  let summary: any = null
  let checks: { name: string; pass: boolean; detail?: string }[] = []
  let messages: string[] = []

  let canvasEl: HTMLCanvasElement | null = null
  let firstFrame: { tsUs: number; drawn: boolean } | null = null

  function log(msg: string) { messages = [...messages, msg] }
  function reset() {
    summary = null
    checks = []
    messages = []
  }
  let dirList: string[] = []

  async function scanOPFS() {
    try {
      if (!('storage' in navigator) || !(navigator as any).storage.getDirectory) {
        log('OPFS not available in this origin/context')
        return
      }
      const root: FileSystemDirectoryHandle = await (navigator as any).storage.getDirectory()
      const found: string[] = []
      // @ts-ignore for await on directory entries in OPFS
      for await (const [name, handle] of (root as any).entries?.() ?? []) {
        if ((handle as any)?.kind === 'directory' && String(name).startsWith('rec_')) {
          found.push(String(name))
        }
      }
      dirList = found.sort()
      log(`Found ${dirList.length} rec_* directories`)
    } catch (e: any) {
      log(`scan error: ${e?.message ?? String(e)}`)
    }
  }

  function getParamId() {
    try {
      const u = new URL(location.href)
      const id = u.searchParams.get('id')
      return id ?? ''
    } catch { return '' }
  }


  async function validate() {
    reset()
    running = true
    try {
      if (!('storage' in navigator) || !(navigator as any).storage.getDirectory) {
        throw new Error('OPFS not available in this origin/context')
      }
      const root: FileSystemDirectoryHandle = await (navigator as any).storage.getDirectory()
      log('OPFS root acquired')

      // Open directory by recordingId (must equal folder + meta.id)
      let dir: FileSystemDirectoryHandle
      try {
        dir = await root.getDirectoryHandle(recordingId, { create: false })
      } catch (e) {
        throw new Error(`Directory not found: ${recordingId}`)
      }
      log(`Directory opened: ${recordingId}`)

      // Read files
      const metaHandle = await dir.getFileHandle('meta.json')
      const indexHandle = await dir.getFileHandle('index.jsonl')
      const dataHandle = await dir.getFileHandle('data.bin')

      const metaText = await (await metaHandle.getFile()).text()
      const meta = JSON.parse(metaText)
      const dataFile = await dataHandle.getFile()
      const dataSize = dataFile.size
      const indexText = await (await indexHandle.getFile()).text()
      const lines = indexText.split(/\r?\n/).filter(Boolean)
      const entries: ChunkIndex[] = lines.map((l, i) => {
        try { return JSON.parse(l) } catch { throw new Error(`Bad JSON at index line ${i}`) }
      })

      // Build summary
      const keyframeIndices: number[] = []
      let lastTs = -Infinity
      let lastEnd = 0
      let offsetsMonotonic = true
      let timestampsMonotonic = true
      let withinBounds = true
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        if (e.type === 'key' || e.isKeyframe) keyframeIndices.push(i)
        if (e.timestamp < lastTs) timestampsMonotonic = false
        lastTs = Math.max(lastTs, e.timestamp)
        if (e.offset < lastEnd) offsetsMonotonic = false
        const end = e.offset + e.size
        if (end > dataSize) withinBounds = false
        lastEnd = Math.max(lastEnd, end)
      }

      summary = {
        dir: recordingId,
        meta,
        chunks: entries.length,
        dataSize,
        estimatedBytesFromIndex: lastEnd,
        durationMs: Math.round((entries.at(-1)?.timestamp ?? 0) / 1000),
        keyframes: keyframeIndices.length
      }

      // Checks
      checks.push({ name: 'meta.id equals directory name', pass: meta?.id === recordingId, detail: `${meta?.id} vs ${recordingId}` })
      checks.push({ name: 'meta.totalChunks matches index lines', pass: meta?.totalChunks === entries.length, detail: `${meta?.totalChunks} vs ${entries.length}` })
      checks.push({ name: 'data.bin size equals last (offset+size)', pass: dataSize === lastEnd, detail: `${dataSize} vs ${lastEnd}` })
      checks.push({ name: 'offsets monotonic non-decreasing', pass: offsetsMonotonic })
      checks.push({ name: 'timestamps monotonic non-decreasing', pass: timestampsMonotonic })
      checks.push({ name: 'index ranges within data.bin bounds', pass: withinBounds })
      checks.push({ name: 'first chunk is keyframe', pass: (entries[0]?.type === 'key') || !!entries[0]?.isKeyframe })
      if (entries[0]?.codedWidth && entries[0]?.codedHeight) {
        const whOk = entries[0].codedWidth === meta.width && entries[0].codedHeight === meta.height
        checks.push({ name: 'codedWidth/Height match meta', pass: whOk, detail: `${entries[0].codedWidth}x${entries[0].codedHeight} vs ${meta.width}x${meta.height}` })
      } else {
        checks.push({ name: 'codedWidth/Height present in index (optional)', pass: false, detail: 'missing in first entry' })
      }
      if (entries[0]?.codec) {
        checks.push({ name: 'codec in index matches meta', pass: entries[0].codec === meta.codec, detail: `${entries[0].codec} vs ${meta.codec}` })
      } else {
        checks.push({ name: 'codec present in index (optional)', pass: false, detail: 'missing in first entry' })
      }
      checks.push({ name: 'keyframe count > 0', pass: keyframeIndices.length > 0, detail: `${keyframeIndices.length}` })

      // Decode and render the first keyframe into canvas; timestamps are microseconds
      let decodeTried = false
      let decodeOk = false
      try {
        if ('VideoDecoder' in window && entries.length > 0) {
          const kfIdx = keyframeIndices[0] ?? 0
          const kf = entries[kfIdx]
          const buf = await dataFile.slice(kf.offset, kf.offset + kf.size).arrayBuffer()

          const codec = meta.codec || entries[0]?.codec || 'vp8'
          const cfg: any = { codec, codedWidth: meta.width, codedHeight: meta.height }
          if (meta?.decoderConfig?.description) {
            try { cfg.description = new Uint8Array(meta.decoderConfig.description) } catch {}
          }
          const supported = await (window as any).VideoDecoder.isConfigSupported?.(cfg).catch(() => ({ supported: false }))
          log(`VideoDecoder support for ${codec} @ ${meta.width}x${meta.height}: ${supported?.supported ? 'yes' : 'no'}`)
          if (supported?.supported) {
            decodeTried = true
            await new Promise<void>(async (resolve) => {
              let settled = false
              const finish = () => { if (!settled) { settled = true; resolve() } }
              let timeoutId: any
              const dec = new (window as any).VideoDecoder({
                output: async (_frame: any) => {
                  try {
                    if (canvasEl) {
                      const w = _frame.displayWidth || meta.width
                      const h = _frame.displayHeight || meta.height
                      canvasEl.width = w; canvasEl.height = h
                      const ctx = canvasEl.getContext('2d')!
                      try {
                        if ('createImageBitmap' in window) {
                          const bmp = await (window as any).createImageBitmap(_frame)
                          ctx.drawImage(bmp, 0, 0, w, h)
                          try { (bmp as any).close?.() } catch {}
                        } else {
                          // Fallback: draw VideoFrame directly
                          ctx.drawImage(_frame as any, 0, 0, w, h)
                        }
                        firstFrame = { tsUs: Number(kf.timestamp ?? 0), drawn: true }
                        decodeOk = true
                        log('First keyframe decoded and drawn')
                        try { clearTimeout(timeoutId) } catch {}
                        try { dec.close?.() } catch {}
                      } catch (drawErr) {
                        log(`draw error: ${drawErr?.message ?? String(drawErr)}`)
                      }
                    }
                  } finally {
                    try { _frame.close?.() } catch {}
                    finish()
                  }
                },
                error: (e: any) => { log(`Decoder error: ${e?.message ?? String(e)}`); finish() }
              })
              try {
                dec.configure(cfg)
                const ts0 = Number(entries?.[0]?.timestamp ?? 0)
                const tsUs = Math.max(0, Number(kf.timestamp ?? 0) - ts0)
                const type = (kf.type === 'key' || kf.isKeyframe) ? 'key' : 'delta'
                const chunk = new (window as any).EncodedVideoChunk({ type, timestamp: tsUs, data: new Uint8Array(buf) })
                dec.decode(chunk)
                // Timeout guard: 2000ms
                timeoutId = setTimeout(() => { log('decode timeout (2000ms)'); try { dec.close?.() } catch {}; finish() }, 2000)
              } catch (cfgErr) {
                log(`Decoder configure/decode failed: ${cfgErr?.message ?? String(cfgErr)}`)
                finish()
              }
            })
          } else {
            log('VideoDecoder not supported for this config; skipping decode')
          }
        }
      } catch (e) {
        console.warn('Decode/render first frame failed', e)
      }
      if (decodeTried) {
        checks.push({ name: 'first keyframe decoded and rendered', pass: decodeOk, detail: decodeOk ? `ts(us)=${firstFrame?.tsUs}` : 'no frame output' })
      }

      log('Validation completed')
    } catch (e: any) {
      console.error(e)
      log(`error: ${e?.message || String(e)}`)
      checks.push({ name: 'Validation error', pass: false, detail: e?.message || String(e) })
    } finally {
      running = false
    }
  }

  onMount(() => {
    const fromUrl = getParamId()
    if (fromUrl) recordingId = fromUrl
    // auto-scan to help discover available recordings in this origin
    scanOPFS()
  })
</script>

<section class="wrap">
  <h1>OPFS Recording Validator</h1>
  <div class="controls">
    <label for="rec-id">Recording ID (directory name)</label>
    <input id="rec-id" bind:value={recordingId} placeholder="rec_..." />
    <button on:click={validate} disabled={running}>Validate</button>
    <button on:click={scanOPFS} disabled={running}>Scan OPFS</button>
  </div>

  {#if running}
    <p>Running validation...</p>
  {/if}
  {#if dirList.length}
    <div class="dirs">
      <h2>OPFS rec_* directories</h2>
      <ul>
        {#each dirList as d}
          <li><button class="link" on:click={() => recordingId = d}>{d}</button></li>
        {/each}
      </ul>
    </div>
  {/if}


  {#if summary}
    <div class="summary">
      <h2>Summary</h2>
      <ul>
        <li>dir: <code>{summary.dir}</code></li>
        <li>meta.codec: <code>{summary.meta.codec}</code>, {summary.meta.width}x{summary.meta.height} @ {summary.meta.fps}fps</li>
        <li>chunks: {summary.chunks}</li>
        <li>data.bin size: {summary.dataSize} bytes</li>
        <li>bytes by index: {summary.estimatedBytesFromIndex} bytes</li>
        <li>duration (approx): {summary.durationMs} ms</li>
        <li>keyframes: {summary.keyframes}</li>
      </ul>
    </div>
  {/if}


  <div class="first-frame">
    <h2>First frame</h2>
    <p>timestamp: {firstFrame?.tsUs ?? 0} µs (~{Math.round((firstFrame?.tsUs ?? 0) / 1000)} ms)</p>
    <canvas bind:this={canvasEl}></canvas>
  </div>

  {#if checks.length}
    <div class="checks">
      <h2>Checks</h2>
      <table>
        <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
        <tbody>
        {#each checks as c}
          <tr class={c.pass ? 'ok' : 'fail'}>


            <td>{c.name}</td>
            <td>{c.pass ? 'PASS' : 'FAIL'}</td>
            <td>{c.detail}</td>
          </tr>
        {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if messages.length}
    <div class="logs">
      <h2>Logs</h2>
      <pre>{messages.join('\n')}</pre>
    </div>
  {/if}
</section>

<style>
  .wrap { padding: 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial }
  .controls { display: flex; gap: 8px; align-items: center; margin-bottom: 12px }
  input { width: 280px; padding: 6px 8px }
  button { padding: 6px 10px }
  .summary, .checks, .logs { margin-top: 16px }
  table { border-collapse: collapse; width: 100% }
  th, td { border: 1px solid #ddd; padding: 6px; font-size: 13px }
  tr.ok { background: #f0fff4 }
  tr.fail { background: #fff5f5 }
  code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px }
  pre { background: #111; color: #9f9; padding: 8px; font-size: 12px; overflow: auto }
  .dirs { margin-top: 12px }
  .dirs ul { list-style: none; padding-left: 0 }
  .dirs li { display: inline-block; margin: 2px 4px }
  .first-frame { margin-top: 16px }
  .first-frame canvas { max-width: 100%; height: auto; border: 1px solid #ddd; background: #000 }

  .dirs .link { background: none; border: 0; color: #06f; text-decoration: underline; cursor: pointer; padding: 2px 4px }

</style>

